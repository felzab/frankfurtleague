import { now } from "./clock";
import { getRequestTraceId } from "./requestScope";

type Level = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export type LogMeta = Record<string, unknown>;

// An address anywhere in a line: a store's duplicate-key refusal quotes the stored one in its message and
// stack, and a failure on the sign-in or the mail path carries the submitted one, a Unicode domain included.
// `fl_backend/app/core/logging.py :: ADDRESS` spells the same classes in Python's syntax, and
// `fl_backend/tests/shared/log_addresses.json` holds the two to one answer. The domain ends in a label
// opening with a letter, as every top-level domain does, so pnpm's `.pnpm/<name>@<version>/` in a stack
// frame's path is left standing.
const ADDRESS = /[\p{L}\p{N}_.!#$%&'*+/=?^`{|}~-]+@[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*\.\p{L}[\p{L}\p{N}_-]*/gu;

/** Every string scrubbed of an address, and an error written as its name, message and stack. */
function scrubbed(_key: string, value: unknown): unknown {
  if (typeof value === "string") return value.replaceAll(ADDRESS, "[address]");
  return value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;
}

function log(level: Level, message: string, { trace_id, error, ...fields }: LogMeta = {}): void {
  // `SYSTEM` outside every request, so a reader can rely on the key being there.
  const entry = {
    timestamp: now().toISOString(),
    level,
    service: "fl_frontend",
    trace_id: trace_id ?? getRequestTraceId() ?? "SYSTEM",
    message,
    ...fields,
    error,
  };

  // The runtime's own flag: a production build, the image's or the local stack's, writes JSON; `next dev` a
  // plain line, with the stack on the lines after it. Straight to the stream, never through `console`, which
  // Next patches to read its request storage.
  const stack = error instanceof Error ? `\n${String(scrubbed("", error.stack))}` : "";
  const line =
    process.env.NODE_ENV === "production" ? JSON.stringify(entry, scrubbed) : `${level} ${message} ${JSON.stringify(fields, scrubbed)}${stack}`;
  process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (message: string, meta?: LogMeta) => log("DEBUG", message, meta),
  info: (message: string, meta?: LogMeta) => log("INFO", message, meta),
  warn: (message: string, meta?: LogMeta) => log("WARNING", message, meta),
  error: (message: string, error?: unknown, meta?: LogMeta) => log("ERROR", message, { ...meta, error }),
  critical: (message: string, meta?: LogMeta) => log("CRITICAL", message, meta),
};
