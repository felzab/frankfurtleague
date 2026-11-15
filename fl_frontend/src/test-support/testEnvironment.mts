import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The secret files a test run reads, by the file name `fl_frontend/src/core/config.ts` reads each under: plainly test
 * values, never a credential's shape. The others are absent, which the config reads as unset.
 */
export const TEST_SECRETS = {
  auth_secret: "fabricated-test-secret-not-a-credential",
  internal_api_key_base: "fabricated-base-not-a-credential",
  internal_api_key_system: "fabricated-system-not-a-credential",
  internal_api_key_admin: "fabricated-admin-not-a-credential",
} as const;

/**
 * Where the run's secret files are written: a directory of this run's own, named by the runner's main process, which
 * `setup` writes before any test file loads and `teardown` removes, so two runs on one machine never share one. A test
 * reads it as `process.env.SECRETS_DIR`, which the runner hands it: in a worker, this module names the worker's own
 * process instead.
 */
const SECRETS_DIR = join(tmpdir(), `fl-frontend-test-secrets-${String(process.pid)}`);

/**
 * The environment every test runs under, which `fl_frontend/vitest.config.mts` hands the runner: every name the real
 * `fl_frontend/src/core/config.ts` reads is set here, so none the shell sets reaches it. Held here so the helpers
 * serving these addresses read the one value the config does.
 */
export const TEST_ENVIRONMENT = {
  SKIP_ENV_VALIDATION: "true",
  SECRETS_DIR,
  // Where `fl_frontend/src/test-support/backend.ts` serves the backend.
  API_URL: "http://backend.test",
  // The origin a test request arrives at (`fl_frontend/src/test-support/authDoubles.ts :: ORIGIN`).
  AUTH_URL: "http://localhost:3000",
  // The local stack's, under which no mail reaches the provider.
  APP_ENV: "local",
  // Empty reads as unset, as a build handed no version does.
  APP_VERSION: "",
  RESTORE_HOLD: "off",
  // Cloudflare's published site key that passes every visitor (https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
} as const;

/** Writes the run's secret files, as Vitest's `globalSetup` runs it once before any test file. */
export function setup(): void {
  mkdirSync(SECRETS_DIR, { recursive: true });
  for (const [file, value] of Object.entries(TEST_SECRETS)) writeFileSync(join(SECRETS_DIR, file), value);
}

/** Removes the run's secret files once every test file has run. */
export function teardown(): void {
  rmSync(SECRETS_DIR, { recursive: true, force: true });
}
