/**
 * The editor's two badge shapes, so every badge on the page is one of exactly two recipes.
 *
 * The page had grown at least three — counts with `rounded-lg px-2.5 shadow-sm`, an uppercase
 * tracked "NICHT GESPEICHERT" chip, and the list chips — and the owner called the drift out
 * (fourth review): the uppercase one was the least readable, and three shapes for one idea read
 * as three ideas. Colours stay the caller's, because colour is the meaning; shape is shared.
 */

/** A number in a pill — the fold headers' counts. `min-w-6` so single digits are not ovals. */
export const COUNT_BADGE = "fluid-xxs inline-flex min-w-6 items-center justify-center rounded-md px-1.5 py-0.5 font-extrabold";

/** A word in a pill — "empfohlen", "disqualifiziert", "in Spiel N", "Nicht gespeichert". */
export const LABEL_BADGE = "fluid-xxs inline-flex items-center rounded-md px-1.5 py-0.5 font-bold";
