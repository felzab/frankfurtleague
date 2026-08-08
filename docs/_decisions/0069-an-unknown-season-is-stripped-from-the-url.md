# ADR-0069 — A `?saison_id=` naming no season is stripped from the URL, before the page renders

**Status:** Accepted
**Date:** 2026-08-08
**Surface:** frontend
**Supersedes:** —
**Superseded by:** —
**Source:** The owner's report of 2026-08-08: `?saison_id=2027` on `/admin/teams` listed every club as
"Nicht aufgenommen" while the sidemenu's season selector still read 2026 — "The page and the selector must
ALWAYS agree."

## Context

`?saison_id=` is user-editable, arrives on sixteen season-scoped routes, and was read by two pieces of code
that disagreed about what a value naming no season means.

`SaisonSelector` looked the value up in the season list and fell back to the current season when it found
nothing, because a `Select` holding a `value` outside its own collection shows nothing selected. So the
sidemenu was always right.

`resolveSaisonId` checked only the shape — four characters after trimming — and passed anything that fit
straight through to the query layer. So `?saison_id=2027` became a real request for a season that does not
exist, every junction read came back empty, and the page rendered that emptiness as fact: no club is in the
season, no matchday exists, the table has no rows. Nothing was reported, because an empty result is a
perfectly ordinary answer to a well-formed question.

The two halves therefore named different seasons on the same screen, and the one the reader trusts — the
selector, which is the control they used to get there — was the one the page ignored.

**A malformed value had the same defect in a quieter form.** `?saison_id=x` degraded to `undefined`, which
means the current season, while the address bar went on claiming `x`. The URL and the page disagreed there
too; only the wrongness was less visible.

## Decision

**`resolveSaisonId` validates the value against the season list, and a value that names no season is
removed from the URL by `redirect()` rather than passed on.** One check, in the one function all sixteen
routes already call, so the agreement holds by construction instead of by sixteen call sites remembering.

**The list is read only when the parameter is present.** An absent `saison_id` returns `undefined` before
anything is fetched, exactly as before.

**The redirect target is a relative, query-only reference** — `?` plus whatever other parameters the URL
carried, or a bare `?` when there were none. A Server Component cannot read its own pathname, and "this
page, one parameter fewer" is precisely what a query-only reference means, so this cannot go stale if a
route moves. Next resolves it against the current document on both paths a `redirect()` can take: the
client router's `new URL(href, location.href)`, and the streamed `<meta http-equiv="refresh">` fallback.

**`replace`, not `push`, which is `redirect()`'s own default outside a Server Action.** Back must not
return to the URL that was just rejected.

## Consequences

**The page and the selector cannot disagree**, because after the redirect the parameter the page reads is
the parameter the selector validated — or there is no parameter and both take the backend's default.

**The address bar stops asserting something false.** A shared or bookmarked link to a season that has since
been removed now lands on the current season with a clean URL, rather than on a page-shaped emptiness.

**The redirect is streamed, on every route.** `cacheComponents` serves each route's prerendered shell with
a 200 before any dynamic code runs, so there is no path on which this can be an HTTP 307 — whether the page
awaits `resolveSaisonId` at its root or inside a `Suspense` boundary, the redirect arrives inside the
stream, as Next's `__next-page-redirect` meta tag plus a client-side `router.replace`, and the shell is on
screen for the moment it takes. Measured against the local stack, 2026-08-08:
`GET /dashboard/spielplan?saison_id=2077` answers 200 carrying
`<meta id="__next-page-redirect" http-equiv="refresh" content="1;url=?">`. **No wrong data is rendered**:
the subtree that would have queried the missing season throws before it returns anything. This is the same
trade `AdminAuthGuard` documents for its own redirect, and for the same reason.

**`SaisonSelector`'s own fallback stays.** It is what the control shows during that streamed window, and it
is what keeps the component correct read on its own. Deleting either check because the other exists
reintroduces the disagreement in one of the two directions.

**A season removed from the list becomes unreachable by URL.** That is the intent — the list is what the
selector offers — but it is worth stating, because it means the season list is now load-bearing for
navigation and not only for a dropdown.

**Why this does not contradict [ADR-0002](0002-omitted-season-means-current.md).** It reads as
a reversal, so the boundary is worth stating exactly. [ADR-0002](0002-omitted-season-means-current.md) removed a lookup from the path where the parameter is
**absent**: `getCurrentSaison()` ran before every page query on eight routes, and the page could not issue
its real request until the answer came back. Its rejected alternative — "keep resolving in the frontend" —
is about _resolving what the current season is_, and this decision does not do that. The default is still
the backend's, still applied in the handler, and `resolveSaisonId` still returns `undefined` for an absent
parameter without fetching anything at all. **That measured path is byte-for-byte unchanged.**

What is added is input validation on a value the user supplied, which ADR-0002 does not address, on the
path where the parameter is present. It costs nothing measurable there either: `getSaisons` is `"use cache"`
and the sidemenu issues the same call on every one of these routes, so the check resolves against a cache
entry the render already has rather than a round trip.

## Alternatives considered

**Validate in each page, where the list is already in hand.** Six admin pages already fetch `getSaisons()`
and could have compared against it locally. Rejected: it fixes six of sixteen routes and leaves the other
ten with the original defect, and it makes correctness a property each new season-scoped page must
re-implement. The bug being fixed _is_ the same reasoning applied in one place and not another; a fix that
spreads the reasoning further is the wrong shape.

**Render an error page for an unknown season, with `notFound()`.** Rejected: it is the disposition
`resolveSaisonIdParam` correctly takes for a `[saison_id]` _segment_, which names the subject of the page,
and the wrong one for a search parameter, which names a preference. A stale link in a message should show
the current season, not a dead end — and [ADR-0002](0002-omitted-season-means-current.md) already
established that an unusable season preference means "the current one".

**Leave the URL alone and merely correct the query.** Half a fix: the page would agree with the selector
while the address bar still named a season neither of them was showing, so the next reload, share or
bookmark reproduces the report.

**Resolve it client-side, in the selector, by rewriting the URL after hydration.** Rejected: the wrong page
has already been requested, rendered and streamed by then, so the reader sees the empty state before it is
corrected — and with JavaScript unavailable it is never corrected at all.
