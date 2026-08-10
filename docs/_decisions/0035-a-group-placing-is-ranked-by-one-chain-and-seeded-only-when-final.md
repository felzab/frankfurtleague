# ADR-0035 — A group placing is ranked by one chain, and seeded into the bracket only once it is final

**Status:** Accepted\
**Date:** 2026-08-05\
**Surface:** backend, frontend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** Open items FB-10 and FE-4, worked together because they ask the same question from opposite
ends — one seeds a bracket slot from a placing, the other marks that placing in the table — and an
answer given to only one of them is an answer the two surfaces can disagree about.

## Context

[ADR-0034](0034-a-result-entry-resolves-the-whole-bracket.md) built the storage half of a bracket slot's
provenance and stopped deliberately short of acting on one of its two variants. A `gruppe` reference
records "the team finishing `platz` in `gruppe`", and the resolution left it alone, because **the data
could not say who finished second.**

Three facts made that so, and all three had to be settled before a slot could be seeded from a standing:

- **Nothing recorded how many teams advance.** `FLSaisonRules` carried `win_points` and `draw_points`,
  so any number would have been a constant written into code — the thing
  [ADR-0019](0019-team-statistics-are-derived-from-spiele.md) refused for 3/1/0.
- **The ranking had two criteria and stopped.** Each group was sorted by points, then goal difference.
  A further tie fell through to the alphabetical order the pipeline delivered, because
  `build_team_pipeline` sorts by `name` and Python's sort is stable. That is a fine way to render a
  table and it is not a qualification rule.
- **Nothing said when a placing was safe to act on.** A table read mid-group is a statement about now,
  and seeding a bracket from it means the public page is confidently wrong between the moment a slot is
  filled and the moment a later result overturns it.

Two further constraints were already in force. `statistik` is derived from the match documents on every
read and stored nowhere (ADR-0019), so any second implementation of the counting rule is a second answer
to how many points a team has. And a `$jsonSchema` validator may assert types, presence and enums and
nothing else ([ADR-0020](0020-the-database-enforces-its-own-invariants.md)), so no rule here can be
enforced by the database.

## Decision

### One chain orders the table and seeds the bracket

**Points, then goal difference, then goals scored, then the head-to-head table among the teams still
level.** Anything the chain cannot separate is a tie and is reported as one.

The head-to-head criterion is a **mini-table over the matches the tied teams played against each
other** — its own points, goal difference and goals scored — and not a pairwise "who beat whom". With
three teams level, a pairwise rule is not even transitive: A beats B beats C beats A is an ordinary
group and orders nobody. The mini-table is applied once and does not recurse back to the top of the
chain; a set it cannot separate is a genuine tie.

**Both surfaces read one ordering.** `GET /teams` returns each group already ranked, and nothing
re-sorts it. That costs the grouped shape one read of the season's in-scope matches, because the last
criterion needs results and `FLTeam` carries only the seven derived figures. The flat list is sorted by
name, is not a standing, and pays none of it.

### `rules.qualifiers_per_group` says how many advance

**Required, with no Pydantic default**, for ADR-0034's reason: a default would let a season document
that has never carried the key read as though it had, and the number would be a constant chosen in a
model file. It is English, like `win_points` and `draw_points` beside it — it configures the competition
rather than naming anything in it.

It rides on `FLTeamsGroupedResponse` next to the table it applies to. The teams in a playoff place are a
prefix of each list, and a page cannot mark them without knowing where the prefix ends.

### A team holds a placing when it is not disqualified and has a match that counts or still could

Two exclusions, one predicate, and both keep the table and the bracket saying the same thing.

**A disqualified team keeps its row and cannot advance out of it**, so the placings walk past it and the
team below takes the place. The standing itself is unchanged: disqualification is about advancing.

**A team with no match that counts or still could holds no placing.** The pipeline serves it a zeroed
`statistik`, which ranks above every team with a negative goal difference, and `SaisontabelleView`
already prints `N/A` rather than a position for that row. A row with no position cannot be shown holding
one, and a bracket must not read one off it.

Read on the table as it stands, the second clause is "has played". Read while a group is running, it
also admits a team whose first fixture is still to come. That is one rule in two states rather than two
rules, which is what stops the marker and the seeding drifting apart.

### A placing is seeded only when no way the group can still go would change it

**Every combination of outcomes for the group's outstanding fixtures is walked, and a placing is written
only when the same team holds it in all of them.** A group with nothing left to play is the same walk
over a single empty product, so there is one code path.

**A tie on points is broken below points only for teams whose figures are final.** Nothing bounds a goal
margin, so a team with a match still to play has an unbounded goal difference, and ordering a band that
contains one would assert a placing that is still moving.

The walk is capped at **ten outstanding fixtures per group** — a five-team group played out in full.
Past that nothing is reported as final, which is the safe direction and in practice the honest one.

### Two states are reported, and "not yet" is not one of them

`FLPatchSpielDataResponse.unresolvable_slots` carries the references no further result can honour:

| Reason             | Means                                                          | The slot      |
| ------------------ | -------------------------------------------------------------- | ------------- |
| `gruppe_too_small` | Fewer teams can hold a placing than the `platz` asks for       | Left as it is |
| `tie_unresolved`   | The group is played out and the chain still cannot separate it | Emptied       |

The two differ because a typo and an outcome are different things. A `platz` a group will never produce
is a data-entry mistake, and erasing a team over one destroys more than it reports — the same rule
ADR-0034 applies to a `spiel_nr` naming no match. A tie that survived the whole chain is a real state of
a real competition, and naming either team would be a guess.

**A group still being played reports nothing.** That placing is not decided yet, its slot is empty, and
nobody needs to be told. Putting it in front of an admin would mean every group-seeded slot raises a
notice on every save for the length of the group phase.

## Consequences

**The first knockout round fills itself in, and only from the next draw onward.** Season 2026's
quarter-finals carry `null` on both sides: their group provenance was never recorded, and writing a
`gruppe` reference for a draw nobody wrote down would be inventing it rather than migrating it
(ADR-0034's runbook). This changes nothing about the 2026 bracket.

**The bracket is still not automatic end to end.** A knockout that ends level has no winner, so the
fixture it feeds is emptied and everything downstream of it with it. That is FB-8's, and until it lands
the automation stops at the first drawn knockout.

**A second season document change is owed before the next deploy.** `qualifiers_per_group` is required,
so every `saisons` document needs it set before this image runs — `python -m app.core.constraints
--check` reports exactly which do not. It is independent of ADR-0034's own unrun `spiele` change, which
touches a different collection, and both are due.

**Nothing edits `rules`.** No page calls `PATCH /saisons/{saison_id}`, so the qualifier count is set by
hand in Compass until FB-6 builds the season admin form. A one-off form for one field would be that item
built badly.

**Two teams level on points and goal difference are separated on goals scored and then on their own
match**, where the stable sort had left them in name order. That order was an artefact rather than a
rule, so the change is the point — but it is a visible change to a public page that no test of the
old behaviour would have flagged.

**`GET /teams` in its grouped shape reads a second collection.** About thirty match documents per season,
on the page that renders the league table. The flat list, which is the shape most callers use, is
untouched.

**`PATCH /spiele/{spiel_id}` now runs the team aggregation inside its transaction.** The write path
therefore depends on the read pipeline, and a malformed `saison_teams` row fails an unrelated match
edit — the same class of exposure ADR-0034 already accepted when the endpoint started reading the whole
season.

**`FLGruppen` is built by `fl_backend/app/api/teams/services.py :: build_gruppen`, not from a list of
teams.** The last criterion reads matches a model holding only teams cannot see. A model method that
ordered on two of four criteria would be the ordering the bracket must not disagree with, one import
away from any caller.

**The certainty walk is deliberately conservative and will under-report.** A placing that a human would
call safe — a three-goal cushion with one match left — is not reported as final, because a goal margin
has no ceiling in the data. It seeds later than a person would and never seeds something that turns out
wrong, and that is the direction to be wrong in.

**A `verlierer` reference resolves to the losing side**, where the branch had advanced the winner for
either spelling. Nothing writes `verlierer` yet and the 2026 bracket has no third-place play-off
(`docs/glossary.md`, §`Ausgang`), so no stored document changes behaviour — but the branch was wrong
and this decision's rewrite of the resolution is where it was found.

## Alternatives considered

**The UEFA chain — head-to-head first, before overall goal difference.** Equally standard, and it is what
UEFA club and national-team competitions use. Rejected because it reorders the displayed table around a
criterion a reader cannot check from the table itself: a row sitting above another with a worse goal
difference is explicable only by a match neither column shows. The FIFA order extends what the table
already displayed rather than rearranging it.

**Stop the chain at goals scored and refer every remaining tie to a person.** Two-thirds of the code and
no head-to-head. Rejected because it is the one shape no serious competition uses: a tie between two
teams who have played each other would go to an administrator rather than to the result between them,
which is both more work and less defensible than the rule everybody already expects.

**Seed once every fixture in the group is played, and never earlier.** Simpler by a wide margin — one
boolean instead of a walk over outcomes — and it can never seed something wrong either. Rejected because
my framing for this item was "as automatic as possible", and a group winner is routinely decided
a matchday before the group ends. The walk is what turns that into a slot that fills itself.

**Seed from the table as it stands and correct it as results arrive.** Cheapest of all, and the bracket
would be confidently wrong in public between each write and the result that overturns it. A public page
that is empty is honest; one that names the wrong team is not.

**Re-implement the counting rule in Python and derive the standing from the match documents directly.**
Would avoid running an aggregation inside the write transaction. Rejected because it is a second answer
to "how many points does this team have", and ADR-0019 exists to have exactly one. The Python side adds
points for results that have not happened; it never counts a result that has.

**Put a `qualifies` flag on `FLTeam`.** The marker would then need no derivation in the client.
Rejected: there is one team shape ([ADR-0027](0027-the-write-path-is-resource-first-in-a-second-router.md)),
the flag is meaningless in the flat list, and qualification is a property of a team's position in a
group rather than of the team — so it belongs beside the group, which is where the count now is.

**Fetch the qualifier count on the page from the season instead.** Rejected because the page resolves a
season id from the URL, and a count fetched separately can come from a different season than the table it
marks. It also invents a 404 path on a page that currently has none.
