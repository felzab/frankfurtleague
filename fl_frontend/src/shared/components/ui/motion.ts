// Redesign: goes with its last importer; the motion tokens replace it.

/**
 * A route shell. Not on a wrapper whose children animate; the pixels animate twice.
 */
export const PAGE_RISE_CLASSES = "animate-in duration-(--motion-slow) ease-(--motion-ease-enter) fade-in slide-in-from-bottom-2";

/**
 * A section unfolding inside a page already in view. Short on purpose — it carries a
 * sentence that has just escalated, so it must not make the reader wait.
 */
export const PANEL_REVEAL_CLASSES = "animate-in duration-(--motion-fast) ease-(--motion-ease-enter) fade-in slide-in-from-bottom-2";
