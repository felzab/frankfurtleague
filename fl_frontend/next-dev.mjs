// Not `node --env-file-if-exists`: `next dev` passes its own node flags to its server through
// NODE_OPTIONS, where Node refuses that one. Set variables win, so the root's value reaches Next
// ahead of `fl_frontend/.env`'s (`docs/ops/spec.md :: I429`).
try {
  process.loadEnvFile("../.env");
} catch (error) {
  // A machine may hold the keys in its shell instead, and the boot gate names any still missing.
  if (error?.code !== "ENOENT") throw error;
}

// In this process rather than a child, so Ctrl-C and the exit status are Next's own; its CLI parses
// `process.argv`, which this script's own arguments already are.
await import("next/dist/bin/next");
