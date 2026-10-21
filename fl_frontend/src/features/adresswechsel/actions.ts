"use server";

import { afterTheResponse } from "@/core/afterResponse";
import { runBerechtigungenAbgleich } from "@/features/berechtigungen/abgleich";
import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { buildRefusal, VERSUCHE_ES_ERNEUT } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import {
  beantrageAdresswechsel,
  einladeAdresswechsel,
  genehmigeAdresswechsel,
  postAdresswechselVerwaltungAnsicht,
  verwirfAdresswechsel,
} from "./mutations";
import { describeAdresswechselMail, mailAdresswechsel } from "./notifications";
import { runAdresswechselPostausgang } from "./postausgang";
import { mapGenehmigungRefusal, mapVerwaltungAnsichtRefusal, mapVerwaltungLinkRefusal, mapVerwaltungStartRefusal } from "./refusals";
import {
  FLAdresswechselEinladenPayloadSchema,
  FLAdresswechselGenehmigungPayloadSchema,
  FLAdresswechselVerwaltungAnsichtPayloadSchema,
  FLAdresswechselVerwaltungPayloadSchema,
  FLAdresswechselVerwerfenPayloadSchema,
} from "./schemas";

import type { ActionResult, QueryResult } from "@/shared/types/types";
import type { HinweisVersand, LinkVersand } from "@/shared/utils/linkVersand";
import type {
  FLAdresswechselEinladenPayload,
  FLAdresswechselGenehmigungPayload,
  FLAdresswechselVerwaltungAnsichtPayload,
  FLAdresswechselVerwaltungAnsichtResponse,
  FLAdresswechselVerwaltungPayload,
  FLAdresswechselVerwerfenPayload,
} from "./schemas";

/** What the tool's two link writes answer: each message's outcome, and the warning the start owes where the new address holds records. */
export type AdresswechselGesendet = ActionResult<{ versand: LinkVersand | null; hinweis: HinweisVersand | null; adresseBelegt: boolean }>;

/** The administrator's one signal that a pretext's target may already hold league records, which the toast grades a warning. */
const ADRESSE_BELEGT_SATZ =
  "Unter der neuen Adresse stehen schon Einträge bei der Liga. Bestätigt die Person den Link, gehören danach alle zu einer Anmeldung.";

// No write here moves a cache tag: no cached read holds an address, a pending one least of all, and the records a
// change moves are served on admin reads alone, which are never cached.

/** What the address holds and the change pending at it, read when the administrator asks: a person's records are never browsed. */
export async function readAdresswechselAnsichtAction(
  rawPayload: FLAdresswechselVerwaltungAnsichtPayload,
): Promise<QueryResult<{ ansicht: FLAdresswechselVerwaltungAnsichtResponse }>> {
  return runAdminMutation("readAdresswechselAnsichtAction", async () => {
    const validated = FLAdresswechselVerwaltungAnsichtPayloadSchema.safeParse(rawPayload);

    if (!validated.success) return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };

    try {
      return { success: true, ansicht: await postAdresswechselVerwaltungAnsicht(validated.data) };
    } catch (error) {
      const refusal = mapVerwaltungAnsichtRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }
  });
}

/**
 * An administrator's start of a change for a person who cannot sign in: without a reason the address on
 * file approves it first, with one a waiting time follows the confirmation. Either way it gets a stop link.
 */
export async function beantrageAdresswechselAction(rawPayload: FLAdresswechselVerwaltungPayload): Promise<AdresswechselGesendet> {
  return runAdminMutation("beantrageAdresswechselAction", { stepUp: true }, async () => {
    const validated = FLAdresswechselVerwaltungPayloadSchema.safeParse(rawPayload);

    if (!validated.success) return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };

    let mint;
    try {
      mint = await beantrageAdresswechsel(validated.data);
    } catch (error) {
      const refusal = mapVerwaltungStartRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    if (!mint.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Link wurde nicht gesendet", repair: VERSUCHE_ES_ERNEUT }) };
    }

    const versand = await mailAdresswechsel({ operation: "beantrageAdresswechselAction", mint: mint, anlass: "empfang" });
    // The approvers are told through the grants' outbox the start queued (`docs/backend/spec.md :: I862`), drained behind
    // the answer as an approval is: mailing them here too would tell each twice.
    if (mint.genehmiger.length > 0) afterTheResponse(runBerechtigungenAbgleich);

    return {
      success: true,
      // The address the mint names, never the one typed: a rival request landing between the two
      // replaced the mailbox the credential was made for.
      message: `${describeAdresswechselMail(mint, versand)}${mint.adresse_belegt ? ` ${ADRESSE_BELEGT_SATZ}` : ""}`,
      versand: versand.link,
      hinweis: versand.hinweis,
      adresseBelegt: mint.adresse_belegt,
    };
  });
}

/**
 * A fresh link to the shown change's new address, and to no later change's: the earlier link is dead either way.
 * The address on file is not mailed again, its stop link still working.
 */
export async function einladeAdresswechselAction(rawPayload: FLAdresswechselEinladenPayload): Promise<AdresswechselGesendet> {
  return runAdminMutation("einladeAdresswechselAction", { stepUp: true }, async () => {
    const validated = FLAdresswechselEinladenPayloadSchema.safeParse(rawPayload);

    if (!validated.success) return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };

    let mint;
    try {
      mint = await einladeAdresswechsel(validated.data);
    } catch (error) {
      const refusal = mapVerwaltungLinkRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!mint.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Link wurde nicht gesendet", repair: VERSUCHE_ES_ERNEUT }) };
    }

    const versand = await mailAdresswechsel({ operation: "einladeAdresswechselAction", mint: mint, anlass: "erneut" });

    return {
      success: true,
      // Said whichever way the send went: the previous link is dead either way, which is the fact an
      // administrator has to act on when the message did not leave.
      message: `${describeAdresswechselMail(mint, versand)} Der vorherige Link gilt nicht mehr.${mint.adresse_belegt ? ` ${ADRESSE_BELEGT_SATZ}` : ""}`,
      versand: versand.link,
      hinweis: versand.hinweis,
      // Read again by the re-send's own transaction: records may have reached the new address since the start.
      adresseBelegt: mint.adresse_belegt,
    };
  });
}

/** Discards the shown change, and refuses where that one has ended; the address on file stays, and nobody is mailed. */
export async function verwirfAdresswechselAction(rawPayload: FLAdresswechselVerwerfenPayload): Promise<ActionResult> {
  return runAdminMutation("verwirfAdresswechselAction", { stepUp: true }, async () => {
    const validated = FLAdresswechselVerwerfenPayloadSchema.safeParse(rawPayload);

    if (!validated.success) return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };

    let operation;
    try {
      operation = await verwirfAdresswechsel(validated.data);
    } catch (error) {
      const refusal = mapVerwaltungLinkRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!operation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Änderung wurde nicht verworfen", repair: VERSUCHE_ES_ERNEUT }) };
    }

    // True of every step a change can be discarded in: before an approval no link existed, and once confirmed it is spent.
    return { success: true, message: "Die Änderung ist verworfen. Die bisherige Adresse bleibt." };
  });
}

/**
 * Another administrator's approval of a grant holder's change. Where it was the last step, the change took effect in
 * this press, which owes what a confirmation would: the account's move, the completion notice, and the grant's
 * announcement.
 */
export async function genehmigeAdresswechselAction(rawPayload: FLAdresswechselGenehmigungPayload): Promise<ActionResult> {
  // The enrolment's window, the grant write's own: the approval hands a grant to another address (`docs/frontend/spec.md :: I458`).
  return runAdminMutation("genehmigeAdresswechselAction", { stepUp: "enrolment" }, async () => {
    const validated = FLAdresswechselGenehmigungPayloadSchema.safeParse(rawPayload);

    if (!validated.success) return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };

    let antwort;
    try {
      antwort = await genehmigeAdresswechsel(validated.data);
    } catch (error) {
      const refusal = mapGenehmigungRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!antwort.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Änderung wurde nicht genehmigt", repair: VERSUCHE_ES_ERNEUT }) };
    }

    if (antwort.wirksam) {
      // Behind the response, as a grant written on the administrators page is announced; the completion notice and the
      // account's carry wait in the outbox the effect wrote, which the hourly pass drains where this one never runs.
      afterTheResponse(runBerechtigungenAbgleich);
      afterTheResponse(runAdresswechselPostausgang);
      return { success: true, message: "Die neue Adresse gilt jetzt, und der Zugang zur Verwaltung ist mit ihr gewechselt." };
    }

    return {
      success: true,
      message: "Der Zugang wechselt zur neuen Adresse, sobald sie bestätigt ist und keine Wartezeit mehr läuft. Bis dahin gilt die bisherige.",
    };
  });
}
