import { assert, describe, expect, it } from "vitest";

import { formatTraceparent, mintSpanId, mintTraceId, readTraceparent } from "./trace.ts";

const TRACE = "a".repeat(32);
const SPAN = "b".repeat(16);
const WELL_FORMED = `00-${TRACE}-${SPAN}-01`;

describe("mintTraceId", () => {
  it("produces 32 lowercase hex, format-identical to nginx's $request_id", () => {
    expect(mintTraceId()).toMatch(/^[a-f0-9]{32}$/);
  });

  it("produces distinct ids", () => {
    expect(mintTraceId()).not.toBe(mintTraceId());
  });
});

describe("mintSpanId", () => {
  it("produces 16 lowercase hex, the W3C span width", () => {
    expect(mintSpanId()).toMatch(/^[a-f0-9]{16}$/);
  });

  it("produces distinct ids", () => {
    expect(mintSpanId()).not.toBe(mintSpanId());
  });

  it("never produces the all-zero span the format reserves", () => {
    for (let attempt = 0; attempt < 64; attempt += 1) expect(mintSpanId()).not.toBe("0".repeat(16));
  });
});

describe("readTraceparent", () => {
  it("takes both ids off the header the edge minted", () => {
    expect(readTraceparent(WELL_FORMED)).toStrictEqual({ traceId: TRACE, spanId: SPAN });
  });

  it("accepts any flags byte, an unsampled one included", () => {
    expect(readTraceparent(`00-${TRACE}-${SPAN}-00`)).toStrictEqual({ traceId: TRACE, spanId: SPAN });
  });

  it("accepts what the minters produce", () => {
    assert.ok(readTraceparent(formatTraceparent({ traceId: mintTraceId(), spanId: mintSpanId() })));
  });

  // The version segment is not a range to grow into: the edge writes `00`, so anything else was
  // written by somebody else.
  it("refuses a version segment other than 00", () => {
    for (const version of ["01", "ff", "0", "000"]) {
      expect(readTraceparent(`${version}-${TRACE}-${SPAN}-01`), version).toBe(undefined);
    }
  });

  it("refuses the all-zero trace and the all-zero span the format reserves", () => {
    expect(readTraceparent(`00-${"0".repeat(32)}-${SPAN}-01`)).toBe(undefined);
    expect(readTraceparent(`00-${TRACE}-${"0".repeat(16)}-01`)).toBe(undefined);
  });

  // Mirrored by `fl_backend/tests/core/test_logging.py :: TestResolveTraceId` entry for entry, in
  // this order: a hop admitting what the other refuses is where injected text enters the stream.
  it("refuses anything that is not the traceparent form", () => {
    const hostile = [
      null,
      "",
      "PROBE-AAA",
      "c0ffee00".repeat(4), // yesterday's bare 32-hex id is not a traceparent
      WELL_FORMED.toUpperCase(),
      `01-${TRACE}-${SPAN}-01`, // a version this validator does not read
      `00-${"0".repeat(32)}-${SPAN}-01`, // all-zero trace id
      `00-${TRACE}-${"0".repeat(16)}-01`, // all-zero span id
      `00-${TRACE.slice(0, 31)}-${SPAN}-01`,
      `00-${TRACE}-${SPAN.slice(0, 15)}-01`,
      `00-${TRACE}-${SPAN}-1`,
      `00-${TRACE}-${SPAN}`, // no flags segment
      `00-${TRACE}-${SPAN}-01-extra`,
      `00-${"x".repeat(65)}-${SPAN}-01`,
      ` 00-${TRACE}-${SPAN}-01`,
      `00-${TRACE}-${SPAN}-01\n`,
      `00-${TRACE}-${SPAN}-01\ndef`,
      `00-${TRACE}-${SPAN}-01","injected":"line`, // log-injection attempt
      "abc\ndef",
    ];

    for (const value of hostile) {
      expect(readTraceparent(value), String(value)).toBe(undefined);
    }
  });

  // Beyond the mirrored list: the backend's reader is typed to a string or nothing, while this one
  // is handed whatever a header record holds.
  it("refuses a value that is not a string at all", () => {
    expect(readTraceparent(undefined)).toBe(undefined);
    expect(readTraceparent(42)).toBe(undefined);
  });
});

describe("formatTraceparent", () => {
  it("writes the version, both ids and the sampled flag", () => {
    expect(formatTraceparent({ traceId: TRACE, spanId: SPAN })).toBe(WELL_FORMED);
  });

  it("writes a header its own reader accepts", () => {
    const ids = { traceId: mintTraceId(), spanId: mintSpanId() };

    expect(readTraceparent(formatTraceparent(ids))).toStrictEqual(ids);
  });
});
