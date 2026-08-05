/**
 * CORE · structured logging
 *
 * JSON in production, readable output in development, selected by `LOG_FORMAT`. The line itself is
 * built by `logFormat.ts`; this module adds the config read, the request scope, and the write.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • One JSON document per line in production. This logger writes to `process.stdout` directly,
 *     below the console shim `instrumentation.ts` installs — anything else that reaches `console.*`
 *     is wrapped into the same JSON envelope by that shim, so the stream stays parseable.
 *   • Log the field NAME, never the submitted value, when reporting a validation failure. Payloads
 *     here routinely carry email addresses.
 *   • `correlation_id` is the join key to nginx's and the backend's lines for the same request. When
 *     the caller does not pass one, the current request scope fills it in
 *     (`core/requestScope.ts`); outside any scope the line carries the `SYSTEM` sentinel.
 *   • `core/config.ts` must not import this module — config is read here, so logging is unavailable
 *     while config itself is failing.
 */

import { frontend_config } from "./config";
import { formatLogLine } from "./logFormat";
import { getRequestCorrelationId } from "./requestScope";

import type { LogLevel, LogMeta } from "./logFormat";

export type { LogMeta } from "./logFormat";

export const logger = {
  info: (message: string, meta?: LogMeta) => log("INFO", message, meta),
  warn: (message: string, meta?: LogMeta) => log("WARNING", message, meta),
  error: (message: string, error?: unknown, meta?: LogMeta) => log("ERROR", message, { error, ...meta }),
};

function log(level: LogLevel, message: string, meta?: LogMeta) {
  const withScope: LogMeta = { ...meta, correlation_id: meta?.correlation_id ?? getRequestCorrelationId() };
  const line = formatLogLine(frontend_config.LOG_FORMAT, level, message, withScope);

  if (frontend_config.LOG_FORMAT === "json") {
    // Straight to stdout: one stream, ordered, and out of the console shim's way.
    process.stdout.write(line + "\n");
    return;
  }

  if (level === "ERROR") console.error(line);
  else if (level === "WARNING") console.warn(line);
  else console.log(line);
}
