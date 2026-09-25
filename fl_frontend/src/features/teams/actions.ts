"use server";

import { updateTag } from "next/cache";

import { runAdminMutation } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { deleteTeam, patchSaisonTeam, patchTeam, postSaisonTeam, postTeam, reactivateTeam, replaceSaisonTeam } from "./mutations";
import {
  mapAlreadyEnteredRefusal,
  mapEntryRefusal,
  mapReplacementRefusal,
  mapRetireRefusal,
  mapShorthandRefusal,
  SHORTHAND_TAKEN_ON_CREATE,
  SHORTHAND_TAKEN_ON_EDIT,
} from "./refusals";
import {
  FLCreateTeamFormPayloadSchema,
  FLDeleteTeamPayloadSchema,
  FLPatchSaisonTeamPayloadSchema,
  FLPatchTeamPayloadSchema,
  FLPostSaisonTeamPayloadSchema,
  FLReactivateTeamPayloadSchema,
  FLReplaceSaisonTeamPayloadSchema,
} from "./schemas";
import { describeReplacementUmfang } from "./utils";

import type { ActionResult } from "@/shared/types/types";
import type {
  FLDeleteTeamPayload,
  FLPatchTeamPayload,
  FLReactivateTeamPayload,
  FLReplaceSaisonTeamPayload,
  FLReplaceSaisonTeamResponse,
  FLSaisonTeamResponse,
  FLTeamRecord,
} from "./schemas";
import type { SaisonTeamEnterDraft, SaisonTeamMembershipDraft, TeamCreateDraft } from "./types";

/** Both cache layers for one resource and one season: the base tag serves the default reads. */
function invalidateSeasonScoped(resource: "teams" | "spiele", saisonId: string): void {
  updateTag(resource);
  updateTag(`${resource}:saison_id:${saisonId}`);
}

export async function postTeamAction(
  // The DRAFT shape: an untouched picker submits `gruppe: null`, and the schema below is what turns
  // that into a field error rather than a type error.
  rawPayload: TeamCreateDraft,
): Promise<ActionResult<{ created_id: string }>> {
  return runAdminMutation("postTeamAction", { readOnly: false }, async () => {
    const validated = FLCreateTeamFormPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const { saison_id, gruppe, ...clubFields } = validated.data;

    // Caught here rather than left to the generic conflict mapping: a club's only unique key is its
    // shorthand, so a 409 from this request IS the shorthand.
    let postOperation;
    try {
      postOperation = await postTeam(clubFields);
    } catch (error) {
      const refusal = mapShorthandRefusal(error, SHORTHAND_TAKEN_ON_CREATE);
      if (refusal !== null) return { success: false, error: VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      throw error;
    }
    if (!postOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Das Team wurde nicht angelegt", repair: "Versuche es erneut" }) };
    }

    // The junction row, in the same action: without one the club is invisible to every
    // season-scoped read (backend spec I11). A failure here leaves the club EXISTING.
    try {
      await postSaisonTeam({ team_id: postOperation.created_id, saison_id, gruppe });
    } catch (error) {
      updateTag("teams");
      // The form pre-filters seasons and groups, so a refusal here means the picture changed under it.
      const refusal = mapEntryRefusal(error);
      const reason = refusal?.error ?? refusal?.fieldErrors?.gruppe;
      return {
        success: false,
        error: `Das Team wurde angelegt, konnte aber nicht in die Saison aufgenommen werden${
          reason ? `: ${reason}` : "."
        } Es ist dadurch auf keiner Seite sichtbar. Melde dies dem Betreiber, bevor Du es erneut versuchst.`,
      };
    }

    invalidateSeasonScoped("teams", saison_id);

    return {
      success: true,
      created_id: postOperation.created_id,
      message: "Team angelegt",
    };
  });
}

export async function patchTeamAction(rawPayload: FLPatchTeamPayload): Promise<
  ActionResult<{
    updated_document?: FLTeamRecord;
    // Both counts, because both halves of the fan-out fail silently and each answers a different
    // question — one about the seasons a club is entered in, the other about the matches it stands on.
    fanned_out_to_spiele?: number;
    fanned_out_to_saison_teams?: number;
  }>
> {
  return runAdminMutation("patchTeamAction", { readOnly: false }, async () => {
    const validated = FLPatchTeamPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The same 409 as the create: the patch replaces the shorthand wholesale, so it can collide with
    // another club's, retired ones included.
    let patchOperation;
    try {
      patchOperation = await patchTeam(validated.data);
    } catch (error) {
      const refusal = mapShorthandRefusal(error, SHORTHAND_TAKEN_ON_EDIT);
      if (refusal !== null) return { success: false, error: VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      throw error;
    }
    if (!patchOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Teamdaten wurden nicht gespeichert", repair: "Versuche es erneut" }) };
    }

    // Base tags only: the rename and its fan-out into the embedded match copies touch EVERY season's
    // entries, and no granular tag names them all.
    updateTag("teams");
    updateTag("spiele");

    return {
      success: true,
      updated_document: patchOperation.updated_document,
      fanned_out_to_spiele: patchOperation.fanned_out_to_spiele,
      fanned_out_to_saison_teams: patchOperation.fanned_out_to_saison_teams,
      message: "Team bearbeitet",
    };
  });
}

export async function deleteTeamAction(rawPayload: FLDeleteTeamPayload): Promise<ActionResult<{ updated_document?: FLTeamRecord }>> {
  return runAdminMutation("deleteTeamAction", { readOnly: false }, async () => {
    const validated = FLDeleteTeamPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The backend refuses retiring a club entered in a running or planned season
    // (`REQ-RETIRE-001`); the German answer names the rule rather than a generic conflict.
    let deleteOperation;
    try {
      deleteOperation = await deleteTeam(validated.data);
    } catch (error) {
      const refusal = mapRetireRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }
    if (!deleteOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Das Team wurde nicht stillgelegt", repair: "Versuche es erneut" }) };
    }

    // Base tag only: every list and by-id read of the club serves its `inactive_since`, whichever season
    // it names. `spiele` is untouched — a match keeps its embedded copies.
    updateTag("teams");

    return {
      success: true,
      updated_document: deleteOperation.updated_document,
      message: "Seine Spiele und Saisons bleiben erhalten.",
    };
  });
}

export async function reactivateTeamAction(rawPayload: FLReactivateTeamPayload): Promise<ActionResult<{ updated_document?: FLTeamRecord }>> {
  return runAdminMutation("reactivateTeamAction", { readOnly: false }, async () => {
    const validated = FLReactivateTeamPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const reactivateOperation = await reactivateTeam(validated.data);
    if (!reactivateOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Das Team wurde nicht reaktiviert", repair: "Versuche es erneut" }) };
    }

    updateTag("teams");

    return {
      success: true,
      updated_document: reactivateOperation.updated_document,
      message: "Team reaktiviert",
    };
  });
}

export async function postSaisonTeamAction(
  // Draft-shaped for the same reason as the create: an untouched group picker submits null.
  rawPayload: SaisonTeamEnterDraft,
): Promise<ActionResult<{ saison_team?: FLSaisonTeamResponse }>> {
  return runAdminMutation("postSaisonTeamAction", { readOnly: false }, async () => {
    const validated = FLPostSaisonTeamPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // A 409 here is one of `mapEntryRefusal`'s, or the unique index saying "already entered" — each
    // deserves its own words rather than the generic conflict message.
    let saisonTeam;
    try {
      saisonTeam = await postSaisonTeam(validated.data);
    } catch (error) {
      const refusal = mapEntryRefusal(error);
      if (refusal !== null) {
        return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      }
      const entered = mapAlreadyEnteredRefusal(error);
      if (entered !== null) return { success: false, error: entered };
      throw error;
    }

    // The `teams` pair only: the row is seeded with `austritt: null` and the match join reads
    // nothing else from it (backend spec I32), so no match changes.
    invalidateSeasonScoped("teams", validated.data.saison_id);

    return {
      success: true,
      saison_team: saisonTeam,
      // The body under `Team aufgenommen`, never a second telling of that title: the panel's heading
      // and its button already name the season (`docs/frontend/spec.md` §1.12).
      message: "Ein Austritt gibt den Platz in der Gruppe nicht wieder frei.",
    };
  });
}

export async function patchSaisonTeamAction(
  rawPayload: SaisonTeamMembershipDraft,
): Promise<ActionResult<{ saison_team?: FLSaisonTeamResponse }>> {
  return runAdminMutation("patchSaisonTeamAction", { readOnly: false }, async () => {
    const validated = FLPatchSaisonTeamPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // Addressed by its natural key, so a 409 here is an entry refusal and never a unique index. The
    // shared 409 fallback would name no reason, and it hides this page's swap control.
    let saisonTeam;
    try {
      saisonTeam = await patchSaisonTeam(validated.data);
    } catch (error) {
      const refusal = mapEntryRefusal(error);
      if (refusal !== null) {
        return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      }
      throw error;
    }

    // BOTH pairs: every match side joins this row's `austritt` at read time (backend spec I32),
    // so `teams` alone leaves a card showing a badge the league table has stopped showing.
    invalidateSeasonScoped("teams", validated.data.saison_id);
    invalidateSeasonScoped("spiele", validated.data.saison_id);

    return {
      success: true,
      saison_team: saisonTeam,
      message: "Saison-Zugehörigkeit gespeichert",
    };
  });
}

/**
 * One season's junction row, and every fixture standing on it, change hands. The schedule survives;
 * the outgoing club's `austritt` does not, because the row keeps only one, and its live squad rows
 * for the season are retired.
 */
export async function replaceSaisonTeamAction(
  rawPayload: FLReplaceSaisonTeamPayload,
): Promise<ActionResult<{ replacement?: FLReplaceSaisonTeamResponse }>> {
  return runAdminMutation("replaceSaisonTeamAction", { readOnly: false }, async () => {
    const validated = FLReplaceSaisonTeamPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // A 409 the mapper does not claim is the unique index on the junction's natural key, which the
    // generic conflict message already describes correctly.
    let replacement;
    try {
      replacement = await replaceSaisonTeam(validated.data);
    } catch (error) {
      const refusal = mapReplacementRefusal(error);
      if (refusal !== null) {
        return { success: false, error: refusal };
      }
      throw error;
    }

    if (!replacement.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Das Team wurde nicht ersetzt", repair: "Versuche es erneut" }) };
    }

    // BOTH pairs, as the group swap invalidates them: the league table now names another club, and
    // the same transaction rewrote that club's side of every fixture the season holds for it.
    invalidateSeasonScoped("teams", validated.data.saison_id);
    invalidateSeasonScoped("spiele", validated.data.saison_id);
    // The third read this write moves: the same transaction retired the outgoing club's squad, and
    // the public squad read matches on `inactive_since`. Base tag only, for the reason
    // `fl_frontend/src/features/spieler/queries.ts :: getSpieler` gives.
    updateTag("spieler");

    // Both halves said at zero too: the squad is the half of this write that reaches no page the
    // admin is looking at, so "none were" is as much the answer as a number is.
    const umfang = describeReplacementUmfang({
      fannedOutToSpiele: replacement.fanned_out_to_spiele,
      ausgetrageneSquadRows: replacement.ausgetragene_squad_rows,
    });

    return {
      success: true,
      replacement,
      // The cleared austritt as STATE rather than an event: the response carries no austritt, so
      // whether one stood here is a fact this action lacks. Named, not „dieses Team“ — the sentences
      // between point at the outgoing club.
      message: `${replacement.name} spielt jetzt in Gruppe ${replacement.gruppe}. ${umfang} Für ${replacement.name} ist in dieser Saison kein Austritt eingetragen.`,
    };
  });
}
