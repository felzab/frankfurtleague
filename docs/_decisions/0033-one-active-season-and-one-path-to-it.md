# ADR-0033 — One active season, one path to it, and a team leaves a season only by disqualification

**Status:** Accepted
**Date:** 2026-08-02
**Surface:** backend
**Supersedes:** —
**Superseded by:** —
**Source:** Open item BE-4, building the write path for the reference collections.

## Context

**"Exactly one season is `active`" is the invariant this system leans on hardest and the one nothing can
enforce.** [ADR-0002](0002-omitted-season-means-current.md) makes an omitted `saison_id` mean the
current season, resolved in the backend handler, so `pull_current_saison` is on the path of most public
traffic: the landing page, every grid, the bracket, the league table. It reads the one document whose
`status` is `active`.

[ADR-0027](0027-the-database-enforces-its-own-invariants.md) gave every collection a `$jsonSchema`
validator and four unique indexes, and this invariant fits neither mechanism. A validator sees one
document at a time, so it can require `status` to be one of three strings and can say nothing about how
many documents hold `"active"`. A unique index on `status` would be worse than useless: it would permit
exactly one `past` season. `app/core/constraints.py` says so at the `saisons` entry, and named BE-4 as
the item that would have to enforce it in code.

Before BE-4 there was no code path that wrote `status` at all — seasons were edited in Compass — so the
invariant was maintained by whoever remembered to demote the old season in the same sitting. A rollover
that set the new season active and forgot the old one leaves two, and `pull_current_saison` then returns
whichever Mongo hands back first.

**The junction raised the mirror-image question.** `saison_teams` is one row per team per season, and
BE-4 was writing a `DELETE` for it by symmetry with every other collection. The owner's decision, taken
2026-08-02: **a team never leaves a season.** Once squads are settled, a club that stops competing is
_disqualified_, which is a recorded fact about that season and not the absence of a row. Deleting the
row would delete the group assignment, the disqualification, and the team's presence in that season's
table — for a season that has already been played.

## Decision

**`POST /saisons/{saison_id}/activate` is the only code path in the system that writes `status`.** It
demotes every season currently holding `active` and promotes the target, in **one transaction**, so
there is no window in which zero or two seasons are active. `status` appears on no payload: not on the
create body, not on the patch body. A created season is always `future`.

**There is no `DELETE /saisons/{id}`.** A season that is over is `past`. Deleting one would orphan every
spiel, spieltag and junction row carrying its id, none of which cascades.

**`saison_teams` has a POST and a PATCH and no DELETE.** `is_disqualified` on the junction row is how a
team leaves a season, and it is the field FB-2 turns into a record carrying a reason and a date.

**`activate_saison` carries no date guard.** It does not check that the outgoing season's matches have
all been played. That check belongs to the admin page that will call it (FB-6), where the operator can
see what is incomplete and decide; refusing at the endpoint would make the one recovery path for a
mis-set `status` conditional on data being tidy.

## Consequences

**The invariant is now enforceable by reading one function.** Anything that wants to know how a season
becomes active reads `activate_saison` and is done. That is the property being bought, and it is why
`status` is kept off the patch payload even though allowing it there would be one less endpoint.

**Creating and activating are deliberately two steps.** A single "create the new season and make it
live" call would turn an ordinary typo in a new season's four-character id into a silent rollover of the
live one — a public-facing failure produced by a form field.

**The transaction is a real requirement, not a precaution.** Demote-then-promote as two writes leaves a
window with no active season, and `pull_current_saison` is on the hot path, so that window is a 500 on
the landing page rather than a race nobody observes.

**FB-6 inherits the operational half.** The admin control for the rollover, the all-games-finished
precondition, and an email reminder so the rollover is not remembered rather than prompted.

**`saison_teams` needs no `inactive_since`**, which is why it is one of the three collections outside
[ADR-0032](0032-soft-deletion-is-a-date-not-a-flag.md). No row there is ever retired, so
`uniq_saison_id_team_id` is never held by a dead one — which is what lets creating a junction row be a
plain insert, where `saison_spieler` has to offer a reactivate.

## Alternatives considered

**Let `PATCH /saisons/{id}` write `status` like any other field.** Rejected. It is the smaller API and
it puts the invariant back where it was: maintained by whoever remembers the second call. Two seasons
active is not a validation error at any single write — each individual patch is legal — so nothing would
catch it until a page rendered the wrong season.

**A partial unique index on `{status: "active"}`.** The database-level answer, and it very nearly works:
MongoDB supports a unique index with `partialFilterExpression`. Rejected because it enforces _at most_
one rather than _exactly_ one, it cannot make the demote-and-promote atomic — a rollover would have to
demote first and would still open the zero-active window — and it turns a legitimate rollover into a
duplicate-key error at the moment the operator is least able to interpret it. The transaction is what
the invariant actually needs; an index would be a second, weaker copy of it.

**A guard that refuses to activate while the outgoing season has unplayed matches.** Rejected for the
endpoint and kept for FB-6's UI. At the endpoint it is a rule with no override, and the one case where
someone genuinely needs to activate a season is when the data is _not_ in the state the rule assumes.

**A `DELETE` on `saison_teams`, by symmetry with the other collections.** Rejected by the owner. The
symmetry is superficial: every other collection's delete retires a _thing_, while this one would erase a
_fact about a season that has been played_. Disqualification is the real operation and it already
existed as a field.
