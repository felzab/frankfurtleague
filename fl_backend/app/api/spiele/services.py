from dataclasses import dataclass
from typing import Any, Iterable, Literal, Mapping, Sequence

from app.api.spiele.schemas import (
    PHASE_RANK,
    FLBracketFault,
    FLBracketFaultGruppe,
    FLBracketFaultOccupant,
    FLBracketFaultQuelle,
    FLBracketFaultSpiel,
    FLPatchSpielDataPayload,
    FLSpiel,
    FLSpieleFilterParams,
    FLSpielElfmeterschiessen,
    FLSpielJoined,
    FLSpielQuelle,
    FLSpielQuelleGruppe,
    FLSpielQuelleSpiel,
    FLSpielTeamField,
    FLSpielTeamFieldJoined,
)
from app.api.teams.schemas import FLGruppenNames
from app.api.teams.services import DecidedStanding
from app.core.collections import Collection
from app.core.crud import build_query, build_sort
from app.core.exceptions import WriteRefusal
from app.shared.schemas.custom import CustomObjectId


def build_spiele_sort(sort_by: str, order: str) -> list[tuple[str, int]]:
    if sort_by == "datum":
        return build_sort(sort_by=sort_by, order=order, chain=(("spiel_nr", 1),))
    if sort_by == "spiel_nr":
        return build_sort(sort_by=sort_by, order=order, chain=(("datum", 1),))

    # `datum` follows the request while `spiel_nr` stays ascending: this code is what defines the
    # order (PRE-1), and moving the asymmetry is its own change rather than a side effect of one.
    direction = 1 if order == "asc" else -1
    return build_sort(sort_by=sort_by, order=order, chain=(("datum", direction), ("spiel_nr", 1)))


def build_spiele_filter(filters: FLSpieleFilterParams, today: str) -> dict[str, Any]:
    compiled: dict[str, Any] = {}

    if filters.saison_phase == "playoffs":
        compiled["saison_phase"] = {"$ne": "gruppenphase"}

    match filters.spiel_status:
        case "heute":
            compiled["datum"] = today
        case "vergangen":
            compiled["datum"] = {"$lt": today}
        case "ausstehend":
            compiled["datum"] = {"$gte": today}
        case "abgesagt":
            compiled["is_canceled"] = True

    if filters.team_id is not None:
        compiled["$or"] = [
            {"team1.team_id": filters.team_id},
            {"team2.team_id": filters.team_id},
        ]

    return build_query(filters, terms={"saison_id", "saison_phase"}, compiled=compiled)


SAISON_TEAMS_AS_NAME = "saison_teams_rows"


def _joined_side(side: Literal["team1", "team2"]) -> Mapping[str, Any]:
    """One side with its season state folded in. `$mergeObjects`, never a rebuilt object: listing the keys copies `FLSpielTeamField`."""

    # Not `$getField`, which needs MongoDB 5.0: the test tier's container cannot speak for the
    # production server's version.
    matching_row = {"$filter": {"input": f"${SAISON_TEAMS_AS_NAME}", "cond": {"$eq": ["$$this.team_id", f"${side}.team_id"]}}}
    joined_record = {
        "$let": {
            "vars": {"row": {"$first": matching_row}},
            "in": {"$ifNull": ["$$row.disqualifikation", None]},
        }
    }

    return {
        "$cond": [
            # `$eq` against null also catches a document missing the key, so an unresolved slot
            # never becomes an object holding only a disqualification.
            {"$eq": [f"${side}", None]},
            None,
            {"$mergeObjects": [f"${side}", {"disqualifikation": joined_record}]},
        ]
    }


def build_spiele_pipeline(
    db_filter: Mapping[str, Any],
    sort_by: Sequence[tuple[str, int]] | None = None,
    limit: int | None = None,
) -> list[Mapping[str, Any]]:
    """Every match read runs this; `disqualifikation` joins on each document's OWN `saison_id` (`docs/backend/spec.md :: I32`)."""

    pipeline: list[Mapping[str, Any]] = [{"$match": db_filter}]

    if sort_by is not None:
        # A dict, so `$sort` keeps its order; safe only while `build_spiele_sort` repeats no key.
        pipeline.append({"$sort": dict(sort_by)})

    if limit is not None:
        pipeline.append({"$limit": limit})

    pipeline.append(
        {
            "$lookup": {
                "from": Collection.SAISON_TEAMS,
                "let": {
                    "spiel_saison_id": "$saison_id",
                    # `$ifNull`, not the bare path: a null side makes `$teamN.team_id` MISSING, and
                    # a missing element shifts the other into its position.
                    "team1_id": {"$ifNull": ["$team1.team_id", None]},
                    "team2_id": {"$ifNull": ["$team2.team_id", None]},
                },
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$and": [
                                    {"$eq": ["$saison_id", "$$spiel_saison_id"]},
                                    # No junction row carries a null `team_id`, so a null slot
                                    # matches nothing rather than a row by accident.
                                    {"$in": ["$team_id", ["$$team1_id", "$$team2_id"]]},
                                ]
                            }
                        }
                    },
                    {"$project": {"_id": 0, "team_id": 1, "disqualifikation": 1}},
                ],
                "as": SAISON_TEAMS_AS_NAME,
            }
        }
    )

    pipeline.append({"$set": {"team1": _joined_side("team1"), "team2": _joined_side("team2")}})

    # Dropped, because Pydantic's `extra="ignore"` would let these scratch rows ride on every
    # response with nothing reporting them.
    pipeline.append({"$unset": SAISON_TEAMS_AS_NAME})

    return pipeline


# The `bool` says whether either side differs from the occupant stored.
ResolvedSides = tuple[FLSpielTeamField | None, FLSpielTeamField | None, bool]


@dataclass(frozen=True)
class SlotAdvancement:
    """One fixture whose slots resolve to something other than what it stores; goals go with the occupant that left."""

    spiel_id: CustomObjectId
    spiel_nr: int
    team1: FLSpielTeamField | None
    team2: FLSpielTeamField | None
    voided_ergebnis: str | None
    voided_elfmeterschiessen: FLSpielElfmeterschiessen | None


def _source_spiel_nr(quelle: FLSpielQuelle | None) -> int | None:
    """The match a slot is fed by. A `gruppe` reference answers `None`: only fixture edges cycle."""

    return quelle.spiel_nr if isinstance(quelle, FLSpielQuelleSpiel) else None


def _is_same_team(left: FLSpielTeamField | None, right: FLSpielTeamField | None) -> bool:
    """The same club, by id alone: `name` and `shorthand` are display copies `PATCH /teams/{team_id}` maintains."""

    if left is None or right is None:
        return left is None and right is None

    return left.team_id == right.team_id


def _fixtures_depending_on_a_cycle(by_nr: Mapping[int, FLSpiel]) -> frozenset[int]:
    """Every fixture depending, directly or transitively, on a cyclic chain: nothing downstream is derivable."""

    IN_PROGRESS, DONE = 1, 2
    state: dict[int, int] = {}
    tainted: set[int] = set()

    def visit(spiel_nr: int) -> bool:
        if state.get(spiel_nr) == IN_PROGRESS:
            return True
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

    # Sorted, so the traversal and every memoised answer below it are decided by the input.
    for spiel_nr in sorted(by_nr):
        visit(spiel_nr)

    return frozenset(tainted)


@dataclass(frozen=True)
class BracketResolution:
    """What one season's bracket should hold. Faults are reported ALONGSIDE the writes, never instead of them."""

    advancements: list[SlotAdvancement]
    bracket_faults: list[FLBracketFault]


def _seed_from_gruppe(
    spiel: FLSpiel,
    quelle: FLSpielQuelleGruppe,
    standings: Mapping[FLGruppenNames, DecidedStanding],
    faults: list[FLBracketFault],
) -> tuple[FLSpielTeamField | None, bool]:
    """The team a group placing seeds in, and whether that maintains the slot.

    An undecided placing EMPTIES it: seeding from an earlier state of the table would hand a team
    back the moment a result stops supporting it.
    """

    standing = standings.get(quelle.gruppe)
    if standing is None:
        # No standing supplied for this season. Not a group with no teams, which arrives as a
        # standing holding none.
        return None, False

    # A placing this group can never produce reads as a typo, so the slot keeps what it holds.
    if quelle.platz > standing.eligible:
        faults.append(
            FLBracketFaultGruppe(
                reason="gruppe_too_small", spiel_id=spiel.id, spiel_nr=spiel.spiel_nr, gruppe=quelle.gruppe, platz=quelle.platz
            )
        )
        return None, False

    team = standing.by_platz.get(quelle.platz)
    if team is not None:
        return FLSpielTeamField(team_id=team.id, name=team.name, shorthand=team.shorthand, tore=None), True

    # Played out and still level on every criterion: naming either team would be a guess, so the
    # slot is emptied and the way past it is to clear the `quelle` by hand.
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
    """Who one slot should hold. `False` leaves the slot as it stands; `(None, True)` empties it."""

    # No reference: a group fixture, or a slot an admin took over by clearing it.
    if quelle is None:
        return stored, False

    if isinstance(quelle, FLSpielQuelleGruppe):
        return _seed_from_gruppe(spiel, quelle, standings, faults)

    # Neither a dangling number nor a cycle states an outcome, so neither removes a team -- and both
    # are reported, because a slot nothing mentions is one an admin cannot discover.
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
    """The two sides one fixture should hold. The STORED side is kept where it is correct, so its goals survive."""

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

        sides.append(occupant.model_copy(update={"tore": None}) if occupant is not None else None)
        an_occupant_changed = True

    both_sides_one_club = sides[0] is not None and sides[1] is not None and sides[0].team_id == sides[1].team_id

    # Reported even where nothing moves: a fixture already holding the club its source resolves to
    # stores the contradiction rather than producing it, and the write path cannot refuse that.
    if both_sides_one_club and a_side_is_maintained:
        faults.append(FLBracketFaultSpiel(reason="same_team", spiel_id=spiel.id, spiel_nr=spiel_nr))

    # Recorded as NOT maintained: claiming a change would void this result and the whole subtree's.
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
    """The side that came out of one match as `ausgang`. `is_canceled` is not consulted (`docs/backend/spec.md :: I1a`)."""

    spiel = by_nr[spiel_nr]
    team1, team2, an_occupant_changed = _resolve_sides(spiel_nr, by_nr, standings, tainted, memo, faults)

    # The stored result was scored by a side no longer in the fixture, so it is void for this whole
    # pass -- which is what carries a corrected quarter-final through to the final.
    if an_occupant_changed:
        return None

    # A hand edit can carry goals with no `ergebnis`; advancing from a match the table skips would
    # put the two at odds (`fl_backend/app/api/teams/services.py :: build_statistik_lookup_stage`).
    if spiel.ergebnis is None or team1 is None or team2 is None or team1.tore is None or team2.tore is None:
        return None

    if team1.tore == team2.tore:
        # Read only here, so the bracket and the table disagree about this fixture on purpose
        # (`docs/backend/spec.md :: I25a`). A group draw is final; that arm covers a hand edit.
        if spiel.saison_phase == "gruppenphase" or spiel.elfmeterschiessen is None:
            return None

        # Total, because `FLSpielElfmeterschiessen` refuses a level shoot-out.
        team1_won = spiel.elfmeterschiessen.team1 > spiel.elfmeterschiessen.team2
    else:
        team1_won = team1.tore > team2.tore

    winner, loser = (team1, team2) if team1_won else (team2, team1)

    return winner if ausgang == "sieger" else loser


def _fault_order(fault: FLBracketFault) -> tuple[int, str, str, int]:
    """One fault's place in the report, spelled out per variant because the variants share no field set."""

    if isinstance(fault, FLBracketFaultGruppe):
        return (fault.spiel_nr, fault.reason, fault.gruppe, fault.platz)
    if isinstance(fault, FLBracketFaultQuelle):
        return (fault.spiel_nr, fault.reason, "", fault.quelle_spiel_nr)
    return (fault.spiel_nr, fault.reason, "", 0)


def resolve_bracket(spiele: Iterable[FLSpiel], standings: Mapping[FLGruppenNames, DecidedStanding]) -> BracketResolution:
    """Every fixture whose slots disagree with its wiring. Pass ONE season: `spiel_nr` repeats across seasons."""

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

        # BOTH sides lose their goals, not only the one that moved: the other side scored against
        # the occupant being replaced.
        advancements.append(
            SlotAdvancement(
                spiel_id=spiel.id,
                spiel_nr=spiel_nr,
                team1=team1.model_copy(update={"tore": None}) if team1 is not None else None,
                team2=team2.model_copy(update={"tore": None}) if team2 is not None else None,
                voided_ergebnis=spiel.ergebnis,
                voided_elfmeterschiessen=spiel.elfmeterschiessen,
            )
        )

    # Bracket order, not the order the recursion happened to reach each fixture.
    faults.sort(key=_fault_order)

    return BracketResolution(advancements=advancements, bracket_faults=faults)


def apply_payload_to_spiel(stored: FLSpiel, payload: FLPatchSpielDataPayload) -> FLSpiel:
    """The fixture as this patch leaves it; the save and the `dry_run` preview share it (`docs/backend/spec.md :: I29`)."""

    # An unresolved slot has nobody to score, so an unresolved fixture carries NO goals rather than
    # the partial result `build_statistik_lookup_stage` has to filter against.
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
            "team1": payload.team1.model_copy(update={"tore": team1_tore}) if payload.team1 is not None else None,
            "team2": payload.team2.model_copy(update={"tore": team2_tore}) if payload.team2 is not None else None,
            "team1_quelle": payload.team1_quelle,
            "team2_quelle": payload.team2_quelle,
            "ergebnis": ergebnis,
            "elfmeterschiessen": payload.elfmeterschiessen if keeps_shoot_out else None,
            "is_canceled": payload.is_canceled,
            "notiz": payload.notiz,
        }
    )


def stored_in_slice(spiel_id: CustomObjectId, season: Sequence[FLSpiel]) -> FLSpiel:
    """The fixture under edit, from the caller's slice (`docs/backend/spec.md :: I45`).

    Absent means a truncated or wrong-season slice: the route has already read this `_id`. A
    refusal that permits what it cannot see is the wrong default.
    """

    stored = next((spiel for spiel in season if spiel.id == spiel_id), None)
    if stored is None:
        raise ValueError(f"the season slice does not hold spiel {spiel_id}, so no refusal over it can be trusted")

    return stored


# What each code refuses is `docs/backend/spec.md` §1.4.
ELIGIBILITY_DISQUALIFIED = "REQ-ELIGIBILITY-001"
ELIGIBILITY_NO_MEMBERSHIP = "REQ-ELIGIBILITY-002"
SPIELTAG_OCCUPIED = "REQ-SPIELTAG-001"
RESULT_SIDE_EMPTIED = "REQ-RESULT-001"


def find_eligibility_refusal(
    spiel_id: CustomObjectId,
    payload: FLPatchSpielDataPayload,
    season: Sequence[FLSpiel],
    membership: Mapping[CustomObjectId, str | None],
) -> WriteRefusal | None:
    """Why this patch's OCCUPANTS must be refused. Keyed on the PAYLOAD's `datum`, so an UNDATED fixture is refused."""

    stored = stored_in_slice(spiel_id, season)

    for label, submitted, stored_side in (("team1", payload.team1, stored.team1), ("team2", payload.team2, stored.team2)):
        if submitted is None or (stored_side is not None and stored_side.team_id == submitted.team_id):
            continue

        if submitted.team_id not in membership:
            return WriteRefusal(
                error_code=ELIGIBILITY_NO_MEMBERSHIP,
                message=f"{label}: {submitted.name} has no saison_teams row for season {stored.saison_id}",
            )

        # A cancelled GROUP fixture records a match that did not happen, so a disqualified team
        # belongs on it. A knockout slot still has to say who advances.
        records_an_absence = payload.is_canceled and stored.saison_phase == "gruppenphase"

        disqualified_from = membership[submitted.team_id]
        if disqualified_from is not None and not records_an_absence and not (payload.datum is not None and payload.datum < disqualified_from):
            played_on = payload.datum or "no date"

            return WriteRefusal(
                error_code=ELIGIBILITY_DISQUALIFIED,
                message=(
                    f"{label}: {submitted.name} is disqualified from season {stored.saison_id} as of {disqualified_from} "
                    f"and this fixture is dated {played_on}"
                ),
            )

    return None


FIXTURE_OUTSIDE_SPIELTAG = "REQ-DATE-001"
FIXTURE_DOUBLE_BOOKED = "REQ-CLASH-001"

# A match plus its overrun, the changeover and the travel: the league plays several matches at one
# ground, so this spaces them rather than banning the pairing.
CLASH_BUFFER_MINUTES = 4 * 60


def _minutes_into_day(uhrzeit: str) -> int:
    """`HH:MM:SS` as minutes past midnight. Seconds are dropped: nothing is scheduled to the second."""

    hours, minutes, _ = uhrzeit.split(":")

    return int(hours) * 60 + int(minutes)


def find_fixture_date_refusal(*, datum: str | None, spieltag_beginn: str, spieltag_ende: str) -> WriteRefusal | None:
    """Why this fixture's date must be refused, or `None`. An undated fixture contradicts no span and passes."""

    if datum is None or spieltag_beginn <= datum <= spieltag_ende:
        return None

    return WriteRefusal(
        error_code=FIXTURE_OUTSIDE_SPIELTAG,
        message=(
            f"the fixture is dated {datum} and its matchday runs {spieltag_beginn} to {spieltag_ende}; "
            "move the fixture inside that span or widen the matchday"
        ),
    )


@dataclass(frozen=True)
class BookedSlot:
    """One other fixture's claim on a venue or a referee."""

    spiel_nr: int
    datum: str
    uhrzeit: str
    resource: Literal["Spielort", "Schiedsrichter"]


def find_clash_refusal(*, datum: str | None, uhrzeit: str | None, booked: Sequence[BookedSlot]) -> WriteRefusal | None:
    """Why this fixture's venue or referee must be refused, or `None`. `booked` is every OTHER fixture holding it."""

    if datum is None or uhrzeit is None:
        return None

    start = _minutes_into_day(uhrzeit)
    for slot in sorted(booked, key=lambda entry: (entry.datum, entry.uhrzeit, entry.spiel_nr)):
        if slot.datum != datum:
            continue

        gap = abs(_minutes_into_day(slot.uhrzeit) - start)
        if gap < CLASH_BUFFER_MINUTES:
            return WriteRefusal(
                error_code=FIXTURE_DOUBLE_BOOKED,
                message=(
                    f"the same {slot.resource} is booked for spiel_nr {slot.spiel_nr} at {slot.uhrzeit} on {slot.datum}, "
                    f"{gap} minutes away; two fixtures need {CLASH_BUFFER_MINUTES} minutes between them"
                ),
            )

    return None


def find_result_removal_refusal(spiel_id: CustomObjectId, payload: FLPatchSpielDataPayload, season: Sequence[FLSpiel]) -> WriteRefusal | None:
    """Why emptying a side must be refused. Keyed on the STORED goals: a hand edit can hold `tore` with no `ergebnis`."""

    stored = stored_in_slice(spiel_id, season)

    for label, submitted, stored_side in (("team1", payload.team1, stored.team1), ("team2", payload.team2, stored.team2)):
        if submitted is not None or stored_side is None or stored_side.tore is None:
            continue

        return WriteRefusal(
            error_code=RESULT_SIDE_EMPTIED,
            message=(
                f"{label}: {stored_side.name} carries {stored_side.tore} goal(s) on a played fixture and cannot be removed; "
                "name a different team to correct it, or clear the result first"
            ),
        )

    return None


def find_disqualified_occupants(spiele: Sequence[FLSpielJoined]) -> list[FLBracketFaultOccupant]:
    """Every fixture fielding a team disqualified before its date; an UNDATED fixture is reported, and every phase counts."""

    faults: list[FLBracketFaultOccupant] = []
    for spiel in sorted(spiele, key=lambda entry: (entry.saison_id, entry.spiel_nr)):
        for side in ("team1", "team2"):
            occupant: FLSpielTeamFieldJoined | None = getattr(spiel, side)
            if occupant is None or occupant.disqualifikation is None:
                continue

            effective = occupant.disqualifikation.datum
            if spiel.datum is not None and spiel.datum < effective:
                continue

            faults.append(
                FLBracketFaultOccupant(
                    reason="disqualified_occupant",
                    spiel_id=spiel.id,
                    spiel_nr=spiel.spiel_nr,
                    side=side,
                    team_id=occupant.team_id,
                    team_name=occupant.name,
                    disqualifiziert_seit=effective,
                    spiel_datum=spiel.datum,
                )
            )

    return faults


@dataclass(frozen=True)
class SpieltagRelease:
    """One side emptied so a team can be fielded here. Carries what that fixture loses, or a deleted scoreline reads as an emptied slot."""

    spiel_id: CustomObjectId
    spiel_nr: int
    side: Literal["team1", "team2"]
    team_name: str
    other_side_present: bool
    voided_ergebnis: str | None
    voided_elfmeterschiessen: FLSpielElfmeterschiessen | None


@dataclass(frozen=True)
class SpieltagVerdict:
    """What fielding this payload does to the rest of the Spieltag; `releases` is void unless `refusal` is `None`."""

    refusal: WriteRefusal | None
    releases: list[SpieltagRelease]


def judge_spieltag_occupancy(spiel_id: CustomObjectId, payload: FLPatchSpielDataPayload, season: Sequence[FLSpiel]) -> SpieltagVerdict:
    """Where this payload's teams already stand on the same Spieltag (`docs/backend/spec.md :: I30`)."""

    stored = stored_in_slice(spiel_id, season)

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

    # Sorted, so a refusal names the earliest offending fixture and two runs plan the same releases.
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
                    # The write path strips the other side's goals -- scored against the team being
                    # removed -- so it has to know whether a side is there to strip.
                    other_side_present=(other.team2 if label == "team1" else other.team1) is not None,
                    voided_ergebnis=other.ergebnis,
                    voided_elfmeterschiessen=other.elfmeterschiessen,
                )
            )

    return SpieltagVerdict(refusal=None, releases=releases)


def _quelle_key(quelle: FLSpielQuelle) -> tuple[Any, ...]:
    """One source as a hashable identity, so 'the same outcome feeding two slots' is a set lookup."""

    if isinstance(quelle, FLSpielQuelleSpiel):
        return ("spiel", quelle.spiel_nr, quelle.ausgang)
    return ("gruppe", quelle.gruppe, quelle.platz)


WIRING_UNSUPPORTED = "REQ-WIRING-001"


def _wiring_refusal(message: str) -> WriteRefusal:
    """Every wiring message shares one code: they are one rule, and one repair."""

    return WriteRefusal(error_code=WIRING_UNSUPPORTED, message=message)


def find_wiring_refusal(spiel_id: CustomObjectId, payload: FLPatchSpielDataPayload, season: Sequence[FLSpiel]) -> WriteRefusal | None:
    """Why this patch's bracket wiring must be refused (`docs/backend/spec.md :: I27`) -- the WRITE PATH only."""

    stored = stored_in_slice(spiel_id, season)

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
            return _wiring_refusal(f"{label}_quelle: a Gruppenphase fixture carries no wiring; its sides are drawn by the schedule")

        if isinstance(quelle, FLSpielQuelleSpiel):
            source = by_nr.get(quelle.spiel_nr)
            if source is None:
                return _wiring_refusal(f"{label}_quelle names Spiel {quelle.spiel_nr}, and this season has no such match")
            if source.saison_phase == "gruppenphase":
                return _wiring_refusal(
                    f"{label}_quelle names Spiel {quelle.spiel_nr}, a Gruppenphase match; a bracket slot is never fed by one"
                )
            if PHASE_RANK[source.saison_phase] >= PHASE_RANK[stored.saison_phase]:
                return _wiring_refusal(
                    f"{label}_quelle names Spiel {quelle.spiel_nr} ({source.saison_phase}), "
                    f"which is not played before this fixture ({stored.saison_phase})"
                )

        key = _quelle_key(quelle)
        if key in used:
            return _wiring_refusal(f"{label}_quelle: this source already feeds another slot of the season")
        used.add(key)

    for label, team, quelle in sides:
        if quelle is None:
            continue

        stored_team = stored.team1 if label == "team1" else stored.team2
        stored_id = stored_team.team_id if stored_team is not None else None
        submitted_id = team.team_id if team is not None else None
        if stored_id != submitted_id:
            return _wiring_refusal(f"{label} is maintained by its quelle and cannot be set by hand; clear the quelle to take the slot over")

    return None
