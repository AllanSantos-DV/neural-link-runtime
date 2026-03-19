/**
 * Parse stdin JSON and produce enriched context packet.
 * Event-agnostic: extracts known fields if present, ignores if not.
 *
 * Fields map to the official VS Code Copilot hook stdin JSON:
 *   Common: cwd, sessionId, timestamp, transcript_path, hookEventName
 *   PreToolUse/PostToolUse: tool_name, tool_input, tool_use_id, tool_response
 *   Stop/SubagentStop: stop_hook_active
 *   SubagentStart/Stop: agent_id, agent_type
 *   SessionStart: source
 *   UserPromptSubmit: prompt
 */
export function sense(stdinJson) {
  const toolInput = stdinJson.tool_input ?? null;
  const command = toolInput?.command ?? null;

  return {
    // Core identity
    event_type: stdinJson.event ?? stdinJson.hookEventName ?? null,
    agent: stdinJson.agentName ?? null,

    // Workspace & session (official VS Code fields)
    cwd: stdinJson.cwd ?? null,
    sessionId: stdinJson.sessionId ?? null,
    timestamp: stdinJson.timestamp ?? null,
    transcript_path: stdinJson.transcript_path ?? null,

    // Tool context (PreToolUse, PostToolUse)
    tool_name: stdinJson.tool_name ?? null,
    tool_input: toolInput,
    command,
    tool_use_id: stdinJson.tool_use_id ?? null,
    tool_response: stdinJson.tool_response ?? null,

    // Stop context
    stop_hook_active: stdinJson.stop_hook_active ?? false,

    // Subagent context
    agent_id: stdinJson.agent_id ?? null,
    agent_type: stdinJson.agent_type ?? null,

    // Session start
    source: stdinJson.source ?? null,

    // UserPromptSubmit
    prompt: stdinJson.prompt ?? null,
    chat_message: stdinJson.chatMessage ?? stdinJson.prompt ?? null,

    // Raw for passthrough
    raw: stdinJson,
  };
}
