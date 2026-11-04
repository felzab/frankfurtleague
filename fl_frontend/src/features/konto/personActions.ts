"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { linkInvalid, TO_ACCOUNT } from "@/kit/MailedPage";
import { z } from "zod";

import { action, TOUCH_HOLDER } from "@/core/action";
import { deleteOwnAccount, DeletionOutcomeUnknown, requestAccountDeletion } from "@/core/auth/accounts";
import { endOtherSessions } from "@/core/auth/accountSessions";
import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";
import {
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
import { logger } from "@/core/logging";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { SignInPayloadSchema } from "@/features/auth/schemas";
import { patchBewerbungEinwilligung, patchSitzEinwilligung } from "@/features/kontakte/mutations";
import { patchRegistrierungEinwilligung } from "@/features/registrierungen/mutations";
import { patchSchiedsrichterKontoEinwilligung } from "@/features/schiedsrichter/mutations";
import { patchSpielerKontoEinwilligung } from "@/features/spieler/mutations";

import { eraseOwnRecords, requestAccountAddressChange, stopAccountAddressChange } from "./mutations";
import { getAccountEinwilligungen, getErasureView } from "./queries";

import type { ActionAnswer } from "@/core/action";
import type { FLAccountEinwilligungenResponse } from "@/core/generated/client/types";
import type { EndState } from "@/kit/MailedPage";

/** An act that posts no field: the signed-in session names everything it acts on. */
const NOTHING = z.object({});

/**
 * Completes a mailed deletion link: the league's records, then the account, the passkey touch first for a person
 * holding one. The deletion ends the caller's own session, so a done one leads to a page needing none rather than
 * answering: Next renders the posting page again after an action writes a cookie, and the library deletes the session's
 * cookie, but a `redirect` from the body renders the destination alone, the builder having cleared the site's tag on
 * its way out. A link the library refuses, spent, lapsed or another account's, ends as the link no longer valid, with
 * nothing erased; so does one the library spent on a press the backend's erasure then refused, which leads to Konto,
 * where a fresh link is asked for. A press failing past the spent link with its outcome unknown reads the stale-page
 * line, as the passkey removal's does: a reload shows whether the account stands.
 */
export const eraseAccount = action({
  lane: "person",
  claim: "account",
  passkey: true,
  name: "eraseAccount",
  // The library's own token, which no backend schema publishes: one line of letters, digits, `-` and `_`.
  input: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), ...TOUCH_HOLDER }),
  run: async ({ token }, { subject }): Promise<ActionAnswer<EndState>> => {
    // Refused before the library spends the link, so the same link completes once another owner is made; the
    // backend refuses two owners at once. Read for an owner alone, the one tier that can be the last.
    if (subject.subject.verwaltung === "owner" && (await getErasureView()).last_owner) {
      return { ok: false, reason: SERVER_COPY.refusalLine.last_owner_erasure };
    }

    let outcome: Awaited<ReturnType<typeof deleteOwnAccount>>;
    try {
      outcome = await deleteOwnAccount(token, await headers(), () => eraseOwnRecords());
    } catch (failed) {
      if (!(failed instanceof DeletionOutcomeUnknown)) throw failed;
      logger.error("konto.deletion_outcome_unknown", undefined, { name: failed.cause instanceof Error ? failed.cause.name : "unknown" });
      return { ok: false, reason: COPY.shared.failure.stale };
    }
    if (outcome !== "deleted") {
      return { ok: true, value: linkInvalid(TO_ACCOUNT) };
    }

    redirect(ROUTES.accountErased.path());
  },
});

/**
 * The person's own address change from Konto: the address on file is mailed its link first, and the new address its
 * own once that confirms, the change taking effect once both have. A passkey holder touches the passkey first, the
 * one check guarding it, since the backend judges no fresh sign-in. The address typed is judged by the sign-in's own
 * rule, so every address a sign-in would refuse is refused here before it is mailed. An account standing at the new
 * address is not refused here: the start answers alike whatever the new address holds, so it tells nobody which
 * addresses hold an account, and the new mailbox's own press refuses it (`fl_frontend/src/app/(classic)/confirm/address/antworten.ts`).
 */
export const startAddressChange = action({
  lane: "person",
  claim: "account",
  passkey: true,
  name: "startAddressChange",
  input: SignInPayloadSchema.extend(TOUCH_HOLDER),
  examples: { email: COPY.shared.field.exampleAddress },
  ownWords: ["address_change_unchanged", "address_change_no_approver"],
  run: async ({ email }) => {
    await requestAccountAddressChange({ email });
    return { ok: true, value: undefined };
  },
});

/** The pending change withdrawn from Konto, the address on file's stop link's twin: it hands nothing over, so it asks no touch. */
export const withdrawAddressChange = action({
  lane: "person",
  claim: "account",
  name: "withdrawAddressChange",
  input: NOTHING,
  run: async () => {
    await stopAccountAddressChange();
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
  claim: "account",
  name: "requestErasure",
  input: NOTHING,
  run: async () => {
    await requestAccountDeletion(await headers());
    return { ok: true, value: undefined };
  },
});

/** Ends every session of the person's but the one this request arrived with, however many stand. */
export const signOutOthers = action({
  lane: "person",
  claim: "account",
  name: "signOutOthers",
  input: NOTHING,
  run: async (_, { served }) => {
    await endOtherSessions(served.user.id, served.session.id);
    // The sign-in store holds what changed, past every cached read: the device count is read again.
    refresh();
    return { ok: true, value: undefined };
  },
});

// The consents Deine Einträge saves, one record a box: both choices on every press, with the labels the page showed
// and the evidence it was served, so a press on a page older than either change is refused rather than stamped.

/**
 * A save whose media choice the backend refused as given below its floor, in the sentence Deine Einträge shows under
 * that switch, at the floor the record's view serves; `floorOf` answers it, or `undefined` where the record is gone
 * from the view, which the stale-page line answers. The page offers the switch from the served age alone, so only a
 * birthdate or a day that moved since it was served reaches this; any other failure goes to the builder.
 */
async function savedWithMediaFloor(
  save: () => Promise<unknown>,
  floorOf: (view: FLAccountEinwilligungenResponse) => number | undefined,
): Promise<ActionAnswer> {
  try {
    await save();
  } catch (failed) {
    if (!(failed instanceof APIBadStatusError) || failed.serverErrorCode !== "medien_age") throw failed;
    const floor = floorOf(await getAccountEinwilligungen());
    return {
      ok: false,
      errorCode: "medien_age",
      reason: floor === undefined ? COPY.shared.failure.stale : COPY.account.entries.mediaFrom(floor),
    };
  }
  return { ok: true, value: undefined };
}

/** A pupil's own two choices on their record. */
export const saveSpielerConsent = action({
  lane: "person",
  claim: "record",
  name: "saveSpielerConsent",
  input: SpielerPatchEinwilligungBody,
  run: (choices) =>
    savedWithMediaFloor(
      () => patchSpielerKontoEinwilligung(choices),
      (view) => view.spieler?.medien_minimum_age,
    ),
});

/** A referee's own two choices on one of their rows, of which one address may hold several. */
export const saveSchiedsrichterConsent = action({
  lane: "person",
  claim: "record",
  name: "saveSchiedsrichterConsent",
  input: SchiedsrichterPatchEinwilligungParams.extend(SchiedsrichterPatchEinwilligungBody.shape),
  run: ({ schiedsrichter_id, ...choices }) =>
    savedWithMediaFloor(
      () => patchSchiedsrichterKontoEinwilligung(schiedsrichter_id, choices),
      (view) => view.schiedsrichter.find((row) => row.schiedsrichter_id === schiedsrichter_id)?.medien_minimum_age,
    ),
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
  run: ({ team_id, saison_id, ...choices }) =>
    savedWithMediaFloor(
      () => patchSitzEinwilligung(team_id, saison_id, choices),
      (view) => view.seats.find((seat) => seat.team_id === team_id && seat.saison_id === saison_id)?.medien_minimum_age,
    ),
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
