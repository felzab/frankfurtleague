"use server";

/**
 * SPIELE · server action
 *
 * The only writer in the slice, and the only place Spiel cache tags are invalidated.
 *
 * NOTE: the `"use server"` directive stays the first line of the file, above this block. A directive
 * prologue must not be preceded by anything a bundler might treat as a statement, and getting it
 * wrong fails at request time rather than at build time.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Base tags invalidate unconditionally; granular tags only when a season id parses. The base tags
 *     are not redundant — the default read path sends no `saison_id`, so the most-hit entries carry
 *     only those.
 *   • `saison_id` arrives as an argument and must never move onto the patch body: the backend model
 *     does not declare it and Pydantic would drop it silently.
 *   • A failed season-id parse never fails the edit. An admin's work is not rejected over a cache
 *     concern.
 *   • The base tags also cover the bracket fixtures the backend advanced. `updateTag("spiele")` clears
 *     every `getSpiele` entry whatever its filter, so the playoffs page is invalidated by the same
 *     call as the admin's own view and no per-match tag is wanted here (ADR-0001, ADR-0042).
 *   • Every action here starts with `getAdminSession()` and checks its return value — it neither
 *     throws nor redirects.
 *   • The action body runs inside `runAdminAction`, which seeds the correlation-id request scope
 *     and converts a thrown API error into the returned result -- a 409 must reach the form's toast,
 *     not the error page (docs/logging.md).
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/frontend/spec.md — invariants I2, I3, I4, I7
 */
import { updateTag } from "next/cache";
import z from "zod";

import { getAdminSession } from "@/core/auth";
import { runAdminAction } from "@/shared/utils/serverAction";
import { toFieldErrors } from "@/shared/utils/validation";

import { patchAdminSpielData, previewAdminSpielData } from "./mutations";
import { FLPatchSpielDataPayloadSchema, FLSpielSchema } from "./schemas";
import { formatSpielUpdateMessage } from "./utils";

import type { FormState } from "@/shared/types/types";

/**
 * No `prevState` parameter: the caller awaits this inside a transition rather than through
 * `useActionState`. That hook exists to hold state you *render*; this form only pipes the result
 * into a toast and closes, so the reducer signature bought nothing and cost an effect. Matches
 * `patchSpielortAction` and the rest of the admin write path.
 */
export async function patchAdminSpielDataAction(rawPayload: unknown, rawSaisonId: unknown): Promise<NonNullable<FormState>> {
  return runAdminAction("patchAdminSpielDataAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLPatchSpielDataPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: "Bitte überprüfe deine Eingaben!",
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    const patch_operation = await patchAdminSpielData(validated.data);
    if (!patch_operation.acknowledged) {
      return { success: false, error: "Bei der Aktualisierung der Spieldaten ist ein unerwarteter Fehler aufgetreten" };
    }

    // The base tags are not redundant with the granular ones below, and must stay. Since ADR-0002 the
    // default read path sends no `saison_id` at all, so the most common cache entries carry only
    // `spiele` / `teams`; invalidating by season alone would leave exactly those entries stale.
    updateTag("spiele");
    updateTag("teams");

    // Season comes from the loaded spiel, never from the patch body -- the backend's
    // PatchSpielDataPayload does not declare `saison_id` and Pydantic would silently drop it. A spiel
    // that somehow lacks a valid one still gets the base invalidation above, so the edit is never
    // rejected over a cache concern. Validated with the spiel's own field schema rather than a second
    // copy of the rule, so the two cannot drift apart.
    const saisonId = FLSpielSchema.shape.saison_id.safeParse(rawSaisonId);
    if (saisonId.success) {
      updateTag(`spiele:saison_id:${saisonId.data}`);
      updateTag(`teams:saison_id:${saisonId.data}`);
    }

    // The bracket fixtures the backend resolved are named in the toast, so a result entry that moved
    // nothing is distinguishable from one that did -- which is the whole reason the endpoint reports
    // them (ADR-0042). Each names the result it destroyed, so a deleted scoreline gets its own
    // sentence rather than hiding behind "die Paarung wurde aktualisiert" (ADR-0051). The faults it
    // walked past ride along, because the save that introduces one is the moment its cause is known --
    // and they are re-askable on the action-required list, so a missed toast no longer loses them
    // (ADR-0047).
    return {
      success: Boolean(patch_operation.acknowledged),
      message: formatSpielUpdateMessage(patch_operation.advanced_to, patch_operation.bracket_faults, patch_operation.released_sides),
      // Handed back whole, because the undo toast has to know WHICH fixtures lost a result before it
      // can offer to put them back (ADR-0051).
      voidedFixtures: patch_operation.advanced_to.filter((advancement) => advancement.voided_ergebnis !== null).map((entry) => entry.spiel_nr),
      releasedFixtures: patch_operation.released_sides.map((released) => released.spiel_nr),
    };
  });
}

/**
 * What saving this payload would move and destroy — asked before the admin commits to it (ADR-0051).
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
  return runAdminAction("previewAdminSpielDataAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLPatchSpielDataPayloadSchema.safeParse(rawPayload);
    if (!validated.success) {
      // Silent by design: the draft is mid-edit and its own field validation already says so. A toast
      // about an incomplete payload would fire while somebody was still typing into it.
      return { success: false, error: "Die Vorschau konnte nicht berechnet werden." };
    }

    const preview = await previewAdminSpielData(validated.data);

    return {
      success: true,
      voidedFixtures: preview.advanced_to.filter((advancement) => advancement.voided_ergebnis !== null).map((entry) => entry.spiel_nr),
      releasedFixtures: preview.released_sides.map((released) => released.spiel_nr),
    };
  });
}

/**
 * Puts a batch of fixtures back the way they were, in the order given (ADR-0051).
 *
 * **What the undo toast calls.** The edited fixture's pre-edit payload comes first, so the resolution
 * it triggers restores the occupants downstream; each fixture whose result that save destroyed follows,
 * so its scoreline goes back after the bracket has stopped moving under it. The reverse order would
 * have the resolution clear what the previous request had just restored.
 *
 * **The client holds every payload**, because nothing on the server does: no admin write is recorded
 * anywhere (roadmap BE-15), so a fixture's previous state exists only in the page that was looking at
 * it. That is what bounds this undo to one page session rather than making it a history feature.
 *
 * Stops at the first failure and says how far it got. A partial restore is a worse state than either
 * end of it, so the message names the fixtures that did not make it back rather than reporting a
 * success that is not one.
 */
export async function undoAdminSpielEditAction(rawPayloads: unknown, rawSaisonId: unknown): Promise<NonNullable<FormState>> {
  return runAdminAction("undoAdminSpielEditAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = z.array(FLPatchSpielDataPayloadSchema).nonempty().safeParse(rawPayloads);
    if (!validated.success) {
      return { success: false, error: "Die Rücknahme konnte nicht ausgeführt werden." };
    }

    const restored: number[] = [];
    for (const payload of validated.data) {
      const operation = await patchAdminSpielData(payload);
      if (!operation.acknowledged) {
        return {
          success: false,
          error: `Die Rücknahme wurde nach ${restored.length} von ${validated.data.length} Spielen abgebrochen. Bitte prüfe die betroffenen Spiele.`,
        };
      }
      restored.push(restored.length);
    }

    // Identical to the save's invalidation, and for the identical reason: an undo is a write.
    updateTag("spiele");
    updateTag("teams");

    const saisonId = FLSpielSchema.shape.saison_id.safeParse(rawSaisonId);
    if (saisonId.success) {
      updateTag(`spiele:saison_id:${saisonId.data}`);
      updateTag(`teams:saison_id:${saisonId.data}`);
    }

    return { success: true, message: "Die Änderung wurde zurückgenommen." };
  });
}
