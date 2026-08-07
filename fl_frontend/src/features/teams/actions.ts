"use server";

/**
 * TEAMS · server actions
 *
 * Full CRUD over clubs, plus the season junction. The `"use server"` directive stays the first
 * line, above this block.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Every action body runs inside `runAdminMutation`, which seeds the correlation-id request scope
 *     and converts a thrown API error into the returned result -- a 409 must reach the form, not the
 *     error page (docs/logging.md).
 *   • Every action begins with `getAdminSession()` and CHECKS the result.
 *   • The club patch invalidates `spiele` as well as `teams`, because the backend fans the new name
 *     and shorthand into every match embedding them (ADR-0028 rule 3). Base tags only: the club is
 *     season-independent, so the rename touches every season's cache entries at once.
 *   • A JUNCTION write invalidates the `spiele` pair as well as the `teams` pair, base and granular
 *     both (ADR-0001). Every side of every match carries the team's `disqualifikation` joined from
 *     the junction (I32), so writing the junction changes what `GET /spiele` returns -- invalidating
 *     `teams` alone leaves every Spiel card showing a badge the league table has stopped showing.
 *   • A create 409 is answered SPECIFICALLY. `shorthand` is held unique across every club, retired
 *     ones included (ADR-0032), so the honest answer names the reactivate path rather than reporting
 *     a generic conflict -- and it lands on the field, not in a toast.
 *   • Creating a club and entering it into a season is ONE action over two requests, club first. A
 *     club with no junction row is invisible to every season-scoped read (I11), so a create that
 *     stopped after the first request would succeed into a state no page can show.
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

import { deleteTeam, patchSaisonTeam, patchTeam, postSaisonTeam, postTeam, reactivateTeam } from "./mutations";
import {
  FLCreateTeamFormPayloadSchema,
  FLDeleteTeamPayloadSchema,
  FLPatchSaisonTeamPayloadSchema,
  FLPatchTeamPayloadSchema,
  FLPostSaisonTeamPayloadSchema,
  FLReactivateTeamPayloadSchema,
} from "./schemas";

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLDeleteTeamPayload, FLPatchTeamPayload, FLReactivateTeamPayload, FLSaisonTeamResponse, FLTeamRecord } from "./schemas";
import type { SaisonTeamEnterDraft, SaisonTeamMembershipDraft, TeamCreateDraft } from "./types";

const VALIDATION_FAILED = "Bitte überprüfe deine Eingaben!";

// The shorthand's unique index spans retired clubs (ADR-0032), and reviving is deliberately not the
// create's job -- so the message names the one path that is.
const SHORTHAND_TAKEN =
  "Dieses Kürzel ist bereits vergeben, möglicherweise von einem stillgelegten Team. Reaktiviere dieses Team, statt es neu anzulegen.";

/** Both cache layers for one resource and one season (ADR-0001): the base tag serves the default reads. */
function invalidateSeasonScoped(resource: "teams" | "spiele", saisonId: string): void {
  updateTag(resource);
  updateTag(`${resource}:saison_id:${saisonId}`);
}

/**
 * The junction write's four refusals (`REQ-ENTER-001..004`), or `null` when the 409 is none of them.
 *
 * Written to the shape stated in `fl_frontend/src/features/saisons/actions.ts`: the two group gates land
 * on the picker and are one sentence about the chosen group, while the season gate and the group-move
 * window are about the season's own state, so each is two sentences with the action second.
 */
function mapEntryRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;
  if (error.serverErrorCode === "REQ-ENTER-001") {
    return { error: "Diese Saison läuft schon oder ist abgeschlossen. Nimm das Team in eine geplante Saison auf." };
  }
  if (error.serverErrorCode === "REQ-ENTER-002") {
    return { fieldErrors: { gruppe: "Diese Gruppe gibt es in der gewählten Saison nicht." } };
  }
  if (error.serverErrorCode === "REQ-ENTER-003") {
    return { fieldErrors: { gruppe: "Diese Gruppe ist bereits voll." } };
  }
  if (error.serverErrorCode === "REQ-ENTER-004") {
    return {
      error:
        "Für dieses Team sind in dieser Saison schon Spiele angelegt. Ein Gruppenwechsel ist nur möglich, solange die Saison geplant ist oder noch keine Spiele bestehen.",
    };
  }
  return null;
}

export async function postTeamAction(
  // The DRAFT shape, not the parsed payload: the form may submit `gruppe: null` from an untouched
  // picker, and the schema below is what turns that into a field error rather than a type error.
  rawPayload: TeamCreateDraft,
): Promise<{ success: boolean; created_id?: string; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("postTeamAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLCreateTeamFormPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const { saison_id, gruppe, ...clubFields } = validated.data;

    // Caught here rather than left to `runAdminMutation`'s generic conflict mapping: the only unique
    // key a club has is its shorthand, so a 409 from this request IS the shorthand, and the message
    // belongs on that field.
    let postOperation;
    try {
      postOperation = await postTeam(clubFields);
    } catch (error) {
      if (error instanceof APIBadStatusError && error.statusCode === 409) {
        return { success: false, error: VALIDATION_FAILED, fieldErrors: { shorthand: SHORTHAND_TAKEN } };
      }
      throw error;
    }
    if (!postOperation.acknowledged) {
      return { success: false, error: "Beim Anlegen des neuen Teams ist ein unerwarteter Fehler aufgetreten" };
    }

    // The junction row, in the same action: without one the club is invisible to every season-scoped
    // read (I11), including the list this form sits on. If this second request fails, the club
    // EXISTS -- the error says so plainly rather than pretending nothing happened, because retrying
    // the whole form would then 409 on the shorthand of the club just created.
    try {
      await postSaisonTeam({ team_id: postOperation.created_id, saison_id, gruppe });
    } catch (error) {
      updateTag("teams");
      // A capacity refusal names its reason; the form pre-filters seasons and groups, so reaching
      // one here means the picture changed under the form. Either way the club now EXISTS without a
      // season, so the message says so instead of pretending nothing happened.
      const refusal = mapEntryRefusal(error);
      const reason = refusal?.error ?? refusal?.fieldErrors?.gruppe;
      return {
        success: false,
        error: `Das Team wurde angelegt, konnte aber nicht in die Saison aufgenommen werden${
          reason ? `: ${reason}` : "."
        } Es ist dadurch auf keiner Seite sichtbar. Bitte melde dies dem Betreiber, bevor Du es erneut versuchst.`,
      };
    }

    invalidateSeasonScoped("teams", saison_id);

    return {
      success: Boolean(postOperation.acknowledged),
      created_id: postOperation.created_id,
      message: "Team erfolgreich angelegt!",
    };
  });
}

export async function patchTeamAction(rawPayload: FLPatchTeamPayload): Promise<{
  success: boolean;
  updated_document?: FLTeamRecord;
  fanned_out_to_spiele?: number;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
}> {
  return runAdminMutation("patchTeamAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLPatchTeamPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The same specific 409 as the create: the patch replaces the shorthand wholesale, so it can
    // collide with another club's -- retired ones included -- exactly as a create can.
    let patchOperation;
    try {
      patchOperation = await patchTeam(validated.data);
    } catch (error) {
      if (error instanceof APIBadStatusError && error.statusCode === 409) {
        return { success: false, error: VALIDATION_FAILED, fieldErrors: { shorthand: SHORTHAND_TAKEN } };
      }
      throw error;
    }
    if (!patchOperation.acknowledged) {
      return { success: false, error: "Beim Bearbeiten der Teamdaten ist ein unerwarteter Fehler aufgetreten" };
    }

    // Base tags only, on purpose: the club document is season-independent, so the rename and its
    // fan-out into the embedded match copies touch EVERY season's cache entries, and no single
    // granular tag names them all.
    updateTag("teams");
    updateTag("spiele");

    return {
      success: Boolean(patchOperation.acknowledged),
      updated_document: patchOperation.updated_document,
      fanned_out_to_spiele: patchOperation.fanned_out_to_spiele,
      message: "Team erfolgreich bearbeitet!",
    };
  });
}

// This is a soft delete: the backend stamps `inactive_since` (ADR-0032).
export async function deleteTeamAction(
  rawPayload: FLDeleteTeamPayload,
): Promise<{ success: boolean; updated_document?: FLTeamRecord; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("deleteTeamAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLDeleteTeamPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The backend refuses retiring a club that is entered in a running or planned season
    // (REQ-RETIRE-001); the German answer names the rule instead of a generic conflict.
    let deleteOperation;
    try {
      deleteOperation = await deleteTeam(validated.data);
    } catch (error) {
      if (error instanceof APIBadStatusError && error.statusCode === 409 && error.serverErrorCode === "REQ-RETIRE-001") {
        return {
          success: false,
          error: "Das Team spielt in einer laufenden oder geplanten Saison und kann nicht stillgelegt werden.",
        };
      }
      throw error;
    }
    if (!deleteOperation.acknowledged) {
      return { success: false, error: "Beim Stilllegen des Teams ist ein unerwarteter Fehler aufgetreten" };
    }

    // Base tag only: retirement hides the club from every season's default list at once, so no
    // single granular tag covers it. `spiele` is untouched -- a match keeps its embedded copies.
    updateTag("teams");

    return {
      success: Boolean(deleteOperation.acknowledged),
      updated_document: deleteOperation.updated_document,
      message: "Team stillgelegt. Seine Spiele und Saisons bleiben erhalten.",
    };
  });
}

export async function reactivateTeamAction(
  rawPayload: FLReactivateTeamPayload,
): Promise<{ success: boolean; updated_document?: FLTeamRecord; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("reactivateTeamAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLReactivateTeamPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const reactivateOperation = await reactivateTeam(validated.data);
    if (!reactivateOperation.acknowledged) {
      return { success: false, error: "Beim Reaktivieren des Teams ist ein unerwarteter Fehler aufgetreten" };
    }

    updateTag("teams");

    return {
      success: Boolean(reactivateOperation.acknowledged),
      updated_document: reactivateOperation.updated_document,
      message: "Team reaktiviert!",
    };
  });
}

export async function postSaisonTeamAction(
  // Draft-shaped for the same reason as the create: an untouched group picker submits null, and the
  // schema turns that into the field error.
  rawPayload: SaisonTeamEnterDraft,
): Promise<{ success: boolean; saison_team?: FLSaisonTeamResponse; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("postSaisonTeamAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLPostSaisonTeamPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // A 409 here is one of the capacity refusals (REQ-ENTER-001..003) or the unique index saying
    // "already entered" -- each deserves its own words rather than the generic conflict message.
    let saisonTeam;
    try {
      saisonTeam = await postSaisonTeam(validated.data);
    } catch (error) {
      const refusal = mapEntryRefusal(error);
      if (refusal !== null) {
        return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      }
      if (error instanceof APIBadStatusError && error.statusCode === 409) {
        return { success: false, error: "Dieses Team ist bereits in dieser Saison. Bitte lade die Seite neu." };
      }
      throw error;
    }

    // The `teams` pair only. The new row changes which clubs the season's team reads return; it
    // cannot change a match, because the row is seeded with `disqualifikation: null` and the join
    // reads nothing else from it (I32).
    invalidateSeasonScoped("teams", validated.data.saison_id);

    return {
      success: true,
      saison_team: saisonTeam,
      message: `Mannschaft in die Saison ${validated.data.saison_id} aufgenommen!`,
    };
  });
}

export async function patchSaisonTeamAction(
  rawPayload: SaisonTeamMembershipDraft,
): Promise<{ success: boolean; saison_team?: FLSaisonTeamResponse; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("patchSaisonTeamAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLPatchSaisonTeamPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const saisonTeam = await patchSaisonTeam(validated.data);

    // BOTH resource pairs (ADR-0001), and the `spiele` pair is not optional: every side of every
    // match carries this row's `disqualifikation` joined at read time (I32), so this write changes
    // what `GET /spiele` returns for the whole season. `teams` alone would leave every Spiel card
    // showing a DQ badge the league table has already stopped showing -- and nothing would report it.
    invalidateSeasonScoped("teams", validated.data.saison_id);
    invalidateSeasonScoped("spiele", validated.data.saison_id);

    return {
      success: true,
      saison_team: saisonTeam,
      message: "Saison-Zugehörigkeit gespeichert!",
    };
  });
}
