import { dispatch } from './dispatcher.js';

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

  process.stdout.write(output);
}

main().catch(() => {
  // Fail-open: any unhandled error → silent exit
  process.exit(0);
});
