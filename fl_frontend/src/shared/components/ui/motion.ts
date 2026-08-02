/**
 * SHARED · entrance motion
 *
 * The app's two arrival animations, and there are only two (owner decision, 2026-08-02). The
 * exports say which is which and, more importantly, when each is wrong.
 */

/**
 * TIER 1 — the page rise. A view settling into place: fade plus a 16px lift over 400ms.
 *
 * For an element that **mounts once per visit** and is the shell of a route: a tab root, a bracket,
 * a details page, an admin CRUD column. It was previously spelled out at eight call sites, which is
 * how `SaisontabelleView` ended up with no entrance at all while its four siblings had one.
 *
 * **Not for a collection of cards** — see `CARDS_CASCADE` for why a block fade fails there. And not
 * on a container whose children already cascade, unless the two genuinely play at different moments:
 * `SpielplanView` is the one such case, where the root rises at mount and the panels cascade on
 * every later tab press.
 *
 * `InlineCreateAutocomplete` and `ConfirmDeleteModal` spell this same string out by hand and are
 * deliberately **not** wired to this constant. They are panels revealing inside an already-open
 * modal, not routes arriving — a different class of motion that happens to look the same today.
 * Binding them here would mean a future change to the page rise silently moved them too.
 */
export const PAGE_RISE = "animate-in fade-in slide-in-from-bottom-4 duration-400";

/**
 * TIER 2 — the card cascade. Cards arrive in sequence, 25ms apart, rather than all at once.
 *
 * For **any grid or list of cards**, whatever the card is — `SpielCard`, `SpielCardCompact`,
 * `TeamCard`. It is keyed off `role="listitem"` rather than off a card type precisely so a grid of
 * teams arrives like a grid of matches; the shape of the collection is what decides, not its
 * contents. It goes on the grid container and the cards need no class of their own.
 *
 * The keyframes, the stagger and the reasoning live in `globals.css`; the short version is that a
 * block fade reads as the content *mutating in place* when each card lands exactly where the
 * previous set's card was, and only separating them in time fixes it. That is why this is not
 * interchangeable with `PAGE_RISE` even though both are 300-400ms fades.
 *
 * **Two collections deliberately do not use it**, both because their items are positioned relative
 * to chrome that cannot animate with them: the playoff bracket, whose cards are joined by CSS
 * bracket lines, and `TeamDetailsView`'s timeline, whose cards hang off a dashed rule with an
 * absolutely-placed badge per row. Both take `PAGE_RISE` on the view instead.
 */
export const CARDS_CASCADE = "cards-cascade";
