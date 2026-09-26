/**
 * Every admin table's column heading. **No `bg-muted`**: `fl_frontend/src/app/globals.css ::
 * .table__column` paints the header itself, with an `!`.
 */
export const TABLE_HEADING_CLASSES = "border-b border-border py-4 fluid-xs font-bold tracking-wider text-foreground-muted uppercase";

/**
 * The column inset pair. A table padding every column `px-6` spends 24 pixels more per inner column
 * than its floor was measured with, so the floors
 * `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts` holds only stand while both
 * spellings come from here.
 */
export const COLUMN_EDGE_CLASSES = "px-6";
export const COLUMN_INNER_CLASSES = "px-3";

export const CELL_EDGE_CLASSES = `${COLUMN_EDGE_CLASSES} py-4`;
export const CELL_INNER_CLASSES = `${COLUMN_INNER_CLASSES} py-4`;

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
export const IDENTITY_NAME_BOX_CLASSES = "max-w-full min-w-0 shrink-0 truncate fluid-sm font-semibold";

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

/** Two facts on one secondary line, with no separator glyph to strand alone at the wrap. */
export const IDENTITY_PAIR_CLASSES = "flex min-w-0 flex-wrap gap-x-3";
