import { placeholderBar } from "./Skeleton";
import { tv } from "./tv";

/**
 * The look of everything that acts or leads on as a button: the kit's `Button`, and the kit's `Link` drawn
 * as a primary or a secondary button or as a glyph alone. Kept apart from both so a server-rendered link and
 * a client button read the same recipe.
 */
export const buttonLook = tv({
  // The border colour is named on every variant: HeroUI's base sheet colours every element's border.
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
    },
    // React Aria's button marks its own hover, which a touch never sets; a plain anchor takes the pointer's
    // `:hover`, which Tailwind applies only where the device can hover.
    host: {
      aria: "",
      link: "",
    },
  },
  // Under the pointer a look lays the one hover layer over its fill (`bg-layer`, 12 % of its own words' colour), so
  // the step shows on the page, a card, a card's head and an overlay alike, and over a row's own layer. A press takes
  // the hover's look, so under a mouse the two are one state and a touch, which never hovers, still answers the
  // press: React Aria's `data-pressed` on its button, `:active` on an anchor.
  compoundVariants: [
    { look: ["primary", "secondary", "danger", "icon"], host: "aria", class: "data-hovered:bg-layer data-pressed:bg-layer" },
    { look: ["primary", "secondary", "icon"], host: "link", class: "hover:bg-layer active:bg-layer" },
    { look: "quiet", host: "aria", class: "data-hovered:bg-bg-hover data-hovered:text-fg data-pressed:bg-bg-hover data-pressed:text-fg" },
    { look: "quiet", host: "link", class: "hover:bg-bg-hover hover:text-fg active:bg-bg-hover active:text-fg" },
  ],
});

/**
 * A button while what it acts on is read: a bar of the button's height and corners, `width` wide, such as a label's
 * width or the full width of a column whose buttons fill it.
 */
export function buttonPlaceholder(width: string) {
  return placeholderBar(`h-8 rounded-lg pointer-coarse:h-10 ${width}`);
}
