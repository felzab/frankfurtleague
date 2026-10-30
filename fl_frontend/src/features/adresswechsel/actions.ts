"use server";

import { afterTheResponse } from "@/core/afterResponse";
import { accountStandsAt } from "@/core/auth";
import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { EinsehbarVerwehrtSchema } from "./einsehbar";
import { kontoAnNeuerAdresse } from "./konto";
import {
  beantrageAdresswechsel,
  einladeAdresswechsel,
  genehmigeAdresswechsel,
  postAdresswechselVerwaltungAnsicht,
  verwirfAdresswechsel,
} from "./mutations";
import { describeAdresswechselMail } from "./notifications";
import {
  KONTO_BELEGT_ERNEUT,
  KONTO_BELEGT_START,
  kontoBelegtGenehmigung,
  mapGenehmigungRefusal,
  mapVerwaltungAnsichtRefusal,
  mapVerwaltungLinkRefusal,
  mapVerwaltungStartRefusal,
} from "./refusals";
import {
  FLAdresswechselEinladenPayloadSchema,
  FLAdresswechselGenehmigungPayloadSchema,
  FLAdresswechselVerwaltungAnsichtPayloadSchema,
  FLAdresswechselVerwaltungPayloadSchema,
  FLAdresswechselVerwerfenPayloadSchema,
} from "./schemas";
import { runAdresswechselUmzuege } from "./umzug";

import type {
  FLAddressChangeVerwaltungPayload,
  FLAddressChangeVerwaltungViewPayload,
  FLAddressChangeVerwaltungViewResponse,
} from "@/core/generated/client/types";
import type { ActionResult, QueryResult } from "@/shared/types/types";
import type { EinsehbarVerwehrt } from "./einsehbar";
import type { FLAdresswechselEinladenPayload, FLAdresswechselGenehmigungPayload, FLAdresswechselVerwerfenPayload } from "./schemas";

/** What the tool's two link writes answer: whether a link to the new mailbox is owed, the address on file asked first otherwise. */
export type AdresswechselGesendet = ActionResult<{ link: boolean }>;

/** What the address holds and the change pending at it, read when the administrator asks: a person's records are never browsed. */
export async function readAdresswechselAnsichtAction(
  rawPayload: FLAddressChangeVerwaltungViewPayload,
): Promise<QueryResult<{ ansicht: FLAddressChangeVerwaltungViewResponse }>> {
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
 * An administrator's start of a change for a person who says they cannot sign in: without a reason the address on
 * file approves it first, with one a waiting time follows the confirmation. Either way it gets a stop link.
 */
export async function beantrageAdresswechselAction(rawPayload: FLAddressChangeVerwaltungPayload): Promise<AdresswechselGesendet> {
  return runAdminMutation("beantrageAdresswechselAction", { stepUp: true }, async () => {
    const validated = FLAdresswechselVerwaltungPayloadSchema.safeParse(rawPayload);

    if (!validated.success) return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };

    // Before the mint, which writes: the backend cannot see the sign-in store this refusal reads.
    if (await accountStandsAt(validated.data.email)) return refusalResult(KONTO_BELEGT_START);

    let mint;
    try {
      mint = await beantrageAdresswechsel(validated.data);
    } catch (error) {
      const refusal = mapVerwaltungStartRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    return {
      success: true,
      // The address the start names, never the one typed: a rival request landing between the two
      // replaced the mailbox the link is owed.
      message: describeAdresswechselMail(mint),
      link: mint.way !== "release",
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

    // Before the re-mint, which kills the earlier link: a fresh one would be refused at its press.
    if (await kontoAnNeuerAdresse({ address_change_id: validated.data.id })) return { success: false, error: KONTO_BELEGT_ERNEUT };

    let mint;
    try {
      mint = await einladeAdresswechsel(validated.data);
    } catch (error) {
      const refusal = mapVerwaltungLinkRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    return {
      success: true,
      // The previous link dies as the fresh one is handed out, which is the fact an administrator acts on.
      message: `${describeAdresswechselMail(mint)} Der vorherige Link gilt nicht mehr.`,
      link: true,
    };
  });
}

/** Discards the shown change, and refuses where that one has ended; the address on file stays, and nobody is mailed. */
export async function verwirfAdresswechselAction(rawPayload: FLAdresswechselVerwerfenPayload): Promise<ActionResult> {
  return runAdminMutation("verwirfAdresswechselAction", { stepUp: true }, async () => {
    const validated = FLAdresswechselVerwerfenPayloadSchema.safeParse(rawPayload);

    if (!validated.success) return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };

    try {
      await verwirfAdresswechsel(validated.data);
    } catch (error) {
      const refusal = mapVerwaltungLinkRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
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
export async function genehmigeAdresswechselAction(
  rawPayload: FLAdresswechselGenehmigungPayload,
  // The row's served reason the address tool refuses this approver, sent by the page: it words the discard a refusal
  // sends them to, and authorises nothing, the backend judging the approval and the tool on their own.
  einsehbarVerwehrt: EinsehbarVerwehrt | null,
): Promise<ActionResult> {
  // The enrolment's window, the grant write's own: the approval hands a grant to another address.
  return runAdminMutation("genehmigeAdresswechselAction", { stepUp: "enrolment" }, async () => {
    const validated = FLAdresswechselGenehmigungPayloadSchema.safeParse(rawPayload);
    const verwehrt = EinsehbarVerwehrtSchema.nullable().safeParse(einsehbarVerwehrt);

    if (!validated.success) return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    if (!verwehrt.success) return { success: false, error: VALIDATION_FAILED };

    // By the change's id, the approver perhaps being refused the tool's read of it; the effect would leave the account
    // at the new address standing beside the person's records.
    if (await kontoAnNeuerAdresse({ address_change_id: validated.data.id })) {
      return { success: false, error: kontoBelegtGenehmigung(verwehrt.data) };
    }

    let antwort;
    try {
      antwort = await genehmigeAdresswechsel(validated.data);
    } catch (error) {
      const refusal = mapGenehmigungRefusal(error, verwehrt.data);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (antwort.effective) {
      // The effect owed its account's carry on the change: behind the response, and by the hourly pass where this one
      // never runs.
      afterTheResponse(runAdresswechselUmzuege);
      return { success: true, message: "Die neue Adresse gilt jetzt, und der Zugang zur Verwaltung ist mit ihr gewechselt." };
    }

    return {
      success: true,
      message: "Der Zugang wechselt zur neuen Adresse, sobald sie bestätigt ist und keine Wartezeit mehr läuft. Bis dahin gilt die bisherige.",
    };
  });
}
