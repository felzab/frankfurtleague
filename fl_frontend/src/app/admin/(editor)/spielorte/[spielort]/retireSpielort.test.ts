import { doubleApiClient } from "@/test-support/apiClientDouble";
import { describe, expect, it, vi } from "vitest";

import { APIBadStatusError } from "@/core/errors";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a write clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));

const ID = "64b000000000000000000009";

// The retirement as the backend refuses it while matches still to come are booked at the venue: on the path's id,
// naming those matches and their count as the refusal's bounds.
doubleApiClient(() => {
  throw new APIBadStatusError({
    message: "refused",
    url: `http://backend/api/v0/spielorte/${ID}`,
    statusCode: 409,
    serverErrorCode: "spielort_still_booked",
    refusedFields: [{ in: "path", path: ["spielort_id"], kind: "spielort_still_booked", ctx: { spiel_nrs: [4, 7, 9], count: 3 } }],
    endpoint: "/spielorte/{spielort_id}",
    method: "DELETE",
    readOnly: false,
    traceId: "0",
  });
});

const { retireSpielort } = await import("./retireSpielort");

describe("the venue's retirement", () => {
  // The harm: the server moves which matches block the retirement, and the dialog names others than those to move.
  it("names the matches still booked there by the numbers the refusal carries", async () => {
    const answer = await retireSpielort({ id: ID });
    expect(answer).toMatchObject({ ok: false, errorCode: "spielort_still_booked" });
    expect(answer.ok ? undefined : answer.reason).toContain("Spiel 4, 7 und 9");
  });
});
