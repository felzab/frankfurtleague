import { afterAll, assert } from "vitest";

/** Test-only: every export below replaces `process.stdout.write` for the length of a call or a file. */

/** A run's stdout: the chunks that opened like documents verbatim, and those chunks parsed. */
type WrittenLines = { raw: string[]; documents: Record<string, unknown>[] };

function beginCapture(): { written: WrittenLines; restore: () => void } {
  const written: WrittenLines = { raw: [], documents: [] };
  const original = process.stdout.write;

  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    const text = String(chunk);
    // The runner's own reporter shares this stream, so a chunk that is not a document goes on to it
    // rather than being swallowed here.
    if (!text.startsWith("{")) return (original as (...args: unknown[]) => boolean).call(process.stdout, chunk, ...rest);
    written.raw.push(text);
    // Here rather than in each suite: a writer that emitted two documents in one chunk would
    // otherwise be read as one by every caller.
    assert.ok(text.endsWith("\n") && !text.slice(0, -1).includes("\n"), `one document per line, got ${text}`);
    written.documents.push(JSON.parse(text) as Record<string, unknown>);
    return true;
  }) as typeof process.stdout.write;

  return {
    written,
    restore: () => {
      process.stdout.write = original;
    },
  };
}

/** The awaited twin, for a route handler or a backend call that writes its line asynchronously. */
export async function documentsWrittenByAsync(run: () => Promise<unknown>): Promise<Record<string, unknown>[]> {
  const { written, restore } = beginCapture();
  try {
    await run();
  } finally {
    restore();
  }

  return written.documents;
}

/** One line `fl_frontend/src/core/logging.ts :: logger` wrote, read back from either of its two formats. */
export type LoggedLine = {
  readonly level: "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  readonly message: string;
  /** The fields the call passed, without `trace_id` and `error`, which the plain format does not write as fields. */
  readonly fields: Record<string, unknown>;
  /** The error's stack, scrubbed as written, in both formats; its first line names the error and its message. */
  readonly stack: string | undefined;
  /** The chunk as written: what a case proving that a value never reached the stream searches. */
  readonly raw: string;
};

const PLAIN_LINE = /^(DEBUG|INFO|WARNING|ERROR|CRITICAL) /;

/** The plain line `next dev` and every test project but `unit-production` write: `LEVEL message {fields}`, the stack below. */
function readPlain(raw: string, level: LoggedLine["level"]): LoggedLine {
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
  assert.fail(`a plain log line without its fields: ${raw}`);
}

/** The JSON document a production build writes, its `trace_id`, `timestamp` and `service` set aside. */
function readDocument(raw: string): LoggedLine {
  const {
    level,
    message,
    error,
    trace_id: _traceId,
    timestamp: _timestamp,
    service: _service,
    ...fields
  } = JSON.parse(raw) as Record<string, unknown>;
  const stack = typeof error === "object" && error !== null && "stack" in error ? String(error.stack) : undefined;
  return { level: level as LoggedLine["level"], message: String(message), fields, stack, raw };
}

/**
 * Every line the application's logger writes from this call to the end of the file, in either format: a case
 * reads the stream the logger really writes rather than a double of the logger. Called at module level, before the
 * subject's import, so a line written while the subject loads is caught too. A chunk that is no log line goes on to
 * the runner's reporter. The plain format carries no `trace_id` and the error only as its stack, so a case asserting
 * either beyond the stack runs under the `unit-production` project (`fl_frontend/vitest.config.mts`).
 */
export function captureLog(): { lines(): readonly LoggedLine[]; clear(): void } {
  const lines: LoggedLine[] = [];
  const original = process.stdout.write;

  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    const raw = String(chunk);
    const level = PLAIN_LINE.exec(raw)?.[1] as LoggedLine["level"] | undefined;
    if (level === undefined && !raw.startsWith("{")) return (original as (...args: unknown[]) => boolean).call(process.stdout, chunk, ...rest);
    // The logger writes each line in one call ending in a newline, so a chunk without one is a writer this
    // capture misreads.
    assert.ok(raw.endsWith("\n"), `one log line per write, got ${raw}`);
    lines.push(level === undefined ? readDocument(raw) : readPlain(raw, level));
    return true;
  }) as typeof process.stdout.write;

  afterAll(() => {
    process.stdout.write = original;
  });

  return {
    lines: () => [...lines],
    clear: () => void (lines.length = 0),
  };
}
