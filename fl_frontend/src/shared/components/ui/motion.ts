/**
 * SHARED · entrance motion
 *
 * The app's three arrival animations, and there are only three (decided 2026-08-13, superseding a
 * set of two), plus `CONTENT_FADE`, which is a handover rather than an arrival. The exports say which
 * is which and, more importantly, when each is wrong.
 *
 * See:
 * - globals.css `@theme` — the duration scale and the two curves every string here reads
 */

/**
 * TIER 1 — the page rise. A view settling into place: fade plus an 8px lift over 300ms.
 *
 * For an element that **mounts once per visit** and is the shell of a route: a tab root, a bracket,
 * a details page, an admin CRUD column. Named rather than spelled out at each call site, so a view
 * cannot quietly end up with no entrance while its siblings have one.
 *
 * **It takes the same duration and the same curve as `CARDS_CASCADE`, and the two must stay equal.**
 * They play side by side on `SpielplanView` — the rise on the `Tabs` root, the cascade on the grid
 * inside it — so any gap between them is visible as the page and its contents arriving at different
 * moments. Sampled off the bézier, both reach 90% of their travel at 112ms of their 300ms and then
 * settle under a pixel (measured 2026-08-13): prompt to read, without stopping abruptly. Giving this
 * tier a shorter duration or a steeper curve than the cascade is what breaks that.
 *
 * **Not for a collection of cards** — see `CARDS_CASCADE` for why a block fade fails there. And not
 * on a container whose children already cascade, unless the two genuinely play at different moments:
 * `SpielplanView` is the one such case, where the root rises at mount and the panels cascade on
 * every later tab press.
 *
 * **Not for a reveal inside an already-open page** — that is `PANEL_REVEAL`, and the two are kept
 * apart on purpose.
 */
export const PAGE_RISE = "animate-in fade-in slide-in-from-bottom-2 duration-(--motion-slow) ease-(--motion-ease-enter)";

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
 * interchangeable with `PAGE_RISE` even though the two now share a duration and a curve.
 *
 * **Two collections deliberately do not use it**, both because their items are positioned relative
 * to chrome that cannot animate with them: the playoff bracket, whose cards are joined by CSS
 * bracket lines, and `TeamSaisonSpieleTimeline`, whose cards hang off a dashed rule with an
 * absolutely-placed badge per row. Both take `PAGE_RISE` on the view instead.
 */
export const CARDS_CASCADE = "cards-cascade";

/**
 * TIER 3 — the panel reveal. A section opening inside a page the reader is already looking at:
 * fade plus an 8px lift over 150ms.
 *
 * For the confirmation panel a two-step control unfolds in place, which is what decides membership
 * rather than the count: `FormRolloverSection`, `FormGruppenSwapSection` and the club editor's
 * `FormSaisonSection`.
 *
 * **The shorter tier, and that is the whole reason this is not `PAGE_RISE`.** A page rise is a whole
 * view settling; this is a few hundred pixels unfolding in a region already in view, and it carries
 * a sentence that has just escalated — making the reader wait to read it is the one thing it must
 * not do. Binding the two would also mean any future change to how a *route* arrives silently moved
 * a confirmation panel, which is a change made for reasons that never applied to it.
 */
export const PANEL_REVEAL = "animate-in fade-in slide-in-from-bottom-2 duration-(--motion-fast) ease-(--motion-ease-enter)";

/**
 * NOT A TIER — the handover. Content taking a skeleton's place: a fade over 200ms and no travel.
 *
 * For a `Suspense` subtree whose fallback reserved its geometry — today that is `AdminCrudView`
 * behind `AdminCrudFallback`. **The absent travel is the whole point.** A fallback cannot animate
 * out, so it is removed at full opacity in one frame; content that also travels arrives 8px low and
 * transparent at that same frame, and the pair reads as the box emptying before it fills. Fading in
 * place over identical geometry is the nearest thing to a cross-fade that a `Suspense` swap allows.
 *
 * **Not an arrival, and not a replacement for `PAGE_RISE`.** A view that mounts with nothing standing
 * in for it has no handover to make and should rise. Use this only where a skeleton of matching
 * geometry was on screen the frame before.
 */
export const CONTENT_FADE = "animate-in fade-in duration-(--motion-base) ease-(--motion-ease-enter)";
