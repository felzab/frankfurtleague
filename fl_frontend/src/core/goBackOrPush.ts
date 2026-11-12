import type { useRouter } from "next/navigation";

/**
 * The one way back through the tab's history: Back where this site has an entry to go back to, else
 * `fallbackHref`, since Back from a tab opened at this page does nothing, and from a page a search result
 * or a mail opened leaves the site.
 */
export function goBackOrPush(router: ReturnType<typeof useRouter>, fallbackHref: string): void {
  // `navigation` counts this site's entries alone. Firefox before 147 and Safari before 26.2, both still
  // in the browserslist, lack it; there the tab's history length stands in, which counts other sites'
  // entries too and reads 1 in a fresh tab.
  const canGoBack = typeof navigation === "undefined" ? window.history.length > 1 : navigation.canGoBack;
  if (canGoBack) router.back();
  else router.push(fallbackHref);
}
