from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from itertools import combinations, product
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
)
from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.saisons.services import (
    DRAWN_HOLDING_ITS_SIDES,
    RECORDED_FACT_FIELDS,
    find_rules_refusal,
    find_spielplan_refusal,
    holds_a_recorded_fact,
)
from app.api.saisons.spielplan import EnteredTeam, Spielplan, bracket_seeding, circle_rounds, draw_spielplan
from app.api.spiele.schemas import PHASE_ORDER, PHASE_RANK
from app.core.codes import Code
from app.core.exceptions import WriteRefusal
from app.shared.schemas.literals import FLGruppenNames, FLSaisonPhase, FLSonderereignis
from tests.bracket_reference import BRACKET_SEEDING
from tests.documents import rules_document

GRUPPEN: tuple[FLGruppenNames, ...] = get_args(FLGruppenNames.__value__)

SAISON_ID = "2026"

Seeding = tuple[tuple[FLGruppenNames, int], ...]
Score = tuple[tuple[int, ...], tuple[int, ...]]

# `(number_of_groups, teams_per_group, qualifiers_per_group)`. Every `BRACKET_SEEDING` row is drawn by one of these.
SHAPES: tuple[tuple[int, int, int], ...] = (
    (1, 7, 4),
    (1, 8, 8),
    (2, 4, 2),
    (2, 6, 4),
    (4, 2, 2),
    (4, 5, 1),
    (4, 4, 4),
    (2, 8, 8),
    (1, 16, 16),
)


def rules(*, groups: int, teams: int, qualifiers: int) -> FLSaisonRules:
    return FLSaisonRules.model_validate(
        rules_document(
            qualifiers_per_gruppe=qualifiers, number_of_gruppen=groups, teams_per_gruppe=teams, allowed_stufen=["E1", "E2", "Q1", "Q2"]
        )
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
            shorthand=f"T{chr(65 + index // 26)}{chr(65 + index % 26)}",
        )
        for index, (seat, gruppe) in enumerate(product(range(teams), GRUPPEN[:groups]))
    )


def draw(groups: int, teams: int, qualifiers: int, entered: Sequence[EnteredTeam] | None = None) -> Spielplan:
    season = rules(groups=groups, teams=teams, qualifiers=qualifiers)
    return draw_spielplan(saison_id=SAISON_ID, rules=season, entered=entered_for(groups, teams) if entered is None else entered)


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
        """One group's share of `count_spiele`; an odd group pairs all but the club on its bye."""

        assert [len(pairs) for pairs in circle_rounds(teams)] == [group_matches_per_matchday(1, teams)] * group_matchdays(teams)

    @pytest.mark.parametrize("teams", range(2, 17))
    def test_every_club_meets_every_other_exactly_once(self, teams: int):
        """A round robin by definition, and what makes the group table a fair one."""

        played = [frozenset(pair) for pairs in circle_rounds(teams) for pair in pairs]

        assert sorted(played, key=sorted) == sorted((frozenset(pair) for pair in combinations(range(teams), 2)), key=sorted)

    @pytest.mark.parametrize("teams", range(2, 17))
    def test_nobody_is_paired_twice_in_one_round(self, teams: int):
        """A club fielded twice on one matchday is a state no Spieltag may hold."""

        for pairs in circle_rounds(teams):
            sides = [side for pair in pairs for side in pair]
            assert len(set(sides)) == len(sides)

    def test_it_pairs_the_two_smallest_groups_exactly_like_this(self):
        """Hand-derived rather than recorded from a run, so this pins the sides as well as the pairs."""

        assert circle_rounds(3) == (((1, 2),), ((2, 0),), ((0, 1),))
        assert circle_rounds(4) == (((0, 3), (1, 2)), ((2, 0), (3, 1)), ((0, 1), (2, 3)))


def ceiling(field: str) -> int:
    """The `le` a rules field states, read off the model so widening one widens the sweep rather than leaving it under the old bound."""

    return next(constraint.le for constraint in FLSaisonRules.model_fields[field].metadata if hasattr(constraint, "le"))


def legal_combinations() -> set[tuple[int, int]]:
    """Every `(number_of_groups, qualifiers_per_group)` a create passes the write path with.

    `qualifiers_per_gruppe` states no `le` of its own; the excess rule caps it at `teams_per_gruppe`,
    so that field's ceiling is as wide as a qualifier count can be.
    """

    return {
        (groups, qualifiers)
        for groups in range(1, ceiling("number_of_gruppen") + 1)
        for qualifiers in range(1, ceiling("teams_per_gruppe") + 1)
        if find_rules_refusal(
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


def best_possible(groups: int, qualifiers: int) -> Score:
    """The score no banded seeding beats.

    Both objectives reach their own bound at once, so the optimum is no compromise between them.
    """

    # Members of one group, and of one placing alike, spread one per block, so a pair's round follows
    # the two block indices and nothing inside a block can move it.
    def spread(members: int, block_bits: int, copies: int) -> tuple[int, ...]:
        rounds = [block_bits + (one ^ other).bit_length() for one in range(members) for other in range(one + 1, members)]
        return tuple(sorted(rounds * copies))

    return spread(qualifiers, groups.bit_length() - 1, groups), spread(groups, qualifiers.bit_length() - 1, qualifiers)


class TestTheTableCoversTheWritePath:
    def test_the_construction_answers_every_combination_a_season_can_be_saved_in(self):
        """Derived from the rules bounds and the refusal, so widening either cannot strand a legal season with nothing to draw from.

        The one case holding a shape the reference table leaves out to every qualifier once: `score` cannot see a repeated pair.
        """

        for groups, qualifiers in legal_combinations():
            row = bracket_seeding(number_of_gruppen=groups, qualifiers_per_gruppe=qualifiers)

            assert sorted(row) == sorted((gruppe, platz) for gruppe in GRUPPEN[:groups] for platz in range(1, qualifiers + 1))


class TestEveryRowIsAWholeDraw:
    @pytest.mark.parametrize("key", sorted(BRACKET_SEEDING))
    def test_round_one_draws_placings_summing_to_one_past_the_qualifier_count(self, key: tuple[int, int]):
        """What seeding is for: a group winner draws the weakest qualifier the round still holds."""

        qualifiers = key[1]
        row = BRACKET_SEEDING[key]

        assert [row[slot][1] + row[slot + 1][1] for slot in range(0, len(row), 2)] == [qualifiers + 1] * (len(row) // 2)


class TestTheConstructionIsTheTable:
    @pytest.mark.parametrize("key", sorted(BRACKET_SEEDING))
    def test_it_reproduces_the_reference_row(self, key: tuple[int, int]):
        """A difference here is the construction wrong: the rows were checked by hand and outrank it."""

        assert bracket_seeding(number_of_gruppen=key[0], qualifiers_per_gruppe=key[1]) == BRACKET_SEEDING[key]


class TestTheConstructionScoresTheBestThereIs:
    @pytest.mark.parametrize("key", sorted(legal_combinations()))
    def test_it_reaches_the_closed_form_bound(self, key: tuple[int, int]):
        """Every shape the write path admits, never the reference table's keys, which a widened rules bound may leave behind.

        The closed form is linear in the field, so the proof follows that widening at no cost.
        """

        assert score(bracket_seeding(number_of_gruppen=key[0], qualifiers_per_gruppe=key[1])) == best_possible(*key)


class TestTheDrawIsTheSeasonTheRulesDescribe:
    @pytest.mark.parametrize("shape", SHAPES)
    def test_each_phase_gets_the_matchdays_its_schedule_names(self, shape: tuple[int, int, int]):
        groups, teams, qualifiers = shape
        plan = draw(*shape)
        drawn = [(spieltag["saison_phase"], spieltag["position"]) for spieltag in plan.spieltage]

        assert drawn == [
            (entry.phase, position)
            for entry in schedule_for(rules(groups=groups, teams=teams, qualifiers=qualifiers))
            for position in range(1, entry.spieltage + 1)
        ]

    @pytest.mark.parametrize("shape", SHAPES)
    def test_every_matchday_holds_the_matches_its_phase_expects(self, shape: tuple[int, int, int]):
        """`count_spiele` is derived per matchday, so a matchday off this count reads as incomplete forever."""

        groups, teams, qualifiers = shape
        season = rules(groups=groups, teams=teams, qualifiers=qualifiers)
        plan = draw(*shape)
        phases = matchday_phases(plan)

        held: dict[ObjectId, int] = {spieltag_id: 0 for spieltag_id in phases}
        for spiel in plan.spiele:
            held[spiel["spieltag_id"]] += 1

        assert held == {spieltag_id: expected_matches(season, phase) for spieltag_id, phase in phases.items()}

    @pytest.mark.parametrize("shape", SHAPES)
    def test_the_bracket_halves_down_to_one_final(self, shape: tuple[int, int, int]):
        """And the Finale's matchday adds the match for third place wherever semi-finals precede it."""

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
        if "halbfinale" in expected:
            expected["finale"] += 1

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
    def test_a_group_spiel_takes_its_sides_in_the_order_the_pairing_names(self, shape: tuple[int, int, int]):
        """Every other pairing assertion here compares unordered pairs.

        A draw that swapped `team1` and `team2` on every fixture would pass all of them.
        """

        groups, teams, _ = shape
        entered = entered_for(groups, teams)
        squads = {gruppe: [team for team in entered if team.gruppe == gruppe] for gruppe in GRUPPEN[:groups]}
        drawn = [(spiel["team1"]["team_id"], spiel["team2"]["team_id"]) for spiel in draw(*shape).spiele if spiel["team1"] is not None]

        assert drawn == [
            (squads[gruppe][one].team_id, squads[gruppe][other].team_id)
            for pairs in circle_rounds(teams)
            for gruppe in GRUPPEN[:groups]
            for one, other in pairs
        ]

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


class TestTheEmittedDocumentsReadBack:
    @pytest.mark.parametrize("shape", SHAPES)
    def test_nothing_is_scheduled_and_nothing_has_happened(self, shape: tuple[int, int, int]):
        """A drawn season states no date, no venue, no referee and no result: each is a later decision, and a placeholder would read as one."""

        for spiel in draw(*shape).spiele:
            assert [
                spiel[field] for field in ("date", "time", "spielort", "schiedsrichter", "ergebnis", "elfmeterschiessen", "sonderereignis")
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
    def test_every_spiel_sits_in_a_matchday_this_call_produced(self, shape: tuple[int, int, int]):
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

        assert all((spieltag["start"], spieltag["end"]) == (None, None) for spieltag in draw(*shape).spieltage)


class TestASpielIsEitherDrawnOrWired:
    @pytest.mark.parametrize("shape", SHAPES)
    def test_a_group_spiel_names_both_clubs_and_no_source(self, shape: tuple[int, int, int]):
        for spiel in draw(*shape).spiele:
            if spiel["saison_phase"] == "gruppenphase":
                assert spiel["team1"] is not None and spiel["team2"] is not None
                assert spiel["team1_quelle"] is None and spiel["team2_quelle"] is None
                assert spiel["team1"]["tore"] is None and spiel["team2"]["tore"] is None

    @pytest.mark.parametrize("shape", SHAPES)
    def test_a_bracket_spiel_names_both_sources_and_no_club(self, shape: tuple[int, int, int]):
        """Absence is MODELLED rather than impersonated: nobody has qualified yet, so neither side holds a club."""

        for spiel in draw(*shape).spiele:
            if spiel["saison_phase"] != "gruppenphase":
                assert spiel["team1"] is None and spiel["team2"] is None
                assert spiel["team1_quelle"] is not None and spiel["team2_quelle"] is not None

    @pytest.mark.parametrize("shape", SHAPES)
    def test_the_first_bracket_round_wires_the_reference_row(self, shape: tuple[int, int, int]):
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
    def test_a_later_bracket_round_names_the_two_spiele_feeding_it(self, shape: tuple[int, int, int]):
        """Left to right, winners only: the one `verlierer` pair is the match for third place, judged on its own below."""

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
            wired = [
                (spiel["team1_quelle"], spiel["team2_quelle"])
                for spiel in plan.spiele
                if spiel["saison_phase"] == later and spiel["team1_quelle"]["ausgang"] == "sieger"
            ]
            assert wired == [
                (
                    {"type": "spiel", "spiel_nr": feeding[slot], "ausgang": "sieger"},
                    {"type": "spiel", "spiel_nr": feeding[slot + 1], "ausgang": "sieger"},
                )
                for slot in range(0, len(feeding), 2)
            ]


class TestTheSemiFinalLosersPlayForThirdPlace:
    @pytest.mark.parametrize("shape", SHAPES)
    def test_the_finale_matchday_opens_with_the_two_semi_finals_losers(self, shape: tuple[int, int, int]):
        """Before the final, so the matchday is played in the order its numbers read."""

        plan = draw(*shape)
        semi_finals = [spiel["spiel_nr"] for spiel in plan.spiele if spiel["saison_phase"] == "halbfinale"]
        finale = [
            (spiel["team1_quelle"], spiel["team2_quelle"])
            for spiel in sorted(plan.spiele, key=lambda spiel: spiel["spiel_nr"])
            if spiel["saison_phase"] == "finale"
        ]

        assert finale == [
            tuple({"type": "spiel", "spiel_nr": nr, "ausgang": "verlierer"} for nr in semi_finals),
            tuple({"type": "spiel", "spiel_nr": nr, "ausgang": "sieger"} for nr in semi_finals),
        ]


class TestTheDrawFollowsTheEntryOrderAlone:
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
            EnteredTeam(
                row_id=team.row_id,
                team_id=team.team_id,
                gruppe=team.gruppe,
                name=f"Z{index}",
                shorthand=f"Z{chr(65 + index // 26)}{chr(65 + index % 26)}",
            )
            for index, team in enumerate(entered_for(groups, teams))
        )

        assert signature(draw(groups, teams, qualifiers, entered=renamed)) == signature(draw(*shape))


RULES = FLSaisonRules(
    win_points=3,
    draw_points=1,
    loss_points=0,
    qualifiers_per_gruppe=2,
    number_of_gruppen=4,
    teams_per_gruppe=6,
    tiebreak_order="tordifferenz",
    max_kader_size=20,
    forfeit_ergebnis=FLSaisonForfeitErgebnis(sieger_tore=3, verlierer_tore=0),
    allowed_stufen=["Q1"],
)

FULL: Mapping[FLGruppenNames, int] = {"A": 6, "B": 6, "C": 6, "D": 6}


def refusal_for(
    *,
    saison_status: str = "future",
    spiele_drawn: int = 0,
    spieltage_held: int = 0,
    occupancy: Mapping[FLGruppenNames, int] = FULL,
    rules: FLSaisonRules = RULES,
    replace: bool = False,
    recorded: int = 0,
) -> WriteRefusal | None:
    return find_spielplan_refusal(
        saison_status=saison_status,
        spiele_drawn=spiele_drawn,
        spieltage_held=spieltage_held,
        rules=rules,
        occupancy_by_gruppe=occupancy,
        replace=replace,
        recorded_spiele=recorded,
    )


class TestASeasonHoldingMatchdays:
    """`spielplan_spieltage_held`: the draw writes the whole matchday list, so it cannot join one already there."""

    def test_a_matchday_without_spiele_refuses_the_draw(self):
        refusal = refusal_for(spieltage_held=1)

        assert refusal is not None
        assert refusal.error_code == Code.SPIELPLAN_SPIELTAGE_HELD


class TestAFinishedSeason:
    """`saison_past`: a finished season's table is the record of what happened, and a draw would reopen it."""

    def test_a_past_season_refuses_the_draw(self):
        refusal = refusal_for(saison_status="past")

        assert refusal is not None
        assert refusal.error_code == Code.SAISON_PAST


class TestWhetherEveryOfferedGroupHoldsItsSize:
    """`spielplan_gruppen_off_rules`, and all three answers it gives.

    A group short of `teams_per_gruppe`, a group past it, and a club standing in a group the season
    does not offer -- one class, because `Rule.tested_by` cites one.
    """

    def test_a_short_group_refuses_the_draw(self):
        refusal = refusal_for(occupancy={**FULL, "B": 4})

        assert refusal is not None
        assert refusal.error_code == Code.SPIELPLAN_GRUPPEN_OFF_RULES

    def test_a_group_holding_more_than_the_rules_ask_refuses_the_draw(self):
        """The other direction: a group past `teams_per_gruppe` draws more fixtures than its matchdays account for."""

        refusal = refusal_for(occupancy={**FULL, "A": 7})

        assert refusal is not None
        assert refusal.error_code == Code.SPIELPLAN_GRUPPEN_OFF_RULES

    def test_a_group_beyond_the_offered_ones_refuses_the_draw(self):
        """A club in a group the season does not run draws into no round robin at all.

        `entry_gruppe_not_offered` closes every entry and `rules_gruppen_in_use` the rules patch; this rule closes the
        draw's own `shape`, judged with `stored` as `None`.
        """

        two_groups = RULES.model_copy(update={"number_of_gruppen": 2})
        refusal = refusal_for(occupancy={"A": 6, "B": 6, "C": 1}, rules=two_groups)

        assert refusal is not None
        assert refusal.error_code == Code.SPIELPLAN_GRUPPEN_OFF_RULES


class TestAConfirmedReplaceStepsPastWhatItDeletes:
    """`spielplan_already_drawn` and `spielplan_spieltage_held` name what a replace is about to remove, so neither may turn one away."""

    def test_a_group_off_its_size_still_refuses_a_confirmed_replace(self):
        """Gate `spielplan_gruppen_off_rules` on `replace` too and this fails: a replace draws the same fixtures, so needs the same groups."""

        refusal = refusal_for(replace=True, spiele_drawn=67, spieltage_held=8, occupancy={**FULL, "B": 4})

        assert refusal is not None
        assert refusal.error_code == Code.SPIELPLAN_GRUPPEN_OFF_RULES


ADLER = "68f0a1b2c3d4e5f607600011"
BIEBER = "68f0a1b2c3d4e5f607600012"
SPIELORT = "68f0a1b2c3d4e5f607600001"
SCHIEDSRICHTER = "68f0a1b2c3d4e5f607600002"

# Off the enum rather than spelled: every phase but the one the draw seats its sides on is judged
# the same way, so whichever comes first stands for all of them.
BRACKET_PHASE: FLSaisonPhase = next(phase for phase in PHASE_ORDER if phase != DRAWN_HOLDING_ITS_SIDES)

# A GROUP fixture exactly as the draw wrote it: both sides seated, no wiring, every field a record
# could land in empty. No `note` key at all, which is the shape
# `app/api/saisons/spielplan.py :: _spiel` leaves.
UNTOUCHED_SPIEL: Mapping[str, Any] = {
    "saison_phase": DRAWN_HOLDING_ITS_SIDES,
    "ergebnis": None,
    "elfmeterschiessen": None,
    "sonderereignis": None,
    "team1": {"team_id": ADLER, "tore": None},
    "team2": {"team_id": BIEBER, "tore": None},
    "team1_quelle": None,
    "team2_quelle": None,
    # No block, as the draw writes neither: a referee's block naming nobody is a record of its own.
    "spielort": None,
    "schiedsrichter": None,
}

# The OTHER shape the same draw writes, and the one an admin seeds by hand: a knockout slot wired to
# a placing and holding nobody.
UNTOUCHED_BRACKET: Mapping[str, Any] = {
    **UNTOUCHED_SPIEL,
    "saison_phase": BRACKET_PHASE,
    "team1": None,
    "team2": None,
    "team1_quelle": {"type": "gruppe", "gruppe": "A", "platz": 1},
    "team2_quelle": {"type": "gruppe", "gruppe": "B", "platz": 2},
}


@dataclass(frozen=True)
class RecordedEdit:
    """One projected field, and what somebody entering something in THAT field looks like."""

    # Carried into the assertion, so a narrowed predicate names the fact it stopped seeing.
    why: str
    gruppe: Mapping[str, Any]
    # Declared for the fields the draw leaves inverted between the two shapes, and only those;
    # `INVERTED_BY_THE_DRAW` below holds the two sets to each other.
    ko: Mapping[str, Any] | None = None


# One entry per `app/api/saisons/services.py :: RECORDED_FACT_FIELDS` path. Keyed by the whole path
# and never its head: a leaf added under `team1` then owes an entry of its own rather than folding
# into one already here and passing unweighed.
RECORDED_EDITS: Mapping[str, RecordedEdit] = {
    # NO record of its own -- it is the DISCRIMINATOR, so its edit is the flip under a pair of sides
    # nobody touched. Read the wrong one and every drawn season is misjudged in one direction.
    "saison_phase": RecordedEdit(
        why="the phase, which records nothing itself and decides which shape the sides are read against",
        gruppe={"saison_phase": BRACKET_PHASE},
        ko={"saison_phase": DRAWN_HOLDING_ITS_SIDES},
    ),
    "team1.team_id": RecordedEdit(
        why="the side a Spieltag release empties, and the bracket slot a resolution seeded",
        gruppe={"team1": None},
        ko={"team1": {"team_id": ADLER, "tore": None}},
    ),
    "team2.team_id": RecordedEdit(
        why="the same on the other side, which a loop over one slot would miss",
        gruppe={"team2": None},
        ko={"team2": {"team_id": BIEBER, "tore": None}},
    ),
    # Its side left SEATED and unwired, so nothing but the goal count can be what answers.
    "team1.tore": RecordedEdit(why="a goal count standing without a result", gruppe={"team1": {"team_id": ADLER, "tore": 0}}),
    "team2.tore": RecordedEdit(why="the same count on the other side", gruppe={"team2": {"team_id": BIEBER, "tore": 0}}),
    "team1_quelle": RecordedEdit(
        why="wiring `wiring_unsupported` refuses on a group fixture, and a bracket slot whose wiring an admin cleared",
        gruppe={"team1_quelle": {"type": "gruppe", "gruppe": "A", "platz": 1}},
        ko={"team1_quelle": None},
    ),
    "team2_quelle": RecordedEdit(
        why="the same on the other side",
        gruppe={"team2_quelle": {"type": "gruppe", "gruppe": "B", "platz": 2}},
        ko={"team2_quelle": None},
    ),
    "ergebnis": RecordedEdit(why="a result", gruppe={"ergebnis": "2:1"}),
    # The value awarding NOTHING on purpose: `has_taken_place` reads it as untouched, so reaching for
    # that narrower question instead of this window is the mistake this entry is here to fail.
    "sonderereignis": RecordedEdit(why="a cancellation, which awards nothing and is still a record", gruppe={"sonderereignis": "ausgefallen"}),
    "spielort.spielort_id": RecordedEdit(why="a booked venue", gruppe={"spielort": {"spielort_id": SPIELORT}}),
    "schiedsrichter.schiedsrichter_id": RecordedEdit(why="a booked referee", gruppe={"schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER}}),
    "note": RecordedEdit(why="an admin's note, which only `PATCH /spiele/{spiel_id}` writes", gruppe={"note": "Platz gesperrt"}),
}


class TestWhatCountsAsRecordedAgainstASpiel:
    """`holds_a_recorded_fact`, which is what the endpoint counts for `spielplan_replace_outside_its_window`.

    The refusal reads a COUNT, so no test of it reaches this: the window closes on a cancellation
    and on a booking as well as on a result.
    """

    def test_every_projected_field_is_answered_by_an_edit_and_nothing_else_is(self):
        """THE COUPLING: add a field to `RECORDED_FACT_FIELDS` and this fails naming it.

        Projected and never read is the defect it is against -- the field reaches the predicate,
        changes no answer, and every other test stays green.
        """

        unanswered = sorted(set(RECORDED_FACT_FIELDS) - set(RECORDED_EDITS))
        stale = sorted(set(RECORDED_EDITS) - set(RECORDED_FACT_FIELDS))

        assert (unanswered, stale) == ([], [])

    def test_a_spiel_as_the_draw_wrote_it_leaves_the_window_open(self):
        """The premise of every case below: a shape already reading as recorded makes each of them pass whatever it edits."""

        assert (holds_a_recorded_fact(UNTOUCHED_SPIEL), holds_a_recorded_fact(UNTOUCHED_BRACKET)) == (False, False)

    @pytest.mark.parametrize(("projected", "edit"), RECORDED_EDITS.items(), ids=list(RECORDED_EDITS))
    def test_a_spiel_carrying_that_edit_closes_the_window(self, projected: str, edit: RecordedEdit):
        """Stop reading any one of these and a replace deletes the work it records, the endpoint answering 200."""

        assert holds_a_recorded_fact({**UNTOUCHED_SPIEL, **edit.gruppe}) is True, f"{projected} left the group window open: {edit.why}"

        if edit.ko is not None:
            assert holds_a_recorded_fact({**UNTOUCHED_BRACKET, **edit.ko}) is True, f"{projected} left the bracket window open: {edit.why}"

    def test_a_booking_naming_nobody_closes_the_window(self):
        """A played match's booking keeps its fee once its referee was erased: read by its id, it would read as no record."""

        assert holds_a_recorded_fact({**UNTOUCHED_SPIEL, "schiedsrichter": {"schiedsrichter_id": None}}) is True

    @pytest.mark.parametrize("sonderereignis", get_args(FLSonderereignis.__value__))
    def test_every_sonderereignis_closes_the_window_whatever_it_awards(self, sonderereignis: str):
        """Reach for `has_taken_place`'s narrower set and the two awarding nothing stop closing it.

        The map above weighs the field once; this asks it of every value the enum offers, so one
        added later is judged rather than assumed.
        """

        assert holds_a_recorded_fact({**UNTOUCHED_SPIEL, "sonderereignis": sonderereignis}) is True


class TestASideMovedOffTheDrawClosesTheWindow:
    """What the map above cannot state: a pair moved together, and a move no stored field records.

    Bracket seeding is what a `future` season accumulates, and `future` is the only status either
    window opens on.
    """

    def test_a_slot_whose_wiring_was_cleared_and_then_filled_is_recorded(self):
        """The manual pick `find_wiring_refusal` invites -- clear the quelle, then name the team.

        Each half has an entry of its own above; neither of those is this shape, which is the one an
        admin actually reaches through the editor.
        """

        picked = {**UNTOUCHED_BRACKET, "team1_quelle": None, "team1": {"team_id": ADLER, "tore": None}}

        assert holds_a_recorded_fact(picked) is True
