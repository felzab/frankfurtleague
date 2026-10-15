import { refresh } from "next/cache";

import { AENDERUNG_STEHT_WEITERHIN, isRefusal, RUECKNAHME_UNKLAR } from "./actionError";
import { BERECHTIGUNG_UNGELESEN, FORBIDDEN_BY_REFUSAL, runAdminMutation } from "./adminMutation";
import { buildRefusal, LADE_DIE_SEITE_NEU } from "./refusal";
import { answerThrow } from "./writeOutcome";

import type { AdminRefusal } from "@/core/auth";
import type { ActionFailure } from "@/shared/types/types";
import type { AdminSession } from "./adminMutation";

const UNDO_RESTORED = "Die Änderung wurde zurückgenommen.";

/** What an undo answers a body its slice's schema refuses, which only a page older than the running build sends. */
export const UNDO_UNREADABLE = buildRefusal({ reason: "Die Rücknahme wurde nicht ausgeführt", repair: LADE_DIE_SEITE_NEU });

/**
 * The sentence an action turned away for the same reason is answered, one table wording the save and its
 * undo alike, then that the change stands. Never the unread grant's retry: the offer pressed is gone.
 */
const undoTurnedAway = (reason: AdminRefusal): string =>
  `${reason === "unread" ? BERECHTIGUNG_UNGELESEN : FORBIDDEN_BY_REFUSAL[reason]} ${AENDERUNG_STEHT_WEITERHIN}`;

/** What an undo answers the offer that sent it: the restore, graded by what it cost, or why it did not land. */
export type UndoOutcome = { success: true; message: string; warn: boolean } | ActionFailure;

/**
 * A replay committed whole. `cost` is what it moved beyond the rows it put back, which follows the
 * standard sentence and grades the toast a warning, so a replay with collateral does not read as a clean undo.
 */
export function restored(cost?: string): UndoOutcome {
  // The standard sentence FIRST: the undo landed, and what it cost is the second fact rather than a
  // replacement for the first.
  return { success: true, message: cost === undefined ? UNDO_RESTORED : `${UNDO_RESTORED} ${cost}`, warn: cost !== undefined };
}

/** A replay's write went unacknowledged and may still have landed, so its slice's sentence is titled unclear. */
export function unclearReplay(sentence: string): ActionFailure {
  return { success: false, error: sentence, outcome: "unknown" };
}

/**
 * The sentence a slice's own table words for the refusal its replay met, at whatever status its rule
 * answers with, or `undefined` for any other failure, which the action rethrows.
 */
export function replayRefusal(error: unknown, refusals: Readonly<Record<string, string>>): string | undefined {
  const code = isRefusal(error) ? error.serverErrorCode : undefined;
  // The code is an unvalidated wire string, and an unguarded lookup reaches `Object.prototype`: `toString` selects a function.
  return code == null || !Object.hasOwn(refusals, code) ? undefined : refusals[code];
}

/** A replay of one write its table refuses: the table's reason, then that the change stands. */
export function refusedReplay(error: unknown, refusals: Readonly<Record<string, string>>): ActionFailure {
  const reason = replayRefusal(error, refusals);
  if (reason === undefined) throw error;

  return { success: false, error: `${reason} ${AENDERUNG_STEHT_WEITERHIN}` };
}

/**
 * A replay's second write failing after its first went back: the table's reason, or the spine's own
 * answer to a definite failure, then `restoredHalf`. A failure that may have landed is rethrown, for the
 * spine to answer as unclear.
 */
export function partlyRestored(error: unknown, refusals: Readonly<Record<string, string>>, restoredHalf: string): ActionFailure {
  const reason = replayRefusal(error, refusals) ?? answerThrow(error);
  if (typeof reason !== "string" && reason.outcome === "unknown") throw error;

  return { success: false, error: `${typeof reason === "string" ? reason : reason.error} ${restoredHalf}`, outcome: "partial" };
}

/**
 * The spine every page-owned editor's undo action runs on, which is `runAdminMutation`'s: each action
 * keeps its parse, its tags, its step-up and its replay, and answers what became of it.
 */
export async function runAdminUndo(mutationName: string, fn: (session: AdminSession) => Promise<UndoOutcome>): Promise<UndoOutcome> {
  let answered: UndoOutcome | undefined;
  const answer = await runAdminMutation(mutationName, { stepUp: false, turnedAway: undoTurnedAway }, async (session) => {
    answered = await fn(session);
    return answered;
  });

  if (answer.success) return answer;
  // The spine's own unknown outcome, a throw's or a lost answer's, is its own object worded for a save;
  // the body's carries the slice's sentence.
  if (answer.outcome === "unknown" && answer !== answered) return { ...answer, error: RUECKNAHME_UNKLAR };
  // The spine drops the tags behind a half that went back and leaves the page to the action
  // (`docs/frontend/spec.md :: I233`).
  if (answer.outcome === "partial") refresh();

  return answer;
}
