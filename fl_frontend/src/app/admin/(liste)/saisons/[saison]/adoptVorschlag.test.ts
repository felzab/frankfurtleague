import { doubleApiClient } from "@/test-support/apiClientDouble";
import { describe, expect, it, vi } from "vitest";

import { APIBadStatusError } from "@/core/errors";
import { SERVER_COPY } from "@/core/serverCopy";

const SPIELBESTAETIGUNG_ID = "64b000000000000000000007";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a write clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));

// The adoption's save, refused for a later result its bracket's resolution would delete.
doubleApiClient(() => {
  throw new APIBadStatusError({
    message: "refused",
    url: `http://backend/api/v0/spielbestaetigungen/${SPIELBESTAETIGUNG_ID}/adopt`,
    statusCode: 409,
    serverErrorCode: "voided_results_stale",
    refusedFields: [],
    endpoint: `/spielbestaetigungen/${SPIELBESTAETIGUNG_ID}/adopt`,
    method: "POST",
    readOnly: false,
    traceId: "0",
  });
});

const { adoptVorschlag } = await import("./adoptVorschlag");

describe("a proposal's adoption", () => {
  // The adoption confirms no later result, so its save refuses any it would delete; unworded, the press would answer
  // the shared failure line and send the administrator to a retry the same rule refuses again.
  it("says it would delete a later result", async () => {
    const answer = await adoptVorschlag({ id: SPIELBESTAETIGUNG_ID });

    expect(answer).toEqual({ ok: false, errorCode: "voided_results_stale", reason: SERVER_COPY.refusalLine.voided_results_stale });
  });
});
