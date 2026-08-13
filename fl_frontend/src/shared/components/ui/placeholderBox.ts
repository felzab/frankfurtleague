/**
 * SHARED · the admin placeholder's box
 *
 * One declaration, because the placeholder and the region it covers must agree on one height.
 * See the export for the pass it exists to cover and where the number comes from.
 */

/**
 * The height an admin CRUD region holds while react-aria's collection is still empty.
 *
 * **Why there is such a pass.** `CollectionBuilder` renders the real DOM from a collection read
 * during the render pass, while the hidden portal that fills that collection writes to it through ref
 * callbacks at commit — one pass later. So the first client render of any of these tables draws a
 * shell with no `tbody` at all: no header row, no body rows. **It scales with the collection**, which
 * is why it went unseen for so long — a frame at five rows, plainly visible at Spieler's four hundred.
 *
 * **What it is for.** `AdminCrudView` holds `AdminCrudFallback` over its whole region for exactly
 * that pass, so the reader sees the same placeholder the route and the boundary already drew and
 * crosses one visible change rather than three. That overlay is `absolute inset-0`, so it fills the
 * region and nothing else — and an unfloored region in that pass is the filter bar over a sliver,
 * which would clip it. **This is the box it fills**, which is why removing this leaves the overlay
 * with no height rather than merely undoing a cosmetic minimum.
 *
 * **The number is the WHOLE fallback's box**, because that is what the overlay now draws: its `h-10`
 * filter row, the `gap-4` under it, and the table card — a header at `px-6 py-4` around a `fluid-xs`
 * line, five rows at `py-4` around `ROW_ACTION_SIZE`, one header border and four separators. Only the
 * header is fluid, the row being fixed at 72px, so the box runs 472.34px at the `md` breakpoint to
 * **474px** from ~1320px where `fluid-xs` clamps. Set at 474px, the widest case, so it is never under
 * the placeholder at any width — under it the region shrinks before it grows, and a reversal is what
 * the eye catches.
 *
 * **It lasts exactly as long as the bars over it.** Once the collection lands the box is worth only
 * what the hold is worth, so it falls to nothing the moment the placeholder is revealed and a table
 * filtered to four rows sizes to four rows. Releasing it earlier is what would tear the two apart:
 * the overlay is `absolute inset-0`, so a shell that shrank to its rows underneath held bars would
 * clip them and show the rest of the table beside them.
 *
 * **A ceiling for exactly as long as the floor.** While the bars are held the shell is pinned to their
 * own height, or a collection of 362 rows would size the card to 26,000px behind an opaque overlay and
 * the placeholder would sit at the top of a blank field. The `100000px` arm is "unbounded": at
 * `--admin-placeholder-hold: 0` the ceiling is far past any table, so it binds nothing and the
 * `overflow-hidden` beside it clips nothing.
 *
 * **A floor, never a height.** `min-height` only ever raises the used height, so a filled table grows
 * past it freely. It is absent from the sections shape, whose list is mapped markup rather than a
 * react-aria collection and so has no empty pass to survive.
 */
export const PLACEHOLDER_BOX = [
  "min-h-[29.625rem]",
  "group-has-[tbody]:min-h-[calc(29.625rem*var(--admin-placeholder-hold))]",
  "group-has-[tbody]:max-h-[calc(29.625rem*var(--admin-placeholder-hold)+100000px*(1-var(--admin-placeholder-hold)))]",
  "group-has-[tbody]:overflow-hidden",
].join(" ");
