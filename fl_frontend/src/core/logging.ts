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
