import { doubleApiClient } from "@/test-support/apiClientDouble";
import { person } from "@/test-support/subjectFixtures";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

/** Every step past the touch that a case reached: a backend call, or a call into the sign-in store. */
const reached = vi.hoisted(() => [] as string[]);

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: () => undefined, refresh: () => undefined }));
// A session the guards admit, whose passkey touch is not fresh: the one check the backend does not repeat.
vi.mock("@/core/auth/guards", () => ({
  judgeAdminRequest: async () => ({ session: {} }),
  getAccountSession: async () => ({ user: { id: "u1", email: "pia@example.org" }, session: {}, isAdmin: false }),
  passesPasskeyTouch: async () => false,
}));
vi.mock("@/core/subject", async () => ({ getSubjectSession: async () => person({}) }));
// The sign-in store's own acts, each recording that a press reached it.
vi.mock("@/core/auth/accounts", () => ({
  deleteAccountFor: async () => void reached.push("deleteAccountFor"),
  deleteOwnAccount: async () => void reached.push("deleteOwnAccount"),
  requestAccountDeletion: async () => void reached.push("requestAccountDeletion"),
  DeletionOutcomeUnknown: class extends Error {},
}));
vi.mock("@/core/auth/passkeys", () => ({
  passkeysOf: async () => (reached.push("passkeysOf"), []),
  removePasskey: async () => (reached.push("removePasskey"), "removed"),
  renamePasskey: async () => void reached.push("renamePasskey"),
}));
vi.mock("@/core/auth/accountSessions", () => ({ endOtherSessions: async () => void reached.push("endOtherSessions") }));
vi.mock("@/core/auth/mails", () => ({ notifyPasskeyRemoved: async () => undefined }));

doubleApiClient(({ endpoint }) => {
  reached.push(endpoint);
  return {};
});

const seasonActs = await import("@/app/admin/(editor)/saisons/[saison]/settings/saisonActs");
const banActs = await import("@/app/admin/(list)/ban-list/banActs");
const accountActs = await import("@/features/account/personActions");
const erasureActs = await import("@/app/admin/(list)/erasures/erasureActs");
const passkeyActs = await import("@/features/passkeys/actions");
const grantActs = await import("@/features/grants/actions");
const addressChangeActs = await import("@/app/admin/(list)/address-changes/addressChangeActs");
const changeActs = await import("@/features/address-change/actions");

const HOLDER = "pia@example.org";
const GRANT = "64b000000000000000000002";
const ADDRESS_CHANGE = "64b000000000000000000002";

/**
 * Every act on the passkey touch's fixed list, each with an input its schema takes. The lane is the only place the
 * touch is held: the backend judges no fresh sign-in, and the browser asks the touch whether the server checks it or
 * not, so an act dropping its `passkey: true` still type-checks and still looks guarded.
 */
const TOUCHED: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
  ["the draw's regeneration", () => seasonActs.recreateSpielplan({ saison_id: "2027", holder: HOLDER })],
  ["the draw's removal", () => seasonActs.deleteSpielplan({ saison_id: "2027", holder: HOLDER })],
  ["the switch onto a season", () => seasonActs.activateSaison({ saison_id: "2027", holder: HOLDER })],
  ["a ban", () => banActs.enterBan({ email: "max@example.org", ban_reason: "Ein Grund", holder: HOLDER })],
  ["a ban's lift", () => banActs.liftBan({ id: "65a000000000000000000001", holder: HOLDER })],
  ["the account's erasure", () => accountActs.eraseAccount({ token: "link-token", holder: HOLDER })],
  ["the sign-in address change", () => accountActs.startAddressChange({ email: "neu@example.org", holder: HOLDER })],
  ["a passkey's removal", () => passkeyActs.removePasskeyAction({ id: "pk-1", holder: HOLDER })],
  ["an administrator's addition", () => grantActs.addAdministrator({ email: "neu@example.org", holder: HOLDER })],
  ["an administrator's removal", () => grantActs.removeAdministrator({ id: GRANT, holder: HOLDER })],
  ["a handover's start", () => grantActs.startHandover({ grant_id: GRANT, holder: HOLDER })],
  ["a handover's stop", () => grantActs.stopHandover({ id: GRANT, holder: HOLDER })],
  ["an address's erasure", () => erasureActs.eraseAddress({ email: "max@example.org", reason: "Mail vom 3.11.2026", holder: HOLDER })],
  [
    "a lost-mailbox change's start",
    () =>
      addressChangeActs.startLostMailboxChange({
        address: "paul@example.org",
        email: "paul.neu@example.org",
        holder: HOLDER,
      }),
  ],
  ["a change's fresh link", () => addressChangeActs.resendChangeLink({ address_change_id: ADDRESS_CHANGE, holder: HOLDER })],
  ["a change's discard", () => changeActs.discardChange({ id: ADDRESS_CHANGE, holder: HOLDER })],
];

describe("the acts behind the passkey touch", () => {
  it.each(TOUCHED)("refuse %s on a session without a fresh touch, reaching nothing", async (_act, press) => {
    reached.length = 0;

    expect(await press()).toStrictEqual({ ok: false, reason: COPY.signIn.refusal.touchMissing });
    expect(reached).toStrictEqual([]);
  });
});
