/**
 * CORE · log format tests
 *
 * Pins the JSON contract shared with the backend (`docs/logging/spec.md`): one document per line, the
 * same field names, the same level vocabulary, the same error object shape. Nothing else in the
 * toolchain sees a log line, so this suite is the only net under those claims.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatLogLine } from "./logFormat.ts";

const TIMESTAMP_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("formatLogLine json", () => {
  it("emits one parseable document with the shared field set", () => {
    const line = formatLogLine("json", "INFO", "hello", { correlation_id: "a".repeat(32) });

    const document = JSON.parse(line);
    assert.ok(!line.includes("\n"));
    assert.equal(document.level, "INFO");
    assert.equal(document.service, "fl_frontend");
    assert.equal(document.correlation_id, "a".repeat(32));
    assert.equal(document.message, "hello");
    assert.match(document.timestamp, TIMESTAMP_SHAPE);
  });

  it("carries the SYSTEM sentinel outside any request", () => {
    const document = JSON.parse(formatLogLine("json", "INFO", "boot"));

    assert.equal(document.correlation_id, "SYSTEM");
  });

  it("uses the backend's level vocabulary, WARNING not WARN", () => {
    const document = JSON.parse(formatLogLine("json", "WARNING", "careful"));

    assert.equal(document.level, "WARNING");
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
  it("mirrors the backend's console shape: level, timestamp, id, dash, message", () => {
    const line = formatLogLine("console", "INFO", "hello");

    assert.ok(line.includes("INFO"));
    assert.match(line, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \| <SYSTEM> - hello/);
  });

  it("shows the correlation id when one exists", () => {
    const line = formatLogLine("console", "ERROR", "failed", { correlation_id: "abcd1234" });

    assert.ok(line.includes("<abcd1234>"));
  });
});
