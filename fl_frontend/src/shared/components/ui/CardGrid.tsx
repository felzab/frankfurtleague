import type { ReactNode } from "react";

/**
 * Every collection of records a page lists as cards. **Its columns follow its own width, never the
 * viewport's**: from lg the dashboard rail takes part of the viewport, and a viewport step hands three
 * columns to a box holding two.
 */
export function CardGrid({
  columns,
  role,
  className = "",
  children,
}: {
  /**
   * The `@min-[…]:grid-cols-*` steps, each n cards at the card's own narrowest whole width plus the
   * `sm:gap-6` gaps between them. Spelled whole by the caller: Tailwind emits no class it never reads.
   */
  columns: string;
  role: "list" | "status";
  className?: string;
  children: ReactNode;
}) {
  return (
    // A query container styles only its descendants, hence an element of its own. The page's cap sits
    // here rather than on the grid, so the thresholds read the width the columns really share.
    <div className="@container mx-auto w-full max-w-page">
      <div
        role={role}
        className={`grid w-full grid-cols-1 gap-4 sm:gap-6 ${columns} ${className}`}>
        {children}
      </div>
    </div>
  );
}
