import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const LOG_DIR = join(homedir(), '.copilot', 'neural-link', 'logs');

/**
 * Fire-and-forget logging. Never blocks, never throws.
 */
export function logActivation(context, active, results, output) {
  try {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const filePath = join(LOG_DIR, `${dateStr}.jsonl`);

    const entries = results.map(r => {
      const matching = active.find(a => a.name === r.name);
      const declarative = matching?.declarativeScore ?? 0;
      const final = matching?.score ?? 0;
      const learningActive = declarative !== final;
      return JSON.stringify({
        ts: now.toISOString(),
        event: context.event_type,
        agent: context.agent,
        handler: r.name,
        score_declarative: declarative,
        score_final: final,
        learning_active: learningActive,
        features_names: matching?.features?.names ?? [],
        decision: r.result.decision,
        modifiers_applied: matching?.handler.modifiers
          ?.map(m => m.condition) ?? [],
        cwd: context.cwd || null,
        sessionId: context.sessionId || null,
      });
    });

    const content = entries.join('\n') + '\n';

    // Fire-and-forget: ensure dir exists, then append
    mkdir(LOG_DIR, { recursive: true })
      .then(() => appendFile(filePath, content))
      .catch(() => { /* logging failure is non-critical */ });
  } catch {
    // Logging must never interfere with the response
  }
}
