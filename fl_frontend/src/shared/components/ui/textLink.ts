import { tv } from "tailwind-variants";

/**
 * The hover grade flips: `brand-solid` is one value in both themes, so hovering to it in the dark
 * theme sank a link into its own card at 1.53:1 (`docs/frontend/spec.md` §1.17).
 */
const BRAND_GRADE = "text-brand hover:text-brand-solid dark:hover:text-brand-solid-accent";

/** The one treatment a link inside text wears (`docs/frontend/spec.md :: I43`), and the whole of it (`:: I78`). */
export const textLink = tv({
  base: "underline underline-offset-2 transition-colors",
  variants: {
    tone: {
      brand: BRAND_GRADE,
      /** Quieter, for a link ranked below a primary action rather than one carrying the page's own. */
      muted: "text-foreground-muted hover:text-foreground",
    },
  },
  defaultVariants: { tone: "brand" },
});

/**
 * A toggle, or a row's own way in. A link inside text takes `textLink` however standalone it looks:
 * its base underlines for every caller because colour alone is not a link (`docs/frontend/spec.md :: I43`).
 */
export const BRAND_INK_OUTSIDE_PROSE = `${BRAND_GRADE} transition-colors`;
