import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";
import { ADMIN_EMAIL } from "@/test-support/authDoubles";
import { serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";

// No act here may reach the backend past its touch: any request but the guards' own lookups fails the case.
const backend = serveBackend();
const { store, outbox } = signedInRequest();

const seasonActs = await import("@/app/admin/(editor)/saisons/[saison]/settings/saisonActs");
const banActs = await import("@/app/admin/(list)/ban-list/banActs");
const accountActs = await import("@/features/account/personActions");
const erasureActs = await import("@/app/admin/(list)/erasures/erasureActs");
const passkeyActs = await import("@/app/account/(pages)/security/passkeyActs");
const grantActs = await import("@/app/admin/(list)/administrators/grantActs");
const addressChangeActs = await import("@/app/admin/(list)/address-changes/addressChangeActs");
const changeActs = await import("@/features/address-change/actions");
const teamActs = await import("@/app/admin/(editor)/saisons/[saison]/teams/[team]/teamActs");
const bewerbungSeatActs = await import("@/app/admin/(list)/saisons/[saison]/bewerbungen/[bewerbung]/seatActs");
const refereeSave = await import("@/app/admin/(editor)/schiedsrichter/[schiedsrichter]/saveSchiedsrichter");

const GRANT = "64b000000000000000000002";
const ADDRESS_CHANGE = "64b000000000000000000002";
const TEAM = "64a000000000000000000001";
const BEWERBUNG = "64b000000000000000000002";
const REFEREE = "64b0000000000000000000a1";
const SEAT_PERSON = { first_name: "Jana", last_name: "Schmidt", email: "jana@example.org", phone: "069 90009765", version: "3" };

/** How long ago the administrator's passkey sign-in was: past the touch, well inside the administrator's window. */
const SIGNED_IN_MS_AGO = 2 * 60 * 1000;

/**
 * A session the guards admit whose passkey touch is not fresh, the one check the backend does not repeat: the
 * administrator's passkey sign-in of two minutes ago.
 */
function withoutAFreshTouch(): void {
  const [row] = store.session;
  if (row === undefined) throw new Error("the administrator's arrival wrote no session");
  row.createdAt = new Date(Date.now() - SIGNED_IN_MS_AGO);
}

/**
 * Every act on the passkey touch's fixed list, each with an input its schema takes, posted for the address its page
 * was drawn for. The lane is the only place the touch is held: the backend judges no fresh sign-in, and the browser
 * asks the touch whether the server checks it or not, so an act dropping its `passkey: true` still type-checks and
 * still looks guarded.
 */
const TOUCHED: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
  ["the draw's regeneration", () => seasonActs.recreateSpielplan({ saison_id: "2027", holder: ADMIN_EMAIL })],
  ["the draw's removal", () => seasonActs.deleteSpielplan({ saison_id: "2027", holder: ADMIN_EMAIL })],
  ["the switch onto a season", () => seasonActs.activateSaison({ saison_id: "2027", holder: ADMIN_EMAIL })],
  ["a ban", () => banActs.enterBan({ email: "max@example.org", ban_reason: "Ein Grund", holder: ADMIN_EMAIL })],
  ["a ban's lift", () => banActs.liftBan({ id: "65a000000000000000000001", holder: ADMIN_EMAIL })],
  ["the account's erasure", () => accountActs.eraseAccount({ token: "link-token", holder: ADMIN_EMAIL })],
  ["the sign-in address change", () => accountActs.startAddressChange({ email: "neu@example.org", holder: ADMIN_EMAIL })],
  ["a passkey's removal", () => passkeyActs.removePasskeyAction({ id: "pk-1", holder: ADMIN_EMAIL })],
  ["an administrator's addition", () => grantActs.addAdministrator({ email: "neu@example.org", holder: ADMIN_EMAIL })],
  ["an administrator's removal", () => grantActs.removeAdministrator({ id: GRANT, holder: ADMIN_EMAIL })],
  ["a handover's start", () => grantActs.startHandover({ grant_id: GRANT, holder: ADMIN_EMAIL })],
  ["a handover's stop", () => grantActs.stopHandover({ id: GRANT, holder: ADMIN_EMAIL })],
  ["an address's erasure", () => erasureActs.eraseAddress({ email: "max@example.org", reason: "Mail vom 3.11.2026", holder: ADMIN_EMAIL })],
  [
    "a lost-mailbox change's start",
    () =>
      addressChangeActs.startLostMailboxChange({
        address: "paul@example.org",
        email: "paul.neu@example.org",
        holder: ADMIN_EMAIL,
      }),
  ],
  ["a change's fresh link", () => addressChangeActs.resendChangeLink({ address_change_id: ADDRESS_CHANGE, holder: ADMIN_EMAIL })],
  ["a change's discard", () => changeActs.discardChange({ id: ADDRESS_CHANGE, holder: ADMIN_EMAIL })],
  [
    "a club's seat",
    () => teamActs.writeSeat({ team_id: TEAM, saison_id: "2027", seat: "trainer", ...SEAT_PERSON, trainer_is_also: "", holder: ADMIN_EMAIL }),
  ],
  [
    "an application's seat",
    () => bewerbungSeatActs.writeBewerbungSeat({ id: BEWERBUNG, seat: "trainer", ...SEAT_PERSON, holder: ADMIN_EMAIL }),
  ],
  [
    "a referee's save",
    () => refereeSave.saveSchiedsrichter({ id: REFEREE, version: 3, changes: { email: "erika.neu@example.org" }, holder: ADMIN_EMAIL }),
  ],
];

describe("the acts behind the passkey touch", () => {
  it.each(TOUCHED)("refuse %s on a session without a fresh touch, reaching nothing", async (_act, press) => {
    withoutAFreshTouch();
    const held = structuredClone(store);

    expect(await press()).toStrictEqual({ ok: false, reason: COPY.shared.touchMissing });

    await backend.answered();
    // Nothing reached the backend, nothing was owed by mail, and the store holds what it held.
    expect(backend.sent).toStrictEqual([]);
    expect(outbox.owed).toStrictEqual([]);
    expect(store).toStrictEqual(held);
  });
});
