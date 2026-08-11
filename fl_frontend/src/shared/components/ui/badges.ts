/**
 * SHARED · the app's two badge shapes
 *
 * A badge is either a number or a word, and there are exactly two recipes so that every badge in the
 * app is one of them. The match editor had grown at least three — counts with `rounded-lg px-2.5
 * shadow-sm`, an uppercase tracked "NICHT GESPEICHERT" chip, and the list chips — and the
 * drift was called out: the uppercase one was the least readable,
 * and three shapes for one idea read as three ideas.
 *
 * **Colours stay the caller's, because colour is the meaning; shape is shared.** A count tinted
 * `danger` and a count tinted `success` are the same object saying different things.
 *
 * Not to be confused with a `Chip`, which is a HeroUI component with its own padding and an icon slot
 * — `SpielStatusChip` and `SaisonPhaseChip` are that family. These two are for a bare number or a bare
 * word inside another control, where a chip's weight would compete with what it annotates.
 */

/**
 * The radius every pill in the app carries, the two recipes below and the HeroUI chips alike.
 *
 * **On a `Chip` it overrides `rounded-2xl` from `.chip`**, and a utility beats the component layer, so
 * no `!` is needed. Declared here rather than spelled at each chip, where the same sentence about the
 * same override had been copied out per call site — which is how the next chip comes to disagree.
 */
export const PILL_RADIUS = "rounded-md";

/** A number in a pill — a section's count. `min-w-6` so single digits are not ovals. */
export const COUNT_BADGE = `fluid-xxs inline-flex min-w-6 items-center justify-center ${PILL_RADIUS} px-1.5 py-0.5 font-extrabold`;

/** A word in a pill — "empfohlen", "disqualifiziert", "in Spiel N", "Nicht gespeichert". */
export const LABEL_BADGE = `fluid-xxs inline-flex items-center ${PILL_RADIUS} px-1.5 py-0.5 font-bold`;
