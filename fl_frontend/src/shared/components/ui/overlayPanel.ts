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
 * **A form inside a MODAL gets no bordered section panels.** Stacking them inside an already-bordered
 * dialog produces up to four concentric borders, all on `bg-surface`, so nothing but a hairline
 * separates the layers. Sections there are grouped by a heading plus whitespace, per WAI form
 * guidance, and only real inputs draw a border.
 *
 * A form that owns a whole PAGE is the other case and has its own recipe in `formPanel.ts`: with no
 * outer border to nest inside, one panel per section is the first level of grouping rather than the
 * second (ADR-0040). Which of the two applies is decided by the container, never by the section.
 */
export const overlayPanel = tv({
  base: "bg-surface border-border text-foreground rounded-xl border shadow-lg",
});
