"use server";

import { refresh } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { ADMIN_FORBIDDEN, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors } from "@/shared/utils/validation";

import { eraseKontaktperson, patchSaisonTeamKontakte, readKontaktErasureAnsicht } from "./mutations";
import { FLKontaktErasurePayloadSchema, FLPatchSaisonTeamKontaktePayloadSchema } from "./schemas";
import { describeKontaktErasureUmfang } from "./utils";

import type { ActionResult, QueryResult } from "@/shared/types/types";
import type {
  FLKontaktErasureAnsichtResponse,
  FLKontaktErasurePayload,
  FLPatchSaisonTeamKontaktePayload,
  FLPatchSaisonTeamKontakteResponse,
} from "./schemas";

/**
 * The stale-block refusal, or `null` when the 409 is something else. It lands on no field: the whole
 * screen is behind the row, so no box the admin could correct is at fault.
 */
function mapStaleBlockRefusal(error: unknown): string | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409 || error.serverErrorCode !== "REQ-KONTAKT-001") return null;

  return buildRefusal({
    reason: "Die Kontakte dieser Saison wurden inzwischen geändert, meistens durch das Löschen einer Kontaktperson",
    repair: "Lade die Seite neu und trage Deine Änderung dort erneut ein",
  });
}

/**
 * Clears one contact person from every season's junction row, every application, and the log's saved
 * images of both. **Permanent, with no undo.** It refuses nothing: a person may ask to be forgotten
 * while the club they were reached for still plays.
 */
export async function eraseKontaktpersonAction(rawPayload: FLKontaktErasurePayload): Promise<ActionResult<{ cleared?: number }>> {
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

    // No tag moves: no cached read holds a contact person.
    // `fl_frontend/src/features/teams/queries.ts :: getTeamMemberships` is memoised per render pass
    // and not across requests, and no public team read carries `kontakte`.

    // The admin's own list is uncached, so no tag reaches it.
    refresh();

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
  // Composed by the caller: the editor's own guard refuses a body before this is reached, and a
  // field no control renders is a block with no repair.
  rawPayload: FLPatchSaisonTeamKontaktePayload,
): Promise<ActionResult<{ saison_team?: FLPatchSaisonTeamKontakteResponse }>> {
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

    // `validated.data` and never `rawPayload`, whose type is a promise the wire does not keep.
    // The refusal belongs on the page that asked, not on the error page.
    let saisonTeam;
    try {
      saisonTeam = await patchSaisonTeamKontakte(validated.data);
    } catch (error) {
      const refusal = mapStaleBlockRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!saisonTeam.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Kontakte wurden nicht gespeichert", repair: "Versuche es erneut" }) };
    }

    // No tag moves, for the erasure's reason above, and its list is uncached for the same reason.
    refresh();

    return {
      success: true,
      saison_team: saisonTeam,
      // The cleared block is a removal rather than a save, and it is the one outcome a reader would
      // not expect to have to check for.
      message: validated.data.kontakte === null ? "Kontakte entfernt" : "Kontakte gespeichert",
    };
  });
}

/**
 * Whom `eraseKontaktpersonAction` would clear, read before it runs. It refuses nothing: an address
 * matching nobody answers two empty lists rather than a failure the panel would have to word.
 */
export async function readKontaktErasureAnsichtAction(
  rawPayload: FLKontaktErasurePayload,
): Promise<QueryResult<{ ansicht?: FLKontaktErasureAnsichtResponse }>> {
  return runAdminMutation("readKontaktErasureAnsichtAction", async () => {
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

    return { success: true, ansicht: await readKontaktErasureAnsicht(validated.data) };
  });
}
