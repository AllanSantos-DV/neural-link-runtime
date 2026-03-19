/**
 * Session tracker — tracks hook decisions within a session
 * for override detection (Phase 2 feedback).
 * 
 * Detects when a user retries a command after it was blocked,
 * indicating the handler was too aggressive (negative reward).
 * Also detects when a block is respected (positive reward).
 * 
 * In-memory only — resets when process ends (hooks are per-event).
 * Persists state to a temp file per session for cross-invocation tracking.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const MAX_HISTORY = 50;

/**
 * Get session state file path.
 */
function sessionFile(sessionId) {
  if (!sessionId) return null;
  // Sanitize sessionId for filesystem
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(tmpdir(), `neural-link-session-${safe}.json`);
}

/**
 * Load session history from disk.
 */
function loadSession(sessionId) {
  const path = sessionFile(sessionId);
  if (!path) return [];
  try {
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Save session history to disk.
 */
function saveSession(sessionId, history) {
  const path = sessionFile(sessionId);
  if (!path) return;
  try {
    // Keep only last N entries
    const trimmed = history.slice(-MAX_HISTORY);
    writeFileSync(path, JSON.stringify(trimmed));
  } catch {
    // Non-critical
  }
}

/**
 * Record a hook decision for a tool invocation.
 */
export function recordDecision(sessionId, entry) {
  if (!sessionId) return;
  const history = loadSession(sessionId);
  history.push({
    ts: Date.now(),
    handler: entry.handler,
    tool: entry.tool || null,
    command: entry.command || null,
    decision: entry.decision,
    commandClass: entry.commandClass || null,
  });
  saveSession(sessionId, history);
}

/**
 * Check if the current event is a retry of a previously blocked action.
 * Returns array of { handler, reward } signals.
 * 
 * Logic:
 * - If same tool+command was blocked and now appears again → override (-1.0)
 * - If a different command appears after block → block was respected (no signal)
 */
export function checkOverrides(sessionId, currentTool, currentCommand) {
  if (!sessionId) return [];
  const history = loadSession(sessionId);
  if (history.length === 0) return [];

  const signals = [];
  const normalizedCmd = (currentCommand || '').toLowerCase().trim();
  const recentBlocks = history.filter(h =>
    (h.decision === 'block' || h.decision === 'deny') &&
    h.tool === currentTool &&
    normalizedCmd &&
    h.command &&
    h.command.toLowerCase().trim() === normalizedCmd
  );

  for (const block of recentBlocks) {
    signals.push({
      handler: block.handler,
      reward: -1.0, // User overrode the block — handler was too aggressive
    });
  }

  return signals;
}

/**
 * Detect blocks that were accepted (respected).
 * Called at session end or periodically.
 * Returns handlers whose blocks were never retried → positive signal.
 */
export function detectRespectedBlocks(sessionId) {
  if (!sessionId) return [];
  const history = loadSession(sessionId);
  if (history.length === 0) return [];

  const blocks = history.filter(h => h.decision === 'block' || h.decision === 'deny');
  const signals = [];

  for (const block of blocks) {
    const wasRetried = history.some(h =>
      h.ts > block.ts &&
      h.tool === block.tool &&
      h.command &&
      block.command &&
      h.command.toLowerCase().trim() === block.command.toLowerCase().trim() &&
      h.decision !== 'block' && h.decision !== 'deny'
    );

    if (!wasRetried) {
      signals.push({
        handler: block.handler,
        reward: 1.0, // Block was respected
      });
    }
  }

  return signals;
}

/** For testing — clear a session file */
export function _clearSession(sessionId) {
  const path = sessionFile(sessionId);
  if (!path) return;
  try {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch {
    // Ignore
  }
}
