"use server";

/**
 * SAISONS · server actions
 *
 * Creating a season, editing its dates and rules, and the rollover. The `"use server"` directive
 * stays the first line, above this block.
 *
 * Invariants:
 * - Every action runs inside `runAdminMutation` — a 409 must reach the form, not the error page.
 * - Every action begins with `getAdminSession()` and CHECKS the result.
 * - Base tags only: a season IS the season, so no granular tag names anything (ADR-0001).
 * - `status` reaches no payload — `activateSaisonAction` calls the one endpoint that may (ADR-0026).
 * - The rollover invalidates four resources: an omitted `saison_id` means the current season
 *   (ADR-0002), so promoting changes `/spiele`, `/spieltage` and `/teams` too.
 * - A rules edit invalidates `teams` as well — the table is scored from `rules` on read (ADR-0019).
 *
 * See:
 * - docs/frontend/spec.md — section 1.3, the action inventory
 */
import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { toFieldErrors } from "@/shared/utils/validation";

import { activateSaison, patchSaison, postSaison, swapGruppen } from "./mutations";
import { FLActivateSaisonPayloadSchema, FLPatchSaisonPayloadSchema, FLPostSaisonPayloadSchema, FLSwapGruppenPayloadSchema } from "./schemas";

import type { FieldErrors } from "@/shared/utils/validation";
import type {
  FLActivateSaisonPayload,
  FLActivateSaisonResponse,
  FLPatchSaisonPayload,
  FLPatchSaisonResponse,
  FLPostSaisonPayload,
  FLSwapGruppenPayload,
  FLSwapGruppenResponse,
} from "./schemas";

// `saisons._id` is the document key, so a reused id is refused by the index rather than silently
// overwriting a season -- and the honest answer names the one thing the admin can do about it.
const SAISON_ID_TAKEN = "Diese Saison-ID ist bereits vergeben. Wähle eine andere oder bearbeite die vorhandene Saison.";

/**
 * ONE SHAPE FOR EVERY GERMAN REFUSAL MESSAGE, and which one depends on where the message lands.
 *
 * - **A FIELD message** (`fieldErrors`) renders under the input it names, so the input is the remedy:
 *   ONE sentence, present tense, saying what is wrong with the value. No advice, because the advice
 *   would be "change this field", which is where the message already is.
 * - **A FORM message** (`error`) is about data this form does not show, so the remedy is elsewhere: TWO
 *   sentences, the first stating what is true and the second naming the action, imperative.
 *
 * No em dashes, no parentheses, no error codes. The code travels in the log line (docs/logging/error-codes.md); this
 * is the half a person reads.
 */

/**
 * The rules edit's refusals (`REQ-RULES-001..007` and `REQ-DATE-004`), or `null` when the 409 is
 * none of them.
 *
 * Most land on a field; the freeze, the matchday overflow and the span shrink do not, because the
 * freeze is about the whole season and the other two are about documents this form does not show.
 */
function mapRulesRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  switch (error.serverErrorCode) {
    case "REQ-RULES-001":
      return { fieldErrors: { "rules.qualifiers_per_group": "Gruppen mal Qualifizierte muss eine Zweierpotenz von 2 bis 16 ergeben." } };
    case "REQ-RULES-002":
      return { fieldErrors: { "rules.number_of_groups": "Eine Gruppe, die noch Teams hält, kann nicht wegfallen." } };
    case "REQ-RULES-003":
      return { fieldErrors: { "rules.teams_per_group": "Mindestens eine Gruppe hält schon mehr Teams als dieses Maximum." } };
    case "REQ-RULES-004":
      return {
        fieldErrors: {
          "rules.qualifiers_per_group": "Ein Platz im KO.-Baum verweist auf eine Platzierung, die dann nicht mehr erreicht wird.",
        },
      };
    case "REQ-RULES-007":
      return { fieldErrors: { "rules.qualifiers_per_group": "Eine Gruppe kann nicht mehr Teams qualifizieren, als sie fasst." } };
    case "REQ-RULES-005":
      return {
        error: "Diese Saison ist abgeschlossen, deshalb sind Punkte und Qualifizierte festgeschrieben. Ändere nur noch den Zeitraum.",
      };
    case "REQ-RULES-006":
      return {
        error:
          "Mindestens ein Spieltag enthält mehr Spiele, als diese Regeln vorsehen. Erhöhe die Zahlen wieder oder verschiebe die überzähligen Spiele.",
      };
    case "REQ-DATE-004":
      return {
        error: "Mindestens ein Spieltag liegt außerhalb des neuen Zeitraums. Erweitere den Zeitraum wieder oder verschiebe diese Spieltage.",
      };
    default:
      return null;
  }
}

/**
 * What a season's own reads depend on, plus the league table.
 *
 * `teams` rather than `saisons` alone: `GET /teams` reads the season document on every call to score
 * the derived table from `rules.win_points` and `draw_points` (ADR-0019), so an edit to those two
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

    // Two different 409s reach this call and the code separates them: `REQ-RULES-001` refuses a
    // bracket the phase set cannot hold (ADR-0052) and is checked first, because a duplicate id
    // arrives from the unique index with no code to inspect.
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

    // A created season is always `future` and never `active` (ADR-0026), so nothing that resolves the
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

    // All five rules refusals are reachable here (ADR-0052), and each has to reach the editor rather
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
 * **The outgoing season has to be finished** (`REQ-ACTIVATE-001`, decided 2026-08-08). Demoting it to
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

    // The rollover is refused while the outgoing season still has unplayed fixtures
    // (`REQ-ACTIVATE-001`). The panel already disables the button and lists them, so this is the
    // stale-page path: the answer has to name what to do rather than be a bare failure.
    let activateOperation;
    try {
      activateOperation = await activateSaison(validated.data);
    } catch (error) {
      if (error instanceof APIBadStatusError && error.statusCode === 409 && error.serverErrorCode === "REQ-ACTIVATE-001") {
        return {
          success: false,
          error: "Die laufende Saison hat noch Spiele ohne Ergebnis. Trage die Ergebnisse ein oder sage die Spiele ab.",
        };
      }
      throw error;
    }

    if (!activateOperation.acknowledged) {
      return { success: false, error: "Bei der Umstellung der Saison ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateRollover();

    // `deactivated` is normally 1. Zero means this season already held `active`, a no-op worth
    // naming; more than one means the database had drifted into a state nothing can express and this
    // call repaired it (ADR-0020).
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

/**
 * The group swap. Two clubs exchange groups; the backend writes both junction rows in one transaction.
 *
 * **`spiele` is invalidated as well as `teams`**, because the same transaction rewrites every drawn
 * Gruppenphase fixture fielding either club — each club inherits the other's opponents, dates and venues
 * (ADR-0062). A schedule served from the cache afterwards would name the club that used to play there.
 */
export async function swapGruppenAction(rawPayload: FLSwapGruppenPayload): Promise<{
  success: boolean;
  swap?: FLSwapGruppenResponse;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
}> {
  return runAdminMutation("swapGruppenAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLSwapGruppenPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // Every refusal here is reachable and the panel already prevents each one — so each of these is the
    // stale or raced page, and the message has to say what to do rather than only what went wrong.
    let swapOperation;
    try {
      swapOperation = await swapGruppen(validated.data);
    } catch (error) {
      if (error instanceof APIBadStatusError && error.statusCode === 409) {
        if (error.serverErrorCode === "REQ-SWAP-001") {
          return {
            success: false,
            error: "Die beiden Mannschaften stehen nicht mehr in zwei verschiedenen Gruppen dieser Saison. Lade die Seite neu.",
          };
        }
        if (error.serverErrorCode === "REQ-SWAP-003") {
          return {
            success: false,
            error:
              "Diese Saison ist inzwischen abgeschlossen. Eine abgeschlossene Saison wird nicht mehr verändert — " +
              "ihre Tabellen bleiben so, wie sie am Saisonende standen.",
          };
        }
        if (error.serverErrorCode === "REQ-SWAP-002") {
          return {
            success: false,
            error:
              "Die KO-Runde dieser Saison hat schon ein Ergebnis, deshalb lässt sich keine Gruppe mehr tauschen. " +
              "Die Setzung ist aus diesen Gruppen entstanden und würde sonst etwas anderes bedeuten.",
          };
        }
        if (error.serverErrorCode === "REQ-SWAP-004") {
          return {
            success: false,
            error:
              "Mindestens eine der beiden Mannschaften hat in ihrer Gruppe inzwischen gespielt. " +
              "Eine Gruppe ist ein Rundenturnier, in dem jede Mannschaft gegen jede andere ihrer Gruppe spielt — " +
              "wer darin gespielt hat, gehört dorthin. Lade die Seite neu.",
          };
        }
      }
      throw error;
    }

    if (!swapOperation.acknowledged) {
      return { success: false, error: "Beim Tausch der Gruppen ist ein unerwarteter Fehler aufgetreten" };
    }

    // Both layers for this season (ADR-0001): the base tag serves the reads that named no season, the
    // granular one those that named this one. A group decides which table counts a club's results.
    updateTag("teams");
    updateTag(`teams:saison_id:${validated.data.saison_id}`);

    // And the fixtures, on the same two layers, because the swap rewrote the sides of every drawn
    // Gruppenphase match either club was in. Without this the schedule pages keep serving the club that
    // used to play there (ADR-0001).
    updateTag("spiele");
    updateTag(`spiele:saison_id:${validated.data.saison_id}`);

    const umgeschrieben =
      swapOperation.rewritten_spiele === 0
        ? "Angesetzte Spiele gab es für die beiden noch keine."
        : swapOperation.rewritten_spiele === 1
          ? "Ein angesetztes Spiel wurde mitgetauscht."
          : `${String(swapOperation.rewritten_spiele)} angesetzte Spiele wurden mitgetauscht.`;

    return {
      success: true,
      swap: swapOperation,
      message: `Die beiden Mannschaften stehen jetzt in Gruppe ${swapOperation.team1_gruppe} und Gruppe ${swapOperation.team2_gruppe}. ${umgeschrieben}`,
    };
  });
}
