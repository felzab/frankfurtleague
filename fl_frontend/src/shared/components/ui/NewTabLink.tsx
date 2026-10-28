// Redesign: goes with its last importer; `kit/Link` replaces it.

import Link from "next/link";

import type { ReactNode } from "react";

/** The one spelling of a link that opens a tab of its own: the opened page gets no handle on this one. */
export const NEW_TAB_ATTRIBUTES = { target: "_blank", rel: "noopener noreferrer" } as const;

/** Said after the link's own words, so a screen reader learns the page stays where it is. */
export const IN_NEUEM_TAB = "(öffnet in einem neuen Tab)";

/** The announcement inside a control that opens a tab and is named by its words rather than by an `aria-label`. */
export function InNeuemTab() {
  return <span className="sr-only"> {IN_NEUEM_TAB}</span>;
}

/**
 * Every link leaving for a tab of its own, so none leaves without telling a screen reader. A control
 * named by an `aria-label`, or closed while it has nowhere to go, spreads `NEW_TAB_ATTRIBUTES` and says
 * `IN_NEUEM_TAB` in that name instead.
 */
export function NewTabLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={className}
      {...NEW_TAB_ATTRIBUTES}>
      {children}
      <InNeuemTab />
    </Link>
  );
}
