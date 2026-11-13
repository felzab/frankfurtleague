"use client";

import { createContext, Suspense, useContext } from "react";

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
