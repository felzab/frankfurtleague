# ADR-0075 — A matchday's phase moves only where the move means something

**Status:** Accepted\
**Date:** 2026-08-13\
**Surface:** backend, frontend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** My decision of 2026-08-13, on finding a knockout matchday could be relabelled as a group matchday from the matchday editor: "Why can I move a knockout round into the group phase? This is completely illogical right? or is there a good reason for it." — and the choice to refuse the senseless transitions in the backend rather than hide them in the form.

## Context

`PATCH /spieltage/{spieltag_id}` takes `saison_phase` as an ordinary editable input, and until this
decision the only thing standing between any phase and any other was `REQ-SPIELTAG-002`, which
compares match counts and says nothing about which round is which.

**That `saison_phase` is editable at all is deliberate and stays so.**
[ADR-0052](0052-a-seasons-schedule-is-derived-from-its-rules.md) rejected deriving the phase from a
matchday's position with the argument that "which matchday is the quarter-final is a scheduling
decision — a league may run the group phase across five matchdays or three — and the phase is the
input the count is derived **from**, not a peer of it".
[ADR-0051](0051-a-matchdays-position-is-derived-not-stored.md) leans on the same freedom: a round
split across two dates is two matchday rows for one phase, and the way a row becomes the second
`Viertelfinale` is by having its phase set.

**What neither decision asked is whether every transition should be reachable.** That is this
decision's whole scope, and the answer turns on one fact neither ADR had reason to state.

### The bracket is drawn from a join across two independently stored phases

`fl_frontend/src/app/dashboard/playoffs/page.tsx` — and `/admin/finalrunden`, which reads the same
two collections the same way — builds the bracket like this:

- the **rounds** come from `getSpieltage({ saison_phase: "playoffs" })`, which the backend compiles to
  `saison_phase != "gruppenphase"` on the **`spieltage`** collection;
- the **fixtures** come from `getSpiele({ saison_phase: "playoffs" })`, the same alias applied to the
  **`spiele`** collection;
- the two are joined on `spieltag_id`.

**`spiele.saison_phase` is its own stored field and no endpoint writes it.** `patch_spiel_data` keeps
`saison_id`, `saison_phase`, `spiel_nr` and `spieltag_id` out of its `$set`, and
[ADR-0037](0037-a-seasons-fixtures-are-created-once.md) settled that a season's fixtures are drawn
once, outside the API, with no `POST` and no `DELETE` on `/spiele`. That the two phases may disagree
is already known and already relied on —
`fl_backend/app/api/saisons/admin_router.py :: _spieltag_clashes` says so outright: "a
`spieltag` carries its own `saison_phase` and a fixture's need not agree with it".

So moving a matchday across the group/knockout boundary moves **one side of that join and not the
other**. A `viertelfinale` matchday relabelled `gruppenphase` leaves the round list, and its four
knockout fixtures — still `saison_phase: "viertelfinale"` — are then fetched by the fixture query and
join nothing. **They disappear from the bracket entirely, results included.** The mirror is as bad
and quieter: a group matchday relabelled `viertelfinale` joins the round list while its group
fixtures are filtered out of the fixture query, so the bracket grows an empty column.

**Neither state is repairable through this API.** The repair would be to move the fixtures' own
phase, and nothing writes it.

## Decision

**Two transitions are refused at `PATCH /spieltage/{spieltag_id}`, and every other cell of the matrix
stays open.**

| Code               | Refuses                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `REQ-SPIELTAG-005` | a move **into** a round the season's rules never produce                                            |
| `REQ-SPIELTAG-006` | a move that carries a matchday **across** the gruppenphase/knockout boundary away from its fixtures |

### The matrix

`G` is `gruppenphase`; `A`, `V`, `H`, `F` are the knockout rounds. A cell is the move from the row's
phase to the column's.

| From \ To | G                       | A                       | V                       | H                       | F                       |
| --------- | ----------------------- | ----------------------- | ----------------------- | ----------------------- | ----------------------- |
| **G**     | — (dates only)          | boundary, if it carries | boundary, if it carries | boundary, if it carries | boundary, if it carries |
| **A**     | boundary, if it carries | —                       | open                    | open                    | open                    |
| **V**     | boundary, if it carries | open                    | —                       | open                    | open                    |
| **H**     | boundary, if it carries | open                    | open                    | —                       | open                    |
| **F**     | boundary, if it carries | open                    | open                    | open                    | —                       |

`REQ-SPIELTAG-005` overlays the whole table: **any** cell whose target round the season's rules do not
produce is refused, whatever else is true of it. For the league's own season — four groups of four,
two qualifying — that is every cell in the `A` column, because eight qualifiers play no round of
sixteen.

**"if it carries" is the whole of `REQ-SPIELTAG-006`.** An empty matchday crosses freely in both
directions, and so does one whose fixtures already sit on the side it is moving to.

### Why each refusal has a consequence behind it

**`REQ-SPIELTAG-005` is the edit path's mirror of `REQ-SPIELTAG-004`.** The create already refuses a
matchday in a round the rules never produce; the patch could reach the identical row and did. Such a
row reports `anzahl_spiele` of 0 — `expected_matches` finds no entry — and sits in a round the bracket
never gets to. One rule refusing a row the other endpoint happily produced was an asymmetry with no
argument for it.

**`REQ-SPIELTAG-006` is the join above, stated as a rule.** The fixtures end up on the far side of a
join from their own matchday, and no available edit brings them back. This is `REQ-RETIRE-002`'s
reasoning — the public Spielplan joins fixtures onto the matchdays it received, so what happens to the
container happens to the results — applied to a move rather than to a retirement.

### Every refusal grades the STEP, never the state

This is the third rule on this branch to need that said, and the first two had to have it corrected
into them: `REQ-RETIRE-005` refused a phase that was _already_ below its floor, and
`REQ-SPIELTAG-002` refused _every_ edit made while a matchday was over-full, which cost seven
database tests that had shipped green. Both now grade the transition. So do these, in four places:

- **A payload repeating the stored phase is never judged.** A dates-only edit resubmits the whole
  patch shape, `saison_phase` included, so a rule reading the row's phase alone would take the dates
  hostage over a phase the payload never proposed to change.
- **A move OUT of an unplayed round is permitted.** `REQ-SPIELTAG-005` reads the proposed phase alone,
  so a row stranded in a round the bracket no longer reaches — by a rules narrowing, or by a create
  predating `REQ-SPIELTAG-004` — can always be moved somewhere real.
- **A move TOWARDS the fixtures is permitted.** A `gruppenphase` matchday holding knockout fixtures is
  already broken; moving it to `viertelfinale` is the repair, and it is the same crossing
  `REQ-SPIELTAG-006` refuses in the other direction.
- **A matchday holding both kinds is left alone.** Every move strands something, so refusing would
  freeze that row's phase permanently over a state no edit on this endpoint produced.

### The order the three phase rules answer in

`REQ-SPIELTAG-005`, then `REQ-SPIELTAG-002`, then `REQ-SPIELTAG-006` — the order an admin can act on,
which is the ordering rule `find_rules_refusal` and `find_spieltag_create_refusal` already follow.

The unplayed round comes first because it is a property of the season's rules and the payload alone:
moving fixtures would not make the round exist, so naming the rules is the only answer worth giving.
The count rule comes next because it is the narrower statement — it names two numbers an admin can
compare. The boundary comes last because it is the widest, and because putting it first would have
changed which code an existing over-full case answers with.

## Consequences

**The reported case is refused, and the case ADR-0052 protects is not.** A quarter-final that has been
drawn cannot be relabelled a group matchday. A matchday created before its fixtures were drawn and
given the wrong phase — the ordinary setup mistake — is corrected exactly as before.

**Relabelling one knockout round as another stays completely open**, which is the cell ADR-0052's
argument actually rests on, and
`tests/api/test_spieltag_refusals.py :: test_relabelling_one_knockout_round_as_another_stays_open`
exists so a later rule cannot close it quietly.

**`PATCH` now reads one more count.** The fixtures attached to the matchday are counted twice: once
in total, once restricted to `KNOCKOUT_PHASES`. The difference is the group-side figure, so the two
sides come from two `count_documents` calls rather than an aggregation.

**The form must not offer what the endpoint refuses**
([ADR-0038](0038-the-write-path-refuses-wiring-the-season-cannot-hold.md)).
`fl_frontend/src/features/spieltage/utils.ts :: buildSpieltagPhaseOffer` decides which phases the
matchday editor offers and has to gain both rules.

## Alternatives considered

**Refuse every move whose matchday holds a played fixture, the way `REQ-RETIRE-002` does.** Rejected
as both too strict and too loose. Too strict: a knockout matchday mislabelled `halbfinale` could not
be corrected to `viertelfinale` after the round was played, and that correction strands nothing —
both rounds are on the same side of the join. Too loose: an unplayed but fully drawn quarter-final
would still have been relabelled a group matchday, stranding four fixtures, which is the reported case
exactly.

**Refuse the knockout-to-group direction only.** That is the direction I named, and it is the one
that loses published results. Rejected because the mirror produces a bracket column with no fixtures
in it from data that reads as legitimate, and a rule that closes one direction of a symmetric fault
invites the other to be found later and argued about again.

**Refuse a move that would reopen `REQ-SPIELTAG-003`'s create window.** Moving the season's only
knockout matchday into the group phase makes `earliest_knockout_beginn` `None`, so a season whose
bracket is under way starts accepting new matchdays again. Rejected as a rule of its own:
`REQ-SPIELTAG-003`'s own docstring already accepts re-dating the knockout matchday as the way past
that window, so the guard was never absolute, and `REQ-SPIELTAG-006` closes the case in practice
whenever that matchday carries fixtures.

**Cap how many matchdays a phase may hold, and refuse a move into a full phase.** Rejected outright:
that is the ceiling ADR-0051 ratified against, and it would make a split round unreachable.

**Leave it to the form.** Rejected in the words this record opens with. A form is a stale
tab and a direct request away from being bypassed, and ADR-0038's principle runs the other way — the
write path is the authority and the form mirrors it.
