/**
 * The display voice, without a step of its own: `fluid-4xl` on the hero and `fluid-3xl` on a page
 * `<h1>` are one voice at two sizes. `font-normal` makes the weight the face's rather than the
 * ancestor's, Anton shipping exactly one.
 */
export const DISPLAY_HEADING = "font-heading font-normal tracking-display uppercase";

/**
 * The logo's own letterform as live text, which is why this is the one display site below
 * `fluid-xl`. `tracking-widest` is the label voice's value rather than a fifth tracking step, the
 * mark being a label-sized string of condensed capitals.
 */
export const WORDMARK = "font-heading font-normal tracking-widest uppercase";
