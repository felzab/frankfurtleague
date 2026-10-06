import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { APIMalformedDataError, ContractBreakError, nullUnlessContractBreak } from "./errors.ts";

describe("a degraded read's rejection handler", () => {
  /* Every page reading the consent registry hands its rejection to this one handler: a page's own case
     holds that it does, and this one what the handler rethrows. */
  it("settles a failed read to null, and rethrows a contract break and an answer off its schema", () => {
    const offSchema = new APIMalformedDataError({
      message: "m",
      url: "http://backend/api/v0/einwilligung/seiten",
      statusCode: 200,
      endpoint: "/einwilligung/seiten",
      method: "GET",
      readOnly: true,
      traceId: "0",
    });

    assert.equal(nullUnlessContractBreak(new Error("the backend failed the read")), null);
    assert.throws(() => nullUnlessContractBreak(new ContractBreakError("no label")), ContractBreakError);
    assert.throws(() => nullUnlessContractBreak(offSchema), APIMalformedDataError);
  });
});
