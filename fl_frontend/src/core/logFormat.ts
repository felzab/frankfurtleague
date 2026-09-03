export type LogLevel = "INFO" | "WARNING" | "ERROR";

export interface LogMeta extends Record<string, unknown> {
  correlation_id?: string;
  error_code?: string;
  error?: unknown;
  url?: string;
  endpoint?: string;
}

// Lifecycle lines run outside any request; the key stays present so a parser can rely on it.
// Mirrors the backend's `NO_REQUEST_SENTINEL`.
const NO_REQUEST_SENTINEL = "SYSTEM";

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

export function formatLogLine(format: "console" | "json", level: LogLevel, message: string, meta?: LogMeta): string {
  if (format === "json") {
    const { correlation_id, error, ...rest } = meta ?? {};
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: "fl_frontend",
      correlation_id: correlation_id ?? NO_REQUEST_SENTINEL,
      message,
      ...(error !== undefined && { error: serializeError(error) }),
      ...rest,
    });
  }

  // Chosen by LOG_FORMAT, not by the build, so nothing here may assume development. The shape
  // mirrors `fl_backend/app/core/logging.py :: LevelAwareFormatter`.
  const color = level === "ERROR" ? "\x1b[31m" : level === "WARNING" ? "\x1b[33m" : "\x1b[34m";
  const reset = "\x1b[0m";

  // sv-SE is the one widely-shipped locale whose short format is ISO-shaped, matching the backend's
  // console timestamps without hand-rolling a formatter.
  const timestamp = new Date().toLocaleString("sv-SE");
  const idStr = `<${meta?.correlation_id ?? NO_REQUEST_SENTINEL}>`;
  const metaStr = meta && Object.keys(meta).length > 0 ? `\n  Meta: ${JSON.stringify({ ...meta, error: serializeError(meta.error) })}` : "";

  return `${color}${level.padEnd(8)}${reset} ${timestamp} | ${idStr} - ${message}${metaStr}`;
}
