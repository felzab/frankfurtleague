# ADR-0045 — A season's fixtures are created once, so `/spiele` has no POST and no DELETE

**Status:** Accepted
**Date:** 2026-08-05
**Surface:** backend
**Supersedes:** —
**Superseded by:** —
**Source:** My ruling on how a season is scheduled, stated 2026-08-05. Written up because the
constraint was enforced by the absence of two endpoints and recorded nowhere at all.

## Context

**A season's matches are all created at its start.** The whole competition — every group fixture and
every bracket slot — is drawn once, before a ball is kicked. After that a match can be **cancelled**
(`is_canceled`) or **moved to another date** (`datum`), and those two are the entire vocabulary of
change. A match is never deleted, and a new one is never added mid-season.

`/spiele` therefore has exactly two verbs: `PATCH /spiele/{spiel_id}` and the admin-only read
`GET /spiele/action_required`. It is the only resource in the API without a create and without a delete,
and **nothing said why.**

**It has already been misread once.** A reader working from the endpoint table in `docs/backend/spec.md`
§1 found two verbs missing that every other resource has, found no note explaining the absence, and
concluded it was an oversight worth an entry on the roadmap. Nothing in the repository could have
corrected that reading: CLAUDE.md §7 lists the decisions that look wrong and are deliberate, and this
was not among them because no ADR existed to list. The next reader reaches the same conclusion, and one
of them eventually resolves it by adding the endpoint.

The precedent for how this is recorded is already in the same table one row away.
`PATCH /teams/{team_id}/saisons/{saison_id}` carries **`No DELETE` — see I19**, and invariant I19 states
the rule with its reasoning and cites [ADR-0033](0033-one-active-season-and-one-path-to-it.md).

## Decision

**`/spiele` has no `POST` and no `DELETE`, and neither is to be added.** A season's fixtures are created
once, outside the API, and the two legitimate changes to one are already endpoints:
`is_canceled` calls a match off and `datum` moves it.

**The two absences are documented where a reader meets them**: the `/spiele` rows in
`docs/backend/spec.md` §1, invariant I26 beside I19, the glossary's `Spiel` entry, and the `INVARIANTS`
block of `fl_backend/app/api/spiele/admin_router.py`. A constraint enforced by an absence has to be
stated, because an absence looks identical to an omission.

**A cancelled match keeps its row, its number and its place in the bracket.** That is what makes
cancellation different from deletion rather than a soft version of it: the fixture still occupies its
`spiel_nr`, still carries whatever `teamN_quelle` wired it into the draw, and still counts in the league
table if a result was awarded ([ADR-0026](0026-team-statistics-are-derived-from-spiele.md)).

## Consequences

**`spiel_nr` stays dense and stable for a whole season**, which three separate mechanisms rely on.
`teamN_quelle` references a fixture by that number rather than by `_id`, precisely so a bracket can be
drawn before the documents exist ([ADR-0042](0042-a-result-entry-resolves-the-whole-bracket.md)).
`spiele.uniq_saison_id_spiel_nr` makes the number identify one match within a season
(`fl_backend/app/core/constraints.py :: UNIQUE_INDEXES`). And `spieltage.anzahl_spiele` is a stored count
of the matches in a matchday, maintained by hand.

**A `DELETE` would break the bracket silently.** Removing match 25 leaves every `quelle` naming
`spiel_nr: 25` pointing at nothing — and the resolution treats a reference it cannot look up as a typo
and leaves the slot alone (ADR-0042), which is the correct answer to a mistyped number and the wrong one
here. The semi-final would keep whatever team it happened to hold, and nothing would report it.

**A `POST` would need a number nobody can safely choose.** The next free `spiel_nr` in a season is not a
sequence the API owns; the draw assigns it, and a fixture added afterwards is a fixture no bracket wired
in. It would also make `spieltage.anzahl_spiele` a count with a second writer.

**This is not soft deletion, and `spiele` deliberately has no `inactive_since`.** Six collections carry
that field because their rows can be retired ([ADR-0032](0032-soft-deletion-is-a-date-not-a-flag.md)).
A match is not retired: it is played, cancelled, or still to come, and all three are states the document
already expresses. Adding the field would give a match two ways to be absent.

**Correcting a genuine scheduling error means editing the database directly.** If a season is drawn
wrongly, the fix is in Compass, alongside the way seasons are set up in the first place — the same place
`FLSaison.rules` is edited until FB-6 builds a form for it. That is a real cost of this decision and it
is accepted: a mistake in the draw is rare, it is caught before the season runs, and an endpoint that
exists for it would be available every day of the season it must not be used in.

## Alternatives considered

**Add `POST` and `DELETE` for symmetry with every other resource.** The alternative that was actually
proposed, from the endpoint table. Rejected because symmetry is a property of the table, not of the
domain: a match is the one entity here whose whole set is fixed at creation, and an API shaped for
consistency would offer two operations that have no meaning in the competition and one of which breaks
the bracket. Uniform _addressability_ is the principle
[ADR-0034](0034-the-write-path-is-resource-first-in-a-second-router.md) settled — every resource
reachable the same way — and it says nothing about which verbs a resource supports.

**A soft delete, matching the six collections that have one.** Rejected on the grounds above: a
cancelled match is already the domain's answer, it is visible rather than filtered out, and it still
counts where a result was awarded. A second absent state would put `is_canceled` and `inactive_since` in
a position to disagree, which is the shape ADR-0032 refused for a boolean beside a date.

**Leave it undocumented and rely on review to refuse the endpoint.** What was in force until now, and it
already failed once — a reader with the endpoint table in front of them had no way to tell a deliberate
absence from a gap. Review catches it only if the reviewer knows, which is the failure mode CLAUDE.md §7
exists to remove.
