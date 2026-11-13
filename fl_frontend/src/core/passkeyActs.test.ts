import { ADMIN_EMAIL } from "@/test-support/authDoubles";
import { serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

// No act here may reach the backend past its touch: any request but the guards' own lookups fails the case.
const backend = serveBackend();
const { arriveAs, store, outbox } = signedInRequest();

const seasonActs = await import("@/app/admin/(editor)/saisons/[saison]/settings/saisonActs");
const banActs = await import("@/app/admin/(list)/ban-list/banActs");
const accountActs = await import("@/features/account/personActions");
const erasureActs = await import("@/app/admin/(list)/erasures/erasureActs");
const passkeyActs = await import("@/features/passkeys/actions");
const grantActs = await import("@/features/grants/actions");
const addressChangeActs = await import("@/app/admin/(list)/address-changes/addressChangeActs");
const changeActs = await import("@/features/address-change/actions");

const PERSON = "pia@example.org";
const GRANT = "64b000000000000000000002";
const ADDRESS_CHANGE = "64b000000000000000000002";

/** How long ago the administrator's passkey sign-in was: past the touch, well inside the administrator's window. */
const SIGNED_IN_MS_AGO = 2 * 60 * 1000;

/**
 * A session the guards admit whose passkey touch is not fresh, the one check the backend does not repeat: the
 * administrator's passkey sign-in of two minutes ago, or a person's sign-in by mailed code to an account holding a
 * passkey, who must touch it.
 */
const withoutAFreshTouch = {
  admin: async (): Promise<void> => {
    const [row] = store.session;
    if (row === undefined) throw new Error("the administrator's arrival wrote no session");
    row.createdAt = new Date(Date.now() - SIGNED_IN_MS_AGO);
  },
  person: async (): Promise<void> => {
    await arriveAs({ email: PERSON });
    const account = store.user.find(({ email }) => email === PERSON);
    if (account === undefined) throw new Error("the person's arrival wrote no account");
    store.passkey.push({
      id: "a-passkey-of-pia",
      userId: account.id,
      credentialID: "credential-of-pia",
      publicKey: "fabricated-public-key",
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      transports: "internal",
      createdAt: new Date(),
    });
  },
};

/**
 * Every act on the passkey touch's fixed list, each with an input its schema takes, posted for the address its page
 * was drawn for. The lane is the only place the touch is held: the backend judges no fresh sign-in, and the browser
 * asks the touch whether the server checks it or not, so an act dropping its `passkey: true` still type-checks and
 * still looks guarded.
 */
const TOUCHED: ReadonlyArray<readonly [string, keyof typeof withoutAFreshTouch, () => Promise<unknown>]> = [
  ["the draw's regeneration", "admin", () => seasonActs.recreateSpielplan({ saison_id: "2027", holder: ADMIN_EMAIL })],
  ["the draw's removal", "admin", () => seasonActs.deleteSpielplan({ saison_id: "2027", holder: ADMIN_EMAIL })],
  ["the switch onto a season", "admin", () => seasonActs.activateSaison({ saison_id: "2027", holder: ADMIN_EMAIL })],
  ["a ban", "admin", () => banActs.enterBan({ email: "max@example.org", ban_reason: "Ein Grund", holder: ADMIN_EMAIL })],
  ["a ban's lift", "admin", () => banActs.liftBan({ id: "65a000000000000000000001", holder: ADMIN_EMAIL })],
  ["the account's erasure", "person", () => accountActs.eraseAccount({ token: "link-token", holder: PERSON })],
  ["the sign-in address change", "person", () => accountActs.startAddressChange({ email: "neu@example.org", holder: PERSON })],
  ["a passkey's removal", "person", () => passkeyActs.removePasskeyAction({ id: "pk-1", holder: PERSON })],
  ["an administrator's addition", "admin", () => grantActs.addAdministrator({ email: "neu@example.org", holder: ADMIN_EMAIL })],
  ["an administrator's removal", "admin", () => grantActs.removeAdministrator({ id: GRANT, holder: ADMIN_EMAIL })],
  ["a handover's start", "admin", () => grantActs.startHandover({ grant_id: GRANT, holder: ADMIN_EMAIL })],
  ["a handover's stop", "admin", () => grantActs.stopHandover({ id: GRANT, holder: ADMIN_EMAIL })],
  [
    "an address's erasure",
    "admin",
    () => erasureActs.eraseAddress({ email: "max@example.org", reason: "Mail vom 3.11.2026", holder: ADMIN_EMAIL }),
  ],
  [
    "a lost-mailbox change's start",
    "admin",
    () =>
      addressChangeActs.startLostMailboxChange({
        address: "paul@example.org",
        email: "paul.neu@example.org",
        holder: ADMIN_EMAIL,
      }),
  ],
  ["a change's fresh link", "admin", () => addressChangeActs.resendChangeLink({ address_change_id: ADDRESS_CHANGE, holder: ADMIN_EMAIL })],
  ["a change's discard", "admin", () => changeActs.discardChange({ id: ADDRESS_CHANGE, holder: ADMIN_EMAIL })],
];

describe("the acts behind the passkey touch", () => {
  it.each(TOUCHED)("refuse %s on a session without a fresh touch, reaching nothing", async (_act, visitor, press) => {
    await withoutAFreshTouch[visitor]();
    const held = structuredClone(store);

    expect(await press()).toStrictEqual({ ok: false, reason: COPY.signIn.refusal.touchMissing });

    await backend.answered();
    // Nothing reached the backend, nothing was owed by mail, and the store holds what it held.
    expect(backend.sent).toStrictEqual([]);
    expect(outbox.owed).toStrictEqual([]);
    expect(store).toStrictEqual(held);
  });
});
