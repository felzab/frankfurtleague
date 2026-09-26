import { DISPLAY_HEADING_CLASSES } from "./displayType";

import type { ReactNode } from "react";

/**
 * The box every step of one sign-in stands in — the form, the page the mailed link lands on, and
 * the passkey page — so a change to the card's grade reaches all three rather than two of them.
 */
export function SignInCard({
  title,
  /** The form's own glyph. Absent everywhere else, the steps after it being read rather than arrived at. */
  ornament,
  children,
}: {
  title: string;
  ornament?: ReactNode;
  children: ReactNode;
}) {
  return (
    // `dvh`, not `vh`: on a phone `vh` is the chrome-HIDDEN height, so the card's box outgrows the
    // visible area and the page scrolls further than the footer below it. REASONED, not measured.
    <div className="flex min-h-[calc(100dvh-var(--navbar-height))] w-full flex-1 items-center justify-center px-4 py-8">
      <div className="w-full max-w-[460px] rounded-3xl border border-border bg-surface/95 p-8 shadow-2xl backdrop-blur-xl sm:p-10">
        <div className="flex flex-col items-center pb-6 text-center">
          {ornament}
          <h1 className={`${DISPLAY_HEADING_CLASSES} fluid-2xl text-foreground`}>{title}</h1>
        </div>

        <div className="mb-8 h-[1px] w-full border-border" />

        {children}
      </div>
    </div>
  );
}
