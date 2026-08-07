# ADR-0062 — Every page-owned editor's undo is a route handler, until Next.js fixes E592

**Status:** Accepted
**Date:** 2026-08-07
**Surface:** frontend
**Supersedes:** [ADR-0060](0060-an-editors-undo-is-a-route-handler-until-e592-is-fixed.md)
**Superseded by:** —
**Source:** The owner's decision of 2026-08-07, taken when FB-3's spieler half raised the third
handler as ADR-0060 requires.

## Context

[ADR-0055](0055-the-undo-is-a-route-handler-until-e592-is-fixed.md) diagnosed **E592**: an undo offer
is a toast that outlives the page that raised it, so the mutation is dispatched from a different
route while the editor's dynamic segment still sits in the router tree, and Next then combines that
segment's postponed shell with fallback params, asserts that impossible, and truncates the response
mid-stream. The diagnosis, the closed configuration levers and the failed reproductions are that
ADR's and are not restated.

[ADR-0060](0060-an-editors-undo-is-a-route-handler-until-e592-is-fixed.md) widened the boundary from
one handler to two, for the club editor, and drew an explicit line: **a third does not become a route
handler without superseding it.** FB-3's squad editor is the third. It is the same shape as the other
two — a page-owned editor (ADR-0050) that saves, offers Rückgängig in a toast, and leaves — so the
question the line exists to force is now in front of someone.

Two facts decide it, and they point in opposite directions. Against a third handler: the squad
editor's save destroys less than the club editor's did. A lifted disqualification's reason and date
have no other copy anywhere, whereas a player's team, number, position and stufe are short values an
admin can retype, and the two genuinely destructive acts on this surface — retiring the person,
retiring the squad row — are soft and already reversible by their own endpoints, which preserve the
number and position by design (ADR-0032). For a third handler: the offer is not there because the
save is dangerous, it is there because the three editors are one interaction, and an admin who has
learned that a save can be taken back on two of them will believe it on the third.

## Decision

**Every page-owned editor's undo is a route handler, one per resource**, and the set is now
`POST /api/admin/spiele/undo`, `POST /api/admin/teams/undo` and `POST /api/admin/spieler/undo`. The
owner takes consistency across the three editors over the narrower boundary ADR-0060 drew: an undo
that exists on two of three surfaces is a feature the admin cannot rely on, which is close to the
"sometimes-working undo" ADR-0055 rejected for a different reason.

**Everything ADR-0055 forced still holds, and remains the contract for any handler under this ADR:**

- `revalidateTag(tag, { expire: 0 })`, never `updateTag`, which is server-action-only and throws.
- The handler guards itself with `getAdminSession()` and a `Sec-Fetch-Site` check — `proxy.ts` does
  not reach `/api`.
- The body runs inside `runAdminMutation`, so the correlation scope and the error mapping are the
  action's own.
- The client holds every payload, because no admin write is recorded anywhere (BE-15); the offer is
  bounded to one page session.
- The invalidation is the same tag set the editor's save uses, because an undo is a write.

**The boundary is now the PATTERN rather than a count: an undo belongs to a page-owned editor, and
nothing else becomes a route handler.** Every other admin write is and stays a server action. A
fourth page-owned editor may have one without superseding this ADR; a dialog, a row control or a
bulk action may not, whatever it would gain.

**Revert all three when E592 is fixed upstream.** The condition is unchanged from ADR-0055 and is
named at every call site and in every handler.

## Consequences

**Three admin writes now read differently from every other server action**, which is ADR-0055's cost
tripled and ADR-0060's increased by half. The mitigation is unchanged and is now doing more work: the
docblocks at both ends of each pair name this ADR, and the three handlers are deliberately the same
shape, so a reader who has understood one has understood all three.

**Replacing the count with a pattern removes the forcing function ADR-0060 relied on.** That was the
point of a count — it guaranteed someone would look. What replaces it is a narrower rule that is
harder to satisfy by accident: "page-owned editor" is a structural fact about a route, not a
judgement call, and there are three of them.

**The revert grows.** Whenever E592 is fixed, three handlers and three call sites come out instead of
two. Each is small and each names the condition; the risk is that one is missed, which is why the
handlers are enumerated in this Decision and in `docs/frontend/spec.md`.

**The squad editor gets no confirmation dialog**, for ADR-0051's reason, consistent with the other
two: undo and confirmation are alternatives, and undo is the one that helps the admin who was not
paying attention.

## Alternatives considered

**No undo on the squad editor; keep ADR-0060's boundary at two.** The assistant's recommendation, and
the owner overruled it (2026-08-07). The argument for it was that this editor's save destroys nothing
without another copy — every junction field is short and retypeable, and both retirements are already
reversible. The argument that beat it: the undo's job is not proportional to the damage, it is to
make the three editors behave alike, and a Rückgängig that appears on two surfaces and not the third
teaches the wrong lesson about all three.

**One generic `/api/admin/undo` for all three.** Rejected again, on ADR-0060's reasoning unchanged:
the three undos replay different payload shapes through different mutations with different
invalidation sets, and a shared handler would be a `switch` over resource types. Three small handlers
that each mirror their editor are easier to hold to their editor's semantics and easier to delete
together.

**Wait for the upstream fix and ship the squad editor without an undo in the meantime.** Rejected:
that is the same trade as the first alternative with an unbounded delay attached, and the mechanism
is already built twice.

## See also

- [ADR-0055](0055-the-undo-is-a-route-handler-until-e592-is-fixed.md) — the diagnosis, the closed
  levers, and the original one-handler boundary
- [ADR-0060](0060-an-editors-undo-is-a-route-handler-until-e592-is-fixed.md) — the two-handler
  boundary this replaces, and the club editor's case
- [ADR-0051](0051-a-voided-result-is-named-before-it-is-lost.md) — why an undo rather than a
  confirmation dialog
- [ADR-0050](0050-a-form-that-outgrows-a-dialog-becomes-a-page.md) — what makes an editor
  page-owned, which is the boundary this ADR now draws
