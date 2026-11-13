"use client";

// Imports nothing of the kit's: `Link` takes the hint from here, and a kit module this one imported could close a
// cycle through `Link`, whose module would then be read before it is defined.
import { createContext, Suspense, useContext } from "react";
import { useLinkStatus } from "next/link";

import type { ReactNode } from "react";

/** Whether the pages below arrive whole, no part of a page waiting in a boundary of its own (`PageWait`). */
const WholeContext = createContext(false);

/**
 * The pages under it arrive whole. With no boundary left below the layout two pages share, a client navigation keeps
 * the page it leaves until the new one is complete, since a transition never hides content it has revealed; a hard
 * load sends the page once it is rendered. The layout placing it exports `instant = false`, which lets the build accept
 * a page reading uncached data outside every boundary. Removed with that export, every template waits in its own
 * boundaries again.
 */
export function WholePages({ children }: { children: ReactNode }) {
  return <WholeContext value>{children}</WholeContext>;
}

/**
 * A template's boundary around what it reads: `children` in a `Suspense` boundary, `fallback` standing while they are
 * read, or under `WholePages` the children alone, so their read holds the whole page. Both are elements, never a
 * function, which a server template could not hand a client component.
 */
export function PageWait({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
  return useContext(WholeContext) ? children : <Suspense fallback={fallback}>{children}</Suspense>;
}

/**
 * The pending hint on a pressed link, Next's recipe (`useLinkStatus`): always rendered and taking no room, a dot that
 * fades in only once the navigation has taken 100 ms and pulses until it commits, so a fast one shows nothing. Placed
 * absolutely with no offset, it stands at its static place, after the words in a line of text and at the start of a flex
 * or grid link, and moves nothing. It must stand inside Next's link, whose status it reads. Outside `WholePages` it
 * draws nothing: a page streaming in its parts commits its placeholders within a few frames of the press, before the
 * hint's delay ends.
 */
export function LinkHint() {
  const { pending } = useLinkStatus();
  if (!useContext(WholeContext)) return null;
  return (
    <span
      aria-hidden
      data-pending={pending || undefined}
      className="group/hint pointer-events-none absolute ms-1 mt-1.5 opacity-0 transition-opacity duration-(--motion-in) data-pending:opacity-100 data-pending:delay-100">
      <span className="block size-1.5 rounded-full bg-current opacity-60 group-data-pending/hint:animate-pulse" />
    </span>
  );
}
