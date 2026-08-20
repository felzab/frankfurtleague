from typing import Any, Callable

import pytest

from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import FLBracketFaultGruppe, FLSpielListAdapter
from app.api.spiele.services import BracketResolution, resolve_bracket
from app.api.spieler.schemas import FLSpielerStufe
from app.api.teams.schemas import FLTeam
from app.api.teams.services import CERTAINTY_FIXTURE_LIMIT, build_decided_standings, build_gruppen

TEAM_ID = "6890a1b2c3d4e5f60719{:04d}"
MATCH_ID = "6890a1b2c3d4e5f60718{:04d}"

# Typed as the `Literal` list `FLSaisonRules` declares: a bare `list[str]` is invariant against it.
STUFEN: list[FLSpielerStufe] = ["E1", "Q1", "Q2", "Q3", "Q4"]

RULES = FLSaisonRules(win_points=3, draw_points=1, qualifiers_per_group=2, number_of_groups=4, teams_per_group=4, erlaubte_stufen=STUFEN)

# The walk keys on the field being non-null, never on what it says, so one value serves every case.
DISQUALIFIZIERT = {"grund": "Nicht angetreten zum Spieltag", "datum": "2026-03-14"}

PayloadFactory = Callable[..., dict[str, Any]]
TeamFactory = Callable[..., FLTeam]
MatchFactory = Callable[..., dict[str, Any]]


@pytest.fixture
def a_team(team: PayloadFactory, statistik: PayloadFactory) -> TeamFactory:
    """Figures are set, not computed, so a case may state a table its match list does not add up to; only head-to-head reads matches."""

    def make(seed: int, *, punkte: int = 0, geschossen: int = 0, kassiert: int = 0, gespielt: int = 3, **overrides: Any) -> FLTeam:
        figures = statistik(punkte=punkte, tore_geschossen=geschossen, tore_kassiert=kassiert, anzahl_gespielte_spiele=gespielt)

        return FLTeam.model_validate(team(_id=TEAM_ID.format(seed), name=f"Team {seed}", shorthand=f"T{seed}", statistik=figures, **overrides))

    return make


@pytest.fixture
def played(spiel: PayloadFactory, spiel_team_field: PayloadFactory) -> MatchFactory:
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
    """Points, goal difference, goals scored, then the head-to-head table."""

    def test_ranks_on_points_first(self, a_team: TeamFactory):
        teams = [a_team(1, punkte=3), a_team(2, punkte=9), a_team(3, punkte=6)]

        assert order(teams, []) == ["Team 2", "Team 3", "Team 1"]

    def test_breaks_a_points_tie_on_goal_difference(self, a_team: TeamFactory):
        teams = [a_team(1, punkte=6, geschossen=4, kassiert=3), a_team(2, punkte=6, geschossen=9, kassiert=2)]

        assert order(teams, []) == ["Team 2", "Team 1"]

    def test_breaks_an_equal_difference_on_goals_scored(self, a_team: TeamFactory):
        """A two-key sort misses this criterion and leaves second place unanswerable."""

        teams = [a_team(1, punkte=6, geschossen=2, kassiert=1), a_team(2, punkte=6, geschossen=7, kassiert=6)]

        assert order(teams, []) == ["Team 2", "Team 1"]

    def test_breaks_everything_else_on_the_head_to_head(self, a_team: TeamFactory, played: MatchFactory):
        """The criterion that needs the season's matches, so the standing cannot be built from teams alone."""

        teams = [a_team(1, punkte=6, geschossen=5, kassiert=5), a_team(2, punkte=6, geschossen=5, kassiert=5)]

        assert order(teams, [played(1, 1, 2, 0, 2)]) == ["Team 2", "Team 1"]

    def test_uses_the_mini_table_when_three_teams_are_level(self, a_team: TeamFactory, played: MatchFactory):
        """The results cycle, so who beat whom answers nothing and only a mini-table separates them."""

        teams = [
            a_team(1, punkte=6, geschossen=9, kassiert=9),
            a_team(2, punkte=6, geschossen=9, kassiert=9),
            a_team(3, punkte=6, geschossen=9, kassiert=9),
        ]
        matches = [played(1, 1, 2, 1, 0), played(2, 2, 3, 3, 0), played(3, 3, 1, 1, 0)]

        # Each won one and lost one, so the mini-table decides on goal difference: +2, level, -2.
        assert order(teams, matches) == ["Team 2", "Team 1", "Team 3"]

    def test_an_unbreakable_tie_keeps_the_order_it_arrived_in(self, a_team: TeamFactory, played: MatchFactory):
        """The input order is the pipeline's sort by `name`, so an unbroken tie renders alphabetically rather than arbitrarily."""

        teams = [a_team(1, punkte=6, geschossen=5, kassiert=5), a_team(2, punkte=6, geschossen=5, kassiert=5)]
        drawn = [played(1, 1, 2, 1, 1)]

        assert order(teams, drawn) == ["Team 1", "Team 2"]
        assert standing(teams, drawn).by_platz == {}


class TestWhoMayHoldAPlatz:
    """A placing is walked past a team that cannot advance out of it, and the next team takes it."""

    def test_a_disqualified_team_keeps_its_row_in_the_table(self, a_team: TeamFactory):
        """Disqualification is about advancing, not about the table."""

        teams = [a_team(1, punkte=9, disqualifikation=DISQUALIFIZIERT), a_team(2, punkte=6)]

        assert order(teams, []) == ["Team 1", "Team 2"]

    def test_the_placings_walk_past_a_disqualified_team(self, a_team: TeamFactory):
        """The table and the bracket must agree, or the public page and the bracket name different qualifiers."""

        teams = [a_team(1, punkte=9, disqualifikation=DISQUALIFIZIERT), a_team(2, punkte=6), a_team(3, punkte=3)]
        decided = standing(teams, [])

        assert decided.eligible == 2
        assert [team.name for team in decided.by_platz.values()] == ["Team 2", "Team 3"]

    def test_a_team_with_nothing_played_and_nothing_left_holds_no_placing(self, a_team: TeamFactory):
        """A zeroed `statistik` ranks above every negative difference, so zeroes would take a placing nothing earned."""

        teams = [a_team(1, punkte=0, gespielt=0), a_team(2, punkte=3, geschossen=1, kassiert=4)]
        decided = standing(teams, [])

        assert decided.eligible == 1
        assert decided.by_platz[1].name == "Team 2"

    def test_a_team_whose_first_match_is_still_to_come_does_hold_one(self, a_team: TeamFactory, played: MatchFactory):
        """It will have a counting match, so one predicate serves both the marker and the seeding."""

        teams = [a_team(1, punkte=0, gespielt=0), a_team(2, punkte=3, gespielt=1)]

        assert standing(teams, [played(1, 1, 2)]).eligible == 2


class TestWhenAPlacingIsFinal:
    """A placing is seeded only when no way the group can still go would change it."""

    def test_a_finished_group_decides_every_placing(self, a_team: TeamFactory, played: MatchFactory):
        teams = [a_team(1, punkte=9), a_team(2, punkte=6), a_team(3, punkte=3)]
        decided = standing(teams, [played(1, 1, 2, 2, 0)])

        assert decided.is_complete
        assert [decided.by_platz[platz].name for platz in (1, 2, 3)] == ["Team 1", "Team 2", "Team 3"]

    def test_a_placing_a_remaining_match_could_change_is_not_decided(self, a_team: TeamFactory, played: MatchFactory):
        """The table shows an order, and seeding from it here leaves the public bracket confidently wrong."""

        teams = [a_team(1, punkte=9), a_team(2, punkte=3), a_team(3, punkte=3)]
        decided = standing(teams, [played(9, 2, 3)])

        assert not decided.is_complete
        assert 2 not in decided.by_platz and 3 not in decided.by_platz

    def test_a_placing_no_remaining_match_can_reach_is_decided_early(self, a_team: TeamFactory, played: MatchFactory):
        """Out of reach of both chasers, so the slot seeds early."""

        teams = [a_team(1, punkte=9), a_team(2, punkte=3), a_team(3, punkte=3)]
        decided = standing(teams, [played(9, 2, 3)])

        assert decided.by_platz[1].name == "Team 1"

    def test_a_lead_a_remaining_match_could_erase_is_not_decided(self, a_team: TeamFactory, played: MatchFactory):
        teams = [a_team(1, punkte=6), a_team(2, punkte=3), a_team(3, punkte=3)]

        assert standing(teams, [played(9, 2, 3)]).by_platz == {}

    def test_a_lead_only_a_goal_margin_could_erase_is_not_decided(self, a_team: TeamFactory, played: MatchFactory):
        """Nothing bounds how much Team 2 could win by, so today's goal difference cannot seed a bracket."""

        teams = [a_team(1, punkte=6, geschossen=20, kassiert=0), a_team(2, punkte=3, geschossen=0, kassiert=1), a_team(3, punkte=0)]

        assert standing(teams, [played(9, 2, 3)]).by_platz == {}

    def test_a_cancelled_match_with_no_result_is_never_coming(self, a_team: TeamFactory, played: MatchFactory):
        """Nothing recorded awards nobody, so it does not hold the group open; a forfeit is `test_bracket.py`'s."""

        teams = [a_team(1, punkte=9), a_team(2, punkte=6)]
        decided = standing(teams, [played(9, 1, 2, is_canceled=True)])

        assert decided.is_complete
        assert decided.by_platz[1].name == "Team 1"

    def test_a_pending_fixture_with_no_sides_blocks_every_group(self, a_team: TeamFactory, spiel: PayloadFactory, played: MatchFactory):
        """It will award points inside some group and nothing can say which. Reachable only by hand: fixtures are created with their teams."""

        teams = [a_team(1, punkte=9), a_team(2, punkte=6)]
        unentered = spiel(_id=MATCH_ID.format(9), spiel_nr=9, saison_phase="gruppenphase", team1=None, team2=None, ergebnis=None)

        assert standing(teams, [played(1, 1, 2, 2, 0), unentered]).by_platz == {}

    def test_the_walk_at_the_cap_stays_inside_its_budget(self, a_team: TeamFactory, played: MatchFactory):
        """First place must survive every outcome; the constant is pinned rather than timed, since raising it triples the walk per fixture."""

        teams = [a_team(1, punkte=15, gespielt=5), *(a_team(seed, punkte=0, gespielt=1) for seed in range(2, 7))]
        pairs = [(home, away) for index, home in enumerate(range(2, 7)) for away in range(2, 7)[index + 1 :]]
        open_fixtures = [played(number + 1, home, away) for number, (home, away) in enumerate(pairs)]

        assert CERTAINTY_FIXTURE_LIMIT == 10
        assert len(open_fixtures) == CERTAINTY_FIXTURE_LIMIT

        assert standing(teams, open_fixtures).by_platz[1].name == "Team 1"


def gruppe_faults(resolution: BracketResolution) -> list[tuple[int, str, int, str]]:
    """The `isinstance` is an assertion, not a type-checker concession: only a group reference carries a `gruppe` and a `platz`."""

    faults = []
    for fault in resolution.bracket_faults:
        assert isinstance(fault, FLBracketFaultGruppe), f"{fault.reason} is not a group reference"
        faults.append((fault.spiel_nr, fault.gruppe, fault.platz, fault.reason))

    return faults


class TestSeedingTheSlot:
    def seeded(self, decided, quelle: dict[str, Any], spiel: PayloadFactory, stored: dict[str, Any] | None = None):
        fixture = spiel(_id=MATCH_ID.format(25), spiel_nr=25, saison_phase="viertelfinale", team1=stored, team2=None, team1_quelle=quelle)

        return resolve_bracket(FLSpielListAdapter.validate_python([fixture]), {"A": decided})

    def test_a_decided_placing_fills_the_slot(self, a_team: TeamFactory, spiel: PayloadFactory):
        decided = standing([a_team(1, punkte=9), a_team(2, punkte=6)], [])
        resolution = self.seeded(decided, {"type": "gruppe", "gruppe": "A", "platz": 1}, spiel)

        assert resolution.advancements[0].team1 is not None
        assert resolution.advancements[0].team1.name == "Team 1"
        # Arriving in a fixture it has not played, exactly as a match-fed winner does.
        assert resolution.advancements[0].team1.tore is None
        assert resolution.bracket_faults == []

    def test_an_undecided_placing_empties_the_slot_and_reports_nothing(self, a_team: TeamFactory, played: MatchFactory, spiel: PayloadFactory):
        """A slot seeded from an earlier table gives that team back the moment a result stops supporting it."""

        teams = [a_team(1, punkte=3), a_team(2, punkte=3)]
        decided = standing(teams, [played(9, 1, 2)])
        stored = {"team_id": TEAM_ID.format(1), "name": "Team 1", "shorthand": "T1", "tore": None}

        resolution = self.seeded(decided, {"type": "gruppe", "gruppe": "A", "platz": 1}, spiel, stored=stored)

        assert resolution.advancements[0].team1 is None
        assert resolution.bracket_faults == []

    def test_a_platz_the_group_will_never_produce_is_reported_and_the_slot_left_alone(self, a_team: TeamFactory, spiel: PayloadFactory):
        """A typo, not an outcome: erasing a team over a number nobody can resolve destroys more than it reports."""

        decided = standing([a_team(1, punkte=9), a_team(2, punkte=6)], [])
        stored = {"team_id": TEAM_ID.format(1), "name": "Team 1", "shorthand": "T1", "tore": None}

        resolution = self.seeded(decided, {"type": "gruppe", "gruppe": "A", "platz": 5}, spiel, stored=stored)

        assert resolution.advancements == []
        assert gruppe_faults(resolution) == [(25, "A", 5, "gruppe_too_small")]

    def test_a_tie_the_chain_cannot_break_is_reported_once_the_group_is_played_out(
        self, a_team: TeamFactory, played: MatchFactory, spiel: PayloadFactory
    ):
        """Reported and emptied, unlike the typo above: naming either team would be a guess."""

        teams = [a_team(1, punkte=6, geschossen=5, kassiert=5), a_team(2, punkte=6, geschossen=5, kassiert=5)]
        decided = standing(teams, [played(1, 1, 2, 1, 1)])
        stored = {"team_id": TEAM_ID.format(1), "name": "Team 1", "shorthand": "T1", "tore": None}

        resolution = self.seeded(decided, {"type": "gruppe", "gruppe": "A", "platz": 1}, spiel, stored=stored)

        assert resolution.advancements[0].team1 is None
        assert gruppe_faults(resolution) == [(25, "A", 1, "tie_unresolved")]

    def test_a_second_pass_over_a_seeded_bracket_writes_nothing(self, a_team: TeamFactory, spiel: PayloadFactory):
        """Idempotence across the group-seeded half too."""

        decided = standing([a_team(1, punkte=9), a_team(2, punkte=6)], [])
        stored = {"team_id": TEAM_ID.format(1), "name": "Team 1", "shorthand": "T1", "tore": None}

        resolution = self.seeded(decided, {"type": "gruppe", "gruppe": "A", "platz": 1}, spiel, stored=stored)

        assert resolution.advancements == []
