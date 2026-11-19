// The log capture's own guarantee, which every suite reading the logger's lines relies on and none tests: it reads
// the logger's chunks alone, each case from an empty record, with each line's trace and error as written, and a line
// outside every case reaches the stream.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { captureLog } from "@/test-support/stdoutCapture";

/** Every chunk the capture passes on, recorded on its way to the stream's own `write`. */
const reached: string[] = [];
const streamWrite = process.stdout.write;
const toStream = streamWrite.bind(process.stdout) as (chunk: unknown, ...rest: unknown[]) => boolean;
process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
  reached.push(String(chunk));
  return toStream(chunk, ...rest);
}) as typeof process.stdout.write;
// Registered ahead of the capture, so it runs after the capture's own end.
afterAll(() => {
  process.stdout.write = streamWrite;
});

const log = captureLog();

// Imported after the capture, as a suite's subject is.
const { logger } = await import("@/core/logging");

const TRACE = "a".repeat(32);

describe("the capture", () => {
  it("reads the logger's line", () => {
    logger.info("capture.read", { kept: true });

    expect(log.lines().map(({ level, message, fields }) => [level, message, fields])).toStrictEqual([["INFO", "capture.read", { kept: true }]]);
  });

  it("begins each case with no line, the last case's gone", () => {
    expect(log.lines()).toStrictEqual([]);
  });

  it("reads the line's trace, `SYSTEM` outside every request", () => {
    logger.info("capture.traced", { trace_id: TRACE });
    logger.info("capture.untraced");

    expect(log.lines().map(({ message, traceId }) => [message, traceId])).toStrictEqual([
      ["capture.traced", TRACE],
      ["capture.untraced", "SYSTEM"],
    ]);
  });

  it("reads the error as written, a value that is no `Error` as itself, and none where the call passed none", () => {
    logger.error("capture.thrown", new TypeError("no connection"));
    logger.error("capture.string", "a string, which is no Error");
    logger.error("capture.none", undefined, { name: "TypeError" });

    const [thrown, string, none] = log.lines();
    expect(thrown?.error).toMatchObject({ name: "TypeError", message: "no connection" });
    expect(string?.error).toBe("a string, which is no Error");
    expect(none === undefined ? [] : Object.keys(none)).not.toContain("error");
    expect(none?.fields).toStrictEqual({ name: "TypeError" });
  });

  it("passes on a chunk the logger did not write, however it is shaped", () => {
    // Shaped as the logger's document, as a library's own line can be.
    process.stdout.write('{"level":"INFO","message":"not.the.logger","written":"by the case"}\n');

    expect(log.lines()).toStrictEqual([]);
  });

  it("passes on a chunk written by what the logger calls, which is not the logger's", () => {
    // Written while the logger turns a field into JSON, the logger's frame further down the stack.
    const field = {
      toJSON: () => {
        process.stdout.write('{"level":"INFO","message":"not.the.logger","written":"inside the logger\'s call"}\n');
        return "read";
      },
    };
    logger.info("capture.inner", { field });

    expect(log.lines().map(({ message, fields }) => [message, fields])).toStrictEqual([["capture.inner", { field: "read" }]]);
  });
});

// The harm: a line written outside every case's body is swallowed from the reporter, and no case reads it.
describe("a line outside every case", () => {
  beforeAll(() => {
    logger.info("capture.before_all");
  });

  it("reaches the stream, where a case's own line does not", () => {
    logger.info("capture.in_the_case");

    const messages = reached.filter((chunk) => chunk.includes("capture.")).map((chunk) => (JSON.parse(chunk) as { message: string }).message);
    expect(messages).toStrictEqual(["capture.before_all"]);
  });
});
