// Redesign: goes with its last importer; the motion tokens replace it.

/**
 * Tier 1, a route shell. Must keep `CARDS_CASCADE_CLASSES`'s duration and curve — they play together where a
 * page rises over a card collection, and a gap reads as page and contents arriving apart. Not on a wrapper whose
 * children cascade; the pixels animate twice.
 */
export const PAGE_RISE_CLASSES = "animate-in duration-(--motion-slow) ease-(--motion-ease-enter) fade-in slide-in-from-bottom-2";

/**
 * Tier 3, a section unfolding inside a page already in view. Short on purpose — it carries a
 * sentence that has just escalated, so it must not make the reader wait.
 */
export const PANEL_REVEAL_CLASSES = "animate-in duration-(--motion-fast) ease-(--motion-ease-enter) fade-in slide-in-from-bottom-2";
