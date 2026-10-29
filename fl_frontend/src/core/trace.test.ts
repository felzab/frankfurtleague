import { describe, expect, it } from "vitest";

import { formatTraceparent, mintTraceId, readTraceparent } from "./trace.ts";

const TRACE = "a".repeat(32);
const PARENT = "b".repeat(16);
const WELL_FORMED = `00-${TRACE}-${PARENT}-01`;

describe("readTraceparent", () => {
  it("reads back the trace id of a header its own minters wrote", () => {
    const traceId = mintTraceId();

    expect(readTraceparent(formatTraceparent(traceId))).toBe(traceId);
  });

  // What a caller writes into the header reaches the backend and every line of the request, so
  // anything but the edge's own form is replaced by a minted id rather than read.
  it("refuses anything that is not the traceparent form", () => {
    const hostile = [
      undefined,
      42,
      "",
      "PROBE-AAA",
      "c0ffee00".repeat(4),
      WELL_FORMED.toUpperCase(),
      `01-${TRACE}-${PARENT}-01`,
      `00-${"0".repeat(32)}-${PARENT}-01`,
      `00-${TRACE}-${"0".repeat(16)}-01`,
      `00-${TRACE}-${PARENT}`,
      `00-${TRACE}-${PARENT}-01-extra`,
      ` ${WELL_FORMED}`,
      `${WELL_FORMED}\n`,
      `${WELL_FORMED}","injected":"line`,
    ];

    for (const value of hostile) expect(readTraceparent(value), String(value)).toBe(undefined);
  });
});
