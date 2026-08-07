# ADR-0060 — An editor's undo is a route handler, until Next.js fixes E592

**Status:** Superseded by [ADR-0062](0062-every-page-owned-editors-undo-is-a-route-handler.md)
**Date:** 2026-08-07
**Surface:** frontend
**Supersedes:** [ADR-0055](0055-the-undo-is-a-route-handler-until-e592-is-fixed.md)
**Superseded by:** [ADR-0062](0062-every-page-owned-editors-undo-is-a-route-handler.md)
**Source:** The owner's instruction of 2026-08-07: the club editor gets the same Rückgängig offer as
the match editor, through the same mechanism, documented as the deviation it is and reverted when the
upstream bug is fixed.

## Context

[ADR-0055](0055-the-undo-is-a-route-handler-until-e592-is-fixed.md) established why an undo cannot be
a server action while Next's **E592** stands: the offer is a toast that outlives the page that raised
it, so the action is dispatched from a different route while the editor's dynamic segment still sits
in the router tree — and Next then combines that segment's postponed shell with fallback params,
asserts that impossible, and truncates the action's response mid-stream. The full diagnosis, the
closed configuration levers and the failed reproduction attempts live in that ADR and are not
restated here.

ADR-0055 also drew a boundary: one endpoint, because the match edit's undo was _the only_ mutation
dispatched from a route other than the one that raised it. FB-3's club editor ends that premise. It
saves and leaves exactly as the match editor does, its save can destroy something only the client
still holds — a lifted disqualification's reason and date have no other copy anywhere (ADR-0059, and
the history that would hold one is roadmap item BE-15) — and its undo offer therefore rides the same
kind of toast, pressed after the page is gone.

## Decision

**Each page-owned editor's undo is a route handler, one per resource:** `POST /api/admin/spiele/undo`
(ADR-0055's) and `POST /api/admin/teams/undo`. The owner accepts the second deviation knowingly: a
server action remains the right primitive and remains broken for this dispatch shape, and a working
undo on the club editor is worth more than the pattern's purity.

**Everything ADR-0055 forced carries over unchanged, and is the contract for any handler under this
ADR:**

- `revalidateTag(tag, { expire: 0 })`, never `updateTag`, which is server-action-only and throws.
- The handler guards itself with `getAdminSession()` and a `Sec-Fetch-Site` check — `proxy.ts` does
  not reach `/api`.
- The body runs inside `runAdminMutation`, so the correlation scope and the error mapping are the
  action's own.
- The client holds every payload, because no admin write is recorded anywhere (BE-15); the offer is
  bounded to one page session.
- The invalidation is the same tag set the editor's save uses, because an undo is a write.

**The boundary moves by one and no further: a THIRD admin mutation does not become a route handler
without superseding this ADR.** Every other admin write is and stays a server action.

**Revert both when E592 is fixed upstream.** The condition is unchanged from ADR-0055 and is named at
both call sites and in both handlers.

## Consequences

**Two admin writes now read differently from the other server actions**, which doubles ADR-0055's
stated cost. The mitigation is the same: the docblocks at both ends name this ADR, and the two
handlers are deliberately the same shape, so a reader who has understood one has understood both.

**The club editor's save needs no confirmation dialog**, for ADR-0051's reason: undo and confirmation
are alternatives, and the editor now has the one that helps the admin who was not paying attention —
including the only destructive case its save has, the lifted disqualification.

**ADR-0055's diagnosis remains the record of the bug.** This ADR supersedes its boundary, not its
evidence; a future reader chasing E592 starts there.

## Alternatives considered

**Wait for the upstream fix before offering the club undo.** The assistant's recommendation, and the
owner overruled it (2026-08-07): the mechanism exists, its pitfalls are already mapped, and the club
editor's lifted-disqualification case is precisely a destroyed record only the undo can bring back.

**Dispatch the server action anyway and hope the segment is not held.** Rejected: ADR-0055's logs
show the failure is deterministic for this dispatch shape, and a sometimes-working undo is worse than
none — the admin learns to trust it exactly until it truncates.

**One generic `/api/admin/undo` for both editors.** Rejected: the two undos replay different payload
shapes through different mutations with different invalidation sets, and a shared handler would be a
`switch` over resource types — two small handlers that each mirror their editor are easier to hold to
their editor's semantics, and easier to delete when the revert condition arrives.

## See also

- [ADR-0055](0055-the-undo-is-a-route-handler-until-e592-is-fixed.md) — the diagnosis, the closed
  levers, and the original boundary this widens
- [ADR-0051](0051-a-voided-result-is-named-before-it-is-lost.md) — why an undo rather than a
  confirmation dialog
