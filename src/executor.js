import { spawn } from 'node:child_process';
import { homedir } from 'node:os';

const isWindows = process.platform === 'win32';

/**
 * Execute active handlers in parallel.
 * Each handler receives the original stdin JSON via pipe.
 * Returns array of { name, score, result }.
 */
export async function executeHandlers(active, stdinJson, config) {
  const stdinStr = JSON.stringify(stdinJson);
  const eventType = stdinJson.event ?? '';

  const promises = active.map(({ name, handler, score }) => {
    const timeout = handler.timeout
      ?? config.eventTimeouts?.[eventType]
      ?? config.defaultTimeout;

    return runHandler(name, handler, stdinStr, timeout)
      .then(result => ({ name, score, result }));
  });

  return Promise.all(promises);
}

function resolvePath(scriptPath) {
  const home = homedir();
  return scriptPath
    .replace(/^\$HOME/, home)
    .replace(/^~/, home);
}

function runHandler(name, handler, stdinStr, timeout) {
  return new Promise(resolve => {
    const allowResult = { decision: 'allow', reason: '', hookSpecificOutput: {} };

    const scriptPath = isWindows
      ? resolvePath(handler.script.windows)
      : resolvePath(handler.script.bash);

    let child;
    try {
      if (isWindows) {
        child = spawn('powershell', [
          '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `& '${scriptPath}'`,
        ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      } else {
        child = spawn('bash', [scriptPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }
    } catch {
      resolve(allowResult);
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      if (!settled) {
        try { child.kill(); } catch { /* ignore */ }
        finish(allowResult);
      }
    }, timeout);

    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });

    child.on('error', () => finish(allowResult));

    child.on('close', () => {
      try {
        const parsed = JSON.parse(stdout.trim());
        finish(normalizeResult(parsed));
      } catch {
        // Non-JSON output or empty → allow
        finish(allowResult);
      }
    });

    // Pipe stdin to child
    try {
      child.stdin.write(stdinStr);
      child.stdin.end();
    } catch {
      // stdin write failure → allow
      finish(allowResult);
    }
  });
}

/**
 * Normalize handler output to a consistent shape.
 */
function normalizeResult(parsed) {
  const result = {
    decision: parsed.decision ?? 'allow',
    reason: parsed.reason ?? '',
    hookSpecificOutput: parsed.hookSpecificOutput ?? {},
  };
  if (parsed.content !== undefined) {
    result.content = parsed.content;
  }
  return result;
}
