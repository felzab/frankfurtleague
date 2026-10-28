import type { useRouter } from "next/navigation";

/**
 * The one way back through the tab's history: Back where the tab has somewhere to go back to, else
 * `fallbackHref`, since a bare Back on a tab opened at this page does nothing. A fresh tab reads
 * `history.length` as 1, so the comparison is against 1 and not against 0.
 */
export function goBackOrPush(router: ReturnType<typeof useRouter>, fallbackHref: string): void {
  if (window.history.length > 1) router.back();
  else router.push(fallbackHref);
}
