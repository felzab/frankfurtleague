import { tv } from "./tv";

/**
 * How a control answers the pointer, a press taking the same look, so under a mouse the two are one state and a touch,
 * which never hovers, still answers. `answer` is what changes: `layer` lays the one hover layer (`bg-layer`, 12 % of the
 * control's own words' colour over its fill), which shows on any ground; `full` also takes muted words to their full
 * colour; `words` does that alone, for a control that takes no layer or takes it elsewhere; `line` thickens the
 * underline a link of words carries at rest; `underline` draws the one a link of words lacks at rest, `fullUnderline`
 * taking its muted words to their full colour too, `bandUnderline` its dimmed white on the band to full white and
 * `struckUnderline` drawing it beside the strike struck words keep.
 *
 * `host` is what marks the state. React Aria's control marks its own hover, which a touch never sets, and keeps
 * `data-pressed` while the overlay it opened stands, so the control that opened it stays in view; a plain anchor takes
 * the pointer's `:hover`, which Tailwind applies only where the device can hover, and `:active`, which a finger sets
 * too; a drawn box takes the state of the row it stands in (`toggleRow`).
 */
export const hoverLook = tv({
  variants: {
    host: {
      aria: "",
      link: "",
      toggle: "group-data-hovered/toggle:bg-layer group-data-pressed/toggle:bg-layer",
    },
    answer: {
      layer: "",
      full: "",
      words: "",
      line: "",
      underline: "",
      fullUnderline: "",
      bandUnderline: "",
      // `underline` alone would set the one decoration line and drop the strike.
      struckUnderline: "",
    },
  },
  compoundVariants: [
    { host: "aria", answer: ["layer", "full"], class: "data-hovered:bg-layer data-pressed:bg-layer" },
    { host: "aria", answer: ["full", "words", "fullUnderline"], class: "data-hovered:text-fg data-pressed:text-fg" },
    { host: "aria", answer: "line", class: "data-hovered:decoration-2 data-pressed:decoration-2" },
    { host: "aria", answer: ["underline", "fullUnderline", "bandUnderline"], class: "data-hovered:underline data-pressed:underline" },
    { host: "aria", answer: "bandUnderline", class: "data-hovered:text-on-brand data-pressed:text-on-brand" },
    { host: "link", answer: ["layer", "full"], class: "hover:bg-layer active:bg-layer" },
    { host: "link", answer: ["full", "words", "fullUnderline"], class: "hover:text-fg active:text-fg" },
    { host: "link", answer: "line", class: "hover:decoration-2 active:decoration-2" },
    { host: "link", answer: ["underline", "fullUnderline", "bandUnderline"], class: "hover:underline active:underline" },
    { host: "link", answer: "bandUnderline", class: "hover:text-on-brand active:text-on-brand" },
    {
      host: "link",
      answer: "struckUnderline",
      class: "hover:[text-decoration-line:underline_line-through] active:[text-decoration-line:underline_line-through]",
    },
  ],
  defaultVariants: { answer: "layer" },
});
