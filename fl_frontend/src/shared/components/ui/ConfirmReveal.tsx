import { PANEL_REVEAL } from "./motion";

import type { ReactNode } from "react";

/**
 * A two-press control's armed state, escalated in place. **`role="alert"` is the mechanism**: without
 * it the only signal that the next press is irreversible is the button label quietly changing, which
 * nothing announces.
 */
export function ConfirmReveal({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className={`${PANEL_REVEAL} bg-danger/5 border-danger/20 flex flex-col gap-4 rounded-xl border p-4 shadow-sm`}>
      <strong className="fluid-xs text-danger-strong">Bist Du Dir sicher?</strong>
      {children}
    </div>
  );
}
