/**
 * The whole fallback's box at its widest, so the region never shrinks before it grows — the reversal the eye catches.
 * A floor rather than a height, so a filled table grows past it freely.
 */
const HELD_FLOOR = "min-h-[29.625rem]";

/** Released with the bars over it: the overlay is `absolute inset-0`, so a shell shrinking underneath held bars would clip them. */
const RELEASED_FLOOR = "group-has-[tbody]:min-h-[calc(29.625rem*var(--admin-placeholder-hold))]";

/**
 * A ceiling for exactly as long as the floor, or a large collection sizes the card to a blank field behind the overlay.
 * The `100000px` arm is "unbounded": at hold `0` it binds nothing, so the `overflow-hidden` beside it clips nothing.
 */
const HELD_CEILING = "group-has-[tbody]:max-h-[calc(29.625rem*var(--admin-placeholder-hold)+100000px*(1-var(--admin-placeholder-hold)))]";

/**
 * The height an admin CRUD region holds while react-aria's collection is empty: `CollectionBuilder` reads it during
 * render while the portal filling it writes at commit. The overlay is `absolute inset-0`, so removing this leaves it flat.
 */
export const PLACEHOLDER_BOX = [HELD_FLOOR, RELEASED_FLOOR, HELD_CEILING, "group-has-[tbody]:overflow-hidden"].join(" ");
