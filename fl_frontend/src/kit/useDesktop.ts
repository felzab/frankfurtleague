"use client";

import { useSyncExternalStore } from "react";

/** Built on the first read in the browser, which every later read and subscription shares; never on the server. */
let query: MediaQueryList | undefined;

/**
 * The rail's breakpoint, `lg`, read from its token on the root as Tailwind's guide reads a theme variable in
 * script: from it the rail stands, below it the phone's bars and sheets. The token is fixed for the document's life,
 * so one query answers for every menu asking.
 */
const desktop = () =>
  (query ??= window.matchMedia(`(min-width: ${getComputedStyle(document.documentElement).getPropertyValue("--breakpoint-lg")})`));

function subscribe(onChange: () => void) {
  const shared = desktop();
  shared.addEventListener("change", onChange);
  return () => shared.removeEventListener("change", onChange);
}

/**
 * Whether the rail stands, the question `lg:` asks in a class, for the parts that act on it in script: a
 * menu's popover or sheet, and the rail's shortcut. The server answers desktop until the browser's own answer
 * replaces it, which neither shows: a menu renders its list only once opened, and a shortcut needs a key.
 */
export function useDesktop() {
  return useSyncExternalStore(
    subscribe,
    () => desktop().matches,
    () => true,
  );
}
