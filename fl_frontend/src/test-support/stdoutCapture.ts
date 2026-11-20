import { afterAll, afterEach, aroundEach } from "vitest";

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
 * the stream, which `passOn` writes to. A chunk `read` cannot parse throws into the logger's call that wrote it.
 */
function beginCapture(read: (raw: string) => void): { restore: () => void; passOn: Write } {
  const original = process.stdout.write;
  const passOn = original.bind(process.stdout) as Write;

  const write = ((chunk: unknown, ...rest: unknown[]) => {
    if (!writtenByTheLogger(write)) return passOn(chunk, ...rest);
    read(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stdout.write = write;

  return {
    restore: () => {
      process.stdout.write = original;
    },
    passOn,
  };
}

/**
 * Every JSON document the logger writes while `run` runs, for a route handler or a backend call that writes its line
 * asynchronously.
 */
export async function documentsWrittenByAsync(run: () => Promise<unknown>): Promise<Record<string, unknown>[]> {
  const documents: Record<string, unknown>[] = [];
  const { restore } = beginCapture((raw) => {
    documents.push(JSON.parse(raw) as Record<string, unknown>);
  });
  try {
    await run();
  } finally {
    restore();
  }

  return documents;
}

/** One line the application's logger wrote, read back from its JSON document. */
export type LoggedLine = {
  readonly level: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  readonly message: string;
  /** The fields the call passed, without `trace_id` and `error`, which the document writes beside them. */
  readonly fields: Record<string, unknown>;
  /** The error's stack, scrubbed as written; its first line names the error and its message. */
  readonly stack: string | undefined;
  /** The line's trace, `SYSTEM` outside every request. */
  readonly traceId: string;
  /**
   * The error as written: an `Error` as its name, message and stack, any other value as itself, scrubbed. Absent where
   * the call passed none.
   */
  readonly error?: unknown;
  /** The chunk as written: what a case proving that a value never reached the stream searches. */
  readonly raw: string;
};

/** The JSON document the logger writes, its `timestamp` and `service` set aside. */
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
 * Every line the application's logger writes from this call to the end of the file: a case reads the stream the
 * logger really writes rather than a double of the logger. Called at module level, before the subject's import, so a
 * line written while the subject loads is caught too.
 * - Each case begins with no line, so it reads only what its run wrote, its `beforeEach` hooks' lines among them;
 *   `clear` empties the lines mid-case.
 * - A chunk the logger did not write goes on to the runner's reporter untouched, whatever its shape.
 * - A line is its case's from the case's start, ahead of every `beforeEach` (Vitest's `aroundEach`), to the capture's
 *   `afterEach`. Any other line, a `beforeAll`'s or an after-hook's, is read too, and goes on to the reporter as well,
 *   since no case may read it. Vitest marks no point between a case's body and its first after-hook, so an `afterEach`
 *   registered after this call, or inside a `describe`, writes inside the case's window.
 */
export function captureLog(): { lines(): readonly LoggedLine[]; clear(): void } {
  const lines: LoggedLine[] = [];
  /** Whether a case's window is open, from the case's start to the capture's `afterEach`. */
  let inCase = false;
  const { restore, passOn } = beginCapture((raw) => {
    if (!inCase) passOn(raw);
    lines.push(readDocument(raw));
  });

  aroundEach(async (runTest) => {
    lines.length = 0;
    inCase = true;
    await runTest();
  });
  afterEach(() => {
    inCase = false;
  });
  afterAll(restore);

  return {
    lines: () => [...lines],
    clear: () => void (lines.length = 0),
  };
}
