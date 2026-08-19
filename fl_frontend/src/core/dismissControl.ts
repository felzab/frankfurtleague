import { tv } from "tailwind-variants";

// `bg-transparent` is load-bearing: HeroUI's `close-button--default` paints `--default` at rest,
// and its `:hover` arm sticks after a tap. `transform` is transitioned because the press is
// HeroUI's `[data-pressed]` scale, not a utility.
const dismissControlStyle = tv({
  // `size-7` is a floor rather than a taste call: WCAG 2.5.8 (Target Size, Minimum) puts the
  // smallest hit target at 24px.
  base: "text-foreground-muted size-7 shrink-0 rounded-md border-0 bg-transparent transition-[color,background-color,transform,opacity] duration-(--motion-fast) [&_svg]:size-4",
  variants: {
    hover: {
      aria: "data-hovered:text-foreground data-hovered:bg-hover",
      css: "hover:text-foreground hover:bg-hover",
    },
  },
  defaultVariants: { hover: "aria" },
});

export function dismissControl({
  label,
  hover,
  className,
}: {
  /**
   * German, and it names what goes — "Dialog schließen", never a bare "Schließen". Required rather
   * than optional: HeroUI's `close-button.js` hardcodes `aria-label="Close"` ahead of the caller's.
   */
  label: string;
  /** `"css"` where HeroUI renders a plain `<button>`: no `data-hovered`, so the aria variant never fires. */
  hover?: "aria" | "css";
  /** Where the control sits; the treatment itself is not a call-site choice. */
  className?: string;
}) {
  return { "aria-label": label, className: dismissControlStyle({ hover, className }) };
}
