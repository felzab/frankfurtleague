"use server";

/**
 * SAISONS · server actions
 *
 * Creating a season, editing its dates and rules, and the rollover. The `"use server"` directive stays
 * the first line, above this block.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Every action body runs inside `runAdminMutation`, which seeds the correlation-id request scope
 *     and converts a thrown API error into the returned result -- a 409 must reach the form, not the
 *     error page (docs/logging.md).
 *   • Every action begins with `getAdminSession()` and CHECKS the result.
 *   • Base tags only. A season is not season-scoped data: it IS the season, so a granular
 *     `saisons:saison_id:...` tag would name the one entry that cannot exist -- `getSaisons` reads
 *     every season in one call (ADR-0001).
 *   • `status` reaches no payload here. `activateSaisonAction` is the only action that changes it, and
 *     it changes it by calling the one endpoint that may (ADR-0033).
 *   • **The rollover invalidates FOUR resources, and that is the point.** An omitted `saison_id` means
 *     the current season, resolved in the backend handler (ADR-0002), so promoting a season changes
 *     what `/spiele`, `/spieltage` and `/teams` return to a request that named no season at all.
 *   • A rules edit invalidates `teams` as well as `saisons`, because the league table is scored from
 *     `rules.win_points` and `draw_points` on every read rather than stored (ADR-0026).
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/frontend/spec.md — section 3, the action inventory
 */
import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { runAdminMutation } from "@/shared/utils/adminMutation";
import { toFieldErrors } from "@/shared/utils/validation";

import { activateSaison, patchSaison, postSaison } from "./mutations";
import { FLActivateSaisonPayloadSchema, FLPatchSaisonPayloadSchema, FLPostSaisonPayloadSchema } from "./schemas";

import type { FieldErrors } from "@/shared/utils/validation";
import type {
  FLActivateSaisonPayload,
  FLActivateSaisonResponse,
  FLPatchSaisonPayload,
  FLPatchSaisonResponse,
  FLPostSaisonPayload,
} from "./schemas";

const VALIDATION_FAILED = "Bitte überprüfe deine Eingaben!";

// `saisons._id` is the document key, so a reused id is refused by the index rather than silently
// overwriting a season -- and the honest answer names the one thing the admin can do about it.
const SAISON_ID_TAKEN = "Diese Saison-ID ist bereits vergeben. Wähle eine andere oder bearbeite die vorhandene Saison.";

/**
 * What a season's own reads depend on, plus the league table.
 *
 * `teams` rather than `saisons` alone: `GET /teams` reads the season document on every call to score
 * the derived table from `rules.win_points` and `draw_points` (ADR-0026), so an edit to those two
 * changes every standing on the next read. The dates travel on the same payload, so this is
 * unconditional rather than a comparison against what moved -- a wrong "nothing changed" here serves a
 * stale table for a day.
 */
function invalidateSaisonAndTable(): void {
  updateTag("saisons");
  updateTag("teams");
}

/**
 * Everything a change of active season is visible in.
 *
 * Every read that defaults an omitted `saison_id` to the current season (ADR-0002) answers differently
 * the moment this succeeds, and none of those cache entries carries the promoted season's id -- they
 * are the entries for a request that named no season, which is most public traffic.
 */
function invalidateRollover(): void {
  updateTag("saisons");
  updateTag("spiele");
  updateTag("spieltage");
  updateTag("teams");
}

export async function postSaisonAction(
  rawPayload: FLPostSaisonPayload,
): Promise<{ success: boolean; created_id?: string; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("postSaisonAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLPostSaisonPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The 409 that matters here: the id is chosen by the admin and is the document key, so a
    // collision is an ordinary typo rather than an unexpected state. It lands as a form error because
    // it is about what was submitted.
    let postOperation;
    try {
      postOperation = await postSaison(validated.data);
    } catch (error) {
      if (error instanceof APIBadStatusError && error.statusCode === 409) {
        return { success: false, error: SAISON_ID_TAKEN, fieldErrors: { id: SAISON_ID_TAKEN } };
      }
      throw error;
    }

    if (!postOperation.acknowledged) {
      return { success: false, error: "Beim Anlegen der neuen Saison ist ein unerwarteter Fehler aufgetreten" };
    }

    // A created season is always `future` and never `active` (ADR-0033), so nothing that resolves the
    // current season is affected -- the season list is.
    updateTag("saisons");

    return {
      success: true,
      created_id: postOperation.created_id,
      message: `Saison ${postOperation.created_id} angelegt. Sie ist geplant, noch nicht aktiv.`,
    };
  });
}

export async function patchSaisonAction(rawPayload: FLPatchSaisonPayload): Promise<{
  success: boolean;
  saison?: FLPatchSaisonResponse;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
}> {
  return runAdminMutation("patchSaisonAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLPatchSaisonPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const patchOperation = await patchSaison(validated.data);
    if (!patchOperation.acknowledged) {
      return { success: false, error: "Bei der Bearbeitung der Saison ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSaisonAndTable();

    return {
      success: true,
      saison: patchOperation,
      message: "Saison gespeichert!",
    };
  });
}

/**
 * The rollover. One call, one transaction on the backend, and the only path to `status: "active"`.
 *
 * **It carries no precondition of its own, deliberately.** The all-games-finished check belongs to the
 * page, which shows what is incomplete and lets the operator proceed — the one case where someone
 * genuinely needs to activate a season is when the data is *not* in the state a rule would assume
 * (ADR-0033).
 */
export async function activateSaisonAction(rawPayload: FLActivateSaisonPayload): Promise<{
  success: boolean;
  saison?: FLActivateSaisonResponse;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
}> {
  return runAdminMutation("activateSaisonAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLActivateSaisonPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const activateOperation = await activateSaison(validated.data);
    if (!activateOperation.acknowledged) {
      return { success: false, error: "Bei der Umstellung der Saison ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateRollover();

    // `deactivated` is normally 1. Zero means this season already held `active`, which is a no-op
    // worth naming rather than reporting as a rollover that did nothing; more than one means the
    // database had drifted into a state nothing can express and this call repaired it (ADR-0027).
    const demoted = activateOperation.deactivated;
    const message =
      demoted === 0
        ? `Saison ${validated.data.id} war bereits aktiv.`
        : demoted === 1
          ? `Saison ${validated.data.id} ist jetzt aktiv. Die vorherige Saison ist abgeschlossen.`
          : `Saison ${validated.data.id} ist jetzt aktiv. ${String(demoted)} vorher aktive Saisons wurden abgeschlossen.`;

    return { success: true, saison: activateOperation, message };
  });
}
