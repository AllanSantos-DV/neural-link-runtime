const DECISION_RANK = { block: 3, deny: 3, ask: 2, allow: 1, add: 0 };

/**
 * Compose results from multiple handlers into a single response.
 * Strategy: most restrictive wins (block > ask > allow).
 */
export function compose(results, context) {
  if (results.length === 0) {
    return {};
  }

  // Normalize decisions: map permissionDecision → unified decision
  const normalized = results.map(r => ({
    ...r,
    effectiveDecision: getEffectiveDecision(r.result),
  }));

  // Most restrictive wins
  let finalDecision = 'allow';
  for (const r of normalized) {
    if (rank(r.effectiveDecision) > rank(finalDecision)) {
      finalDecision = r.effectiveDecision;
    }
  }

  // Map deny → block for final output
  if (finalDecision === 'deny') finalDecision = 'block';

  // Compose reasons
  const reasons = normalized
    .filter(r => r.result.reason)
    .map(r => `[${r.name}] ${r.result.reason}`);
  const composedReason = reasons.join('\n');

  // Merge hookSpecificOutputs from handlers
  let mergedHookOutput = {};
  for (const r of normalized) {
    if (r.result.hookSpecificOutput && typeof r.result.hookSpecificOutput === 'object') {
      mergedHookOutput = { ...mergedHookOutput, ...r.result.hookSpecificOutput };
    }
  }

  // Add Neural Link metadata
  const scores = {};
  const triggered = [];
  for (const r of normalized) {
    scores[r.name] = r.score;
    triggered.push(r.name);
  }

  mergedHookOutput.neural_link = {
    version: '1.0',
    event: context.event_type,
    agent: context.agent,
    handlers_evaluated: results.length,
    handlers_triggered: triggered,
    scores,
    composition: { final: finalDecision, rule: 'most_restrictive' },
  };

  // Build output — adapt format based on event type
  const isPreToolUse = context.event_type === 'PreToolUse';

  const output = {
    hookSpecificOutput: mergedHookOutput,
  };

  if (isPreToolUse) {
    // VS Code expects permissionDecision in hookSpecificOutput for PreToolUse
    const permMap = { block: 'deny', ask: 'ask', allow: 'allow' };
    output.hookSpecificOutput.permissionDecision = permMap[finalDecision] ?? finalDecision;
    if (composedReason) {
      output.hookSpecificOutput.additionalContext = composedReason;
    }
  } else {
    // Standard format for other events
    output.decision = finalDecision;
    if (composedReason) {
      output.reason = composedReason;
    }

    // P2: For Stop events, mirror decision/reason in hookSpecificOutput
    // VS Code treats custom agent Stop as SubagentStop, which expects top-level fields.
    // Best practice: include in BOTH levels for compatibility.
    if (context.event_type === 'Stop') {
      output.hookSpecificOutput.decision = finalDecision;
      if (composedReason) {
        output.hookSpecificOutput.reason = composedReason;
      }
      output.hookSpecificOutput.hookEventName = 'Stop';
    }
  }

  // P0: For UserPromptSubmit, collect and concatenate content from "add" handlers
  if (context.event_type === 'UserPromptSubmit') {
    const addContents = normalized
      .filter(r => r.effectiveDecision === 'add' && r.result.content)
      .map(r => r.result.content);
    if (addContents.length > 0) {
      output.content = addContents.join('\n\n');
    }
  }

  return output;
}

function getEffectiveDecision(result) {
  // Check permissionDecision first (PreToolUse handlers)
  const perm = result.hookSpecificOutput?.permissionDecision;
  if (perm) return perm;

  return result.decision ?? 'allow';
}

function rank(decision) {
  return DECISION_RANK[decision] ?? 0;
}
