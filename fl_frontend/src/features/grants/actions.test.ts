import { doubleApiClient } from "@/test-support/apiClientDouble";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

const OWNER = "owner@example.org";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({
  judgeAdminRequest: async () => {
    (await import("@/core/requestScope")).setRequestActor({ email: OWNER, lane: "admin", authTime: 0, factor: "passkey" });
    return { session: {} };
  },
  passesPasskeyTouch: async () => true,
}));

/** How many calls reached the doubled client. */
const state = vi.hoisted(() => ({ sent: 0 }));

doubleApiClient(() => {
  state.sent += 1;
  return { grant_id: "64b000000000000000000002" };
});

const { addAdministrator } = await import("./actions");

const add = (email: string) => addAdministrator({ email, holder: OWNER });

beforeEach(() => {
  state.sent = 0;
});

describe("adding an administrator", () => {
  /* The API takes every atext character and the sign-in library does not, so the grant would stand and admit nobody. */
  it("refuses an address the sign-in library refuses, reaching no backend", async () => {
    expect(await add("a~b@example.de")).toStrictEqual({
      ok: false,
      fieldErrors: { email: COPY.shared.field.format(COPY.shared.field.exampleAddress) },
    });
    expect(state.sent).toBe(0);
  });
});
