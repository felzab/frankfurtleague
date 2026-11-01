"use client";

import { useSyncExternalStore } from "react";

/**
 * The rail's breakpoint, `lg`, read from its token on the root as Tailwind's guide reads a theme variable in
 * script: from it the rail stands, below it the phone's bars and sheets.
 */
const desktop = () => window.matchMedia(`(min-width: ${getComputedStyle(document.documentElement).getPropertyValue("--breakpoint-lg")})`);

function subscribe(onChange: () => void) {
  const query = desktop();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the rail stands, the question `lg:` asks in a class, for the parts that act on it in script: a
 * menu's popover or sheet, the rail's shortcut, a card folded on a phone alone. The server's answer stands
 * until the browser's own replaces it at hydration. It is desktop by default, which a menu and a shortcut never
 * show: a menu renders its list only once opened, and a shortcut needs a key. A part whose first frame shows
 * the answer passes the one it would rather correct on a desktop than on a phone.
 */
export function useDesktop(serverAnswer = true) {
  return useSyncExternalStore(
    subscribe,
    () => desktop().matches,
    () => serverAnswer,
  );
}
