/**
 * A filter's value out of the page's address: the first where it is repeated, and only what the filter offers, so a
 * hand-typed one narrows nothing. A module of its own because `./Filters.tsx` is a client module, whose functions the
 * server pages reading their addresses cannot call.
 */
export function filterValue<Id extends string>(named: string | string[] | undefined, options: ReadonlyArray<{ id: Id }>): Id | null {
  const value = Array.isArray(named) ? named[0] : named;
  return options.find((option) => option.id === value)?.id ?? null;
}
