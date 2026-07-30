import { tv } from "tailwind-variants";

/**
 * The submit / cancel / destructive button appearance, once (R4 §8.4). Six submit buttons had four
 * appearances and five cancel buttons had two, because a 7-class string was retyped at every site —
 * which is also how the broken `hover:bg-surface-muted` of R4 §6.3 got in.
 *
 * `destructive` keeps `text-foreground` on `bg-danger` deliberately: that pairing is a contrast
 * decision the owner still has to make, tracked as NEW-C1 in Wave 6, not something to change here.
 */
export const formButton = tv({
  base: "text-fluid-sm hover:scale-hover rounded-xl px-6 py-3 font-semibold transition-all",
  variants: {
    intent: {
      submit: "bg-brand-solid text-brand-solid-foreground tracking-wide",
      cancel: "border-border text-foreground border bg-transparent",
      destructive: "bg-danger text-foreground shadow-danger/25 tracking-wide shadow-lg",
    },
    fullWidth: { true: "w-full" },
  },
  defaultVariants: { intent: "submit" },
});
