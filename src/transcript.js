/**
 * Transcript parser for neural-link evaluators.
 * 
 * Reads the VS Code Copilot transcript JSON and provides
 * boolean queries used by scoring condition evaluators.
 * 
 * Transcript is a JSON file at the path from stdin `transcript_path`.
 * Parsed once per dispatch cycle and cached by path.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB safety limit

// Cache: one transcript per dispatch (same path in a single invocation)
let _cache = { path: null, data: null };

/**
 * Parse transcript from disk. Returns array of entries or null on failure.
 * Cached by path — safe to call multiple times per dispatch.
 */
export function parseTranscript(transcriptPath) {
  if (!transcriptPath) return null;
  if (_cache.path === transcriptPath) return _cache.data;

  try {
    if (!existsSync(transcriptPath)) return null;
    const stat = statSync(transcriptPath);
    if (stat.size > MAX_SIZE) return null;

    const raw = readFileSync(transcriptPath, 'utf-8');
    const data = JSON.parse(raw);
    _cache = { path: transcriptPath, data };
    return data;
  } catch {
    return null;
  }
}

// Patterns for file path detection
const FILE_PATH_RE = /(?:\/[\w.-]+){2,}|[A-Z]:\\[\w\\.-]+|\b[\w.-]+\.(?:js|ts|py|md|json|yaml|yml|html|css|sh|ps1|mjs|cjs|jsx|tsx)\b/i;

// Patterns for confidence table detection
const CONFIDENCE_RE = /[\u{1F7E1}\u{1F534}\u{1F7E2}]|confidence\s*(?:table|level|score|rating|assessment)/iu;

// Patterns for skill read detection
const SKILL_READ_RE = /SKILL\.md|read_file.*skill|skill.*read/i;

/**
 * Extract all text content from a transcript structure.
 * Handles both array-of-objects and nested formats.
 */
function extractText(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return data.map(extractText).join('\n');
  if (typeof data === 'object') {
    // Common fields in transcript entries
    const parts = [];
    for (const key of ['content', 'text', 'message', 'value', 'output', 'result', 'prompt']) {
      if (data[key]) parts.push(extractText(data[key]));
    }
    // Recurse into children/entries/messages
    for (const key of ['children', 'entries', 'messages', 'turns']) {
      if (Array.isArray(data[key])) parts.push(extractText(data[key]));
    }
    return parts.join('\n');
  }
  return String(data);
}

/**
 * Check if transcript contains file path references.
 */
export function hasFileReferences(transcriptPath) {
  const data = parseTranscript(transcriptPath);
  if (!data) return true; // conservative: assume yes when unknown
  const text = extractText(data);
  return FILE_PATH_RE.test(text);
}

/**
 * Check if transcript contains a confidence table/assessment.
 */
export function hasConfidenceTable(transcriptPath) {
  const data = parseTranscript(transcriptPath);
  if (!data) return true; // conservative
  const text = extractText(data);
  return CONFIDENCE_RE.test(text);
}

/**
 * Check if transcript shows the agent read a SKILL.md file.
 */
export function hasSkillRead(transcriptPath) {
  const data = parseTranscript(transcriptPath);
  if (!data) return true; // conservative
  const text = extractText(data);
  return SKILL_READ_RE.test(text);
}

/** Reset cache — for testing */
export function _resetTranscriptCache() {
  _cache = { path: null, data: null };
}
