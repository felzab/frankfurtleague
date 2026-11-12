import { fieldStack } from "./fieldStyles";

import type { ReactNode } from "react";

/**
 * A form's fields one under another in the form rule's one rhythm (`fieldStack`), and what stands
 * among them, a fact, a table or an act's button, at its own width from the same left edge. Every container of fields
 * draws its fields in one, an editor's box, a Konto box, a dialog, a field group and a page form alike, so none writes
 * a gap of its own.
 */
export function FieldStack({ children }: { children: ReactNode }) {
  return <div className={fieldStack()}>{children}</div>;
}
