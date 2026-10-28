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
      primary: "border-transparent bg-brand-solid px-4 text-on-brand",
      secondary: "border-border-control bg-bg px-4 text-fg",
      danger: "border-transparent bg-danger px-4 text-on-brand",
      icon: "w-9 border-transparent bg-transparent text-fg pointer-coarse:w-11",
    },
    // React Aria's button marks its own hover, which a touch never sets; a plain anchor takes the pointer's
    // `:hover`, which Tailwind applies only where the device can hover.
    host: {
      aria: "",
      link: "",
    },
  },
  compoundVariants: [
    { look: "primary", host: "aria", class: "data-hovered:bg-brand-solid-hover" },
    { look: "primary", host: "link", class: "hover:bg-brand-solid-hover" },
    { look: ["secondary", "icon"], host: "aria", class: "data-hovered:bg-bg-muted" },
    { look: "danger", host: "aria", class: "data-hovered:bg-danger-solid-hover" },
  ],
});
