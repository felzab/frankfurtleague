"use server";

/**
 * SPIELTAGE · server actions
 *
 * Full CRUD over matchdays, retirement included. The `"use server"` directive stays the first line,
 * above this block.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Every action body runs inside `runAdminMutation`, which seeds the correlation-id request scope
 *     and converts a thrown API error into the returned result (docs/logging.md).
 *   • Every action begins with `getAdminSession()` and CHECKS the result.
 *   • Base tag only, on every action here. The admin list spans a season's matchdays including retired
 *     ones and the public Spielplan reads the default season, so no granular tag names what one write
 *     changes -- and a granular tag nothing invalidates is decoration (ADR-0001).
 *   • `spieltage` is the ONLY resource invalidated. A matchday joins into no second resource:
 *     `GET /spiele` never joins `spieltage`, which is the same fact that makes retirement safe.
 *   • **Five 409s, and not one is about a unique index.** No field of a matchday is unique and none needs
 *     to be -- its place in the season is derived and so is its name (ADR-0064, ADR-0067), so there is
 *     nothing to claim. Three are about the matchday's own CONTENTS, which it does not know about:
 *     retiring one that holds a played result would take that result off the public Spielplan
 *     (`REQ-RETIRE-002`), a phase accounting for fewer matches than are attached would strand them
 *     (`REQ-SPIELTAG-002`), and a span shrunk below its own fixtures' dates would leave them outside it
 *     (`REQ-DATE-003`). Two are about its CONTAINER, and both can refuse the CREATE: a span outside the
 *     season it belongs to (`REQ-DATE-002`), and a season whose knockout phase is already under way, which
 *     takes no new matchdays at all (`REQ-SPIELTAG-003`).
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

import { deleteSpieltag, patchSpieltag, postSpieltag, reactivateSpieltag } from "./mutations";
import { FLPatchSpieltagPayloadSchema, FLPostSpieltagPayloadSchema, FLSpieltagKeyPayloadSchema } from "./schemas";

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLPatchSpieltagPayload, FLSpieltagKeyPayload, FLSpieltagWriteResponse } from "./schemas";
import type { SpieltagCreateDraft } from "./types";

const VALIDATION_FAILED = "Bitte überprüfe deine Eingaben!";

/**
 * The five matchday refusals in German, or `null` when the 409 is none of them.
 *
 * Written to the shapes stated in `fl_frontend/src/features/saisons/actions.ts`. Two land on a field and
 * are one sentence about that value: `REQ-SPIELTAG-002` on `saison_phase`, and `REQ-DATE-002` on `beginn`,
 * which is the earlier of the two dates and so the one to look at first. The other two have no field to
 * land on -- `REQ-RETIRE-002` is raised from a dialog rather than a form, `REQ-DATE-003` is about FIXTURES
 * this form does not show, and `REQ-SPIELTAG-003` is about the SEASON's own schedule -- so each is two
 * sentences with the action second.
 */
function mapSpieltagRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  if (error.serverErrorCode === "REQ-RETIRE-002") {
    return {
      error:
        "Dieser Spieltag hat gespielte Partien und würde samt ihren Ergebnissen aus dem öffentlichen Spielplan verschwinden. Verschiebe die Spiele auf einen anderen Spieltag oder sage sie ab.",
    };
  }
  if (error.serverErrorCode === "REQ-SPIELTAG-002") {
    return { fieldErrors: { saison_phase: "In dieser Phase sind weniger Spiele vorgesehen, als dieser Spieltag enthält." } };
  }
  if (error.serverErrorCode === "REQ-SPIELTAG-003") {
    return {
      error:
        "Die KO.-Runde dieser Saison hat schon begonnen, deshalb lassen sich keine Spieltage mehr anlegen. Verschiebe den Beginn der KO.-Runde oder wähle eine andere Saison.",
    };
  }
  if (error.serverErrorCode === "REQ-DATE-002") {
    return { fieldErrors: { beginn: "Dieser Zeitraum liegt außerhalb des Zeitraums der Saison." } };
  }
  if (error.serverErrorCode === "REQ-DATE-003") {
    return {
      error:
        "Mindestens ein Spiel dieses Spieltags liegt außerhalb des neuen Zeitraums. Erweitere den Zeitraum wieder oder verlege diese Spiele.",
    };
  }
  return null;
}

/** Every spieltage read, in one call. Base tag only, for the reason in this module's invariants. */
function invalidateSpieltage(): void {
  updateTag("spieltage");
}

export async function postSpieltagAction(
  // The DRAFT shape, not the parsed payload: the form may submit `saison_phase: null` from an
  // untouched picker, and the schema below is what turns that into a field error rather than a type
  // error.
  rawPayload: SpieltagCreateDraft,
): Promise<{ success: boolean; spieltag_id?: string; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("postSpieltagAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLPostSpieltagPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The create has two refusals of its own: a span outside the season it names (`REQ-DATE-002`), and a
    // season whose knockout phase has already begun (`REQ-SPIELTAG-003`). The other three are about
    // fixtures, and a new matchday has none.
    let postOperation;
    try {
      postOperation = await postSpieltag(validated.data);
    } catch (error) {
      const refusal = mapSpieltagRefusal(error);
      if (refusal) return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      throw error;
    }

    if (!postOperation.acknowledged) {
      return { success: false, error: "Beim Anlegen des neuen Spieltags ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSpieltage();

    return {
      success: true,
      spieltag_id: postOperation.spieltag_id,
      // No name to echo: one is composed by the reader from the phase and the position (ADR-0067), and
      // the position is only known once this matchday is in the list beside its siblings.
      message: "Spieltag angelegt.",
    };
  });
}

export async function patchSpieltagAction(rawPayload: FLPatchSpieltagPayload): Promise<{
  success: boolean;
  spieltag?: FLSpieltagWriteResponse;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
}> {
  return runAdminMutation("patchSpieltagAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLPatchSpieltagPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The phase is refused if the matchday already holds more fixtures than it accounts for
    // (`REQ-SPIELTAG-002`), which lands on the phase field in the dialog that is still open.
    let patchOperation;
    try {
      patchOperation = await patchSpieltag(validated.data);
    } catch (error) {
      const refusal = mapSpieltagRefusal(error);
      if (refusal) return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      throw error;
    }

    if (!patchOperation.acknowledged) {
      return { success: false, error: "Bei der Bearbeitung des Spieltags ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSpieltage();

    return { success: true, spieltag: patchOperation, message: "Spieltag gespeichert!" };
  });
}

// Soft: the backend stamps `inactive_since` and removes nothing (ADR-0032). Its matches are left alone
// and stay resolvable, which is the reason this is not a delete — but they do leave the public Spielplan
// with the matchday, which is why a matchday holding a RESULT is refused (`REQ-RETIRE-002`).
export async function deleteSpieltagAction(rawPayload: FLSpieltagKeyPayload): Promise<{
  success: boolean;
  spieltag?: FLSpieltagWriteResponse;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
}> {
  return runAdminMutation("deleteSpieltagAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLSpieltagKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The retirement is refused while the matchday holds a result (`REQ-RETIRE-002`). It reaches the
    // dialog rather than the error page, because the dialog is where the decision is being taken.
    let deleteOperation;
    try {
      deleteOperation = await deleteSpieltag(validated.data);
    } catch (error) {
      const refusal = mapSpieltagRefusal(error);
      if (refusal) return { success: false, ...refusal };
      throw error;
    }

    if (!deleteOperation.acknowledged) {
      return { success: false, error: "Beim Stilllegen des Spieltags ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSpieltage();

    return {
      success: true,
      spieltag: deleteOperation,
      message: "Spieltag stillgelegt. Seine Spiele bleiben erhalten.",
    };
  });
}

export async function reactivateSpieltagAction(rawPayload: FLSpieltagKeyPayload): Promise<{
  success: boolean;
  spieltag?: FLSpieltagWriteResponse;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
}> {
  return runAdminMutation("reactivateSpieltagAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLSpieltagKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const reactivateOperation = await reactivateSpieltag(validated.data);
    if (!reactivateOperation.acknowledged) {
      return { success: false, error: "Beim Reaktivieren des Spieltags ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSpieltage();

    return { success: true, spieltag: reactivateOperation, message: "Spieltag reaktiviert." };
  });
}
