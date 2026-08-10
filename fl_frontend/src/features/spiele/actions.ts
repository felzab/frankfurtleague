"use server";

/**
 * SPIELE · server action
 *
 * The only writer in the slice, and the only place Spiel cache tags are invalidated. The
 * `"use server"` directive stays the first line — a misplaced one fails at request time.
 *
 * Invariants:
 * - Base tags invalidate unconditionally, granular only when a season id parses.
 * - `saison_id` stays an argument, never on the patch body: Pydantic would drop it silently.
 * - A failed season-id parse never fails the edit — work is not rejected over a cache concern.
 * - The base tags cover the bracket fixtures the backend advanced (ADR-0001, ADR-0034).
 * - Every action checks `getAdminSession()` and runs in `runAdminMutation` — a 409 reaches the
 *   toast, not the error page (docs/logging/error-codes.md).
 *
 * See:
 * - docs/frontend/spec.md — invariants I2, I3, I4, I7
 */
import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { toFieldErrors } from "@/shared/utils/validation";

import { patchAdminSpielData, previewAdminSpielData } from "./mutations";
import { FLPatchSpielDataPayloadSchema, FLSpielSchema } from "./schemas";
import { formatSpielUpdateMessage } from "./utils";

import type { FormState } from "@/shared/types/types";
import type { FieldErrors } from "@/shared/utils/validation";

/**
 * No `prevState` parameter: the caller awaits this inside a transition rather than through
 * `useActionState`. That hook exists to hold state you *render*; this form only pipes the result
 * into a toast and closes, so the reducer signature bought nothing and cost an effect. Matches
 * `patchSpielortAction` and the rest of the admin write path.
 */
/**
 * The two scheduling refusals a match write can answer with, or `null` when the 409 is neither.
 *
 * Written to the shape stated in `fl_frontend/src/features/saisons/actions.ts`. `REQ-DATE-001` lands on
 * `datum`, the field that caused it, and is one sentence about that value. `REQ-CLASH-001` is about
 * ANOTHER fixture, which this form does not show, so it is two sentences with the action second.
 */
function mapSpielRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  if (error.serverErrorCode === "REQ-DATE-001") {
    return { fieldErrors: { datum: "Dieses Datum liegt außerhalb des Zeitraums seines Spieltags." } };
  }
  if (error.serverErrorCode === "REQ-RESULT-001") {
    return {
      error:
        "Dieses Spiel hat ein Ergebnis, deshalb lässt sich die Mannschaft nicht entfernen. Wähle eine andere Mannschaft, oder lösche zuerst die Tore.",
    };
  }
  if (error.serverErrorCode === "REQ-CLASH-001") {
    return {
      error:
        "Spielort oder Schiedsrichter sind zu dieser Zeit schon für ein anderes Spiel eingeteilt. Wähle eine Uhrzeit mit mindestens vier Stunden Abstand oder eine andere Zuordnung.",
    };
  }
  return null;
}

export async function patchAdminSpielDataAction(rawPayload: unknown, rawSaisonId: unknown): Promise<NonNullable<FormState>> {
  return runAdminMutation("patchAdminSpielDataAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLPatchSpielDataPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The two scheduling refusals reach the form rather than the error page: both are about what was
    // submitted, and the editor the admin is standing in is where the wrong value still sits.
    let patch_operation;
    try {
      patch_operation = await patchAdminSpielData(validated.data);
    } catch (error) {
      const refusal = mapSpielRefusal(error);
      if (refusal) return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      throw error;
    }

    if (!patch_operation.acknowledged) {
      return { success: false, error: "Bei der Aktualisierung der Spieldaten ist ein unerwarteter Fehler aufgetreten" };
    }

    // The base tags are not redundant with the granular ones below. The default
    // read path sends no `saison_id` (ADR-0002), so the commonest entries carry
    // only `spiele` / `teams` and a season-only invalidation leaves them stale.
    updateTag("spiele");
    updateTag("teams");

    // Season comes from the loaded spiel, never the patch body -- the backend's
    // payload does not declare `saison_id` and Pydantic drops it. Validated with
    // the spiel's own field schema, so no second copy of the rule can drift.
    const saisonId = FLSpielSchema.shape.saison_id.safeParse(rawSaisonId);
    if (saisonId.success) {
      updateTag(`spiele:saison_id:${saisonId.data}`);
      updateTag(`teams:saison_id:${saisonId.data}`);
    }

    // The resolved bracket fixtures are named in the toast, each with the result it
    // destroyed (ADR-0034, ADR-0041). The faults it walked past ride along: the save
    // that introduces one is when its cause is known (ADR-0039).
    return {
      success: Boolean(patch_operation.acknowledged),
      message: formatSpielUpdateMessage(patch_operation.advanced_to, patch_operation.bracket_faults, patch_operation.released_sides),
      // Handed back whole, because the undo toast has to know WHICH fixtures lost a result before it
      // can offer to put them back (ADR-0041).
      voidedFixtures: patch_operation.advanced_to.filter((advancement) => advancement.voided_ergebnis !== null).map((entry) => entry.spiel_nr),
      releasedFixtures: patch_operation.released_sides.map((released) => released.spiel_nr),
    };
  });
}

/**
 * What saving this payload would move and destroy — asked before the admin commits to it (ADR-0041).
 *
 * `dry_run=true` writes nothing: the backend applies the payload in memory through the same
 * `apply_payload_to_spiel` the save uses and resolves the bracket against the result. So this is not a
 * prediction of the save, it is the save's own answer computed without the write.
 *
 * **No `updateTag` here, and there must never be one.** Nothing changed, so invalidating a cache would
 * evict every cached match list on each keystroke of a debounced preview.
 *
 * A failure returns an unsuccessful `FormState` and the form simply shows no warning. That is the
 * honest degradation: a preview is an extra, and an admin must never be blocked from saving because
 * the question could not be answered.
 */
export async function previewAdminSpielDataAction(rawPayload: unknown): Promise<NonNullable<FormState>> {
  return runAdminMutation("previewAdminSpielDataAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLPatchSpielDataPayloadSchema.safeParse(rawPayload);
    if (!validated.success) {
      // Silent by design: the draft is mid-edit and its own field validation already says so. A toast
      // about an incomplete payload would fire while somebody was still typing into it.
      return { success: false, error: "Die Vorschau konnte nicht berechnet werden." };
    }

    // The two scheduling refusals reach the form rather than the error page: both are about what was
    // submitted, and the editor the admin is standing in is where the wrong value still sits.
    let preview;
    try {
      preview = await previewAdminSpielData(validated.data);
    } catch (error) {
      const refusal = mapSpielRefusal(error);
      if (refusal) return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      throw error;
    }

    return {
      success: true,
      voidedFixtures: preview.advanced_to.filter((advancement) => advancement.voided_ergebnis !== null).map((entry) => entry.spiel_nr),
      releasedFixtures: preview.released_sides.map((released) => released.spiel_nr),
    };
  });
}
