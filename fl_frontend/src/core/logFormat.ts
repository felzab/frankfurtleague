/**
 * CORE · log line formatting
 *
 * The pure half of the logger: turns a level, a message and metadata into the one line that gets
 * written. Split out of `logging.ts` so the unit tests can cover the format without importing
 * `core/config.ts`, whose `server-only` marker the test runner cannot load.
 *
 * The JSON field set is shared with the backend's `JSONFormatter` so one parser reads both streams:
 * `timestamp` (ISO 8601 UTC, milliseconds, `Z`), `level` (`INFO`/`WARNING`/`ERROR`), `service`,
 * `correlation_id`, `message`, optional `error_code`, and `error` as `{name, message, stack}`.
 * The contract is `docs/logging.md`.
 */

export type LogLevel = "INFO" | "WARNING" | "ERROR";

export interface LogMeta extends Record<string, unknown> {
  correlation_id?: string;
  error_code?: string;
  error?: unknown;
  url?: string;
  endpoint?: string;
}

// Lifecycle lines run outside any request; the sentinel keeps the key present on every line so a
// parser can rely on it. Mirrors the backend's `NO_REQUEST_SENTINEL`.
export const NO_REQUEST_SENTINEL = "SYSTEM";

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

  // The console format -- chosen by LOG_FORMAT, not by the build, so nothing here may assume it
  // only ever runs in development. The line shape mirrors the backend's console formatter
  // (`fl_backend/app/core/logging.py :: LevelAwareFormatter`) -- padded level, local timestamp,
  // `<id>`, dash, message -- so the two dev streams read as one convention.
  const color = level === "ERROR" ? "\x1b[31m" : level === "WARNING" ? "\x1b[33m" : "\x1b[34m";
  const reset = "\x1b[0m";

  // sv-SE is the one widely-shipped locale whose short format is ISO-shaped (YYYY-MM-DD HH:MM:SS),
  // matching the backend's console timestamps without hand-rolling a formatter.
  const timestamp = new Date().toLocaleString("sv-SE");
  const idStr = `<${meta?.correlation_id ?? NO_REQUEST_SENTINEL}>`;
  const metaStr = meta && Object.keys(meta).length > 0 ? `\n  Meta: ${JSON.stringify({ ...meta, error: serializeError(meta.error) })}` : "";

  return `${color}${level.padEnd(8)}${reset} ${timestamp} | ${idStr} - ${message}${metaStr}`;
}
