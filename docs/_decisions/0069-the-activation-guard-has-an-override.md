# ADR-0069 — The activation guard stays on the endpoint, because cancelling a fixture is its override

**Status:** Accepted\
**Date:** 2026-08-13\
**Surface:** backend\
**Supersedes:** ADR-0026\
**Superseded by:** —\
**Source:** The A5 domain-refusals review found `REQ-ACTIVATE-001` implementing the guard ADR-0026 rejected, with no superseding record; owner decision, 2026-08-13.

## Context

[ADR-0026](0026-one-active-season-and-one-path-to-it.md) settled how a season becomes active, and
rejected one alternative in particular:

> **A guard that refuses to activate while the outgoing season has unplayed matches.** Rejected for
> the endpoint and kept for FB-6's UI. At the endpoint it is a rule with no override, and the one
> case where someone genuinely needs to activate a season is when the data is _not_ in the state the
> rule assumes.

On 2026-08-08 that guard was implemented at that endpoint anyway, as `REQ-ACTIVATE-001` in
`fl_backend/app/api/saisons/services.py :: find_activation_refusal`, called from
`fl_backend/app/api/saisons/admin_router.py :: activate_saison`. Nothing recorded the reversal. Two
further copies of the old position survived alongside the new code: an `UNENFORCED` entry in
`fl_backend/app/core/domain.py` declaring the state permitted, in the same module whose `RULES`
tuple declared it refused, and `docs/logging/error-codes.md` citing ADR-0026 as the guard's
authority — the decision that had rejected it.

**The rejection rested on a factual premise, and the premise was false.** ADR-0026 reasoned that at
the endpoint the guard would be "a rule with no override". There is an override, and the refusal's
own message names it: _"enter their results or cancel them before closing the season"_. Cancelling a
fixture is an ordinary admin action, it is what an abandoned or unplayable match already receives,
and a cancelled fixture leaves the unplayed set — so the operator who genuinely needs to roll a
season over across incomplete data has a supported route to it that does not involve editing the
database by hand.

## Decision

**Everything ADR-0026 decided stands, except its rejection of the activation guard.** Restated here
in full, because this record replaces it:

**`POST /saisons/{saison_id}/activate` is the only code path in the system that writes `status`.** It
demotes every season currently holding `active` and promotes the target, in **one transaction**, so
there is no window in which zero or two seasons are active. `status` appears on no payload: not on
the create body, not on the patch body. A created season is always `future`.

**There is no `DELETE /saisons/{id}`.** A season that is over is `past`. Deleting one would orphan
every spiel, spieltag and junction row carrying its id, none of which cascades.

**`saison_teams` has a POST and a PATCH and no DELETE.** A disqualification record on the junction
row is how a team leaves a season ([ADR-0047](0047-a-disqualification-is-a-record-and-its-absence-is-the-null.md)).

**`activate_saison` refuses a rollover while the outgoing season holds a fixture that is neither
played nor cancelled** (`REQ-ACTIVATE-001`). The admin page keeps presenting the count and disabling
the control, so the refusal is visible before the request; the endpoint is what makes it true.

**A guard with a real escape is acceptable, and a guard without one is not.** That is the test this
record puts in place of ADR-0026's premise, and it is the test to apply to the next refusal
somebody proposes at a recovery endpoint.

## Consequences

**The recovery path ADR-0026 protected is one step longer, not closed.** Rolling a season over
across incomplete data now takes cancelling those fixtures first. That is a real cost and it is
paid deliberately: the cancellation is a record of what happened to those matches, where activating
over them silently left a `past` season whose derived table counts fixtures nobody ever resolved.

**The escape is only as good as the cancel path.** If cancelling a fixture ever becomes conditional
on something the disqualified or abandoned case cannot satisfy, this decision's premise fails the
same way ADR-0026's did. `REQ-CLASH-001` already judges a fixture being cancelled against the same
double-booking rule as any other edit, which is a narrower version of exactly that risk.

**`UNENFORCED` remains the one declaration in `fl_backend/app/core/domain.py` with no executable
counterpart.** `fl_backend/tests/core/test_domain.py` resolves every rule, reference and field
policy against real code and checks an `Unenforced` row only for a non-empty reason, which is why a
false entry survived from 2026-08-08 to 2026-08-13 in a file that was edited in between. Nothing in
this decision changes that; it is named here because it is the mechanism that hid the contradiction
rather than a detail of it.

## Alternatives considered

**Leave ADR-0026 standing and remove the guard from the endpoint.** The other way to end the
contradiction, and it was live until this decision. Rejected: the guard is doing real work.
Demoting a season to `past` freezes its competitive rules
([ADR-0019](0019-team-statistics-are-derived-from-spiele.md)) and makes its derived table the record
of what happened, so a rollover across unresolved fixtures publishes a final table for a
competition that never finished. That argument was not available to ADR-0026, which was written
before the table's derivation was settled.

**Record the narrowing as a carve-out in the stamped spec pages, leaving ADR-0026 `Accepted`.** The
lighter mechanism, and the right one where an ADR's scope is merely being read more precisely.
Rejected: this is not a reading of ADR-0026's scope but a reversal of a named alternative inside it.
A reader arriving at ADR-0026's last paragraph would find the guard rejected in the present tense
with nothing on the page to say otherwise, which is the failure DEC-6 exists to prevent.

**Keep the `UNENFORCED` entry and treat it as recording a database-level hole rather than an API
one.** Considered because three of the eight entries do read that way. Rejected: neither the
database nor the API permits the state, so the entry is false under both readings, and giving the
tuple two jobs would make every other entry ambiguous about which one it is doing.
