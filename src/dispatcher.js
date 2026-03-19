import { loadConfig } from './config.js';
import { sense } from './sensor.js';
import { scoreHandlers, filterByThreshold } from './scoring.js';
import { executeHandlers } from './executor.js';
import { compose } from './compositor.js';
import { logActivation } from './logger.js';
import { processFeedback, processPostToolFeedback, detectFalseNegatives } from './feedback.js';
import { recordDecision, checkOverrides } from './session-tracker.js';
import { extractFeatures } from './features.js';
import { getLearner } from './learner.js';
import { applyLLMFallback } from './llm-evaluator.js';

/**
 * Main dispatch function.
 * Orchestrates: sensor → scoring → threshold → executor → compositor → feedback.
 */
export async function dispatch(stdinJson) {
  const config = loadConfig();
  const context = sense(stdinJson);

  // Phase C1: Check for overrides (user retrying after block)
  try {
    const overrideSignals = checkOverrides(context.sessionId, context.tool_name, context.command);
    if (overrideSignals.length > 0) {
      const learner = getLearner(config.learning || {}, context.cwd);
      const features = extractFeatures(context);
      for (const signal of overrideSignals) {
        learner.update(signal.handler, features.vector, signal.reward);
      }
    }
  } catch {
    // Override detection failure is non-critical
  }

  const scored = scoreHandlers(context, config);

  // Phase D1: LLM fallback for inconclusive scores
  try {
    await applyLLMFallback(scored, context, config);
  } catch {
    // LLM failure is non-critical
  }

  const active = filterByThreshold(scored, config);

  if (active.length === 0) {
    return {};
  }

  const results = await executeHandlers(active, stdinJson, config);
  const output = compose(results, context);

  logActivation(context, active, results, output);

  // Phase C1: Record decisions for override detection
  try {
    for (const r of results) {
      const decision = r.result?.decision
        ?? r.result?.hookSpecificOutput?.permissionDecision
        ?? 'allow';
      recordDecision(context.sessionId, {
        handler: r.name,
        tool: context.tool_name,
        command: context.command,
        decision,
      });
    }
  } catch {
    // Non-critical
  }

  // Feed results back to learner (fire-and-forget)
  try {
    processFeedback(context, scored, results, config.learning || {});
  } catch {
    // Feedback failure must never block the response
  }

  // PostToolUse retroactive feedback (fire-and-forget)
  try {
    processPostToolFeedback(context, config, config.learning || {});
  } catch {
    // Non-critical
  }

  // Phase C2: False negative detection
  try {
    detectFalseNegatives(context, scored, active, config, config.learning || {});
  } catch {
    // Non-critical
  }

  return output;
}
