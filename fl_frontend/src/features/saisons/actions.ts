"use server";

import { refresh, updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { ADMIN_FORBIDDEN, refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { activateSaison, generateSpielplan, patchSaison, postSaison, swapGruppen, undrawSpielplan } from "./mutations";
import { mapActivateRefusal, mapRulesRefusal, mapSaisonIdRefusal, mapSpielplanRefusal, mapSwapRefusal, mapUndrawRefusal } from "./refusals";
import {
  FLActivateSaisonPayloadSchema,
  FLGenerateSpielplanPayloadSchema,
  FLPatchSaisonPayloadSchema,
  FLPostSaisonPayloadSchema,
  FLSwapGruppenPayloadSchema,
  FLUndrawSpielplanPayloadSchema,
} from "./schemas";
import { describeSpielplanUmfang } from "./utils";

import type { FLSaisonRulesDraft, SaisonCreateDraft } from "@/features/saisons/types";
import type { ActionResult } from "@/shared/types/types";
import type {
  FLActivateSaisonPayload,
  FLActivateSaisonResponse,
  FLGenerateSpielplanPayload,
  FLGenerateSpielplanResponse,
  FLPatchSaisonPayload,
  FLPatchSaisonResponse,
  FLSwapGruppenPayload,
  FLSwapGruppenResponse,
  FLUndrawSpielplanPayload,
  FLUndrawSpielplanResponse,
} from "./schemas";

/** `teams` too: the league table is scored from `rules` on read, so an edit moves every standing. */
function invalidateSaisonAndTable(): void {
  updateTag("saisons");
  updateTag("teams");
}

/**
 * Every read that omits `saison_id` answers differently after this, and its cache entry carries no
 * season id to invalidate more narrowly by.
 */
function invalidateRollover(): void {
  updateTag("saisons");
  updateTag("spiele");
  updateTag("spieltage");
  updateTag("teams");
  // A squad read naming a club and no season answers for the running one (`docs/backend/spec.md :: I4`).
  updateTag("spieler");
}

/**
 * `teams` too, for a reason no fixture count shows: a drawn season has fixtures still to play, which
 * `fl_backend/app/api/teams/services.py :: _may_hold_a_platz` reads when it breaks a tie, so the
 * group order moves without a single result being entered.
 */
function invalidateSpielplan(saisonId: string): void {
  updateTag("saisons");
  // Base tag alone, `getSpieltage` declaring no granular one.
  updateTag("spieltage");

  updateTag("spiele");
  updateTag(`spiele:saison_id:${saisonId}`);

  updateTag("teams");
  updateTag(`teams:saison_id:${saisonId}`);
}

export async function postSaisonAction(
  // The DRAFT shape: an emptied rule count submits `null`, and the schema below is what turns that into a
  // field error rather than a type error.
  rawPayload: SaisonCreateDraft,
): Promise<ActionResult<{ created_id: string }>> {
  return runAdminMutation("postSaisonAction", { readOnly: false }, async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPostSaisonPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // Every mapped refusal is read first: a duplicate `_id` arrives from the unique index with no
    // rule code to discriminate on, so "die ID ist vergeben" can only be the fallback.
    let postOperation;
    try {
      postOperation = await postSaison(validated.data);
    } catch (error) {
      const refusal = mapRulesRefusal(error);
      if (refusal) return refusalResult(refusal);
      const taken = mapSaisonIdRefusal(error);
      if (taken !== null) return { success: false, ...taken };
      throw error;
    }

    if (!postOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Saison wurde nicht angelegt", repair: "Versuche es erneut" }) };
    }

    // A create lands `future`, so nothing resolving the current season moves. Only the list does.
    updateTag("saisons");
    refresh();

    return {
      success: true,
      created_id: postOperation.created_id,
      // The id is the body's rather than the title's: `fl_frontend/src/core/toastTitles.test.ts`
      // holds every title to a closed set, which one carrying a season could never join.
      message: `Saison ${validated.data.id} wird erst mit der Umstellung zur laufenden Saison.`,
    };
  });
}

export async function patchSaisonAction(
  rawPayload: Omit<FLPatchSaisonPayload, "rules"> & { rules: FLSaisonRulesDraft },
): Promise<ActionResult<{ saison?: FLPatchSaisonResponse }>> {
  return runAdminMutation("patchSaisonAction", { readOnly: false }, async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPatchSaisonPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // Every rules refusal has to reach the editor rather than the error page: the panel the admin is
    // looking at is where the wrong value still sits.
    let patchOperation;
    try {
      patchOperation = await patchSaison(validated.data);
    } catch (error) {
      const refusal = mapRulesRefusal(error);
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    if (!patchOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Saison wurde nicht gespeichert", repair: "Versuche es erneut" }) };
    }

    invalidateSaisonAndTable();
    refresh();

    return {
      success: true,
      saison: patchOperation,
      message: "Saison gespeichert",
    };
  });
}

/**
 * The only path to `status: "active"`, under four refusals:
 *
 * - `REQ-ACTIVATE-001` while the outgoing season owes results
 * - `REQ-ACTIVATE-002` on a `past` target nothing reopens
 * - `REQ-ACTIVATE-003` on one with nothing drawn to play
 * - `REQ-ACTIVATE-004` on one whose matchdays are not dated
 */
export async function activateSaisonAction(rawPayload: FLActivateSaisonPayload): Promise<ActionResult<{ saison?: FLActivateSaisonResponse }>> {
  return runAdminMutation("activateSaisonAction", { readOnly: false }, async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLActivateSaisonPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let activateOperation;
    try {
      activateOperation = await activateSaison(validated.data);
    } catch (error) {
      const refusal = mapActivateRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!activateOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Saison wurde nicht umgestellt", repair: "Versuche es erneut" }) };
    }

    invalidateRollover();
    refresh();

    // Any count but 1 is worth naming: 0 is a no-op, and more than one means the database had drifted
    // into a state nothing can express and this call repaired it.
    const demoted = activateOperation.deactivated;
    const message =
      demoted === 0
        ? `Saison ${validated.data.id} war schon aktiv.`
        : demoted === 1
          ? `Saison ${validated.data.id} ist jetzt aktiv. Die vorherige Saison ist abgeschlossen.`
          : `Saison ${validated.data.id} ist jetzt aktiv. ${String(demoted)} vorher aktive Saisons wurden abgeschlossen.`;

    return { success: true, saison: activateOperation, message };
  });
}

/**
 * Two clubs exchange groups. **`spiele` is invalidated as well as `teams`**: the same transaction
 * rewrites every drawn Gruppenphase fixture fielding either club, so a cached schedule would name the
 * club that used to play there.
 */
export async function swapGruppenAction(rawPayload: FLSwapGruppenPayload): Promise<ActionResult<{ swap?: FLSwapGruppenResponse }>> {
  return runAdminMutation("swapGruppenAction", { readOnly: false }, async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLSwapGruppenPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let swapOperation;
    try {
      swapOperation = await swapGruppen(validated.data);
    } catch (error) {
      const refusal = mapSwapRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!swapOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Gruppen wurden nicht getauscht", repair: "Versuche es erneut" }) };
    }

    // Both layers (`docs/frontend/spec.md` §1.4).
    updateTag("teams");
    updateTag(`teams:saison_id:${validated.data.saison_id}`);

    updateTag("spiele");
    updateTag(`spiele:saison_id:${validated.data.saison_id}`);
    refresh();

    const umgeschrieben =
      swapOperation.rewritten_spiele === 0
        ? "Angesetzte Spiele gab es für die beiden noch keine."
        : swapOperation.rewritten_spiele === 1
          ? "Ein angesetztes Spiel wurde mitgetauscht."
          : `${String(swapOperation.rewritten_spiele)} angesetzte Spiele wurden mitgetauscht.`;

    return {
      success: true,
      swap: swapOperation,
      message: `Die beiden Teams stehen jetzt in Gruppe ${swapOperation.team1_gruppe} und Gruppe ${swapOperation.team2_gruppe}. ${umgeschrieben}`,
    };
  });
}

/**
 * The one path to a season's fixtures, on `POST /saisons/{saison_id}/spielplan`. **`replace` deletes
 * the season's matchdays and fixtures and draws fresh ones** (`REQ-SPIELPLAN-005`), and nothing
 * writes them back (`docs/backend/spec.md :: I26`).
 */
export async function generateSpielplanAction(
  rawPayload: FLGenerateSpielplanPayload,
): Promise<ActionResult<{ spielplan?: FLGenerateSpielplanResponse }>> {
  return runAdminMutation("generateSpielplanAction", { readOnly: false }, async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLGenerateSpielplanPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let generateOperation;
    try {
      generateOperation = await generateSpielplan(validated.data);
    } catch (error) {
      // Read off the VALIDATED payload rather than the raw one: what the endpoint judged is what
      // survived the parse, and a fault message naming the wrong panel is worse than a bare one.
      const refusal = mapSpielplanRefusal(error, (validated.data.shape ?? null) !== null);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!generateOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Spielplan wurde nicht angelegt", repair: "Versuche es erneut" }) };
    }

    invalidateSpielplan(validated.data.id);
    refresh();

    // `stehen` and not `hat`, so the shared phrase can stay nominative for the panel's readout too.
    const umfang = describeSpielplanUmfang(generateOperation.spieltage, generateOperation.spiele);

    // Said first where a replace removed rows, and off the response's counts rather than the
    // request's flag: the flag restates what was asked for, the counts say what is actually gone.
    const geloescht =
      generateOperation.removed_spieltage > 0 || generateOperation.removed_spiele > 0
        ? `Gelöscht wurden zuerst ${describeSpielplanUmfang(generateOperation.removed_spieltage, generateOperation.removed_spiele)} des bisherigen Spielplans. `
        : "";

    return {
      success: true,
      spielplan: generateOperation,
      message: `${geloescht}In Saison ${validated.data.id} stehen jetzt ${umfang}, noch ohne Zeitraum und ohne Termin. Seinen Zeitraum bekommt jeder Spieltag auf seiner eigenen Seite, die Termine der Spiele danach.`,
    };
  });
}

/**
 * The one path back out of a draw, on `DELETE /saisons/{saison_id}/spielplan`. **Destructive without
 * an inverse** (`docs/backend/spec.md :: I26`): nothing writes the removed rows back, and a fresh
 * draw draws its own.
 */
export async function undrawSpielplanAction(
  rawPayload: FLUndrawSpielplanPayload,
): Promise<ActionResult<{ undraw?: FLUndrawSpielplanResponse }>> {
  return runAdminMutation("undrawSpielplanAction", { readOnly: false }, async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLUndrawSpielplanPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let undrawOperation;
    try {
      undrawOperation = await undrawSpielplan(validated.data);
    } catch (error) {
      const refusal = mapUndrawRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!undrawOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Spielplan wurde nicht zurückgenommen", repair: "Versuche es erneut" }) };
    }

    // The draw's tag set, this removing exactly what that write created.
    invalidateSpielplan(validated.data.id);
    refresh();

    // A season can carry the watermark with neither collection behind it, so a zero pair does not by
    // itself mean nothing was removed. Hence three messages rather than one sentence over the counts.
    const removedRows = undrawOperation.spieltage > 0 || undrawOperation.spiele > 0;

    const message = removedRows
      ? `Der Spielplan von Saison ${validated.data.id} ist zurückgenommen. Gelöscht wurden ${describeSpielplanUmfang(undrawOperation.spieltage, undrawOperation.spiele)}. Gruppen, Teams pro Gruppe und Qualifikanten pro Gruppe lassen sich jetzt wieder im Abschnitt Regeln ändern, die Teams über die Teamseite.`
      : undrawOperation.watermark_cleared
        ? `Saison ${validated.data.id} hielt weder Spieltage noch Spiele. Die Angabe, dass ihr Spielplan steht, ist jetzt entfernt.`
        : `Saison ${validated.data.id} hatte keinen Spielplan mehr, deshalb wurde nichts gelöscht.`;

    return { success: true, undraw: undrawOperation, message };
  });
}
