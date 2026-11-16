import { defineConfig } from "vitest/config";

import { TEST_ENVIRONMENT } from "./src/test-support/testEnvironment.mts";

/**
 * The suites of code taking a production build's branch, which run under the `NODE_ENV` `next build` inlines and
 * nowhere else. A project setting none runs under the shell's `NODE_ENV`, or under `test`, which Vitest sets where
 * the shell sets none. A file's `.production.test.ts` infix selects this project.
 */
const PRODUCTION_BUILD = ["src/**/*.production.test.ts"];

/**
 * A case here waits on a replica set in a container and on bounds of its own past Vitest's five seconds; the slowest
 * took 10 s on an idle machine (2026-11-16). A transaction a case leaves open fails that case from
 * `src/test-support/replicaSet.ts`'s `afterEach`, which ends it, so no later case waits behind one. Each bound, a hook's
 * included, stays under half of MongoDB's one-minute transaction lifetime: a write or an index build behind a
 * transaction still open waits until it ends (https://www.mongodb.com/docs/manual/core/transactions-production-consideration/),
 * so a step waiting on one in its own case fails on Vitest's bound before the server's expiry frees it. A `beforeAll`
 * builds the sign-in store's indexes, asking again for any build the store answers past the client's three-second socket
 * bound. The replica set's start is bounded apart: each file awaits it at module level, where neither bound reaches
 * (`src/test-support/replicaSet.ts :: STARTED_WITHIN_MS`).
 */
const DB_TIER = { testTimeout: 30_000, hookTimeout: 30_000 };

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
          exclude: ["src/**/*.db.test.ts", ...PRODUCTION_BUILD],
          // Past Vitest's five seconds: a file's first case pays the cold import of every module it
          // loads, and in a whole run on a machine loaded by other work the slowest such case took
          // 11 s (2026-11-16). Hooks keep Vitest's ten.
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
        test: { name: "db", include: ["src/**/*.db.test.ts"], ...DB_TIER },
      },
    ],
  },
});
