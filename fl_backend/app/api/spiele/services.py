"""
SPIELE · query construction, the playoff bracket, and what the write path refuses

Pure throughout -- no I/O, no collection access -- which is what makes the query semantics, the
advancement algorithm and every refusal rule testable without a database. Five halves:

  • `build_spiele_filter` / `build_spiele_sort` translate `FLSpieleFilterParams` into a Mongo filter
    document and a sort specification.
  • `apply_payload_to_spiel` normalises one patch payload into the fixture it produces. The SAVE and
    the `dry_run=true` PREVIEW both go through it, which is what stops the two disagreeing (ADR-0051).
  • `resolve_bracket` computes what every bracket slot in a season should hold, reports every stored
    fault it walked past (ADR-0047), and names the result each advancement destroys (ADR-0051).
  • `find_wiring_refusal` decides whether a patch's wiring is one the season can hold (ADR-0046).
  • `find_eligibility_refusal` and `judge_spieltag_occupancy` decide the same about its OCCUPANTS: a
    disqualified team is refused, and a team already playing this Spieltag is moved or refused
    (ADR-0052).

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `saison_phase="playoffs"` compiles to `!= "gruppenphase"`. It is a query alias and never a stored
    value.
  • `spiel_status` compiles to a date or cancellation filter. Note `ausstehend` is `>= today`, so it
    INCLUDES today -- the frontend's own status derivation excludes it and labels those matches
    `heute`. The two definitions differ deliberately; see the glossary before changing either.
  • `unbekannt` has no branch and therefore filters nothing: passing it returns everything.
  • `team_id` matches either side of the fixture, so it needs `$or` rather than a field equality.
  • A slot with a `quelle` is maintained by `resolve_bracket` and by nothing else; a slot without one is
    the admin's, and nothing here writes it. That one rule is the whole manual-override story -- there is
    no override flag, and clearing the `quelle` is how a person takes a slot back (ADR-0042).
  • BOTH variants resolve. A `spiel` reference is the side that came out of an earlier match; a `gruppe`
    reference is the team a group's standing has already put at that placing beyond doubt (ADR-0043).
  • A KNOCKOUT fixture whose goals finished level is decided by its `elfmeterschiessen` and by nothing
    else. The counts are read HERE and nowhere in the league table, which scores the match as a draw --
    the two disagree about the same fixture deliberately (ADR-0044). A `gruppenphase` fixture is never
    decided that way: a group draw is a final result.
  • "Nothing to look up" LEAVES A SLOT ALONE; "the reference names nobody" EMPTIES it. The first covers a
    `spiel_nr` the season has no match for, a chain of references that closes on itself, and a `platz`
    its group can never produce -- all data-entry mistakes, and erasing a team over one destroys more
    than it reports. The second is a real answer and is how a corrected result reaches the final.
  • A fixture whose two references resolve to ONE club is the same class of mistake, contained the
    same way: it is not maintained, its stored sides stand, and everything downstream derives from
    that stored state -- never from the contradiction. The containment is transitive by construction,
    because the memo records the fixture as unchanged rather than as changed-then-refused.
  • CONTAINING a fault and REPORTING it are separate, and every one of the five is both. The five are the
    two `gruppe` states, a `spiel_nr` naming no match, a cycle, and a fixture resolving to one club --
    they reach `bracket_faults` and change no slot (ADR-0047). Reporting a shape is never licence to act
    on it.
  • A placing that is not decided YET is nobody's problem and is reported to nobody. Only states a
    further result cannot fix reach `bracket_faults`.
  • The containment above and `find_wiring_refusal` are two boundaries, not one rule applied twice: the
    write path REFUSES wiring the season cannot hold, and the resolution CONTAINS the same shapes when
    they are already stored -- data that never passed through the endpoint still resolves without loss
    (ADR-0046).
  • An occupant refusal applies only to a team the payload NEWLY fields. Without that clause a fixture
    already holding an ineligible team becomes uneditable -- including by the edit that would fix it.
  • A Spieltag clash MOVES a manual side and REFUSES against a maintained one. Emptying a side that
    carries a `quelle` is reverted by the next resolution, so it would report a success that does not
    hold (ADR-0052).
  • `resolve_bracket` returns typed model values and never a Mongo update document. Serialising an
    embedded team is a storage concern and belongs in `crud.py`, which knows about `keep_oid`.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/glossary.md -- spiel_status, for the two definitions side by side
  docs/_decisions/0042-a-result-entry-resolves-the-whole-bracket.md -- the model and the algorithm
  docs/_decisions/0043-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md
  docs/_decisions/0044-a-shoot-out-is-its-own-scoreline.md -- why the table still counts it as a draw
  docs/_decisions/0047-a-bracket-fault-is-derived-on-demand.md -- the five faults and where they surface
  docs/_decisions/0051-a-voided-result-is-named-before-it-is-lost.md -- the dry run and what it reports
  docs/_decisions/0052-a-team-is-fielded-once-per-spieltag.md -- the occupant rules and move-or-refuse
"""

from dataclasses import dataclass
from typing import Any, Iterable, Literal, Mapping, Sequence

from app.api.spiele.schemas import (
    FLBracketFault,
    FLBracketFaultGruppe,
    FLBracketFaultQuelle,
    FLBracketFaultSpiel,
    FLPatchSpielDataPayload,
    FLSaisonPhase,
    FLSpiel,
    FLSpieleFilterParams,
    FLSpielElfmeterschiessen,
    FLSpielQuelle,
    FLSpielQuelleGruppe,
    FLSpielQuelleSpiel,
    FLSpielTeamField,
)
from app.api.teams.schemas import FLGruppenNames
from app.api.teams.services import DecidedStanding
from app.shared.schemas.custom import CustomObjectId


def build_spiele_sort(sort_by: str, order: str) -> list[tuple[str, int]]:
    direction = 1 if order == "asc" else -1

    if sort_by == "datum":
        return [("datum", direction), ("spiel_nr", 1)]
    elif sort_by == "spiel_nr":
        return [("spiel_nr", direction), ("datum", 1)]
    else:
        return [(sort_by, direction), ("datum", direction), ("spiel_nr", 1)]


def build_spiele_filter(filters: FLSpieleFilterParams, today: str) -> dict[str, Any]:
    query = filters.model_dump(include={"saison_id", "saison_phase"}, exclude_none=True)

    # Phase
    if filters.saison_phase == "playoffs":
        query["saison_phase"] = {"$ne": "gruppenphase"}

    # Status
    match filters.spiel_status:
        case "heute":
            query["datum"] = today
        case "vergangen":
            query["datum"] = {"$lt": today}
        case "ausstehend":
            query["datum"] = {"$gte": today}
        case "abgesagt":
            query["is_canceled"] = True

    if filters.team_id is not None:
        query["$or"] = [
            {"team1.team_id": filters.team_id},
            {"team2.team_id": filters.team_id},
        ]

    return query


# One fixture's resolved sides, plus whether either occupant differs from the one stored.
ResolvedSides = tuple[FLSpielTeamField | None, FLSpielTeamField | None, bool]


@dataclass(frozen=True)
class SlotAdvancement:
    """
    One fixture whose bracket slots resolve to something other than what it currently stores.

    `team1` and `team2` are the sides as they should be written, goals already stripped: an emitted
    advancement always means an occupant changed, so the goals recorded in this fixture were scored by a
    side that is no longer in it, and the result goes with them.

    `voided_ergebnis` and `voided_elfmeterschiessen` are what this fixture held at the moment the
    resolution ran, copied out before anything writes over them. Reporting only which fixtures MOVED
    describes the harmless case and the destructive one in the same words (ADR-0051); both are `None`
    when a slot merely filled from empty, which is the ordinary case and the majority of them.
    """

    spiel_id: CustomObjectId
    spiel_nr: int
    team1: FLSpielTeamField | None
    team2: FLSpielTeamField | None
    voided_ergebnis: str | None
    voided_elfmeterschiessen: FLSpielElfmeterschiessen | None


def _source_spiel_nr(quelle: FLSpielQuelle | None) -> int | None:
    """
    The match a slot is fed by, or `None` when no earlier match feeds it.

    Used to walk the bracket's edges, so a `gruppe` reference answers `None` here even though it does
    resolve: it is fed by a group standing rather than by a fixture, and it can therefore neither
    lengthen a chain of references nor take part in a cycle.
    """

    return quelle.spiel_nr if isinstance(quelle, FLSpielQuelleSpiel) else None


def _is_same_team(left: FLSpielTeamField | None, right: FLSpielTeamField | None) -> bool:
    """
    Whether two fixture sides hold the same club, comparing the id alone.

    `name` and `shorthand` are display copies maintained by `PATCH /teams/{team_id}`'s fan-out
    (ADR-0028, rule 3). Comparing them would make bracket resolution a second, partial rename fan-out
    firing only on the matches a reference happens to point at.
    """

    if left is None or right is None:
        return left is None and right is None

    return left.team_id == right.team_id


def _fixtures_depending_on_a_cycle(by_nr: Mapping[int, FLSpiel]) -> frozenset[int]:
    """
    Every fixture whose slots depend, directly or transitively, on a cyclic chain of references.

    A cycle -- 29 fed by match 30 while 30 is fed by match 29 -- states a contradiction rather than an
    outcome, so nothing downstream of one can be derived either. `_resolve_sides` leaves every slot fed
    by one untouched, which is also what stops the recursion following the loop round.

    A bracket drawn through the admin form cannot contain one; a season hand-built in Compass can.
    """

    IN_PROGRESS, DONE = 1, 2
    state: dict[int, int] = {}
    tainted: set[int] = set()

    def visit(spiel_nr: int) -> bool:
        if state.get(spiel_nr) == IN_PROGRESS:
            return True  # a back edge, so this chain closes on itself
        if state.get(spiel_nr) == DONE:
            return spiel_nr in tainted

        state[spiel_nr] = IN_PROGRESS
        spiel = by_nr.get(spiel_nr)
        sources = (_source_spiel_nr(spiel.team1_quelle), _source_spiel_nr(spiel.team2_quelle)) if spiel is not None else ()
        depends_on_a_cycle = any(visit(source) for source in sources if source is not None)
        state[spiel_nr] = DONE

        if depends_on_a_cycle:
            tainted.add(spiel_nr)
        return depends_on_a_cycle

    # Sorted, so the traversal -- and therefore every memoised answer below it -- is decided by the input
    # rather than by dict ordering.
    for spiel_nr in sorted(by_nr):
        visit(spiel_nr)

    return frozenset(tainted)


@dataclass(frozen=True)
class BracketResolution:
    """
    What one season's bracket should hold, and which of its references contradict the season.

    `advancements` are the fixtures to write. `bracket_faults` are the five stored shapes that need a
    person rather than another result -- reported alongside the writes rather than instead of them,
    because one broken reference is no reason to leave the rest of the bracket unresolved.
    """

    advancements: list[SlotAdvancement]
    bracket_faults: list[FLBracketFault]


def _seed_from_gruppe(
    spiel: FLSpiel,
    quelle: FLSpielQuelleGruppe,
    standings: Mapping[FLGruppenNames, DecidedStanding],
    faults: list[FLBracketFault],
) -> tuple[FLSpielTeamField | None, bool]:
    """
    The team a group placing seeds into a slot, and whether this resolution maintains that slot at all.

    Three answers, and the middle one is the ordinary state of a running competition:

    - **The placing is decided** -- the team, to be written in.
    - **It is not decided yet** -- nobody, and the slot is emptied. The reference genuinely names no
      team, exactly as a match with no winner does, so a slot seeded from an earlier state of the table
      gives that team back the moment a result stops supporting it.
    - **It can never be decided** -- reported, and the slot is left alone or emptied depending on which
      of the two states it is (see `FLBracketFaultGruppe`).

    An absent standing means none was supplied for this season, so nothing is derived and nothing is
    reported. That is not the same as a group with no teams, which arrives as a standing with none.
    """

    standing = standings.get(quelle.gruppe)
    if standing is None:
        return None, False

    # A placing this group can never produce -- fewer teams than the number asks for. A typo, so the
    # slot keeps whatever it holds, on the same reasoning as a `spiel_nr` naming no match (ADR-0042).
    if quelle.platz > standing.eligible:
        faults.append(
            FLBracketFaultGruppe(
                reason="gruppe_too_small", spiel_id=spiel.id, spiel_nr=spiel.spiel_nr, gruppe=quelle.gruppe, platz=quelle.platz
            )
        )
        return None, False

    team = standing.by_platz.get(quelle.platz)
    if team is not None:
        # Arriving in a new fixture, the team has scored nothing in it yet.
        return FLSpielTeamField(team_id=team.id, name=team.name, shorthand=team.shorthand, tore=None), True

    # Played out and still level on every criterion. Reported, and the slot is emptied with it: naming
    # either team would be a guess, and the route past it is to clear the `quelle` and enter a side.
    if standing.is_complete:
        faults.append(
            FLBracketFaultGruppe(reason="tie_unresolved", spiel_id=spiel.id, spiel_nr=spiel.spiel_nr, gruppe=quelle.gruppe, platz=quelle.platz)
        )

    return None, True


def _occupant_of(
    spiel: FLSpiel,
    stored: FLSpielTeamField | None,
    quelle: FLSpielQuelle | None,
    by_nr: Mapping[int, FLSpiel],
    standings: Mapping[FLGruppenNames, DecidedStanding],
    tainted: frozenset[int],
    memo: dict[int, ResolvedSides],
    faults: list[FLBracketFault],
) -> tuple[FLSpielTeamField | None, bool]:
    """
    Who one slot should hold, and whether this resolution maintains it at all.

    A `False` second value means leave the slot exactly as it stands. `(None, True)` is a different
    answer entirely: the reference resolves and names nobody, so the slot is emptied.
    """

    # No reference at all: a group-phase fixture, or a slot an admin has taken manual charge of by
    # clearing it. Nothing here writes one (ADR-0042).
    if quelle is None:
        return stored, False

    if isinstance(quelle, FLSpielQuelleGruppe):
        return _seed_from_gruppe(spiel, quelle, standings, faults)

    # A number this season has no match for, or a chain of references that closes on itself. Neither
    # states an outcome, so neither is an instruction to remove a team -- and both are REPORTED, because
    # a slot nothing maintains and nothing mentions is one an admin cannot discover (ADR-0047).
    if quelle.spiel_nr not in by_nr:
        faults.append(FLBracketFaultQuelle(reason="spiel_missing", spiel_id=spiel.id, spiel_nr=spiel.spiel_nr, quelle_spiel_nr=quelle.spiel_nr))
        return stored, False

    if quelle.spiel_nr in tainted:
        faults.append(
            FLBracketFaultQuelle(reason="reference_cycle", spiel_id=spiel.id, spiel_nr=spiel.spiel_nr, quelle_spiel_nr=quelle.spiel_nr)
        )
        return stored, False

    return _outcome_of(quelle.spiel_nr, quelle.ausgang, by_nr, standings, tainted, memo, faults), True


def _resolve_sides(
    spiel_nr: int,
    by_nr: Mapping[int, FLSpiel],
    standings: Mapping[FLGruppenNames, DecidedStanding],
    tainted: frozenset[int],
    memo: dict[int, ResolvedSides],
    faults: list[FLBracketFault],
) -> ResolvedSides:
    """
    The two sides one fixture should hold, and whether either occupant differs from the stored one.

    When the resolved side is who the fixture already holds, the STORED side is returned rather than a
    fresh copy, so the goals it has scored in this fixture survive. That is what lets `_outcome_of` read
    a result off an already-resolved fixture, and what makes the whole resolution idempotent.

    Memoised per fixture, which is also what stops a reported slot being reported twice: every side is
    resolved exactly once however many later fixtures depend on it.
    """

    if spiel_nr in memo:
        return memo[spiel_nr]

    spiel = by_nr[spiel_nr]
    sides: list[FLSpielTeamField | None] = []
    an_occupant_changed = False
    a_side_is_maintained = False

    for stored, quelle in ((spiel.team1, spiel.team1_quelle), (spiel.team2, spiel.team2_quelle)):
        occupant, is_maintained = _occupant_of(spiel, stored, quelle, by_nr, standings, tainted, memo, faults)
        a_side_is_maintained = a_side_is_maintained or is_maintained

        if not is_maintained or _is_same_team(occupant, stored):
            sides.append(stored)
            continue

        # Arriving in a new fixture, the team has scored nothing in it yet.
        sides.append(occupant.model_copy(update={"tore": None}) if occupant is not None else None)
        an_occupant_changed = True

    both_sides_one_club = sides[0] is not None and sides[1] is not None and sides[0].team_id == sides[1].team_id

    # Reported whether or not this pass would move an occupant, unlike the containment below. A fixture
    # hand-edited to already hold the club its own source resolves to stores the contradiction rather
    # than producing it, so nothing changes on any pass and the guard below never sees it -- and that
    # shape is exactly the one the write path cannot refuse, because its rules key a source by identity
    # and two DIFFERENT sources naming one club pass them all (ADR-0046, ADR-0047).
    #
    # Scoped to a fixture at least one of whose sides a source maintains: two hand-set sides holding one
    # club state no wiring fault, and this list is about wiring.
    if both_sides_one_club and a_side_is_maintained:
        faults.append(FLBracketFaultSpiel(reason="same_team", spiel_id=spiel.id, spiel_nr=spiel_nr))

    # Two references resolving to one club would make the fixture a team against itself -- typically
    # both slots naming the same match with the same `ausgang`, a data-entry mistake one digit away
    # from a real draw. Nothing downstream refuses the shape (a $jsonSchema validator may carry no
    # cross-field rule, ADR-0027), so it is refused here -- and the memo records the fixture as NOT
    # maintained, with its STORED sides standing. That last part is what contains the mistake: a memo
    # claiming the occupants changed would void this fixture's stored result for the pass, emptying
    # every fixture downstream of it and erasing results over a typo.
    if an_occupant_changed and both_sides_one_club:
        memo[spiel_nr] = (spiel.team1, spiel.team2, False)
        return memo[spiel_nr]

    memo[spiel_nr] = (sides[0], sides[1], an_occupant_changed)
    return memo[spiel_nr]


def _outcome_of(
    spiel_nr: int,
    ausgang: str,
    by_nr: Mapping[int, FLSpiel],
    standings: Mapping[FLGruppenNames, DecidedStanding],
    tainted: frozenset[int],
    memo: dict[int, ResolvedSides],
    faults: list[FLBracketFault],
) -> FLSpielTeamField | None:
    """
    The side that came out of one match as `ausgang`, or `None` while it has none.

    Assumes `spiel_nr` names a match in `by_nr` that is not in `tainted` -- `_occupant_of`, the only
    caller, checks both before asking, because a slot fed by a match nobody can look up is left alone
    rather than emptied.

    `is_canceled` is deliberately not consulted: a cancelled match carrying a result is a forfeit and
    counts exactly as any other result does (ADR-0026, invariant I1a). A fixture that finished level is
    decided by its shoot-out where one was played and by nothing else, so a level match without one
    still has neither a `sieger` nor a `verlierer` and the slot it feeds stays empty (ADR-0044).
    """

    spiel = by_nr[spiel_nr]
    team1, team2, an_occupant_changed = _resolve_sides(spiel_nr, by_nr, standings, tainted, memo, faults)

    # The stored result was scored by a side that is no longer in this fixture, so it is void for the
    # whole of this pass -- which is what carries a corrected quarter-final through to the final.
    if an_occupant_changed:
        return None

    # The same conjunction the league table counts on
    # (`fl_backend/app/api/teams/services.py :: build_statistik_lookup_stage`). A document hand-edited in
    # Compass can carry goals with no `ergebnis`, and advancing a winner from a match the table does not
    # count would put the two derivations at odds.
    if spiel.ergebnis is None or team1 is None or team2 is None or team1.tore is None or team2.tore is None:
        return None

    if team1.tore == team2.tore:
        # The one fixture the goals cannot decide. A shoot-out settles it, and its counts are read only
        # here -- the league table scores the match as the draw it was, so the bracket and the table say
        # different things about it on purpose (ADR-0044).
        #
        # A GRUPPENPHASE fixture is never settled that way: a group draw is a final result, worth a
        # point to each side and nothing more. The write path discards a shoot-out stored on one, so
        # this covers the hand-edited document instead -- the same reachable failure the `ergebnis`
        # conjunction below covers, and it is guarded here for the same reason.
        if spiel.saison_phase == "gruppenphase" or spiel.elfmeterschiessen is None:
            return None

        # Total, because `FLSpielElfmeterschiessen` refuses a level shoot-out: a record that named
        # nobody would leave this branch exactly where it was before the field existed.
        team1_won = spiel.elfmeterschiessen.team1 > spiel.elfmeterschiessen.team2
    else:
        team1_won = team1.tore > team2.tore

    winner, loser = (team1, team2) if team1_won else (team2, team1)

    return winner if ausgang == "sieger" else loser


def _fault_order(fault: FLBracketFault) -> tuple[int, str, str, int]:
    """
    One fault's place in the report.

    By fixture, then by reason, then by whatever separates two faults of the same reason on one
    fixture -- which is only ever its two sides.

    Spelled out per variant rather than read off a shared field set, because the variants deliberately
    do not have one: a cycle carries no `platz` and a group reference carries no `quelle_spiel_nr`.
    """

    if isinstance(fault, FLBracketFaultGruppe):
        return (fault.spiel_nr, fault.reason, fault.gruppe, fault.platz)
    if isinstance(fault, FLBracketFaultQuelle):
        return (fault.spiel_nr, fault.reason, "", fault.quelle_spiel_nr)
    return (fault.spiel_nr, fault.reason, "", 0)


def resolve_bracket(spiele: Iterable[FLSpiel], standings: Mapping[FLGruppenNames, DecidedStanding]) -> BracketResolution:
    """
    Every fixture in one season whose bracket slots hold something other than what its wiring says.

    The occupant of a slot referring to match 25 IS the side that came out of match 25, and the occupant
    of a slot referring to a group placing IS the team that has finished there beyond doubt -- recomputed
    from scratch on every call rather than appended to once, so a corrected result moves the right team
    in, a deleted one empties the slot again, and a bracket nobody has propagated yet resolves itself in
    full. Running it twice over the same season produces nothing the second time.

    `standings` comes from `fl_backend/app/api/teams/services.py :: build_decided_standings`. Pass an empty mapping
    to resolve match-fed slots alone: a `gruppe` reference with no standing behind it is then left
    exactly as it stands, which is also what a season whose groups nobody has computed should do.

    Pass ONE season. `spiel_nr` identifies a match within a season and repeats across them
    (`fl_backend/app/core/constraints.py :: UNIQUE_INDEXES`), so a wider list resolves references against
    the wrong matches.
    """

    by_nr = {spiel.spiel_nr: spiel for spiel in spiele}
    tainted = _fixtures_depending_on_a_cycle(by_nr)
    memo: dict[int, ResolvedSides] = {}
    faults: list[FLBracketFault] = []

    advancements: list[SlotAdvancement] = []
    for spiel_nr in sorted(by_nr):
        spiel = by_nr[spiel_nr]
        team1, team2, an_occupant_changed = _resolve_sides(spiel_nr, by_nr, standings, tainted, memo, faults)
        if not an_occupant_changed:
            continue

        # No same-team guard here: a fixture whose references resolve to one club never reports its
        # occupants as changed -- `_resolve_sides` memoises it as unmaintained, stored sides standing,
        # so it is skipped by the line above and its subtree keeps deriving from its stored state.

        # Both sides are written without goals, not only the one that moved. The other side's goals were
        # scored against the occupant being replaced, and `patch_spiel_data` refuses that shape on its
        # own write path for the same reason: goals standing against a fixture that has no result.
        advancements.append(
            SlotAdvancement(
                spiel_id=spiel.id,
                spiel_nr=spiel_nr,
                team1=team1.model_copy(update={"tore": None}) if team1 is not None else None,
                team2=team2.model_copy(update={"tore": None}) if team2 is not None else None,
                # Read off the fixture as it stands, which is what the write below is about to
                # replace. `None` here is the harmless case and says so (ADR-0051).
                voided_ergebnis=spiel.ergebnis,
                voided_elfmeterschiessen=spiel.elfmeterschiessen,
            )
        )

    # Sorted, so the report reads in bracket order rather than in the order the recursion happened to
    # reach each fixture.
    faults.sort(key=_fault_order)

    return BracketResolution(advancements=advancements, bracket_faults=faults)


def apply_payload_to_spiel(stored: FLSpiel, payload: FLPatchSpielDataPayload) -> FLSpiel:
    """
    The fixture as it stands once this patch is written -- every normalisation the write path applies.

    Three rules, none of which the client may state for itself:

    - **`ergebnis` is derived** from the two goal counts and never accepted (spec I3), so a client
      cannot submit a result that disagrees with the goals rendered beside it.
    - **An unresolved fixture carries no goals at all.** Clearing one side drops the result, and the
      goals the OTHER side still holds would then stand against a fixture that has none -- the
      hand-edited shape `build_statistik_lookup_stage` restates its `team1.tore` filter to survive.
    - **A shoot-out survives only on a KNOCKOUT fixture whose goals finished level** (ADR-0044). A
      group draw is a final result with no tie to break, and a shoot-out on a fixture one side won by
      goals is a contradiction. Discarded rather than refused, because the goals are what say whether
      one was possible at all.

    **Pure, and extracted so the preview and the save cannot disagree** (ADR-0051). `dry_run=true`
    applies this in memory and resolves the bracket against the result; the save applies the same
    function and writes it. A second copy of these three rules, however faithful, would eventually
    predict a result the save does not produce -- which is worse than predicting nothing.

    `model_copy` rather than a fresh construction: every field here has already been validated on the
    way in, and re-validating would be the only place `ergebnis` is ever checked against a pattern it
    was just built to satisfy.
    """

    # Read through both sides, either of which may be absent: a slot whose occupant is still unknown
    # has nobody to score, so an unresolved fixture derives no result at all rather than a partial one.
    both_sides_known = payload.team1 is not None and payload.team2 is not None
    team1_tore = payload.team1.tore if both_sides_known and payload.team1 is not None else None
    team2_tore = payload.team2.tore if both_sides_known and payload.team2 is not None else None

    ergebnis = f"{team1_tore}:{team2_tore}" if team1_tore is not None and team2_tore is not None else None

    is_knockout = stored.saison_phase != "gruppenphase"
    keeps_shoot_out = is_knockout and ergebnis is not None and team1_tore == team2_tore

    return stored.model_copy(
        update={
            "datum": payload.datum,
            "uhrzeit": payload.uhrzeit,
            "ort": payload.ort,
            "schiedsrichter": payload.schiedsrichter,
            # The goals go with the result: `team1_tore` is already `None` above whenever the other
            # side is absent, so this writes the stripped side rather than the submitted one.
            "team1": payload.team1.model_copy(update={"tore": team1_tore}) if payload.team1 is not None else None,
            "team2": payload.team2.model_copy(update={"tore": team2_tore}) if payload.team2 is not None else None,
            "team1_quelle": payload.team1_quelle,
            "team2_quelle": payload.team2_quelle,
            "ergebnis": ergebnis,
            "elfmeterschiessen": payload.elfmeterschiessen if keeps_shoot_out else None,
            "is_canceled": payload.is_canceled,
        }
    )


@dataclass(frozen=True)
class WriteRefusal:
    """
    Why the match write path refuses a patch: the code that reaches the client, and the English detail.

    The code is the whole channel. A failure body is `{error_code, correlation_id}` and nothing else
    (docs/logging.md, L4), so the message below is for the log and the code is what the form reads to
    decide which field the refusal belongs to (ADR-0052).
    """

    error_code: str
    message: str


# A team the season records as disqualified was newly fielded. Declared state, set by a person and
# changed by no result, so a payload fielding one contradicts the season as it stands at the write.
ELIGIBILITY_DISQUALIFIED = "REQ-ELIGIBILITY-001"

# A team newly fielded on a fixture of a season it holds no `saison_teams` row for. A dangling
# reference rather than an odd draw: the form offers only the season's teams, so this is a stale form
# or a hand-crafted request.
ELIGIBILITY_NO_MEMBERSHIP = "REQ-ELIGIBILITY-002"

# A team would stand in two fixtures of one Spieltag, and the side it would have to give up is one the
# resolution maintains -- so emptying it would be undone on the next pass.
SPIELTAG_OCCUPIED = "REQ-SPIELTAG-001"


def find_eligibility_refusal(
    spiel_id: CustomObjectId,
    payload: FLPatchSpielDataPayload,
    season: Sequence[FLSpiel],
    membership: Mapping[CustomObjectId, bool],
) -> WriteRefusal | None:
    """
    Why this patch's OCCUPANTS must be refused, or `None` when they are legal (ADR-0052).

    A sibling of `find_wiring_refusal` rather than a fifth rule inside it: that function's contract is
    that it decides wiring from wiring, and its input carries no membership data. The two also answer
    different codes, because the advice differs -- "reload the page" is right for a raced bracket and
    wrong for a team somebody disqualified.

    `membership` maps a team id to its `is_disqualified` for THIS season, read from `saison_teams`
    inside the caller's transaction. A team absent from it holds no row for the season at all, which is
    the second rule below.

    Both rules apply only to a team this payload NEWLY fields. Resubmitting the stored occupant
    unchanged passes, and it has to: without that clause a fixture already holding such a team becomes
    uneditable, including by the very edit that would resolve it -- and the fixture whose occupant was
    disqualified after being placed is exactly the one an admin needs to open (ADR-0047 reports it).

    A `spiel_id` naming no fixture in the season returns `None`: the write's own 404 is the answer
    there, not an eligibility message.
    """

    stored = next((spiel for spiel in season if spiel.id == spiel_id), None)
    if stored is None:
        return None

    for label, submitted, stored_side in (("team1", payload.team1, stored.team1), ("team2", payload.team2, stored.team2)):
        if submitted is None or (stored_side is not None and stored_side.team_id == submitted.team_id):
            continue

        if submitted.team_id not in membership:
            return WriteRefusal(
                error_code=ELIGIBILITY_NO_MEMBERSHIP,
                message=f"{label}: {submitted.name} has no saison_teams row for season {stored.saison_id}",
            )

        if membership[submitted.team_id]:
            return WriteRefusal(
                error_code=ELIGIBILITY_DISQUALIFIED,
                message=f"{label}: {submitted.name} is disqualified from season {stored.saison_id} and cannot be fielded",
            )

    return None


@dataclass(frozen=True)
class SpieltagRelease:
    """
    One side of another fixture that has to be emptied so a team can be fielded on this Spieltag.

    Carries what that fixture is about to lose for the same reason `SlotAdvancement` does: the write is
    one the caller never asked for, and a report naming only the fixture would describe the destruction
    of a recorded scoreline in the same words as the emptying of a slot that held nothing.
    """

    spiel_id: CustomObjectId
    spiel_nr: int
    side: Literal["team1", "team2"]
    team_name: str
    other_side_tore: bool
    voided_ergebnis: str | None
    voided_elfmeterschiessen: FLSpielElfmeterschiessen | None


@dataclass(frozen=True)
class SpieltagVerdict:
    """
    What fielding this payload's teams does to the rest of the Spieltag.

    Exactly one of the two is ever populated: a refusal means nothing is written at all, so a caller
    that reads `releases` without checking `refusal` first would act on a plan that was rejected.
    """

    refusal: WriteRefusal | None
    releases: list[SpieltagRelease]


def judge_spieltag_occupancy(spiel_id: CustomObjectId, payload: FLPatchSpielDataPayload, season: Sequence[FLSpiel]) -> SpieltagVerdict:
    """
    Where this payload's teams already stand on the same Spieltag, and whether that can be resolved.

    **A team plays at most one match per matchday**, which is a fact about football rather than a
    preference, and it is expressible in neither of the mechanisms the database applies: a
    `$jsonSchema` validator sees one document and a unique index reads one key, while the team sits in
    either of two embedded fields (ADR-0052). So the rule lives here, at the write path.

    The clash is resolved by MOVING, never by refusing, wherever the occupied side is the admin's own:
    fielding a team here is a statement about where it plays, and the other fixture is the one that has
    to give it up. Two cases refuse instead, and both refuse because moving would not stick or would
    undo the caller's own edit:

    - **The occupied side carries a `quelle`.** It is the resolution's, not a person's (ADR-0042), so
      emptying it is reverted on the next pass -- a write that reports success and does not hold.
    - **Both sides of THIS payload name one club.** The fixture would be a team against itself, and
      there is nothing to move it to: the only side to empty is one the caller has just filled in.

    The season list is read inside the caller's transaction and includes the fixture being patched. A
    `spiel_id` naming no fixture in it returns an empty verdict, exactly as the wiring refusal does.
    """

    stored = next((spiel for spiel in season if spiel.id == spiel_id), None)
    if stored is None:
        return SpieltagVerdict(refusal=None, releases=[])

    if payload.team1 is not None and payload.team2 is not None and payload.team1.team_id == payload.team2.team_id:
        return SpieltagVerdict(
            refusal=WriteRefusal(
                error_code=SPIELTAG_OCCUPIED,
                message=f"{payload.team1.name} is fielded on both sides of Spiel {stored.spiel_nr}",
            ),
            releases=[],
        )

    fielded = {side.team_id for side in (payload.team1, payload.team2) if side is not None}
    releases: list[SpieltagRelease] = []

    same_spieltag = (spiel for spiel in season if spiel.id != spiel_id and spiel.spieltag_id == stored.spieltag_id)

    # Sorted, so a refusal names the earliest offending fixture rather than whichever the read
    # happened to return first -- and so two runs over one season plan the same releases.
    for other in sorted(same_spieltag, key=lambda spiel: spiel.spiel_nr):
        sides: tuple[tuple[Literal["team1", "team2"], FLSpielTeamField | None, FLSpielQuelle | None], ...] = (
            ("team1", other.team1, other.team1_quelle),
            ("team2", other.team2, other.team2_quelle),
        )

        for label, occupant, quelle in sides:
            if occupant is None or occupant.team_id not in fielded:
                continue

            if quelle is not None:
                return SpieltagVerdict(
                    refusal=WriteRefusal(
                        error_code=SPIELTAG_OCCUPIED,
                        message=(
                            f"{occupant.name} already plays Spiel {other.spiel_nr} on this Spieltag, "
                            f"on a side maintained by its quelle -- clear that quelle to move the team"
                        ),
                    ),
                    releases=[],
                )

            releases.append(
                SpieltagRelease(
                    spiel_id=other.id,
                    spiel_nr=other.spiel_nr,
                    side=label,
                    team_name=occupant.name,
                    # Whether the side left behind still holds goals. It does not keep them: they were
                    # scored against the team being removed, which is the same rule the resolution
                    # applies when an occupant changes.
                    other_side_tore=(other.team2 if label == "team1" else other.team1) is not None,
                    voided_ergebnis=other.ergebnis,
                    voided_elfmeterschiessen=other.elfmeterschiessen,
                )
            )

    return SpieltagVerdict(refusal=None, releases=releases)


# The rounds in the order they are played. What the refusal below needs is only "strictly earlier",
# so a new phase slots in by rank without touching the rules that read this.
PHASE_RANK: Mapping[FLSaisonPhase, int] = {"gruppenphase": 0, "viertelfinale": 1, "halbfinale": 2, "finale": 3}


def _quelle_key(quelle: FLSpielQuelle) -> tuple[Any, ...]:
    """One source as a hashable identity, so 'the same outcome feeding two slots' is a set lookup."""

    if isinstance(quelle, FLSpielQuelleSpiel):
        return ("spiel", quelle.spiel_nr, quelle.ausgang)
    return ("gruppe", quelle.gruppe, quelle.platz)


def find_wiring_refusal(spiel_id: CustomObjectId, payload: FLPatchSpielDataPayload, season: Sequence[FLSpiel]) -> str | None:
    """
    Why this patch's bracket wiring must be refused, or `None` when it is legal (ADR-0046).

    Four rules, each a contradiction no season can hold — not a preference, and not a guess about how
    a draw should look:

    - **A Gruppenphase fixture carries no wiring.** Its sides are drawn by the schedule; a source on
      one names a mechanism that does not exist in that phase.
    - **A `spiel` source names a played-earlier knockout match of the same season.** A number the
      season does not have resolves to nothing forever; a source in the same or a later round —
      the fixture itself included — asks a match to be decided by one that follows it, which is also
      what makes a cycle inexpressible through this endpoint. A group match never feeds a slot: the
      first knockout round is seeded from the standings, every later round by matches (ADR-0042).
    - **One outcome fills one slot.** A `(spiel_nr, ausgang)` or `(gruppe, platz)` already feeding
      another slot of the season would put the same side into two fixtures of the bracket.
    - **A side with a source is the resolution's, not the caller's.** A team submitted against it
      that differs from the stored occupant would be silently reverted by the resolution inside this
      same request (ADR-0042) — a write that reports success and does not stick. Refusing it turns
      the stale-form race into an explicit 409 instead.

    The season list is read inside the caller's transaction and INCLUDES the fixture being patched,
    in its stored state. A `spiel_id` naming no fixture in it returns `None`: the write's own 404 is
    the answer there, not a wiring message.

    This refusal exists at the WRITE PATH only. `resolve_bracket` keeps its non-destructive
    containment for the same shapes, because a season hand-edited in Compass never passed through
    here and erasing teams over a typo destroys more than it reports (ADR-0042).
    """

    stored = next((spiel for spiel in season if spiel.id == spiel_id), None)
    if stored is None:
        return None

    by_nr = {spiel.spiel_nr: spiel for spiel in season}
    used = {
        _quelle_key(quelle)
        for spiel in season
        if spiel.id != spiel_id
        for quelle in (spiel.team1_quelle, spiel.team2_quelle)
        if quelle is not None
    }

    sides = (("team1", payload.team1, payload.team1_quelle), ("team2", payload.team2, payload.team2_quelle))

    for label, _, quelle in sides:
        if quelle is None:
            continue

        if stored.saison_phase == "gruppenphase":
            return f"{label}_quelle: a Gruppenphase fixture carries no wiring; its sides are drawn by the schedule"

        if isinstance(quelle, FLSpielQuelleSpiel):
            source = by_nr.get(quelle.spiel_nr)
            if source is None:
                return f"{label}_quelle names Spiel {quelle.spiel_nr}, and this season has no such match"
            if source.saison_phase == "gruppenphase":
                return f"{label}_quelle names Spiel {quelle.spiel_nr}, a Gruppenphase match; a bracket slot is never fed by one"
            if PHASE_RANK[source.saison_phase] >= PHASE_RANK[stored.saison_phase]:
                return (
                    f"{label}_quelle names Spiel {quelle.spiel_nr} ({source.saison_phase}), "
                    f"which is not played before this fixture ({stored.saison_phase})"
                )

        key = _quelle_key(quelle)
        if key in used:
            return f"{label}_quelle: this source already feeds another slot of the season"
        used.add(key)

    for label, team, quelle in sides:
        if quelle is None:
            continue

        stored_team = stored.team1 if label == "team1" else stored.team2
        stored_id = stored_team.team_id if stored_team is not None else None
        submitted_id = team.team_id if team is not None else None
        if stored_id != submitted_id:
            return f"{label} is maintained by its quelle and cannot be set by hand; clear the quelle to take the slot over"

    return None
