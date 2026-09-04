import type { onRequestError as logRequestErrorImpl } from "./core/instrumentation";

/**
 * Guarded wrapper, not a re-export: a static re-export drags the logger's `process.stdout` write
 * into the EDGE bundle. Conditional dynamic import is the documented shape
 * (https://nextjs.org/docs/app/guides/instrumentation).
 */
export async function onRequestError(...args: Parameters<typeof logRequestErrorImpl>) {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { onRequestError: logRequestError } = await import("./core/instrumentation");
  return logRequestError(...args);
}

/**
 * Startup environment gate. This file must stay in `src/`: only `src/` is traced into
 * `output: "standalone"`, so from the repo root it builds, is never copied, and both hooks
 * silently stop running in the container.
 */
export async function register() {
  // Excludes Edge rather than requiring Node: NEXT_RUNTIME is unset in the standalone server, so a
  // `!== "nodejs"` test would return early and validate nothing.
  if (process.env.NEXT_RUNTIME === "edge") return;

  // Importing it *is* the gate — validation runs during this module load, before anything is served.
  const { frontend_config } = await import("./core/config");

  // Installed before the first request can error, so Next's own multi-line console dumps still
  // reach the log as one JSON document per line.
  if (frontend_config.LOG_FORMAT === "json") {
    const { installConsoleShim } = await import("./core/consoleShim");
    installConsoleShim();
  }

  // Compared to "on" rather than to "off": `SKIP_ENV_VALIDATION` skips the default with the rest of
  // the parse, so the value is undefined wherever the gate stands down and a negated test would arm
  // the sweep there.
  if (frontend_config.BEWERBUNG_SWEEP === "on") {
    const { armBewerbungSweep } = await import("./features/bewerbungen/sweep");
    armBewerbungSweep();
  }
}
