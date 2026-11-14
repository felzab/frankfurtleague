// What the capture reads off the production build's document beyond the plain line: its trace and its error as
// written, which the cases proving a value kept off a line read.
import { captureLog } from "@/test-support/stdoutCapture.ts";
import { describe, expect, it } from "vitest";

const log = captureLog();

// Imported after the capture, as a suite's subject is.
const { logger } = await import("@/core/logging.ts");

const TRACE = "a".repeat(32);

describe("the capture, under a production build's format", () => {
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
    logger.error("capture.string", "a string the plain format drops");
    logger.error("capture.none", undefined, { name: "TypeError" });

    const [thrown, string, none] = log.lines();
    expect(thrown?.error).toMatchObject({ name: "TypeError", message: "no connection" });
    expect(string?.error).toBe("a string the plain format drops");
    expect(none === undefined ? [] : Object.keys(none)).not.toContain("error");
    expect(none?.fields).toStrictEqual({ name: "TypeError" });
  });
});
