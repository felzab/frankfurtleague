"""
SPIELE · query construction, and the playoff bracket

Two pure halves. `build_spiele_filter` / `build_spiele_sort` translate `FLSpieleFilterParams` into a
Mongo filter document and a sort specification. `resolve_bracket` computes what every bracket slot in a
season should hold. Pure throughout -- no I/O, no collection access -- which is what makes both the
query semantics and the whole advancement algorithm testable without a database.

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
  • "Nothing to look up" LEAVES A SLOT ALONE; "the reference names nobody" EMPTIES it. The first covers a
    `spiel_nr` the season has no match for, a chain of references that closes on itself, and a `platz`
    its group can never produce -- all data-entry mistakes, and erasing a team over one destroys more
    than it reports. The second is a real answer and is how a corrected result reaches the final.
  • A placing that is not decided YET is nobody's problem and is reported to nobody. Only the two states
    a further result cannot fix reach `unresolvable_slots`.
  • `resolve_bracket` returns typed model values and never a Mongo update document. Serialising an
    embedded team is a storage concern and belongs in `crud.py`, which knows about `keep_oid`.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/glossary.md -- spiel_status, for the two definitions side by side
  docs/_decisions/0042-a-result-entry-resolves-the-whole-bracket.md -- the model and the algorithm
  docs/_decisions/0043-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md
"""

from dataclasses import dataclass
from typing import Any, Iterable, Mapping

from app.api.spiele.schemas import (
    FLSpiel,
    FLSpieleFilterParams,
    FLSpielQuelle,
    FLSpielQuelleGruppe,
    FLSpielQuelleSpiel,
    FLSpielTeamField,
    FLUnresolvableSlot,
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
    """

    spiel_id: CustomObjectId
    spiel_nr: int
    team1: FLSpielTeamField | None
    team2: FLSpielTeamField | None


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
    What one season's bracket should hold, and which of its references cannot be honoured.

    `advancements` are the fixtures to write. `unresolvable_slots` are the `gruppe` references that need
    a person rather than another result -- reported alongside the writes rather than instead of them,
    because one broken reference is no reason to leave the rest of the bracket unresolved.
    """

    advancements: list[SlotAdvancement]
    unresolvable_slots: list[FLUnresolvableSlot]


def _seed_from_gruppe(
    spiel_nr: int,
    quelle: FLSpielQuelleGruppe,
    standings: Mapping[FLGruppenNames, DecidedStanding],
    unresolvable: list[FLUnresolvableSlot],
) -> tuple[FLSpielTeamField | None, bool]:
    """
    The team a group placing seeds into a slot, and whether this resolution maintains that slot at all.

    Three answers, and the middle one is the ordinary state of a running competition:

    - **The placing is decided** -- the team, to be written in.
    - **It is not decided yet** -- nobody, and the slot is emptied. The reference genuinely names no
      team, exactly as a match with no winner does, so a slot seeded from an earlier state of the table
      gives that team back the moment a result stops supporting it.
    - **It can never be decided** -- reported, and the slot is left alone or emptied depending on which
      of the two states it is (see `FLUnresolvableSlot`).

    An absent standing means none was supplied for this season, so nothing is derived and nothing is
    reported. That is not the same as a group with no teams, which arrives as a standing with none.
    """

    standing = standings.get(quelle.gruppe)
    if standing is None:
        return None, False

    # A placing this group can never produce -- fewer teams than the number asks for. A typo, so the
    # slot keeps whatever it holds, on the same reasoning as a `spiel_nr` naming no match (ADR-0042).
    if quelle.platz > standing.eligible:
        unresolvable.append(FLUnresolvableSlot(spiel_nr=spiel_nr, gruppe=quelle.gruppe, platz=quelle.platz, reason="gruppe_too_small"))
        return None, False

    team = standing.by_platz.get(quelle.platz)
    if team is not None:
        # Arriving in a new fixture, the team has scored nothing in it yet.
        return FLSpielTeamField(team_id=team.id, name=team.name, shorthand=team.shorthand, tore=None), True

    # Played out and still level on every criterion. Reported, and the slot is emptied with it: naming
    # either team would be a guess, and the route past it is to clear the `quelle` and enter a side.
    if standing.is_complete:
        unresolvable.append(FLUnresolvableSlot(spiel_nr=spiel_nr, gruppe=quelle.gruppe, platz=quelle.platz, reason="tie_unresolved"))

    return None, True


def _occupant_of(
    spiel_nr: int,
    stored: FLSpielTeamField | None,
    quelle: FLSpielQuelle | None,
    by_nr: Mapping[int, FLSpiel],
    standings: Mapping[FLGruppenNames, DecidedStanding],
    tainted: frozenset[int],
    memo: dict[int, ResolvedSides],
    unresolvable: list[FLUnresolvableSlot],
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
        return _seed_from_gruppe(spiel_nr, quelle, standings, unresolvable)

    # A number this season has no match for, or a chain of references that closes on itself. Neither
    # states an outcome, so neither is an instruction to remove a team.
    if quelle.spiel_nr not in by_nr or quelle.spiel_nr in tainted:
        return stored, False

    return _outcome_of(quelle.spiel_nr, quelle.ausgang, by_nr, standings, tainted, memo, unresolvable), True


def _resolve_sides(
    spiel_nr: int,
    by_nr: Mapping[int, FLSpiel],
    standings: Mapping[FLGruppenNames, DecidedStanding],
    tainted: frozenset[int],
    memo: dict[int, ResolvedSides],
    unresolvable: list[FLUnresolvableSlot],
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

    for stored, quelle in ((spiel.team1, spiel.team1_quelle), (spiel.team2, spiel.team2_quelle)):
        occupant, is_maintained = _occupant_of(spiel_nr, stored, quelle, by_nr, standings, tainted, memo, unresolvable)

        if not is_maintained or _is_same_team(occupant, stored):
            sides.append(stored)
            continue

        # Arriving in a new fixture, the team has scored nothing in it yet.
        sides.append(occupant.model_copy(update={"tore": None}) if occupant is not None else None)
        an_occupant_changed = True

    memo[spiel_nr] = (sides[0], sides[1], an_occupant_changed)
    return memo[spiel_nr]


def _outcome_of(
    spiel_nr: int,
    ausgang: str,
    by_nr: Mapping[int, FLSpiel],
    standings: Mapping[FLGruppenNames, DecidedStanding],
    tainted: frozenset[int],
    memo: dict[int, ResolvedSides],
    unresolvable: list[FLUnresolvableSlot],
) -> FLSpielTeamField | None:
    """
    The side that came out of one match as `ausgang`, or `None` while it has none.

    Assumes `spiel_nr` names a match in `by_nr` that is not in `tainted` -- `_occupant_of`, the only
    caller, checks both before asking, because a slot fed by a match nobody can look up is left alone
    rather than emptied.

    `is_canceled` is deliberately not consulted: a cancelled match carrying a result is a forfeit and
    counts exactly as any other result does (ADR-0026, invariant I1a). A draw has neither a `sieger` nor
    a `verlierer`, so both spellings resolve to nobody -- a knockout that ends level has no way to record
    how it was actually settled, and the fixture stalls until an admin clears the `quelle` and names a
    side (open item FB-8).
    """

    spiel = by_nr[spiel_nr]
    team1, team2, an_occupant_changed = _resolve_sides(spiel_nr, by_nr, standings, tainted, memo, unresolvable)

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
        return None

    winner, loser = (team1, team2) if team1.tore > team2.tore else (team2, team1)

    return winner if ausgang == "sieger" else loser


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
    unresolvable: list[FLUnresolvableSlot] = []

    advancements: list[SlotAdvancement] = []
    for spiel_nr in sorted(by_nr):
        spiel = by_nr[spiel_nr]
        team1, team2, an_occupant_changed = _resolve_sides(spiel_nr, by_nr, standings, tainted, memo, unresolvable)
        if not an_occupant_changed:
            continue

        # A fixture cannot be a team against itself, and two references naming the same match with the
        # same `ausgang` would produce exactly that. Nothing downstream refuses it -- a $jsonSchema
        # validator may carry no cross-field rule (ADR-0027) -- so it is refused here, by writing
        # nothing: the fixture keeps what it holds and reports as unmoved.
        if team1 is not None and team2 is not None and team1.team_id == team2.team_id:
            continue

        # Both sides are written without goals, not only the one that moved. The other side's goals were
        # scored against the occupant being replaced, and `patch_spiel_data` refuses that shape on its
        # own write path for the same reason: goals standing against a fixture that has no result.
        advancements.append(
            SlotAdvancement(
                spiel_id=spiel.id,
                spiel_nr=spiel_nr,
                team1=team1.model_copy(update={"tore": None}) if team1 is not None else None,
                team2=team2.model_copy(update={"tore": None}) if team2 is not None else None,
            )
        )

    # Sorted, so the report reads in bracket order rather than in the order the recursion happened to
    # reach each fixture.
    unresolvable.sort(key=lambda slot: (slot.spiel_nr, slot.gruppe, slot.platz))

    return BracketResolution(advancements=advancements, unresolvable_slots=unresolvable)
