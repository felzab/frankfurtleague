import { doubleApiClient } from "@/test-support/apiClientDouble";
import { describe, expect, it, vi } from "vitest";

import { APIBadStatusError } from "@/core/errors";
import { SERVER_COPY } from "@/core/serverCopy";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a write clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));

// The create, refused for a planned season another administrator created after the list was read.
doubleApiClient(() => {
  throw new APIBadStatusError({
    message: "refused",
    url: "http://backend/api/v0/saisons",
    statusCode: 409,
    serverErrorCode: "create_saison_future_stands",
    refusedFields: [],
    endpoint: "/saisons",
    method: "POST",
    readOnly: false,
    traceId: "0",
  });
});

const { createSaison } = await import("./createSaison");

describe("a season's create", () => {
  // The loser of two creates at once meets this code too; unworded, the press would answer the shared failure line and
  // send the administrator to a retry the same rule refuses again.
  it("says a planned season already stands", async () => {
    const answer = await createSaison({ start_date: "2028-02-01", end_date: "2028-07-15" });

    expect(answer).toEqual({
      ok: false,
      errorCode: "create_saison_future_stands",
      reason: SERVER_COPY.refusalLine.create_saison_future_stands,
    });
  });
});
