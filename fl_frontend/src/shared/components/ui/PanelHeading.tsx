import type { ReactNode } from "react";

/**
 * A panel's title, with its hint rendered BESIDE the heading rather than inside it.
 *
 * A heading takes its accessible name from its own contents, and `Hint`'s trigger is a `role="button"`
 * carrying a label of its own: nested, a panel announces its title followed by that label.
 */
export function PanelHeading({ className, title, children }: { className: string; title: ReactNode; children?: ReactNode }) {
  return (
    // Inline `<h2>` in a plain block, never a flex row: `hintTrigger` is an inline glyph on purpose, a
    // text run's mass sitting above its line box's centre. Both stay on one line box, as they were.
    <div>
      <h2 className={`${className} inline`}>{title}</h2>
      {children}
    </div>
  );
}
