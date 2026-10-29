"use server";

import { FLSpielberichtBerichtSchema } from "@/features/spielberichte/schemas";
import { runAdminMutation } from "@/shared/utils/adminMutation";
import { refusedReplay, restored, runAdminUndo, UNDO_UNREADABLE } from "@/shared/utils/adminUndo";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { patchAdminSpielData, patchAdminSpielePaarungen, previewAdminSpielData } from "./mutations";
import { mapSpielRefusal, PAARUNGEN_REPLAY_REFUSALS } from "./refusals";
import { FLPatchSpielDataPayloadSchema, FLPatchSpielePaarungenPayloadSchema } from "./schemas";
import { describeMovedSpiele, formatSpielUpdateMessage } from "./utils";

import type { ActionResult, QueryResult } from "@/shared/types/types";
import type { UndoOutcome } from "@/shared/utils/adminUndo";
import type z from "zod";
import type { FLSpielPriorBericht, FLSpielPriorPaarung } from "./schemas";

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
  /** The report adoption the save stamped over, which the undo puts back; `null` where it stamped none. */
  priorBericht?: FLSpielPriorBericht | null;
};

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
    const uebernimmtBericht = FLSpielberichtBerichtSchema.shape.version.nullable().safeParse(rawUebernimmtBericht);

    // A refusal reaches the form rather than the error page: it is about what was submitted, and
    // the editor is where the wrong value still sits.
    let patch_operation;
    try {
      patch_operation = await patchAdminSpielData(validated.data, uebernimmtBericht.success ? uebernimmtBericht.data : null);
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
      // Passed through untouched: the server built each entry from the slice it judged this write on,
      // and anything composed here would be composed from a read taken before that write.
      priorPaarungen: patch_operation.prior_paarungen,
      priorBericht: patch_operation.prior_bericht,
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

/**
 * The save's own report, never one built from the page's props, which would revert a field another
 * writer moved while the editor stood open.
 */
const SpielUndoSchema = FLPatchSpielePaarungenPayloadSchema;

export async function undoAdminSpielEditAction(rawPayload: z.input<typeof SpielUndoSchema>): Promise<UndoOutcome> {
  return runAdminUndo("undoAdminSpielEditAction", async () => {
    const validated = SpielUndoSchema.safeParse(rawPayload);
    if (!validated.success) return { success: false, error: UNDO_UNREADABLE };

    const { paarungen, bericht } = validated.data;
    let operation;
    try {
      operation = await patchAdminSpielePaarungen({ paarungen, bericht });
    } catch (error) {
      // The change standing whole: the replay is one transaction, so a refusal on any fixture leaves
      // every one of them where the save put it.
      return refusedReplay(error, PAARUNGEN_REPLAY_REFUSALS);
    }

    // The replay's own collateral: restoring the fixture the save named empties the slots below it
    // again, and a fixture the list does not put back has lost its result for good.
    return restored(describeMovedSpiele(operation.advanced_to, operation.bracket_faults, operation.released_sides));
  });
}
