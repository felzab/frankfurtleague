import type { ReactNode } from "react";

/**
 * A panel's title, with its hint rendered beside the heading rather than inside it.
 *
 * Why the heading may hold nothing else, and why the glyph stays inline: `docs/frontend/spec.md` I44.
 */
export function PanelHeading({ className, title, children }: { className: string; title: ReactNode; children?: ReactNode }) {
  return (
    // Inline `<h2>` in a plain block, never a flex row: the glyph aligns on the title's own line box.
    // Why that is not a detail (`docs/frontend/spec.md` I44).
    <div>
      <h2 className={`${className} inline`}>{title}</h2>
      {children}
    </div>
  );
}
