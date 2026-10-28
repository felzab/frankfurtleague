/**
 * The address parameter every page's tabs keep the chosen tab in, `?tab=<id>`: one key on every page, so a
 * link to a tab reads the same wherever it points.
 */
export const TAB_PARAM = "tab";

/**
 * The tab a page renders chosen: the one its address names where that is one of `ids`, else `fallback`. Read
 * on the server, so a tab pressed before the page hydrates, which loads the address as a whole document,
 * opens on the tab it named.
 */
export function chosenTab(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
  ids: readonly string[],
  fallback: string,
): string {
  const named = searchParams[TAB_PARAM];
  // A parameter written twice is read as its first value, as `URLSearchParams.get` reads it.
  const id = Array.isArray(named) ? named[0] : named;
  return id !== undefined && ids.includes(id) ? id : fallback;
}
