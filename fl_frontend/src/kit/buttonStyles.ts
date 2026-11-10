import { hoverLook } from "./hoverStyles";
import { tv } from "./tv";

/**
 * The look of everything that acts or leads on as a button: the kit's `Button`, and the kit's `Link` drawn
 * as a primary or a secondary button or as a glyph alone. Kept apart from both so a server-rendered link and
 * a client button read the same recipe.
 */
export const buttonLook = tv({
  // The border colour is named on every variant: a border naming none takes its element's text colour.
  base: "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border text-sm font-medium whitespace-nowrap transition-colors duration-(--motion-state) data-disabled:cursor-default data-disabled:opacity-50 pointer-coarse:h-10",
  variants: {
    look: {
      primary: "border-transparent bg-brand-solid px-3.5 text-on-brand",
      // No fill of its own, the control edge alone, so it reads as one control on the page, a card and an overlay.
      secondary: "border-border-control bg-transparent px-3.5 text-fg",
      danger: "border-transparent bg-danger-solid px-3.5 text-on-brand",
      // The quiet act beside or beneath a primary one, such as the passkey offer's „Später“: words alone.
      quiet: "border-transparent bg-transparent px-3.5 text-fg-muted",
      icon: "w-8 border-transparent bg-transparent text-fg pointer-coarse:w-10",
      // A labelled button while what it acts on is read (`buttonPlaceholder`): a placeholder's bar in the button's box, its
      // words unseen.
      placeholder: "skeleton-bar border-transparent px-3.5 text-transparent",
    },
    // The control that marks the state, as `hoverLook` reads it.
    host: {
      aria: "",
      link: "",
    },
    // A locked act (`Button`'s `locked`) dims as a disabled one does and takes no layer, keeping the pointing hand, since
    // a press opens its reason. Read from the recipe rather than `aria-disabled:`, which React Aria sets on a busy button too.
    locked: {
      true: "opacity-50",
      false: "",
    },
  },
  // Under the pointer every look but the quiet one lays the one hover layer over its fill (`bg-layer`, 12 % of its own
  // words' colour), so the step shows on the page, a card, a card's head and an overlay alike, and over a row's own
  // layer.
  compoundVariants: [
    { look: ["primary", "secondary", "danger", "icon"], host: "aria", locked: false, class: hoverLook({ host: "aria" }) },
    { look: ["primary", "secondary", "icon"], host: "link", class: hoverLook({ host: "link" }) },
    // A quiet act is a button, so it takes no underline, which marks a link alone, and its words alone answer: they
    // take their full colour, as a plain button and a text button do (Apple's HIG, Material).
    { look: "quiet", host: "aria", locked: false, class: hoverLook({ host: "aria", answer: "words" }) },
    { look: "quiet", host: "link", class: hoverLook({ host: "link", answer: "words" }) },
  ],
  defaultVariants: { locked: false },
});

/**
 * A button while what it acts on is read, the class of a `span` holding what the button will hold: its label, and its
 * leading glyph where it has one. The recipe is the button's, so the bar is exactly as wide as the button will be, or as
 * wide as its column makes it where its column stretches its buttons. `width` is for a place that sets a button's
 * width itself.
 */
export function buttonPlaceholder(width?: string) {
  return buttonLook({ look: "placeholder", class: width });
}
