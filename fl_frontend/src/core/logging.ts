import { frontend_config } from "./config";
import { formatLogLine } from "./logFormat";
import { getRequestSpanId, getRequestTraceId } from "./requestScope";
import { mintSpanId } from "./trace";

import type { LogLevel, LogMeta } from "./logFormat";

export type { LogMeta } from "./logFormat";

// The backend's numbering, so `LOG_LEVEL` means the same thing on both services and a reader
// setting it once does not have to learn two scales.
const SEVERITY: Record<LogLevel, number> = { DEBUG: 10, INFO: 20, WARNING: 30, ERROR: 40, CRITICAL: 50 };

export const logger = {
  debug: (message: string, meta?: LogMeta) => log("DEBUG", message, meta),
  info: (message: string, meta?: LogMeta) => log("INFO", message, meta),
  warn: (message: string, meta?: LogMeta) => log("WARNING", message, meta),
  error: (message: string, error?: unknown, meta?: LogMeta) => log("ERROR", message, { error, ...meta }),
};

function log(level: LogLevel, message: string, meta?: LogMeta) {
  if (SEVERITY[level] < SEVERITY[frontend_config.LOG_LEVEL]) return;

  const traceId = meta?.trace_id ?? getRequestTraceId();
  // A caller naming a trace outside any scope gets a span minted beside it: a real trace under the
  // sentinel span would file this hop's work under no hop (`docs/logging/spec.md :: L12`).
  const spanId = meta?.span_id ?? getRequestSpanId() ?? (traceId === undefined ? undefined : mintSpanId());
  const withScope: LogMeta = { ...meta, trace_id: traceId, span_id: spanId };
  const line = formatLogLine(frontend_config.LOG_FORMAT, level, message, withScope);

  if (frontend_config.LOG_FORMAT === "json") {
    // Straight to stdout: one stream, ordered, and out of the console shim's way.
    process.stdout.write(line + "\n");
    return;
  }

  if (level === "ERROR") console.error(line);
  else if (level === "WARNING") console.warn(line);
  else if (level === "DEBUG") console.debug(line);
  else console.log(line);
}
