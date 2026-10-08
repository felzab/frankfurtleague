"use server";

import { mapEigeneEinwilligungRefusal, WAHL_GESPEICHERT } from "@/features/konto/einwilligung";
import { invalidatesOnWrite, refusalResult } from "@/shared/utils/adminMutation";
import { runPersonMutation, runPersonRecordMutation } from "@/shared/utils/personMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { KADER_AUSTRAGEN_FOLGE } from "./constants";
import { deleteKaderZeile, patchKaderZeile, patchSpielerSelbstEinwilligung } from "./mutations";
import { mapKaderZeileRefusal } from "./refusals";
import { FLKaderZeileKeyPayloadSchema, FLPatchKaderZeilePayloadSchema, FLSpielerSelbstEinwilligungPayloadSchema } from "./schemas";

import type { ActionResult } from "@/shared/types/types";
import type z from "zod";
import type { FLEinwilligungStand, FLKaderZeileKeyPayload, FLKaderZeileResponse, FLPatchKaderZeilePayload } from "./schemas";

/**
 * The public squad read is cached for days and joins every squad row, so a seat holder's edit drops its
 * base tag as the administrator's does (`fl_frontend/src/features/spieler/queries.ts :: getSpieler`).
 */
function invalidateSpieler(): void {
  invalidatesOnWrite("spieler");
}

/** A seat holder's edit of one live squad row: number, position, level and captaincy, nothing else. */
export async function patchKaderZeileAction(
  rawPayload: FLPatchKaderZeilePayload,
): Promise<ActionResult<{ kader_zeile?: FLKaderZeileResponse }>> {
  return runPersonMutation("patchKaderZeileAction", rawPayload, async () => {
    const validated = FLPatchKaderZeilePayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    invalidateSpieler();
    let kaderZeile;
    try {
      kaderZeile = await patchKaderZeile(validated.data);
    } catch (error) {
      const refusal = mapKaderZeileRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    return { success: true, kader_zeile: kaderZeile, message: "Kadereintrag gespeichert" };
  });
}

/** A seat holder's austragen of one live squad row, which only the administrator's reactivate undoes. */
export async function deleteKaderZeileAction(
  rawPayload: FLKaderZeileKeyPayload,
): Promise<ActionResult<{ kader_zeile?: FLKaderZeileResponse }>> {
  return runPersonMutation("deleteKaderZeileAction", rawPayload, async () => {
    const validated = FLKaderZeileKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    invalidateSpieler();
    const kaderZeile = await deleteKaderZeile(validated.data);

    return { success: true, kader_zeile: kaderZeile, message: KADER_AUSTRAGEN_FOLGE };
  });
}

/**
 * The pupil's own consent, pressed on the account page. It claims the pupil's record rather than a
 * seat, so a retired pupil reaches the backend to withdraw a consent the league still holds.
 */
export async function patchSpielerEinwilligungAction(
  rawPayload: z.input<typeof FLSpielerSelbstEinwilligungPayloadSchema>,
): Promise<ActionResult<{ nachweis_stand: FLEinwilligungStand }>> {
  return runPersonRecordMutation("patchSpielerEinwilligungAction", async () => {
    const validated = FLSpielerSelbstEinwilligungPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The consent is an input of the public squad read (`READ-PUPIL-003`), cached for days: a withdrawal
    // that drops no tag keeps the name published until it expires.
    invalidateSpieler();
    let antwort;
    try {
      antwort = await patchSpielerSelbstEinwilligung(validated.data);
    } catch (error) {
      const refusal = mapEigeneEinwilligungRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    return { success: true, message: WAHL_GESPEICHERT, nachweis_stand: antwort.nachweis_stand };
  });
}
