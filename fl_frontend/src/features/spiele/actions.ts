"use server";

import { updateTag } from "next/cache";

import { runAdminMutation } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { patchAdminSpielData, previewAdminSpielData } from "./mutations";
import { mapSpielRefusal } from "./refusals";
import { FLPatchSpielDataPayloadSchema, FLSpielSchema } from "./schemas";
import { formatSpielUpdateMessage } from "./utils";

import type { ActionResult, QueryResult } from "@/shared/types/types";
import type { FLSpielPriorPaarung } from "./schemas";

/**
 * The `spiel_nr` of every other fixture a match write moved. Read by the edit page's live warning through
 * `dry_run=true` and by the undo toast; both are empty on an ordinary edit, which is what makes presence mean something.
 */
type MovedFixtures = {
  voidedFixtures?: number[];
  releasedFixtures?: number[];
};

/**
 * What the SAVE answers on top of that: each moved fixture as it stood before the write, which is the
 * body its undo sends back. Off the preview, which writes nothing and so has nothing to put back.
 */
type SavedFixtures = MovedFixtures & {
  priorPaarungen?: FLSpielPriorPaarung[];
};

export async function patchAdminSpielDataAction(rawPayload: unknown, rawSaisonId: unknown): Promise<ActionResult<SavedFixtures>> {
  return runAdminMutation("patchAdminSpielDataAction", async () => {
    const validated = FLPatchSpielDataPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // A refusal reaches the form rather than the error page: it is about what was submitted, and
    // the editor is where the wrong value still sits.
    let patch_operation;
    try {
      patch_operation = await patchAdminSpielData(validated.data);
    } catch (error) {
      const refusal = mapSpielRefusal(error);
      if (refusal) return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      throw error;
    }

    if (!patch_operation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Spieldaten wurden nicht gespeichert", repair: "Versuche es erneut" }) };
    }

    // Not redundant with the granular tags below: the default read path sends no `saison_id`, so
    // the commonest entries carry only these and a season-only invalidation leaves them stale.
    updateTag("spiele");
    updateTag("teams");

    // From the loaded spiel, never the patch body — the backend's payload does not declare
    // `saison_id` and Pydantic drops it. A failed parse costs a stale cache, never the edit.
    const saisonId = FLSpielSchema.shape.saison_id.safeParse(rawSaisonId);
    if (saisonId.success) {
      updateTag(`spiele:saison_id:${saisonId.data}`);
      updateTag(`teams:saison_id:${saisonId.data}`);
    }

    // The faults the resolution walked past ride along: the save that introduces one is when its
    // cause is known.
    return {
      success: true,
      message: formatSpielUpdateMessage(patch_operation.advanced_to, patch_operation.bracket_faults, patch_operation.released_sides),
      // `voided_ergebnis` alone still names every one: a no-show needs both sides and composes its
      // own forfeit, so `voided_sonderereignis` never travels without the result it produced.
      voidedFixtures: patch_operation.advanced_to.filter((advancement) => advancement.voided_ergebnis !== null).map((entry) => entry.spiel_nr),
      releasedFixtures: patch_operation.released_sides.map((released) => released.spiel_nr),
      // Passed through untouched: the server built each entry from the slice it judged this write on,
      // and anything composed here would be composed from a read taken before that write.
      priorPaarungen: patch_operation.prior_paarungen,
    };
  });
}

/**
 * The save's own answer without the write: `dry_run=true` applies the payload in memory through the
 * same code the save uses. **No `updateTag` here, ever** — nothing changed, so it would evict every
 * cached match list on every keystroke.
 */
export async function previewAdminSpielDataAction(rawPayload: unknown): Promise<QueryResult<MovedFixtures>> {
  return runAdminMutation("previewAdminSpielDataAction", async () => {
    const validated = FLPatchSpielDataPayloadSchema.safeParse(rawPayload);
    if (!validated.success) {
      // Silent by design: a toast about an incomplete payload would fire mid-keystroke, and the
      // draft's own field validation already says so. A preview is an extra; it never blocks a save.
      return { success: false, error: "Die Vorschau konnte nicht berechnet werden." };
    }

    // A refusal reaches the form rather than the error page: it is about what was submitted, and
    // the editor is where the wrong value still sits.
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
