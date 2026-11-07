// Redesign: goes with its last importer; `kit/Table` replaces it.

/**
 * A row's first cell, and the head of its phone card: the token, the name, the row's pills, then one
 * or two muted lines. Both layouts compose it here, so neither can drift about what a row is.
 */
export const IDENTITY_ROW_CLASSES = "flex min-w-0 items-center gap-3";

export const IDENTITY_STACK_CLASSES = "flex min-w-0 flex-col gap-0.5";

/** The pills share the name's line and wrap under it where the cell is too narrow to hold both. */
export const IDENTITY_HEAD_CLASSES = "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1";

/**
 * The box without its ink, for a row whose name is a STATE rather than a person's: two ink utilities
 * in one string are decided by the stylesheet's order rather than the string's, there being no
 * `twMerge` in the path.
 */
const IDENTITY_NAME_BOX_CLASSES = "max-w-full min-w-0 shrink-0 truncate fluid-sm font-semibold";

/**
 * `shrink-0` keeps the name whole, so the pills wrap under it rather than the name giving way, and
 * `max-w-full` still truncates one longer than the cell. `shrink-0` alone overflows; `min-w-0` alone
 * shrinks the name and the pills never wrap.
 */
export const IDENTITY_NAME_CLASSES = `${IDENTITY_NAME_BOX_CLASSES} text-foreground`;

/**
 * A retired row's one change of ink, its „Stillgelegt“ pill saying the state. **Never an `opacity`
 * on the row or its card**: it composites the muted lines and the pill under 4.5:1 (WCAG 1.4.3).
 */
export function identityName(isRetired: boolean): string {
  return isRetired ? `${IDENTITY_NAME_BOX_CLASSES} text-foreground-muted` : IDENTITY_NAME_CLASSES;
}

export const IDENTITY_LINE_CLASSES = "max-w-full min-w-0 truncate fluid-xs text-foreground-muted";
