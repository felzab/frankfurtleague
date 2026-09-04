/**
 * The radius the recipes below carry, and the one every `Chip` in this app sets in place of HeroUI's. On a `Chip` it
 * overrides `rounded-2xl` from `.chip`, and a utility beats the component layer, so no `!` is needed.
 */
export const PILL_RADIUS = "rounded-md";

/**
 * A number in a pill; `min-w-6` so single digits are not ovals. Colour stays the caller's, but the brand pair is
 * `bg-brand-solid` with its own foreground, never an alpha on `brand`, which flips per theme.
 */
export const COUNT_BADGE = `fluid-xxs inline-flex min-w-6 items-center justify-center ${PILL_RADIUS} px-1.5 py-0.5 font-extrabold`;

/**
 * A word in a pill — "empfohlen", "disqualifiziert", "in Spiel N", "Nicht gespeichert".
 *
 * `whitespace-nowrap` here rather than per call site: a broken pill reads as two, and a fixed-layout
 * column is where one gets narrow enough to break.
 */
export const LABEL_BADGE = `fluid-xxs inline-flex items-center ${PILL_RADIUS} px-1.5 py-0.5 font-bold whitespace-nowrap`;
