import { doubleApiClient } from "@/test-support/apiClientDouble";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));

doubleApiClient(() => {
  throw new APIBadStatusError({
    message: "refused",
    url: "http://backend/api/v0/",
    statusCode: 409,
    serverErrorCode: "trikot_farbe_taken",
    endpoint: "/",
    traceId: "0",
    refusedFields: [{ path: ["trikot_farbe"], kind: "trikot_farbe_taken", ctx: {}, in: "body" }],
  });
});

const { enterTeam } = await import("./enterTeam");

describe("an entry", () => {
  // The list of codes the screen words is held by nothing else: the shared failure line sends a retry the same rule refuses.
  it("answers a colour another row holds on its box", async () => {
    const answer = await enterTeam({ saison_id: "2027", gruppe: "A", trikot_farbe: "blau", club: "64b000000000000000000002" });

    expect(answer).toMatchObject({ ok: false, fieldErrors: { trikot_farbe: COPY.shared.field.taken } });
  });
});
