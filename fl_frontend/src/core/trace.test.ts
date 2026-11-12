import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { formatTraceparent, mintTraceId, readTraceparent } from "./trace.ts";

/** One table both trace readers refuse; `fl_backend/tests/core/test_logging.py` holds the API's half. */
const TRACEPARENTS = z
  .array(z.object({ case: z.string(), header: z.string() }))
  .parse(
    JSON.parse(readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", "fl_backend", "tests", "shared", "traceparents.json"), "utf8")),
  );

describe("readTraceparent", () => {
  it("reads back the trace id of a header its own minters wrote", () => {
    const traceId = mintTraceId();

    expect(readTraceparent(formatTraceparent(traceId))).toBe(traceId);
  });

  // What a caller writes into the header reaches the backend and every line of the request, so
  // anything but the edge's own form is replaced by a minted id rather than read.
  it("refuses anything that is not the traceparent form", () => {
    // Beside the table, which holds strings alone: a header absent, and a value no header can carry.
    const hostile = [undefined, 42, ...TRACEPARENTS.map((row) => row.header)];

    for (const value of hostile) expect(readTraceparent(value), String(value)).toBe(undefined);
  });
});
