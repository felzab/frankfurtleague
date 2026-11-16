import { afterAll, afterEach, assert, beforeEach } from "vitest";

/** Test-only: every export below replaces `process.stdout.write` for the length of a call or a file. */

/**
 * Where the application's logger stands in a stack: a chunk is the logger's when the logger's own frame
 * wrote it, so a library's line, however it is shaped, passes on to the stream untouched.
 */
const LOGGER_FRAME = /[\\/]src[\\/]core[\\/]logging\.ts:\d+/;

/**
 * Whether the write in progress is the logger's: its frame stands right below the replaced `write`, the first frame
 * Node's `Error.captureStackTrace` keeps once it leaves out `write` and every frame above it. A chunk written by
 * anything the logger calls is not the logger's.
 */
function writtenByTheLogger(write: typeof process.stdout.write): boolean {
  const call = new Error("the write's caller");
  Error.captureStackTrace(call, write);
  // The first line is the error's own; the frame below it is the caller's.
  return LOGGER_FRAME.test(call.stack?.split("\n")[1] ?? "");
}

/** The stream's own `write`, bound, for every chunk a capture passes on. */
type Write = (chunk: unknown, ...rest: unknown[]) => boolean;

/**
 * Replaces `process.stdout.write` with one handing each of the logger's chunks to `read` and every other chunk to
 * the stream. A chunk `read` refuses is a fault of the capture, recorded rather than thrown into the code that wrote.
 */
function beginCapture(read: (raw: string) => void): { faults: string[]; restore: () => void } {
  const faults: string[] = [];
  const original = process.stdout.write;
  const passOn = original.bind(process.stdout) as Write;

  const write = ((chunk: unknown, ...rest: unknown[]) => {
    if (!writtenByTheLogger(write)) return passOn(chunk, ...rest);
    const raw = String(chunk);
    try {
      // The logger writes each line in one call ending in a newline, so a chunk without one is a writer this
      // capture misreads.
      if (!raw.endsWith("\n")) throw new Error("a log line written without its newline");
      read(raw);
    } catch (error) {
      faults.push(`${error instanceof Error ? error.message : String(error)}: ${raw}`);
    }
    return true;
  }) as typeof process.stdout.write;
  process.stdout.write = write;

  return {
    faults,
    restore: () => {
      process.stdout.write = original;
    },
  };
}

/**
 * Every JSON document the logger writes while `run` runs, for a route handler or a backend call that writes its line
 * asynchronously; a chunk that is no one document fails the call once `run` has ended.
 */
export async function documentsWrittenByAsync(run: () => Promise<unknown>): Promise<Record<string, unknown>[]> {
  requireProductionBuild();
  const documents: Record<string, unknown>[] = [];
  const { faults, restore } = beginCapture((raw) => {
    if (raw.slice(0, -1).includes("\n")) throw new Error("more than one document in one write");
    documents.push(JSON.parse(raw) as Record<string, unknown>);
  });
  try {
    await run();
  } finally {
    restore();
  }
  assert(faults.length === 0, `the logger wrote what the capture cannot read:\n${faults.join("\n")}`);

  return documents;
}

/** One line the application's logger wrote, read back from the one of its two formats its capture reads. */
export type LoggedLine = {
  readonly level: "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  readonly message: string;
  /** The fields the call passed, without `trace_id` and `error`, which the plain format does not write as fields. */
  readonly fields: Record<string, unknown>;
  /** The error's stack, scrubbed as written, in both formats; its first line names the error and its message. */
  readonly stack: string | undefined;
  /**
   * The line's trace, as the production document writes it, `SYSTEM` outside every request. Absent under the plain
   * format, which writes none.
   */
  readonly traceId?: string;
  /**
   * The error as the production document writes it: an `Error` as its name, message and stack, any other value as
   * itself, scrubbed. Absent where the call passed none, and under the plain format, which writes only an `Error`'s
   * stack and nothing of any other value.
   */
  readonly error?: unknown;
  /** The chunk as written: what a case proving that a value never reached the stream searches. */
  readonly raw: string;
};

const PLAIN_LINE = /^(DEBUG|INFO|WARNING|ERROR|CRITICAL) /;

/** The plain line `next dev` and every test project but `unit-production` write: `LEVEL message {fields}`, the stack below. */
function readPlain(raw: string): LoggedLine {
  const level = PLAIN_LINE.exec(raw)?.[1] as LoggedLine["level"] | undefined;
  if (level === undefined) throw new Error("a line that is no plain line");
  const [head = "", ...stackLines] = raw.slice(0, -1).split("\n");
  const rest = head.slice(level.length + 1);
  // The fields close the first line, and a message holding " {" leaves a remainder no parse accepts, so the first
  // split that parses is the fields'.
  for (let at = rest.indexOf(" {"); at !== -1; at = rest.indexOf(" {", at + 1)) {
    try {
      const fields = JSON.parse(rest.slice(at + 1)) as Record<string, unknown>;
      return { level, message: rest.slice(0, at), fields, stack: stackLines.length > 0 ? stackLines.join("\n") : undefined, raw };
    } catch {
      // Not yet the fields: a brace inside the message.
    }
  }
  throw new Error("a plain log line without its fields");
}

/** The JSON document a production build writes, its `timestamp` and `service` set aside. */
function readDocument(raw: string): LoggedLine {
  const {
    level,
    message,
    error,
    trace_id: traceId,
    timestamp: _timestamp,
    service: _service,
    ...fields
  } = JSON.parse(raw) as Record<string, unknown>;
  const stack = typeof error === "object" && error !== null && "stack" in error ? String(error.stack) : undefined;
  // The document holds no `undefined`: an `error` the call left out is a key the line does not carry.
  return {
    level: level as LoggedLine["level"],
    message: String(message),
    fields,
    stack,
    traceId: String(traceId),
    ...(error === undefined ? {} : { error }),
    raw,
  };
}

/**
 * Refuses a reader of the production document anywhere but under a production build's `NODE_ENV`, which the
 * `unit-production` project sets: elsewhere the logger writes the plain line, which carries no trace and no `error`, so
 * a case proving one kept off a line would pass on a line that never carries it. A suite renamed out of the project
 * fails here instead.
 */
function requireProductionBuild(): void {
  assert(
    process.env.NODE_ENV === "production",
    `the production document read under NODE_ENV ${String(process.env.NODE_ENV)}: name the file *.production.test.ts`,
  );
}

/**
 * Every line the application's logger writes from this call to the end of the file: a case reads the stream the
 * logger really writes rather than a double of the logger. Called at module level, before the subject's import, so a
 * line written while the subject loads is caught too.
 * - It reads one format: the plain line, or with `"production"` the JSON document a production build writes, which a
 *   case reading a line's `traceId` or `error`, or proving a value kept off a line, needs. A line in the other format
 *   is one the capture cannot read.
 * - Each case begins with no line, so it reads only what it wrote; `clear` empties the lines mid-case.
 * - A chunk the logger did not write goes on to the runner's reporter untouched, whatever its shape.
 * - A line the capture cannot read fails the case it was written in, from the capture's `afterEach`, rather than
 *   throwing into the code that wrote it.
 */
export function captureLog(build?: "production"): { lines(): readonly LoggedLine[]; clear(): void } {
  if (build === "production") requireProductionBuild();
  const read = build === "production" ? readDocument : readPlain;
  const lines: LoggedLine[] = [];
  const { faults, restore } = beginCapture((raw) => {
    lines.push(read(raw));
  });

  beforeEach(() => {
    lines.length = 0;
  });
  afterEach(() => {
    const unread = faults.splice(0);
    assert(unread.length === 0, `the logger wrote what the capture cannot read:\n${unread.join("\n")}`);
  });
  afterAll(restore);

  return {
    lines: () => [...lines],
    clear: () => void (lines.length = 0),
  };
}
