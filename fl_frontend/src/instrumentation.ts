/**
 * APP · instrumentation
 *
 * Next's instrumentation entry point: the startup environment gate and the server error hook.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • This file lives in `src/`, never the repo root. Both compile; only `src/` is traced into
 *     `output: "standalone"`, so from the root neither `register()` nor `onRequestError` runs in the
 *     container — and nothing reports that they did not.
 *   • The runtime guard excludes Edge rather than requiring Node. `NEXT_RUNTIME` is unset in the
 *     standalone server, so a `!== "nodejs"` test returns early and validates nothing.
 *   • Importing `core/config` *is* the gate. Do not wrap it in `try`/`catch` — the failure happens
 *     while Next loads the module, before `register()` is entered.
 */

import type { onRequestError as logRequestErrorImpl } from "./core/instrumentation";

/**
 * A guarded wrapper, not a re-export. A static `export { onRequestError } from ...` puts
 * `core/instrumentation.ts` — and through it the logger's `process.stdout` write — into the EDGE
 * instrumentation bundle, where the bundler warns on every request that a Node API is unsupported.
 * The conditional dynamic import is the documented pattern for runtime-specific instrumentation
 * (https://nextjs.org/docs/app/guides/instrumentation); the guard excludes Edge rather than
 * requiring Node for the reason in note 2 below. The type-only import above is erased at compile,
 * so it cannot drag the module back into the Edge graph.
 */
export async function onRequestError(...args: Parameters<typeof logRequestErrorImpl>) {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { onRequestError: logRequestError } = await import("./core/instrumentation");
  return logRequestError(...args);
}

/**
 * Startup environment gate (R3b §S10.3).
 *
 * `SKIP_ENV_VALIDATION=true` is set in the Docker builder stage only, so the runner does validate --
 * but only on the first import of `config.ts`, which is whichever request first needs it. The
 * container's healthcheck hits `/favicon.ico` and never touches config, so a truncated API key or a
 * typo'd admin email produced a green build, a green image and a healthy-looking container that
 * 500s on real traffic.
 *
 * **Three things had to be true for this to work, and each was measured against a built image.**
 * They are recorded because every one of them fails silently:
 *
 *  1. This file must live in `src/`, not the repo root. Both locations compile, but only `src/`
 *     is traced into `output: "standalone"` -- from the root, `.next/server/instrumentation.js`
 *     is built and then simply not copied, so `register()` never runs in the container. That also
 *     silently disabled `onRequestError` above, i.e. all server error logging in production.
 *  2. The runtime guard must exclude Edge rather than require Node. `NEXT_RUNTIME` is **unset**
 *     in the standalone server, so `!== "nodejs"` returned early and validated nothing.
 *  3. The container does **not** exit on failure, and trying to force that is not worth it. Next
 *     reports `Failed to prepare server` and keeps the process alive. What it does not do is
 *     serve: every route, `/favicon.ico` included, returns 500. Measured end to end -- the Compose
 *     healthcheck therefore fails, the frontend never becomes `service_healthy`, and nginx (which
 *     `depends_on` it) never starts. The stack fails closed with the variable name in the log
 *     within a second of boot, which is what R3b §S10.3 actually asked for.
 *
 * A `try/catch` here would not help: the failure happens while Next loads this module, before
 * `register()` is entered.
 */
export async function register() {
  // Skip only the Edge runtime, where the Node-only config module cannot load. See note 2 above.
  if (process.env.NEXT_RUNTIME === "edge") return;

  // Importing it *is* the gate. config.ts's onValidationError has already reduced the message to
  // variable NAMES, never values -- verified against a built image, including for a truncated key.
  const { frontend_config } = await import("./core/config");

  // In the JSON format, everything that reaches console.* -- above all Next's own multi-line
  // `⨯ Error` dumps -- is wrapped into the same one-document-per-line envelope the logger writes
  // (ADR-0039). Installed here so it is in place before the first request can error.
  if (frontend_config.LOG_FORMAT === "json") {
    const { installConsoleShim } = await import("./core/consoleShim");
    installConsoleShim();
  }
}
