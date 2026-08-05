/**
 * CORE · correlation id tests
 *
 * The minted format must stay joinable with nginx's `$request_id` (32 lowercase hex), and the
 * validator must refuse anything that could smuggle content into a log line (`docs/logging.md`).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isWellFormedCorrelationId, mintCorrelationId } from "./correlation.ts";

describe("mintCorrelationId", () => {
  it("produces 32 lowercase hex, format-identical to nginx's $request_id", () => {
    assert.match(mintCorrelationId(), /^[a-f0-9]{32}$/);
  });

  it("produces distinct ids", () => {
    assert.notEqual(mintCorrelationId(), mintCorrelationId());
  });
});

describe("isWellFormedCorrelationId", () => {
  it("accepts what nginx and the minter produce", () => {
    assert.ok(isWellFormedCorrelationId(mintCorrelationId()));
    assert.ok(isWellFormedCorrelationId("c0ffee00".repeat(4)));
  });

  it("refuses anything that is not plain bounded hex", () => {
    for (const hostile of [null, undefined, "", "PROBE-AAA", "x".repeat(65), 'a1b2","injected":"line', "abc\ndef", 42]) {
      assert.equal(isWellFormedCorrelationId(hostile), false, String(hostile));
    }
  });
});
