// Redesign: goes with its last importer; `kit/Dialog` replaces it.

import { tv } from "tailwind-variants";

/**
 * The floating surface inside a form, at the elevation that says it floats rather than sits. **A form inside a modal
 * gets no bordered section panels**, which leave nothing but a hairline between concentric borders on one fill.
 */
export const overlayPanel = tv({
  base: "rounded-xl border border-border bg-surface text-foreground shadow-lg",
});
