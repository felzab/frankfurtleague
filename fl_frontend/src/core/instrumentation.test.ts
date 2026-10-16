import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { registerDoubles } from "./exportingModule.ts";

/** Every line the doubled logger was handed, with the fields it carried. */
const lines: { message: string; fields: Record<string, unknown> | undefined }[] = [];

registerDoubles({
  modules: {
    "core/logging.ts": {
      logger: {
        error: (message: string, _error: unknown, fields?: Record<string, unknown>): void => void lines.push({ message, fields }),
      },
    },
  },
});

const { onRequestError } = await import("./instrumentation.ts");
const { APIBadStatusError } = await import("./errors.ts");

const REQUEST = { path: "/bereich/admin/schiedsrichter", method: "GET", headers: {} };
const CONTEXT = { routePath: "/bereich/admin/schiedsrichter/page", digest: "1234567890" };

beforeEach(() => {
  lines.length = 0;
});

describe("the line a server-side crash writes", () => {
  it("carries no status where the error carries none, the hook being handed no response status", async () => {
    await onRequestError(new Error("Cannot read properties of undefined"), REQUEST, CONTEXT);

    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.fields?.["error_code"], "FE-RSC-001");
    assert.equal(lines[0]?.fields?.["status"], undefined);
  });

  it("carries the status the failing call was answered with", async () => {
    const failure = new APIBadStatusError({
      message: "refused",
      url: "http://backend/api/v0/schiedsrichter",
      statusCode: 503,
      endpoint: "/schiedsrichter",
      method: "GET",
      readOnly: true,
      traceId: "0",
    });

    await onRequestError(failure, REQUEST, CONTEXT);

    assert.equal(lines[0]?.fields?.["status"], 503);
  });
});
