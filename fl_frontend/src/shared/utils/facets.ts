/** One choosable value of a facet. `count` is filled in by `countFacetOptions`, never by the caller. */
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
};

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
 * Comma-joined, one parameter per facet; a value the facet does not offer is dropped, the query string being editable.
 * A facet carrying `defaultValues` answers with them while its parameter is absent.
 * **The returned object is referentially stable while the query string is** — the half `applyFacets` cannot cover.
 */
export function readFacetSelection<TItem>(facets: readonly Facet<TItem>[], params: URLSearchParams): FacetSelection {
  const search = params.toString();
  const cached = lastReadSelection.get(facets);
  if (cached !== undefined && cached.search === search) return cached.selection;

  const selection: Record<string, readonly string[]> = {};

  for (const facet of facets) {
    const raw = params.get(facet.param);

    // Absent and empty part company here: absent is nobody having answered, which a default may answer for, while
    // an empty parameter is the reader having turned the facet off and is the one state that outranks a default.
    if (raw === null) {
      if (facet.defaultValues !== undefined && facet.defaultValues.length > 0) selection[facet.param] = facet.defaultValues;
      continue;
    }
    if (raw === "") continue;

    const offered = new Set(facet.options.map((option) => option.value));
    const picked = raw.split(",").filter((value) => offered.has(value));
    if (picked.length > 0) selection[facet.param] = picked;
  }

  lastReadSelection.set(facets, { search, selection });
  return selection;
}

/** How many facets have something picked — what the trigger's badge counts. */
export function countActiveFacets(selection: FacetSelection): number {
  return Object.values(selection).filter((picked) => picked.length > 0).length;
}
