import { tv } from "tailwind-variants";

/**
 * The floating surface inside a form, at the elevation that says it floats rather than sits. **A form inside a modal
 * gets no bordered section panels**, which leave nothing but a hairline between concentric borders on one fill.
 */
export const overlayPanel = tv({
  base: "bg-surface border-border text-foreground rounded-xl border shadow-lg",
});
