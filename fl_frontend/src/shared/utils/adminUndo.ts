import { refresh } from "next/cache";

import { AENDERUNG_STEHT_WEITERHIN, isRefusal, RUECKNAHME_UNKLAR } from "./actionError";
import { BERECHTIGUNG_UNGELESEN, FORBIDDEN_BY_REFUSAL, runAdminMutation } from "./adminMutation";
import { buildRefusal, LADE_DIE_SEITE_NEU } from "./refusal";
import { answerThrow } from "./writeOutcome";

import type { AdminRefusal } from "@/core/auth";
import type { ActionFailure } from "@/shared/types/types";
import type { Wording } from "./actionError";
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

/**
 * The shared reader's sentences for an undo. The press clears the offer and nothing raises it again, so
 * where a save offers the same press again, the undo says what became of the change.
 */
const UNDO_WORDING: Wording = {
  close: (reason) => `${reason} ${AENDERUNG_STEHT_WEITERHIN}`,
  unworded: `Die Rücknahme ist so nicht mehr möglich. ${AENDERUNG_STEHT_WEITERHIN}`,
  unclear: RUECKNAHME_UNKLAR,
  terminal: (sentence) => `${sentence} ${AENDERUNG_STEHT_WEITERHIN}`,
};

/**
 * A replay refused for want of a recent confirmation, by its body or the backend: the undo's offer is gone, so
 * „Bestätige zuerst“ would ask for a press nobody can make.
 */
const UNDO_UNBESTAETIGT = `Deine Bestätigung mit dem Passkey ist abgelaufen. ${AENDERUNG_STEHT_WEITERHIN}`;

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

/** The second write of a replay of two, in its slice's words. */
type SecondHalf = {
  /** Why it cannot go back, where a rule no table words refused it: the half is named, since the rule cannot be. */
  readonly unworded: string;
  /** The first half, which went back: it closes every answer, which the change standing would deny. */
  readonly restored: string;
};

/**
 * The second write failing after the first went back: the table's reason or the spine's answer to a
 * definite failure, then the half that went back. One that may have landed is rethrown, for the spine
 * to title unclear.
 */
export function partlyRestored(error: unknown, refusals: Readonly<Record<string, string>>, half: SecondHalf): ActionFailure {
  // The reason alone, never a retry: the half closes every answer instead.
  const reason =
    replayRefusal(error, refusals) ??
    answerThrow(error, { ...UNDO_WORDING, close: (bare) => bare, terminal: (bare) => bare, unworded: half.unworded });
  if (typeof reason !== "string" && reason.outcome === "unknown") throw error;
  // No form stands behind an undo to mark the fields a refusal names, so the sentence for the rest is
  // the answer, never the form's own.
  const sentence = typeof reason === "string" ? reason : (reason.unplacedError ?? reason.error);

  return { success: false, error: `${sentence} ${half.restored}`, outcome: "partial" };
}

/**
 * The spine every page-owned editor's undo action runs on, which is `runAdminMutation`'s: each action
 * keeps its parse, its tags, its step-up and its replay, and answers what became of it.
 */
export async function runAdminUndo(mutationName: string, fn: (session: AdminSession) => Promise<UndoOutcome>): Promise<UndoOutcome> {
  const answer = await runAdminMutation(mutationName, { stepUp: false, turnedAway: undoTurnedAway, wording: UNDO_WORDING }, fn);
  // Still the step-up refusal, its page's figure read again (`docs/frontend/spec.md :: I433`), in the undo's own words.
  if (!answer.success && "stepUp" in answer) return { ...answer, error: UNDO_UNBESTAETIGT };

  // The spine drops the tags behind a half that went back and leaves the page to the action
  // (`docs/frontend/spec.md :: I233`).
  if (!answer.success && answer.outcome === "partial") refresh();

  return answer;
}
