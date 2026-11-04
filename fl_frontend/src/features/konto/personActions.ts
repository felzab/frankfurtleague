"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { linkInvalid } from "@/kit/MailedPage";
import { z } from "zod";

import { action } from "@/core/action";
import { deleteOwnAccount, requestAccountDeletion } from "@/core/auth/accounts";
import { revokeOtherSessions } from "@/core/auth/accountSessions";
import { COPY } from "@/core/copy";
import {
  AccountPostAddressChangeReleaseBody,
  BewerbungenPatchEinwilligungBody,
  BewerbungenPatchEinwilligungParams,
  RegistrierungenPatchEinwilligungBody,
  RegistrierungenPatchEinwilligungParams,
  SchiedsrichterPatchEinwilligungBody,
  SchiedsrichterPatchEinwilligungParams,
  SpielerPatchEinwilligungBody,
  TeamsPatchEinwilligungBody,
  TeamsPatchEinwilligungParams,
} from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { SignInPayloadSchema } from "@/features/auth/schemas";
import { patchBewerbungEinwilligung, patchSitzEinwilligung } from "@/features/kontakte/mutations";
import { patchRegistrierungEinwilligung } from "@/features/registrierungen/mutations";
import { patchSchiedsrichterKontoEinwilligung } from "@/features/schiedsrichter/mutations";
import { patchSpielerKontoEinwilligung } from "@/features/spieler/mutations";

import { beantrageKontoAdresswechsel, gibKontoAdresswechselFrei, loeschenEigeneDaten, stoppeKontoAdresswechsel } from "./mutations";
import { getLoeschungAnsicht } from "./queries";

import type { ActionAnswer } from "@/core/action";
import type { MailedEnd } from "@/kit/MailedPage";

/** An act that posts no field: the signed-in session names everything it acts on. */
const NOTHING = z.object({});

/**
 * Completes a mailed deletion link: the league's records, then the account, the passkey touch first for a person
 * holding one. The deletion ends the caller's own session, so a done one leads to a page needing none rather than
 * answering: Next renders the posting page again after an action writes a cookie, and the library deletes the session's
 * cookie, but a `redirect` from the body renders the destination alone, the builder having cleared the site's tag on
 * its way out. A link the library refuses, spent, lapsed or another account's, ends as the link no longer valid, with
 * nothing erased.
 */
export const kontoLoeschen = action({
  lane: "person",
  claim: "record",
  passkey: true,
  name: "kontoLoeschen",
  // The library's own token, which no backend schema publishes: one line of letters, digits, `-` and `_`.
  input: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }),
  ownWords: ["last_owner_erasure"],
  run: async ({ token }, { subject }): Promise<ActionAnswer<MailedEnd>> => {
    // Refused before the library spends the link, so the same link completes once another owner is made; the
    // backend refuses two owners at once. Read for an owner alone, the one tier that can be the last.
    if (subject.subject.verwaltung === "owner" && (await getLoeschungAnsicht()).last_owner) {
      return { ok: false, reason: SERVER_COPY.refusalLine.last_owner_erasure };
    }

    const outcome = await deleteOwnAccount(token, await headers(), () => loeschenEigeneDaten());
    if (outcome === "linkRefused")
      return { ok: true, value: linkInvalid({ label: COPY.shared.end.toAccount, href: ROUTES.accountSignIn.path() }) };

    redirect(ROUTES.accountErased.path());
  },
});

/**
 * The person's own address change from Konto: the address on file is mailed its link first, and the new address its
 * own once that confirms, the change taking effect once both have. A passkey holder touches the passkey first, the
 * one check guarding it, since the backend judges no fresh sign-in. The address typed is judged by the sign-in's own
 * rule, so every address a sign-in would refuse is refused here before it is mailed.
 */
export const startAddressChange = action({
  lane: "person",
  claim: "record",
  passkey: true,
  name: "startAddressChange",
  input: SignInPayloadSchema,
  examples: { email: COPY.shared.field.exampleAddress },
  ownWords: ["address_change_unchanged", "address_change_no_approver"],
  run: async ({ email }) => {
    await beantrageKontoAdresswechsel({ email });
    return { ok: true, value: undefined };
  },
});

/**
 * The address on file's approval of the change an administrator started without a reason, the passkey touch first:
 * only now does the new address get its link. A later start replaced the one the page showed, and the press then
 * approves nothing.
 */
export const approveAddressChange = action({
  lane: "person",
  claim: "record",
  passkey: true,
  name: "approveAddressChange",
  input: AccountPostAddressChangeReleaseBody,
  run: async ({ id }) => {
    await gibKontoAdresswechselFrei({ id });
    return { ok: true, value: undefined };
  },
});

/** The pending change withdrawn from Konto, the address on file's stop link's twin: it hands nothing over, so it asks no touch. */
export const withdrawAddressChange = action({
  lane: "person",
  claim: "record",
  name: "withdrawAddressChange",
  input: NOTHING,
  run: async () => {
    await stoppeKontoAdresswechsel();
    return { ok: true, value: undefined };
  },
});

/**
 * Mails the person the link deleting their account, to the session's own address and never a posted one; the deletion
 * waits on that link's page. The library answers a send that failed as one that went, so the answer is the same
 * either way.
 */
export const requestErasure = action({
  lane: "person",
  claim: "record",
  name: "requestErasure",
  input: NOTHING,
  run: async () => {
    await requestAccountDeletion(await headers());
    return { ok: true, value: undefined };
  },
});

/** Ends every session of the person's but this device's, through the library's own in-process call. */
export const signOutOthers = action({
  lane: "person",
  claim: "record",
  name: "signOutOthers",
  input: NOTHING,
  run: async () => {
    await revokeOtherSessions(await headers());
    // The sign-in store holds what changed, past every cached read: the device count is read again.
    refresh();
    return { ok: true, value: undefined };
  },
});

// The consents Deine Einträge saves, one record a box: both choices on every press, with the labels the page showed
// and the evidence it was served, so a press on a page older than either change is refused rather than stamped.

/** A pupil's own two choices on their record. */
export const saveSpielerConsent = action({
  lane: "person",
  claim: "record",
  name: "saveSpielerConsent",
  input: SpielerPatchEinwilligungBody,
  run: async (choices) => {
    await patchSpielerKontoEinwilligung(choices);
    return { ok: true, value: undefined };
  },
});

/** A referee's own two choices on one of their rows, of which one address may hold several. */
export const saveSchiedsrichterConsent = action({
  lane: "person",
  claim: "record",
  name: "saveSchiedsrichterConsent",
  input: SchiedsrichterPatchEinwilligungParams.extend(SchiedsrichterPatchEinwilligungBody.shape),
  run: async ({ schiedsrichter_id, ...choices }) => {
    await patchSchiedsrichterKontoEinwilligung(schiedsrichter_id, choices);
    return { ok: true, value: undefined };
  },
});

/** A pupil's withdrawal on their pending registration, whose grant waits on the team's admission. */
export const saveRegistrierungConsent = action({
  lane: "person",
  claim: "record",
  name: "saveRegistrierungConsent",
  input: RegistrierungenPatchEinwilligungParams.extend(RegistrierungenPatchEinwilligungBody.shape),
  run: async ({ registrierung_id, ...choices }) => {
    await patchRegistrierungEinwilligung(registrierung_id, choices);
    return { ok: true, value: undefined };
  },
});

/** A seat holder's own two choices for every seat they hold on one team's season, a past season's to withdraw. */
export const saveSeatConsent = action({
  lane: "person",
  claim: "record",
  name: "saveSeatConsent",
  input: TeamsPatchEinwilligungParams.extend(TeamsPatchEinwilligungBody.shape),
  run: async ({ team_id, saison_id, ...choices }) => {
    await patchSitzEinwilligung(team_id, saison_id, choices);
    return { ok: true, value: undefined };
  },
});

/** A seat holder's withdrawal on a pending application, whose grant is its confirmation page's alone. */
export const saveBewerbungConsent = action({
  lane: "person",
  claim: "record",
  name: "saveBewerbungConsent",
  input: BewerbungenPatchEinwilligungParams.extend(BewerbungenPatchEinwilligungBody.shape),
  run: async ({ bewerbung_id, ...choices }) => {
    await patchBewerbungEinwilligung(bewerbung_id, choices);
    return { ok: true, value: undefined };
  },
});
