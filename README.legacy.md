# Neural Link

Adaptive hook dispatcher for LLM agents. Neural Link sits between VS Code Copilot and your hook scripts, intelligently routing events through weighted handlers with adaptive scoring.

Instead of static hook configurations, Neural Link learns which handlers matter for each agent and context — scoring, composing, and dispatching in real time.

## Installation

### Via Skill Manager (recommended)

1. Open VS Code with the [Skill Manager](https://github.com/AllanSantos-DV/skill-repo) extension installed
2. In the Skill Manager sidebar, click **Add Repo**
3. Enter: `AllanSantos-DV/neural-link-runtime`
4. Click **Pull All** — Neural Link is deployed to `~/.copilot/neural-link/`

### Manual

```bash
# Clone
git clone https://github.com/AllanSantos-DV/neural-link-runtime.git ~/.copilot/neural-link

# Or use the install script
curl -fsSL https://raw.githubusercontent.com/AllanSantos-DV/neural-link-runtime/main/install.sh | bash
```

On Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/AllanSantos-DV/neural-link-runtime/main/install.ps1 | iex
```

## Requirements

- **Node.js** >= 18.0.0
- **VS Code** with GitHub Copilot
- Hook scripts installed at `~/.copilot/hooks/scripts/`

## Configuration

Neural Link loads config from the first file found (in order):

1. `.neural-link.config.json` in the workspace root (project-local)
2. `~/.copilot/neural-link.config.json` (global user config)
3. Bundled `neural-link.config.json` (defaults)

Key settings:

| Field | Type | Description |
|-------|------|-------------|
| `version` | `string` | Config format version (`"1.0"`) |
| `debug` | `boolean` | Dump stdin/stdout to debug directory |
| `threshold` | `number` | Global score threshold (0–1). Handlers below this are skipped |
| `defaultTimeout` | `number` | Max ms to wait for a handler response |
| `eventTimeouts` | `object` | Per-event timeout overrides (e.g. `{ "Stop": 12000 }`) |
| `handlers` | `object` | Handler definitions (see below) |
| `learning` | `object` | Adaptive scoring parameters |

### Handler definition

```json
{
  "my-handler": {
    "enabled": true,
    "events": ["PreToolUse", "Stop"],
    "script": {
      "bash": "~/.copilot/hooks/scripts/my-handler.sh",
      "windows": "$HOME\\.copilot\\hooks\\scripts\\my-handler.ps1"
    },
    "timeout": 5000,
    "threshold": null,
    "weight": 0.9,
    "modifiers": [
      {
        "condition": "tool_name == 'run_in_terminal'",
        "adjust": "+0.05"
      }
    ]
  }
}
```

### Learning section

```json
{
  "learning": {
    "lambda": 0.4,
    "defaultWeight": 0.55,
    "enableDefaultWeight": true,
    "learningRate": 0.01,
    "minActivations": 20,
    "epsilon": 0.05,
    "floors": { "pre-commit-guard": 0.8 },
    "ceilings": {}
  }
}
```

- `lambda` — decay rate for exponential moving average
- `defaultWeight` — initial weight for unknown handler pairs
- `learningRate` — how fast weights adjust from feedback
- `minActivations` — minimum activations before adaptive scoring kicks in
- `epsilon` — ε-greedy exploration rate (default `0.05`). With this probability, one below-threshold handler is included to collect data and prevent cold-lock
- `floors` / `ceilings` — hard bounds per handler (weight never goes below/above)

> **Scoring model:** Scoring is agent-agnostic — each handler carries a universal `weight` (instead of per-agent weight maps). Combined with ε-greedy exploration, this lets new handlers accumulate activations quickly regardless of which agent triggers them.

Config cascade: Skill Manager merges **bundled defaults → repo config templates → local weights**, so user overrides always win.

## Debug Mode

Set `"debug": true` in your config to dump all stdin and stdout payloads to:

```
~/.copilot/neural-link/debug/
```

Each file is named `{timestamp}_{event}_{in|out}.json`. You can toggle debug mode via the Skill Manager sidebar.

---

## Creating Your Own Runtime

Neural Link's architecture is open — you can build your own runtime that replaces or extends the default dispatcher. This section covers everything you need.

### Minimum Contract

Your runtime must have this directory structure:

```
your-runtime/
├── src/index.js              ← Entry point (required)
├── package.json              ← Must have a semver "version" field (required)
├── neural-link.config.json   ← Base config with handlers (required)
└── .skillmanager.json        ← Marks this as a Neural Link runtime (required)
```

The `.skillmanager.json` must contain:

```json
{
  "neuralLink": {
    "isRuntime": true,
    "configTemplate": "neural-link.config.json"
  }
}
```

### Entry Point Contract

`src/index.js` is the single entry point. VS Code Copilot invokes it via the bin shims (`bin/neural-link.sh` / `bin/neural-link.ps1`), which call `node src/index.js`.

Your entry point must:

1. **Read ALL stdin** as a UTF-8 string (piped, not interactive)
2. **Parse** the string as JSON
3. **Process** the hook event (run handlers, evaluate, compose)
4. **Write** a JSON result to **stdout** (and nothing else to stdout)
5. **Exit cleanly** with exit code 0
6. **Handle empty/invalid stdin gracefully** — silent exit (exit 0), no error output

Diagnostic logging goes to **stderr** (`console.error`), never stdout. Anything on stdout is parsed as the hook response.

### Stdin Payload Format

VS Code Copilot sends a JSON object via stdin. The fields vary by event type.

#### Common fields (all events)

| Field | Type | Description |
|-------|------|-------------|
| `hook_event_name` | `string` | Event type: `PreToolUse`, `PostToolUse`, `Stop`, etc. |
| `cwd` | `string` | Workspace directory path |
| `sessionId` | `string` | Current chat session ID |
| `timestamp` | `string` | ISO 8601 timestamp |
| `transcript_path` | `string` | Path to the conversation transcript file |

#### PreToolUse

Additional fields when a tool is about to be called:

| Field | Type | Description |
|-------|------|-------------|
| `tool_name` | `string` | Tool being invoked (e.g. `run_in_terminal`, `read_file`) |
| `tool_input` | `object` | Arguments passed to the tool |
| `tool_use_id` | `string` | Unique ID for this tool invocation |

#### PostToolUse

Same as PreToolUse, plus:

| Field | Type | Description |
|-------|------|-------------|
| `tool_response` | `object\|string` | The tool's return value |

#### Stop

| Field | Type | Description |
|-------|------|-------------|
| `stop_hook_active` | `boolean` | `true` if this is a re-entry (anti-loop guard — exit immediately) |

#### SubagentStart / SubagentStop

| Field | Type | Description |
|-------|------|-------------|
| `agent_id` | `string` | The sub-agent's identifier |
| `agent_type` | `string` | The sub-agent's type |

SubagentStop also includes `stop_hook_active`.

#### UserPromptSubmit

| Field | Type | Description |
|-------|------|-------------|
| `prompt` | `string` | The user's prompt text |
| `chatMessage` | `string` | The chat message (may differ from prompt) |

### Stdout Response Format

Your runtime writes a single JSON object to stdout. The format depends on the event type.

#### PreToolUse response

```json
{
  "hookSpecificOutput": {
    "permissionDecision": "allow",
    "permissionDecisionReason": "optional descriptive reason",
    "additionalContext": "optional reason string",
    "neural_link": {
      "version": "1.0",
      "event": "PreToolUse",
      "handlers_triggered": ["my-handler"],
      "scores": { "my-handler": 0.85 },
      "composition": { "final": "allow", "rule": "most_restrictive" }
    }
  }
}
```

`permissionDecision` values:
- `"allow"` — permit the tool call
- `"deny"` — block the tool call
- `"ask"` — prompt the user for confirmation

When the decision is `"ask"` or `"deny"`, the compositor propagates `permissionDecisionReason` so VS Code can display a descriptive reason in the confirmation prompt.

#### Stop response

```json
{
  "decision": "allow",
  "reason": "All checks passed",
  "hookSpecificOutput": {
    "decision": "allow",
    "reason": "All checks passed",
    "hookEventName": "Stop",
    "neural_link": { "..." }
  }
}
```

> **Note:** Stop events require `decision`/`reason` at **both** the top level and inside `hookSpecificOutput` for compatibility with workspace hooks and agent-scoped hooks.

#### UserPromptSubmit response

```json
{
  "content": "Additional context injected into the prompt",
  "hookSpecificOutput": {
    "neural_link": { "..." }
  }
}
```

#### Default / no opinion

Return an empty object to signal "no opinion" (defaults to allow):

```json
{}
```

### Composition Rules

When multiple handlers fire for the same event, Neural Link uses **most restrictive wins**:

```
deny/block > ask > allow
```

Reasons from all handlers are concatenated. The `neural_link` metadata in the response includes per-handler scores so you can audit which handler drove the decision.

The compositor (`src/compositor.js`) merges handler outputs and, for `PreToolUse` events, propagates `permissionDecisionReason` to the final payload so VS Code can show users why a tool call was flagged.

### Minimal "Hello World" Runtime

A complete `src/index.js` that reads stdin, logs the event to stderr, and allows everything:

```js
async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) process.exit(0);

  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }

  // Anti-loop guard
  if (input.stop_hook_active === true) process.exit(0);

  const event = input.hook_event_name || 'unknown';
  console.error(`[my-runtime] ${event}: ${input.tool_name || 'n/a'}`);

  // Allow everything
  console.log(JSON.stringify({}));
}
main().catch(() => process.exit(0));
```

Pair it with a minimal `package.json`:

```json
{
  "name": "my-neural-link-runtime",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.js",
  "engines": { "node": ">=18.0.0" }
}
```

And a minimal `neural-link.config.json`:

```json
{
  "version": "1.0",
  "threshold": 0.5,
  "defaultTimeout": 5000,
  "handlers": {}
}
```

### Distribution

To share your runtime with others:

1. **Host on GitHub** as a public repository
2. **Add `.skillmanager.json`** with `neuralLink.isRuntime: true` at the repo root
3. Users add your repo via **Skill Manager → Add Repo** (enter `owner/repo-name`)
4. **Pull All** deploys your runtime to `~/.copilot/neural-link/runtimes/`

Skill Manager handles versioning — it reads `package.json` version and only updates when the remote version is newer.

## License

MIT
