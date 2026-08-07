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
 * The rules edit's six refusals (`REQ-RULES-001..006`), answered in German on the field the admin can act
 * on. `null` when the 409 is none of the six, so a caller falls through to its own wording.
 *
 * Four land on a field and two do not: the freeze is about the whole season and the matchday overflow is
 * about a document this form does not show, so neither has a field to sit under.
 *
 * Each message states what the data already is rather than what the rule forbids, because that is the
 * part the admin has to change: "Gruppe C und D halten noch Teams" is actionable and "number_of_groups
 * darf nicht sinken" is not. The backend `detail` carries the same fact in English for the log
 * (docs/logging.md); this is the reader's half (ADR-0065).
 */
function mapRulesRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  switch (error.serverErrorCode) {
    case "REQ-RULES-001":
      return {
        fieldErrors: {
          "rules.qualifiers_per_group":
            "Gruppenanzahl x Qualifizierte muss eine Zweierpotenz von 2 bis 16 ergeben, sonst lässt sich kein K.-o.-Baum spielen.",
        },
      };
    case "REQ-RULES-002":
      return { fieldErrors: { "rules.number_of_groups": "Eine Gruppe, die noch Teams hält, kann nicht wegfallen." } };
    case "REQ-RULES-003":
      return { fieldErrors: { "rules.teams_per_group": "Mindestens eine Gruppe hält schon mehr Teams als das neue Maximum." } };
    case "REQ-RULES-004":
      return {
        fieldErrors: {
          "rules.qualifiers_per_group": "Ein Platz im K.-o.-Baum verweist auf eine Platzierung, die dann nicht mehr erreicht wird.",
        },
      };
    case "REQ-RULES-005":
      return {
        error:
          "Diese Saison ist abgeschlossen. Punkte und Qualifizierte sind festgeschrieben, weil die Tabelle daraus berechnet wird — nur die Daten bleiben änderbar.",
      };
    case "REQ-RULES-006":
      return {
        error:
          "Mit diesen Regeln wären für mindestens einen Spieltag weniger Spiele vorgesehen, als er schon enthält. Die Zahl folgt aus den Regeln, also würden die überzähligen Spiele nirgends stattfinden.",
      };
    default:
      return null;
  }
}

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

    // TWO different 409s reach this call, and the code is what separates them. `REQ-RULES-001` refuses
    // a bracket the phase set cannot hold (ADR-0065) and is checked FIRST, because the fallback below
    // has no code to inspect: a duplicate id arrives from the unique index, so it is the 409 that is
    // left once the named refusals are ruled out. Both land as form errors -- each is about what was
    // submitted, and the admin fixes it in the dialog that is still open.
    let postOperation;
    try {
      postOperation = await postSaison(validated.data);
    } catch (error) {
      const refusal = mapRulesRefusal(error);
      if (refusal) return { success: false, error: VALIDATION_FAILED, ...refusal };
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

    // All five rules refusals are reachable here (ADR-0065), and each has to reach the editor rather
    // than the error page -- the panel the admin is looking at is where the wrong value still sits.
    let patchOperation;
    try {
      patchOperation = await patchSaison(validated.data);
    } catch (error) {
      const refusal = mapRulesRefusal(error);
      if (refusal) return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      throw error;
    }

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
 * **The outgoing season has to be finished** (`REQ-ACTIVATE-001`, owner, 2026-08-08). Demoting it to
 * `past` freezes its competitive rules and makes its derived table the record of what happened, so a
 * rollover across unplayed fixtures closes a competition that is not over. The panel disables the control
 * and lists what is open; the endpoint refuses it, and remains the authority.
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

    // The rollover is refused while the OUTGOING season still has unplayed fixtures
    // (`REQ-ACTIVATE-001`). The panel already disables the button in that case and lists them, so this is
    // the stale-page path: the answer has to name what to do rather than be a bare failure.
    let activateOperation;
    try {
      activateOperation = await activateSaison(validated.data);
    } catch (error) {
      if (error instanceof APIBadStatusError && error.statusCode === 409 && error.serverErrorCode === "REQ-ACTIVATE-001") {
        return {
          success: false,
          error:
            "Die laufende Saison hat noch Spiele ohne Ergebnis. Trage sie ein oder sage die Spiele ab — ein abgesagtes Spiel gilt als erledigt. Die Liste steht im Umstellungs-Panel.",
        };
      }
      throw error;
    }

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
