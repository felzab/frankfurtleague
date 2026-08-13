/**
 * SHARED · the admin table's anti-collapse floor
 *
 * One declaration, because the five admin tables share a fallback and must share the box it reserves.
 * See the export for what collapses without it and where the number comes from.
 */

/**
 * A floor under the `md+` table shell, so an empty collection cannot flatten it to its borders.
 *
 * **What it prevents.** react-aria's `CollectionBuilder` renders its real DOM from a collection read
 * during the render pass, while the hidden portal that fills that collection writes to it through ref
 * callbacks at commit — one pass later. So the first client render of any of these tables draws a
 * shell with **no header row and no body rows**, and an unfloored shell is then a few pixels of border
 * between a full-height skeleton and a full-height table.
 *
 * **It scales with the collection**, which is why it went unseen for so long: the empty pass lasts as
 * long as building and painting the rows takes, so it is a frame at five rows and plainly visible at
 * Spieler's four hundred.
 *
 * **The number is `AdminCrudFallback`'s own `md+` box**, so the swap out of the skeleton moves
 * nothing: a header at `px-6 py-4` around a `fluid-xs` line, five rows at `px-6 py-4` around the
 * taller of a `fluid-sm`/`fluid-xs` stack and `ROW_ACTION_SIZE`, plus the row borders. That computes
 * to 434px at the `md` breakpoint and 453px from ~1360px, where both type steps clamp. Rounded up to
 * 456px so it is never under the skeleton at any width — under it and the shell shrinks before it
 * grows, which is a reversal the eye catches; over it by three pixels is absorbed by the growth into
 * the real rows that follows immediately.
 *
 * **A floor, never a height.** `min-height` only ever raises the used height, so a filled table grows
 * past it freely. It is deliberately absent from the `md:hidden` card branch, which maps its rows
 * directly rather than through a collection and so never has an empty pass to survive.
 */
export const TABLE_COLLECTION_FLOOR = "min-h-[28.5rem]";
