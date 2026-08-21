from collections.abc import Iterator, Sequence
from functools import cache
from itertools import combinations, permutations, product
from typing import Any, get_args

import pytest
from bson import ObjectId

from app.api.saisons.schedule import (
    expected_matches,
    group_matchdays,
    group_matches_per_matchday,
    knockout_phases_for,
    qualifier_count,
    schedule_for,
    total_group_matches,
)
from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import find_rules_refusal
from app.api.saisons.spielplan import BRACKET_SEEDING, EnteredTeam, Spielplan, circle_rounds, draw_spielplan
from app.api.spiele.schemas import PHASE_RANK, FLSaisonPhase, FLSpiel
from app.api.spieltage.schemas import FLSpieltag
from app.api.teams.schemas import FLGruppenNames
from app.core.collections import Collection
from app.core.constraints import COLLECTION_VALIDATORS

GRUPPEN: tuple[FLGruppenNames, ...] = get_args(FLGruppenNames)

SAISON_ID = "2026"

Seeding = tuple[tuple[FLGruppenNames, int], ...]
Score = tuple[tuple[int, ...], tuple[int, ...]]

# `(number_of_groups, teams_per_group, qualifiers_per_group)`. Between them: an odd group, a lone
# group, a bracket of one final, and the widest the phases hold. `TestTheShapesAreSeasonsThatCanExist`
# derives that each is legal rather than trusting it.
SHAPES: tuple[tuple[int, int, int], ...] = (
    (1, 2, 2),
    (2, 3, 1),
    (1, 6, 2),
    (2, 4, 2),
    (4, 5, 1),
    (4, 4, 4),
    (2, 8, 8),
    (1, 16, 16),
)


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
    """Every club of a full season, in entry order.

    The groups are INTERLEAVED, so a draw partitioning by list position rather than by `gruppe`
    pairs clubs that never meet.
    """

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


def draw(groups: int, teams: int, qualifiers: int, entered: Sequence[EnteredTeam] | None = None) -> Spielplan:
    season = rules(groups=groups, teams=teams, qualifiers=qualifiers)
    return draw_spielplan(saison_id=SAISON_ID, rules=season, entered=entered_for(groups, teams) if entered is None else entered)


def validator(collection: Collection) -> dict[str, Any]:
    """One collection's `$jsonSchema`, read off the shipped constraint rather than restated here."""

    return dict(COLLECTION_VALIDATORS[collection]["$jsonSchema"])


def matchday_phases(plan: Spielplan) -> dict[ObjectId, FLSaisonPhase]:
    return {spieltag["_id"]: spieltag["saison_phase"] for spieltag in plan.spieltage}


def quelle_key(quelle: dict[str, Any] | None) -> tuple[tuple[str, Any], ...] | None:
    return None if quelle is None else tuple(sorted(quelle.items()))


def signature(plan: Spielplan) -> list[tuple[Any, ...]]:
    """A draw with its generated ids removed -- what two calls must agree on, `_id` being fresh each time."""

    slot = {spieltag["_id"]: (spieltag["saison_phase"], spieltag["position"]) for spieltag in plan.spieltage}

    return [
        (
            spiel["spiel_nr"],
            spiel["saison_phase"],
            slot[spiel["spieltag_id"]],
            None if spiel["team1"] is None else spiel["team1"]["team_id"],
            None if spiel["team2"] is None else spiel["team2"]["team_id"],
            quelle_key(spiel["team1_quelle"]),
            quelle_key(spiel["team2_quelle"]),
        )
        for spiel in plan.spiele
    ]


class TestTheCircleMethodPairsAGroup:
    """`app/api/saisons/schedule.py` is the independent oracle: it counts the same schedule from a combination rather than by pairing anyone."""

    @pytest.mark.parametrize("teams", range(2, 17))
    def test_it_plays_the_rounds_the_schedule_counts(self, teams: int):
        """The round count IS the matchday count, because round k of every group is matchday k."""

        assert len(circle_rounds(teams)) == group_matchdays(teams)

    @pytest.mark.parametrize("teams", range(2, 17))
    def test_every_round_holds_the_matches_a_matchday_expects(self, teams: int):
        """One group's share of `anzahl_spiele`; an odd group pairs all but the club on its bye."""

        assert [len(pairs) for pairs in circle_rounds(teams)] == [group_matches_per_matchday(1, teams)] * group_matchdays(teams)

    @pytest.mark.parametrize("teams", range(2, 17))
    def test_every_club_meets_every_other_exactly_once(self, teams: int):
        """A round robin by definition, and what makes the group table a fair one."""

        played = [frozenset(pair) for pairs in circle_rounds(teams) for pair in pairs]

        assert sorted(played, key=sorted) == sorted((frozenset(pair) for pair in combinations(range(teams), 2)), key=sorted)

    @pytest.mark.parametrize("teams", range(2, 17))
    def test_the_whole_round_robin_is_the_combination(self, teams: int):
        assert sum(len(pairs) for pairs in circle_rounds(teams)) == total_group_matches(1, teams)

    @pytest.mark.parametrize("teams", range(2, 17))
    def test_nobody_is_paired_twice_in_one_round(self, teams: int):
        """A club fielded twice on one matchday is what `app/core/constraints.py :: report_relations` counts as a violation."""

        for pairs in circle_rounds(teams):
            sides = [side for pair in pairs for side in pair]
            assert len(set(sides)) == len(sides)

    @pytest.mark.parametrize("teams", range(3, 17, 2))
    def test_an_odd_group_byes_exactly_one_club_a_round(self, teams: int):
        """The bye is an ABSENCE: the dummy's pair is dropped rather than emitted as a fixture."""

        byes = [set(range(teams)) - {side for pair in pairs for side in pair} for pairs in circle_rounds(teams)]

        assert [len(bye) for bye in byes] == [1] * teams

    @pytest.mark.parametrize("teams", range(3, 17, 2))
    def test_an_odd_group_byes_every_club_once(self, teams: int):
        """Otherwise one club rests twice while another never does, which is a different competition."""

        byes = [next(iter(set(range(teams)) - {side for pair in pairs for side in pair})) for pairs in circle_rounds(teams)]

        assert sorted(byes) == list(range(teams))

    def test_a_group_too_small_to_pair_plays_nothing(self):
        """`teams_per_group` has a floor of 2, so this is the boundary rather than a reachable season."""

        assert circle_rounds(1) == ()


def ceiling(field: str) -> int:
    """The `le` a rules field states, read off the model so widening one widens the sweep rather than leaving it under the old bound."""

    return next(constraint.le for constraint in FLSaisonRules.model_fields[field].metadata if hasattr(constraint, "le"))


def legal_combinations() -> set[tuple[int, int]]:
    """Every `(number_of_groups, qualifiers_per_group)` a create passes the write path with.

    `qualifiers_per_group` states no `le` of its own; the excess rule caps it at `teams_per_group`,
    so that field's ceiling is as wide as a qualifier count can be.
    """

    return {
        (groups, qualifiers)
        for groups in range(1, ceiling("number_of_groups") + 1)
        for qualifiers in range(1, ceiling("teams_per_group") + 1)
        if find_rules_refusal(
            saison_status="future",
            stored=None,
            proposed=rules(groups=groups, teams=max(qualifiers, 2), qualifiers=qualifiers),
            occupancy_by_gruppe={},
            highest_wired_platz=0,
        )
        is None
    }


def bracket_slots(field: int) -> list[int]:
    """The seed standing in each slot, left to right: seed s draws `field + 1 - s`, and each half is the same bracket again."""

    if field == 1:
        return [1]
    return [seed for half in bracket_slots(field // 2) for seed in (half, field + 1 - half)]


def meeting_round(slot: int, other: int) -> int:
    """Which round two slots meet in with both winning throughout: the halving that first puts them in one block."""

    return (slot ^ other).bit_length()


def score(seeding: Seeding) -> Score:
    """The two objectives, each one clash kind's meeting rounds sorted ascending.

    Compared as tuples with larger better, so the earliest same-group clash is pushed as late as it
    goes and the same-placing rounds break what that leaves tied.
    """

    same_group: list[int] = []
    same_platz: list[int] = []
    for slot, (gruppe, platz) in enumerate(seeding):
        for other in range(slot + 1, len(seeding)):
            if seeding[other][0] == gruppe:
                same_group.append(meeting_round(slot, other))
            if seeding[other][1] == platz:
                same_platz.append(meeting_round(slot, other))

    return tuple(sorted(same_group)), tuple(sorted(same_platz))


def band_seedings(groups: int, qualifiers: int) -> Iterator[Seeding]:
    """Every seeding banding the qualifiers by placing, the FIRST band's order held fixed.

    Relabelling the groups is a symmetry of both objectives and normalises any first band to this
    one, so the best score here is the best score of the whole space.
    """

    field = groups * qualifiers
    slot_of_seed = {seed: slot for slot, seed in enumerate(bracket_slots(field))}
    offered = GRUPPEN[:groups]

    for later in product(permutations_of(offered), repeat=qualifiers - 1):
        placed: dict[int, tuple[FLGruppenNames, int]] = {
            slot_of_seed[band * groups + rank + 1]: (gruppe, band + 1)
            for band, order in enumerate((offered, *later))
            for rank, gruppe in enumerate(order)
        }
        yield tuple(placed[slot] for slot in range(field))


@cache
def permutations_of(offered: tuple[FLGruppenNames, ...]) -> tuple[tuple[FLGruppenNames, ...], ...]:
    """Cached: the widest sweep would otherwise rebuild this list on every one of its 13824 steps."""

    return tuple(permutations(offered))


@cache
def optimum(groups: int, qualifiers: int) -> Score:
    """The best score the banded space reaches, cached because the widest sweep walks 13824 seedings."""

    return max(score(seeding) for seeding in band_seedings(groups, qualifiers))


class TestTheTableCoversTheWritePath:
    def test_it_holds_exactly_the_combinations_a_season_can_be_saved_in(self):
        """Derived from the rules bounds and the refusal, so widening either strands a legal season with no row to draw from."""

        assert set(BRACKET_SEEDING) == legal_combinations()

    def test_no_season_divides_its_bracket_three_ways(self):
        """Three times any qualifier count keeps a factor of three, so nothing halves down to one final."""

        assert not any(groups == 3 for groups, _ in BRACKET_SEEDING)

    @pytest.mark.parametrize("key", sorted(BRACKET_SEEDING))
    def test_a_row_holds_one_slot_per_qualifier(self, key: tuple[int, int]):
        """The first knockout round is full: nobody byes into it."""

        assert len(BRACKET_SEEDING[key]) == key[0] * key[1]


class TestEveryRowIsAWholeDraw:
    @pytest.mark.parametrize("key", sorted(BRACKET_SEEDING))
    def test_every_qualifier_stands_in_exactly_one_slot(self, key: tuple[int, int]):
        """A repeated pair would field one team twice and leave another out of its own bracket."""

        groups, qualifiers = key
        expected = [(gruppe, platz) for gruppe in GRUPPEN[:groups] for platz in range(1, qualifiers + 1)]

        assert sorted(BRACKET_SEEDING[key]) == sorted(expected)

    @pytest.mark.parametrize("key", sorted(BRACKET_SEEDING))
    def test_round_one_draws_placings_summing_to_one_past_the_qualifier_count(self, key: tuple[int, int]):
        """What seeding is for: a group winner draws the weakest qualifier the round still holds."""

        qualifiers = key[1]
        row = BRACKET_SEEDING[key]

        assert [row[slot][1] + row[slot + 1][1] for slot in range(0, len(row), 2)] == [qualifiers + 1] * (len(row) // 2)


class TestTheTableIsTheExhaustiveOptimum:
    @pytest.mark.parametrize("key", sorted(BRACKET_SEEDING))
    def test_relabelling_the_groups_leaves_the_score_unchanged(self, key: tuple[int, int]):
        """What lets the sweep hold one band fixed; without it a fixed band would only BOUND the optimum."""

        offered = GRUPPEN[: key[0]]
        row = BRACKET_SEEDING[key]

        for order in permutations_of(offered):
            relabelled: Seeding = tuple((order[offered.index(gruppe)], platz) for gruppe, platz in row)
            assert score(relabelled) == score(row)

    @pytest.mark.parametrize("key", sorted(BRACKET_SEEDING))
    def test_the_stored_row_still_scores_the_optimum(self, key: tuple[int, int]):
        """Re-run rather than trusted: the row is a literal, and only this sweep says it is the best one."""

        assert score(BRACKET_SEEDING[key]) == optimum(*key)


class TestTheShapesAreSeasonsThatCanExist:
    @pytest.mark.parametrize("shape", SHAPES)
    def test_the_write_path_accepts_every_shape_drawn_below(self, shape: tuple[int, int, int]):
        """Otherwise the emission tests below prove the draw of a season nobody can save."""

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


class TestTheDrawIsTheSeasonTheRulesDescribe:
    @pytest.mark.parametrize("shape", SHAPES)
    def test_each_phase_gets_the_matchdays_its_schedule_names(self, shape: tuple[int, int, int]):
        groups, teams, qualifiers = shape
        plan = draw(*shape)
        drawn = [(spieltag["saison_phase"], spieltag["position"]) for spieltag in plan.spieltage]

        assert drawn == [
            (entry.phase, position)
            for entry in schedule_for(rules(groups=groups, teams=teams, qualifiers=qualifiers))
            for position in range(1, entry.matchdays + 1)
        ]

    @pytest.mark.parametrize("shape", SHAPES)
    def test_a_position_restarts_at_one_in_each_phase(self, shape: tuple[int, int, int]):
        """`uniq_saison_id_saison_phase_position` keys on the phase, so a season legitimately holds several matchdays numbered 1."""

        positions: dict[FLSaisonPhase, list[int]] = {}
        for spieltag in draw(*shape).spieltage:
            positions.setdefault(spieltag["saison_phase"], []).append(spieltag["position"])

        assert all(found == list(range(1, len(found) + 1)) for found in positions.values())

    @pytest.mark.parametrize("shape", SHAPES)
    def test_every_matchday_holds_the_matches_its_phase_expects(self, shape: tuple[int, int, int]):
        """`anzahl_spiele` is derived per matchday, so a matchday off this count reads as incomplete forever."""

        groups, teams, qualifiers = shape
        season = rules(groups=groups, teams=teams, qualifiers=qualifiers)
        plan = draw(*shape)
        phases = matchday_phases(plan)

        held: dict[ObjectId, int] = {spieltag_id: 0 for spieltag_id in phases}
        for spiel in plan.spiele:
            held[spiel["spieltag_id"]] += 1

        assert held == {spieltag_id: expected_matches(season, phase) for spieltag_id, phase in phases.items()}

    @pytest.mark.parametrize("shape", SHAPES)
    def test_the_group_phase_draws_the_whole_combination(self, shape: tuple[int, int, int]):
        groups, teams, _ = shape
        drawn = [spiel for spiel in draw(*shape).spiele if spiel["saison_phase"] == "gruppenphase"]

        assert len(drawn) == total_group_matches(groups, teams)

    @pytest.mark.parametrize("shape", SHAPES)
    def test_the_bracket_halves_down_to_one_final(self, shape: tuple[int, int, int]):
        groups, teams, qualifiers = shape
        season = rules(groups=groups, teams=teams, qualifiers=qualifiers)
        remaining = qualifier_count(season)
        drawn: dict[FLSaisonPhase, int] = {}
        for spiel in draw(*shape).spiele:
            if spiel["saison_phase"] != "gruppenphase":
                drawn[spiel["saison_phase"]] = drawn.get(spiel["saison_phase"], 0) + 1

        expected: dict[FLSaisonPhase, int] = {}
        for phase in knockout_phases_for(remaining):
            expected[phase] = remaining // 2
            remaining //= 2

        assert drawn == expected

    @pytest.mark.parametrize("shape", SHAPES)
    def test_every_club_of_a_group_meets_every_other_once(self, shape: tuple[int, int, int]):
        groups, teams, _ = shape
        entered = entered_for(groups, teams)
        gruppe_of = {team.team_id: team.gruppe for team in entered}
        met = [frozenset((spiel["team1"]["team_id"], spiel["team2"]["team_id"])) for spiel in draw(*shape).spiele if spiel["team1"] is not None]

        expected = [
            frozenset((one.team_id, other.team_id))
            for gruppe in GRUPPEN[:groups]
            for one, other in combinations([team for team in entered if gruppe_of[team.team_id] == gruppe], 2)
        ]

        assert sorted(met, key=sorted) == sorted(expected, key=sorted)

    @pytest.mark.parametrize("shape", SHAPES)
    def test_no_club_stands_twice_on_one_matchday(self, shape: tuple[int, int, int]):
        """The rule `judge_spieltag_occupancy` enforces at the write path, held here by construction instead."""

        seen: set[tuple[ObjectId, ObjectId]] = set()
        for spiel in draw(*shape).spiele:
            for side in (spiel["team1"], spiel["team2"]):
                if side is not None:
                    assert (spiel["spieltag_id"], side["team_id"]) not in seen
                    seen.add((spiel["spieltag_id"], side["team_id"]))


class TestSpielNrRunsOnceThroughTheSeason:
    @pytest.mark.parametrize("shape", SHAPES)
    def test_it_is_contiguous_from_one_with_no_gap_and_no_repeat(self, shape: tuple[int, int, int]):
        """`uniq_saison_id_spiel_nr` spans the whole season, so a per-phase restart is a duplicate key rather than a style choice."""

        drawn = [spiel["spiel_nr"] for spiel in draw(*shape).spiele]

        assert drawn == list(range(1, len(drawn) + 1))

    @pytest.mark.parametrize("shape", SHAPES)
    def test_it_runs_in_playing_order(self, shape: tuple[int, int, int]):
        """Phase, then matchday, then group -- so reading a season by number reads it in the order it is played."""

        groups, teams, _ = shape
        gruppe_of = {team.team_id: team.gruppe for team in entered_for(groups, teams)}
        plan = draw(*shape)
        slot = {spieltag["_id"]: spieltag["position"] for spieltag in plan.spieltage}

        keys = [
            (
                PHASE_RANK[spiel["saison_phase"]],
                slot[spiel["spieltag_id"]],
                "" if spiel["team1"] is None else gruppe_of[spiel["team1"]["team_id"]],
            )
            for spiel in plan.spiele
        ]

        assert keys == sorted(keys)

    @pytest.mark.parametrize("shape", SHAPES)
    def test_a_bracket_fixture_is_fed_only_by_numbers_already_played(self, shape: tuple[int, int, int]):
        """A source naming a later fixture is a bracket that cannot resolve; `find_bracket_faults` would report the cycle."""

        for spiel in draw(*shape).spiele:
            for quelle in (spiel["team1_quelle"], spiel["team2_quelle"]):
                if quelle is not None and quelle["type"] == "spiel":
                    assert quelle["spiel_nr"] < spiel["spiel_nr"]


class TestTheEmittedDocumentsSatisfyTheShippedValidators:
    @pytest.mark.parametrize("shape", SHAPES)
    def test_a_fixture_carries_the_required_keys_and_invents_none(self, shape: tuple[int, int, int]):
        declared = validator(Collection.SPIELE)

        for spiel in draw(*shape).spiele:
            assert set(declared["required"]) <= set(spiel) <= set(declared["properties"])

    @pytest.mark.parametrize("shape", SHAPES)
    def test_a_matchday_carries_the_required_keys_and_invents_none(self, shape: tuple[int, int, int]):
        declared = validator(Collection.SPIELTAGE)

        for spieltag in draw(*shape).spieltage:
            assert set(declared["required"]) <= set(spieltag) <= set(declared["properties"])

    @pytest.mark.parametrize("shape", SHAPES)
    def test_a_side_carries_the_required_keys_and_invents_none(self, shape: tuple[int, int, int]):
        declared = validator(Collection.SPIELE)["properties"]["team1"]

        for spiel in draw(*shape).spiele:
            for side in (spiel["team1"], spiel["team2"]):
                if side is not None:
                    assert set(declared["required"]) <= set(side) <= set(declared["properties"])

    @pytest.mark.parametrize("shape", SHAPES)
    def test_every_fixture_reads_back_through_the_model_an_endpoint_serves(self, shape: tuple[int, int, int]):
        """A document only the writer can read is one the first `GET /spiele` answers 500 on."""

        for spiel in draw(*shape).spiele:
            FLSpiel.model_validate(spiel)

    @pytest.mark.parametrize("shape", SHAPES)
    def test_every_matchday_reads_back_through_the_model_an_endpoint_serves(self, shape: tuple[int, int, int]):
        """`anzahl_spiele` is injected because it is derived and on no document."""

        groups, teams, qualifiers = shape
        season = rules(groups=groups, teams=teams, qualifiers=qualifiers)

        for spieltag in draw(*shape).spieltage:
            FLSpieltag.model_validate({**spieltag, "anzahl_spiele": expected_matches(season, spieltag["saison_phase"])})

    @pytest.mark.parametrize("shape", SHAPES)
    def test_nothing_is_scheduled_and_nothing_has_happened(self, shape: tuple[int, int, int]):
        """A drawn season states no date, no venue, no referee and no result: each is a later decision, and a placeholder would read as one."""

        for spiel in draw(*shape).spiele:
            assert [
                spiel[field] for field in ("datum", "uhrzeit", "ort", "schiedsrichter", "ergebnis", "elfmeterschiessen", "sonderereignis")
            ] == [None] * 7

    @pytest.mark.parametrize("shape", SHAPES)
    def test_an_identifier_stays_an_objectid_and_a_number_a_plain_int(self, shape: tuple[int, int, int]):
        """A `mode="json"` dump would string both ids, and `bson.Int64` fails the declared `"int"`.

        `type(...) is int` rather than `isinstance`, which the wider type passes as a subclass.
        """

        plan = draw(*shape)

        for spieltag in plan.spieltage:
            assert isinstance(spieltag["_id"], ObjectId)
            assert type(spieltag["position"]) is int

        for spiel in plan.spiele:
            assert isinstance(spiel["_id"], ObjectId)
            assert isinstance(spiel["spieltag_id"], ObjectId)
            assert type(spiel["spiel_nr"]) is int
            for side in (spiel["team1"], spiel["team2"]):
                assert side is None or isinstance(side["team_id"], ObjectId)

    @pytest.mark.parametrize("shape", SHAPES)
    def test_every_fixture_sits_in_a_matchday_this_call_produced(self, shape: tuple[int, int, int]):
        """A `spieltag_id` from anywhere else would strand the fixture in a season it is not part of."""

        plan = draw(*shape)
        phases = matchday_phases(plan)

        for spiel in plan.spiele:
            assert spiel["spieltag_id"] in phases
            assert phases[spiel["spieltag_id"]] == spiel["saison_phase"]

    @pytest.mark.parametrize("shape", SHAPES)
    def test_every_document_names_the_season_it_was_drawn_for(self, shape: tuple[int, int, int]):
        plan = draw(*shape)

        assert {document["saison_id"] for document in (*plan.spieltage, *plan.spiele)} == {SAISON_ID}

    @pytest.mark.parametrize("shape", SHAPES)
    def test_no_matchday_arrives_dated(self, shape: tuple[int, int, int]):
        """Dating a matchday is a separate operation, and any span written here would be a claim nobody made."""

        assert all((spieltag["beginn"], spieltag["ende"]) == (None, None) for spieltag in draw(*shape).spieltage)


class TestAFixtureIsEitherDrawnOrWired:
    @pytest.mark.parametrize("shape", SHAPES)
    def test_a_group_fixture_names_both_clubs_and_no_source(self, shape: tuple[int, int, int]):
        for spiel in draw(*shape).spiele:
            if spiel["saison_phase"] == "gruppenphase":
                assert spiel["team1"] is not None and spiel["team2"] is not None
                assert spiel["team1_quelle"] is None and spiel["team2_quelle"] is None
                assert spiel["team1"]["tore"] is None and spiel["team2"]["tore"] is None

    @pytest.mark.parametrize("shape", SHAPES)
    def test_a_bracket_fixture_names_both_sources_and_no_club(self, shape: tuple[int, int, int]):
        """Absence is MODELLED rather than impersonated: nobody has qualified yet, so neither side holds a club."""

        for spiel in draw(*shape).spiele:
            if spiel["saison_phase"] != "gruppenphase":
                assert spiel["team1"] is None and spiel["team2"] is None
                assert spiel["team1_quelle"] is not None and spiel["team2_quelle"] is not None

    @pytest.mark.parametrize("shape", SHAPES)
    def test_the_first_bracket_round_reads_the_stored_table(self, shape: tuple[int, int, int]):
        """The one round no earlier fixture can feed, so its sides name a group and a placing instead."""

        groups, teams, qualifiers = shape
        season = rules(groups=groups, teams=teams, qualifiers=qualifiers)
        opening = knockout_phases_for(qualifier_count(season))[0]
        wired = [
            (quelle["gruppe"], quelle["platz"])
            for spiel in draw(*shape).spiele
            if spiel["saison_phase"] == opening
            for quelle in (spiel["team1_quelle"], spiel["team2_quelle"])
        ]

        assert wired == list(BRACKET_SEEDING[(groups, qualifiers)])

    @pytest.mark.parametrize("shape", SHAPES)
    def test_a_later_bracket_round_names_the_two_fixtures_feeding_it(self, shape: tuple[int, int, int]):
        """Left to right, winners only: a `verlierer` source is what a third-place play-off would need, and this competition plays none."""

        groups, teams, qualifiers = shape
        season = rules(groups=groups, teams=teams, qualifiers=qualifiers)
        rounds = knockout_phases_for(qualifier_count(season))
        plan = draw(*shape)
        by_phase: dict[FLSaisonPhase, list[int]] = {}
        for spiel in plan.spiele:
            if spiel["saison_phase"] != "gruppenphase":
                by_phase.setdefault(spiel["saison_phase"], []).append(spiel["spiel_nr"])

        for earlier, later in zip(rounds, rounds[1:], strict=False):
            feeding = by_phase[earlier]
            wired = [(spiel["team1_quelle"], spiel["team2_quelle"]) for spiel in plan.spiele if spiel["saison_phase"] == later]
            assert wired == [
                (
                    {"type": "spiel", "spiel_nr": feeding[slot], "ausgang": "sieger"},
                    {"type": "spiel", "spiel_nr": feeding[slot + 1], "ausgang": "sieger"},
                )
                for slot in range(0, len(feeding), 2)
            ]

    @pytest.mark.parametrize("shape", SHAPES)
    def test_a_group_source_names_a_placing_the_group_phase_produces(self, shape: tuple[int, int, int]):
        """A `platz` past the group's size is `gruppe_too_small`, a bracket fault the draw must never write."""

        groups, teams, _ = shape

        for spiel in draw(*shape).spiele:
            for quelle in (spiel["team1_quelle"], spiel["team2_quelle"]):
                if quelle is not None and quelle["type"] == "gruppe":
                    assert quelle["gruppe"] in GRUPPEN[:groups]
                    assert 1 <= quelle["platz"] <= teams


class TestTheSeasonIsPlayedUnderTheJunctionRowsNames:
    @pytest.mark.parametrize("shape", SHAPES)
    def test_a_side_copies_the_name_and_shorthand_the_row_carries(self, shape: tuple[int, int, int]):
        """The row's name, never the club's: the row is what the season was played under (`docs/backend/spec.md :: I19`)."""

        groups, teams, _ = shape
        entered = entered_for(groups, teams)
        expected = {team.team_id: (team.name, team.shorthand) for team in entered}

        for spiel in draw(*shape).spiele:
            for side in (spiel["team1"], spiel["team2"]):
                if side is not None:
                    assert (side["name"], side["shorthand"]) == expected[side["team_id"]]

    @pytest.mark.parametrize("shape", SHAPES)
    def test_the_entry_order_is_the_row_id_and_not_the_order_the_caller_passed(self, shape: tuple[int, int, int]):
        """A read handing the rows back in another order must not redraw the season."""

        groups, teams, qualifiers = shape
        entered = entered_for(groups, teams)

        assert signature(draw(groups, teams, qualifiers, entered=tuple(reversed(entered)))) == signature(draw(*shape))

    @pytest.mark.parametrize("shape", SHAPES)
    def test_renaming_every_club_leaves_the_pairing_untouched(self, shape: tuple[int, int, int]):
        """Names and shorthands are editable, so a draw reading either would let a rename redraw a season already played."""

        groups, teams, qualifiers = shape
        renamed = tuple(
            EnteredTeam(row_id=team.row_id, team_id=team.team_id, gruppe=team.gruppe, name=f"Z{index}", shorthand=f"z{index % 10}")
            for index, team in enumerate(entered_for(groups, teams))
        )

        assert signature(draw(groups, teams, qualifiers, entered=renamed)) == signature(draw(*shape))


class TestADrawRefusesWhatItCannotDrawTruthfully:
    def test_a_group_short_of_its_size_is_refused(self):
        """Drawing what stands would short one round robin while every matchday goes on expecting the full one."""

        entered = entered_for(2, 4)

        with pytest.raises(ValueError, match="groups of 4"):
            draw(2, 4, 2, entered=entered[:-1])

    def test_a_club_in_a_group_the_season_does_not_offer_is_refused(self):
        """`number_of_groups` is the season's capacity, and a club outside it would be drawn into no round robin at all."""

        entered = entered_for(2, 4)
        stray = EnteredTeam(row_id=entered[0].row_id, team_id=entered[0].team_id, gruppe="C", name="C1-Schule", shorthand="99")

        with pytest.raises(ValueError, match="does not offer"):
            draw(2, 4, 2, entered=(stray, *entered[1:]))
