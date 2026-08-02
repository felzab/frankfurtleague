/**
 * SHARED · overlay panel recipe
 *
 * The floating surface a form's popovers sit on. It is a separate recipe from `card` because
 * elevation is the whole point — see the export for what that buys and for the section-panel recipe
 * that must not come back.
 */

import { tv } from "tailwind-variants";

/**
 * The floating surface inside a form — the date picker's calendar popover and both
 * `Autocomplete.Popover`s.
 *
 * `shadow-lg` rather than the `shadow-sm` used by in-flow surfaces: elevation is what tells the
 * user this layer floats above the form rather than sitting in it.
 *
 * This file used to export a `formPanel` recipe for bordered *section* panels too. That was
 * superseded the same day: stacking bordered panels inside an already-bordered
 * modal produced up to four concentric borders, all on `bg-surface`, so nothing but a hairline
 * separated the layers. Sections are now grouped by a heading plus whitespace, per WAI form
 * guidance, and only real inputs draw a border. Do not reintroduce a section-panel recipe.
 */
export const overlayPanel = tv({
  base: "bg-surface border-border text-foreground rounded-xl border shadow-lg",
});
