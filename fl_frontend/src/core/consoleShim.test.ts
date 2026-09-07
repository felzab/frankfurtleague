import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, describe, it } from "node:test";

import { writtenBy } from "./stdoutCapture.ts";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

// Getters, not values: the format decides whether the shim installs at all, and the threshold
// whether a shimmed `console.debug` reaches the stream.
const CONFIG_DOUBLE = `export const frontend_config = {
  get LOG_FORMAT() { return globalThis.__flLogFormat; },
  get LOG_LEVEL() { return globalThis.__flLogLevel; },
};`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const settings = globalThis as { __flLogFormat?: string; __flLogLevel?: string };
settings.__flLogFormat = "json";
settings.__flLogLevel = "DEBUG";

const { installConsoleShim } = await import("./consoleShim.ts");
const { runWithRequestScope } = await import("./requestScope.ts");

/** The process's own console, put back after every case so the runner's reporter keeps it. */
const ORIGINAL_CONSOLE = { ...console };

const TRACE = "a".repeat(32);
const SPAN = "b".repeat(16);

afterEach(() => {
  Object.assign(console, ORIGINAL_CONSOLE);
  settings.__flLogFormat = "json";
  settings.__flLogLevel = "DEBUG";
});

describe("installConsoleShim", () => {
  // The logger's console line leaves through `console.*`; a shim under that format would wrap the
  // writer it forwards to and recurse.
  it("installs nothing under the console format", () => {
    settings.__flLogFormat = "console";

    installConsoleShim();

    assert.equal(console.log, ORIGINAL_CONSOLE.log);
    assert.equal(console.error, ORIGINAL_CONSOLE.error);
    assert.equal(console.trace, ORIGINAL_CONSOLE.trace);
    assert.equal(console.table, ORIGINAL_CONSOLE.table);
  });

  it("replaces every writing method under the json format", () => {
    installConsoleShim();

    const writing = [
      "log",
      "info",
      "debug",
      "warn",
      "error",
      "trace",
      "assert",
      "dir",
      "dirxml",
      "table",
      "group",
      "groupCollapsed",
      "groupEnd",
      "count",
      "countReset",
      "time",
      "timeEnd",
      "timeLog",
      "clear",
    ] as const;
    for (const method of writing) assert.notEqual(console[method], ORIGINAL_CONSOLE[method], method);
  });

  /* Each call is graded on the stream, not on the method: one parseable document, at the level of
     the stream Node would have written to, carrying `source` so a reader can tell it from the app's. */
  it("turns each method's output into one document per call, coded where the level is a failure", () => {
    installConsoleShim();

    // The code column is empty below WARNING: a forwarded code names the route a failure arrived
    // by, and an informational line has none to look up (`docs/logging/error-codes.md` §4).
    const cases: [string, () => void, string | undefined, RegExp | undefined, string | undefined][] = [
      ["log", () => console.log("a %s", "b"), "INFO", /^a b$/, undefined],
      ["info", () => console.info("i"), "INFO", /^i$/, undefined],
      ["debug", () => console.debug("d"), "DEBUG", /^d$/, undefined],
      ["warn", () => console.warn("w"), "WARNING", /^w$/, "FE-CONSOLE-001"],
      ["error", () => console.error("e"), "ERROR", /^e$/, "FE-CONSOLE-001"],
      ["trace", () => console.trace("t"), "ERROR", /^Trace: t\n {4}at /, "FE-CONSOLE-001"],
      ["assert", () => console.assert(false, "boom"), "ERROR", /^Assertion failed: boom$/, "FE-CONSOLE-001"],
      ["dir", () => console.dir({ a: 1 }), "INFO", /^\{ a: 1 \}$/, undefined],
      ["dirxml", () => console.dirxml({ a: 1 }), "INFO", /^\{ a: 1 \}$/, undefined],
      ["table", () => console.table([{ a: 1 }]), "INFO", /^┌.*\n.*\n.*\n.*\n└.*┘$/s, undefined],
      ["group", () => console.group("g"), "INFO", /^g$/, undefined],
      ["groupEnd", () => console.groupEnd(), undefined, undefined, undefined],
      ["count", () => console.count("c"), "INFO", /^c: 1$/, undefined],
      ["countReset", () => console.countReset("c"), undefined, undefined, undefined],
      ["time", () => console.time("k"), undefined, undefined, undefined],
      ["timeLog", () => console.timeLog("k"), "INFO", /^k: \d/, undefined],
      ["timeEnd", () => console.timeEnd("k"), "INFO", /^k: \d/, undefined],
      ["clear", () => console.clear(), undefined, undefined, undefined],
    ];

    for (const [method, call, level, message, code] of cases) {
      const { documents } = writtenBy(call);

      if (level === undefined) {
        assert.deepEqual(documents, [], method);
        continue;
      }
      assert.equal(documents.length, 1, method);
      assert.equal(documents[0]?.level, level, method);
      assert.equal(documents[0]?.source, "console", method);
      assert.equal(documents[0]?.error_code, code, method);
      assert.match(String(documents[0]?.message), message ?? /^/, method);
    }
  });

  it("holds a shimmed console.debug to the same threshold as the logger", () => {
    installConsoleShim();
    settings.__flLogLevel = "INFO";

    assert.deepEqual(writtenBy(() => console.debug("dropped")).documents, []);

    settings.__flLogLevel = "DEBUG";

    assert.equal(writtenBy(() => console.debug("kept")).documents.length, 1);
  });

  it("passes a line that is already one document through untouched", () => {
    installConsoleShim();

    const { raw } = writtenBy(() => console.log('{"already":"json"}'));

    assert.deepEqual(raw, ['{"already":"json"}\n']);
  });

  // Next's own `⨯ Error` dump is several lines through one `console.error`.
  it("keeps a multi-line dump inside one document", () => {
    installConsoleShim();

    const { documents } = writtenBy(() => console.error("first\nsecond"));

    assert.equal(documents.length, 1);
    assert.equal(documents[0]?.message, "first\nsecond");
  });

  it("carries the request's ids inside a scope and the sentinel outside one", async () => {
    installConsoleShim();

    const outside = writtenBy(() => console.log("boot")).documents[0];
    assert.equal(outside?.trace_id, "SYSTEM");
    assert.equal(outside?.span_id, "SYSTEM");

    await runWithRequestScope({ traceId: TRACE, spanId: SPAN }, async () => {
      const inside = writtenBy(() => console.log("scoped")).documents[0];
      assert.equal(inside?.trace_id, TRACE);
      assert.equal(inside?.span_id, SPAN);
    });
  });
});
