import { doubleApiClient } from "@/test-support/apiClientDouble";
import { describe, expect, it, vi } from "vitest";

import { APIBadStatusError } from "@/core/errors";
import { SERVER_COPY } from "@/core/serverCopy";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a write clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));

const ID = "64b000000000000000000009";

// A fresh link as the backend refuses it for an address on the ban list, which the editor's read does not show.
doubleApiClient(() => {
  throw new APIBadStatusError({
    message: "refused",
    url: `http://backend/api/v0/schiedsrichter/${ID}/confirmation/invite`,
    statusCode: 409,
    serverErrorCode: "schiedsrichter_address_barred",
    refusedFields: [],
    endpoint: "/schiedsrichter/{schiedsrichter_id}/confirmation/invite",
    method: "POST",
    readOnly: false,
    traceId: "0",
  });
});

const { sendSchiedsrichterLink } = await import("./retireSchiedsrichter");

describe("the referee's fresh link", () => {
  // The harm: „Link senden“ for a barred address answering the shared failure, its press repeated to the same refusal.
  it("words a barred address in the ban list's own sentence", async () => {
    expect(await sendSchiedsrichterLink({ id: ID })).toStrictEqual({
      ok: false,
      errorCode: "schiedsrichter_address_barred",
      reason: SERVER_COPY.refusalLine.schiedsrichter_address_barred,
    });
  });
});
