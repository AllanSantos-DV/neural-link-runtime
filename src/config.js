import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);

let cached = null;

/**
 * Load config from (in order):
 * 1. .neural-link.config.json in cwd (workspace)
 * 2. ~/.copilot/neural-link.config.json (global)
 * 3. bundled neural-link.config.json (project root)
 */
export function loadConfig() {
  if (cached) return cached;

  const candidates = [
    join(process.cwd(), '.neural-link.config.json'),
    join(homedir(), '.copilot', 'neural-link.config.json'),
    join(projectRoot, 'neural-link.config.json'),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, 'utf-8');
        const config = JSON.parse(raw);
        validateConfig(config);
        cached = config;
        return cached;
      } catch {
        // Invalid config — try next candidate
        continue;
      }
    }
  }

  // Fallback: minimal allow-all config
  cached = {
    version: '1.0',
    threshold: 0.5,
    defaultTimeout: 5000,
    eventTimeouts: {},
    handlers: {},
  };
  return cached;
}

function validateConfig(config) {
  if (typeof config.threshold !== 'number') {
    throw new Error('threshold must be a number');
  }
  if (typeof config.defaultTimeout !== 'number') {
    throw new Error('defaultTimeout must be a number');
  }
  if (typeof config.handlers !== 'object' || config.handlers === null) {
    throw new Error('handlers must be an object');
  }
}

/** Reset cache — used in tests */
export function resetConfigCache() {
  cached = null;
}
