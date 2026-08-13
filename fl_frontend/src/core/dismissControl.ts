/**
 * CORE · the one clear/dismiss control
 *
 * Every X on the site is this recipe plus a German name for what goes — a search field's clear, a
 * picker's, a dialog's close, a callout's and a toast's dismiss. It lives in `core` rather than beside
 * the other recipes in `shared` because `core/providers/AppToaster.tsx` renders one and `core` may not
 * reach into `shared` (ADR-0008).
 *
 * Invariants:
 * - A call site names what goes; nothing may fall through to the English "Close" HeroUI hardcodes into
 *   `close-button.js` and can only be replaced by a caller's own `aria-label`.
 * - `bg-transparent` is load-bearing twice: HeroUI's `close-button--default` paints `--default` at rest,
 *   so without it the dark-theme hover moves toward the page rather than away, and its own `:hover` arm
 *   would stick after a tap on a hybrid device.
 * - The transition list names `transform`, the inverse of `formButtons.ts`'s rule, because this press is
 *   HeroUI's `transform: scale(0.93)` on `[data-pressed]` rather than a `scale-*` utility.
 * - 28px is the smallest hit target this may get: WCAG 2.5.8 (Target Size, Minimum) puts the floor at 24,
 *   and every clear the app built by hand had already converged on 28.
 */

import { tv } from "tailwind-variants";

const dismissControlStyle = tv({
  base: "text-foreground-muted size-7 shrink-0 rounded-md border-0 bg-transparent transition-[color,background-color,transform,opacity] duration-(--motion-fast) [&_svg]:size-4",
  variants: {
    hover: {
      aria: "data-hovered:text-foreground data-hovered:bg-hover",
      css: "hover:text-foreground hover:bg-hover",
    },
  },
  defaultVariants: { hover: "aria" },
});

/**
 * The props a clear or dismiss control is spread with. Everything about how it looks and what it
 * announces is here, so a change to the treatment reaches every one of them at once.
 */
export function dismissControl({
  label,
  hover,
  className,
}: {
  /** German, and it names what goes: "Datum entfernen", "Dialog schließen" — never a bare "Schließen". */
  label: string;
  /**
   * `"css"` for a control HeroUI renders as a plain `<button>`: it writes no `data-hovered`, so the
   * react-aria variant would compile and never fire. Today that is `Autocomplete.ClearButton` alone.
   */
  hover?: "aria" | "css";
  /** Where the control sits — a margin or a position. The treatment itself is not a call-site choice. */
  className?: string;
}) {
  return { "aria-label": label, className: dismissControlStyle({ hover, className }) };
}
