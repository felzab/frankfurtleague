# ADR-0065 — A season's schedule is derived from its rules, and the rules are held to a shape

**Status:** Accepted
**Date:** 2026-08-07
**Surface:** backend, frontend
**Supersedes:** —
**Superseded by:** —
**Source:** My decisions of 2026-08-07, reviewing FB-6: "just from the number of teams and number
of groups you can figure out how many Spieltage there have to be … anzahl spiele per spieltag can also be
calculated just from that. It CAN be saved to the db, but shouldn't be manually editable"; then, asked
whether to store the derived value or compute it, "derive it, don't store it"; and "a round of sixteen
might be possible in the future, so add support for it. I don't believe a round of 32 will be possible, but
make sure this is easily extendable."

## Context

Two problems that turn out to be one problem.

**`spieltage.anzahl_spiele` was hand-entered.** A required positive integer on the document, on both write
payloads and in the `$jsonSchema` validator, meaning "how many matches this matchday should hold". Nothing
compared it to the fixtures actually attached to the matchday, and nothing could: the number was somebody's
intention and the fixtures were somebody's data entry, so a disagreement between them was two independent
facts rather than a defect either side could detect.
[ADR-0064](0064-a-matchdays-position-is-derived-not-stored.md) removed the neighbouring stored position and
named this field as the one hand-maintained value left on the document.

**A season's `rules` could describe a competition that cannot be played.**
[ADR-0043](0043-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md) put
`qualifiers_per_group` on the season and
[ADR-0063](0063-a-matchday-list-is-the-seasons-skeleton.md) added `number_of_groups` and `teams_per_group`
beside it, and `PATCH /saisons/{saison_id}` accepted any combination each field's own validator permitted. Three groups qualifying one team each is three qualifiers, and three teams cannot be
paired down to one final. That saved cleanly, and the first thing to notice would have been a bracket that
could not be drawn.

**The connection is that the second fact makes the first one derivable.** A league playing a single round
robin per group has no freedom in how many matchdays it needs or how many matches each holds — the numbers
follow from the group count and the group size, and the knockout ladder follows from how many teams come out
of the groups. What looked like an intention was arithmetic nobody had written down.

**The live season is the case where the answer is known independently.** 4 groups of 4, two qualifying from
each: 3 group matchdays of 8 matches, then a quarter-final of 4, a semi-final of 2, a final of 1. That is
what the database holds, and it is what the arithmetic has to reproduce before it is worth trusting.

## Decision

**A season's schedule is derived from its rules, in one pure module.**
`fl_backend/app/api/saisons/schedule.py` holds the whole of it — no I/O, no collection access, so every
number is testable without a database. `schedule_for` returns a frozen `PhaseSchedule` per phase the season
actually plays, carrying the phase, its matchday count and its matches per matchday; `expected_matches`
answers the one question a matchday read needs.

**`anzahl_spiele` stays on the read model and leaves every payload and the validator.** It is computed on
read from the season's rules and this matchday's phase, exactly as `FLTeam.statistik` is computed from the
season's matches ([ADR-0026](0026-team-statistics-are-derived-from-spiele.md)). `GET /spieltage` and
`GET /spieltage/{spieltag_id}` resolve the season's rules once and inject the value before validation.

**Storing the derived number was my own suggestion and is rejected on the same ground ADR-0064
rejected a stored position:** a stored derivation is a cache with no invalidation. Editing a season's
`teams_per_group` would leave every matchday's count behind, and the field would then need either a fan-out
across the season's matchdays or a reader who knows the stored value may be stale. There is no second copy
to be wrong if there is no second copy.

**A group of an odd size plays `n` matchdays, not `n − 1`.** With an even number of teams every team is
paired in every round, so a single round robin takes `n − 1` rounds. With an odd number one team has no
opponent in each round — the **bye** — so the schedule needs `n` rounds to give every pairing its turn, and
each round holds `floor(n / 2)` matches per group rather than `n / 2`. `group_matchdays` and
`group_matches_per_matchday` each carry that case, and `total_group_matches` is `C(n, 2)` per group
**directly**, never matchdays times matches per matchday: for odd `n` that product overcounts, because it
counts the bye's empty slot as a fixture.

**`anzahl_spiele` is `ge=0`, and zero is a real answer.** A matchday whose phase this season's bracket does
not reach expects no matches — a season sending eight teams into the knockout plays no round of sixteen. The
honest report is zero, and the admin list showing `0 / 0` says exactly that; refusing zero would have made
the model unable to describe a state the database can hold.

**The phase set is the single place a round is added.**
`fl_backend/app/api/spiele/schemas.py` declares `PHASE_ORDER` once and derives everything from it:
`PHASE_RANK` for the two rules that need "strictly earlier", `KNOCKOUT_PHASES` as everything after the group
phase, and `MAX_QUALIFIERS` as `2 ** len(KNOCKOUT_PHASES)`. `knockout_phases_for` takes the last
`log₂(qualifiers)` entries of `KNOCKOUT_PHASES`, so a 4-qualifier season plays semi-final then final and a
16-qualifier season starts at the round of 16.

**`achtelfinale` joins the set here**, which is the whole of adding a round of 16: the capacity becomes 16,
the ladder for a 16-qualifier season resolves, `FLSaisonPhase` gains a member, and the validator's phase
enum gains one with it because `test_every_mirrored_model_matches_its_validator` requires it. A round of 32
is one more entry in `PHASE_ORDER` and nothing else —
`test_the_capacity_follows_from_the_phase_set` asserts `MAX_QUALIFIERS == 2 ** len(KNOCKOUT_PHASES)`, so a
capacity hardcoded beside the set fails rather than drifting.

**The rules are held to a shape a competition can have, by five refusals.**
`fl_backend/app/api/saisons/services.py :: find_rules_refusal` is pure and returns `(error_code, detail)`:

| Code            | Refuses                                                                                 |
| --------------- | --------------------------------------------------------------------------------------- |
| `REQ-RULES-001` | `number_of_groups × qualifiers_per_group` is not a power of two within `MAX_QUALIFIERS` |
| `REQ-RULES-002` | `number_of_groups` dropping below a group that still holds teams                        |
| `REQ-RULES-003` | `teams_per_group` dropping below the fullest group's occupancy                          |
| `REQ-RULES-004` | `qualifiers_per_group` dropping below a placing a bracket slot already names            |
| `REQ-RULES-005` | any change to a `past` season's `win_points`, `draw_points` or `qualifiers_per_group`   |

**Four of the five are narrowings, and the direction is the point.** Widening strands nothing. Narrowing
below what already exists leaves data that was entered legally under the wider value: a junction row in a
group the season no longer runs, a group over its own capacity, a bracket slot naming a placing its group
can no longer produce. `REQ-ENTER-002` already refuses **entering** a group the season does not offer, so
without these the same incoherence was unreachable from one direction and wide open from the other.

**The fifth is a freeze, and it protects a result rather than a reference.** The league table is scored from
`rules` on every read ([ADR-0026](0026-team-statistics-are-derived-from-spiele.md)), so editing a finished
season's points rewrites who won it, on the next read, with nothing anywhere recording what it said before.
**Only the dates stay editable** (my call, 2026-08-07): a mistyped end date on a closed season is a repair
with no downside. `erlaubte_stufen` stays editable too, because it bounds what a **form** offers and never
what a stored squad row holds ([ADR-0061](0061-position-and-stufe-are-closed-sets.md)).

**The freeze compares values rather than refusing the endpoint.** A date-only edit resubmits the whole
`rules` object unchanged, and comparing field by field is what lets that through — refusing `PATCH` outright
on a `past` season would have made the dates unrepairable, which is the opposite of the decision.

**The checks run in the order an admin can act on.** The freeze first, because being told a group count
strands a team and then, after fixing it, that the season is closed anyway is a puzzle rather than an
answer. Then the bracket, which is a property of the proposed rules alone and needs no stored data. Then the
three narrowings. `test_the_freeze_is_reported_before_a_narrowing` pins the ordering, because it is
behaviour and not an implementation detail.

**A create is refused only by the bracket rule.** `stored=None` is the create: nothing exists to strand and
nothing is frozen, so the shape of the proposed bracket is the whole check.

**The mismatch between expected and attached matches is reported, never refused.** A season being set up
passes through every intermediate count on the way to being complete, so a refusal would block the setup
rather than a mistake. `/admin/spieltage` shows attached over expected and tints a disagreement.

**The live documents keep their retired key, and no migration blocks the deploy.** Pydantic's default
`extra="ignore"` drops an unknown key, and `additionalProperties` is never `false` in these validators
([ADR-0027](0027-the-database-enforces-its-own-invariants.md)), so a `spieltage` document still carrying
`anzahl_spiele` validates on both layers and the stored value is ignored in favour of the derived one.
Cleaning up is `db.spieltage.updateMany({}, {$unset: {anzahl_spiele: ""}})` whenever convenient — **after**
the deploy, because the currently-live image still requires the field.

## Consequences

**A matchday's expected match count can no longer disagree with the season it belongs to.** The number and
the rules it follows from are one fact read twice, so the class of defect where a matchday claims eight
matches in a season that plays four has no state to occupy.

**The arithmetic has tests, which the hand-entered field could not have.** `fl_backend/tests/api/test_schedule.py`
covers the even and odd group cases, the bye, the totals, the ladder for every legal qualifier count, the
capacity following from the phase set, and — the fixture the file keeps returning to —
`test_it_reproduces_the_season_the_league_is_playing`, which asserts the live season's own numbers.

**Four narrowings and one freeze became reachable states that are now refused**, and
`fl_backend/tests/api/test_rules_refusal.py` covers each in both directions: what it refuses, and what it
must still permit. The permits matter as much — a season being set up narrows freely, widening is always
allowed, and a past season's dates stay editable.

**A season with a legal bracket is now guaranteed to have a ladder.** `knockout_phases_for` returns an empty
tuple for anything that is not a power of two within capacity, and `REQ-RULES-001` is what makes that
unreachable through the API. Both halves are needed: the function has to answer honestly for a document
somebody hand-edited in MongoDB, where no refusal runs.

**`PHASE_RANK` gained a second home and lost its old one.** It lives in `spiele/schemas.py` beside the
`Literal` it ranks, and `spiele/services.py` imports it. Three consumers now read it — `find_wiring_refusal`,
`order_spieltage` and `knockout_phases_for` — and one declaration beside the set is what keeps a fifth phase
from reaching some of them and not others.

**The frontend mirrors the phase set, and the round of 16 arrives with it.** `FLSaisonPhaseSchema`,
`SAISON_PHASE_OPTIONS`, `PHASE_LABELS` and `SaisonPhaseChip` each gain `achtelfinale`;
`src/core/apiContract.test.ts` is what refuses a mirror that stops short of the backend's set.

**The season form can refuse a narrowing before the request.** The editor page reads the season's group
occupancy and the highest wired placing, so the three narrowing refusals are visible as disabled options
with a reason rather than as a 409 after a save. The backend rule is still the authority — a stale form and
a direct API call both reach it.

## Alternatives considered

**Store the derived count and refuse edits to it.** My own first suggestion, and the one this
decision came closest to taking. Rejected for ADR-0064's reason: a stored derivation with no invalidation
goes stale the moment `teams_per_group` changes, and the alternative — fanning the new value out across
every matchday of the season — makes a rules edit a multi-document write in order to maintain a number that
was never independent.

**Compute the count in the frontend from the season's rules.** The rules already reach the page, so the
arithmetic could live there and the backend model stay unchanged. Rejected: the number would then exist only
where it is displayed, so the API would answer differently from the interface, and a second consumer would
reimplement it. Deriving it at the boundary means one answer.

**Derive the matchday's phase as well, from its position in the season.** Tempting, since the phase and the
count are both consequences of the schedule. Rejected: which matchday is the quarter-final is a scheduling
decision — a league may run the group phase across five matchdays or three — and the phase is the input the
count is derived **from**, not a peer of it.

**Refuse a matchday whose attached fixtures do not match the expected count.** Rejected above: it would
block a season's setup, which passes through every wrong count on the way to the right one. Reporting it on
`/admin/spieltage` puts the fact where somebody can act on it without making the intermediate states
illegal.

**Validate the bracket shape in `FLSaisonRules` with a model validator.** It would refuse the combination at
the boundary for free, on every read as well as every write. Rejected: a `past` season's stored rules must
keep validating even if a future decision narrows what is legal, and a model validator would make a
historical document unreadable rather than uneditable. The refusal belongs at the write, which is where
`find_rules_refusal` sits.

**Cap the qualifiers at a literal 16.** Simpler than deriving it from the phase set. Rejected because it is
the same number written twice: adding a round of 32 would then compile, pass every test, and refuse the
seasons it was added for. `MAX_QUALIFIERS` being computed is what makes the extension one line.
