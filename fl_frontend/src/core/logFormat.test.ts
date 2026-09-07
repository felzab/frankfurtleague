import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatLogLine } from "./logFormat.ts";

const TIMESTAMP_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The shared console opening: padded level, local timestamp with milliseconds, origin, dash. */
const CONSOLE_OPENING = /^(DEBUG|INFO|WARNING|ERROR|CRITICAL) {1,5}\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \S+ - /;

const TRACE = "0af7651916cd43dd8448eb211c80319c";
const SPAN = "b7ad6b7169203331";

/** The level word is coloured, so every shape assertion below reads the line without the codes. */
function plain(line: string): string {
  return line.replaceAll(/\x1b\[[0-9;]*m/g, "");
}

describe("formatLogLine json", () => {
  it("emits one parseable document with the shared field set", () => {
    const line = formatLogLine("json", "INFO", "hello", { trace_id: TRACE, span_id: SPAN });

    const document = JSON.parse(line);
    assert.ok(!line.includes("\n"));
    assert.equal(document.level, "INFO");
    assert.equal(document.service, "fl_frontend");
    assert.equal(document.trace_id, TRACE);
    assert.equal(document.span_id, SPAN);
    assert.equal(document.message, "hello");
    assert.match(document.timestamp, TIMESTAMP_SHAPE);
  });

  /* The order is the contract, not an accident of the literal: a reader scanning a container log
     finds the ids in the same column on every service's line. */
  it("writes the shared fields in the shared order, extras and the error last", () => {
    const line = formatLogLine("json", "ERROR", "crash", {
      trace_id: TRACE,
      span_id: SPAN,
      module: "api",
      line: 12,
      error_code: "FE-API-001",
      error: new Error("boom"),
    });

    assert.deepEqual(Object.keys(JSON.parse(line)), [
      "timestamp",
      "level",
      "service",
      "trace_id",
      "span_id",
      "message",
      "module",
      "line",
      "error_code",
      "error",
    ]);
  });

  it("carries the SYSTEM sentinel on both ids outside any request", () => {
    const document = JSON.parse(formatLogLine("json", "INFO", "boot"));

    assert.equal(document.trace_id, "SYSTEM");
    assert.equal(document.span_id, "SYSTEM");
  });

  it("uses the backend's level vocabulary, WARNING not WARN", () => {
    const document = JSON.parse(formatLogLine("json", "WARNING", "careful"));

    assert.equal(document.level, "WARNING");
  });

  it("carries the two levels the frontend gained with the threshold", () => {
    assert.equal(JSON.parse(formatLogLine("json", "DEBUG", "fill")).level, "DEBUG");
    assert.equal(JSON.parse(formatLogLine("json", "CRITICAL", "gate")).level, "CRITICAL");
  });

  it("serialises an Error as the shared three-key object", () => {
    const line = formatLogLine("json", "ERROR", "crash", { error: new Error("boom") });

    const document = JSON.parse(line);
    assert.equal(document.error.name, "Error");
    assert.equal(document.error.message, "boom");
    assert.equal(typeof document.error.stack, "string");
  });

  it("passes structured extras through as fields", () => {
    const document = JSON.parse(formatLogLine("json", "ERROR", "x", { error_code: "FE-RSC-001", digest: "123", route: "/dashboard" }));

    assert.equal(document.error_code, "FE-RSC-001");
    assert.equal(document.digest, "123");
    assert.equal(document.route, "/dashboard");
  });
});

describe("formatLogLine console", () => {
  it("opens with the shape both surfaces share, at every level", () => {
    for (const level of ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] as const) {
      assert.match(plain(formatLogLine("console", level, "hello")), CONSOLE_OPENING);
    }
  });

  it("names the service as the origin where no module and line are given", () => {
    assert.match(plain(formatLogLine("console", "INFO", "hello")), /^INFO {1,5}\S+ \S+ fl_frontend - hello /);
  });

  it("names module and line as the origin where both are given", () => {
    const line = plain(formatLogLine("console", "INFO", "hello", { module: "api", line: 12 }));

    assert.ok(line.includes(" api:12 - hello "), line);
  });

  it("carries the sentinel on both ids outside any request, as the envelope does", () => {
    const line = plain(formatLogLine("console", "INFO", "boot"));

    assert.ok(line.endsWith(" - boot trace_id=SYSTEM span_id=SYSTEM"), line);
  });

  it("writes the ids first among the key=value extras", () => {
    const line = plain(formatLogLine("console", "INFO", "hello", { error_code: "FE-API-001", trace_id: TRACE, span_id: SPAN }));

    assert.ok(line.endsWith(` - hello trace_id=${TRACE} span_id=${SPAN} error_code=FE-API-001`), line);
  });

  it("renders an empty value, or one carrying whitespace, an equals sign or a quote, as a JSON string", () => {
    const line = plain(
      formatLogLine("console", "INFO", "hello", { bare: "abc", spaced: "a b", equalled: "a=b", quoted: 'a"b', ticked: "a'b", empty: "" }),
    );

    assert.ok(line.includes(" bare=abc "), line);
    assert.ok(line.includes(' spaced="a b" '), line);
    assert.ok(line.includes(' equalled="a=b" '), line);
    assert.ok(line.includes(' quoted="a\\"b" '), line);
    assert.ok(line.includes(' ticked="a\'b" '), line);
    assert.ok(line.endsWith(' empty=""'), line);
  });

  /* Six code points `\s` and Python's `str.isspace()` disagree over, and four they share. The
     backend suite parametrises the same ten (`fl_backend/tests/core/test_logging.py ::
     TestConsoleFormatter`): a value one surface quotes and the other writes bare is two line shapes,
     not one. */
  it("quotes a value carrying any code point the quoting class names, and escapes the ones below U+0020", () => {
    for (const codePoint of [0x1c, 0x1d, 0x1e, 0x1f, 0x85, 0xa0, 0x2028, 0x2029, 0x3000, 0xfeff]) {
      const value = `a${String.fromCodePoint(codePoint)}b`;
      const inner = codePoint < 0x20 ? `a\\u${codePoint.toString(16).padStart(4, "0")}b` : value;

      const line = plain(formatLogLine("console", "INFO", "hello", { path: value }));

      assert.ok(line.endsWith(` path="${inner}"`), `U+${codePoint.toString(16).padStart(4, "0")}: ${line}`);
    }
  });

  /* The backend renders these two through `json.dumps` with `ensure_ascii=False` and no separator
     spacing, which is what makes its line these bytes rather than merely this shape
     (`fl_backend/tests/core/test_logging.py :: TestConsoleFormatter`). */
  it("writes a non-ASCII character as itself and a structured value with no space after a separator", () => {
    const line = plain(formatLogLine("console", "INFO", "hello", { team: "IGS Süd", cache_fill: { name: "spiele", args: 1 } }));

    assert.ok(line.includes(' team="IGS Süd"'), line);
    assert.ok(line.endsWith(' cache_fill={"name":"spiele","args":1}'), line);
  });

  /* A number written bare is what makes a status or a duration greppable; quoting it would make
     every figure on the line read as a string. */
  it("renders a non-string value as its JSON encoding, unquoted", () => {
    const line = plain(formatLogLine("console", "INFO", "hello", { status: 401, cached: true, missing: null }));

    assert.ok(line.endsWith(" status=401 cached=true missing=null"), line);
  });

  it("colours the level word and nothing after it", () => {
    const line = formatLogLine("console", "ERROR", "failed");

    assert.match(line, /^\x1b\[\d+mERROR\x1b\[0m {3} /);
    assert.equal(line.slice(line.indexOf("\x1b[0m") + 4).includes("\x1b["), false);
  });

  /* The whole block is shifted rather than each line set to four spaces: a stack frame's own
     indentation is what makes the trace readable. */
  it("puts an error's stack on the following lines, indented four spaces", () => {
    const rendered = plain(formatLogLine("console", "ERROR", "crash", { error: new Error("boom") })).split("\n");

    assert.match(rendered[0] ?? "", CONSOLE_OPENING);
    assert.match(rendered[1] ?? "", /^ {4}Error: boom$/);
    assert.ok(rendered.length > 2);
    for (const stackLine of rendered.slice(2)) assert.match(stackLine, /^ {8}at /);
  });

  // An error carrying no stack is the shape a rejected value takes when it crosses a boundary,
  // and it must still say what was thrown rather than nothing at all.
  it("falls back to the error's name and message where it carries no stack", () => {
    const stackless = new Error("boom");
    stackless.stack = undefined;

    const rendered = plain(formatLogLine("console", "ERROR", "crash", { error: stackless })).split("\n");

    assert.deepEqual(rendered.slice(1), ["    Error: boom"]);
  });

  it("keeps the error off the key=value tail", () => {
    const line = plain(formatLogLine("console", "ERROR", "crash", { error: new Error("boom") }));

    assert.equal(line.split("\n")[0]?.includes("error="), false);
  });
});
