import { tv } from "tailwind-variants";

/**
 * **A card is a surface rather than a control, which is why its hover is a border and not a fill.** `interactive` is
 * only for one that responds to a click, or it advertises an affordance it does not have.
 */
export const card = tv({
  base: "bg-surface border-border text-foreground rounded-2xl border shadow-sm",
  variants: {
    interactive: {
      true: "hover:border-brand transition-[border-color] duration-(--motion-base)",
      false: "",
    },
  },
  defaultVariants: { interactive: false },
});
