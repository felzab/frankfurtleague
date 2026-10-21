import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { registerDoubles } from "@/core/exportingModule.ts";

/** Every error line written: what it was handed for the error, and its fields. */
const lines: { attached: unknown; meta: Record<string, unknown> | undefined }[] = [];
const LOGGING = {
  logger: {
    error: (_message: string, attached: unknown, meta?: Record<string, unknown>): void => void lines.push({ attached, meta }),
  },
};

registerDoubles({ modules: { "core/logging.ts": LOGGING } });

const { logActionFailure } = await import("./actionFailure.ts");
const { APIBadStatusError } = await import("@/core/errors.ts");

const ADDRESS = "quillhilde@example.com";

const SENT = { url: "http://api/x", endpoint: "/x", traceId: "c".repeat(32), method: "PATCH", readOnly: false };

beforeEach(() => {
  lines.length = 0;
});

describe("the line an action's or a route's failure writes", () => {
  /* What a sign-in store or library call left uncaught throws: its message and stack are the submitted address's way into the log. */
  it("hands the log no error for an untyped throw, naming it alone", () => {
    logActionFailure("Admin mutation failed: probeAction", new Error(`no user ${ADDRESS}`));

    assert.deepEqual(lines, [{ attached: undefined, meta: { error_code: "FE-ACT-001", name: "Error", digest: undefined } }]);
  });

  it("hands the log no error for a typed API failure either, filing it under its own code and the backend's trace", () => {
    logActionFailure(
      "Admin mutation failed: probeAction",
      new APIBadStatusError({ ...SENT, message: ADDRESS, statusCode: 500, serverErrorCode: "DB-FAIL-001" }),
    );

    assert.equal(lines[0]?.attached, undefined, "the line carries the attached error");
    assert.equal(lines[0]?.meta?.error_code, "FE-API-001");
    assert.equal(lines[0]?.meta?.trace_id, SENT.traceId);
  });
});
