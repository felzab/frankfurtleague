import { CardGrid } from "@/shared/components/ui/CardGrid";

import type { ReactNode } from "react";

// Each step is n columns of 19.75rem plus the gaps between them: 19.75rem is the narrowest `SpielCard`
// holding the word „Taunusblick“ unbroken beside a score such as 10:2 at its largest type; a longer name wraps.
const COLUMNS_CLASSES = "@min-[41rem]:grid-cols-2 @min-[62.25rem]:grid-cols-3";

/** Every grid of `SpielCard`s, at the `SpielCard`'s own column steps. */
export function SpielCardGrid({ role, className = "", children }: { role: "list" | "status"; className?: string; children: ReactNode }) {
  return (
    <CardGrid
      columns={COLUMNS_CLASSES}
      role={role}
      className={className}>
      {children}
    </CardGrid>
  );
}
