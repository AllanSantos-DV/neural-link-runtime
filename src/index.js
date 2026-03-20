import { dispatch } from './dispatcher.js';
import { loadConfig } from './config.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEBUG_DIR = join(homedir(), '.copilot', 'neural-link', 'debug');

function debugDump(raw, suffix) {
  try {
    const now = new Date();
    const ts = now.toISOString().replace(/:/g, '-').replace('Z', '').replace('.', '-');
    const eventMatch = raw.match(/"hook_event_name"\s*:\s*"([^"]+)"/);
    const event = eventMatch ? eventMatch[1] : 'unknown';
    const filePath = join(DEBUG_DIR, `${ts}_${event}_${suffix}.json`);
    mkdir(DEBUG_DIR, { recursive: true })
      .then(() => writeFile(filePath, raw))
      .catch(() => {});
  } catch {
    // Debug must never interfere with the main flow
  }
}

async function main() {
  // Read all stdin as string
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();

  // Empty stdin → silent exit
  if (!raw) {
    process.exit(0);
  }

  const debug = loadConfig().debug === true;
  if (debug) debugDump(raw, 'in');

  let stdinJson;
  try {
    stdinJson = JSON.parse(raw);
  } catch {
    // Invalid JSON → silent exit (same as current hooks)
    process.exit(0);
  }

  // Anti-loop guard
  if (stdinJson.stop_hook_active === true) {
    process.exit(0);
  }

  const result = await dispatch(stdinJson);
  const output = JSON.stringify(result);

  if (debug) debugDump(output, 'out');

  process.stdout.write(output);
}

main().catch(() => {
  // Fail-open: any unhandled error → silent exit
  process.exit(0);
});
