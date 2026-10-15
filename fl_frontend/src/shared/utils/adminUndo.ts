import { AENDERUNG_STEHT_WEITERHIN, isRefusal, RUECKNAHME_UNKLAR } from "./actionError";
import { FORBIDDEN_BY_REFUSAL, runAdminMutation } from "./adminMutation";
import { buildRefusal, LADE_DIE_SEITE_NEU } from "./refusal";

import type { AdminRefusal } from "@/core/auth";
import type { ActionFailure } from "@/shared/types/types";
import type { AdminSession } from "./adminMutation";

const UNDO_RESTORED = "Die Änderung wurde zurückgenommen.";

/** What an undo answers a body its slice's schema refuses, which only a page older than the running build sends. */
export const UNDO_UNREADABLE = buildRefusal({ reason: "Die Rücknahme wurde nicht ausgeführt", repair: LADE_DIE_SEITE_NEU });

/**
 * The sentence an action turned away for the same reason is answered, and that the change stands: one
 * table, so the save and its undo never word one condition two ways.
 */
const undoTurnedAway = (reason: AdminRefusal): string => `${FORBIDDEN_BY_REFUSAL[reason]} ${AENDERUNG_STEHT_WEITERHIN}`;

/**
 * What one slice's replay answers: why it did not commit, that nobody can tell whether it did, or
 * what a commit cost.
 *
 * Fields rather than a string meaning failure: a replay can land and still owe the admin a sentence.
 */
export type UndoReport = {
  /** The German refusal where the restore did not fully commit; absent where it did. */
  refusal?: string;
  /**
   * The German where the replay's write went unacknowledged, which may still have landed: answered as
   * of unknown outcome, so the offer titles it unclear rather than refused.
   */
  unclear?: string;
  /**
   * What a committed restore moved beyond the rows it put back. Present, it follows the standard
   * sentence and grades the toast a warning, so a replay with collateral does not read as a clean undo.
   */
  cost?: string;
};

/** What an undo answers the offer that sent it: the restore, graded by what it cost, or why it did not land. */
export type UndoOutcome = { success: true; message: string; warn: boolean } | ActionFailure;

/**
 * The sentence a slice's own table words for the refusal its replay met, at whatever status its rule
 * answers with, or `undefined` for any other failure, which the action rethrows.
 */
export function replayRefusal(error: unknown, refusals: Readonly<Record<string, string>>): string | undefined {
  const code = isRefusal(error) ? error.serverErrorCode : undefined;
  // The code is an unvalidated wire string, and an unguarded lookup reaches `Object.prototype`: `toString` selects a function.
  return code == null || !Object.hasOwn(refusals, code) ? undefined : refusals[code];
}

/**
 * The table's reason, then what became of the change, which a cause alone leaves the admin guessing;
 * `closing` is the half that went back where a replay of two writes had restored the first.
 */
export function refusedReplay(error: unknown, refusals: Readonly<Record<string, string>>, closing = AENDERUNG_STEHT_WEITERHIN): UndoReport {
  const reason = replayRefusal(error, refusals);
  if (reason === undefined) throw error;

  return { refusal: `${reason} ${closing}` };
}

/**
 * The spine every page-owned editor's undo action runs on, which is `runAdminMutation`'s: each action
 * keeps its parse, its tags, its step-up and its replay, and answers a failure ahead of the replay or
 * the replay's report.
 */
export async function runAdminUndo(
  mutationName: string,
  fn: (session: AdminSession) => Promise<UndoReport | ActionFailure>,
): Promise<UndoOutcome> {
  const answer = await runAdminMutation(mutationName, { stepUp: false, turnedAway: undoTurnedAway }, async (session) => {
    const ran = await fn(session);
    // `success` tells the spine only that the replay ran, so it drops the tags and re-reads the page
    // wherever a write went out: a replay refused part-way leaves rows standing (`docs/frontend/spec.md` §1.3).
    return "success" in ran ? ran : { success: true as const, report: ran };
  });

  if (!answer.success) {
    // Only the spine answers an unknown outcome here, in the shared reader's sentence for an unclear
    // save, where this write took a change back.
    return answer.outcome === "unknown" ? { ...answer, error: RUECKNAHME_UNKLAR } : answer;
  }

  const { refusal, unclear, cost } = answer.report;
  if (unclear !== undefined) return { success: false, error: unclear, outcome: "unknown" };
  if (refusal !== undefined) return { success: false, error: refusal };

  // The standard sentence FIRST and the cost after it: the undo landed, and what it cost is the
  // second fact rather than a replacement for the first.
  return { success: true, message: cost === undefined ? UNDO_RESTORED : `${UNDO_RESTORED} ${cost}`, warn: cost !== undefined };
}
