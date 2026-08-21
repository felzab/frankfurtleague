"use server";

import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { ADMIN_FORBIDDEN, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { toFieldErrors } from "@/shared/utils/validation";

import { patchAdminSpielData, previewAdminSpielData } from "./mutations";
import { FLPatchSpielDataPayloadSchema, FLSpielSchema } from "./schemas";
import { formatSpielUpdateMessage } from "./utils";

import type { FormState } from "@/shared/types/types";
import type { FieldErrors } from "@/shared/utils/validation";

/**
 * The 409s a match write answers here. `REQ-DATE-001` lands on `datum`, the field that caused it;
 * the rest travel as a message, naming no single control. Every other code falls to
 * `fl_frontend/src/shared/utils/actionError.ts :: OCCUPANT_REFUSALS`.
 */
function mapSpielRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  if (error.serverErrorCode === "REQ-DATE-001") {
    return { fieldErrors: { datum: "Dieses Datum liegt außerhalb des Zeitraums seines Spieltags." } };
  }
  if (error.serverErrorCode === "REQ-RESULT-001") {
    return {
      error: "Dieses Spiel hat ein Ergebnis, deshalb lässt sich das Team nicht entfernen. Wähle ein anderes Team, oder lösche zuerst die Tore.",
    };
  }
  // One code covers both references and the failure body names neither, so the message names both.
  // Only a NEWLY chosen one is judged, so the remedy is to reactivate the retired entry or reload
  // and pick another.
  if (error.serverErrorCode === "REQ-BOOKING-001") {
    return {
      error:
        "Spielort oder Schiedsrichter ist nicht mehr verfügbar, weil der Eintrag stillgelegt wurde oder nicht mehr existiert. Reaktiviere ihn, oder lade die Seite neu und wähle einen anderen aus der aktualisierten Liste.",
    };
  }
  if (error.serverErrorCode === "REQ-CLASH-001") {
    return {
      error:
        "Spielort oder Schiedsrichter ist zu dieser Zeit schon für ein anderes Spiel eingeteilt. Wähle eine Uhrzeit mit mindestens vier Stunden Abstand oder eine andere Zuordnung.",
    };
  }
  return null;
}

export async function patchAdminSpielDataAction(rawPayload: unknown, rawSaisonId: unknown): Promise<NonNullable<FormState>> {
  return runAdminMutation("patchAdminSpielDataAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPatchSpielDataPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // A refusal reaches the form rather than the error page: it is about what was submitted, and
    // the editor is where the wrong value still sits.
    let patch_operation;
    try {
      patch_operation = await patchAdminSpielData(validated.data);
    } catch (error) {
      const refusal = mapSpielRefusal(error);
      if (refusal) return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      throw error;
    }

    if (!patch_operation.acknowledged) {
      return { success: false, error: "Bei der Aktualisierung der Spieldaten ist ein unerwarteter Fehler aufgetreten" };
    }

    // Not redundant with the granular tags below: the default read path sends no `saison_id`, so
    // the commonest entries carry only these and a season-only invalidation leaves them stale.
    updateTag("spiele");
    updateTag("teams");

    // From the loaded spiel, never the patch body — the backend's payload does not declare
    // `saison_id` and Pydantic drops it. A failed parse costs a stale cache, never the edit.
    const saisonId = FLSpielSchema.shape.saison_id.safeParse(rawSaisonId);
    if (saisonId.success) {
      updateTag(`spiele:saison_id:${saisonId.data}`);
      updateTag(`teams:saison_id:${saisonId.data}`);
    }

    // The faults the resolution walked past ride along: the save that introduces one is when its
    // cause is known.
    return {
      success: Boolean(patch_operation.acknowledged),
      message: formatSpielUpdateMessage(patch_operation.advanced_to, patch_operation.bracket_faults, patch_operation.released_sides),
      // Named rather than counted: the undo toast has to know WHICH fixtures lost a result.
      // `voided_ergebnis` alone still names every one: a no-show needs both sides and composes its
      // own forfeit, so `voided_sonderereignis` never travels without the result it produced.
      voidedFixtures: patch_operation.advanced_to.filter((advancement) => advancement.voided_ergebnis !== null).map((entry) => entry.spiel_nr),
      releasedFixtures: patch_operation.released_sides.map((released) => released.spiel_nr),
    };
  });
}

/**
 * The save's own answer without the write: `dry_run=true` applies the payload in memory through the
 * same code the save uses. **No `updateTag` here, ever** — nothing changed, so it would evict every
 * cached match list on every keystroke.
 */
export async function previewAdminSpielDataAction(rawPayload: unknown): Promise<NonNullable<FormState>> {
  return runAdminMutation("previewAdminSpielDataAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPatchSpielDataPayloadSchema.safeParse(rawPayload);
    if (!validated.success) {
      // Silent by design: a toast about an incomplete payload would fire mid-keystroke, and the
      // draft's own field validation already says so. A preview is an extra; it never blocks a save.
      return { success: false, error: "Die Vorschau konnte nicht berechnet werden." };
    }

    // A refusal reaches the form rather than the error page: it is about what was submitted, and
    // the editor is where the wrong value still sits.
    let preview;
    try {
      preview = await previewAdminSpielData(validated.data);
    } catch (error) {
      const refusal = mapSpielRefusal(error);
      if (refusal) return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      throw error;
    }

    return {
      success: true,
      voidedFixtures: preview.advanced_to.filter((advancement) => advancement.voided_ergebnis !== null).map((entry) => entry.spiel_nr),
      releasedFixtures: preview.released_sides.map((released) => released.spiel_nr),
    };
  });
}
