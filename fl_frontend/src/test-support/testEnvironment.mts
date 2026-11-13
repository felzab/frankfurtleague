/**
 * The environment every test runs under, which `fl_frontend/vitest.config.mts` hands the runner, read by
 * `fl_frontend/src/core/config.ts` as a deployment's would be: no variable a deployment sets reaches a test. Held here so
 * the helpers serving these addresses read the one value the config does.
 */
export const TEST_ENVIRONMENT = {
  SKIP_ENV_VALIDATION: "true",
  // Where `fl_frontend/src/test-support/backend.ts` serves the backend.
  API_URL: "http://backend.test",
  // The origin a test request arrives at (`fl_frontend/src/test-support/authDoubles.ts :: ORIGIN`).
  AUTH_URL: "http://localhost:3000",
  // The local stack's, under which no mail reaches the provider.
  APP_ENV: "local",
} as const;
