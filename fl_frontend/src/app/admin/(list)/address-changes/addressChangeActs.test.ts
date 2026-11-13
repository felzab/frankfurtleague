import { doubleApiClient } from "@/test-support/apiClientDouble";
import { refused } from "@/test-support/refusals";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SERVER_COPY } from "@/core/serverCopy";

import type { Code } from "@/core/generated/client/types";

const held = vi.hoisted(() => ({ accountStands: false, accountAtNew: false, refusal: null as Code | null }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }), passesPasskeyTouch: async () => true }));
vi.mock("@/core/requestScope", async (original) => ({
  ...(await original<object>()),
  getRequestActor: () => ({ email: "anna@example.org" }),
}));
vi.mock("@/core/auth/accounts", () => ({ accountStandsAt: async () => held.accountStands }));
vi.mock("@/features/address-change/account", () => ({ accountAtNewAddress: async () => held.accountAtNew }));

const calls = doubleApiClient(() => {
  // The backend names the new address's box, as its `find_taken_refusal` and `find_occupied_refusal` do.
  if (held.refusal !== null) throw refused(held.refusal, { fields: [{ path: ["email"], kind: held.refusal, ctx: {}, in: "body" }] });
  return {};
});

const { resendChangeLink, startLostMailboxChange } = await import("./addressChangeActs");

const HOLDER = "anna@example.org";
const START = { address: "paul@example.org", email: "paul.neu@example.org", holder: HOLDER };
const ID = "64b000000000000000000002";

beforeEach(() => {
  held.accountStands = false;
  held.accountAtNew = false;
  held.refusal = null;
  calls.length = 0;
});

// The sign-in store is this server's and the backend cannot read it: a change confirmed onto such an address leaves the
// person's passkeys behind on the old account, and nothing fails.
describe("a start, an account standing at the new address", () => {
  // The harm: the start's dialog has closed before its answer, so a box's phrase would reach its toast as the pointer at
  // fields nobody sees.
  it("is refused in a sentence naming the new address, and nothing is posted", async () => {
    held.accountStands = true;

    expect(await startLostMailboxChange(START)).toStrictEqual({
      ok: false,
      errorCode: "address_change_taken",
      reason: SERVER_COPY.refusalLine.address_change_taken,
    });
    expect(calls).toHaveLength(0);
  });

  it.each(["address_change_taken", "address_change_occupied"] as const)("is refused by the backend's %s in the same sentence", async (code) => {
    held.refusal = code;

    expect(await startLostMailboxChange(START)).toStrictEqual({
      ok: false,
      errorCode: code,
      reason: SERVER_COPY.refusalLine.address_change_taken,
    });
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
