import { extractFeatures } from './features.js';
import { getLearner } from './learner.js';
import { hasFileReferences, hasConfidenceTable, hasSkillRead } from './transcript.js';

/**
 * Score handlers against the current context.
 * Combines declarative scoring (weights + modifiers) with learned scoring.
 * Returns array of { name, handler, score, features } for all eligible handlers.
 */
export function scoreHandlers(context, config) {
  const results = [];
  const learningConfig = config.learning || {};
  const learner = getLearner(learningConfig, context.cwd);
  learner.load(context.cwd);
  const features = extractFeatures(context);

  for (const [name, handler] of Object.entries(config.handlers)) {
    if (!handler.enabled) continue;
    if (!handler.events.includes(context.event_type)) continue;

    const defaultWeight = learningConfig.defaultWeight ?? 0.55;
    let declarativeScore = handler.weight ?? defaultWeight;

    for (const mod of handler.modifiers) {
      if (evaluateCondition(mod.condition, context)) {
        declarativeScore = applyAdjust(declarativeScore, mod.adjust);
      }
    }
    declarativeScore = Math.max(0.0, Math.min(1.0, declarativeScore));

    // Combined score: only mix when declarative is non-zero.
    // If a modifier explicitly zeroed the score (=0.0), the handler is
    // irrelevant for this context — the learner must not resurrect it.
    let score;
    if (declarativeScore === 0.0) {
      score = 0.0;
    } else {
      score = learner.combine(name, declarativeScore, features.vector);
    }

    results.push({ name, handler, score, declarativeScore, features });
  }

  return results;
}

/**
 * Filter scored handlers by threshold.
 * Includes ε-greedy exploration: with probability epsilon, one below-threshold
 * handler is included to collect data and prevent cold lock.
 */
export function filterByThreshold(scored, config) {
  const active = scored.filter(s => {
    const threshold = s.handler.threshold ?? config.threshold;
    return s.score >= threshold;
  });

  // ε-greedy exploration
  const epsilon = config.learning?.epsilon ?? 0.05;
  if (Math.random() < epsilon) {
    const belowThreshold = scored.filter(s => !active.includes(s));
    if (belowThreshold.length > 0) {
      // Pick the one closest to threshold (most likely to be useful)
      belowThreshold.sort((a, b) => b.score - a.score);
      active.push({ ...belowThreshold[0], explorative: true });
    }
  }

  return active;
}

// --- Condition evaluator ---

function getField(ctx, field) {
  // Support dotted paths like tool_input.command
  const parts = field.split('.');
  let value = ctx;
  for (const p of parts) {
    if (value == null) return undefined;
    value = value[p];
  }
  return value;
}

const evaluators = {
  eq: (ctx, field, value) => String(getField(ctx, field)) === value,
  neq: (ctx, field, value) => String(getField(ctx, field)) !== value,
  command_matches: (ctx, pattern) => {
    const cmd = ctx.command || '';
    return new RegExp(pattern, 'i').test(cmd);
  },
  // Phase 2 — real transcript evaluators
  transcript_has_file_references: (ctx) => hasFileReferences(ctx.transcript_path),
  transcript_has_confidence_table: (ctx) => hasConfidenceTable(ctx.transcript_path),
  transcript_has_skill_read: (ctx) => hasSkillRead(ctx.transcript_path),
  // Conservative: without data, assume false
  active_skills_include: () => false,
};

// Patterns for condition parsing
const FUNC_CALL_RE = /^(\w+)\('([^']*)'\)$/;
const FUNC_EQ_FALSE_RE = /^(\w+)\s*==\s*false$/;
const FUNC_EQ_TRUE_RE = /^(\w+)\s*==\s*true$/;
const FIELD_EQ_RE = /^(\w+(?:\.\w+)*)\s*==\s*'([^']*)'$/;
const FIELD_NEQ_RE = /^(\w+(?:\.\w+)*)\s*!=\s*'([^']*)'$/;

/**
 * Evaluate a condition expression against context.
 * Supports compound conditions with &&.
 */
export function evaluateCondition(condition, context) {
  // Support && compound conditions
  if (condition.includes('&&')) {
    const parts = condition.split('&&').map(s => s.trim());
    return parts.every(part => evaluateSingle(part, context));
  }
  return evaluateSingle(condition, context);
}

function evaluateSingle(expr, ctx) {
  let match;

  // function('arg') — e.g. command_matches('git (push|tag)')
  match = expr.match(FUNC_CALL_RE);
  if (match) {
    const [, fn, arg] = match;
    if (evaluators[fn]) return evaluators[fn](ctx, arg);
    return false;
  }

  // function == false — e.g. transcript_has_file_references == false
  match = expr.match(FUNC_EQ_FALSE_RE);
  if (match) {
    const [, fn] = match;
    if (evaluators[fn]) return !evaluators[fn](ctx);
    return true; // unknown function == false → true (conservative)
  }

  // function == true
  match = expr.match(FUNC_EQ_TRUE_RE);
  if (match) {
    const [, fn] = match;
    if (evaluators[fn]) return evaluators[fn](ctx);
    return false;
  }

  // field == 'value'
  match = expr.match(FIELD_EQ_RE);
  if (match) {
    const [, field, value] = match;
    return evaluators.eq(ctx, field, value);
  }

  // field != 'value'
  match = expr.match(FIELD_NEQ_RE);
  if (match) {
    const [, field, value] = match;
    return evaluators.neq(ctx, field, value);
  }

  // Unknown expression → false (conservative)
  return false;
}

/**
 * Apply score adjustment.
 */
function applyAdjust(score, adjust) {
  const op = adjust[0];
  const value = parseFloat(adjust.slice(1));

  if (op === '+') return score + value;
  if (op === '-') return score - value;
  if (op === '*') return score * value;
  if (op === '=') return value;

  return score;
}
