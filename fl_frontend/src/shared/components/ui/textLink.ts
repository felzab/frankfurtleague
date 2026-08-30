import { tv } from "tailwind-variants";

/** The one treatment a link inside text wears, and the whole of it (`docs/frontend/spec.md :: I43`). */
export const textLink = tv({
  base: "underline underline-offset-2 transition-colors",
  variants: {
    tone: {
      brand: "text-brand hover:text-brand-solid",
      /** Quieter, for a link ranked below a primary action rather than one carrying the page's own. */
      muted: "text-foreground-muted hover:text-foreground",
    },
  },
  defaultVariants: { tone: "brand" },
});
