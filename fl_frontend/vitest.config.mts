import { defineConfig } from "vitest/config";

export default defineConfig({
  // Vite 8 reads tsconfig's `@/*` paths itself, and its `"jsx": "react-jsx"` too, so neither
  // vite-tsconfig-paths nor @vitejs/plugin-react is needed.
  resolve: { tsconfigPaths: true },
  test: {
    // Read by `src/core/config.ts`: a test imports a module that reads the environment, and never
    // the variables a deployment sets.
    env: { SKIP_ENV_VALIDATION: "true" },
    setupFiles: ["src/test-support/setup.ts", "src/test-support/dom.ts"],
    // Node by default: most suites test server code. A file rendering into a document opts in with
    // `// @vitest-environment jsdom` (https://vitest.dev/guide/environment).
    environment: "node",
    environmentOptions: {
      // An address a page can read and rewrite, and a `requestAnimationFrame`, which react-aria's
      // focus scope calls as a dialog unmounts.
      jsdom: { url: "http://localhost/", pretendToBeVisual: true },
    },
    // The db project starts a mongod per file through testcontainers, whose first image pull takes
    // well past Vitest's default five seconds.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs", "eslint-rules/**/*.test.mjs"],
          exclude: ["src/**/*.db.test.ts"],
          // Off both clocks a formatter pins, Berlin's and UTC's: one that drops its `timeZone` prints the runtime's, so
          // `src/core/format.test.ts` can fail only under a third zone, on every machine. Forks take this, the pool Vitest
          // defaults to; worker threads ignore it
          // (https://vitest.dev/guide/common-errors#time-zone-does-not-change-in-worker-threads).
          env: { TZ: "America/New_York" },
        },
      },
      {
        extends: true,
        test: { name: "db", include: ["src/**/*.db.test.ts"] },
      },
    ],
  },
});
