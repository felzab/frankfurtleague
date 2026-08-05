# ADR-0042 — A bracket slot stores a structural reference, and a result entry resolves the whole bracket

**Status:** Accepted
**Date:** 2026-08-05
**Surface:** backend, frontend
**Supersedes:** —
**Superseded by:** —
**Source:** Open item FB-4, whose part 1 established what feeds a bracket slot and whose part 2 is this
workflow. [ADR-0041](0041-a-bracket-slot-carries-its-own-provenance.md) left the shape of the reference
open and named the condition under which it could be settled; this is that settlement.

## Context

A playoff fixture with an unresolved side stores `teamN: null` beside a record of where that side comes
from (ADR-0041). Nothing filled those slots when a result arrived. Season 2026 ran two quarter-finals —
matches 25 and 28 — whose winners never reached the semi-finals they feed, and the only way to move them
was to type each team into the admin form by hand.

**The domain fact that decides the shape, and it is the owner's ruling closing FB-4's part 1:** the
first knockout round is **always** seeded from the group phase, and every round after it is fed by
exactly two matches of the round before. There is no third way for a slot to be filled. That is what
ADR-0041 was waiting to know — it rejected a `{spiel_nr, ausgang}` reference precisely because a
match-fed reference cannot express a group placing, and nobody had yet decided whether group placings
were in play.

**Nothing else records the bracket's edges.** `spieltage.order_val` orders the rounds and says nothing
about who feeds whom, and position within a round is not the answer either: match 29 is fed by 25 and
27, not by 25 and 26, so the index arithmetic that draws the connecting lines in `PlayoffsView`
describes the geometry and not the topology.

**A previous attempt stored the edge as German display text** — `"Sieger 25."` — and recovered the
match number by parsing it. It was rejected before it shipped. The reasoning is in
_Alternatives considered_ below, because it is the alternative most likely to be proposed again.

## Decision

**A bracket slot stores a structural reference to what feeds it, and the German label is derived from
that reference.** `FLSpiel.teamN_quelle` is a tagged union with exactly two variants, discriminated on
`type`:

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

**The occupant of a slot naming a match IS the winner of that match, recomputed in full on every match
write.** `PATCH /spiele/{spiel_id}` resolves the whole of that match's season and writes back every
fixture whose sides disagree with their references, inside the transaction that carries the result
itself.

**Recomputed, never appended to.** A corrected result moves the right team in; a deleted one empties the
slot again; a bracket nobody propagated resolves itself on the next save of any match in the season.
Running the resolution twice writes nothing the second time.

**A fixture whose occupant changes loses its own result.** The goals stored against it were scored by a
side that is no longer in it, so both sides' `tore` and the `ergebnis` go with the occupant — and the
fixture then has no winner, which carries the correction onward to whatever it feeds.

**Two things that cannot be looked up leave the fixture alone**: a reference naming a `spiel_nr` the
season has no match for, and a chain of references that closes on itself. Both are data-entry mistakes,
and erasing a team over one would destroy more than it reports. This is the one place the rule is not
"the reference owns the slot", and the distinction is deliberate: _a match that exists and has no winner
yet_ genuinely means the slot is empty, while _a number nobody can resolve_ means nothing at all.

**Only the `spiel` variant resolves. A `gruppe` variant is stored, displayed, and left alone.** Seeding
from the standings needs a total order within a group and a record of how many teams advance, and
neither exists: the group sort is points, then goal difference, then whatever order the pipeline
delivered. Asserting a second place the data cannot distinguish would be worse than not seeding at all.
Open item FB-10 is that work, and the `gruppe` variant is what it will read.

**Manual override is the null, and there is no override flag.** A slot with a `quelle` is maintained by
the resolution and by nothing else — a team entered by hand is reverted in the same request. A slot
whose `quelle` is `null` is the admin's, and nothing writes it. That single rule is the whole
manual-override story, and it is the route for a knockout that ends level, which has no winner and no
way to record how it was actually settled (open item FB-8).

**The endpoint reports what it moved.** `FLPatchSpielDataResponse.advanced_to` carries the `spiel_nr` of
every fixture written, and the admin's toast names them. It reports what happened rather than what was
asked for, so a fixture that was _emptied_ is named as readily as one that was filled — which is why the
copy reads "aktualisiert" and not "eingetragen".

**`quelle` is never written and never cleared by any of this.** It describes where a side of the fixture
comes from, which stays true once the winner arrives (ADR-0041).

## Consequences

**The reference and the team field are independent, and all four combinations are legitimate.** A
`quelle` is a fact about the fixture; a team is a display copy the rename fan-out maintains
([ADR-0028](0028-store-what-was-true-then-derive-what-is-true-now.md), rule 3). Every reader takes the
team, then the derived label, then "Noch offen", and never asks which state it is in. Nothing pairs
them and no validator polices the combination.

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
[ADR-0027](0027-the-database-enforces-its-own-invariants.md) draws. What it still catches is the
failure that would otherwise be silent: a `platz` stored as the string `"2"`, or a `type` nobody in the
code has heard of.

**Referential integrity is not enforced.** Nothing refuses a `spiel_nr` naming no match, and the admin
form takes the number as typed rather than picking from a list of the season's matches — the edit dialog
holds one match and not its season. The containment above is that an unresolvable reference is
non-destructive and that `advanced_to` stays silent, which surfaces the typo when the result is entered
rather than weeks later on the public bracket.

**No cache tag is added.** `updateTag("spiele")` already clears every `getSpiele` entry whatever its
filter, so the playoffs page is invalidated by the same call as the admin's own view. A per-match tag
would be a granular tag nothing invalidates ([ADR-0001](0001-two-granular-cache-tags.md)).

**A knockout decided on penalties still cannot be recorded.** `ergebnis` is `^[0-9]+:[0-9]+$` and there
is no penalties field, so a level fixture has no winner, the resolution correctly advances nobody, and
the bracket stalls behind the clear-the-`quelle` route above. Open item FB-8.

**The bracket's German vocabulary is now testable.** `formatQuelle` is a pure function with unit tests,
where a stored label was checked by nobody.

## The production data change, and the order is load-bearing

Three steps, in ADR-0041's shape and for its reason: no migration tooling is added, because
[ADR-0032](0032-soft-deletion-is-a-date-not-a-flag.md) settled that a one-off ships as a runbook rather
than as a permanent file with one day's purpose.

**`teamN_quelle` is required with no Pydantic default**, so a document that has never carried the key
cannot be read at all. Running step 2 before step 1 fails `FLSpiel` on every match and takes
`GET /spiele` — and with it the landing page, every grid and the bracket — down. Measured on
2026-08-05 with `python -m app.core.constraints --check`: **31 of 31 `spiele` documents in season 2026
would currently be rejected**, because none of them carries the key yet.

**The bracket below is the owner's, confirmed 2026-08-05.** It was not measured from the database.

1. **Before the deploy**, seed `teamN_quelle` on all 31 documents of season 2026. The running image
   ignores unknown keys, so this is invisible until step 2.

   | Match | `team1_quelle`                                     | `team2_quelle`                                     |
   | ----- | -------------------------------------------------- | -------------------------------------------------- |
   | 29    | `{type: "spiel", spiel_nr: 25, ausgang: "sieger"}` | `{type: "spiel", spiel_nr: 27, ausgang: "sieger"}` |
   | 30    | `{type: "spiel", spiel_nr: 26, ausgang: "sieger"}` | `{type: "spiel", spiel_nr: 28, ausgang: "sieger"}` |
   | 31    | `{type: "spiel", spiel_nr: 29, ausgang: "sieger"}` | `{type: "spiel", spiel_nr: 30, ausgang: "sieger"}` |

   **Every other document — matches 25–28 and all 24 group-phase fixtures — gets `null` on both
   fields.** The quarter-finals are group-seeded and their group provenance was never recorded, so a
   `gruppe` reference here would be invented rather than migrated. `null` is also the correct answer
   under the rule above: those slots stay the admin's until FB-10 can derive them.

2. **Deploy.** `python -m app.core.constraints --check` reports exactly what step 1 missed, and
   `collMod` applies the validator only once it reports clean.

3. **After the deploy**, `$unset` `teamN_herkunft` across `spiele`. The new image never reads it, and
   removing it before the deploy would take down the running one.

## Alternatives considered

**Store the German label and parse it back into a reference** — `"Sieger 25."`, read by a
`parse_herkunft` grammar. Built, reviewed, and rejected before it shipped. It makes a display string
load-bearing for a write, which inverts the dependency: presentation should be derived from data, and
here the data was being recovered from presentation. Three concrete costs on top of the principle. A
foreign key that a typo silently breaks, with no validator able to see it, because every constraint that
could apply is a regex over free text. A label that cannot express a group placing at all, so the
`gruppe` half of the bracket would have needed a second mechanism. And a German string that both
codebases must agree on character by character, which no type system checks. The structural field costs
one staged production change — the runbook above — and deletes all three.

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

**Keep a played fixture's result when its occupant changes.** Rejected: the goals were scored by a team
no longer in the fixture, and team statistics are derived from the match documents on read
([ADR-0026](0026-team-statistics-are-derived-from-spiele.md)), so the league table would credit the
incoming team with a win it never played.

**An explicit `is_manual` flag beside the reference, rather than the null.** Two fields that can
contradict each other — a flag set with a reference present, or cleared with none — and no `$jsonSchema`
validator can express that they must not (ADR-0027). The null already carries the meaning exactly, and
it is the same reasoning that made `inactive_since` a date rather than a boolean beside one
(ADR-0032).

**Prompt the admin instead of advancing** — surface "Spiel 29 wartet auf den Sieger von Spiel 25" in the
action-required list and let a person move the team. Rejected because it answers a different question
than the one asked, and it needs the same reference to classify the fixture, so it carries this
decision's cost without its benefit.

**Trigger the resolution from its own endpoint.** An advancement that needs a second call is one that
can be forgotten, which is the state this ADR exists to leave.
