"use server";

import { getAdminSession } from "@/core/auth";
import { ADMIN_FORBIDDEN, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors } from "@/shared/utils/validation";

import { eraseKontaktperson, patchSaisonTeamKontakte } from "./mutations";
import { FLKontaktErasurePayloadSchema, FLPatchSaisonTeamKontaktePayloadSchema } from "./schemas";
import { describeKontaktErasureUmfang } from "./utils";

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLKontaktErasurePayload, FLPatchSaisonTeamKontakteResponse } from "./schemas";
import type { SaisonTeamKontaktePayloadDraft } from "./types";

/**
 * Clears one contact person from every season's junction row, every application, and the log's saved
 * images of both. **Permanent, with no undo.** It refuses nothing: a person may ask to be forgotten
 * while the club they were reached for still plays.
 */
export async function eraseKontaktpersonAction(
  rawPayload: FLKontaktErasurePayload,
): Promise<{ success: boolean; cleared?: number; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("eraseKontaktpersonAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLKontaktErasurePayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    const erasure = await eraseKontaktperson(validated.data);
    if (!erasure.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Kontaktdaten wurden nicht gelöscht", repair: "Versuche es erneut" }) };
    }

    // Nothing to invalidate: no cached read holds a contact person.
    // `fl_frontend/src/features/teams/queries.ts :: getTeamMemberships` is memoised per render pass
    // and not across requests, and no public team read carries `kontakte`.

    return {
      success: true,
      /* How much was touched, so a caller can tell an erasure from a no-op: this endpoint refuses
         nothing, so an address matching nobody succeeds and clears zero. A count, never the address. */
      cleared: erasure.cleared_kontakt_slots + erasure.redacted_aktionen,
      message: describeKontaktErasureUmfang(erasure),
    };
  });
}

/**
 * The three seats one club holds for one season, written whole. The season's competition facts stay
 * on `PATCH /teams/{team_id}/saisons/{saison_id}`: they answer a different question and belong to a
 * different page.
 */
export async function patchSaisonTeamKontakteAction(
  // The DRAFT shape: an unpicked Einwilligung submits `erteilt_von: null`, and the schema below is
  // what turns that into a field error rather than a type error.
  rawPayload: SaisonTeamKontaktePayloadDraft,
): Promise<{ success: boolean; saison_team?: FLPatchSaisonTeamKontakteResponse; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("patchSaisonTeamKontakteAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPatchSaisonTeamKontaktePayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    const saisonTeam = await patchSaisonTeamKontakte(validated.data);
    if (!saisonTeam.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Kontakte wurden nicht gespeichert", repair: "Versuche es erneut" }) };
    }

    // Nothing to invalidate, for the erasure's reason above.

    return {
      success: true,
      saison_team: saisonTeam,
      // The cleared block is a removal rather than a save, and it is the one outcome a reader would
      // not expect to have to check for.
      message: validated.data.kontakte === null ? "Kontakte entfernt" : "Kontakte gespeichert",
    };
  });
}
