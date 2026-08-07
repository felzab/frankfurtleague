# ADR-0055 — The undo is a route handler, until Next.js fixes E592

**Status:** Superseded
**Date:** 2026-08-06
**Surface:** frontend
**Supersedes:** —
**Superseded by:** [ADR-0060](0060-an-editors-undo-is-a-route-handler-until-e592-is-fixed.md)
**Source:** The undo offer reporting "An unexpected response was received from the server" while its
write never reached the backend, reproduced by the owner on Next 16.2.12, 16.3.0 and 16.3.1-canary.4.

## Context

**A server action is the right primitive for this mutation, and this ADR does not claim otherwise.**
Next's guidance puts Route Handlers with public APIs, webhooks and non-React clients; a mutation
triggered from the app's own UI is a Server Action, which is what every other admin write here is and
stays. This decision is a deviation forced by a framework bug, and it carries the condition for
reversing it.

**The bug.** Next throws `InvariantError: postponed state should not be provided when fallback params
are provided` — its error **E592** — and the throw site is unambiguous:

```js
if (typeof renderOpts.postponed === 'string') {
  if (fallbackRouteParams) throw new InvariantError('postponed state should not be provided …')
```

Both conditions hold for `/admin/spiele/[spiel_id]` by design. `cacheComponents` prerenders an App
Shell for it — visible as the `◐` sub-entry `next build` prints for that route — which is the
postponed state. It has no `generateStaticParams`, which [ADR-0011](0011-no-generatestaticparams.md)
rules out, so Next builds that shell with fallback params.

**What makes it fire is a cross-route dispatch, and the logs prove it.** The undo offer is raised by a
toast that outlives the page ([ADR-0051](0051-a-voided-result-is-named-before-it-is-lost.md)), so by
the time it is pressed the browser has left the editor. The action is then POSTed to the route it
landed on, and Next re-renders the editor segment it still holds in the router tree:

```
POST /admin/action_required -> 200   bytes: 2       correlation_id: d78bb6cf…
Server Component Crash  route: /admin/spiele/[spiel_id]/page  correlation_id: d78bb6cf…
```

One correlation id across both lines. The assertion fires while the action's response is streaming,
truncating it to **two bytes**, so the client can parse no result and the backend log shows no
`PATCH` at all — the write never happens.

**The save is unaffected, and the asymmetry is the proof.** It is dispatched from the editor itself,
where the params are known, so there are no fallback params and nothing throws. Only a mutation
dispatched from a _different_ route while the dynamic segment sits in the router tree is affected.

**Every configuration lever was tried and is closed:**

| Lever                             | Outcome                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `dynamic = "force-dynamic"`       | Build error — explicitly incompatible with `cacheComponents`                    |
| Per-route PPR opt-out             | Does not exist in 16.3's route segment config                                   |
| `generateStaticParams`            | Forbidden by ADR-0011, and ineffective — unlisted ids still get fallback params |
| Disabling `cacheComponents`       | Would break all twelve `"use cache"` reads                                      |
| Uncaching `getSpiel`              | Shipped and **disproven** by retest; reverted                                   |
| Next 16.3.0, then 16.3.1-canary.4 | Both retested by the owner; unchanged                                           |

## Decision

**The match edit's undo is a route handler: `POST /api/admin/spiele/undo`.** A route handler renders
no page tree, so the invariant has nothing to fire on. Nothing else about the undo changes — the same
payloads in the same order, the same refusal semantics, the same reported outcome.

**Every other admin mutation stays a server action.** This is one endpoint, chosen because it is the
only mutation dispatched from a route other than the one that raised it.

**Revert it when E592 is fixed upstream.** That is the condition, and it is named at the call site and
in the handler so neither can be changed without meeting it.

Three details the shape forces:

- **`revalidateTag(tag, { expire: 0 })`, never `updateTag`.** The latter is server-action-only and
  throws in a handler. The second argument is how much staleness a reader may still be served, and an
  undo tolerates none.
- **The handler guards itself.** `proxy.ts` matches `/admin/:path*` and does not reach `/api`, so its
  own `getAdminSession()` is the only control — exactly as it was inside the action, which the proxy
  also exempts from redirects. A `Sec-Fetch-Site` check mirrors `api/client-error`.
- **`runAdminAction` becomes `runAdminMutation`** (`fl_frontend/src/shared/utils/adminMutation.ts`).
  It seeds the correlation scope and maps thrown API errors, and both apply unchanged to a handler —
  part of why this shape was chosen over one that would have needed its own error plumbing. The name
  now describes the mutation rather than the transport.

## Consequences

**The undo can complete.** The response is no longer truncated, so the client reaches the branches it
was always written to handle, including the failure ones that until now were indistinguishable from
the transport dying.

**One admin write no longer reads like the other nine**, which is the real cost. A reader comparing
`actions.ts` with this handler will find the same work in two shapes; the docblocks on both ends and
this ADR are what stop that being read as drift.

**The client loses the typed call and gains a `fetch`.** Argument and result shapes are no longer
checked across the boundary by the compiler, so the request schema is validated with zod in the
handler and the response is narrowed at the call site.

**The rest of the app is untouched** — the save, the preview and the seven reference-data mutations
are still server actions, and `updateTag` is still the rule inside them.

**The same exposure remains on two public routes and is not addressed here.**
`/dashboard/teams/[team_id]` and `/dashboard/spieler/[team_id]` carry the same `◐` sub-entry over
`getTeam`. No mutation is dispatched from another route while either sits in the router tree, so
nothing triggers it today — but an `FE-RSC-001` naming either route is this same bug and needs its own
decision.

**It could not be reproduced outside `/admin`.** Ten harnesses were built — dynamic segment, no
`generateStaticParams`, params inside a `<Suspense>` boundary, the same cached and tagged read, an
admin-shaped layout whose async guard reads a cookie, a `loading.tsx`, explicit `router.prefetch`, and
a full visit-then-`back()` cycle before a cross-route dispatch — and none raised the invariant on the
affected versions. Whatever the final ingredient is, it lives behind the admin sign-in. **This fix is
therefore reasoned from the throw site and the correlation-id evidence rather than from a local
reproduction**, and the owner's retest is what confirms it.

## Alternatives considered

**Keep the server action and accept a broken undo.** Rejected: the undo is the only safety net on a
page that deliberately has no confirmation dialog (ADR-0051), so losing it removes the mechanism that
justified removing the dialog.

**Wait for the upstream fix.** Rejected as a plan rather than as an expectation. It is Next's bug by
its own error text, and it will be fixed — but 16.3.0 and 16.3.1-canary.4 were both retested and are
unchanged, and until then an admin cannot take a save back. The moment it lands, this ADR's revert
condition applies.

**Route every admin mutation through handlers**, for consistency. Rejected: it would trade one
inconsistency for nine deviations from the documented primitive, to work around a bug that affects
exactly one of them.

## See also

- [ADR-0051](0051-a-voided-result-is-named-before-it-is-lost.md) — the undo this restores, and why
  there is no confirmation dialog to fall back on
- [ADR-0011](0011-no-generatestaticparams.md) — why the segment has fallback params at all
- `docs/frontend/spec.md`, invariants I14 and I22 — the `revalidateTag`/`updateTag` split, and this
  failure's signature
