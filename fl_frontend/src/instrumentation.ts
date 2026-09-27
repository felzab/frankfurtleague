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
  // Excludes Edge rather than requiring Node: the build writes each runtime's name over the
  // variable, but the suite runs this source where nothing does, so a `!== "nodejs"` test would
  // boot nothing there.
  if (process.env.NEXT_RUNTIME === "edge") return;

  // Every Node API stays in that module: the Edge compile still reads this file, and flags one
  // spelled here even past the return above.
  const { registerOnNode } = await import("./instrumentation-node");
  await registerOnNode();
}
