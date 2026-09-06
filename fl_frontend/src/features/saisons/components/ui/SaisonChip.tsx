import type { ReactNode } from "react";

/**
 * One component rather than the classes twice: the tint below is contrast-measured, and a second
 * spelling of it is one nobody re-measures.
 */
export function SaisonChip({ children }: { children: ReactNode }) {
  return (
    // `/15`, the one alpha every pill takes
    // (`fl_frontend/src/shared/components/ui/badges.ts :: PILL_TINT`): a season chip at another alpha
    // sits beside a phase badge as a paler grade of the same pill.
    <div className="border-brand/30 bg-brand/15 fluid-xs text-brand inline-flex w-fit items-center gap-2 rounded-full border px-4 py-1.5 font-bold shadow-xs">
      {/* Rests visible when `prefers-reduced-motion` stops it: `animate-ping` starts at full opacity
          and unscaled, so the dot stays a dot rather than disappearing. */}
      <span className="bg-brand-solid size-2 animate-ping rounded-full" />
      {children}
    </div>
  );
}
