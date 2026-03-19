/**
 * Feedback capture for the learning loop.
 * 
 * Derives reward signals from handler execution results
 * and feeds them to the learner for weight updates.
 * 
 * Reward signals (Phase 1 — observable without user input):
 *   +1.0  handler blocked and hook returned non-empty output (useful block)
 *   +0.7  handler activated and returned structured decision (did something)
 *   +0.3  handler activated but returned empty/allow (ran but no-op)
 *   +0.0  no signal (handler not in active set — don't update)
 * 
 * Phase B3: PostToolUse error detection
 *   Detects error patterns in tool_response. When a tool fails after
 *   being allowed, handlers that listen to PreToolUse get a weak negative
 *   signal (encouraging slightly higher scores next time).
 */

import { extractFeatures, classifyCommand } from './features.js';
import { getLearner } from './learner.js';

// Error patterns in tool_response
const ERROR_PATTERNS = /\berror\b|\bfailed\b|\bfailure\b|\bexit code [1-9]|\bEXIT_FAILURE\b|\bENOENT\b|\bEACCES\b|\bcommand not found\b|\bPermission denied\b|\bfatal:/i;

/**
 * Check if a tool response indicates an error.
 */
export function detectToolError(toolResponse) {
  if (!toolResponse) return false;
  const text = typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse);
  return ERROR_PATTERNS.test(text);
}

/**
 * Process feedback from execution results.
 * Called after compositor, before returning output.
 * 
 * @param {object} context - Enriched context from sensor
 * @param {Array} scored - All scored handlers (active + inactive)
 * @param {Array} results - Execution results from active handlers
 * @param {object} learningConfig - Learning config from neural-link.config.json
 */
export function processFeedback(context, scored, results, learningConfig) {
  const learner = getLearner(learningConfig);
  const features = extractFeatures(context);

  for (const s of scored) {
    const result = results.find(r => r.name === s.name);

    if (result) {
      // Handler was active — derive reward from output
      const reward = deriveReward(result);
      learner.update(s.name, features.vector, reward);
    }
    // If handler was scored but NOT active (below threshold),
    // we don't update — absence of activation is not a signal.
  }

  // Fire-and-forget save (every N events to minimize I/O)
  const totalActivations = Object.values(learner.activations)
    .reduce((a, b) => a + b, 0);
  if (totalActivations % 50 === 0) {
    learner.save().catch(() => {});
  }
}

/**
 * Process PostToolUse feedback — retroactive signal.
 * When a tool fails after being allowed, handlers that guard PreToolUse
 * get a weak positive signal (they should have been more cautious).
 * 
 * @param {object} context - PostToolUse context with tool_response
 * @param {object} config - Full config to find PreToolUse handlers
 * @param {object} learningConfig - Learning config
 */
export function processPostToolFeedback(context, config, learningConfig) {
  if (context.event_type !== 'PostToolUse') return;
  if (!detectToolError(context.tool_response)) return;

  const learner = getLearner(learningConfig);
  const features = extractFeatures(context);

  // Find handlers that listen to PreToolUse — they guard tool execution
  for (const [name, handler] of Object.entries(config.handlers)) {
    if (!handler.enabled) continue;
    if (!handler.events.includes('PreToolUse')) continue;

    // Weak positive reward: this handler should have been more active
    // 0.6 = slightly above neutral (0.5), nudging towards activation
    learner.update(name, features.vector, 0.6);
  }
}

/**
 * Detect false negatives — handlers that should have activated but didn't.
 * 
 * Heuristic 1: Destructive command was allowed (no block/deny)
 *   → nudge pre-commit-guard-like handlers upward
 * 
 * Heuristic 2: Handler had score > 0 but < threshold (near miss)
 *   + PostToolUse shows error → weak positive signal
 * 
 * @param {object} context - Current context
 * @param {Array} scored - All scored handlers
 * @param {Array} active - Handlers that passed threshold
 * @param {object} config - Full config
 * @param {object} learningConfig - Learning config
 */
export function detectFalseNegatives(context, scored, active, config, learningConfig) {
  const learner = getLearner(learningConfig);
  const features = extractFeatures(context);
  const threshold = config.threshold || 0.5;

  // Heuristic 1: Destructive command passed without block
  if (context.event_type === 'PreToolUse' && context.command) {
    const cmdClasses = classifyCommand(context.command);
    const isDestructive = cmdClasses.some(c =>
      c === 'git_destructive' || c === 'git_force' || c === 'fs_destructive'
    );

    if (isDestructive) {
      const wasBlocked = active.some(a => {
        const s = scored.find(sc => sc.name === a.name);
        return s && (s.handler.events || []).includes('PreToolUse');
      });

      if (!wasBlocked) {
        // Destructive cmd passed — nudge PreToolUse guards
        for (const s of scored) {
          if (!s.handler.events.includes('PreToolUse')) continue;
          if (s.score > 0 && s.score < threshold) {
            // Near miss — handler was close to activating
            learner.update(s.name, features.vector, 0.7);
          }
        }
      }
    }
  }

  // Heuristic 2: Near-miss handlers (scored > 0 but < threshold)
  // Only apply when there's evidence something went wrong (PostToolUse error)
  if (context.event_type === 'PostToolUse' && detectToolError(context.tool_response)) {
    for (const s of scored) {
      if (s.score > 0 && s.score < threshold) {
        learner.update(s.name, features.vector, 0.65);
      }
    }
  }
}

/**
 * Derive reward signal from handler execution result.
 */
function deriveReward(result) {
  const decision = result.result?.decision
    ?? result.result?.hookSpecificOutput?.permissionDecision
    ?? 'allow';

  // Block/deny with reason = handler actively prevented something
  if ((decision === 'block' || decision === 'deny') && result.result?.reason) {
    return 1.0;
  }

  // Block/deny without reason = handler blocked but we're less sure why
  if (decision === 'block' || decision === 'deny') {
    return 0.8;
  }

  // Ask = handler flagged for review — useful but softer signal
  if (decision === 'ask') {
    return 0.7;
  }

  // Add with content = handler contributed content (e.g. lesson-injector)
  if (decision === 'add' && result.result?.content) {
    return 0.8;
  }

  // Allow with non-empty hookSpecificOutput = handler ran and produced metadata
  if (decision === 'allow' && result.result?.hookSpecificOutput
      && Object.keys(result.result.hookSpecificOutput).length > 0) {
    return 0.5;
  }

  // Allow with nothing = handler ran but was effectively no-op
  return 0.3;
}

export { deriveReward };
