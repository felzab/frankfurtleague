/**
 * SHARED · faceted filtering
 *
 * The pure half of the filter bar: what a facet is, how a selection narrows a list, and how many
 * items each option would leave. No React and no URL, so it is tested rather than clicked.
 *
 * Invariants:
 * - OR within a facet, AND across facets — backwards feels broken rather than wrong.
 * - An empty selection means "no opinion", never "match nothing".
 * - `read` returns EVERY value an item matches — `erlaubte_stufen` needs several per item.
 * - A count removes the facet's own selection — otherwise every unselected option in an active
 *   facet reads zero, answering "what do I have" instead of "what would I get".
 * - Filtering runs BEFORE the fuzzy search — same result, smaller list for Fuse.
 * - A facet's `param` is unique per surface, never `q` or `saison_id` — `facets.test.ts` asserts it.
 */

/** One choosable value of a facet. `count` is filled in by `countFacetOptions`, never by the caller. */
export type FacetOption = {
  value: string;
  label: string;
};

/**
 * One dimension a list can be narrowed along.
 *
 * `read` is what makes this generic over a row type without `shared` importing a feature: each slice
 * declares how its own row answers the facet, and this module never learns what a row is.
 */
export type Facet<TItem> = {
  /** The URL parameter this facet reads and writes. Unique per surface; never `q` or `saison_id`. */
  param: string;
  /** The group heading in the popover, and the prefix on an active chip. */
  label: string;
  options: readonly FacetOption[];
  /** Every option value this item matches. Empty means the item matches none of them. */
  read: (item: TItem) => readonly string[];
};

/** What is selected right now, by facet param. An absent or empty entry means "no opinion". */
export type FacetSelection = Readonly<Record<string, readonly string[]>>;

/** Whether one item satisfies one facet's selection. An untouched facet is satisfied by everything. */
function satisfies<TItem>(item: TItem, facet: Facet<TItem>, selection: FacetSelection): boolean {
  const picked = selection[facet.param] ?? [];
  if (picked.length === 0) return true;

  const held = facet.read(item);
  return held.some((value) => picked.includes(value));
}

/**
 * The items that satisfy every facet.
 *
 * Returns the input array unchanged — the same reference — when nothing is selected. That is not a
 * micro-optimisation: `AdminCrudView` feeds the result to `useFuzzySearch`, whose memo and whose
 * react-aria collection both key on identity, so allocating a fresh array per render would defeat the
 * memo on every unfiltered page in the app.
 */
export function applyFacets<TItem>(items: TItem[], facets: readonly Facet<TItem>[], selection: FacetSelection): TItem[] {
  const active = facets.filter((facet) => (selection[facet.param] ?? []).length > 0);
  if (active.length === 0) return items;

  return items.filter((item) => active.every((facet) => satisfies(item, facet, selection)));
}

/**
 * How many items each option of one facet would leave, with that facet's own selection ignored.
 *
 * The exclusion is the whole point: with `status=active` picked, counting `status=retired` against the
 * current result gives 0 for every retired row that exists, and the reader concludes there are none.
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
      // A value the facet does not offer is ignored rather than counted into a key nothing renders —
      // `read` is a slice's own function and may legitimately report more than the options list shows.
      const held = counts[value];
      if (held !== undefined) counts[value] = held + 1;
    }
  }
  return counts;
}

/**
 * A selection read out of URL search parameters.
 *
 * **Comma-joined, one parameter per facet** — `?status=active,future` rather than a repeated key. Every
 * facet value in the app is a slug with no comma in it, and one readable parameter per dimension beats
 * three copies of the same key. A value the facet does not offer is dropped rather than kept: the query
 * string is user-editable, and a selection naming an option the popover cannot show would leave the two
 * halves of the control disagreeing — the same reasoning `SaisonSelector` applies to `?saison_id=`.
 */
export function readFacetSelection<TItem>(facets: readonly Facet<TItem>[], params: URLSearchParams): FacetSelection {
  const selection: Record<string, readonly string[]> = {};

  for (const facet of facets) {
    const raw = params.get(facet.param);
    if (raw === null || raw === "") continue;

    const offered = new Set(facet.options.map((option) => option.value));
    const picked = raw.split(",").filter((value) => offered.has(value));
    if (picked.length > 0) selection[facet.param] = picked;
  }
  return selection;
}

/** How many facets have something picked — what the trigger's badge counts. */
export function countActiveFacets(selection: FacetSelection): number {
  return Object.values(selection).filter((picked) => picked.length > 0).length;
}
