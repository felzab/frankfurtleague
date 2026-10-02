import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { registerDoubles } from "./exportingModule.ts";
import { documentsWrittenBy } from "./stdoutCapture.ts";

// Getters, not values: one process holds one module registry, and the threshold and the format are
// exactly the two switches every case below has to flip.
const CONFIG_DOUBLE = {
  frontend_config: {
    get LOG_FORMAT() {
      return settings.format;
    },
    get LOG_LEVEL() {
      return settings.level;
    },
  },
};

registerDoubles({
  modules: {
    "core/config.ts": CONFIG_DOUBLE,
  },
});

/** What the doubled config answers, which each case sets. */
const settings: { format?: string; level?: string } = {};
settings.format = "json";
settings.level = "INFO";

const { logger } = await import("./logging.ts");
const { runWithRequestScope } = await import("./requestScope.ts");
const { LOG_THRESHOLDS } = await import("./logFormat.ts");

const TRACE = "a".repeat(32);
const SPAN = "b".repeat(16);
const CONSOLE_OPENING = /^\x1b\[\d+m(DEBUG|INFO|WARNING|ERROR)\x1b\[0m {1,5}\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} fl_frontend - /;

afterEach(() => {
  settings.format = "json";
  settings.level = "INFO";
});

describe("the LOG_LEVEL threshold", () => {
  it("drops a DEBUG line at the default INFO", () => {
    assert.deepEqual(
      documentsWrittenBy(() => logger.debug("fill")),
      [],
    );
  });

  it("writes a DEBUG line once the threshold is DEBUG", () => {
    settings.level = "DEBUG";

    const [document] = documentsWrittenBy(() => logger.debug("fill"));

    assert.equal(document?.level, "DEBUG");
    assert.equal(document?.message, "fill");
  });

  // The backend's numbering: a threshold set once on the server means the same thing to both.
  it("keeps every level at or above the threshold and nothing below it", () => {
    settings.level = "WARNING";

    const written = documentsWrittenBy(() => {
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
    });

    assert.deepEqual(
      written.map((document) => document.level),
      ["WARNING", "ERROR"],
    );
  });

  // The one value `config.ts` must never admit is the one no writer reaches: at it the application
  // log goes empty and the stream reads as a quiet service rather than as a silenced one.
  it("leaves a writer above every threshold the environment may name", () => {
    for (const threshold of LOG_THRESHOLDS) {
      settings.level = threshold;

      const written = documentsWrittenBy(() => {
        logger.debug("d");
        logger.info("i");
        logger.warn("w");
        logger.error("e");
      });

      assert.ok(written.length > 0, `${threshold} drops every line the application writes`);
    }
  });
});

describe("the json format", () => {
  it("writes to stdout and never through console, which the shim wraps", () => {
    const originalLog = console.log;
    let consoleCalls = 0;
    console.log = () => {
      consoleCalls += 1;
    };
    try {
      const written = documentsWrittenBy(() => logger.info("hello"));

      assert.equal(written.length, 1);
      assert.equal(consoleCalls, 0);
    } finally {
      console.log = originalLog;
    }
  });

  it("carries the sentinel on both ids outside any request", () => {
    const [document] = documentsWrittenBy(() => logger.info("boot"));

    assert.equal(document?.trace_id, "SYSTEM");
    assert.equal(document?.span_id, "SYSTEM");
  });

  it("takes both ids off the request scope", async () => {
    let written: Record<string, unknown>[] = [];
    await runWithRequestScope({ traceId: TRACE, spanId: SPAN }, async () => {
      written = documentsWrittenBy(() => logger.info("scoped"));
    });

    assert.equal(written[0]?.trace_id, TRACE);
    assert.equal(written[0]?.span_id, SPAN);
  });

  // A real trace under the sentinel span would file this hop's work under no hop (L12): a mail sent
  // from a job and a crash report read off its own header are the writers in this position.
  it("mints a span beside a trace a caller names outside any scope", () => {
    const [document] = documentsWrittenBy(() => logger.info("mail.send_failed", { trace_id: TRACE }));

    assert.equal(document?.trace_id, TRACE);
    assert.match(String(document?.span_id), /^[a-f0-9]{16}$/);
  });

  it("keeps the span a caller names", () => {
    const [document] = documentsWrittenBy(() => logger.info("cache fill", { trace_id: TRACE, span_id: SPAN }));

    assert.equal(document?.span_id, SPAN);
  });

  it("puts an attached error last", () => {
    const [document] = documentsWrittenBy(() => logger.error("crash", new Error("boom"), { error_code: "FE-ACT-001" }));

    assert.deepEqual(Object.keys(document ?? {}), ["timestamp", "level", "service", "trace_id", "span_id", "message", "error_code", "error"]);
  });
});

describe("the console format", () => {
  it("writes the one console shape through console.*, each level to its own method", () => {
    settings.format = "console";
    settings.level = "DEBUG";
    const original = { debug: console.debug, log: console.log, warn: console.warn, error: console.error };
    const calls: [string, string][] = [];
    console.debug = (line: string) => calls.push(["debug", line]);
    console.log = (line: string) => calls.push(["log", line]);
    console.warn = (line: string) => calls.push(["warn", line]);
    console.error = (line: string) => calls.push(["error", line]);
    try {
      const stdoutDocuments = documentsWrittenBy(() => {
        logger.debug("d");
        logger.info("i");
        logger.warn("w");
        logger.error("e");
      });

      assert.deepEqual(stdoutDocuments, []);
      assert.deepEqual(
        calls.map(([method]) => method),
        ["debug", "log", "warn", "error"],
      );
      for (const [, line] of calls) assert.match(line, CONSOLE_OPENING);
    } finally {
      Object.assign(console, original);
    }
  });
});
