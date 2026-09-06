/**
 * The display voice, without a step of its own: `fluid-4xl` on the hero and `fluid-3xl` on a page
 * `<h1>` are one voice at two sizes. `font-normal` makes the weight the face's rather than the
 * ancestor's, Anton shipping exactly one.
 */
export const DISPLAY_HEADING = "font-heading font-normal tracking-display uppercase";

/**
 * The logo's own letterform as live text, which is why the display face goes under `fluid-xl`
 * here. `tracking-wide` sits one step under the label voice's widest: a logotype is set tighter
 * than a label.
 */
export const WORDMARK = "font-heading font-normal tracking-wide uppercase";
