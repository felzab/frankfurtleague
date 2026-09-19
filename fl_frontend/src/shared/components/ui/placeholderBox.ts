import type { AdminCrudShape } from "./AdminCrudFallback";

/** One column that cannot outgrow its container: an `auto` track takes a wide table's max-content, where a flex column stretches. */
const COLUMN = "grid grid-cols-[minmax(0,1fr)]";

/** Both layers sit in one cell, so whichever of them is unclamped is what the region's height is read from. */
const IN_THE_CELL = "col-start-1 row-start-1";

/**
 * On each layer, a clamped layer being laid out whole: `clip` keeps what it lays past its clamp off the page
 * and out of the scroll height, where `hidden` is a scroller that focusing a clamped row would scroll.
 */
const CLIPPED = "overflow-clip";

/**
 * The clip edge a focus outline's reach (`globals.css`: 2px at a 2px offset) outside the layer's content,
 * taken back out of the layout, so a box flush with the region keeps its outline and its shadow.
 */
const INK_ROOM = "-m-1 p-1";

/**
 * The pair is complementary and stays so: the unclamped layer alone reports a height, which is what
 * stands a region at its own placeholder rather than at a number (`docs/frontend/spec.md :: I239`).
 * `100000px` stands in for no ceiling.
 */
export const COVER_LAYER = `${IN_THE_CELL} ${CLIPPED} ${INK_ROOM} max-h-[calc(100000px*var(--admin-region-held))]`;

/**
 * Grid and never a flex column: a clamped flex container shrinks its items, a fixed-height one to
 * nothing, so a held region would lay its content out somewhere other than where the release puts it.
 */
export const CONTENT_LAYER = `${COLUMN} ${IN_THE_CELL} ${CLIPPED} ${INK_ROOM} max-h-[calc(100000px*(1-var(--admin-region-held)))]`;

/**
 * `has-` and never `group-has-`: the region carrying this is the group, and a `group-` variant
 * compiles to a descendant selector, so on the group itself it matches nothing and never releases.
 */
const AWAITS_ROWS = "[--admin-region-held:1] has-[tbody]:[--admin-region-held:var(--admin-placeholder-hold)]";

/** Nothing to wait for: mapped markup renders whole on its first pass, leaving the 500ms clock alone to hold it. */
const AWAITS_THE_CLOCK = "[--admin-region-held:var(--admin-placeholder-hold)]";

/**
 * How long an admin CRUD region holds itself at its placeholder's box. `1` through the hold, `0`
 * once released, and the cover reads it inherited, so one predicate decides the box and the cover.
 */
export const PLACEHOLDER_BOX: Record<AdminCrudShape, string> = {
  table: `${AWAITS_ROWS} ${COLUMN}`,
  cards: `${AWAITS_THE_CLOCK} ${COLUMN}`,
  sections: `${AWAITS_THE_CLOCK} ${COLUMN}`,
};
