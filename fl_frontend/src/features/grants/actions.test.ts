import { doubleApiAnswers } from "@/test-support/apiClientDouble";
import { refused } from "@/test-support/refusals";
import { describe, expect, it, vi } from "vitest";

import { SERVER_COPY } from "@/core/serverCopy";

import type { Code } from "@/core/generated/client/types";

const HOLDER = "owner@example.org";
const GRANT_ID = "64b000000000000000000002";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({
  judgeAdminRequest: async () => {
    (await import("@/core/requestScope")).setRequestActor({ email: HOLDER, lane: "admin", authTime: 0, factor: "passkey" });
    return { session: {} };
  },
  passesPasskeyTouch: async () => true,
}));

const { calls, answerWith } = doubleApiAnswers();

const { addAdministrator, startHandover } = await import("./actions");

/** The backend refusing every call with `code`, naming the address's box where `boxed`, as `find_exists_refusal` does. */
const refusing = (code: Code, boxed: boolean) =>
  answerWith(async () => {
    throw refused(code, { fields: boxed ? [{ path: ["email"], kind: code, ctx: {}, in: "body" }] : [] });
  });

// The harm: both dialogs close before the passkey touch, so their answer is a toast, where a box's phrase or the line
// pointing at the fields names nothing in sight.
describe("the administrators' dialogs", () => {
  it("refuse an address a grant holds in a sentence naming it", async () => {
    refusing("grant_exists", true);

    expect(await addAdministrator({ email: "max@example.org", holder: HOLDER })).toStrictEqual({
      ok: false,
      errorCode: "grant_exists",
      reason: SERVER_COPY.refusalLine.grant_exists,
    });
  });

  it("refuse an address of the wrong shape in the box's sentence, before anything is sent", async () => {
    expect(await addAdministrator({ email: "max@example", holder: HOLDER })).toStrictEqual({
      ok: false,
      reason: SERVER_COPY.closedDialog.format.address,
    });
    expect(calls).toHaveLength(0);
  });

  it("refuse a handover to a banned address in its sentence", async () => {
    refusing("grant_barred", false);

    expect(await startHandover({ grant_id: GRANT_ID, holder: HOLDER })).toStrictEqual({
      ok: false,
      errorCode: "grant_barred",
      reason: SERVER_COPY.refusalLine.grant_barred,
    });
  });
});
