import { tv } from "tailwind-variants";

/**
 * **A card is a surface rather than a control, which is why its hover is a border and not a fill.** `interactive` is
 * only for one that responds to a click, or it advertises an affordance it does not have.
 */
export const card = tv({
  base: "rounded-2xl border border-border bg-surface text-foreground shadow-sm",
  variants: {
    interactive: {
      true: "transition-[border-color] duration-(--motion-base) hover:border-brand",
      false: "",
    },
  },
  defaultVariants: { interactive: false },
});
