// The log capture's own guarantee, which every suite reading the logger's lines relies on and none tests: it reads
// the logger's chunks alone, each case from an empty record, and a line it cannot read fails the case, not the writer.
import { caseFailures } from "@/test-support/caseFailures";
import { captureLog, documentsWrittenByAsync } from "@/test-support/stdoutCapture";
import { describe, expect, it } from "vitest";

const log = captureLog();

// Imported after the capture, as a suite's subject is.
const { logger } = await import("@/core/logging");

const { failsNaming } = caseFailures();

describe("the capture", () => {
  it("reads the logger's line", () => {
    logger.info("capture.read", { kept: true });

    expect(log.lines().map(({ level, message, fields }) => [level, message, fields])).toStrictEqual([["INFO", "capture.read", { kept: true }]]);
  });

  it("begins each case with no line, the last case's gone", () => {
    expect(log.lines()).toStrictEqual([]);
  });

  // The plain format writes neither, so a line read off it carries neither key, never one standing `undefined`.
  it("reads no trace and no error off the plain format", () => {
    logger.error("capture.plain", "a string the plain format drops", { trace_id: "a".repeat(32) });

    const [line] = log.lines();
    expect(line === undefined ? [] : Object.keys(line).filter((key) => key === "traceId" || key === "error")).toStrictEqual([]);
    expect(line?.raw).toBe("ERROR capture.plain {}\n");
  });

  it("passes on a chunk the logger did not write, however it is shaped", () => {
    // Shaped as the logger's plain line, as a library's own line can be.
    process.stdout.write('INFO not.the.logger {"written":"by the case"}\n');

    expect(log.lines()).toStrictEqual([]);
  });

  failsNaming(
    "fails the case on a line it cannot read, never the code that wrote it",
    /^the logger wrote what the capture cannot read:\na plain log line without its fields: INFO split/,
    () => {
      // A message holding a newline splits the plain line before its fields.
      logger.info("split\nacross two lines");
    },
  );

  /* Outside a production build the logger writes the plain line, which carries no trace and no `error`: a suite reading
     the document there would prove its absences on lines that never carry them, so both readers of it refuse to start. */
  it("refuses to read the production document outside a production build", async () => {
    expect(() => captureLog("production")).toThrow("NODE_ENV test");
    await expect(documentsWrittenByAsync(() => Promise.resolve())).rejects.toThrow("NODE_ENV test");
  });
});
