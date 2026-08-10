# ADR-0034 — A bracket slot stores a structural reference, and a result entry resolves the whole bracket

**Status:** Accepted\
**Date:** 2026-08-05\
**Surface:** backend, frontend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** Open items BE-9 and FB-4. BE-9's subject was the "TBD" placeholder team, and its stated
hard part was where the bracket slot's label would live once the team reference could be null; FB-4's
part 1 established what feeds a bracket slot, and its part 2 is the resolution workflow. A retired
decision recorded the slot model alone on 2026-08-05, before FB-4's ruling settled the shape of
the reference; this decision carries both halves.

## Context

An unresolved playoff opponent was a **real `teams` document** named "TBD" carrying
`is_placeholder: true`, with a `saison_teams` junction row per season. It worked, and it cost in four
places: the junction row nothing prompted anyone to create, whose absence dropped the placeholder out
of that season's team queries because the join is strict; a two-character shorthand `"??"` invented for
a non-team; an exemption in `PATCH /teams/{team_id}`; and a free-text mechanism in the edit form so
each bracket slot could read something other than "TBD".

**The measurement that constrained the answer.** On 2026-08-02, matches 29, 30 and 31 held
`team1.name` values reading `"Sieger 25."`, `"Sieger 26."` and `"Sieger 29."` while the `teams`
document all three referenced read `"TBD"`. The embedded field was doing double duty: a display copy of
`teams.name` on every other match, and a bracket slot label on those three — a label that existed
nowhere else in the database. Nulling the reference deletes it, so "make the reference nullable" is
only half a decision.

That double duty had already forced a hole in an invariant.
[ADR-0021](0021-store-what-was-true-then-derive-what-is-true-now.md) rule 3 obliges the endpoint that
can change a source to fan a rename into every embedded copy of it, and `patch_team` had to read the
team document first purely to decide whether it was allowed to write `team1.name` — because for one
club that field held something a fan-out would destroy.

The placeholder team, its junction rows and `is_placeholder` were hard-deleted in the change that
landed the slot model, reversing neither [ADR-0025](0025-soft-deletion-is-a-date-not-a-flag.md) nor
[ADR-0026](0026-one-active-season-and-one-path-to-it.md): nothing referenced the document,
`inactive_since` means the day a **club** left the league and the placeholder was never a club, and
ADR-0026 forbids a DELETE **endpoint**, which a one-off hand operation is not.

With the slot modelled as absent, **nothing filled it when a result arrived**. Season 2026 ran two
quarter-finals — matches 25 and 28 — whose winners never reached the semi-finals they feed, and the
only way to move them was to type each team into the admin form by hand.

**The domain fact that decides the shape, and it is my ruling closing FB-4's part 1:** the
first knockout round is **always** seeded from the group phase, and every round after it is fed by
exactly two matches of the round before. There is no third way for a slot to be filled. Until that
ruling, the shape of the reference was deliberately left open — a match-fed reference cannot express a
group placing, and choosing it early would have answered FB-4's question by accident.

**Nothing else records the bracket's edges.** `spieltage.order_val` orders the rounds and says nothing
about who feeds whom, and position within a round is not the answer either: match 29 is fed by 25 and
27, not by 25 and 26, so the index arithmetic that draws the connecting lines in `PlayoffsView`
describes the geometry and not the topology.

Two constraints were already in force and shaped what follows:

- **A `$jsonSchema` validator may assert types, presence and enums and nothing else**
  ([ADR-0020](0020-the-database-enforces-its-own-invariants.md)), so no cross-field rule about these
  fields can live in the database. Matches are still hand-created in Compass, so a rule enforceable
  only in Pydantic fails on **read**, which takes a public page down rather than refusing a bad write.
- **The Zod mirror is compared against the published document on nullability**
  ([ADR-0033](0033-the-zod-mirror-is-checked-against-the-published-document.md)), which names this
  exact edit as the case it was proved against.

## Decision

**Model the unknown opponent as absent, and give the slot its own record of where its occupant comes
from — a structural reference beside the team, never inside it.**

```python
class FLSpiel(BaseModel):
    team1: FLSpielTeamField | None
    team2: FLSpielTeamField | None
    team1_quelle: FLSpielQuelle | None
    team2_quelle: FLSpielQuelle | None
```

**`quelle` is provenance, not a placeholder.** It answers "where does this side of the fixture come
from", which is a fact about the **fixture** — so it is set when the bracket is drawn, it stays true
once the winner is written into the slot, it is never derived, never fanned out into, and never
written or cleared by the resolution below.

**The reference is structural, and the German label is derived from it.** `FLSpielQuelle` is a tagged
union with exactly two variants, discriminated on `type`:

| Variant  | Shape                       | Means                                                |
| -------- | --------------------------- | ---------------------------------------------------- |
| `gruppe` | `{type, gruppe, platz}`     | The team finishing `platz` in `gruppe`               |
| `spiel`  | `{type, spiel_nr, ausgang}` | The side that came out of match `spiel_nr` as winner |

**The discriminator is English and everything else is German.** `type` names the shape of the object
rather than anything in the competition, which is the same line `format` already draws on the teams
response. `gruppe`, `platz`, `spiel_nr`, `ausgang` and the values `sieger` / `verlierer` are domain
vocabulary and are defined in `docs/glossary.md`.

**The label exists in exactly one place and is never stored.**
`fl_frontend/src/features/spiele/utils.ts :: formatQuelle` turns a reference into
`"Sieger 25."` or `"Gruppensieger A"`. No German crosses the wire for a bracket slot, and there is no
second copy of the fact to drift.

**A reference is by `spiel_nr`, not by `_id`.** A bracket is drawn by match number, the number is unique
within a season (`fl_backend/app/core/constraints.py :: UNIQUE_INDEXES`), and an id would make the draw
depend on which documents already exist.

**Nothing pairs the team and its reference, and no rule may be added to.** All four combinations are
meaningful:

| `team1` | `team1_quelle` | Means                                              |
| ------- | -------------- | -------------------------------------------------- |
| set     | null           | An ordinary group-phase fixture                    |
| set     | set            | A resolved bracket slot — the winner of match 25   |
| null    | set            | An unresolved bracket slot — "Sieger 25.", derived |
| null    | null           | An opponent nobody has entered yet — "Noch offen"  |

**Every reader takes the team's own text first, then the label derived from the reference, then the
shared placeholder**, and branches on nothing else.
`fl_frontend/src/features/spiele/components/ui/SpielTeamSlot.tsx` is that rule for the three match
cards, which stay separate ([ADR-0005](0005-three-spiel-cards-stay-separate.md)).

**There is no placeholder team.** An unresolved opponent is never impersonated by a `teams` document:
no `is_placeholder` flag, no `"??"` shorthand, no `include_placeholders` parameter and no exemption in
`patch_team` — the rename fan-out is unconditional (ADR-0021, rule 3), because no path under `team1.`
or `team2.` can reach the reference.

**The occupant of a slot IS what its reference names, recomputed in full on every match write.**
`PATCH /spiele/{spiel_id}` resolves the whole of that match's season and writes back every fixture
whose sides disagree with their references, inside the transaction that carries the result itself. A
`spiel` reference resolves to the side that came out of that match; a `gruppe` reference is seeded
from the standings — the single ranking chain and the only-once-final rule it obeys are
[ADR-0035](0035-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md)'s.

**Recomputed, never appended to.** A corrected result moves the right team in; a deleted one empties the
slot again; a bracket nobody propagated resolves itself on the next save of any match in the season.
Running the resolution twice writes nothing the second time.

**A fixture whose occupant changes loses its own result.** The goals stored against it belong to a
side the fixture does not hold, so both sides' `tore`, the `ergebnis` and the shoot-out record beside it
([ADR-0036](0036-a-shoot-out-is-its-own-scoreline.md)) go with the occupant — and the fixture then has
no winner, which carries the correction onward to whatever it feeds.

**A reference that cannot be looked up leaves the fixture alone.** A `spiel_nr` the season has no match
for, or a chain of references that closes on itself, is a data-entry mistake in stored data, and
erasing a team over one would destroy more than it reports. This is the one place the rule is not "the
reference owns the slot", and the distinction is deliberate: _a match that exists and has no winner
yet_ genuinely means the slot is empty, while _a number nobody can resolve_ means nothing at all. The
full taxonomy of these faults and how they are reported is
[ADR-0039](0039-a-bracket-fault-is-derived-on-demand.md)'s.

**Manual override is the null, and there is no override flag.** A slot with a `quelle` is maintained by
the resolution and by nothing else — a team entered by hand against it is refused by the write path
([ADR-0038](0038-the-write-path-refuses-wiring-the-season-cannot-hold.md)). A slot whose `quelle` is
`null` is the admin's, and nothing writes it. That single rule is the whole manual-override story.

**The endpoint reports what it moved.** `FLPatchSpielDataResponse.advanced_to` carries one entry per
bracket fixture whose sides the result entry resolved, and the admin's toast names them. It reports
what happened rather than what was asked for, so a fixture that was _emptied_ is named as readily as
one that was filled — which is why the copy reads "aktualisiert" and not "eingetragen".

## Consequences

**A match edit can rewrite matches the admin did not open.** The first save of any match in season 2026
fills both outstanding semi-final slots. That is the point, and `advanced_to` is what stops it being a
surprise.

**`patch_spiel_data` now reads the collection, so a malformed document anywhere in the season fails an
unrelated edit.** `FLSpielListAdapter.validate_python` over the season aborts the transaction and takes
the admin's own edit with it. The same class of exposure `GET /teams` already accepts, and it surfaces a
document that would break the public bracket anyway.

**It is not a one-document write any more, and it is still one transaction.** A bracket resolved against
a result the caller never committed would be worse than one that did not resolve.

**The database validator checks the reference's shape and cannot check its variant.** `$jsonSchema`
requires `type` alone, because it cannot make a key required only when a sibling holds a particular
value — that conditional rule is Pydantic's discriminated union, and the validator stops at the boundary
[ADR-0020](0020-the-database-enforces-its-own-invariants.md) draws. What it still catches is the
failure that would otherwise be silent: a `platz` stored as the string `"2"`, or a `type` nobody in the
code has heard of.

**Referential integrity is enforced at the write path and nowhere else.** The endpoint refuses wiring
the season cannot hold — a dangling `spiel_nr` among the refusals
([ADR-0038](0038-the-write-path-refuses-wiring-the-season-cannot-hold.md)) — while the resolution keeps
its non-destructive containment for stored data, because a season hand-edited in Compass never passed
through the endpoint and erasing teams over a typo destroys more than it reports.

**`teamN_quelle` is required, with no Pydantic default**, so a document that has never carried the key
cannot be read at all. A default would let such a document read as null — the exact state a seeding
pass exists to remove — and the pass could then be skipped with nothing to say so. This is the shape
that orders a data change **against the deploy rather than accommodating it**: seed the key across the
collection first, deploy second, with `python -m app.core.constraints --check` reporting exactly what
the seeding missed. Later ADRs reuse the shape for their own fields.

**No cache tag is added.** `updateTag("spiele")` already clears every `getSpiele` entry whatever its
filter, so the playoffs page is invalidated by the same call as the admin's own view. A per-match tag
would be a granular tag nothing invalidates ([ADR-0001](0001-two-granular-cache-tags.md)).

**The bracket's German vocabulary is testable.** `formatQuelle` is a pure function with unit tests,
where a stored label was checked by nobody.

## Alternatives considered

**A discriminated union on the team field — `team1: FLSpielTeamField | FLSpielSlotOffen`.** Cleaner in
type theory: two states, illegal states unrepresentable, no combination to explain. Rejected on three
counts. It needs a discriminator on every stored team field, so every match document is rewritten
rather than extended. `$jsonSchema` cannot express a `oneOf` within ADR-0020's boundary, so the third
copy of the schema would stop covering this shape at exactly the point it became structural. And it is
the wrong sum: "where this side comes from" is not the opposite of "which team it is" but an
independent fact that outlives the union's own discriminator.

**Keep one field per side and nullify its contents** — `team_id: ObjectId | None`,
`shorthand: str | None`, with `name` still carrying the label. The smallest diff, and it keeps every
consumer reading `team1.name`. Rejected because that last property is the problem rather than the
benefit: it is precisely what stops the type checker finding the consumers. Under `strict: true` a
nullable `team1` makes every `.name`, `.team_id` and `.shorthand` access a compile error until it is
handled, which is the sweep ADR-0033 records as having no other net. It also leaves `name`'s
`min_length=1` demanding text for a side with no team — which is how "TBD" came to be stored in the
first place — and leaves an object called "team" describing something that is not one.

**Leave the placeholder team and only fix the junction-row omission.** Rejected: it treats the symptom
that was cheapest to see. The missing row is one of four costs, and the other three — the invented
shorthand, the fan-out exemption and the form's special case — all follow from the same lie.

**Store the German label and parse it back into a reference** — `"Sieger 25."`, read by a
`parse_herkunft` grammar. Built, reviewed, and rejected before it shipped. It makes a display string
load-bearing for a write, which inverts the dependency: presentation should be derived from data, and
here the data was being recovered from presentation. Three concrete costs on top of the principle. A
foreign key that a typo silently breaks, with no validator able to see it, because every constraint that
could apply is a regex over free text. A label that cannot express a group placing at all, so the
`gruppe` half of the bracket would have needed a second mechanism. And a German string that both
codebases must agree on character by character, which no type system checks.

**Store the reference and the label side by side.** Keeps every existing consumer working with no
derivation step. Rejected because it stores the same fact twice with nothing keeping the two in step: the
first time someone corrects a reference and not its label, the bracket and the resolution disagree and
the page is confidently wrong.

**Derive the topology from position within the round**, as the bracket's connecting lines already do.
Rejected because it is measurably wrong for this bracket: it pairs 25 with 26, and the draw pairs 25
with 27. It is also a rule about how a draw is made, applied to a draw that was made by hand.

**Advance only the fixtures directly fed by the match that changed.** Cheaper per write, and it cannot
heal the two quarter-finals nobody propagated — no one is going to re-enter a result that is already
correct. It also needs a second, different mechanism for the cascade, where resolving the whole season
needs none.

**Advance and overwrite, but never empty a slot.** Keeps a hand-entered team safe and leaves the wrong
team standing when a result is deleted — a visibly wrong public page with nothing pointing at it.

**Keep a played fixture's result when its occupant changes.** Rejected: the goals belong to a team the
fixture does not hold, and team statistics are derived from the match documents on read
([ADR-0019](0019-team-statistics-are-derived-from-spiele.md)), so the league table would credit the
incoming team with a win it never played.

**An explicit `is_manual` flag beside the reference, rather than the null.** Two fields that can
contradict each other — a flag set with a reference present, or cleared with none — and no `$jsonSchema`
validator can express that they must not (ADR-0020). The null already carries the meaning exactly, and
it is the same reasoning that made `inactive_since` a date rather than a boolean beside one
(ADR-0025).

**Prompt the admin instead of advancing** — surface "Spiel 29 wartet auf den Sieger von Spiel 25" in the
action-required list and let a person move the team. Rejected because it answers a different question
than the one asked, and it needs the same reference to classify the fixture, so it carries this
decision's cost without its benefit.

**Trigger the resolution from its own endpoint.** An advancement that needs a second call is one that
can be forgotten, which is the state this ADR exists to leave.
