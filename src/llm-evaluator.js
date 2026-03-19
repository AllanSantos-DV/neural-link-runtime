/**
 * LLM fallback evaluator for inconclusive scores.
 * 
 * When a handler's score falls in the "uncertain zone" (near threshold),
 * this module can optionally consult an LLM for disambiguation.
 * 
 * Design: pluggable — works with any HTTP API that accepts a prompt
 * and returns text. Configuration via neural-link.config.json.
 * 
 * Cache: same (event_type, agent, tool, cmdClass) tuple → cache 5 min.
 * Fallback: if LLM unavailable or times out → no adjustment.
 */

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const _cache = new Map();

/** Default LLM config */
const DEFAULTS = {
  enabled: false,
  margin: 0.1,        // score within ±margin of threshold → inconclusive
  timeout: 2000,      // max ms to wait for LLM response
  adjustment: 0.1,    // how much to nudge score up/down based on LLM
  endpoint: null,     // HTTP endpoint URL
  model: null,        // model name (passed in request)
  apiKey: null,       // auth key (from env var name, not raw key)
};

/**
 * Check if a score is inconclusive (near threshold).
 */
export function isInconclusive(score, threshold, margin) {
  return Math.abs(score - threshold) <= margin;
}

/**
 * Build cache key from context.
 */
function cacheKey(context, handlerName) {
  return `${context.event_type}|${context.agent}|${context.tool_name || ''}|${handlerName}`;
}

/**
 * Query LLM for disambiguation.
 * Returns adjustment: positive (should activate), negative (should not), or 0 (no opinion).
 */
export async function queryLLM(context, handlerName, score, config) {
  const llmConfig = { ...DEFAULTS, ...config };
  if (!llmConfig.enabled || !llmConfig.endpoint) return 0;

  // Check cache
  const key = cacheKey(context, handlerName);
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.adjustment;
  }

  const prompt = buildPrompt(context, handlerName, score);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), llmConfig.timeout);

    const apiKey = llmConfig.apiKey ? process.env[llmConfig.apiKey] : null;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const body = JSON.stringify({
      model: llmConfig.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a security evaluator for code agent hooks. Answer ONLY with: ACTIVATE, SKIP, or UNSURE.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 10,
      temperature: 0,
    });

    const response = await fetch(llmConfig.endpoint, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) return 0;
    const data = await response.json();
    const answer = (data.choices?.[0]?.message?.content || '').trim().toUpperCase();

    let adjustment = 0;
    if (answer.includes('ACTIVATE')) adjustment = llmConfig.adjustment;
    else if (answer.includes('SKIP')) adjustment = -llmConfig.adjustment;

    // Cache result
    _cache.set(key, { ts: Date.now(), adjustment });
    return adjustment;
  } catch {
    return 0; // Timeout or error → no adjustment
  }
}

/**
 * Build a concise prompt for the LLM evaluator.
 */
function buildPrompt(context, handlerName, score) {
  const parts = [
    `Hook handler: ${handlerName}`,
    `Event: ${context.event_type}`,
    `Agent: ${context.agent}`,
  ];
  if (context.tool_name) parts.push(`Tool: ${context.tool_name}`);
  if (context.command) parts.push(`Command: ${context.command}`);
  parts.push(`Current score: ${score.toFixed(3)} (threshold ~0.5)`);
  parts.push('Should this handler activate for this context? Answer: ACTIVATE, SKIP, or UNSURE.');
  return parts.join('\n');
}

/**
 * Apply LLM fallback to scored handlers.
 * Modifies scores in-place for inconclusive handlers.
 */
export async function applyLLMFallback(scored, context, config) {
  const llmConfig = { ...DEFAULTS, ...(config.learning?.llmFallback || {}) };
  if (!llmConfig.enabled) return;

  const threshold = config.threshold || 0.5;
  const margin = llmConfig.margin;

  const promises = scored
    .filter(s => isInconclusive(s.score, threshold, margin))
    .map(async (s) => {
      const adj = await queryLLM(context, s.name, s.score, llmConfig);
      if (adj !== 0) {
        s.score = Math.max(0, Math.min(1, s.score + adj));
      }
    });

  await Promise.all(promises);
}

/** Reset cache — for testing */
export function _resetLLMCache() {
  _cache.clear();
}
