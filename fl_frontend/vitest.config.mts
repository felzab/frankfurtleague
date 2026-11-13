import { defineConfig } from "vitest/config";

import { TEST_ENVIRONMENT } from "./src/test-support/testEnvironment.mts";

/**
 * The suites of code taking a production build's branch, which run under the `NODE_ENV` `next build` inlines and
 * nowhere else. A project setting none runs under the shell's `NODE_ENV`, or under `test`, which Vitest sets where
 * the shell sets none.
 */
const PRODUCTION_BUILD = [
  "src/instrumentation.test.ts",
  "src/core/logging.test.ts",
  "src/core/instrumentation.test.ts",
  "src/app/api/client-error/route.test.ts",
  "src/core/authLines.test.ts",
];

/** The suites of the server `next dev` builds, which run under the `NODE_ENV` it sets. */
const DEVELOPMENT_BUILD = ["src/instrumentation.development.test.ts"];

/** The database suites of the client `next dev` builds, which run under the `NODE_ENV` it sets. */
const DEVELOPMENT_BUILD_DB = ["src/core/db.development.db.test.ts"];

/**
 * A case here waits on a replica set in a container and on bounds of its own past Vitest's five seconds. The replica
 * set's start is bounded apart: each file awaits it at module level, where neither bound reaches
 * (`src/test-support/expiredTransactions.ts :: STARTED_WITHIN_MS`).
 */
const DB_TIER = { testTimeout: 120_000, hookTimeout: 120_000 };

export default defineConfig({
  // Vite 8 reads tsconfig's `@/*` paths itself, and its `"jsx": "react-jsx"` too, so neither
  // vite-tsconfig-paths nor @vitejs/plugin-react is needed.
  resolve: { tsconfigPaths: true },
  test: {
    // Read by `src/core/config.ts`, which every name here overrides the shell's value of.
    env: { ...TEST_ENVIRONMENT },
    // Writes the secret files `SECRETS_DIR` names, once for the run, before any worker starts
    // (https://vitest.dev/config/globalsetup).
    globalSetup: ["src/test-support/testEnvironment.mts"],
    setupFiles: ["src/test-support/setup.ts", "src/test-support/dom.ts"],
    // Node by default: most suites test server code. A file rendering into a document opts in with
    // `// @vitest-environment jsdom` (https://vitest.dev/guide/environment).
    environment: "node",
    environmentOptions: {
      // An address a page can read and rewrite, and a `requestAnimationFrame`, which react-aria's
      // focus scope calls as a dialog unmounts.
      jsdom: { url: "http://localhost/", pretendToBeVisual: true },
    },
    // Each project's name opens with its tier's, `unit` or `db`: the scripts in `package.json` the gate runs select a
    // tier by that prefix, so a project named otherwise would run nowhere. Each inherits the options above, `extends`
    // defaulting to `true` (https://vitest.dev/guide/projects).
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.{ts,tsx}", "eslint-rules/**/*.test.mjs"],
          exclude: ["src/**/*.db.test.ts", ...PRODUCTION_BUILD, ...DEVELOPMENT_BUILD],
          // Past Vitest's five seconds: the slowest case, `src/kit/Lineup.test.tsx`'s line-up of eleven,
          // took 6.5 s in a whole run on a loaded 16-core machine (2026-11). Four times that, rounded
          // up to the next ten seconds, as the workflow sets each job's `timeout-minutes`; hooks keep
          // Vitest's ten.
          testTimeout: 30_000,
          // Off both clocks a formatter pins, Berlin's and UTC's: one that drops its `timeZone` prints the runtime's, so
          // `src/core/format.test.ts` can fail only under a third zone, on every machine. Forks take this, the pool Vitest
          // defaults to; worker threads ignore it
          // (https://vitest.dev/guide/common-errors#time-zone-does-not-change-in-worker-threads).
          env: { TZ: "America/New_York" },
        },
      },
      {
        test: { name: "unit-production", include: PRODUCTION_BUILD, env: { NODE_ENV: "production" } },
      },
      {
        test: { name: "unit-development", include: DEVELOPMENT_BUILD, env: { NODE_ENV: "development" } },
      },
      {
        test: { name: "db", include: ["src/**/*.db.test.ts"], exclude: DEVELOPMENT_BUILD_DB, ...DB_TIER },
      },
      {
        test: { name: "db-development", include: DEVELOPMENT_BUILD_DB, env: { NODE_ENV: "development" }, ...DB_TIER },
      },
    ],
  },
});
