import { PANEL_REVEAL } from "./motion";

import type { ReactNode } from "react";

/**
 * The tinted box under both danger escalations, this reveal and the delete dialog's step two
 * (`fl_frontend/src/shared/components/ui/ConfirmDeleteModal.tsx`). The gap is not in it: the two
 * seat different content, and a rhythm shared here would set one of them wrong.
 */
export const CONFIRM_DANGER_PANEL = "bg-danger/5 border-danger/20 rounded-xl border p-4 shadow-sm";

/**
 * A two-press control's armed state, escalated in place. **`role="alert"` is the mechanism**: without
 * it the only signal that the next press is irreversible is the button label quietly changing, which
 * nothing announces.
 */
export function ConfirmReveal({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className={`${PANEL_REVEAL} ${CONFIRM_DANGER_PANEL} flex flex-col gap-4`}>
      <strong className="fluid-xs text-danger-strong">Bist Du Dir sicher?</strong>
      {children}
    </div>
  );
}
