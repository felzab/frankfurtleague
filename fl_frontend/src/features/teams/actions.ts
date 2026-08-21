"use server";

import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { ADMIN_FORBIDDEN, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
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

// The shorthand's unique index spans retired clubs and creating never revives, so the message names
// the one path that does.
const SHORTHAND_TAKEN =
  "Dieses Kürzel ist bereits vergeben, möglicherweise von einem stillgelegten Team. Reaktiviere dieses Team, statt es neu anzulegen.";

/** Both cache layers for one resource and one season: the base tag serves the default reads. */
function invalidateSeasonScoped(resource: "teams" | "spiele", saisonId: string): void {
  updateTag(resource);
  updateTag(`${resource}:saison_id:${saisonId}`);
}

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
    // Names the route still open rather than stopping at the refusal: the swap control sits under
    // the locked Gruppe row on the page this message lands on.
    return {
      error:
        "Für dieses Team sind in dieser Saison schon Spiele angelegt, deshalb kann es die Gruppe nicht allein wechseln. Tausche die Gruppe stattdessen mit einem zweiten Team, unter der gesperrten Gruppe auf dieser Seite.",
    };
  }
  if (error.serverErrorCode === "REQ-ENTER-005") {
    // Raised only by the club editor's season panel, and only while its page still believes the club
    // is active — so the words are `buildTeamBanners`'s, which the same panel shows once the page
    // catches up.
    return {
      error:
        "Dieses Team ist inzwischen stillgelegt und kann in keine Saison aufgenommen werden. Reaktiviere es über den Kopf der Seite und nimm es danach hier auf.",
    };
  }
  return null;
}

export async function postTeamAction(
  // The DRAFT shape: an untouched picker submits `gruppe: null`, and the schema below is what turns
  // that into a field error rather than a type error.
  rawPayload: TeamCreateDraft,
): Promise<{ success: boolean; created_id?: string; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("postTeamAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

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
      if (error instanceof APIBadStatusError && error.statusCode === 409) {
        return { success: false, error: VALIDATION_FAILED, fieldErrors: { shorthand: SHORTHAND_TAKEN } };
      }
      throw error;
    }
    if (!postOperation.acknowledged) {
      return { success: false, error: "Beim Anlegen des neuen Teams ist ein unerwarteter Fehler aufgetreten" };
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
      success: Boolean(postOperation.acknowledged),
      created_id: postOperation.created_id,
      message: "Team erfolgreich angelegt!",
    };
  });
}

export async function patchTeamAction(rawPayload: FLPatchTeamPayload): Promise<{
  success: boolean;
  updated_document?: FLTeamRecord;
  // Both counts, because both halves of the fan-out fail silently and each answers a different
  // question — one about the seasons a club is entered in, the other about the matches it stands on.
  fanned_out_to_spiele?: number;
  fanned_out_to_saison_teams?: number;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
}> {
  return runAdminMutation("patchTeamAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

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
      if (error instanceof APIBadStatusError && error.statusCode === 409) {
        return { success: false, error: VALIDATION_FAILED, fieldErrors: { shorthand: SHORTHAND_TAKEN } };
      }
      throw error;
    }
    if (!patchOperation.acknowledged) {
      return { success: false, error: "Beim Bearbeiten der Teamdaten ist ein unerwarteter Fehler aufgetreten" };
    }

    // Base tags only: the rename and its fan-out into the embedded match copies touch EVERY season's
    // entries, and no granular tag names them all.
    updateTag("teams");
    updateTag("spiele");

    return {
      success: Boolean(patchOperation.acknowledged),
      updated_document: patchOperation.updated_document,
      fanned_out_to_spiele: patchOperation.fanned_out_to_spiele,
      fanned_out_to_saison_teams: patchOperation.fanned_out_to_saison_teams,
      message: "Team erfolgreich bearbeitet!",
    };
  });
}

export async function deleteTeamAction(
  rawPayload: FLDeleteTeamPayload,
): Promise<{ success: boolean; updated_document?: FLTeamRecord; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("deleteTeamAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

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

    // Base tag only: retirement hides the club from every season's default list at once. `spiele` is
    // untouched — a match keeps its embedded copies.
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
      return { success: false, error: ADMIN_FORBIDDEN };
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
  // Draft-shaped for the same reason as the create: an untouched group picker submits null.
  rawPayload: SaisonTeamEnterDraft,
): Promise<{ success: boolean; saison_team?: FLSaisonTeamResponse; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("postSaisonTeamAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

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
      if (error instanceof APIBadStatusError && error.statusCode === 409) {
        return { success: false, error: "Dieses Team ist bereits in dieser Saison. Lade die Seite neu." };
      }
      throw error;
    }

    // The `teams` pair only: the row is seeded with `austritt: null` and the match join reads
    // nothing else from it (backend spec I32), so no match changes.
    invalidateSeasonScoped("teams", validated.data.saison_id);

    return {
      success: true,
      saison_team: saisonTeam,
      message: `Team in die Saison ${validated.data.saison_id} aufgenommen!`,
    };
  });
}

export async function patchSaisonTeamAction(
  rawPayload: SaisonTeamMembershipDraft,
): Promise<{ success: boolean; saison_team?: FLSaisonTeamResponse; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("patchSaisonTeamAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPatchSaisonTeamPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // Addressed by its natural key, so a 409 here is an entry refusal and never a unique index. The
    // generic mapping would answer "already exists" — false, and it hides this page's swap control.
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
      message: "Saison-Zugehörigkeit gespeichert!",
    };
  });
}
