/**
 * Feature extraction for contextual learning.
 * 
 * Extracts individual features and cross-features from context,
 * then hashes them into a fixed-size binary vector for the learner.
 * 
 * Design: Feature hashing (Weinberger et al., 2009) with FNV-1a.
 * Cross-features capture interactions (event×agent, agent×tool, etc.)
 * that single features miss.
 */

import { hasFileReferences, hasConfidenceTable, hasSkillRead } from './transcript.js';

const VECTOR_SIZE = 256;

/**
 * Extract feature vector from context.
 * Returns { vector: Uint8Array(VECTOR_SIZE), names: string[] }
 * where vector[i] = 1 if feature hashed to bucket i.
 * names is for debugging/logging only.
 */
export function extractFeatures(context) {
  const names = [];
  const vector = new Uint8Array(VECTOR_SIZE);

  // --- Individual features ---
  if (context.event_type) {
    names.push(`event:${context.event_type}`);
  }
  if (context.tool_name) {
    names.push(`tool:${context.tool_name}`);
  }

  // Stop hook active signal (discriminative for Stop events)
  if (context.stop_hook_active != null) {
    names.push(`stop_hook_active:${context.stop_hook_active}`);
  }

  // Tool input sub-fields (what kind of data the tool receives)
  if (context.tool_input && typeof context.tool_input === 'object') {
    for (const key of Object.keys(context.tool_input)) {
      names.push(`input_has:${key}`);
    }
  }

  // Command classification (semantic, not raw string)
  const cmdClass = classifyCommand(context.command);
  for (const cls of cmdClass) {
    names.push(`cmd:${cls}`);
  }

  // --- Cross-features (pairwise interactions) ---
  if (context.event_type && context.tool_name) {
    names.push(`${context.event_type}×${context.tool_name}`);
  }

  // --- Context-aware features (Phase B2) ---
  // Workspace identity
  if (context.cwd) {
    names.push(`workspace:${fnv1a(context.cwd) % 65536}`);
  }

  // Transcript-derived features
  const hasTranscript = !!context.transcript_path;
  names.push(`has_transcript:${hasTranscript}`);

  if (hasTranscript) {
    const fileRefs = hasFileReferences(context.transcript_path);
    const confTable = hasConfidenceTable(context.transcript_path);
    const skillRd = hasSkillRead(context.transcript_path);
    names.push(`has_file_refs:${fileRefs}`);
    names.push(`has_confidence_table:${confTable}`);
    names.push(`has_skill_read:${skillRd}`);

    // Cross-feature: event × has_transcript
    if (context.event_type) {
      names.push(`${context.event_type}×has_transcript:true`);
    }
  }

  // Hash all features into fixed-size vector
  for (const name of names) {
    const bucket = fnv1a(name) % VECTOR_SIZE;
    vector[bucket] = 1;
  }

  return { vector, names, size: VECTOR_SIZE };
}

/**
 * Classify a command into semantic categories.
 * Returns array of applicable categories.
 */
function classifyCommand(command) {
  if (!command) return [];

  const classes = [];
  const cmd = command.toLowerCase();

  // Git operations
  if (/\bgit\s/.test(cmd)) {
    classes.push('git');

    if (/git\s+(-[^\s]+\s+)*push\b/.test(cmd)) {
      classes.push('git_push');
      if (/--force/.test(cmd)) classes.push('git_force');
    }
    if (/git\s+(-[^\s]+\s+)*tag\b/.test(cmd)) classes.push('git_tag');
    if (/git\s+(-[^\s]+\s+)*commit\b/.test(cmd)) classes.push('git_commit');
    if (/git\s+(-[^\s]+\s+)*reset\s+--hard/.test(cmd)) classes.push('git_destructive');
    if (/git\s+(-[^\s]+\s+)*rebase\b/.test(cmd)) classes.push('git_rewrite');
    if (/git\s+(status|log|diff|show|branch)\b/.test(cmd)) classes.push('git_readonly');
    if (/git\s+(pull|fetch|clone)\b/.test(cmd)) classes.push('git_sync');
  }

  // Filesystem operations
  if (/\brm\s+.*-[rR]/.test(cmd) || /\brm\s+-[fFrR]{2}/.test(cmd)) {
    classes.push('fs_destructive');
  }
  if (/\brmdir\s+\/[sS]/.test(cmd) || /\bdel\s+\/[sS]/.test(cmd)) {
    classes.push('fs_destructive');
  }
  if (/\bformat\s+[a-zA-Z]:/.test(cmd) || /\bmkfs\b/.test(cmd)) {
    classes.push('fs_destructive');
  }

  // Package management
  if (/\b(npm|pnpm|yarn)\s+(install|add|remove)\b/.test(cmd)) classes.push('pkg_mgmt');

  // Build/test
  if (/\b(npm|pnpm|yarn)\s+(run|test|build)\b/.test(cmd)) classes.push('build_test');

  // Generic shell
  if (/\b(echo|cat|ls|dir|pwd|cd|type|head|tail)\b/.test(cmd)) classes.push('shell_readonly');

  return classes;
}

/**
 * FNV-1a hash (32-bit) — fast, good distribution, zero deps.
 */
function fnv1a(str) {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0; // FNV prime, keep as uint32
  }
  return hash;
}

export { VECTOR_SIZE, classifyCommand, fnv1a };
