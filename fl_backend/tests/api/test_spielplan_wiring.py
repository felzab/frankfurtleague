from functools import cache
from itertools import product
from typing import Any, Mapping, get_args

import pytest
from bson import ObjectId

from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import find_rules_refusal
from app.api.saisons.spielplan import EnteredTeam, Spielplan, draw_spielplan
from app.api.spiele.schemas import FLPatchSpielDataPayload, FLSpiel, FLSpielListAdapter
from app.api.spiele.services import find_wiring_refusal, judge_spieltag_occupancy, resolve_bracket
from app.api.teams.schemas import FLGruppenNames
from app.api.teams.services import DecidedStanding

GRUPPEN: tuple[FLGruppenNames, ...] = get_args(FLGruppenNames)

SAISON_ID = "2026"

Shape = tuple[int, int, int]

# `(number_of_groups, teams_per_group, qualifiers_per_group)`. The last is the largest season
# `FLSaisonRules` admits, so the widest bracket and the longest round robin are both judged here.
SHAPES: tuple[Shape, ...] = ((1, 2, 2), (2, 3, 1), (4, 5, 1), (4, 4, 4), (4, 16, 4))
SHAPE_IDS = (
    "one group of two into a final",
    "two odd groups into one final",
    "four odd groups into a semi-final",
    "four groups of four into a round of sixteen",
    "the largest season the rules bounds allow",
)

# Derived from the payload model rather than listed: a field added there arrives here as a resubmitted
# value instead of silently defaulting, which is what makes this a resubmission of the drawn fixture.
PAYLOAD_FIELDS: tuple[str, ...] = tuple(FLPatchSpielDataPayload.model_fields)


def rules(*, groups: int, teams: int, qualifiers: int) -> FLSaisonRules:
    """One season's rules. 3/1/0 and a 3:0 forfeit are the ordinary competition, so no refusal fires on a field this file is not about."""

    return FLSaisonRules.model_validate(
        {
            "win_points": 3,
            "draw_points": 1,
            "qualifiers_per_group": qualifiers,
            "number_of_groups": groups,
            "teams_per_group": teams,
            "tiebreak_order": "tordifferenz",
            "max_kadergroesse": 18,
            "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
            "erlaubte_stufen": ["E1", "E2", "Q1", "Q2"],
        }
    )


def entered_for(groups: int, teams: int) -> tuple[EnteredTeam, ...]:
    """Every club of a full season, in entry order, the groups INTERLEAVED so no rule reads a partition by list position."""

    return tuple(
        EnteredTeam(
            row_id=ObjectId(f"6890a1b2c3d4e5f6071{index:05d}"),
            team_id=ObjectId(f"6890a1b2c3d4e5f6072{index:05d}"),
            gruppe=gruppe,
            name=f"{gruppe}{seat + 1}-Schule",
            shorthand=f"{index:02d}",
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
    """The drawn fixtures as the write path reads them: every rule below takes the whole season as its slice (`docs/backend/spec.md :: I45`)."""

    return tuple(FLSpielListAdapter.validate_python(list(drawn(shape).spiele)))


def with_the_slot_cleared(season: tuple[FLSpiel, ...], spiel_id: Any) -> tuple[FLSpiel, ...]:
    """`season` with this fixture stripped of its own sources, so resubmitting them reads as ENTERING them.

    `find_wiring_refusal` judges the side whose source a save moves (`docs/backend/spec.md :: I44`),
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
                saison_status="future",
                stored=None,
                proposed=rules(groups=groups, teams=teams, qualifiers=qualifiers),
                occupancy_by_gruppe={},
                highest_wired_platz=0,
            )
            is None
        )


class TestTheDrawnWiringIsWiringTheWritePathAccepts:
    """`docs/backend/spec.md :: I27` run rather than restated: the emitted season judged by the rule an admin's own edit meets."""

    @pytest.mark.parametrize("shape", SHAPES, ids=SHAPE_IDS)
    def test_no_emitted_fixture_carries_a_wiring_its_own_endpoint_would_refuse(self, shape: Shape):
        """Wiring the write path refuses is wiring an admin who cleared the slot could never point back at.

        The shape's own group count rides along, so a draw seeding outside it would land here too.
        """

        groups, _, _ = shape
        season = season_of(shape)

        refused = [
            (raw["spiel_nr"], refusal.message)
            for raw in drawn(shape).spiele
            if (refusal := find_wiring_refusal(raw["_id"], payload_of(raw), with_the_slot_cleared(season, raw["_id"]), number_of_groups=groups))
            is not None
        ]

        assert refused == []


class TestTheDrawnSeasonFieldsNobodyTwiceOnAMatchday:
    """`docs/backend/spec.md :: I30` asked of the shipped judge, not of the pairing the draw happens to have produced."""

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
