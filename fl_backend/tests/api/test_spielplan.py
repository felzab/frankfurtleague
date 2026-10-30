from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from functools import cache
from http import HTTPStatus
from itertools import combinations, permutations, product
from math import factorial
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
from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.saisons.services import (
    DRAWN_HOLDING_ITS_SIDES,
    RECORDED_FACT_FIELDS,
    as_the_draw_answers,
    find_rules_refusal,
    find_spielplan_refusal,
    holds_a_recorded_fact,
)
from app.api.saisons.spielplan import EnteredTeam, Spielplan, bracket_seeding, circle_rounds, draw_spielplan
from app.api.spiele.schemas import PHASE_ORDER, PHASE_RANK, SONDEREREIGNIS_WITHOUT_A_RESULT, FLSpiel
from app.api.spieltage.schemas import FLSpieltag
from app.core.codes import Code
from app.core.exceptions import WriteRefusal
from app.shared.schemas.literals import FLGruppenNames, FLSaisonPhase, FLSonderereignis
from tests.bracket_reference import BRACKET_SEEDING
from tests.documents import rules_document

GRUPPEN: tuple[FLGruppenNames, ...] = get_args(FLGruppenNames.__value__)

SAISON_ID = "2026"

Seeding = tuple[tuple[FLGruppenNames, int], ...]
Score = tuple[tuple[int, ...], tuple[int, ...]]

# `(number_of_groups, teams_per_group, qualifiers_per_group)`. Every `BRACKET_SEEDING` row is drawn
# by one of these, and each shape's legality is derived rather than trusted -- both below.
SHAPES: tuple[tuple[int, int, int], ...] = (
    (1, 2, 2),
    (2, 3, 1),
    (1, 6, 2),
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
            qualifiers_per_group=qualifiers, number_of_groups=groups, teams_per_group=teams, erlaubte_stufen=["E1", "E2", "Q1", "Q2"]
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
        """A club fielded twice on one matchday is a state no Spieltag may hold."""

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

    def test_it_pairs_the_two_smallest_groups_exactly_like_this(self):
        """Hand-derived rather than recorded from a run, so this pins the sides as well as the pairs."""

        assert circle_rounds(3) == (((1, 2),), ((2, 0),), ((0, 1),))
        assert circle_rounds(4) == (((0, 3), (1, 2)), ((2, 0), (3, 1)), ((0, 1), (2, 3)))

    @pytest.mark.parametrize("teams", range(2, 17))
    def test_the_pinned_club_leads_every_other_fixture_it_plays(self, teams: int):
        """The alternation `circle_rounds` documents.

        Position 0 is the only club whose pair could otherwise list it first every round, because
        it is the one the rotation holds still.
        """

        leads = [pair[0] == 0 for pairs in circle_rounds(teams) for pair in pairs if 0 in pair]

        assert sum(leads) == (len(leads) + 1) // 2

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
    """Cached: the widest sweep would otherwise rebuild this list on every one of its `sweep_size` steps."""

    return tuple(permutations(offered))


def partner_consistent_seedings(groups: int, qualifiers: int) -> Iterator[Seeding]:
    """Every placement the obvious runtime rule permits: round one pairs A with B and C with D, at placings summing to `qualifiers + 1`."""

    # The whole `groups! ** qualifiers` space, never the normalised one: what is counted is how much
    # the rule leaves open, so no symmetry may be quotiented away first.
    field = groups * qualifiers
    seed_at = bracket_slots(field)
    band_at = [(seed - 1) // groups for seed in seed_at]
    rank_at = [(seed - 1) % groups for seed in seed_at]
    opening = range(0, field, 2)

    # Which placings a round-one pair draws is fixed by the bracket itself, so this half of the rule
    # holds for every arrangement or for none.
    if any(band_at[slot] + band_at[slot + 1] != qualifiers - 1 for slot in opening):
        return

    offered = GRUPPEN[:groups]
    for bands in product(permutations(range(groups)), repeat=qualifiers):
        if all(bands[band_at[slot + 1]][rank_at[slot + 1]] == bands[band_at[slot]][rank_at[slot]] ^ 1 for slot in opening):
            yield tuple((offered[bands[band_at[slot]][rank_at[slot]]], band_at[slot] + 1) for slot in range(field))


@cache
def optimum(groups: int, qualifiers: int) -> Score:
    """The best score the banded space reaches, cached because `sweep_size` is what one call walks."""

    return max(score(seeding) for seeding in band_seedings(groups, qualifiers))


def sweep_size(groups: int, qualifiers: int) -> int:
    """What one exhaustive sweep costs.

    `max(1, ...)`: at a single qualifier `product` walks one seeding and still builds every
    permutation of the groups first, so the factorial is the floor rather than the exponent.
    """

    return factorial(groups) ** max(1, qualifiers - 1)


# `permutations_of` builds every permutation of the offered groups before `product` walks anything, so
# a ceiling on the count is what keeps an unreachable size a skipped key rather than a `MemoryError`.
SWEEP_CEILING = 50_000

SWEPT_KEYS: tuple[tuple[int, int], ...] = tuple(key for key in sorted(BRACKET_SEEDING) if sweep_size(*key) <= SWEEP_CEILING)

# Derived from the WRITE PATH rather than from the reference table, so a widened rules bound gains its
# second witness without anybody hand-writing a row for the shape it opened.
SWEEPABLE_KEYS: tuple[tuple[int, int], ...] = tuple(key for key in sorted(legal_combinations()) if sweep_size(*key) <= SWEEP_CEILING)

# A one-group season has only the identity relabelling, so the symmetry test says nothing there.
MULTI_GROUP_KEYS: tuple[tuple[int, int], ...] = tuple(key for key in SWEPT_KEYS if key[0] > 1)


def best_possible(groups: int, qualifiers: int) -> Score:
    """The score no banded seeding beats, computed rather than swept.

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
        """Derived from the rules bounds and the refusal, so widening either cannot strand a legal season with nothing to draw from."""

        for groups, qualifiers in legal_combinations():
            row = bracket_seeding(number_of_groups=groups, qualifiers_per_group=qualifiers)

            assert sorted(row) == sorted((gruppe, platz) for gruppe in GRUPPEN[:groups] for platz in range(1, qualifiers + 1))

    def test_no_reference_row_names_a_shape_a_season_cannot_be_saved_in(self):
        """A row nothing can save is a row nothing drives, so no case below would see it go wrong."""

        assert set(BRACKET_SEEDING) <= legal_combinations()

    def test_every_row_is_a_season_some_test_below_actually_draws(self):
        """A row exercised only against itself is one no season was ever generated from."""

        assert {(groups, qualifiers) for groups, _, qualifiers in SHAPES} == set(BRACKET_SEEDING)

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


class TestTheConstructionIsTheTable:
    @pytest.mark.parametrize("key", sorted(BRACKET_SEEDING))
    def test_it_reproduces_the_reference_row(self, key: tuple[int, int]):
        """A difference here is the construction wrong: the rows were checked by hand and outrank it."""

        assert bracket_seeding(number_of_groups=key[0], qualifiers_per_group=key[1]) == BRACKET_SEEDING[key]

    def test_two_rows_are_exactly_these(self):
        """Hand-written, so the table is pinned past what `score` cannot see.

        Reversing a row, or swapping every fixture's two slots, leaves both objectives and the
        `q + 1` sums identical, so the property tests fix the table only up to symmetry.
        """

        assert BRACKET_SEEDING[(2, 2)] == (("A", 1), ("B", 2), ("B", 1), ("A", 2))
        assert BRACKET_SEEDING[(4, 2)] == (("A", 1), ("B", 2), ("C", 1), ("D", 2), ("B", 1), ("A", 2), ("D", 1), ("C", 2))

    def test_a_shape_no_bracket_halves_is_refused(self):
        """A field that is no power of two would index a group the season does not offer."""

        with pytest.raises(ValueError):
            bracket_seeding(number_of_groups=3, qualifiers_per_group=2)

    def test_a_group_count_the_closed_set_cannot_name_is_refused(self):
        """The smallest power of two past the closed set: at any other field the size guard answers instead, and `match` pins which one did.

        Unrefused, a slot indexes past the last name -- an `IndexError`, never a misseeding.
        """

        with pytest.raises(ValueError, match="the closed set holds"):
            bracket_seeding(number_of_groups=1 << len(GRUPPEN).bit_length(), qualifiers_per_group=1)


class TestTheConstructionScoresTheBestThereIs:
    @pytest.mark.parametrize("key", sorted(legal_combinations()))
    def test_it_reaches_the_closed_form_bound(self, key: tuple[int, int]):
        """Every shape the write path admits, never the reference table's keys, which a widened rules bound may leave behind.

        The closed form is linear in the field, so the proof follows that widening at no cost.
        """

        assert score(bracket_seeding(number_of_groups=key[0], qualifiers_per_group=key[1])) == best_possible(*key)

    @pytest.mark.parametrize("key", SWEEPABLE_KEYS)
    def test_an_exhaustive_sweep_finds_that_same_bound(self, key: tuple[int, int]):
        """The second route, and the one that answers whether `best_possible` is the real maximum or only a formula."""

        assert optimum(*key) == best_possible(*key)

    @pytest.mark.parametrize("key", SWEPT_KEYS)
    def test_the_reference_row_still_scores_the_optimum(self, key: tuple[int, int]):
        """Re-run rather than trusted: the row is a literal, and this sweep is what says it is the best one."""

        assert score(BRACKET_SEEDING[key]) == optimum(*key)

    @pytest.mark.parametrize("key", MULTI_GROUP_KEYS)
    def test_relabelling_the_groups_leaves_the_score_unchanged(self, key: tuple[int, int]):
        """What lets the sweep hold one band fixed; without it a fixed band would only BOUND the optimum."""

        offered = GRUPPEN[: key[0]]
        row = BRACKET_SEEDING[key]

        for order in permutations_of(offered):
            relabelled: Seeding = tuple((order[offered.index(gruppe)], platz) for gruppe, platz in row)
            assert score(relabelled) == score(row)

    def test_the_ceiling_admits_every_key_the_closed_set_reaches_and_refuses_the_one_nothing_can_build(self):
        """A ceiling that quietly emptied either set would leave `best_possible` as its own only witness."""

        assert SWEPT_KEYS == tuple(sorted(BRACKET_SEEDING))
        # Every reference row is a legal shape this sweep affords, so no row is left resting on the
        # formula it exists to check.
        assert set(SWEPT_KEYS) <= set(SWEEPABLE_KEYS)
        assert sweep_size(8, 2) <= SWEEP_CEILING < sweep_size(16, 1)


class TestTheConstructionBeatsTheObviousRuntimeRule:
    """Pairing partnered groups fixes WHO meets in round one and never WHERE, so the rule alone is not the construction."""

    @pytest.mark.parametrize(("key", "permitted", "sooner"), (((4, 2), 24, 8), ((4, 4), 576, 480)))
    def test_the_rule_leaves_this_much_open_and_this_much_of_it_is_worse(self, key: tuple[int, int], permitted: int, sooner: int):
        """`sooner` counts the placements meeting a same-group pair in an EARLIER round than the construction does.

        Both keys are written out: `partner_consistent_seedings` walks `factorial(groups) **
        qualifiers` candidates, so a wider one added here would not finish.
        """

        placements = list(partner_consistent_seedings(*key))
        best = best_possible(*key)

        assert len(placements) == permitted
        assert sum(1 for one in placements if score(one)[0][0] < best[0][0]) == sooner

    @pytest.mark.parametrize("key", ((4, 2), (4, 4)))
    def test_the_construction_is_one_the_rule_permits(self, key: tuple[int, int]):
        """So it CHOOSES within the rule rather than departing from it, and what it adds is which placement to ship."""

        assert bracket_seeding(number_of_groups=key[0], qualifiers_per_group=key[1]) in set(partner_consistent_seedings(*key))


class TestTheShapesAreSeasonsThatCanExist:
    @pytest.mark.parametrize("shape", SHAPES)
    def test_the_write_path_accepts_every_shape_drawn_below(self, shape: tuple[int, int, int]):
        """Otherwise the emission tests below prove the draw of a season nobody can save."""

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
    def test_a_group_fixture_takes_its_sides_in_the_order_the_pairing_names(self, shape: tuple[int, int, int]):
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

    @pytest.mark.parametrize("shape", SHAPES)
    def test_a_bracket_fixture_is_fed_only_by_numbers_already_played(self, shape: tuple[int, int, int]):
        """A source naming a later fixture is a bracket that cannot resolve; `find_bracket_faults` would report the cycle."""

        for spiel in draw(*shape).spiele:
            for quelle in (spiel["team1_quelle"], spiel["team2_quelle"]):
                if quelle is not None and quelle["type"] == "spiel":
                    assert quelle["spiel_nr"] < spiel["spiel_nr"]


class TestTheEmittedDocumentsReadBack:
    @pytest.mark.parametrize("shape", SHAPES)
    def test_every_fixture_reads_back_through_the_model_an_endpoint_serves(self, shape: tuple[int, int, int]):
        """A document only the writer can read is one the first `GET /spiele` answers 500 on; one key no model declares, one nothing reads."""

        for spiel in draw(*shape).spiele:
            FLSpiel.model_validate(spiel, extra="forbid")

    @pytest.mark.parametrize("shape", SHAPES)
    def test_every_matchday_reads_back_through_the_model_an_endpoint_serves(self, shape: tuple[int, int, int]):
        """`anzahl_spiele` is injected because it is derived and on no document."""

        groups, teams, qualifiers = shape
        season = rules(groups=groups, teams=teams, qualifiers=qualifiers)

        for spieltag in draw(*shape).spieltage:
            FLSpieltag.model_validate({**spieltag, "anzahl_spiele": expected_matches(season, spieltag["saison_phase"])}, extra="forbid")

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
        """The row's name, never the club's: the row is what the season was played under."""

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


class TestADrawRefusesWhatItCannotDrawTruthfully:
    def test_a_group_short_of_its_size_is_refused(self):
        """Drawing what stands would short one round robin while every matchday goes on expecting the full one."""

        entered = entered_for(2, 4)

        with pytest.raises(ValueError, match="groups of 4"):
            draw(2, 4, 2, entered=entered[:-1])

    def test_a_club_in_a_group_the_season_does_not_offer_is_refused(self):
        """`number_of_groups` is the season's capacity, and a club outside it would be drawn into no round robin at all."""

        entered = entered_for(2, 4)
        stray = EnteredTeam(row_id=entered[0].row_id, team_id=entered[0].team_id, gruppe="C", name="C1-Schule", shorthand="JJX")

        with pytest.raises(ValueError, match="does not offer"):
            draw(2, 4, 2, entered=(stray, *entered[1:]))


RULES = FLSaisonRules(
    win_points=3,
    draw_points=1,
    qualifiers_per_group=2,
    number_of_groups=4,
    teams_per_group=6,
    tiebreak_order="tordifferenz",
    max_kadergroesse=20,
    forfeit_ergebnis=FLSaisonForfeitErgebnis(sieger_tore=3, verlierer_tore=0),
    erlaubte_stufen=["Q1"],
)

FULL: Mapping[FLGruppenNames, int] = {"A": 6, "B": 6, "C": 6, "D": 6}


def refusal_for(
    *,
    saison_status: str = "future",
    fixtures_drawn: int = 0,
    spieltage_held: int = 0,
    occupancy: Mapping[FLGruppenNames, int] = FULL,
    rules: FLSaisonRules = RULES,
    replace: bool = False,
    recorded: int = 0,
) -> WriteRefusal | None:
    return find_spielplan_refusal(
        saison_status=saison_status,
        fixtures_drawn=fixtures_drawn,
        spieltage_held=spieltage_held,
        rules=rules,
        occupancy_by_gruppe=occupancy,
        replace=replace,
        recorded_fixtures=recorded,
    )


class TestASeasonReadyToBeDrawn:
    """The one shape that passes, so every refusal below is shown to need its own reason."""

    def test_a_future_season_with_full_groups_and_nothing_drawn_is_permitted(self):
        assert refusal_for() is None

    def test_a_group_the_season_does_not_offer_may_stand_in_the_map_holding_nobody(self):
        """The map is counted from stored rows, so an emptied group survives as a key; nobody is stranded by it."""

        two_groups = RULES.model_copy(update={"number_of_groups": 2})

        assert refusal_for(occupancy={"A": 6, "B": 6, "C": 0, "D": 0}, rules=two_groups) is None


class TestASeasonHoldingMatchdays:
    """`REQ-SPIELPLAN-002`: the draw writes the whole matchday list, so it cannot join one already there."""

    def test_a_matchday_without_fixtures_refuses_the_draw(self):
        refusal = refusal_for(spieltage_held=1)

        assert refusal is not None
        assert refusal.error_code == Code.SPIELPLAN_MATCHDAYS_HELD


class TestAFinishedSeason:
    """`REQ-SPIELPLAN-003`: a finished season's table is the record of what happened, and a draw would reopen it."""

    def test_a_past_season_refuses_the_draw(self):
        refusal = refusal_for(saison_status="past")

        assert refusal is not None
        assert refusal.error_code == Code.SPIELPLAN_SAISON_FINISHED

    def test_a_running_season_is_permitted(self):
        """The pair to `REQ-ACTIVATE-003`, and the whole reason this refuses `past` alone.

        Activation writes `status` one way, so refusing a running season here would leave one
        activated before its draw unschedulable for good rather than merely out of order.
        """

        assert refusal_for(saison_status="active") is None


class TestWhetherEveryOfferedGroupHoldsItsSize:
    """`REQ-SPIELPLAN-004`, and all three answers it gives.

    A group short of `teams_per_group`, a group past it, and a club standing in a group the season
    does not offer -- one class, because `Rule.tested_by` cites one.
    """

    def test_a_short_group_refuses_the_draw(self):
        refusal = refusal_for(occupancy={**FULL, "B": 4})

        assert refusal is not None
        assert refusal.error_code == Code.SPIELPLAN_GRUPPEN_OFF_RULES

    def test_a_group_holding_more_than_the_rules_ask_refuses_the_draw(self):
        """The other direction: a group past `teams_per_group` draws more fixtures than its matchdays account for."""

        refusal = refusal_for(occupancy={**FULL, "A": 7})

        assert refusal is not None
        assert refusal.error_code == Code.SPIELPLAN_GRUPPEN_OFF_RULES

    def test_a_group_beyond_the_offered_ones_refuses_the_draw(self):
        """A club in a group the season does not run draws into no round robin at all.

        `REQ-ENTER-002` closes every entry and `REQ-RULES-002` the rules patch; this rule closes the
        draw's own `shape`, judged with `stored` as `None`.
        """

        two_groups = RULES.model_copy(update={"number_of_groups": 2})
        refusal = refusal_for(occupancy={"A": 6, "B": 6, "C": 1}, rules=two_groups)

        assert refusal is not None
        assert refusal.error_code == Code.SPIELPLAN_GRUPPEN_OFF_RULES

    def test_an_offered_group_nobody_is_entered_into_is_named_as_holding_none(self):
        """A group nobody is entered into is absent from the map rather than present at 0.

        The ordinary state of a season about to be drawn, so reading the map by subscript would turn
        its most frequent refusal into a 500.
        """

        refusal = refusal_for(occupancy={"A": 6, "B": 6})

        assert refusal is not None
        assert refusal.error_code == Code.SPIELPLAN_GRUPPEN_OFF_RULES

    def test_a_group_the_season_does_not_offer_is_not_counted(self):
        """`offered_gruppen` bounds it: a two-group season is not short because C and D are absent from the map."""

        two_groups = RULES.model_copy(update={"number_of_groups": 2})
        refusal = find_spielplan_refusal(
            saison_status="future",
            fixtures_drawn=0,
            spieltage_held=0,
            rules=two_groups,
            occupancy_by_gruppe={"A": 6, "B": 6},
            replace=False,
            recorded_fixtures=0,
        )

        assert refusal is None


class TestAConfirmedReplaceStepsPastWhatItDeletes:
    """`REQ-SPIELPLAN-001` and `REQ-SPIELPLAN-002` name what a replace is about to remove, so neither may turn one away."""

    def test_a_season_already_holding_a_whole_spielplan_is_replaced(self):
        """Drop `and not replace` from the fixture guard and this fails, the replace refused over the rows it deletes."""

        assert refusal_for(replace=True, fixtures_drawn=67, spieltage_held=8) is None

    def test_a_season_holding_matchdays_and_no_fixture_is_replaced(self):
        """The matchday guard's own step-aside, and the shape a draw stopped between its two writes would leave."""

        assert refusal_for(replace=True, spieltage_held=8) is None

    def test_a_group_off_its_size_still_refuses_a_confirmed_replace(self):
        """Gate `REQ-SPIELPLAN-004` on `replace` too and this fails: a replace draws the same fixtures, so it needs the same groups."""

        refusal = refusal_for(replace=True, fixtures_drawn=67, spieltage_held=8, occupancy={**FULL, "B": 4})

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
# could land in empty. No `notiz` key at all, which is the shape
# `app/api/saisons/spielplan.py :: _spiel` leaves.
UNTOUCHED_FIXTURE: Mapping[str, Any] = {
    "saison_phase": DRAWN_HOLDING_ITS_SIDES,
    "ergebnis": None,
    "elfmeterschiessen": None,
    "sonderereignis": None,
    "team1": {"team_id": ADLER, "tore": None},
    "team2": {"team_id": BIEBER, "tore": None},
    "team1_quelle": None,
    "team2_quelle": None,
    "ort": {"spielort_id": None},
    "schiedsrichter": {"schiedsrichter_id": None},
}

# The OTHER shape the same draw writes, and the one an admin seeds by hand: a knockout slot wired to
# a placing and holding nobody.
UNTOUCHED_BRACKET: Mapping[str, Any] = {
    **UNTOUCHED_FIXTURE,
    "saison_phase": BRACKET_PHASE,
    "team1": None,
    "team2": None,
    "team1_quelle": {"type": "gruppe", "gruppe": "A", "platz": 1},
    "team2_quelle": {"type": "gruppe", "gruppe": "B", "platz": 2},
}


def value_at(spiel: Mapping[str, Any], projected: str) -> Any:
    """What one projected path resolves to, read the way the predicate itself reads it.

    `or {}` rather than a `None` test: the projection delivers a null head where the stored field is
    null, and a leaf under one is then absent rather than false.
    """

    head, _, leaf = projected.partition(".")
    value = spiel.get(head)

    return (value or {}).get(leaf) if leaf else value


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
        why="wiring `REQ-WIRING-001` refuses on a group fixture, and a bracket slot whose wiring an admin cleared",
        gruppe={"team1_quelle": {"type": "gruppe", "gruppe": "A", "platz": 1}},
        ko={"team1_quelle": None},
    ),
    "team2_quelle": RecordedEdit(
        why="the same on the other side",
        gruppe={"team2_quelle": {"type": "gruppe", "gruppe": "B", "platz": 2}},
        ko={"team2_quelle": None},
    ),
    "ergebnis": RecordedEdit(why="a result", gruppe={"ergebnis": "2:1"}),
    # Beside a result rather than behind it: `apply_payload_to_spiel` keeps a shoot-out only where it
    # stores a result too, so one standing alone came by the hand edit route the goals above did.
    "elfmeterschiessen": RecordedEdit(why="a shoot-out standing without a result", gruppe={"elfmeterschiessen": {"team1": 4, "team2": 3}}),
    # The value awarding NOTHING on purpose: `has_taken_place` reads it as untouched, so reaching for
    # that narrower question instead of this window is the mistake this entry is here to fail.
    "sonderereignis": RecordedEdit(why="a cancellation, which awards nothing and is still a record", gruppe={"sonderereignis": "ausgefallen"}),
    "ort.spielort_id": RecordedEdit(why="a booked venue", gruppe={"ort": {"spielort_id": SPIELORT}}),
    "schiedsrichter.schiedsrichter_id": RecordedEdit(why="a booked referee", gruppe={"schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER}}),
    "notiz": RecordedEdit(why="an admin's note, which only `PATCH /spiele/{spiel_id}` writes", gruppe={"notiz": "Platz gesperrt"}),
}

# The projected paths the two drawn shapes disagree about -- the sides half, which
# `app/api/saisons/services.py :: _a_side_is_off_the_draw` reads. Derived, so a field that becomes
# inverted is asked for both directions with nobody listing it.
INVERTED_BY_THE_DRAW: frozenset[str] = frozenset(
    path for path in RECORDED_FACT_FIELDS if value_at(UNTOUCHED_FIXTURE, path) != value_at(UNTOUCHED_BRACKET, path)
)


class TestWhatCountsAsRecordedAgainstAFixture:
    """`holds_a_recorded_fact`, which is what the endpoint counts for `REQ-SPIELPLAN-005`.

    The refusal reads a COUNT, so no test of it reaches this: the window closes on a cancellation
    and on a booking as well as on a result.
    """

    def test_the_projection_the_map_and_the_two_drawn_shapes_are_read_before_anything_below(self):
        """The floor: a derivation that quietly finds nothing makes every case under it vacuous.

        The tuple is IMPORTED rather than parsed, so what stands in for "did the parse work" is
        every derivation here being non-empty and the two fixtures genuine inverses.
        """

        assert RECORDED_FACT_FIELDS
        assert RECORDED_EDITS
        assert INVERTED_BY_THE_DRAW
        assert BRACKET_PHASE != DRAWN_HOLDING_ITS_SIDES

        # A PROPER subset, so the breadth below is asked of values `has_taken_place` answers for
        # and of the ones it does not; equality would make the two questions one.
        assert set(SONDEREREIGNIS_WITHOUT_A_RESULT) < set(get_args(FLSonderereignis.__value__))

        for slot in ("team1", "team2"):
            assert UNTOUCHED_FIXTURE[slot] is not None and UNTOUCHED_FIXTURE[f"{slot}_quelle"] is None, "the group fixture is not as drawn"
            assert UNTOUCHED_BRACKET[slot] is None and UNTOUCHED_BRACKET[f"{slot}_quelle"] is not None, "the bracket fixture is not as drawn"

    def test_a_fixture_the_draw_left_alone_does_not(self):
        """The floor: a predicate answering True for everything would pass every case below."""

        assert holds_a_recorded_fact(UNTOUCHED_FIXTURE) is False

    def test_a_bracket_slot_the_draw_left_alone_does_not_either(self):
        """The second floor, and the one that matters: read a WIRED empty slot as touched and no drawn season is ever replaceable."""

        assert holds_a_recorded_fact(UNTOUCHED_BRACKET) is False

    def test_every_projected_field_is_answered_by_an_edit_and_nothing_else_is(self):
        """THE COUPLING: add a field to `RECORDED_FACT_FIELDS` and this fails naming it.

        Projected and never read is the defect it is against -- the field reaches the predicate,
        changes no answer, and every other test stays green.
        """

        unanswered = sorted(set(RECORDED_FACT_FIELDS) - set(RECORDED_EDITS))
        stale = sorted(set(RECORDED_EDITS) - set(RECORDED_FACT_FIELDS))

        assert (unanswered, stale) == ([], [])

    def test_the_bracket_direction_is_declared_for_every_field_the_draw_inverts(self):
        """Declare a group edit alone for one of these and the rule is pinned in one direction only.

        A group fixture is drawn occupied and unwired and a bracket fixture wired and empty, so each
        of these records by moving the OPPOSITE way on the two shapes.
        """

        assert {path for path, edit in RECORDED_EDITS.items() if edit.ko is not None} == INVERTED_BY_THE_DRAW

    @pytest.mark.parametrize(("projected", "edit"), RECORDED_EDITS.items(), ids=list(RECORDED_EDITS))
    def test_an_edit_departs_from_the_draw_in_its_own_field_and_no_other(self, projected: str, edit: RecordedEdit):
        """An entry closing the window through a NEIGHBOUR proves nothing about the field it is filed under.

        `team1.tore` without its side's id is the case: the fixture then reads as recorded for an
        emptied side, so dropping the goal counts leaves it green.
        """

        for drawn, change in ((UNTOUCHED_FIXTURE, edit.gruppe), (UNTOUCHED_BRACKET, edit.ko)):
            if change is None:
                continue

            edited = {**drawn, **change}
            assert set(change) == {projected.partition(".")[0]}, f"{projected}'s edit does not write its own field"
            assert value_at(edited, projected) != value_at(drawn, projected), f"{projected}'s edit leaves what the draw wrote there"

            moved = [other for other in RECORDED_FACT_FIELDS if other != projected and value_at(edited, other) != value_at(drawn, other)]
            assert moved == [], f"{projected}'s edit also moves {moved}"

    @pytest.mark.parametrize(("projected", "edit"), RECORDED_EDITS.items(), ids=list(RECORDED_EDITS))
    def test_a_fixture_carrying_that_edit_closes_the_window(self, projected: str, edit: RecordedEdit):
        """Stop reading any one of these and a replace deletes the work it records, the endpoint answering 200."""

        assert holds_a_recorded_fact({**UNTOUCHED_FIXTURE, **edit.gruppe}) is True, f"{projected} left the group window open: {edit.why}"

        if edit.ko is not None:
            assert holds_a_recorded_fact({**UNTOUCHED_BRACKET, **edit.ko}) is True, f"{projected} left the bracket window open: {edit.why}"

    @pytest.mark.parametrize("sonderereignis", get_args(FLSonderereignis.__value__))
    def test_every_sonderereignis_closes_the_window_whatever_it_awards(self, sonderereignis: str):
        """Reach for `has_taken_place`'s narrower set and the two awarding nothing stop closing it.

        The map above weighs the field once; this asks it of every value the enum offers, so one
        added later is judged rather than assumed.
        """

        assert holds_a_recorded_fact({**UNTOUCHED_FIXTURE, "sonderereignis": sonderereignis}) is True

    @pytest.mark.parametrize(
        ("empty", "why"),
        [
            ({"notiz": None}, "how CLEARING a note is stored: the patch `$set`s the whole model"),
            ({"notiz": ""}, "unreachable through the API, and `spiele`'s validator takes it from a hand edit"),
            ({"notiz": "   "}, "whitespace, which `empty_strings_to_none` catches on the API route alone"),
        ],
    )
    def test_a_note_that_says_nothing_leaves_the_window_open(self, empty: Mapping[str, Any], why: str):
        """Compare `notiz` to None rather than stripping it and the last two close a window nothing was entered in."""

        assert holds_a_recorded_fact({**UNTOUCHED_FIXTURE, **empty}) is False, why

    def test_a_date_and_a_kickoff_time_leave_the_window_open(self):
        """Rescheduling is what a replace is FOR, so a dated fixture stays replaceable and the log keeps the dates."""

        assert holds_a_recorded_fact({**UNTOUCHED_FIXTURE, "datum": "2026-05-01", "uhrzeit": "18:00:00"}) is False


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

    def test_swapping_one_group_occupant_for_another_is_NOT_seen(self):
        """The rule's limit, stated so it is not mistaken for a gap nobody noticed.

        The draw seats both sides of every group fixture, so "holds a side" is true of all of them
        and no stored field tells the draw's occupant from a replacement.
        """

        swapped = {**UNTOUCHED_FIXTURE, "team1": {"team_id": "68f0a1b2c3d4e5f607600013", "tore": None}}

        assert holds_a_recorded_fact(swapped) is False

    def test_a_fixture_reaching_the_predicate_without_a_phase_is_recorded(self):
        """Drop `saison_phase` from the projection and every window shuts rather than opening on a season somebody drew by hand."""

        no_phase = {key: value for key, value in UNTOUCHED_FIXTURE.items() if key != "saison_phase"}

        assert holds_a_recorded_fact(no_phase) is True


def shared(code: Code) -> WriteRefusal:
    """A refusal as the season's own write answers it, which the draw then re-codes."""

    return WriteRefusal(error_code=code, status=HTTPStatus.UNPROCESSABLE_CONTENT)


def on_the_draw(code: Code) -> tuple[Code, HTTPStatus] | None:
    answered = as_the_draw_answers(shared(code))

    return None if answered is None else (answered.error_code, answered.status)


class TestTheDrawAnswersStoredValuesUnderItsTwins:
    """A rule a stated shape breaks against a STORED value is a conflict with the season, so it answers 409 under a code of its own."""

    def test_the_forfeit_and_the_span_answer_under_their_twins(self):
        """The shape's qualifiers can give the season a bracket its stored level forfeit cannot decide, and its matchdays can outgrow the stored span."""

        assert on_the_draw(Code.RULES_FORFEIT_DRAWS_A_KNOCKOUT) == (Code.RULES_FORFEIT_DRAWS_A_KNOCKOUT_AS_STORED, HTTPStatus.CONFLICT)
        assert on_the_draw(Code.SAISON_SPAN_BELOW_SCHEDULE) == (Code.SAISON_SPAN_BELOW_SCHEDULE_AS_STORED, HTTPStatus.CONFLICT)

    def test_a_rule_reading_the_shape_alone_keeps_the_shared_code(self):
        """The payload's own three numbers are all such a rule reads, so it is the payload the draw refuses."""

        assert on_the_draw(Code.RULES_BRACKET_IMPOSSIBLE) == (Code.RULES_BRACKET_IMPOSSIBLE, HTTPStatus.UNPROCESSABLE_CONTENT)
        assert as_the_draw_answers(None) is None
