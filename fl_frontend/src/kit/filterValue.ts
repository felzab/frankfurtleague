// Neither a client module nor a server-only one: a server page cannot call a client module's functions, and the tabs,
// a client module, write their parameter by `TAB_PARAM`.

/**
 * A filter's value out of the page's address: the first where it is repeated, as `URLSearchParams.get` reads it, and
 * only what the filter offers, so a hand-typed one narrows nothing.
 */
export function filterValue<Id extends string>(named: string | string[] | undefined, options: ReadonlyArray<{ id: Id }>): Id | null {
  const value = Array.isArray(named) ? named[0] : named;
  return options.find((option) => option.id === value)?.id ?? null;
}

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
  return (
    filterValue(
      searchParams[TAB_PARAM],
      ids.map((id) => ({ id })),
    ) ?? fallback
  );
}
