"use server";

/**
 * SPIELER · server actions
 *
 * Full CRUD over people, plus the squad junction. The `"use server"` directive stays the first
 * line, above this block.
 *
 * Invariants:
 * - Every action checks `getAdminSession()` and runs in `runAdminMutation` — a 409 reaches the form.
 * - Base tag only, on every action: the cached spieler read spans every season (ADR-0001).
 * - `spieler` is the ONLY resource invalidated — nothing under `spiele` or `teams` reads a squad row.
 * - A junction create 409 names reactivation: the unique index keeps indexing a retired row, and
 *   creating never revives (ADR-0025).
 * - Create-and-enter is one action over two requests, person first — a player with no junction
 *   row is invisible to every season-scoped read.
 *
 * See:
 * - docs/frontend/spec.md — section 1.3, the action inventory
 */
import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { ADMIN_FORBIDDEN, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { toFieldErrors } from "@/shared/utils/validation";

import {
  deleteSaisonSpieler,
  deleteSpieler,
  patchSaisonSpieler,
  patchSpieler,
  postSaisonSpieler,
  postSpieler,
  reactivateSaisonSpieler,
  reactivateSpieler,
} from "./mutations";
import {
  FLCreateSpielerFormPayloadSchema,
  FLDeleteSpielerPayloadSchema,
  FLPatchSaisonSpielerPayloadSchema,
  FLPatchSpielerPayloadSchema,
  FLPostSaisonSpielerPayloadSchema,
  FLReactivateSpielerPayloadSchema,
  FLSaisonSpielerKeyPayloadSchema,
} from "./schemas";

import type { FieldErrors } from "@/shared/utils/validation";
import type {
  FLDeleteSpielerPayload,
  FLPatchSpielerPayload,
  FLReactivateSpielerPayload,
  FLSaisonSpielerKeyPayload,
  FLSaisonSpielerResponse,
  FLSpielerSingleResponse,
} from "./schemas";
import type { SaisonSpielerEnterDraft, SaisonSpielerMembershipDraft, SpielerCreateDraft } from "./types";

// The index spans retired rows (ADR-0025), and reviving is deliberately not the create's job -- so
// the message names the one path that is.
const ALREADY_IN_SAISON =
  "Dieser Spieler hat in dieser Saison bereits einen Kadereintrag, möglicherweise einen ausgetragenen. " +
  "Reaktiviere den Eintrag, statt einen neuen anzulegen.";

/** Every spieler read, in one call. Base tag only, for the reason in this module's invariants. */
function invalidateSpieler(): void {
  updateTag("spieler");
}

/**
 * The squad refusal (`REQ-SQUAD-001`), or `null` when the 409 is something else.
 *
 * Written to the shape stated in `fl_frontend/src/features/saisons/actions.ts`. It lands on the field
 * that caused it -- the team picker -- so it is one sentence about that value.
 */
function mapSquadRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  if (error.serverErrorCode === "REQ-SQUAD-001") {
    return { fieldErrors: { team_id: "Dieses Team ist in der gewählten Saison nicht dabei." } };
  }
  return null;
}

export async function postSpielerAction(
  // The DRAFT shape, not the parsed payload: the form may submit `team_id: null` from an untouched
  // picker, and the schema below is what turns that into a field error rather than a type error.
  rawPayload: SpielerCreateDraft,
): Promise<{ success: boolean; spieler_id?: string; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("postSpielerAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLCreateSpielerFormPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const { saison_id, team_id, nummer, position, stufe, is_nachgetragen, is_captain, ...personFields } = validated.data;

    // No 409 branch on the person: there is deliberately no uniqueness rule on a name, because two
    // people genuinely can share one and a league that refused the second would be wrong about the
    // world rather than careful.
    const postOperation = await postSpieler(personFields);
    if (!postOperation.acknowledged) {
      return { success: false, error: "Beim Anlegen des neuen Spielers ist ein unerwarteter Fehler aufgetreten" };
    }

    // The junction row, in the same action: without one the player is invisible to
    // every season-scoped read (backend spec I11), the list this form sits on
    // included. A failure here leaves the player EXISTING, which the message says.
    try {
      await postSaisonSpieler({
        spieler_id: postOperation.spieler_id,
        saison_id,
        team_id,
        nummer,
        position,
        stufe,
        is_nachgetragen,
        is_captain,
      });
    } catch (error) {
      invalidateSpieler();
      // A 409 here cannot be the player's own duplicate row, but it CAN be a squad
      // refusal naming something the admin can act on, so the reason is appended.
      // Either way the player EXISTS without a squad entry, which the message says.
      const refusal = mapSquadRefusal(error);
      const because = refusal ? ` ${refusal.error ?? Object.values(refusal.fieldErrors ?? {})[0] ?? ""}` : "";

      return {
        success: false,
        error:
          `Der Spieler wurde angelegt, konnte aber nicht in den Kader aufgenommen werden.${because} ` +
          "Er ist dadurch auf keiner Seite sichtbar. Nimm ihn über die Spielerseite in eine Saison auf.",
      };
    }

    invalidateSpieler();

    return {
      success: Boolean(postOperation.acknowledged),
      spieler_id: postOperation.spieler_id,
      message: "Spieler erfolgreich angelegt!",
    };
  });
}

export async function patchSpielerAction(rawPayload: FLPatchSpielerPayload): Promise<{
  success: boolean;
  spieler?: FLSpielerSingleResponse;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
}> {
  return runAdminMutation("patchSpielerAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPatchSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const patchOperation = await patchSpieler(validated.data);
    if (!patchOperation.acknowledged) {
      return { success: false, error: "Beim Bearbeiten der Spielerdaten ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSpieler();

    return {
      success: Boolean(patchOperation.acknowledged),
      spieler: patchOperation,
      message: "Spieler erfolgreich bearbeitet!",
    };
  });
}

// A soft delete: the backend stamps `inactive_since` (ADR-0025). The player's squad rows are left
// alone -- the seasons they played still happened, and those squad lists should still name them.
export async function deleteSpielerAction(
  rawPayload: FLDeleteSpielerPayload,
): Promise<{ success: boolean; spieler?: FLSpielerSingleResponse; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("deleteSpielerAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLDeleteSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const deleteOperation = await deleteSpieler(validated.data);
    if (!deleteOperation.acknowledged) {
      return { success: false, error: "Beim Stilllegen des Spielers ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSpieler();

    return {
      success: Boolean(deleteOperation.acknowledged),
      spieler: deleteOperation,
      message: "Spieler stillgelegt. Seine Kadereinträge bleiben erhalten.",
    };
  });
}

export async function reactivateSpielerAction(
  rawPayload: FLReactivateSpielerPayload,
): Promise<{ success: boolean; spieler?: FLSpielerSingleResponse; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("reactivateSpielerAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLReactivateSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const reactivateOperation = await reactivateSpieler(validated.data);
    if (!reactivateOperation.acknowledged) {
      return { success: false, error: "Beim Reaktivieren des Spielers ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSpieler();

    return {
      success: Boolean(reactivateOperation.acknowledged),
      spieler: reactivateOperation,
      message: "Spieler reaktiviert!",
    };
  });
}

export async function postSaisonSpielerAction(
  // Draft-shaped for the same reason as the create: an untouched team picker submits null, and the
  // schema turns that into the field error.
  rawPayload: SaisonSpielerEnterDraft,
): Promise<{ success: boolean; saison_spieler?: FLSaisonSpielerResponse; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("postSaisonSpielerAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPostSaisonSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The 409 that matters here: the unique index spans RETIRED rows, so "already
    // there" includes one the admin cannot see. It lands as a form error rather
    // than a toast, because it is about what was submitted.
    let saisonSpieler;
    try {
      // The club has to be in the season (`REQ-SQUAD-001`). It lands on the field that caused it, in
      // the form that is still open.
      saisonSpieler = await postSaisonSpieler(validated.data);
    } catch (error) {
      // Several different 409s reach this call and the code separates them. The named
      // refusals are checked first, because the fallback has no code to inspect: a
      // repeat row from the unique index is what is left once they are ruled out.
      const refusal = mapSquadRefusal(error);
      if (refusal) return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      if (error instanceof APIBadStatusError && error.statusCode === 409) {
        return { success: false, error: ALREADY_IN_SAISON };
      }
      throw error;
    }

    invalidateSpieler();

    return {
      success: true,
      saison_spieler: saisonSpieler,
      message: `Spieler in die Saison ${validated.data.saison_id} aufgenommen!`,
    };
  });
}

export async function patchSaisonSpielerAction(
  rawPayload: SaisonSpielerMembershipDraft,
): Promise<{ success: boolean; saison_spieler?: FLSaisonSpielerResponse; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("patchSaisonSpielerAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPatchSaisonSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The same squad rule as on the create (`REQ-SQUAD-001`), reaching the same field.
    let saisonSpieler;
    try {
      saisonSpieler = await patchSaisonSpieler(validated.data);
    } catch (error) {
      const refusal = mapSquadRefusal(error);
      if (refusal) return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      throw error;
    }

    invalidateSpieler();

    return {
      success: true,
      saison_spieler: saisonSpieler,
      message: "Kadereintrag gespeichert!",
    };
  });
}

// Soft, and independent of the person's own retirement: this takes the player out of ONE season's
// squad and says nothing about whether they are still in the league (ADR-0025).
export async function deleteSaisonSpielerAction(
  rawPayload: FLSaisonSpielerKeyPayload,
): Promise<{ success: boolean; saison_spieler?: FLSaisonSpielerResponse; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("deleteSaisonSpielerAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLSaisonSpielerKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const deleteOperation = await deleteSaisonSpieler(validated.data);

    invalidateSpieler();

    return {
      success: true,
      saison_spieler: deleteOperation,
      message: "Spieler aus dem Kader ausgetragen. Nummer und Position bleiben erhalten.",
    };
  });
}

export async function reactivateSaisonSpielerAction(
  rawPayload: FLSaisonSpielerKeyPayload,
): Promise<{ success: boolean; saison_spieler?: FLSaisonSpielerResponse; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("reactivateSaisonSpielerAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLSaisonSpielerKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const reactivateOperation = await reactivateSaisonSpieler(validated.data);

    invalidateSpieler();

    return {
      success: true,
      saison_spieler: reactivateOperation,
      message: "Kadereintrag reaktiviert. Nummer, Position und Stufe sind wiederhergestellt.",
    };
  });
}
