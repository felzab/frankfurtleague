import { doubleApiClient } from "@/test-support/apiClientDouble";
import { refused } from "@/test-support/refusals";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import type { Code } from "@/core/generated/client/types";

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

/** The code the case's backend refuses with, `null` for a write it takes. */
let refusal: Code | null = null;
const calls = doubleApiClient(() => {
  if (refusal !== null) throw refused(refusal);
  return {};
});

const { resendChangeLink, startLostMailboxChange } = await import("./addressChangeActs");

const HOLDER = "anna@example.org";
const START = { address: "paul@example.org", email: "paul.neu@example.org", change_reason: "Am Telefon bestätigt.", holder: HOLDER };
const ID = "64b000000000000000000002";

beforeEach(() => {
  held.accountStands = false;
  held.accountAtNew = false;
  refusal = null;
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

// No such refusal names a field, so a code left to the builder reaches the shared failure line, which words a retry the
// same rule refuses; `address_change_unchanged` left to `ownWords` would say Konto's „deine“ of somebody else's address.
describe("a start the backend refuses for its new address", () => {
  it.each(["address_change_taken", "address_change_occupied", "address_change_unchanged"] as const)("answers %s on the box", async (code) => {
    refusal = code;

    expect(await startLostMailboxChange(START)).toMatchObject({ ok: false, errorCode: code, fieldErrors: { email: COPY.shared.field.taken } });
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

  it("words the backend's own refusal alike", async () => {
    refusal = "address_change_new_taken";

    expect(await resendChangeLink({ address_change_id: ID, holder: HOLDER })).toMatchObject({
      ok: false,
      reason: SERVER_COPY.refusalLine.address_change_new_taken,
    });
  });
});
