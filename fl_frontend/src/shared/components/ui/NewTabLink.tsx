import Link from "next/link";

import type { ReactNode } from "react";

/** The one spelling of a link that opens a tab of its own: the opened page gets no handle on this one. */
export const NEW_TAB_ATTRIBUTES = { target: "_blank", rel: "noopener noreferrer" } as const;

/** Said after the link's own words, so a screen reader learns the page stays where it is. */
export const IN_NEUEM_TAB = "(öffnet in einem neuen Tab)";

/**
 * A link opening its page in a tab of its own, for a page that must outlive the press: a dialog's list of
 * what is left to do is lost the moment its own tab navigates away.
 */
export function NewTabLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={className}
      {...NEW_TAB_ATTRIBUTES}>
      {children}
      <span className="sr-only"> {IN_NEUEM_TAB}</span>
    </Link>
  );
}
