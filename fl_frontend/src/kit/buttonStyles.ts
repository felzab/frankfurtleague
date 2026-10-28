import { tv } from "tailwind-variants/lite";

/**
 * The look of everything that acts or leads on as a button: the kit's `Button`, and the kit's `Link` where
 * a page's one next step is drawn as the primary button. Kept apart from both so a server-rendered link
 * and a client button read the same recipe.
 */
export const buttonLook = tv({
  // The border colour is named on every variant: HeroUI's base sheet colours every element's border.
  base: "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border text-sm font-medium whitespace-nowrap transition-colors duration-(--motion-state) data-disabled:opacity-50 pointer-coarse:h-11",
  variants: {
    look: {
      primary: "border-transparent bg-brand-solid px-3.5 text-on-brand",
      secondary: "border-border-control bg-bg px-3.5 text-fg",
      danger: "border-transparent bg-danger-solid px-3.5 text-on-brand",
      // The quiet act beside or beneath a primary one, such as the passkey offer's „Später“: words alone.
      quiet: "border-transparent bg-transparent px-3.5 text-fg-muted",
      icon: "w-9 border-transparent bg-transparent text-fg pointer-coarse:w-11",
    },
    // React Aria's button marks its own hover, which a touch never sets; a plain anchor takes the pointer's
    // `:hover`, which Tailwind applies only where the device can hover.
    host: {
      aria: "",
      link: "",
    },
  },
  // A press takes the hover's colour, so under a mouse the two are one state and a touch, which never
  // hovers, still answers the press: React Aria's `data-pressed` on its button, `:active` on an anchor.
  compoundVariants: [
    { look: "primary", host: "aria", class: "data-hovered:bg-brand-solid-hover data-pressed:bg-brand-solid-hover" },
    { look: "primary", host: "link", class: "hover:bg-brand-solid-hover active:bg-brand-solid-hover" },
    // The lighter surface keeps the edge at 3:1 against the fill under the pointer.
    { look: "secondary", host: "aria", class: "data-hovered:bg-bg-surface data-pressed:bg-bg-surface" },
    { look: "icon", host: "aria", class: "data-hovered:bg-bg-muted data-pressed:bg-bg-muted" },
    { look: "quiet", host: "aria", class: "data-hovered:bg-bg-muted data-hovered:text-fg data-pressed:bg-bg-muted data-pressed:text-fg" },
    { look: "danger", host: "aria", class: "data-hovered:bg-danger-solid-hover data-pressed:bg-danger-solid-hover" },
  ],
});
