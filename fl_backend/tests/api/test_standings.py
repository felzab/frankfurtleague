"""
The group standing: the tiebreak chain, who may hold a placing, and when a placing becomes final.

`build_gruppen` and `build_decided_standings` are pure, so every case here runs in the default tier with
no container — including the ones that matter most, which are about results that have NOT happened yet
and could not be staged in a database at all (ADR-0043).

The last case takes the standing back into `resolve_bracket`, because the two halves are only worth
anything joined: a placing nobody seeds is a number, and a slot seeded from an undecided placing is the
confidently-wrong public page this design exists to prevent.

Ids are a fixed prefix plus the team or match number, so a failing case names what it came from. Both
prefixes are 20 hex characters and the suffix is decimal, so every result is a valid 24-character
ObjectId.
"""

from typing import Any, Callable

import pytest

from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import FLSpielListAdapter
from app.api.spiele.services import resolve_bracket
from app.api.teams.schemas import FLTeam
from app.api.teams.services import build_decided_standings, build_gruppen

TEAM_ID = "6890a1b2c3d4e5f60719{:04d}"
MATCH_ID = "6890a1b2c3d4e5f60718{:04d}"

RULES = FLSaisonRules(win_points=3, draw_points=1, qualifiers_per_group=2)

PayloadFactory = Callable[..., dict[str, Any]]
TeamFactory = Callable[..., FLTeam]
MatchFactory = Callable[..., dict[str, Any]]


@pytest.fixture
def a_team(team: PayloadFactory, statistik: PayloadFactory) -> TeamFactory:
    """
    One club in group A, with its derived table stated directly.

    The figures are set rather than computed from the matches below, exactly as production does it: the
    seven numbers come from the aggregation (ADR-0026) and the standing consumes them. A case may
    therefore state a table that its match list does not add up to, which is the point — the head-to-head
    criterion is the only one that reads the matches, so every other case can leave them out.
    """

    def make(seed: int, *, punkte: int = 0, geschossen: int = 0, kassiert: int = 0, gespielt: int = 3, **overrides: Any) -> FLTeam:
        figures = statistik(punkte=punkte, tore_geschossen=geschossen, tore_kassiert=kassiert, anzahl_gespielte_spiele=gespielt)

        return FLTeam.model_validate(team(_id=TEAM_ID.format(seed), name=f"Team {seed}", shorthand=f"T{seed}", statistik=figures, **overrides))

    return make


@pytest.fixture
def played(spiel: PayloadFactory, spiel_team_field: PayloadFactory) -> MatchFactory:
    """One group-phase match between two teams, played unless `tore1` is None."""

    def make(nr: int, home: int, away: int, tore1: int | None = None, tore2: int | None = None, **overrides: Any) -> dict[str, Any]:
        def side(seed: int, tore: int | None) -> dict[str, Any]:
            return spiel_team_field(team_id=TEAM_ID.format(seed), name=f"Team {seed}", shorthand=f"T{seed}", tore=tore)

        return spiel(
            _id=MATCH_ID.format(nr),
            spiel_nr=nr,
            saison_phase="gruppenphase",
            team1=side(home, tore1),
            team2=side(away, tore2),
            ergebnis=None if tore1 is None or tore2 is None else f"{tore1}:{tore2}",
            **overrides,
        )

    return make


def order(teams: list[FLTeam], documents: list[dict[str, Any]]) -> list[str]:
    """Group A's standing, as a list of names."""

    gruppen = build_gruppen(teams, FLSpielListAdapter.validate_python(documents), RULES)

    return [team.name for team in gruppen.root["A"]]


def standing(teams: list[FLTeam], documents: list[dict[str, Any]]):
    """Group A's decided placings."""

    return build_decided_standings(teams, FLSpielListAdapter.validate_python(documents), RULES)["A"]


class TestTheChain:
    """Points, goal difference, goals scored, then the head-to-head table (ADR-0043)."""

    def test_ranks_on_points_first(self, a_team: TeamFactory):
        """The first criterion, and the one every other is subordinate to."""

        teams = [a_team(1, punkte=3), a_team(2, punkte=9), a_team(3, punkte=6)]

        assert order(teams, []) == ["Team 2", "Team 3", "Team 1"]

    def test_breaks_a_points_tie_on_goal_difference(self, a_team: TeamFactory):
        """Level on points, and one has the better difference — the second criterion."""

        teams = [a_team(1, punkte=6, geschossen=4, kassiert=3), a_team(2, punkte=6, geschossen=9, kassiert=2)]

        assert order(teams, []) == ["Team 2", "Team 1"]

    def test_breaks_an_equal_difference_on_goals_scored(self, a_team: TeamFactory):
        """
        Same points and the same difference, so the third criterion decides.

        This is the criterion the old two-key sort was missing, and it is what stopped "who is second"
        being a question the data could answer.
        """

        teams = [a_team(1, punkte=6, geschossen=2, kassiert=1), a_team(2, punkte=6, geschossen=7, kassiert=6)]

        assert order(teams, []) == ["Team 2", "Team 1"]

    def test_breaks_everything_else_on_the_head_to_head(self, a_team: TeamFactory, played: MatchFactory):
        """
        Identical on all three overall criteria, so their own match decides it — the last criterion.

        This is the one that needs the season's matches, which is why the standing cannot be built from a
        list of teams alone.
        """

        teams = [a_team(1, punkte=6, geschossen=5, kassiert=5), a_team(2, punkte=6, geschossen=5, kassiert=5)]

        assert order(teams, [played(1, 1, 2, 0, 2)]) == ["Team 2", "Team 1"]

    def test_uses_the_mini_table_when_three_teams_are_level(self, a_team: TeamFactory, played: MatchFactory):
        """
        Three teams tied, so the head-to-head is a TABLE rather than a pairwise comparison.

        Team 1 beat Team 2, Team 2 beat Team 3, Team 3 beat Team 1 — a cycle, so "who beat whom" answers
        nothing. The mini-table separates them on the goals in those three matches, which is what every
        competition actually does and what a pairwise rule cannot do at all.
        """

        teams = [
            a_team(1, punkte=6, geschossen=9, kassiert=9),
            a_team(2, punkte=6, geschossen=9, kassiert=9),
            a_team(3, punkte=6, geschossen=9, kassiert=9),
        ]
        matches = [played(1, 1, 2, 1, 0), played(2, 2, 3, 3, 0), played(3, 3, 1, 1, 0)]

        # Each won one and lost one, so the mini-table is decided on its goal difference: Team 2 is +2,
        # Team 3 is -2, Team 1 is level.
        assert order(teams, matches) == ["Team 2", "Team 1", "Team 3"]

    def test_an_unbreakable_tie_keeps_the_order_it_arrived_in(self, a_team: TeamFactory, played: MatchFactory):
        """
        Level on every criterion including their own match, so the chain stops.

        Neither is ranked above the other.

        The input order is the pipeline's sort by `name`, so the table renders alphabetically rather than
        arbitrarily — and the placings this produces are reported as decided by nobody.
        """

        teams = [a_team(1, punkte=6, geschossen=5, kassiert=5), a_team(2, punkte=6, geschossen=5, kassiert=5)]
        drawn = [played(1, 1, 2, 1, 1)]

        assert order(teams, drawn) == ["Team 1", "Team 2"]
        assert standing(teams, drawn).by_platz == {}


class TestWhoMayHoldAPlatz:
    """A placing is walked past a team that cannot advance out of it, and the next team takes it."""

    def test_a_disqualified_team_keeps_its_row_in_the_table(self, a_team: TeamFactory):
        """The standing is unchanged: disqualification is about advancing, not about the table."""

        teams = [a_team(1, punkte=9, is_disqualified=True), a_team(2, punkte=6)]

        assert order(teams, []) == ["Team 1", "Team 2"]

    def test_the_placings_walk_past_a_disqualified_team(self, a_team: TeamFactory):
        """
        Top of the table and out of the competition, so the team below is what `platz: 1` names.

        The table and the bracket have to agree here or the public page marks one team as qualifying and
        the bracket seeds another.
        """

        teams = [a_team(1, punkte=9, is_disqualified=True), a_team(2, punkte=6), a_team(3, punkte=3)]
        decided = standing(teams, [])

        assert decided.eligible == 2
        assert [team.name for team in decided.by_platz.values()] == ["Team 2", "Team 3"]

    def test_a_team_with_nothing_played_and_nothing_left_holds_no_placing(self, a_team: TeamFactory):
        """
        Zeroes are not a placing.

        A team with no counting match is served a zeroed `statistik`, which ranks it above every team with
        a negative difference — and `SaisontabelleView` prints `N/A` for that row rather than a position,
        so the bracket must not read one either.
        """

        teams = [a_team(1, punkte=0, gespielt=0), a_team(2, punkte=3, geschossen=1, kassiert=4)]
        decided = standing(teams, [])

        assert decided.eligible == 1
        assert decided.by_platz[1].name == "Team 2"

    def test_a_team_whose_first_match_is_still_to_come_does_hold_one(self, a_team: TeamFactory, played: MatchFactory):
        """
        The same rule read while the group is running: it will have a counting match, so it counts.

        One predicate, two states — which is what stops the table's marker and the bracket's seeding
        drifting into two different definitions of who is in the running.
        """

        teams = [a_team(1, punkte=0, gespielt=0), a_team(2, punkte=3, gespielt=1)]

        assert standing(teams, [played(1, 1, 2)]).eligible == 2


class TestWhenAPlacingIsFinal:
    """A placing is seeded only when no way the group can still go would change it."""

    def test_a_finished_group_decides_every_placing(self, a_team: TeamFactory, played: MatchFactory):
        """Nothing left to play, so the table as it stands is the final one."""

        teams = [a_team(1, punkte=9), a_team(2, punkte=6), a_team(3, punkte=3)]
        decided = standing(teams, [played(1, 1, 2, 2, 0)])

        assert decided.is_complete
        assert [decided.by_platz[platz].name for platz in (1, 2, 3)] == ["Team 1", "Team 2", "Team 3"]

    def test_a_placing_a_remaining_match_could_change_is_not_decided(self, a_team: TeamFactory, played: MatchFactory):
        """
        Three points apart with a match still to play, so second place is still anybody's.

        The table would show an order — this is exactly the moment a naive implementation seeds from it,
        and the public bracket is then confidently wrong until the last match is played.
        """

        teams = [a_team(1, punkte=9), a_team(2, punkte=3), a_team(3, punkte=3)]
        decided = standing(teams, [played(9, 2, 3)])

        assert not decided.is_complete
        assert 2 not in decided.by_platz and 3 not in decided.by_platz

    def test_a_placing_no_remaining_match_can_reach_is_decided_early(self, a_team: TeamFactory, played: MatchFactory):
        """
        The point of enumerating rather than waiting: first place is already won.

        Team 1 has nine points and the match still to play is between two teams on three, so the best
        either can finish on is six. No outcome puts anyone above Team 1, and the slot can be seeded a
        matchday early.
        """

        teams = [a_team(1, punkte=9), a_team(2, punkte=3), a_team(3, punkte=3)]
        decided = standing(teams, [played(9, 2, 3)])

        assert decided.by_platz[1].name == "Team 1"

    def test_a_lead_a_remaining_match_could_erase_is_not_decided(self, a_team: TeamFactory, played: MatchFactory):
        """The mirror of the case above: three points clear with a win still available underneath."""

        teams = [a_team(1, punkte=6), a_team(2, punkte=3), a_team(3, punkte=3)]

        assert standing(teams, [played(9, 2, 3)]).by_platz == {}

    def test_a_lead_only_a_goal_margin_could_erase_is_not_decided(self, a_team: TeamFactory, played: MatchFactory):
        """
        Level on points is not a settled order while anybody can still score.

        Team 2 can finish level with Team 1 on points, and nothing bounds by how much it could win — so
        the goal difference that separates them today is not something to seed a bracket from.
        """

        teams = [a_team(1, punkte=6, geschossen=20, kassiert=0), a_team(2, punkte=3, geschossen=0, kassiert=1), a_team(3, punkte=0)]

        assert standing(teams, [played(9, 2, 3)]).by_platz == {}

    def test_a_cancelled_match_with_no_result_is_never_coming(self, a_team: TeamFactory, played: MatchFactory):
        """
        A called-off fixture with nothing recorded awards nobody anything, so it does not hold the group open.

        The counterpart is `test_bracket.py`'s forfeit case: cancelled WITH a result counts in full
        (ADR-0026), and that one is already in the figures the pipeline hands over.
        """

        teams = [a_team(1, punkte=9), a_team(2, punkte=6)]
        decided = standing(teams, [played(9, 1, 2, is_canceled=True)])

        assert decided.is_complete
        assert decided.by_platz[1].name == "Team 1"


class TestSeedingTheSlot:
    """The standing carried back into the bracket, which is the only place either half pays off."""

    def seeded(self, decided, quelle: dict[str, Any], spiel: PayloadFactory, stored: dict[str, Any] | None = None):
        """One playoff fixture whose first side is fed by `quelle`, resolved against `decided`."""

        fixture = spiel(_id=MATCH_ID.format(25), spiel_nr=25, saison_phase="viertelfinale", team1=stored, team2=None, team1_quelle=quelle)

        return resolve_bracket(FLSpielListAdapter.validate_python([fixture]), {"A": decided})

    def test_a_decided_placing_fills_the_slot(self, a_team: TeamFactory, spiel: PayloadFactory):
        """The whole item, in one assertion: the group winner arrives in the quarter-final by itself."""

        decided = standing([a_team(1, punkte=9), a_team(2, punkte=6)], [])
        resolution = self.seeded(decided, {"type": "gruppe", "gruppe": "A", "platz": 1}, spiel)

        assert resolution.advancements[0].team1 is not None
        assert resolution.advancements[0].team1.name == "Team 1"
        # Arriving in a fixture it has not played, exactly as a match-fed winner does.
        assert resolution.advancements[0].team1.tore is None
        assert resolution.unresolvable_slots == []

    def test_an_undecided_placing_empties_the_slot_and_reports_nothing(self, a_team: TeamFactory, played: MatchFactory, spiel: PayloadFactory):
        """
        Not decided yet is a real answer — the slot is empty — and it is not a problem anybody is told about.

        A slot seeded from an earlier state of the table gives that team back the moment a result stops
        supporting it, which is the same rule a corrected match result follows (ADR-0042).
        """

        teams = [a_team(1, punkte=3), a_team(2, punkte=3)]
        decided = standing(teams, [played(9, 1, 2)])
        stored = {"team_id": TEAM_ID.format(1), "name": "Team 1", "shorthand": "T1", "tore": None}

        resolution = self.seeded(decided, {"type": "gruppe", "gruppe": "A", "platz": 1}, spiel, stored=stored)

        assert resolution.advancements[0].team1 is None
        assert resolution.unresolvable_slots == []

    def test_a_platz_the_group_will_never_produce_is_reported_and_the_slot_left_alone(self, a_team: TeamFactory, spiel: PayloadFactory):
        """
        A typo, not an outcome, so the stored side survives.

        The same reasoning as a `spiel_nr` naming no match: erasing a team over a number nobody can
        resolve destroys more than it reports.
        """

        decided = standing([a_team(1, punkte=9), a_team(2, punkte=6)], [])
        stored = {"team_id": TEAM_ID.format(1), "name": "Team 1", "shorthand": "T1", "tore": None}

        resolution = self.seeded(decided, {"type": "gruppe", "gruppe": "A", "platz": 5}, spiel, stored=stored)

        assert resolution.advancements == []
        assert [(slot.spiel_nr, slot.platz, slot.reason) for slot in resolution.unresolvable_slots] == [(25, 5, "gruppe_too_small")]

    def test_a_tie_the_chain_cannot_break_is_reported_once_the_group_is_played_out(
        self, a_team: TeamFactory, played: MatchFactory, spiel: PayloadFactory
    ):
        """
        The other case a person has to settle: finished, level, and no criterion left to try.

        Reported AND emptied, unlike the typo above — naming either team would be a guess, and the route
        past it is to clear the `quelle` and enter a side by hand.
        """

        teams = [a_team(1, punkte=6, geschossen=5, kassiert=5), a_team(2, punkte=6, geschossen=5, kassiert=5)]
        decided = standing(teams, [played(1, 1, 2, 1, 1)])
        stored = {"team_id": TEAM_ID.format(1), "name": "Team 1", "shorthand": "T1", "tore": None}

        resolution = self.seeded(decided, {"type": "gruppe", "gruppe": "A", "platz": 1}, spiel, stored=stored)

        assert resolution.advancements[0].team1 is None
        assert [(slot.platz, slot.reason) for slot in resolution.unresolvable_slots] == [(1, "tie_unresolved")]

    def test_a_second_pass_over_a_seeded_bracket_writes_nothing(self, a_team: TeamFactory, spiel: PayloadFactory):
        """Idempotence across the group-seeded half too: the team is already there, so nothing moves."""

        decided = standing([a_team(1, punkte=9), a_team(2, punkte=6)], [])
        stored = {"team_id": TEAM_ID.format(1), "name": "Team 1", "shorthand": "T1", "tore": None}

        resolution = self.seeded(decided, {"type": "gruppe", "gruppe": "A", "platz": 1}, spiel, stored=stored)

        assert resolution.advancements == []
