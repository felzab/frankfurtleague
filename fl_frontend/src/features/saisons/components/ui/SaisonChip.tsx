import type { ReactNode } from "react";

/**
 * The season badge both public entry points wear — the landing hero and the application page.
 *
 * One component rather than the classes twice: the tint below is contrast-measured, and a second
 * spelling of it is one nobody re-measures.
 */
export function SaisonChip({ children }: { children: ReactNode }) {
  return (
    // `/10`, not `/15`: bold normal-size text needs 4.5:1 against its own tint, and 10% measures
    // 4.70:1 in the dark theme where 15% drops to 4.42:1. Re-measure if --accent-brand moves.
    <div className="border-brand/30 bg-brand/10 fluid-xs text-brand inline-flex w-fit items-center gap-2 rounded-full border px-4 py-1.5 font-bold shadow-xs">
      {/* Rests visible when `prefers-reduced-motion` stops it: `animate-ping` starts at full opacity
          and unscaled, so the dot stays a dot rather than disappearing. */}
      <span className="bg-brand-solid size-2 animate-ping rounded-full" />
      {children}
    </div>
  );
}
