"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query currently matches.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the server snapshot is an explicit
 * argument, so the hydration result is stated rather than raced. It returns `false` on the server —
 * there is no viewport to measure — which is why the caller must choose a query whose `false`
 * branch is the safe one.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Below Tailwind's `lg` breakpoint (64rem), where the sidemenu is an overlay drawer rather than the
 * always-visible desktop rail. Written as a query because `inert` is a DOM property and cannot be
 * expressed as a variant.
 */
export const BELOW_LG_QUERY = "(max-width: 1023.98px)";
