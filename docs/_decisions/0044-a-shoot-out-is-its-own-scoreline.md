# ADR-0044 — A shoot-out is its own scoreline, read by the bracket and by nothing else

**Status:** Accepted
**Date:** 2026-08-05
**Surface:** backend, frontend
**Source:** Open item FB-8, the last behavioural gap in the bracket
[ADR-0042](0042-a-result-entry-resolves-the-whole-bracket.md) and
[ADR-0043](0043-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md) built.

## Context

The bracket maintains itself in both halves. The first knockout round seeds from the group standings
once a placing is beyond doubt (ADR-0043), and every round after it is filled from the round before
(ADR-0042). One shape defeats all of it: **a knockout that finishes level.**

`_outcome_of` reads the two goal counts and a level pair names neither a `sieger` nor a `verlierer`, so
the fixture fed by it is emptied — and because the resolution recomputes the whole season from scratch,
everything downstream of that fixture empties with it. One drawn quarter-final therefore blanks a
semi-final and the final behind it.

**No field could record how such a tie was actually settled.** `FLSpiel.ergebnis` is constrained to
`^[0-9]+:[0-9]+$` in the Pydantic model, the Zod mirror and nothing else; there was no second score, no
marker, and no way to say "decided on penalties" at all.

**A route past it existed and was documented**, which is why this was never a defect: clearing that
slot's `quelle` hands it to the admin, who types a side in by hand (ADR-0042). What it cost was the
record — nothing said the tie went to penalties rather than being played out — and the slot, which
stopped being maintained for the rest of the tournament.

Three constraints were already in force and each narrowed the answer.

- **`statistik` is derived from the match documents on every read** and stored nowhere
  ([ADR-0026](0026-team-statistics-are-derived-from-spiele.md)), so whatever is stored here is read by
  the league table too unless the table is told to ignore it.
- **A `$jsonSchema` validator may assert types, presence and enums and nothing else**
  ([ADR-0027](0027-the-database-enforces-its-own-invariants.md)), so no rule relating this field to
  another can be enforced by the database.
- **Two fields that can contradict each other are refused on principle.** An `is_manual` flag beside
  `quelle` was rejected for it (ADR-0042) and `inactive_since` is a date rather than a boolean beside
  one ([ADR-0032](0032-soft-deletion-is-a-date-not-a-flag.md)).

## Decision

### The shoot-out is stored as its own scoreline, and the winner is derived from it

`FLSpiel.elfmeterschiessen` is `{team1, team2}` or `null`, two non-negative integers naming the same two
sides the fixture does. **`null` is every match that did not finish level**, which is almost all of them.

**The winner is derived and never stored.** There is no `sieger` field: a second statement of the same
fact could contradict the counts, and no validator could express that it must not — the reasoning that
kept an override flag off `quelle` and made `inactive_since` a date.

**A level shoot-out is refused by `FLSpielElfmeterschiessen`.** It is the one value the field could hold
and still name nobody, which would leave the fixture exactly where a drawn knockout sits — no winner,
nothing downstream, and now a filled-in record implying otherwise.

**`ergebnis` does not absorb it.** Both ends parse that string to derive win, draw or loss, and a third
number in it reads as a malformed value on every card — the failure the pattern was added to stop.

**The name is German and the glossary defines it**, under the owner's vocabulary rule: a structural name
is English, as `type` on a `quelle` is, and a domain word stays German and gets an entry.
`Elfmeterschießen` is the shoot-out; `Elfmeter` alone is a single spot kick awarded in play, which is a
different thing this system does not record.

### The league table counts the fixture as the draw it was

`build_statistik_lookup_stage` does not consult `elfmeterschiessen`, and neither does `_counted_goals`,
which restates the same counting rule for the standings and the head-to-head mini-table. A knockout
settled on penalties is one point each, one entry in `unentschieden`, and the shoot-out's own counts
appear in no goal column.

**So the bracket and the table say different things about the same match, on purpose.** That is what
every competition scoring a shoot-out does, and it is the reason the counts are a scoreline of their own
rather than goals: adding them to `tore` would move a league table on kicks that were never part of the
match.

### `resolve_bracket` reads it, or the item buys a record and no behaviour

`_outcome_of` takes the shoot-out where the goals finished level, and nothing otherwise. A level fixture
carrying no shoot-out still has no winner and still empties the slot it feeds, exactly as before.

**A shoot-out stored against a fixture the goals already decided is ignored.** The write path discards
that shape on the way in — `patch_spiel_data` is the one place that sees both sides at once, which is
why `ergebnis` is derived there — so it is reachable only by a hand edit in Compass, and the goals win.

**A fixture whose occupant changes loses its shoot-out with the rest of its result.** The kicks were
taken by a side that is no longer in the fixture, so `advance_bracket_winners` clears it alongside
`ergebnis`. Leaving it would hand the slot below a winner derived from a match neither side played.

### The admin form offers it on exactly the fixture it can describe

The section appears when both sides are resolved, a result is being entered, and the two goal counts are
equal. Anywhere else the write path would discard what was typed, and a form that takes input the save
throws away is worse than one that does not offer it.

## Consequences

**A third production data change is owed before the next deploy**, in ADR-0042's shape and for its
reason. `elfmeterschiessen` is required with no Pydantic default, so a document that has never carried
the key cannot be read at all — and `GET /spiele` is the landing page, every grid and the bracket.

1. **Before the deploy**, `$set` `elfmeterschiessen: null` on every `spiele` document. The running image
   ignores unknown keys, so this is invisible until the deploy.
2. **Deploy.** `python -m app.core.constraints --check` reports exactly what step 1 missed, and `collMod`
   applies the validator only once it reports clean.

No migration tooling is added, for the reason ADR-0032 settled: a one-off ships as a runbook rather than
as a permanent file with one day's purpose. It is independent of ADR-0042's and ADR-0043's own changes,
both of which have run — measured 2026-08-05 with `--check`: 0 of 31 `spiele` and 0 of 1 `saisons`
documents rejected.

**The bracket now maintains itself end to end.** A group placing seeds the first knockout round, every
later round is fed by the round before, and a tie in either is either reported or settled. Nothing in
the automatic path needs an admin, and clearing a `quelle` remains the way to take a slot back.

**A level shoot-out fails on READ, not only on write.** A hand edit in Compass storing `4:4` takes
`GET /spiele` down until it is corrected, because the database validator cannot express that the two
counts must differ (ADR-0027) and Pydantic is therefore the only place the rule can live. That is the
same bargain `ergebnis`'s pattern and `mietpreis`'s `ge=0` already strike, and the alternative is a
fixture that looks settled and advances nobody.

**The validator covers this field completely**, unlike `quelle`. There are no variants, so `$jsonSchema`
requires both counts and types both, and a shoot-out stored as the string `"4"` is refused by the
database rather than surfacing as a failed read.

**Three cards gained a second line.** The shoot-out renders under the score rather than inside it, so
`2:2` stays the score every surface shows and the Saisontabelle is not contradicted by the card beside
it. It sits inside the score's own grid cell, so the two team tracks keep their widths.

**`computeErgebnisFor` is unchanged and still answers "D".** A team's own page marks a fixture settled on
penalties as a draw, which is what the table counts — the bracket is the only reader that takes a winner
from it.

**Nothing records a match settled after extra time.** A fixture that goes to extra time and is won there
is not level, so it already has a winner and needs nothing; only the level case had a gap, and only the
level case is filled.

## Alternatives considered

**Put the decider inside `ergebnis`** — a third number, or a suffix. Rejected first and hardest. Both
ends parse that string to derive win, draw and loss, and `FLSpielSchema` constrains it precisely because
an unconstrained value once rendered as a loss for both teams. A third number would be a malformed value
to every existing reader, including the frontend's own `ERGEBNIS_PATTERN`.

**A nullable second score string** — `elfmeter_ergebnis: "4:3"`, pattern-constrained exactly like
`ergebnis`. Cheapest of the three by a clear margin. Rejected because `ergebnis` is a string only because
it is DERIVED server-side from two goal counts and never accepted from a client (spec invariant I3): a
hand-typed penalty string has no counts behind it to be derived from, so it inverts that rule instead of
following it, and it adds a second regex both ends must keep in step.

**A general `entscheidung` enum a walkover would also use.** Rejected on two independent grounds. A bare
enum cannot say who won, so `resolve_bracket` could not read it without a second winner field beside it —
the contradiction this decision exists to avoid. And the walkover it was meant to cover is already
expressible: a cancelled match carrying a result is a forfeit, it counts in the table (ADR-0026), and
`_outcome_of` ignores `is_canceled`, so it already advances its winner.

**The same object as a tagged union discriminated on `type`**, mirroring `FLSpielQuelle`, so a second
variant could be added later. Rejected because the second variant is the walkover above, which needs no
variant; it would ship a discriminator with one member, and `$jsonSchema` could then require only the
tag, giving up the complete validator coverage the plain object gets.

**Store the shoot-out counts on the two team fields, beside `tore`.** Rejected: those fields are display
copies maintained by the rename fan-out (ADR-0028, rule 3), `tore` is already the one exception, and a
second would have to be stripped in three places on every advancement rather than in one.

**Count a shoot-out win as a win in the league table.** Rejected because no serious competition does it,
and here it would be worse than merely unusual: the Saisontabelle is a group standing, playoff matches
are out of its scope entirely (ADR-0029), and a rule written for the knockout rounds would be a scoring
rule that never applies to the table it changed.

**Refuse a shoot-out on a fixture the goals already decided, rather than discarding it.** Rejected
because the check is a cross-field rule between `elfmeterschiessen` and two `tore` values, and matches
are hand-created — so it would fail on READ and take the bracket page down over a document that is
merely contradictory, which is the trap ADR-0042 records for pairing `quelle` with its team field.
