import { focusSlot } from "@/shared/utils/focusAfterWrite";

import type { ReactNode } from "react";

/**
 * The place mark for a control wrapped in something that passes no attribute through, a refusal's
 * overlay among them, which the mark has to hold as well. `contents`, so the row lays the control out
 * as it did without it.
 */
export function FocusSlot({ name, children }: { name: string; children: ReactNode }) {
  return (
    <span
      className="contents"
      {...focusSlot(name)}>
      {children}
    </span>
  );
}
