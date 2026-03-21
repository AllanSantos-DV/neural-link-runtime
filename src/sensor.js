/**
 * Parse stdin JSON and produce enriched context packet.
 * Event-agnostic: extracts known fields if present, ignores if not.
 *
 * Supports both VS Code Copilot nested format and flat format (backward compat).
 * Nested paths tried first, flat fallback second, null if neither.
 *
 *   agent: copilot_chat.agentName → agentName
 *   tool_name: toolCall.toolName → tool_name
 *   tool_input: toolCall.input → tool_input
 *   tool_use_id: toolCall.toolUseId → tool_use_id
 *   turn_number: copilot_chat.turnNumber
 *   Common: cwd, sessionId, timestamp, transcript_path, hook_event_name
 *   Stop/SubagentStop: stop_hook_active
 *   SubagentStart/Stop: agent_id, agent_type
 *   SessionStart: source
 *   UserPromptSubmit: prompt
 */
export function sense(stdinJson) {
  const toolInput = stdinJson.toolCall?.input ?? stdinJson.tool_input ?? null;
  const command = toolInput?.command ?? null;

  return {
    // Core identity
    event_type: stdinJson.event ?? stdinJson.hook_event_name ?? stdinJson.hookEventName ?? null,
    agent: stdinJson.copilot_chat?.agentName ?? stdinJson.agentName ?? stdinJson.agent_type ?? null,

    // Workspace & session (official VS Code fields)
    cwd: stdinJson.cwd ?? null,
    sessionId: stdinJson.session_id ?? stdinJson.sessionId ?? null,
    timestamp: stdinJson.timestamp ?? null,
    transcript_path: stdinJson.transcript_path ?? null,

    // Tool context (PreToolUse, PostToolUse) — nested (real VS Code) then flat (compat)
    tool_name: stdinJson.toolCall?.toolName ?? stdinJson.tool_name ?? null,
    tool_input: toolInput,
    command,
    tool_use_id: stdinJson.toolCall?.toolUseId ?? stdinJson.tool_use_id ?? null,
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

    // Turn context (from copilot_chat)
    turn_number: stdinJson.copilot_chat?.turnNumber ?? null,

    // Raw for passthrough
    raw: stdinJson,
  };
}
