"use server";

import { frontend_config } from "@/core/config";
import { ApiUnsentError, requestOf } from "@/core/errors";
import { logger } from "@/core/logging";
import { requestOutcomeUnknown, runAnsweringOwnCut } from "@/core/requestScope";
import { TEAMS_EINTRAG } from "@/features/admin/constants";
import { refusalResult, refuseUnconfirmed, runAdminMutation } from "@/shared/utils/adminMutation";
import { refusedReplay, restored, runAdminUndo, unclearReplay, UNDO_UNREADABLE } from "@/shared/utils/adminUndo";
import { buildRefusal, VERSUCHE_ES_ERNEUT } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { REGELN_ABSCHNITT } from "./constants";
import { loeschungLaufen } from "./loeschung";
import { activateSaison, generateSpielplan, patchSaison, postLoeschungLauf, postSaison, swapGruppen, undrawSpielplan } from "./mutations";
import {
  mapActivateRefusal,
  mapRulesRefusal,
  mapSaisonIdRefusal,
  mapSpielplanRefusal,
  mapSwapRefusal,
  mapUndrawRefusal,
  SAISON_REPLAY_REFUSALS,
} from "./refusals";
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
import type { UndoOutcome } from "@/shared/utils/adminUndo";
import type { LoeschungLauf } from "./loeschung";
import type {
  FLActivateSaisonPayload,
  FLActivateSaisonResponse,
  FLGenerateSpielplanPayload,
  FLGenerateSpielplanResponse,
  FLLoeschungLaufResponse,
  FLPatchSaisonPayload,
  FLPatchSaisonResponse,
  FLSwapGruppenPayload,
  FLSwapGruppenResponse,
  FLUndrawSpielplanPayload,
  FLUndrawSpielplanResponse,
} from "./schemas";

export async function postSaisonAction(
  // The DRAFT shape: an emptied rule count submits `null`, and the schema below is what turns that into a
  // field error rather than a type error.
  rawPayload: SaisonCreateDraft,
): Promise<ActionResult<{ created_id: string }>> {
  return runAdminMutation("postSaisonAction", { stepUp: true }, async () => {
    const validated = FLPostSaisonPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

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
      return { success: false, error: buildRefusal({ reason: "Die Saison wurde nicht angelegt", repair: VERSUCHE_ES_ERNEUT }) };
    }

    return {
      success: true,
      created_id: postOperation.created_id,
      // The id is the body's rather than the title's: a title names the outcome, and the
      // description tells one raising from another.
      message: `Saison ${validated.data.id} wird erst mit der Umstellung zur laufenden Saison.`,
    };
  });
}

export async function patchSaisonAction(
  rawPayload: Omit<FLPatchSaisonPayload, "rules"> & { rules: FLSaisonRulesDraft },
): Promise<ActionResult<{ saison?: FLPatchSaisonResponse }>> {
  return runAdminMutation("patchSaisonAction", async () => {
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
      return { success: false, error: buildRefusal({ reason: "Die Saison wurde nicht gespeichert", repair: VERSUCHE_ES_ERNEUT }) };
    }

    return {
      success: true,
      saison: patchOperation,
      message: "Saison gespeichert",
    };
  });
}

export async function undoAdminSaisonEditAction(rawPayload: FLPatchSaisonPayload): Promise<UndoOutcome> {
  return runAdminUndo("undoAdminSaisonEditAction", async () => {
    const validated = FLPatchSaisonPayloadSchema.safeParse(rawPayload);
    if (!validated.success) return { success: false, error: UNDO_UNREADABLE };

    let operation;
    try {
      operation = await patchSaison(validated.data);
    } catch (error) {
      return refusedReplay(error, SAISON_REPLAY_REFUSALS);
    }

    return operation.acknowledged ? restored() : unclearReplay("Die Rücknahme wurde abgebrochen. Prüfe die Saisondaten.");
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
  return runAdminMutation("activateSaisonAction", { stepUp: true }, async () => {
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
      return { success: false, error: buildRefusal({ reason: "Die Saison wurde nicht umgestellt", repair: VERSUCHE_ES_ERNEUT }) };
    }

    // Any count but 1 is worth naming: 0 is a no-op, and more than one means the database had drifted
    // into a state nothing can express and this call repaired it.
    const demoted = activateOperation.deactivated;
    const message =
      demoted === 0
        ? `Saison ${validated.data.id} war schon aktiv.`
        : demoted === 1
          ? `Saison ${validated.data.id} ist jetzt aktiv. Die vorherige Saison ist abgeschlossen.`
          : `Saison ${validated.data.id} ist jetzt aktiv. ${String(demoted)} vorher aktive Saisons wurden abgeschlossen.`;

    // Compared to "on": a skipped validation leaves it undefined, where a negated test would delete. Called here rather
    // than handed on bare: the step-up reader attributes a request only where an action's own body calls it.
    const geloescht = frontend_config.LOESCHUNG_SWEEP === "on" ? await loeschenNachUmstellung((nach) => postLoeschungLauf(nach)) : [];

    return { success: true, saison: activateOperation, message: [message, ...geloescht].join(" ") };
  });
}

/**
 * AWAITED inside the action's body, so the spine clears the site's cache tag after the last deletion: a run behind the
 * answer lands after that clear, and a squad page names deleted pupils until the `minutes` lifetime has passed.
 */
async function loeschenNachUmstellung(senden: (nach: string | null) => Promise<FLLoeschungLaufResponse>): Promise<string[]> {
  let vonDerFristBeendet = false;
  // Each call answering its own cut: one the deadline ends would otherwise answer the whole press as of unknown
  // outcome, sending the administrator to check an activation that stands.
  const lauf = await loeschungLaufen((nach) =>
    runAnsweringOwnCut(async () => {
      try {
        return await senden(nach);
      } finally {
        // Read inside the call's own scope, which the request's deadline alone marks: the call's own bound does not.
        vonDerFristBeendet = requestOutcomeUnknown();
      }
    }),
  );

  if (lauf.abgebrochen) {
    // The name and the request's facts, as the hourly pass logs its own: no person reaches this line.
    const felder = { name: lauf.fehler instanceof Error ? lauf.fehler.name : undefined, ...requestOf(lauf.fehler) };
    // Below error: wherever more pupils are due than the deadline reaches, its end of the run, a call it left unsent
    // or one it cut, is the expected one, and the hourly pass finishes them with nothing to repair.
    if (vonDerFristBeendet || lauf.fehler instanceof ApiUnsentError) logger.warn("loeschung.umstellung_cut_short", felder);
    else logger.error("loeschung.umstellung_failed", undefined, felder);
  }

  return loeschungsSaetze(lauf);
}

/** Singular and plural spelled out, and nothing said where nobody was due. */
function loeschungsSaetze(lauf: LoeschungLauf): string[] {
  const saetze: string[] = [];
  const seit = lauf.abgeschlossene_saison_id;

  if (seit !== null && lauf.spieler === 1) {
    saetze.push(`Eine Spielerin oder ein Spieler ohne Kadereintrag seit Saison ${seit} wurde gelöscht.`);
  } else if (seit !== null && lauf.spieler > 1) {
    saetze.push(`${String(lauf.spieler)} Spielerinnen und Spieler ohne Kadereintrag seit Saison ${seit} wurden gelöscht.`);
  }

  // A run cut short cannot say what remains, only who finishes it.
  if (lauf.abgebrochen) {
    saetze.push("Die Löschung ist nicht vollständig durchgelaufen. Was noch aussteht, löscht der nächste stündliche Durchlauf.");
  } else if (lauf.verbleibend === 1) {
    saetze.push("Eine weitere Löschung steht noch aus.");
  } else if (lauf.verbleibend > 1) {
    saetze.push(`${String(lauf.verbleibend)} weitere Löschungen stehen noch aus.`);
  }

  return saetze;
}

/**
 * Two clubs exchange groups. The same transaction rewrites every drawn Gruppenphase fixture fielding
 * either club.
 */
export async function swapGruppenAction(rawPayload: FLSwapGruppenPayload): Promise<ActionResult<{ swap?: FLSwapGruppenResponse }>> {
  return runAdminMutation("swapGruppenAction", async () => {
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
      return { success: false, error: buildRefusal({ reason: "Die Gruppen wurden nicht getauscht", repair: VERSUCHE_ES_ERNEUT }) };
    }

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
 * writes them back.
 */
export async function generateSpielplanAction(
  rawPayload: FLGenerateSpielplanPayload,
): Promise<ActionResult<{ spielplan?: FLGenerateSpielplanResponse }>> {
  return runAdminMutation("generateSpielplanAction", async (session) => {
    const validated = FLGenerateSpielplanPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The replacing draw alone is a step-up write: a first draw the undraw removes whole.
    const unconfirmed = validated.data.replace === true ? refuseUnconfirmed(session) : null;
    if (unconfirmed !== null) return unconfirmed;

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
      return { success: false, error: buildRefusal({ reason: "Der Spielplan wurde nicht angelegt", repair: VERSUCHE_ES_ERNEUT }) };
    }

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
 * an inverse**: nothing writes the removed rows back, and a fresh
 * draw draws its own.
 */
export async function undrawSpielplanAction(
  rawPayload: FLUndrawSpielplanPayload,
): Promise<ActionResult<{ undraw?: FLUndrawSpielplanResponse }>> {
  return runAdminMutation("undrawSpielplanAction", { stepUp: true }, async () => {
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
      return { success: false, error: buildRefusal({ reason: "Der Spielplan wurde nicht zurückgenommen", repair: VERSUCHE_ES_ERNEUT }) };
    }

    // A season can carry the watermark with neither collection behind it, so a zero pair does not by
    // itself mean nothing was removed. Hence three messages rather than one sentence over the counts.
    const removedRows = undrawOperation.spieltage > 0 || undrawOperation.spiele > 0;

    const message = removedRows
      ? `Der Spielplan von Saison ${validated.data.id} ist zurückgenommen. Gelöscht wurden ${describeSpielplanUmfang(undrawOperation.spieltage, undrawOperation.spiele)}. Gruppen, Teams pro Gruppe und Qualifikanten pro Gruppe lassen sich jetzt wieder im Abschnitt ${REGELN_ABSCHNITT} ändern, die Teams unter „${TEAMS_EINTRAG.label}“.`
      : undrawOperation.watermark_cleared
        ? `Saison ${validated.data.id} hielt weder Spieltage noch Spiele. Die Angabe, dass ihr Spielplan steht, ist jetzt entfernt.`
        : `Saison ${validated.data.id} hatte keinen Spielplan mehr, deshalb wurde nichts gelöscht.`;

    return { success: true, undraw: undrawOperation, message };
  });
}
