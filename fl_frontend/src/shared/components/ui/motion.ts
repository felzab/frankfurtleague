/**
 * Tier 1, a route shell. Must keep `CARDS_CASCADE_CLASSES`'s duration and curve — they play together on
 * `SpielplanView` and a gap reads as page and contents arriving apart. Not on a wrapper whose
 * children cascade; the pixels animate twice.
 */
export const PAGE_RISE_CLASSES = "animate-in duration-(--motion-slow) ease-(--motion-ease-enter) fade-in slide-in-from-bottom-2";

/**
 * Tier 2, a card collection. Goes on the `role="list"` container, not its items. The unit is the
 * card, never anything inside one — a card is one stop for the eye, so animating its contents
 * apart makes a whole assemble itself.
 */
export const CARDS_CASCADE_CLASSES = "cards-cascade";

/**
 * Tier 2 by column: the playoff tree. Keyed off direct children, safe only because they are
 * rounds. Must not travel or scale — each connector is two halves owned by the columns it
 * joins, so moving those apart breaks every joint.
 */
export const BRACKET_SWEEP_CLASSES = "bracket-sweep";

/**
 * Tier 3, a section unfolding inside a page already in view. Short on purpose — it carries a
 * sentence that has just escalated, so it must not make the reader wait.
 */
export const PANEL_REVEAL_CLASSES = "animate-in duration-(--motion-fast) ease-(--motion-ease-enter) fade-in slide-in-from-bottom-2";
