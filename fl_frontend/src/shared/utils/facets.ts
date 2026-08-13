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
 * - One query string read against one facet array yields one selection OBJECT, not an equal copy.
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
 * The last selection read for one facet array, so an unchanged query string reads back the same object.
 *
 * Keyed on the facet array, which every surface owns exactly one of, so a surface's entry dies with the
 * surface and two surfaces on one page never share a slot. A miss only ever costs a fresh object.
 */
const lastReadSelection = new WeakMap<object, { search: string; selection: FacetSelection }>();

/**
 * A selection read out of URL search parameters.
 *
 * **Comma-joined, one parameter per facet** — `?status=active,future` rather than a repeated key. Every
 * facet value in the app is a slug with no comma in it, and one readable parameter per dimension beats
 * three copies of the same key. A value the facet does not offer is dropped rather than kept: the query
 * string is user-editable, and a selection naming an option the popover cannot show would leave the two
 * halves of the control disagreeing — the same reasoning `SaisonSelector` applies to `?saison_id=`.
 *
 * **The returned object is referentially stable for as long as the query string is**, which is the half
 * of the collection-identity constraint `applyFacets`'s early return cannot cover. Every downstream memo
 * — `AdminCrudView`'s, `SpielsucheView`'s — keys on this object, so an equal-but-fresh copy per render
 * missed all of them the moment a facet was active, rebuilt the Fuse index and changed the react-aria
 * collection's identity. Derivation is pure and total, so a cached object and a recomputed one differ in
 * nothing but their reference.
 */
export function readFacetSelection<TItem>(facets: readonly Facet<TItem>[], params: URLSearchParams): FacetSelection {
  const search = params.toString();
  const cached = lastReadSelection.get(facets);
  if (cached !== undefined && cached.search === search) return cached.selection;

  const selection: Record<string, readonly string[]> = {};

  for (const facet of facets) {
    const raw = params.get(facet.param);
    if (raw === null || raw === "") continue;

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

/**
 * The most dimensions any surface draws a trigger for, however wide the viewport.
 *
 * **Three, and it is the number the surfaces themselves already say.** Every `*_PRIMARY_FACETS`
 * declaration in the app names exactly three params, and `facets.test.ts` holds them to it — so this
 * cap does not overrule a surface, it stops WIDTH from overruling one. A fourth trigger could only ever
 * be a dimension its own priority order left out, chosen because a desktop happened to have room.
 *
 * The five surfaces carrying three facets or fewer declare nothing and are under it either way.
 */
export const PROMOTION_CAP = 3;

/**
 * Which dimensions a one-trigger-per-facet bar may keep in its row, in the order it gives them up.
 *
 * **Three lists, because the row has three kinds of dimension.** `pinned` is filtering right now and is
 * inline whatever the width — the control and the state are one object, so a dimension narrowing the
 * list can never be the thing behind the overflow. `promotable` is what the surface asked for and the
 * row keeps as much of as it can fit, LAST FIRST. `rest` is behind the control however much room there
 * is, which is what makes the cap a cap rather than a preference.
 *
 * **`primary` belongs to the SURFACE, not to the facet.** `ansetzung` is the first thing an admin
 * reaches for on Spielsuche and does not exist on any other page, so the promotion cannot live beside
 * the facet's own definition where every surface sharing that definition would inherit it.
 *
 * **Naming the params explicitly is the point.** Deriving promotion from the facets' array order would
 * make display order a silent contract, and the next person reordering a popover for visual reasons
 * would move a dimension out of the row with nothing to catch them.
 *
 * **The declaration is in priority order**, which is what `promotable` is returned in and therefore what
 * decides which dimension a row too narrow for all of them gives up. A narrow row starts one shorter
 * still: the surface is the only place that knows which of its own dimensions it would rather lose, and
 * the order it already writes says so where a second list would be the same decision spelled twice.
 *
 * **An undeclared surface promotes everything.** The unsafe fallback is the empty one — it would put a
 * page's whole vocabulary behind a word that does not say what is behind it. Promoting everything hides
 * nothing, and it is why the five surfaces carrying three facets or fewer get no overflow control at all.
 *
 * **The two limits reach different surfaces, and the difference is whether they need a priority order.**
 * The cap is a ceiling, so it binds whoever is asking; where nothing was declared it can only fall back
 * to the facets' own order, which `facets.test.ts` keeps unreachable by requiring a declaration from any
 * surface offering more than the cap. The narrow trim does need a priority order — which dimension a
 * surface would rather give up is precisely what an undeclared one has not said, and array order is not
 * an answer to it — so that one reaches a declared surface only.
 */
export function splitPromotedFacets<TItem>(
  facets: readonly Facet<TItem>[],
  primary: readonly string[] | undefined,
  selection: FacetSelection,
  /** Whether the row is the narrow case — `filterLeisteFit.ts :: isNarrowRow` is what decides it. */
  isNarrow = false,
): { pinned: Facet<TItem>[]; promotable: Facet<TItem>[]; rest: Facet<TItem>[] } {
  const isActive = (facet: Facet<TItem>) => (selection[facet.param] ?? []).length > 0;

  // A surface down to one promoted dimension keeps it, or a narrow row would be a control and nothing
  // else. Which limit reaches which surface is the docstring's last paragraph.
  const declared = (primary ?? facets.map((facet) => facet.param)).slice(0, PROMOTION_CAP);
  const promoted = isNarrow && primary !== undefined && declared.length > 1 ? declared.slice(0, -1) : declared;

  const pinned = facets.filter(isActive);
  // Priority order rather than the facets' own, because this is the order the row gives them up in.
  const promotable = promoted.flatMap((param) => facets.filter((facet) => facet.param === param && !isActive(facet)));
  const rest = facets.filter((facet) => !isActive(facet) && !promoted.includes(facet.param));

  return { pinned, promotable, rest };
}
