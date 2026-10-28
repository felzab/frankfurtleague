// Redesign: goes with its last importer; `kit/SectionTitle` replaces it.

import { FOCUS_HEADING } from "@/shared/utils/focusAfterWrite";

import type { ReactNode } from "react";

/**
 * A panel's title, with its hint rendered beside the heading rather than inside it.
 */
export function PanelHeading({ className, title, children }: { className: string; title: ReactNode; children?: ReactNode }) {
  return (
    // Inline `<h2>` in a plain block, never a flex row: the glyph aligns on the title's own line box.
    // Why that is not a detail.
    <div>
      {/* The panel's landing where a write empties it or takes its control away. */}
      <h2
        className={`${className} inline`}
        {...FOCUS_HEADING}>
        {title}
      </h2>
      {children}
    </div>
  );
}
