export type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export interface LogMeta extends Record<string, unknown> {
  trace_id?: string;
  span_id?: string;
  module?: string;
  line?: number;
  error_code?: string;
  error?: unknown;
  url?: string;
  endpoint?: string;
}

const SERVICE = "fl_frontend";

// Lifecycle lines run outside any request; the key stays present so a parser can rely on it.
// Mirrors the backend's `NO_REQUEST_SENTINEL`.
const NO_REQUEST_SENTINEL = "SYSTEM";

// Foreground only, and on the level word alone: a background block makes a copied line unreadable
// wherever it is pasted, and a colourised message defeats a grep for it.
const LEVEL_COLOR: Record<LogLevel, string> = {
  DEBUG: "\x1b[36m",
  INFO: "\x1b[32m",
  WARNING: "\x1b[33m",
  ERROR: "\x1b[31m",
  CRITICAL: "\x1b[35m",
};
const RESET = "\x1b[0m";

// A value carrying any of these would end the key=value pair early, so it is quoted; everything
// else is written bare, which is what makes the common line readable at all.
const NEEDS_QUOTING = /[\s='"]/;

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

// `toLocaleString("sv-SE")` is ISO-shaped and carries no milliseconds, which the shared shape
// requires, so the parts are assembled by hand. Local time, unlike the JSON envelope's UTC: the
// reader of this format is at the machine that wrote it.
function consoleTimestamp(at: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  const date = `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;

  return `${date} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`;
}

function renderValue(value: unknown): string {
  // A non-string is its JSON encoding and is never quoted again, so `401` and `true` read as
  // themselves rather than as strings that happen to look numeric.
  if (typeof value !== "string") return JSON.stringify(value) ?? "undefined";

  return value === "" || NEEDS_QUOTING.test(value) ? JSON.stringify(value) : value;
}

// The frontend's own stack, or the two fields every attached error has: a line with neither would
// leave an ERROR line saying an exception was attached and showing nothing of it.
function renderError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;

  return JSON.stringify(error) ?? "undefined";
}

export function formatLogLine(format: "console" | "json", level: LogLevel, message: string, meta?: LogMeta): string {
  const { trace_id, span_id, module, line, error, ...rest } = meta ?? {};

  if (format === "json") {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level: level,
      service: SERVICE,
      trace_id: trace_id ?? NO_REQUEST_SENTINEL,
      span_id: span_id ?? NO_REQUEST_SENTINEL,
      message: message,
      ...(module !== undefined && { module: module }),
      ...(line !== undefined && { line: line }),
      ...rest,
      ...(error !== undefined && { error: serializeError(error) }),
    });
  }

  // Chosen by LOG_FORMAT, not by the build, so nothing here may assume development. The shape is
  // `docs/logging/spec.md` §1.4's, byte-identical to `fl_backend/app/core/logging.py`'s.
  const origin = module !== undefined && line !== undefined ? `${module}:${String(line)}` : SERVICE;
  // The padding sits OUTSIDE the colour so a level word copied out of a terminal carries no run of
  // coloured blanks after it.
  const opening = `${LEVEL_COLOR[level]}${level}${RESET}${" ".repeat(8 - level.length)} ${consoleTimestamp(new Date())} ${origin} - ${message}`;

  const pairs: [string, unknown][] = [
    ["trace_id", trace_id ?? NO_REQUEST_SENTINEL],
    ["span_id", span_id ?? NO_REQUEST_SENTINEL],
    ...Object.entries(rest).filter(([, value]) => value !== undefined),
  ];
  const extras = pairs.map(([key, value]) => ` ${key}=${renderValue(value)}`).join("");

  // The stack takes the lines after, never a `key=value` pair: a multi-line value would break the
  // one-pair-per-token reading of the tail.
  const trailer = error === undefined ? "" : `\n${renderError(error).replaceAll(/^/gm, "    ")}`;

  return `${opening}${extras}${trailer}`;
}
