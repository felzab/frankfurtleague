"use client";

import { useEffect } from "react";

/** The element the fragment names, found as the browser finds it: by the fragment as written, then decoded. */
function indicated(fragment: string): HTMLElement | null {
  if (fragment === "") return null;
  const asWritten = document.getElementById(fragment);
  if (asWritten !== null) return asWritten;
  try {
    return document.getElementById(decodeURIComponent(fragment));
  } catch {
    // A malformed escape, typed into the address, names nothing.
    return null;
  }
}

/**
 * Marks the place the address's fragment names, which the `kit-target` rule then highlights as it does
 * `:target`. The browser sets `:target` on a document load and on Back and Forward, never on the history
 * entry a client navigation pushes, after which Next's link only scrolls the place into view; this mark
 * covers that case. It marks once, when the block holding the places mounts, so a fragment changed while the
 * page stands is not marked.
 */
export function TargetMark() {
  useEffect(() => {
    const target = indicated(window.location.hash.slice(1));
    if (target === null) return;
    target.setAttribute("data-kit-target", "");
    return () => {
      target.removeAttribute("data-kit-target");
    };
  }, []);
  return null;
}
