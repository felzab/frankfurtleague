import { pathToFileURL } from "node:url";

// Relative to the working directory `pnpm dev` runs in, `fl_frontend/`: the checkout root's file,
// which holds the names both services share (`docs/ops/spec.md :: I429`).
export const ROOT_ENV_FILE = "../.env";

/**
 * Not `node --env-file-if-exists`: `next dev` passes its own node flags to its server through
 * NODE_OPTIONS, where Node refuses that one. Set variables win, so the root's value reaches Next
 * ahead of `fl_frontend/.env`'s.
 */
export function loadRootEnv(file = ROOT_ENV_FILE) {
  try {
    process.loadEnvFile(file);
  } catch (error) {
    // A machine may hold the keys in its shell instead, and the boot gate names any still missing.
    if (error?.code !== "ENOENT") throw error;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadRootEnv();
  // In this process rather than a child, so Ctrl-C and the exit status are Next's own; its CLI
  // parses `process.argv`, which this script's own arguments already are.
  await import("next/dist/bin/next");
}
