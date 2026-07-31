"use client";

import { useEffect, useState } from "react";

/**
 * Whether a CSS media query currently matches. `false` until the component has mounted, so the
 * caller must pick a query whose `false` branch is the safe one — for the sidemenu that is "not
 * inert", i.e. never wrongly inert.
 *
 * `useState` + `useEffect` rather than `useSyncExternalStore`. Both work; this one is kept because
 * the state update is unconditional after mount and therefore easy to reason about, and because the
 * server snapshot is expressed as the initial state rather than as a third callback.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const list = window.matchMedia(query);

    // Set from the effect too, not just from the listener: `change` only fires on a *transition*,
    // so a viewport that already matched at mount would otherwise never be reported.
    setMatches(list.matches);

    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/**
 * Below Tailwind's `lg` breakpoint (64rem), where the sidemenu is an overlay drawer rather than the
 * always-visible desktop rail. Written as a query because `inert` is a DOM property and cannot be
 * expressed as a variant.
 */
export const BELOW_LG_QUERY = "(max-width: 1023.98px)";
