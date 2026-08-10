# ADR-0049 — Every page-owned editor's undo is a route handler, until Next.js fixes E592

**Status:** Accepted\
**Date:** 2026-08-07\
**Surface:** frontend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** The squad editor raising the third handler on 2026-08-07. The diagnosis dates to
2026-08-06, when the match editor's undo first failed (retired decisions recorded the
one- and two-handler boundaries this decision replaced).

## Context

**A server action is the right primitive for these mutations, and this ADR does not claim
otherwise.** Next's guidance puts Route Handlers with public APIs, webhooks and non-React clients;
a mutation triggered from the app's own UI is a Server Action, which is what every other admin
write here is and stays. This decision is a deviation forced by a framework bug, and it carries the
condition for reversing it.

**The bug.** Next throws `InvariantError: postponed state should not be provided when fallback
params are provided` — its error **E592** — and the throw site is unambiguous:

```js
if (typeof renderOpts.postponed === 'string') {
  if (fallbackRouteParams) throw new InvariantError('postponed state should not be provided …')
```

Both conditions hold for the page-owned editors' dynamic segments by design. `cacheComponents`
prerenders an App Shell for each — visible as the `◐` sub-entry `next build` prints for the route —
which is the postponed state. And none has `generateStaticParams`, which the frontend spec rules
out (`docs/frontend/spec.md :: I28`), so Next builds that shell with fallback params.

**What makes it fire is a cross-route dispatch, and the logs prove it.** The undo offer is raised
by a toast that outlives the page
([ADR-0041](0041-a-voided-result-is-named-before-it-is-lost.md)), so by the time it is pressed the
browser has left the editor. A server action is then POSTed to the route it landed on, and Next
re-renders the editor segment it still holds in the router tree:

```
POST /admin/action_required -> 200   bytes: 2       correlation_id: d78bb6cf…
Server Component Crash  route: /admin/spiele/[spiel_id]/page  correlation_id: d78bb6cf…
```

One correlation id across both lines. The assertion fires while the action's response is
streaming, truncating it to **two bytes**, so the client can parse no result and the backend log
shows no `PATCH` at all — the write never happens.

**The save is unaffected, and the asymmetry is the proof.** It is dispatched from the editor
itself, where the params are known, so there are no fallback params and nothing throws. Only a
mutation dispatched from a _different_ route while the dynamic segment sits in the router tree is
affected.

**Every configuration lever was tried and is closed:**

| Lever                             | Outcome                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `dynamic = "force-dynamic"`       | Build error — explicitly incompatible with `cacheComponents`                                                     |
| Per-route PPR opt-out             | Does not exist in 16.3's route segment config                                                                    |
| `generateStaticParams`            | Ruled out by the spec (`docs/frontend/spec.md :: I28`) — and ineffective: unlisted ids still get fallback params |
| Disabling `cacheComponents`       | Would break all twelve `"use cache"` reads                                                                       |
| Uncaching `getSpiel`              | Shipped and **disproven** by retest; reverted                                                                    |
| Next 16.3.0, then 16.3.1-canary.4 | Both retested; unchanged                                                                                         |

**It could not be reproduced outside `/admin`.** Ten harnesses were built — dynamic segment, no
`generateStaticParams`, params inside a `<Suspense>` boundary, the same cached and tagged read, an
admin-shaped layout whose async guard reads a cookie, a `loading.tsx`, explicit `router.prefetch`,
and a full visit-then-`back()` cycle before a cross-route dispatch — and none raised the invariant
on the affected versions. Whatever the final ingredient is, it lives behind the admin sign-in. The
fix is therefore reasoned from the throw site and the correlation-id evidence rather than from a
local reproduction, and the retest against the deployed fix is what confirmed it.

**The boundary widened in three steps, each recorded at the time.** First one handler, for the
match editor — then the only mutation dispatched from a route other than the one that raised it.
Then a second, when the club editor shipped: its save can destroy something only the client still
holds — a lifted disqualification's reason and date have no other copy anywhere (ADR-0047, and the
history that would hold one is roadmap item BE-15). The squad editor was the third, and it is the
step that turned a count into a pattern: its save destroys less — a player's team, number, position
and stufe are short values an admin can retype — but the offer is not there because the save is
dangerous. It is there because the editors are one interaction, and an admin who has learned that a
save can be taken back on two of them will believe it on the third.

## Decision

**Every page-owned editor's undo is a route handler, one per resource.** At this decision the set
is `POST /api/admin/saisons/undo`, `POST /api/admin/spiele/undo`, `POST /api/admin/spieler/undo`
and `POST /api/admin/teams/undo` — one per page-owned editor that exists, and a new page-owned
editor may add its own without superseding this ADR.

**The boundary is the PATTERN, not a count: an undo belongs to a page-owned editor
([ADR-0040](0040-a-form-that-outgrows-a-dialog-becomes-a-page.md)), and nothing else becomes a
route handler.** Every other admin write is and stays a server action. A dialog, a row control or a
bulk action may not have one, whatever it would gain — "page-owned editor" is a structural fact
about a route, not a judgement call.

**The handler contract, common to all of them:**

- `revalidateTag(tag, { expire: 0 })`, never `updateTag`, which is server-action-only and throws in
  a handler. The second argument is how much staleness a reader may still be served, and an undo
  tolerates none.
- The handler guards itself with `getAdminSession()` and a `Sec-Fetch-Site` check — `proxy.ts`
  matches `/admin/:path*` and does not reach `/api`, so the handler's own guard is the only
  control.
- The body runs inside `runAdminMutation`
  (`fl_frontend/src/shared/utils/adminMutation.ts`), so the correlation scope and the error mapping
  are the action's own.
- The client holds every payload, because no admin write is recorded anywhere (BE-15); the offer is
  bounded to one page session.
- The invalidation is the same tag set the editor's save uses, because an undo is a write.
- **nginx must route the path to the frontend.** `/api` proxies to FastAPI, so a handler under it
  reaches the wrong service and 404s — which the client reports as a transport failure naming
  nothing. The third handler shipped without its block and did exactly that; both configs now carry
  one `location /api/admin/` prefix covering every handler present and future, which is safe
  because every backend route is mounted under `/api/v{API_VERSION}/`.

**Revert every handler to a server action when E592 is fixed upstream.** The condition is named at
every call site and in every handler, so none can be changed without meeting it.

## Consequences

**A family of admin writes reads differently from every other server action**, which is the real
cost, paid once per editor. The mitigation: the docblocks at both ends of each pair name this ADR,
and the handlers are deliberately the same shape, so a reader who has understood one has understood
all of them.

**Replacing the count with a pattern removes a forcing function.** The earlier per-handler boundary
guaranteed someone would look at each widening. What replaces it is a narrower rule that is harder
to satisfy by accident: whether a route is a page-owned editor is decidable by reading it.

**The revert grows with each editor.** Whenever E592 is fixed, every handler and every call site
comes out. Each is small and each names the condition; the risk is that one is missed, which is why
the handlers are enumerated in `docs/frontend/spec.md` (invariant I14), which is maintained as the
set changes.

**The client loses the typed call and gains a `fetch`.** The compiler checks neither the argument nor
the result shape across that boundary, so the request schema is validated with zod in the handler and
the response is narrowed at the call site.

**The editors get no confirmation dialog**, for ADR-0041's reason: undo and confirmation are
alternatives, and undo is the one that helps the admin who was not paying attention.

**The same exposure remains on two public routes and is not addressed here.**
`/dashboard/teams/[team_id]` and `/dashboard/spieler/[team_id]` carry the same `◐` sub-entry over
`getTeam`. No mutation is dispatched from another route while either sits in the router tree, so
nothing triggers it today — but an `FE-RSC-001` naming either route is this same bug and needs its
own decision.

## Alternatives considered

**Keep the server action and accept a broken undo.** Rejected: the undo is the only safety net on
pages that deliberately have no confirmation dialog (ADR-0041), so losing it removes the mechanism
that justified removing the dialog.

**Wait for the upstream fix.** Rejected as a plan rather than as an expectation. It is Next's bug
by its own error text, and it will be fixed — but 16.3.0 and 16.3.1-canary.4 were both retested and
are unchanged, and until then an admin cannot take a save back. The moment it lands, the revert
condition applies.

**Dispatch the server action anyway and hope the segment is not held.** Rejected: the logs show the
failure is deterministic for this dispatch shape, and a sometimes-working undo is worse than none —
the admin learns to trust it exactly until it truncates.

**Route every admin mutation through handlers**, for consistency. Rejected: it would trade one
deviation family for a wholesale departure from the documented primitive, to work around a bug that
affects exactly the cross-route dispatch shape.

**Stop at one handler, or at two — the earlier boundaries.** Each held until the next page-owned
editor shipped, and re-arguing the widening per editor produced the same answer each time: an undo
that exists on some editors and not others is a feature the admin cannot rely on, which is close to
the "sometimes-working undo" rejected above. The pattern boundary records that answer once.

**One generic `/api/admin/undo` for all editors.** Rejected: the undos replay different payload
shapes through different mutations with different invalidation sets, and a shared handler would be
a `switch` over resource types. Small handlers that each mirror their editor are easier to hold to
their editor's semantics and easier to delete together when the revert condition arrives.
