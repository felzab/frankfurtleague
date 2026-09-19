/**
 * Balanced lines, and a word wider than its box broken mid-word rather than clipped or pushed past the
 * box's edge. Never `hyphens-auto`, which hyphenates names that already fit under `text-balance`.
 */
export const NAME_WRAP = "max-w-full text-balance wrap-break-word";
