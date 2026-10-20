"use server";

import { FLSpielberichtBerichtSchema } from "@/features/spielberichte/schemas";
import { invalidatesOnWrite, runAdminMutation } from "@/shared/utils/adminMutation";
import { refusedReplay, restored, runAdminUndo, unclearReplay, UNDO_UNREADABLE } from "@/shared/utils/adminUndo";
import { buildRefusal, VERSUCHE_ES_ERNEUT } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { patchAdminSpielData, patchAdminSpielePaarungen, previewAdminSpielData } from "./mutations";
import { mapSpielRefusal, PAARUNGEN_REPLAY_REFUSALS } from "./refusals";
import { FLPatchSpielDataPayloadSchema, FLPatchSpielePaarungenPayloadSchema, FLSpielSchema } from "./schemas";
import { describeMovedSpiele, formatSpielUpdateMessage } from "./utils";

import type { ActionResult, QueryResult } from "@/shared/types/types";
import type { UndoOutcome } from "@/shared/utils/adminUndo";
import type z from "zod";
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

export async function patchAdminSpielDataAction(
  rawPayload: unknown,
  rawSaisonId: unknown,
  rawUebernimmtBericht: unknown,
): Promise<ActionResult<SavedFixtures>> {
  return runAdminMutation("patchAdminSpielDataAction", async () => {
    const validated = FLPatchSpielDataPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // Not redundant with the granular tags below: the default read path sends no `saison_id`, so
    // the commonest entries carry only these and a season-only invalidation leaves them stale.
    invalidatesOnWrite("spiele", "teams");

    // From the loaded spiel, never the patch body — the backend's payload does not declare
    // `saison_id` and Pydantic drops it. A failed parse costs a stale cache, never the edit.
    const saisonId = FLSpielSchema.shape.saison_id.safeParse(rawSaisonId);
    if (saisonId.success) invalidatesOnWrite(`spiele:saison_id:${saisonId.data}`, `teams:saison_id:${saisonId.data}`);

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

    if (!patch_operation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Spieldaten wurden nicht gespeichert", repair: VERSUCHE_ES_ERNEUT }) };
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
 * same code the save uses. **No `invalidatesOnWrite` here, ever** — nothing changed, so it would evict every
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

/**
 * The save's own report, never one built from the page's props, which would revert a field another
 * writer moved while the editor stood open; and the season keying the cached reads, which the endpoint
 * derives for itself.
 */
const SpielUndoSchema = FLPatchSpielePaarungenPayloadSchema.extend({ saison_id: FLSpielSchema.shape.saison_id });

export async function undoAdminSpielEditAction(rawPayload: z.input<typeof SpielUndoSchema>): Promise<UndoOutcome> {
  return runAdminUndo("undoAdminSpielEditAction", async () => {
    const validated = SpielUndoSchema.safeParse(rawPayload);
    if (!validated.success) return { success: false, error: UNDO_UNREADABLE };

    const { saison_id, paarungen } = validated.data;
    invalidatesOnWrite("spiele", "teams", `spiele:saison_id:${saison_id}`, `teams:saison_id:${saison_id}`);
    let operation;
    try {
      operation = await patchAdminSpielePaarungen({ paarungen });
    } catch (error) {
      // The change standing whole: the replay is one transaction, so a refusal on any fixture leaves
      // every one of them where the save put it.
      return refusedReplay(error, PAARUNGEN_REPLAY_REFUSALS);
    }

    if (!operation.acknowledged) return unclearReplay("Die Rücknahme wurde abgebrochen. Prüfe die betroffenen Spiele.");

    // The replay's own collateral: restoring the fixture the save named empties the slots below it
    // again, and a fixture the list does not put back has lost its result for good.
    return restored(describeMovedSpiele(operation.advanced_to, operation.bracket_faults, operation.released_sides));
  });
}
