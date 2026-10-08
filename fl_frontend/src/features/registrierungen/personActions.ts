"use server";

import z from "zod";

import { frontend_config } from "@/core/config";
import { buildRegistrierungAbsageEmail } from "@/core/registrierungEmail";
import { mapRegistrierungEinwilligungRefusal, WAHL_GESPEICHERT } from "@/features/konto/einwilligung";
import { sendZielMail } from "@/features/zustellung/notifications";
import { CustomObjectIdStringSchema } from "@/shared/schemas";
import { invalidatesOnWrite, refusalResult } from "@/shared/utils/adminMutation";
import { runPersonMutation, runPersonRecordMutation } from "@/shared/utils/personMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { patchRegistrierungEinwilligung, postRegistrierungAblehnen, postRegistrierungAufnehmen } from "./mutations";
import {
  FLRegistrierungAblehnenPayloadSchema,
  FLRegistrierungAufnehmenPayloadSchema,
  FLRegistrierungSelbstEinwilligungPayloadSchema,
} from "./schemas";
import { mapAblehnungRefusal, mapAufnahmeRefusal } from "./utils";

import type { FLEinwilligungStand } from "@/features/spieler/schemas";
import type { ActionResult } from "@/shared/types/types";
import type { FLRegistrierungAblehnenPayload, FLRegistrierungAblehnungResponse, FLRegistrierungAufnehmenPayload } from "./schemas";

/**
 * Which registration a press decides, at the team and season the seat is claimed on. The seat is the
 * spine's to derive from the session; the backend judges it again against the registration's own team.
 */
const RegistrierungAdresse = z.object({
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string(),
  registrierung_id: CustomObjectIdStringSchema,
});
type RegistrierungAdresse = z.infer<typeof RegistrierungAdresse>;

const AufnehmenAktion = RegistrierungAdresse.extend(FLRegistrierungAufnehmenPayloadSchema.shape);
const AblehnenAktion = RegistrierungAdresse.extend(FLRegistrierungAblehnenPayloadSchema.shape);

/**
 * Admits one registration into the team's squad, into the person its address or the seat holder's
 * answer names. The public squad read is cached for days, so the pupil joining it drops its tag.
 */
export async function aufnehmenRegistrierungAction(rawPayload: RegistrierungAdresse & FLRegistrierungAufnehmenPayload): Promise<ActionResult> {
  return runPersonMutation("aufnehmenRegistrierungAction", rawPayload, async () => {
    const validated = AufnehmenAktion.safeParse(rawPayload);
    if (!validated.success) return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };

    const { registrierung_id, spieler_id } = validated.data;
    invalidatesOnWrite("spieler");
    let aufnahme;
    try {
      aufnahme = await postRegistrierungAufnehmen(registrierung_id, { spieler_id: spieler_id });
    } catch (error) {
      const refusal = mapAufnahmeRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    return { success: true, message: `${aufnahme.vorname} ist jetzt im Kader.` };
  });
}

/**
 * Declines one registration under a fixed reason and tells the pupil, where their address was ever
 * verified: an unconfirmed one may be a stranger's, typed by whoever held the team's link.
 */
export async function ablehnenRegistrierungAction(rawPayload: RegistrierungAdresse & FLRegistrierungAblehnenPayload): Promise<ActionResult> {
  return runPersonMutation("ablehnenRegistrierungAction", rawPayload, async () => {
    const validated = AblehnenAktion.safeParse(rawPayload);
    if (!validated.success) return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };

    const { registrierung_id, grund } = validated.data;
    let ablehnung;
    try {
      ablehnung = await postRegistrierungAblehnen(registrierung_id, { grund: grund });
    } catch (error) {
      const refusal = mapAblehnungRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (ablehnung.bestaetigt) await mailAbsage(ablehnung);

    // The same words whatever the send did: a team told that a note was withheld would learn that the
    // pupil's address is barred, which no seat holder is told.
    return {
      success: true,
      message: `${ablehnung.vorname} kommt nicht in den Kader. Die Registrierung löschen wir einen Monat nach der Entscheidung.`,
    };
  });
}

/** The pupil's note. Never thrown from: the decline is written by now, and a failed send must not report it as not taken. */
async function mailAbsage(ablehnung: FLRegistrierungAblehnungResponse): Promise<void> {
  await sendZielMail({
    operation: "ablehnenRegistrierungAction",
    // No idempotency key: a decline is taken once, its row answering no second press.
    auftrag: { ziel: "registrierung", zielId: ablehnung.registrierung_id, anlass: "ablehnung" },
    recipients: [ablehnung.email],
    buildMail: () =>
      buildRegistrierungAbsageEmail({
        vorname: ablehnung.vorname,
        teamName: ablehnung.team,
        saisonId: ablehnung.saison_id,
        // The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL` (`docs/frontend/spec.md :: I186`).
        origin: frontend_config.AUTH_URL,
        grund: ablehnung.grund,
      }),
  });
}

/**
 * A pupil's withdrawal on their own pending registration, which the page binds. It claims the pupil's
 * record, a registration granting no Funktion, and the backend judges the registration theirs.
 */
export async function patchRegistrierungEinwilligungAction(
  registrierungId: string,
  rawPayload: z.input<typeof FLRegistrierungSelbstEinwilligungPayloadSchema>,
): Promise<ActionResult<{ nachweis_stand: FLEinwilligungStand }>> {
  return runPersonRecordMutation("patchRegistrierungEinwilligungAction", async () => {
    const id = CustomObjectIdStringSchema.safeParse(registrierungId);
    const validated = FLRegistrierungSelbstEinwilligungPayloadSchema.safeParse(rawPayload);

    if (!id.success || !validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: validated.success ? undefined : toFieldErrors(validated.error) };
    }

    let antwort;
    try {
      antwort = await patchRegistrierungEinwilligung(id.data, validated.data);
    } catch (error) {
      const refusal = mapRegistrierungEinwilligungRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    // No public read serves a pending registration: the spine's refresh is the page's whole re-read.
    return { success: true, message: WAHL_GESPEICHERT, nachweis_stand: antwort.nachweis_stand };
  });
}
