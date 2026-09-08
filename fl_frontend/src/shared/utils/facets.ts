/** One choosable value of a facet, and no count of its own: `countFacetOptions` answers those against the rows on hand. */
export type FacetOption = {
  value: string;
  label: string;
};

/**
 * One dimension a list can be narrowed along. `read` is what makes this generic over a row type without `shared`
 * importing a feature: each slice declares how its own row answers, and this module never learns what a row is.
 */
export type Facet<TItem> = {
  /** The URL parameter this facet reads and writes. Unique per surface; never `q` or `saison_id`. */
  param: string;
  /** The group heading in the popover, and the prefix on an active chip. */
  label: string;
  options: readonly FacetOption[];
  /**
   * What the facet selects while its parameter is ABSENT — for a surface whose useful opening state is already
   * narrowed. An empty parameter is what turns it off, so the unnarrowed list stays reachable. Offered values only.
   */
  defaultValues?: readonly string[];
  /** Every option value this item matches. Empty means the item matches none of them. */
  read: (item: TItem) => readonly string[];
  /**
   * Whether the SERVER narrows on this parameter. `useUrlFilters` then navigates rather than writing history
   * alone, and the surface owes `FacetCounts`, which `countFacetOptions` cannot answer for rows never served.
   */
  narrowsTheRead?: boolean;
};

/**
 * Option counts a surface was TOLD, by facet parameter and then by option value. What a server-narrowed facet
 * passes in place of `countFacetOptions`, which can only count what one read happened to serve.
 */
export type FacetCounts = Readonly<Record<string, Readonly<Record<string, number>>>>;

/**
 * Whether an option still leads somewhere. A picked one stays reachable at zero, or it could not be deselected;
 * an unpicked one at zero is offered and inert, which is why a server-narrowed facet must be told real counts.
 */
export function isFacetOptionReachable(count: number, isPicked: boolean): boolean {
  return count > 0 || isPicked;
}

/** What is selected right now, by facet param. An absent or empty entry means "no opinion". */
export type FacetSelection = Readonly<Record<string, readonly string[]>>;

/** OR within a facet, AND across facets — backwards feels broken rather than wrong. An untouched facet matches everything. */
function satisfies<TItem>(item: TItem, facet: Facet<TItem>, selection: FacetSelection): boolean {
  const picked = selection[facet.param] ?? [];
  if (picked.length === 0) return true;

  const held = facet.read(item);
  return held.some((value) => picked.includes(value));
}

/**
 * Returns the input array unchanged — the same reference — while nothing is selected. Not a micro-optimisation:
 * `useFuzzySearch`'s memo and the collection below it both key on identity, so a fresh array defeats both.
 */
export function applyFacets<TItem>(items: TItem[], facets: readonly Facet<TItem>[], selection: FacetSelection): TItem[] {
  const active = facets.filter((facet) => (selection[facet.param] ?? []).length > 0);
  if (active.length === 0) return items;

  return items.filter((item) => active.every((facet) => satisfies(item, facet, selection)));
}

/**
 * How many items each option would leave, with that facet's own selection ignored — the exclusion is the whole point.
 * Counted against the current result, every unselected option in an active facet reads zero.
 */
export function countFacetOptions<TItem>(
  items: TItem[],
  facets: readonly Facet<TItem>[],
  selection: FacetSelection,
  facet: Facet<TItem>,
): Record<string, number> {
  const others = facets.filter((candidate) => candidate.param !== facet.param);
  const base = applyFacets(items, others, selection);

  const counts: Record<string, number> = {};
  for (const option of facet.options) counts[option.value] = 0;

  for (const item of base) {
    for (const value of facet.read(item)) {
      // `read` is a slice's own function and may legitimately report more values than the options list shows.
      const held = counts[value];
      if (held !== undefined) counts[value] = held + 1;
    }
  }
  return counts;
}

/** Keyed on the facet array, which every surface owns exactly one of, so two surfaces on one page never share a slot. */
const lastReadSelection = new WeakMap<object, { search: string; selection: FacetSelection }>();

/**
 * Comma-joined, one parameter per facet; a value the facet does not offer is dropped, the query
 * string being editable, and `defaultValues` answer where nothing offered survives.
 * **The result is referentially stable while the query string is.**
 */
export function readFacetSelection<TItem>(facets: readonly Facet<TItem>[], params: URLSearchParams): FacetSelection {
  const search = params.toString();
  const cached = lastReadSelection.get(facets);
  if (cached !== undefined && cached.search === search) return cached.selection;

  const selection: Record<string, readonly string[]> = {};

  for (const facet of facets) {
    const raw = params.get(facet.param);

    // The EMPTY parameter is the one state that outranks a default: it is the reader having turned the
    // facet off, and every "show me all of them" link in the app is written as that form.
    if (raw === "") continue;

    const offered = new Set(facet.options.map((option) => option.value));
    const picked = raw === null ? [] : raw.split(",").filter((value) => offered.has(value));

    // Absent and unrecognised answer alike, with the default. Two admin lists can spell one parameter
    // differently, and reading a foreign value as the off-switch hands the reader an unnarrowed list
    // with no pill saying why.
    if (picked.length > 0) {
      selection[facet.param] = picked;
    } else if (facet.defaultValues !== undefined && facet.defaultValues.length > 0) {
      selection[facet.param] = facet.defaultValues;
    }
  }

  lastReadSelection.set(facets, { search, selection });
  return selection;
}

/**
 * The same selection off a Server Component's `searchParams`. One reader for both halves: a page parsing the
 * URL its own way would serve rows the bar then filters away, with nothing saying why.
 */
export function readFacetSelectionFromRoute<TItem>(
  facets: readonly Facet<TItem>[],
  params: Readonly<Record<string, string | string[] | undefined>>,
): FacetSelection {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const single of Array.isArray(value) ? value : [value]) search.append(key, single);
  }

  return readFacetSelection(facets, search);
}

/** How many facets have something picked — what the trigger's badge counts. */
export function countActiveFacets(selection: FacetSelection): number {
  return Object.values(selection).filter((picked) => picked.length > 0).length;
}
