/**
 * Every admin table's column heading. **No `bg-muted`**: `fl_frontend/src/app/globals.css ::
 * .table__column` fills the header `bg-background/90!` with an `!`, so the token painted nothing and
 * read as a decision somebody had taken.
 */
export const TABLE_HEADING = "text-foreground-muted fluid-xs border-border border-b py-4 font-bold tracking-wider uppercase";

/**
 * The column inset pair. A table padding every column `px-6` spends 24 pixels more per inner column
 * than its floor was measured with, so the floors
 * `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts` holds only stand while both
 * spellings come from here.
 */
export const COLUMN_EDGE = "px-6";
export const COLUMN_INNER = "px-3";

export const CELL_EDGE = `${COLUMN_EDGE} py-4`;
export const CELL_INNER = `${COLUMN_INNER} py-4`;

/**
 * A row's first cell, and the head of its phone card: the token, the name, the row's pills, then one
 * or two muted lines. Both layouts compose it here, so neither can drift about what a row is.
 */
export const IDENTITY_ROW = "flex min-w-0 items-center gap-3";

export const IDENTITY_STACK = "flex min-w-0 flex-col gap-0.5";

/** The pills share the name's line and wrap under it where the cell is too narrow to hold both. */
export const IDENTITY_HEAD = "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1";

/**
 * The box without its ink, for a row whose name is a STATE rather than a person's: two ink utilities
 * in one string are decided by the stylesheet's order rather than the string's, there being no
 * `twMerge` in the path.
 */
export const IDENTITY_NAME_BOX = "fluid-sm max-w-full min-w-0 shrink-0 truncate font-semibold";

/**
 * `shrink-0` keeps the name whole, so the pills wrap under it rather than the name giving way, and
 * `max-w-full` still truncates one longer than the cell. `shrink-0` alone overflows; `min-w-0` alone
 * shrinks the name and the pills never wrap.
 */
export const IDENTITY_NAME = `${IDENTITY_NAME_BOX} text-foreground`;

export const IDENTITY_LINE = "fluid-xs text-foreground-muted max-w-full min-w-0 truncate";

/** Two facts on one secondary line, with no separator glyph to strand alone at the wrap. */
export const IDENTITY_PAIR = "flex min-w-0 flex-wrap gap-x-3";
