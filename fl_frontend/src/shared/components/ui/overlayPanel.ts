import { tv } from "tailwind-variants";

/**
 * The floating surface inside a form, at the elevation that says it floats rather than sits. **A form inside a modal
 * gets no bordered section panels**, which leave nothing but a hairline between concentric borders on one fill.
 */
export const overlayPanel = tv({
  base: "bg-surface border-border text-foreground rounded-xl border shadow-lg",
});

/**
 * A `Select`'s popover, pinned to its trigger. HeroUI's `.select__popover` declares
 * `min-w-(--trigger-width)` and no maximum, so a long row opens the list far past the form it sits
 * in.
 */
export const SELECT_POPOVER_CLASSES = `${overlayPanel()} mt-2 w-(--trigger-width) p-1.5`;
