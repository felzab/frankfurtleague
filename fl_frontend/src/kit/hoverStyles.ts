import { tv } from "./tv";

/**
 * How a control answers the pointer, a press taking the same look, so under a mouse the two are one state and a touch,
 * which never hovers, still answers. `answer` is what changes: `layer` lays the one hover layer (`bg-layer`, 12 % of the
 * control's own words' colour over its fill), which shows on any ground; `full` also takes muted words to their full
 * colour; `words` does that alone, for a control that takes no layer or takes it elsewhere; `line` thickens the
 * underline a link of words carries at rest.
 *
 * `host` is what marks the state. React Aria's control marks its own hover, which a touch never sets, and keeps
 * `data-pressed` while the overlay it opened stands, so the control that opened it stays in view; a plain anchor takes
 * the pointer's `:hover`, which Tailwind applies only where the device can hover; a drawn box takes the state of the row
 * it stands in (`toggleRow`).
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
    },
  },
  compoundVariants: [
    { host: "aria", answer: ["layer", "full"], class: "data-hovered:bg-layer data-pressed:bg-layer" },
    { host: "aria", answer: ["full", "words"], class: "data-hovered:text-fg data-pressed:text-fg" },
    { host: "aria", answer: "line", class: "data-hovered:decoration-2 data-pressed:decoration-2" },
    { host: "link", answer: ["layer", "full"], class: "hover:bg-layer active:bg-layer" },
    { host: "link", answer: ["full", "words"], class: "hover:text-fg active:text-fg" },
    { host: "link", answer: "line", class: "hover:decoration-2 active:decoration-2" },
  ],
  defaultVariants: { answer: "layer" },
});
