import type { AdminCrudShape } from "./AdminCrudFallback";

/**
 * The box the placeholder fills, clipped to it: while the hold is up the rows have often landed, so
 * an unclamped region is a 362-row table behind an opaque overlay with the placeholder at its top.
 */
const BOX = [
  "min-h-[calc((var(--admin-region-box)+var(--admin-region-bar))*var(--admin-region-held))]",
  "max-h-[calc((var(--admin-region-box)+var(--admin-region-bar))*var(--admin-region-held)+100000px*(1-var(--admin-region-held)))]",
  "overflow-hidden",
].join(" ");

/**
 * `has-` and never `group-has-`: the region carrying this is the group, and a `group-` variant
 * compiles to a descendant selector, so on the group itself it matches nothing and never releases.
 */
const AWAITS_ROWS = "[--admin-region-held:1] has-[tbody]:[--admin-region-held:var(--admin-placeholder-hold)]";

/** Nothing to wait for: mapped markup renders whole on its first pass, leaving the 500ms clock alone to hold it. */
const AWAITS_THE_CLOCK = "[--admin-region-held:var(--admin-placeholder-hold)]";

/**
 * How long an admin CRUD region holds itself at its placeholder's box. `1` through the hold, `0`
 * once released, and the overlay reads it inherited, so one predicate decides the box and the cover.
 */
export const PLACEHOLDER_BOX: Record<AdminCrudShape, string> = {
  table: `${AWAITS_ROWS} ${BOX}`,
  cards: `${AWAITS_THE_CLOCK} ${BOX}`,
  sections: `${AWAITS_THE_CLOCK} ${BOX}`,
};
