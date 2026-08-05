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
  • Only the `spiel` variant resolves today. A `gruppe` variant is stored, displayed and left alone: the
    group standing has no total order and nothing records how many teams advance, so seeding from it
    would assert a placing the data cannot support. Open item FB-10 is that work.
  • `resolve_bracket` returns typed model values and never a Mongo update document. Serialising an
    embedded team is a storage concern and belongs in `crud.py`, which knows about `keep_oid`.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/glossary.md -- spiel_status, for the two definitions side by side
  docs/_decisions/0042-a-result-entry-resolves-the-whole-bracket.md -- the model and the algorithm
"""

from dataclasses import dataclass
from typing import Any, Iterable, Mapping

from app.api.spiele.schemas import FLSpiel, FLSpieleFilterParams, FLSpielQuelle, FLSpielQuelleSpiel, FLSpielTeamField
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
    The match a slot is fed by, or `None` when nothing here can resolve it.

    `None` covers three situations that all mean "leave this slot alone": no `quelle` at all, which is a
    group-phase fixture or a slot an admin has taken manual charge of; and a `gruppe` quelle, which is a
    first knockout round seeded from the standings and is FB-10's work rather than this function's. Only
    the `spiel` variant names something resolvable today.
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


def _resolve_sides(spiel_nr: int, by_nr: Mapping[int, FLSpiel], tainted: frozenset[int], memo: dict[int, ResolvedSides]) -> ResolvedSides:
    """
    The two sides one fixture should hold, and whether either occupant differs from the stored one.

    A side with no resolvable `quelle` is the fixture's own and passes through untouched. A side naming
    an earlier match is the winner of it -- and when that winner is who the fixture already holds, the
    STORED side is returned rather than a fresh copy, so the goals it has scored in this fixture survive.
    That is what lets `_winner_of` read a result off an already-resolved fixture, and what makes the
    whole resolution idempotent.

    **A slot is only ever written when the match it names can actually be looked up.** "No winner yet"
    empties the slot, because that is what the reference says and it is how a corrected result reaches
    the final. "Nothing to look up" -- a `spiel_nr` this season has no match for, or a chain that closes
    on itself -- leaves the fixture as it stands: erasing a team over a broken reference would destroy
    more than it reports.
    """

    if spiel_nr in memo:
        return memo[spiel_nr]

    spiel = by_nr[spiel_nr]
    sides: list[FLSpielTeamField | None] = []
    an_occupant_changed = False

    for stored, quelle in ((spiel.team1, spiel.team1_quelle), (spiel.team2, spiel.team2_quelle)):
        source_nr = _source_spiel_nr(quelle)
        if source_nr is None or source_nr not in by_nr or source_nr in tainted:
            sides.append(stored)
            continue

        winner = _winner_of(source_nr, by_nr, tainted, memo)
        if _is_same_team(winner, stored):
            sides.append(stored)
            continue

        # Arriving in a new fixture, the winner has scored nothing in it yet.
        sides.append(winner.model_copy(update={"tore": None}) if winner is not None else None)
        an_occupant_changed = True

    memo[spiel_nr] = (sides[0], sides[1], an_occupant_changed)
    return memo[spiel_nr]


def _winner_of(spiel_nr: int, by_nr: Mapping[int, FLSpiel], tainted: frozenset[int], memo: dict[int, ResolvedSides]) -> FLSpielTeamField | None:
    """
    The team that won one match, or `None` while it has no winner.

    Assumes `spiel_nr` names a match in `by_nr` that is not in `tainted` -- `_resolve_sides`, the only
    caller, checks both before asking, because a slot fed by a match nobody can look up is left alone
    rather than emptied.

    `is_canceled` is deliberately not consulted: a cancelled match carrying a result is a forfeit and
    counts exactly as any other result does (ADR-0026, invariant I1a). A draw decides nothing, and a
    knockout that ends level has no way to record how it was actually settled -- the fixture stalls until
    an admin clears the `quelle` and names a side (open item FB-8).
    """

    spiel = by_nr[spiel_nr]
    team1, team2, an_occupant_changed = _resolve_sides(spiel_nr, by_nr, tainted, memo)

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

    if team1.tore > team2.tore:
        return team1
    if team2.tore > team1.tore:
        return team2
    return None


def resolve_bracket(spiele: Iterable[FLSpiel]) -> list[SlotAdvancement]:
    """
    Every fixture in one season whose bracket slots hold something other than what its wiring says.

    The occupant of a slot referring to match 25 IS the winner of match 25, recomputed from scratch on
    every call rather than appended to once -- so a corrected result moves the right team in, a deleted
    one empties the slot again, and a bracket nobody has propagated yet resolves itself in full. Running
    it twice over the same season produces nothing the second time.

    Pass ONE season. `spiel_nr` identifies a match within a season and repeats across them
    (`fl_backend/app/core/constraints.py :: UNIQUE_INDEXES`), so a wider list resolves references against
    the wrong matches.
    """

    by_nr = {spiel.spiel_nr: spiel for spiel in spiele}
    tainted = _fixtures_depending_on_a_cycle(by_nr)
    memo: dict[int, ResolvedSides] = {}

    advancements: list[SlotAdvancement] = []
    for spiel_nr in sorted(by_nr):
        spiel = by_nr[spiel_nr]
        team1, team2, an_occupant_changed = _resolve_sides(spiel_nr, by_nr, tainted, memo)
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

    return advancements
