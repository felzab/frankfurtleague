"use server";

import { SpielePatchSpielQueryParams } from "@/core/generated/zod/inputs";
import { runAdminMutation } from "@/shared/utils/adminMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { patchAdminSpielData, previewAdminSpielData } from "./mutations";
import { mapSpielRefusal } from "./refusals";
import { FLPatchSpielDataPayloadSchema } from "./schemas";
import { formatSpielUpdateMessage } from "./utils";

import type { ActionResult, QueryResult } from "@/shared/types/types";

/**
 * The `spiel_nr` of every other fixture a match write moved. Read by the edit page's live warning through
 * `dry_run=true` and by the save's toast; both are empty on an ordinary edit, which is what makes presence mean something.
 */
type MovedFixtures = {
  voidedFixtures?: number[];
  releasedFixtures?: number[];
};

/**
 * What the SAVE answers on top of that: whether the report adoption it was asked for was stamped, `false` where the
 * report changed since the editor was seeded from it, `null` where none was asked.
 */
type SavedFixtures = MovedFixtures & { berichtUebernommen?: boolean | null };

export async function patchAdminSpielDataAction(rawPayload: unknown, rawUebernimmtBericht: unknown): Promise<ActionResult<SavedFixtures>> {
  return runAdminMutation("patchAdminSpielDataAction", async () => {
    const validated = FLPatchSpielDataPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // A failed parse costs the adoption, never the edit: the report reads not adopted, and adopting it again repairs that.
    const uebernimmtBericht = SpielePatchSpielQueryParams.shape.uebernimmt_bericht.safeParse(rawUebernimmtBericht);

    // A refusal reaches the form rather than the error page: it is about what was submitted, and
    // the editor is where the wrong value still sits.
    let patch_operation;
    try {
      patch_operation = await patchAdminSpielData(validated.data, uebernimmtBericht.success ? (uebernimmtBericht.data ?? null) : null);
    } catch (error) {
      const refusal = mapSpielRefusal(error);
      if (refusal) return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      throw error;
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
      berichtUebernommen: patch_operation.bericht_uebernommen,
    };
  });
}

/**
 * The save's own answer without the write: `dry_run=true` applies the payload in memory through the
 * same code the save uses. Its call is sent as changing nothing, so the spine clears no cached read on a keystroke.
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
