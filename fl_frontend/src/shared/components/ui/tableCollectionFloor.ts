/**
 * SHARED · the admin table's empty-pass box
 *
 * One declaration, because the five admin tables share a fallback and must share the box it reserves.
 * See the export for the pass it exists to cover and where the number comes from.
 */

/**
 * The height an admin table's `md+` shell holds while react-aria's collection is still empty.
 *
 * **Why there is such a pass.** `CollectionBuilder` renders the real DOM from a collection read
 * during the render pass, while the hidden portal that fills that collection writes to it through ref
 * callbacks at commit — one pass later. So the first client render of any of these tables draws a
 * shell with no `tbody` at all: no header row, no body rows. **It scales with the collection**, which
 * is why it went unseen for so long — a frame at five rows, plainly visible at Spieler's four hundred.
 *
 * **What it is for now.** `AdminTableSkeletonRows` is held over the shell for exactly that pass, so
 * the reader sees the same bars the Suspense fallback drew and the boundary crossing is invisible.
 * That overlay is `absolute inset-0`, so it fills its shell and nothing else — and an unfloored shell
 * in that pass is a few pixels of border, which would clip it to nothing. **This is the box it
 * fills**, which is why removing this leaves the overlay with no height rather than merely undoing a
 * cosmetic minimum.
 *
 * **The number is `AdminCrudFallback`'s own `md+` box**, so the swap out of the skeleton moves
 * nothing: a header at `px-6 py-4` around a `fluid-xs` line, five rows at `px-6 py-4` around the
 * taller of a `fluid-sm`/`fluid-xs` stack and `ROW_ACTION_SIZE`, plus the row borders. That computes
 * to 434px at the `md` breakpoint and 453px from ~1360px, where both type steps clamp. Rounded up to
 * 456px so it is never under the skeleton at any width — under it the shell shrinks before it grows,
 * and a reversal is what the eye catches, while three pixels over is absorbed by the growth into the
 * real rows that follows.
 *
 * **A floor, never a height.** `min-height` only ever raises the used height, so a filled table grows
 * past it freely. It is deliberately absent from the `md:hidden` card branch, which maps its rows
 * directly rather than through a collection and so has no empty pass to survive.
 */
export const TABLE_COLLECTION_FLOOR = "min-h-[28.5rem]";
