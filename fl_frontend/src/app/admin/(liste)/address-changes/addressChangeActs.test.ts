import { doubleApiClient } from "@/test-support/apiClientDouble";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

const held = vi.hoisted(() => ({ accountStands: false, accountAtNew: false }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }), passesPasskeyTouch: async () => true }));
vi.mock("@/core/requestScope", async (original) => ({
  ...(await original<object>()),
  getRequestActor: () => ({ email: "anna@example.org" }),
}));
vi.mock("@/core/auth/accounts", () => ({ accountStandsAt: async () => held.accountStands }));
vi.mock("@/features/address-change/account", () => ({ accountAtNewAddress: async () => held.accountAtNew }));

const calls = doubleApiClient(() => ({}));

const { resendChangeLink, startLostMailboxChange } = await import("./addressChangeActs");

const HOLDER = "anna@example.org";
const START = { address: "paul@example.org", email: "paul.neu@example.org", holder: HOLDER };
const ID = "64b000000000000000000002";

beforeEach(() => {
  held.accountStands = false;
  held.accountAtNew = false;
  calls.length = 0;
});

// The sign-in store is this server's and the backend cannot read it: a change confirmed onto such an address leaves the
// person's passkeys behind on the old account, and nothing fails.
describe("a start, an account standing at the new address", () => {
  it("is refused on the new address's box, and nothing is posted", async () => {
    held.accountStands = true;

    expect(await startLostMailboxChange(START)).toMatchObject({ ok: false, fieldErrors: { email: COPY.shared.field.taken } });
    expect(calls).toHaveLength(0);
  });
});

// The API takes every atext character and the sign-in library does not: the person moved there meets a sign-in that
// answers as sent, and no code ever comes.
describe("a start onto an address the sign-in library refuses", () => {
  it("is refused on the new address's box, and nothing is posted", async () => {
    expect(await startLostMailboxChange({ ...START, email: "a~b@example.de" })).toMatchObject({
      ok: false,
      fieldErrors: { email: COPY.shared.field.format(COPY.shared.field.exampleAddress) },
    });
    expect(calls).toHaveLength(0);
  });
});

// The re-mint kills the earlier link, so a fresh one refused at its press costs the person the one that worked.
describe("a re-send, an account standing at the new address", () => {
  it("is refused in the re-send's own sentence, and nothing is posted", async () => {
    held.accountAtNew = true;

    expect(await resendChangeLink({ address_change_id: ID, holder: HOLDER })).toMatchObject({
      ok: false,
      reason: SERVER_COPY.refusalLine.address_change_new_taken,
    });
    expect(calls).toHaveLength(0);
  });
});
