from collections.abc import Mapping
from functools import cache
from itertools import product
from typing import Any, get_args

import pytest
from bson import ObjectId

from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import find_rules_refusal
from app.api.saisons.spielplan import EnteredTeam, Spielplan, draw_spielplan
from app.api.spiele.schemas import FLPatchSpielDataPayload, FLSpiel, FLSpielListAdapter
from app.api.spiele.services import find_wiring_refusal, judge_spieltag_occupancy, resolve_bracket
from app.api.teams.services import DecidedStanding
from app.shared.schemas.literals import FLGruppenNames
from tests.documents import rules_document

GRUPPEN: tuple[FLGruppenNames, ...] = get_args(FLGruppenNames.__value__)

SAISON_ID = "2026"

Shape = tuple[int, int, int]

# `(number_of_groups, teams_per_group, qualifiers_per_group)`. The last is the largest season
# `FLSaisonRules` admits, so the widest bracket and the longest round robin are both judged here.
SHAPES: tuple[Shape, ...] = ((1, 4, 4), (2, 3, 2), (4, 5, 1), (4, 4, 4), (4, 16, 4))
SHAPE_IDS = (
    "one group of four into a semi-final",
    "two odd groups into a semi-final",
    "four odd groups into a semi-final",
    "four groups of four into a round of sixteen",
    "the largest season the rules bounds allow",
)

# Derived from the payload model rather than listed: a field added there arrives here as a resubmitted
# value instead of silently defaulting, which is what makes this a resubmission of the drawn fixture.
PAYLOAD_FIELDS: tuple[str, ...] = tuple(FLPatchSpielDataPayload.model_fields)


def rules(*, groups: int, teams: int, qualifiers: int) -> FLSaisonRules:
    return FLSaisonRules.model_validate(
        rules_document(
            qualifiers_per_gruppe=qualifiers, number_of_gruppen=groups, teams_per_gruppe=teams, allowed_stufen=["E1", "E2", "Q1", "Q2"]
        )
    )


def entered_for(groups: int, teams: int) -> tuple[EnteredTeam, ...]:
    """Every club of a full season, in entry order, the groups INTERLEAVED so no rule reads a partition by list position."""

    return tuple(
        EnteredTeam(
            row_id=ObjectId(f"6890a1b2c3d4e5f6071{index:05d}"),
            team_id=ObjectId(f"6890a1b2c3d4e5f6072{index:05d}"),
            gruppe=gruppe,
            name=f"{gruppe}{seat + 1}-Schule",
            shorthand=f"T{chr(65 + index // 26)}{chr(65 + index % 26)}",
        )
        for index, (seat, gruppe) in enumerate(product(range(teams), GRUPPEN[:groups]))
    )


@cache
def drawn(shape: Shape) -> Spielplan:
    """One season's draw, cached: the widest shape draws 495 fixtures and every class below judges the same one."""

    groups, teams, qualifiers = shape

    return draw_spielplan(
        saison_id=SAISON_ID, rules=rules(groups=groups, teams=teams, qualifiers=qualifiers), entered=entered_for(groups, teams)
    )


@cache
def season_of(shape: Shape) -> tuple[FLSpiel, ...]:
    """The drawn fixtures as the write path reads them.

    Every rule below takes the whole season as its slice.
    """

    return tuple(FLSpielListAdapter.validate_python(list(drawn(shape).spiele)))


def with_the_slot_cleared(season: tuple[FLSpiel, ...], spiel_id: Any) -> tuple[FLSpiel, ...]:
    """`season` with this fixture stripped of its own sources, so resubmitting them reads as ENTERING them.

    `find_wiring_refusal` judges the side whose source a save moves,
    which a resubmission never does.
    """

    return tuple(spiel if spiel.id != spiel_id else spiel.model_copy(update={"team1_quelle": None, "team2_quelle": None}) for spiel in season)


def payload_of(raw: Mapping[str, Any]) -> FLPatchSpielDataPayload:
    """The drawn fixture resubmitted unchanged -- the body `PATCH /spiele/{spiel_id}` carries when nothing was edited."""

    return FLPatchSpielDataPayload.model_validate({field: raw.get(field) for field in PAYLOAD_FIELDS})


class TestTheShapesAreSeasonsThatCanExist:
    @pytest.mark.parametrize("shape", SHAPES, ids=SHAPE_IDS)
    def test_the_write_path_accepts_every_shape_drawn_below(self, shape: Shape):
        """Otherwise every judge below runs over the draw of a season nobody can save."""

        groups, teams, qualifiers = shape

        assert (
            find_rules_refusal(
                stored=None,
                proposed=rules(groups=groups, teams=teams, qualifiers=qualifiers),
                occupancy_by_gruppe={},
                highest_wired_platz=0,
            )
            is None
        )


class TestTheDrawnWiringIsWiringTheWritePathAccepts:
    """Run rather than restated: the emitted season judged by the rule an admin's own edit meets."""

    @pytest.mark.parametrize("shape", SHAPES, ids=SHAPE_IDS)
    def test_no_emitted_fixture_carries_a_wiring_its_own_endpoint_would_refuse(self, shape: Shape):
        """Wiring the write path refuses is wiring an admin who cleared the slot could never point back at.

        The shape's own group count rides along, so a draw seeding outside it would land here too.
        """

        groups, _, _ = shape
        season = season_of(shape)

        refused = [
            (raw["spiel_nr"], refusal.error_code)
            for raw in drawn(shape).spiele
            if (
                refusal := find_wiring_refusal(raw["_id"], payload_of(raw), with_the_slot_cleared(season, raw["_id"]), number_of_gruppen=groups)
            )
            is not None
        ]

        assert refused == []


class TestTheDrawnSeasonFieldsNobodyTwiceOnAMatchday:
    """Asked of the shipped judge, not of the pairing the draw happens to have produced."""

    @pytest.mark.parametrize("shape", SHAPES, ids=SHAPE_IDS)
    def test_resubmitting_a_fixture_neither_refuses_nor_releases_a_club_from_another(self, shape: Shape):
        """A release is the same fault as the refusal seen from the other slot: the judge found this club already standing on the matchday."""

        season = season_of(shape)

        verdicts = [(raw["spiel_nr"], judge_spieltag_occupancy(raw["_id"], payload_of(raw), season)) for raw in drawn(shape).spiele]

        assert [nr for nr, verdict in verdicts if verdict.refusal is not None] == []
        assert [nr for nr, verdict in verdicts if verdict.releases] == []


class TestAFreshDrawResolvesToAnEmptyBracket:
    """Nobody has qualified before a ball is kicked, so the resolver must move no team and report no fault."""

    @pytest.mark.parametrize("shape", SHAPES, ids=SHAPE_IDS)
    def test_the_bracket_resolver_writes_nothing_and_faults_nothing(self, shape: Shape):
        """An advancement here would be a team seeded off a table nobody has played; a fault would be wiring the draw itself wrote wrong."""

        groups, teams, _ = shape
        # Spelled from `GRUPPEN`, never read from `offered_gruppen`: the draw partitions by that
        # helper, and an expectation taken from the code under test can only ever agree with it.
        gruppen = GRUPPEN[:groups]

        # `eligible` is the group's size, which is what tells a `platz` the group can never produce
        # from one it has simply not decided yet -- the first is a fault, the second an empty slot.
        standings: Mapping[FLGruppenNames, DecidedStanding] = {
            gruppe: DecidedStanding(eligible=teams, is_complete=False, by_platz={}) for gruppe in gruppen
        }

        resolution = resolve_bracket(season_of(shape), standings)

        assert resolution.advancements == []
        assert resolution.bracket_faults == []


def played_up_to_the_finale(shape: Shape) -> tuple[tuple[FLSpiel, ...], dict[int, tuple[ObjectId, ObjectId]]]:
    """The drawn season with every knockout round before the Finale won 1:0 by `team1`, and each such match's `(loser, winner)`.

    Each side is the club its source names, so the walk keeps every stored result. The opening round's
    clubs are any entered ones: no standing is handed in, which leaves a group-fed slot as it stands.
    """

    groups, teams, _ = shape
    entered = entered_for(groups, teams)
    squads = {gruppe: [team for team in entered if team.gruppe == gruppe] for gruppe in GRUPPEN[:groups]}
    came_out: dict[tuple[int, str], EnteredTeam] = {}
    decided: dict[int, tuple[ObjectId, ObjectId]] = {}

    played: list[dict[str, Any]] = []
    for raw in drawn(shape).spiele:
        if raw["saison_phase"] in ("gruppenphase", "finale"):
            played.append(raw)
            continue

        one, other = (
            squads[quelle["gruppe"]][quelle["platz"] - 1] if quelle["type"] == "gruppe" else came_out[(quelle["spiel_nr"], quelle["ausgang"])]
            for quelle in (raw["team1_quelle"], raw["team2_quelle"])
        )
        came_out[(raw["spiel_nr"], "sieger")], came_out[(raw["spiel_nr"], "verlierer")] = one, other
        decided[raw["spiel_nr"]] = (other.team_id, one.team_id)
        played.append(
            {
                **raw,
                "team1": {"team_id": one.team_id, "tore": 1, "name": one.name, "shorthand": one.shorthand},
                "team2": {"team_id": other.team_id, "tore": 0, "name": other.name, "shorthand": other.shorthand},
                "ergebnis": "1:0",
            }
        )

    return tuple(FLSpielListAdapter.validate_python(played)), decided


class TestTheBracketWalkFillsTheMatchForThirdPlace:
    """The draw's `verlierer` pair, resolved by the walk that fills the final."""

    @pytest.mark.parametrize("shape", SHAPES[2:], ids=SHAPE_IDS[2:])
    def test_the_semi_finals_losers_meet_and_their_winners_reach_the_final(self, shape: Shape):
        """The three shapes with semi-finals; the two-team brackets draw no match for third place."""

        season, decided = played_up_to_the_finale(shape)
        semi_finals = sorted(spiel.spiel_nr for spiel in season if spiel.saison_phase == "halbfinale")
        third_place, final = sorted(spiel.spiel_nr for spiel in season if spiel.saison_phase == "finale")

        resolution = resolve_bracket(season, {})

        assert resolution.bracket_faults == []
        assert [
            (
                advanced.spiel_nr,
                None if advanced.team1 is None else advanced.team1.team_id,
                None if advanced.team2 is None else advanced.team2.team_id,
            )
            for advanced in resolution.advancements
        ] == [
            (third_place, decided[semi_finals[0]][0], decided[semi_finals[1]][0]),
            (final, decided[semi_finals[0]][1], decided[semi_finals[1]][1]),
        ]
