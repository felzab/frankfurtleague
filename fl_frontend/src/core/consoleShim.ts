/**
 * CORE · console shim
 *
 * Wraps `console.log`/`warn`/`error` so anything the application does NOT write through
 * `core/logging.ts` still lands in the stream as one JSON document per line. The writer this
 * exists for is Next itself: the framework prints every server error as a multi-line `⨯ Error [...]`
 * object dump via `console.error`, before `onRequestError` runs, and those dumps are what made the
 * production stream unparseable.
 *
 * Installed by `fl_frontend/src/instrumentation.ts :: register`, in the `json` format only — development output
 * stays untouched. A line that is already a JSON document passes through unchanged, so a dependency
 * that logs structured lines of its own is not double-wrapped.
 */

import util from "node:util";

import { getRequestCorrelationId } from "./requestScope";

const LEVELS = [
  ["log", "INFO"],
  ["warn", "WARNING"],
  ["error", "ERROR"],
] as const;

function isJsonDocument(value: string): boolean {
  if (!value.startsWith("{")) return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

export function installConsoleShim() {
  for (const [method, level] of LEVELS) {
    console[method] = (...args: unknown[]) => {
      if (args.length === 1 && typeof args[0] === "string" && isJsonDocument(args[0])) {
        process.stdout.write(args[0] + "\n");
        return;
      }

      // `util.format` renders the arguments the way the console would have -- %-placeholders,
      // object inspection, multi-line stacks -- and the JSON envelope makes the result one line.
      process.stdout.write(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level,
          service: "fl_frontend",
          correlation_id: getRequestCorrelationId() ?? "SYSTEM",
          message: util.format(...args),
          source: "console",
        }) + "\n",
      );
    };
  }
}
