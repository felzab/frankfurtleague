import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { registerDoubles } from "@/core/exportingModule.ts";

/** Every error line the handlers wrote: its message and its fields. */
const lines: { message: string; meta: Record<string, unknown> | undefined }[] = [];
const LOGGING = {
  logger: {
    error: (message: string, _error: unknown, meta?: Record<string, unknown>): void => void lines.push({ message, meta }),
  },
};

registerDoubles({ modules: { "core/logging.ts": LOGGING } });

const { nullAfterLoggingContractBreak, nullUnlessContractBreak } = await import("./degradedRead.ts");
const { APIBadStatusError, APIMalformedDataError, APINetworkError, ApiUnsentError, ContractBreakError, UnreadGrantError } =
  await import("@/core/errors.ts");
const { redirect } = await import("next/navigation");

const REQUEST = {
  url: "http://backend/api/v0/einwilligung/seiten",
  endpoint: "/einwilligung/seiten",
  method: "GET",
  readOnly: true,
  traceId: "0",
};

const answeredWith = (statusCode: number, serverErrorCode: string) =>
  new APIBadStatusError({ ...REQUEST, message: "API returned a bad status.", statusCode, serverErrorCode });
const offSchema = () => new APIMalformedDataError({ ...REQUEST, message: "m", statusCode: 200 });
const unanswered = () => new APINetworkError({ ...REQUEST, message: "Request timed out.", isTimeout: true });

/** The navigation `redirect()` throws, as a read guarded by the admin check throws it. */
function aRedirect(): unknown {
  try {
    redirect("/signin");
  } catch (error) {
    return error;
  }
}

beforeEach(() => {
  lines.length = 0;
});

describe("a page's degraded read's rejection handler", () => {
  /* A bug in a read's narrowing settles to the same panel a failed read shows, so the line is the only trace of it. */
  it("logs an untyped throw under the error boundary's code and settles it to null", () => {
    assert.equal(nullUnlessContractBreak(new TypeError("Cannot read properties of undefined (reading 'zustand')")), null);

    assert.deepEqual(
      lines.map(({ meta }) => meta?.error_code),
      ["FE-RSC-001"],
    );
  });

  it("logs a failure the API answered with a 5xx under the error's own code and status", () => {
    assert.equal(nullUnlessContractBreak(answeredWith(500, "DB-FAIL-001")), null);

    assert.deepEqual(
      lines.map(({ meta }) => [meta?.error_code, meta?.status, meta?.server_error_code]),
      [["FE-API-001", 500, "DB-FAIL-001"]],
    );
  });

  /* What a `"use cache"` fill's throw arrives as: Next's own line of the original carries the same digest. */
  it("carries the digest of a throw out of a cached fill", () => {
    const redacted = Object.assign(new Error("An error occurred in the Server Components render."), { digest: "3147502261" });

    assert.equal(nullUnlessContractBreak(redacted), null);

    assert.deepEqual(
      lines.map(({ meta }) => [meta?.error_code, meta?.digest]),
      [["FE-RSC-001", "3147502261"]],
    );
  });

  it("settles a read the network never answered, one never sent, and one a rule refused to null with no line", () => {
    for (const failure of [unanswered(), new ApiUnsentError("GET"), answeredWith(409, "REQ-BEWERBUNG-008")]) {
      assert.equal(nullUnlessContractBreak(failure), null, failure.name);
    }

    assert.deepEqual(lines, []);
  });

  /* The admin guard logged its unread grant as it refused, so a second line would count one outage twice. */
  it("settles a read whose administrator's grant went unread to null with no line", () => {
    assert.equal(nullUnlessContractBreak(new UnreadGrantError()), null);

    assert.deepEqual(lines, []);
  });

  /* A rotated key or a route the API does not serve is this deployment's fault, refused on every request alike. */
  it("logs a protocol refusal under the error's own code and settles it to null", () => {
    for (const code of ["REQ-AUTH-001", "REQ-ROUTE-001"]) assert.equal(nullUnlessContractBreak(answeredWith(403, code)), null, code);

    assert.deepEqual(
      lines.map(({ meta }) => [meta?.error_code, meta?.server_error_code]),
      [
        ["FE-API-001", "REQ-AUTH-001"],
        ["FE-API-001", "REQ-ROUTE-001"],
      ],
    );
  });

  it("rethrows a contract break and an answer off its schema to the error boundary, which logs them", () => {
    assert.throws(() => nullUnlessContractBreak(new ContractBreakError("no label")), ContractBreakError);
    assert.throws(() => nullUnlessContractBreak(offSchema()), APIMalformedDataError);

    assert.deepEqual(lines, []);
  });

  /* An admin read's guard redirects a signed-out administrator: settled to null, the page would render the count
     unreadable instead of going to the sign-in. */
  it("rethrows a navigation the read threw", () => {
    const navigation = aRedirect();

    assert.throws(
      () => nullUnlessContractBreak(navigation),
      (thrown) => thrown === navigation,
    );
    assert.deepEqual(lines, []);
  });
});

describe("an admin editor's label readout's rejection handler", () => {
  /* The editor is the operator's tool for repairing the record, so it stands, and the line is the break's record. */
  it("logs a contract break and an answer off its schema under the error boundary's code and settles both to null", () => {
    assert.equal(nullAfterLoggingContractBreak(new ContractBreakError("no label")), null);
    assert.equal(nullAfterLoggingContractBreak(offSchema()), null);

    assert.deepEqual(
      lines.map(({ message, meta }) => [message, meta?.error_code]),
      [
        ["Contract break absorbed by an admin readout", "FE-RSC-001"],
        ["Contract break absorbed by an admin readout", "FE-RSC-001"],
      ],
    );
  });

  it("logs an untyped throw and settles it to null", () => {
    assert.equal(nullAfterLoggingContractBreak(new TypeError("Cannot read properties of null (reading 'text_version')")), null);

    assert.deepEqual(
      lines.map(({ message, meta }) => [message, meta?.error_code]),
      [["An admin readout's read failed and its editor stands", "FE-RSC-001"]],
    );
  });

  it("settles a read the network never answered, one never sent, and one a rule refused to null with no line", () => {
    for (const failure of [unanswered(), new ApiUnsentError("GET"), answeredWith(409, "REQ-EINWILLIGUNG-001")]) {
      assert.equal(nullAfterLoggingContractBreak(failure), null, failure.name);
    }

    assert.deepEqual(lines, []);
  });

  it("rethrows a navigation the read threw", () => {
    const navigation = aRedirect();

    assert.throws(
      () => nullAfterLoggingContractBreak(navigation),
      (thrown) => thrown === navigation,
    );
    assert.deepEqual(lines, []);
  });
});
