from collections.abc import Callable, Sequence
from typing import Any

import pytest

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.spiele.schemas import SONDEREREIGNIS_WITHOUT_A_RESULT, FLBracketFaultGruppe, FLSpielListAdapter
from app.api.spiele.services import BracketResolution, resolve_bracket
from app.api.teams.schemas import FLTabelleRow, FLTeam
from app.api.teams.standings import CERTAINTY_SPIEL_LIMIT, build_decided_standings, build_tabelle
from app.shared.schemas.literals import FLSpielerStufe
from tests.payloads import PayloadFactory

TEAM_ID = "6890a1b2c3d4e5f60719{:04d}"
MATCH_ID = "6890a1b2c3d4e5f60718{:04d}"

# Typed as the `Literal` list `FLSaisonRules` declares: a bare `list[str]` is invariant against it.
STUFEN: list[FLSpielerStufe] = ["E1", "Q1", "Q2", "Q3", "Q4"]

RULES = FLSaisonRules(
    win_points=3,
    draw_points=1,
    loss_points=0,
    qualifiers_per_gruppe=2,
    number_of_gruppen=4,
    teams_per_gruppe=4,
    tiebreak_order="tordifferenz",
    max_kader_size=18,
    forfeit_ergebnis=FLSaisonForfeitErgebnis(sieger_tore=3, verlierer_tore=0),
    allowed_stufen=STUFEN,
)

# The day before every fixture the factory dates (2026-03-15), so every case using it reads an exit before the group
# was decided; the cases on the date itself spell theirs out.
EXITED = {"type": "disqualifikation", "reason": "Nicht angetreten zum Spieltag", "date": "2026-03-14"}

# One member serves for the same reason: the walk reads the SET a fixture's `sonderereignis` falls in.
CALLED_OFF, *_ = SONDEREREIGNIS_WITHOUT_A_RESULT

TeamFactory = Callable[..., FLTeam]
MatchFactory = Callable[..., dict[str, Any]]


def shorthand_of(seed: int) -> str:
    """A club's shorthand, which `FLTeam` fixes at three letters, one per club of a group at the largest legal size."""

    return f"T{chr(65 + seed // 26)}{chr(65 + seed % 26)}"


@pytest.fixture
def a_team(team: PayloadFactory, statistik: PayloadFactory) -> TeamFactory:
    """Figures are set, not computed, so a case may state a table its match list does not add up to; only head-to-head reads matches."""

    def make(seed: int, *, punkte: int = 0, scored: int = 0, conceded: int = 0, played: int = 3, **overrides: Any) -> FLTeam:
        figures = statistik(punkte=punkte, tore_scored=scored, tore_conceded=conceded, count_played_spiele=played)

        return FLTeam.model_validate(
            team(_id=TEAM_ID.format(seed), name=f"Team {seed}", shorthand=shorthand_of(seed), statistik=figures, **overrides)
        )

    return make


@pytest.fixture
def played(spiel: PayloadFactory, spiel_team_field: PayloadFactory) -> MatchFactory:
    def make(nr: int, home: int, away: int, tore1: int | None = None, tore2: int | None = None, **overrides: Any) -> dict[str, Any]:
        def side(seed: int, tore: int | None) -> dict[str, Any]:
            return spiel_team_field(team_id=TEAM_ID.format(seed), name=f"Team {seed}", shorthand=shorthand_of(seed), tore=tore)

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


# One field apart from `RULES`, so a case run under both differs by the rule and by nothing else.
DIREKTER_VERGLEICH = RULES.model_copy(update={"tiebreak_order": "direkter_vergleich"})


def order(teams: list[FLTeam], documents: list[dict[str, Any]], rules: FLSaisonRules = RULES) -> list[str]:
    """Group A's standing, as a list of names."""

    return [row.name for row in tabelle(teams, documents, rules)]


def tabelle(teams: list[FLTeam], documents: list[dict[str, Any]], rules: FLSaisonRules = RULES) -> list[FLTabelleRow]:
    """Group A's rows as the Tabelle serves them (`build_tabelle`), each with its `platz`."""

    return build_tabelle(teams, FLSpielListAdapter.validate_python(documents), rules)["A"]


def platz_by_team_id(teams: list[FLTeam], documents: list[dict[str, Any]], rules: FLSaisonRules = RULES) -> dict[str, int]:
    """The `platz` the Tabelle serves each club of group A, a club holding none left out.

    Every placing the seeding decides must be the number the Tabelle prints, and nothing else can fail when they part
    company.
    """

    return {str(row.id): row.platz for row in tabelle(teams, documents, rules) if row.platz is not None}


def standing(teams: list[FLTeam], documents: list[dict[str, Any]], rules: FLSaisonRules = RULES):
    """Group A's decided placings."""

    return build_decided_standings(teams, FLSpielListAdapter.validate_python(documents), rules)["A"]


def all_pairs(seeds: Sequence[int]) -> list[tuple[int, int]]:
    """Every pair of `seeds`, which is what a group's fixture list holds once each club is drawn against each other."""

    return [(left, right) for index, left in enumerate(seeds) for right in seeds[index + 1 :]]


def in_state(played: MatchFactory, nr: int, home: int, away: int, state: tuple[int, int] | str | None) -> dict[str, Any]:
    """One pair as a fixture still to play, called off, or carrying a scoreline."""

    if state is None:
        return played(nr, home, away)
    if state == CALLED_OFF:
        return played(nr, home, away, sonderereignis=CALLED_OFF)

    return played(nr, home, away, *state)


class TestTheChain:
    """Points, then goal difference, goals scored and the head-to-head table, in `tordifferenz` order."""

    def test_ranks_on_points_first(self, a_team: TeamFactory):
        teams = [a_team(1, punkte=3), a_team(2, punkte=9), a_team(3, punkte=6)]

        assert order(teams, []) == ["Team 2", "Team 3", "Team 1"]

    def test_breaks_a_points_tie_on_goal_difference(self, a_team: TeamFactory):
        teams = [a_team(1, punkte=6, scored=4, conceded=3), a_team(2, punkte=6, scored=9, conceded=2)]

        assert order(teams, []) == ["Team 2", "Team 1"]

    def test_breaks_an_equal_difference_on_goals_scored(self, a_team: TeamFactory):
        """A two-key sort misses this criterion and leaves second place unanswerable."""

        teams = [a_team(1, punkte=6, scored=2, conceded=1), a_team(2, punkte=6, scored=7, conceded=6)]

        assert order(teams, []) == ["Team 2", "Team 1"]

    def test_breaks_everything_else_on_the_head_to_head(self, a_team: TeamFactory, played: MatchFactory):
        """The criterion that needs the season's matches, so the standing cannot be built from teams alone."""

        teams = [a_team(1, punkte=6, scored=5, conceded=5), a_team(2, punkte=6, scored=5, conceded=5)]

        assert order(teams, [played(1, 1, 2, 0, 2)]) == ["Team 2", "Team 1"]

    def test_uses_the_mini_table_when_three_teams_are_level(self, a_team: TeamFactory, played: MatchFactory):
        """The results cycle, so who beat whom answers nothing and only a mini-table separates them."""

        teams = [
            a_team(1, punkte=6, scored=9, conceded=9),
            a_team(2, punkte=6, scored=9, conceded=9),
            a_team(3, punkte=6, scored=9, conceded=9),
        ]
        matches = [played(1, 1, 2, 1, 0), played(2, 2, 3, 3, 0), played(3, 3, 1, 1, 0)]

        # Each won one and lost one, so the mini-table decides on goal difference: +2, level, -2.
        assert order(teams, matches) == ["Team 2", "Team 1", "Team 3"]

    def test_a_subgroup_that_has_not_all_met_is_left_as_a_tie(self, a_team: TeamFactory, played: MatchFactory):
        """Three level on points and on goals, where Team 3 has met neither of the others.

        The mini-table cannot rank them: a team that played nobody in the subgroup would outrank one
        that lost its meeting, off a comparison that never happened.
        """

        teams = [
            a_team(1, punkte=6, scored=5, conceded=5),
            a_team(2, punkte=6, scored=5, conceded=5),
            a_team(3, punkte=6, scored=5, conceded=5),
        ]
        one_meeting = [played(1, 1, 2, 1, 0)]

        # The order a tie arrives in, and no placing: the group is played out and still answers nothing.
        assert order(teams, one_meeting) == ["Team 1", "Team 2", "Team 3"]
        assert standing(teams, one_meeting).by_platz == {}


class TestDirekterVergleich:
    """The other order: the head-to-head table leads, and only where the clubs that can place have met.

    Several here pass with no guard at all, a band nobody has met scoring every team alike: those
    characterise the branch rather than pin the guard.
    """

    def test_the_mini_table_outranks_a_better_goal_difference(self, a_team: TeamFactory, played: MatchFactory):
        """What the season chose the rule for: the meeting decides, not a margin run up against somebody else."""

        teams = [a_team(1, punkte=6, scored=3, conceded=5), a_team(2, punkte=6, scored=9, conceded=2)]
        met = [played(1, 1, 2, 1, 0)]

        assert order(teams, met, DIREKTER_VERGLEICH) == ["Team 1", "Team 2"]
        assert order(teams, met, RULES) == ["Team 2", "Team 1"]

    def test_a_cycle_the_mini_table_cannot_split_falls_back_to_the_goal_keys(self, a_team: TeamFactory, played: MatchFactory):
        """Every pair met, so the mini-table leads; each won one and lost one, so the criterion it led past decides."""

        teams = [
            a_team(1, punkte=6, scored=6, conceded=5),
            a_team(2, punkte=6, scored=6, conceded=6),
            a_team(3, punkte=6, scored=6, conceded=7),
        ]
        cycle = [played(1, 1, 2, 1, 0), played(2, 2, 3, 1, 0), played(3, 3, 1, 1, 0)]

        assert order(teams, cycle, DIREKTER_VERGLEICH) == ["Team 1", "Team 2", "Team 3"]

    def test_a_pair_the_mini_table_leaves_level_goes_to_the_goal_keys_never_back_to_its_meeting(
        self, a_team: TeamFactory, played: MatchFactory
    ):
        """The chain runs once: re-reading the head-to-head over the smaller set would reorder a band no new result touched.

        Among the three, Team 3 leads on goals scored and Teams 1 and 2 stand level, though Team 1 won their meeting.
        """

        teams = [
            a_team(1, punkte=6, scored=4, conceded=4),
            a_team(2, punkte=6, scored=8, conceded=3),
            a_team(3, punkte=6, scored=5, conceded=5),
        ]
        among_them = [played(1, 1, 2, 1, 0), played(2, 3, 1, 2, 1), played(3, 2, 3, 2, 1)]

        assert order(teams, among_them, DIREKTER_VERGLEICH) == ["Team 3", "Team 2", "Team 1"]

    def test_a_band_missing_a_meeting_ranks_on_the_goal_keys(self, a_team: TeamFactory, played: MatchFactory):
        """Team 3 has met neither of the others, so no comparison exists to decide anything.

        Its +9 stands, where a mini-table would read that silence as worse than the other two's draw.
        """

        teams = [
            a_team(1, punkte=6, scored=2, conceded=2),
            a_team(2, punkte=6, scored=1, conceded=2),
            a_team(3, punkte=6, scored=10, conceded=1),
        ]
        drawn = [played(1, 1, 2, 0, 0)]

        assert order(teams, drawn, DIREKTER_VERGLEICH) == ["Team 3", "Team 1", "Team 2"]
        assert order(teams, drawn, RULES) == ["Team 3", "Team 1", "Team 2"]
        # A match between two other teams moved nobody: the whole defect was that it moved Team 3 to last.
        assert order(teams, [], DIREKTER_VERGLEICH) == order(teams, drawn, DIREKTER_VERGLEICH)

    def test_a_called_off_meeting_is_no_meeting(self, a_team: TeamFactory, played: MatchFactory):
        """Team 3's two fixtures are on the list and were never played, so the comparison is as absent as if they were never drawn."""

        teams = [
            a_team(1, punkte=6, scored=2, conceded=2),
            a_team(2, punkte=6, scored=1, conceded=2),
            a_team(3, punkte=6, scored=10, conceded=1),
        ]
        called_off = [played(1, 1, 2, 0, 0), played(2, 1, 3, sonderereignis="ausgefallen"), played(3, 2, 3, sonderereignis="ausgefallen")]

        assert order(teams, called_off, DIREKTER_VERGLEICH) == ["Team 3", "Team 1", "Team 2"]

    def test_a_placing_the_missing_meeting_could_still_decide_is_not_pinned(self, a_team: TeamFactory, played: MatchFactory):
        """The two are still to meet, so every table their result could produce has to agree before a slot seeds."""

        teams = [
            a_team(1, punkte=6, scored=2, conceded=2, played=2),
            a_team(2, punkte=6, scored=1, conceded=2, played=2),
            a_team(3, punkte=6, scored=10, conceded=1),
        ]
        decided = standing(teams, [played(9, 1, 2)], DIREKTER_VERGLEICH)

        assert not decided.is_complete
        assert decided.by_platz == {}

    def test_a_placing_no_meeting_can_reach_is_pinned_on_the_goal_keys(self, a_team: TeamFactory, played: MatchFactory):
        """Nothing left to play, so the missing meeting never happens; the bracket seeds from the goal keys."""

        teams = [
            a_team(1, punkte=6, scored=2, conceded=2),
            a_team(2, punkte=6, scored=1, conceded=2),
            a_team(3, punkte=6, scored=10, conceded=1),
        ]
        decided = standing(teams, [played(1, 1, 2, 0, 0)], DIREKTER_VERGLEICH)

        assert decided.is_complete
        assert [decided.by_platz[platz].name for platz in (1, 2, 3)] == ["Team 3", "Team 1", "Team 2"]

    @pytest.mark.parametrize(
        ("its_spiele", "displayed"),
        [
            pytest.param(None, ["Team 1", "Team 2", "Team 4", "Team 3", "Team 5"], id="still to play, so the goal keys rank the band"),
            pytest.param(CALLED_OFF, ["Team 1", "Team 3", "Team 2", "Team 4", "Team 5"], id="all called off, so the meetings rank it"),
        ],
    )
    def test_a_team_yet_to_play_its_first_match_holds_the_mini_table_back_and_one_with_nothing_left_does_not(
        self, a_team: TeamFactory, played: MatchFactory, its_spiele: str | None, displayed: list[str]
    ):
        """Team 5 has played nothing and stands level with three clubs that drew each other, a draw worth nothing here.

        With a match still to play it can still hold a place, so its missing meetings leave the band to the goal keys; with
        every fixture called off it can hold none, and the three that met are ranked on their meetings. The Tabelle lists
        Team 5 last either way, so only the three clubs' order tells the two apart.
        """

        rules = DIREKTER_VERGLEICH.model_copy(update={"draw_points": 0})
        # The figures the fixtures below add up to: Team 1 beat the three, which drew each other.
        teams = [
            a_team(1, punkte=9, scored=6, conceded=0),
            a_team(2, punkte=0, scored=2, conceded=3),
            a_team(3, punkte=0, scored=3, conceded=7),
            a_team(4, punkte=0, scored=1, conceded=2),
            a_team(5, punkte=0, played=0),
        ]
        among_the_three = [played(1, 2, 3, 2, 2), played(2, 2, 4, 0, 0), played(3, 3, 4, 1, 1)]
        against_team_1 = [played(4, 1, 2, 1, 0), played(5, 1, 3, 4, 0), played(6, 1, 4, 1, 0)]
        team_5s = [in_state(played, 7 + index, 5, other, its_spiele) for index, other in enumerate((1, 2, 3, 4))]

        assert order(teams, [*among_the_three, *against_team_1, *team_5s], rules) == displayed

    def test_the_fallback_still_ranks_a_subgroup_that_has_met(self, a_team: TeamFactory, played: MatchFactory):
        """The guard refuses a missing comparison, never a real one: Teams 1 and 2 met, and their meeting still decides."""

        teams = [
            a_team(1, punkte=6, scored=5, conceded=5),
            a_team(2, punkte=6, scored=5, conceded=5),
            a_team(3, punkte=6, scored=10, conceded=1),
        ]
        one_meeting = [played(1, 1, 2, 0, 1)]

        assert order(teams, one_meeting, DIREKTER_VERGLEICH) == ["Team 3", "Team 2", "Team 1"]
        decided = standing(teams, one_meeting, DIREKTER_VERGLEICH)

        assert [decided.by_platz[platz].name for platz in (1, 2, 3)] == ["Team 3", "Team 2", "Team 1"]


class TestADepartedTeamInTheBand:
    """A club that has left is ranked and displayed, and settles nothing for the clubs that can place.

    `build_tabelle` ranks it and `build_decided_standings` never sees it, so a comparison judged over
    whoever is present would split the two surfaces.
    """

    @pytest.mark.parametrize("rules", [RULES, DIREKTER_VERGLEICH], ids=["tordifferenz", "direkter_vergleich"])
    def test_the_table_and_the_bracket_order_the_placeable_teams_alike(self, a_team: TeamFactory, played: MatchFactory, rules: FLSaisonRules):
        """The property the two callers must share, asserted between them rather than inferred from either."""

        teams = [
            a_team(1, punkte=6, scored=4, conceded=4),
            a_team(2, punkte=6, scored=4, conceded=4),
            a_team(3, punkte=6, scored=4, conceded=4, austritt=EXITED),
        ]
        met = [played(1, 1, 2, 2, 0)]

        displayed = [name for name in order(teams, met, rules) if name != "Team 3"]
        decided = standing(teams, met, rules)

        # Team 3 is ranked on its own vacuous mini-table row, which is what "still displayed" means.
        assert order(teams, met, rules) == ["Team 1", "Team 3", "Team 2"]
        assert displayed == ["Team 1", "Team 2"]
        assert [decided.by_platz[platz].name for platz in sorted(decided.by_platz)] == displayed

    @pytest.mark.parametrize("rules", [RULES, DIREKTER_VERGLEICH], ids=["tordifferenz", "direkter_vergleich"])
    def test_a_result_against_the_departed_team_separates_the_two_that_remain(
        self, a_team: TeamFactory, played: MatchFactory, rules: FLSaisonRules
    ):
        """Teams 1 and 2 drew, so ONLY their results against the departed club tell them apart.

        Ranking placeable clubs alone loses them and reports a tie the table does not show. The
        departed club takes no place, so second belongs to whoever it beat.
        """

        teams = [
            a_team(1, punkte=4, scored=4, conceded=4),
            a_team(2, punkte=4, scored=4, conceded=4),
            a_team(3, punkte=4, scored=4, conceded=4, austritt=EXITED),
        ]
        met = [played(1, 1, 2, 1, 1), played(2, 1, 3, 3, 0), played(3, 2, 3, 0, 3)]
        decided = standing(teams, met, rules)

        assert order(teams, met, rules) == ["Team 1", "Team 3", "Team 2"]
        assert [decided.by_platz[platz].name for platz in (1, 2)] == ["Team 1", "Team 2"]

    def test_a_departed_teams_own_unplayed_spiel_still_holds_the_band_open(self, a_team: TeamFactory, played: MatchFactory):
        """Points are hypothesised and goal margins never, so an unbounded difference stays unbounded whoever holds it.

        The departed club's goal key decides whether its results enter the live clubs' mini-table,
        so nothing is final while it has a match left.
        """

        teams = [
            a_team(1, punkte=4, scored=4, conceded=4),
            a_team(2, punkte=4, scored=4, conceded=4),
            a_team(3, punkte=1, scored=4, conceded=4, austritt=EXITED),
            a_team(4, punkte=0, austritt=EXITED),
        ]
        between_the_live_teams = played(1, 1, 2, 2, 0)

        assert standing(teams, [between_the_live_teams, played(9, 3, 4)]).by_platz == {}

        # The control: the same group with that one fixture played decides both placings, so the case
        # above cannot be passing because a departed club is in the band at all.
        settled = standing(teams, [between_the_live_teams, played(9, 3, 4, 1, 0)])

        assert [settled.by_platz[platz].name for platz in (1, 2)] == ["Team 1", "Team 2"]


class TestWhoMayHoldAPlatz:
    """A placing is walked past a team that cannot advance out of it, and the next team takes it."""

    def test_the_placings_walk_past_a_disqualified_team(self, a_team: TeamFactory):
        """The table and the bracket must agree, or the public page and the bracket name different qualifiers."""

        teams = [a_team(1, punkte=9, austritt=EXITED), a_team(2, punkte=6), a_team(3, punkte=3)]
        decided = standing(teams, [])

        assert decided.eligible == 2
        assert [team.name for team in decided.by_platz.values()] == ["Team 2", "Team 3"]

    def test_a_team_with_nothing_played_and_nothing_left_holds_no_placing(self, a_team: TeamFactory):
        """A zeroed `statistik` ranks above every negative difference, so zeroes would take a placing nothing earned."""

        teams = [a_team(1, punkte=0, played=0), a_team(2, punkte=3, scored=1, conceded=4)]
        decided = standing(teams, [])

        assert decided.eligible == 1
        assert decided.by_platz[1].name == "Team 2"


class TestTheTableAndTheSeedingNumberTheSameTeams:
    """The Tabelle numbers the clubs that have played, and every placing the seeding decides is the number it prints.

    The seeding also counts a club with no match that has one still to play, which the Tabelle lists last; no
    placing below such a club is decided, since it can still finish level with any of them on points.
    """

    def test_a_team_that_has_played_no_match_holds_no_place(self, a_team: TeamFactory, played: MatchFactory):
        """Before a group's first match every row reads null, while the seeding still counts each club that has a match to play."""

        teams = [a_team(seed, punkte=0, played=0) for seed in (1, 2, 3)]
        spiele = [played(1, 1, 2), played(2, 1, 3), played(3, 2, 3)]

        assert [row.platz for row in tabelle(teams, spiele)] == [None, None, None]
        assert standing(teams, spiele).eligible == 3

    def test_every_placing_the_seeding_decides_is_the_number_the_table_prints(self, a_team: TeamFactory, played: MatchFactory):
        """Mid-group: the club yet to play ranks second on its zeroes, sorts last and prints no number, and the club below it prints 2."""

        teams = [a_team(1, punkte=9), a_team(2, punkte=0, played=0), a_team(3, punkte=0, scored=0, conceded=9)]
        spiele = [played(1, 2, 3)]

        decided = standing(teams, spiele)
        numbered = platz_by_team_id(teams, spiele)
        seeded = {str(team.id): platz for platz, team in decided.by_platz.items()}

        assert [row.name for row in tabelle(teams, spiele)] == ["Team 1", "Team 3", "Team 2"]
        assert decided.eligible == 3
        assert numbered == {TEAM_ID.format(1): 1, TEAM_ID.format(3): 2}
        # Pinned before it is compared: an `all` over a `by_platz` some tighter certainty rule emptied
        # asserts nothing and still passes.
        assert seeded == {TEAM_ID.format(1): 1}
        assert seeded.items() <= numbered.items()

    def test_a_finished_group_numbers_each_team_at_the_platz_it_is_seeded_from(self, a_team: TeamFactory):
        """A departed club sits second on points, so a row index and a placing part company here."""

        teams = [a_team(1, punkte=9), a_team(2, punkte=6, austritt=EXITED), a_team(3, punkte=3)]
        decided = standing(teams, [])

        assert platz_by_team_id(teams, []) == {str(team.id): platz for platz, team in decided.by_platz.items()}

    def test_teams_the_chain_leaves_level_share_the_place_their_band_starts_at(self, a_team: TeamFactory, played: MatchFactory):
        """Level on points and goals and drawn against each other: the bracket seeds neither, and the Tabelle prints both second."""

        level = {"punkte": 4, "scored": 5, "conceded": 5}
        teams = [a_team(1, punkte=9), a_team(2, **level), a_team(3, **level), a_team(4, punkte=0)]
        drawn = [played(1, 2, 3, 1, 1)]

        assert platz_by_team_id(teams, drawn) == {TEAM_ID.format(1): 1, TEAM_ID.format(2): 2, TEAM_ID.format(3): 2, TEAM_ID.format(4): 4}
        assert {str(team.id): platz for platz, team in standing(teams, drawn).by_platz.items()} == {TEAM_ID.format(1): 1, TEAM_ID.format(4): 4}


class TestWhenAPlacingIsFinal:
    """A placing is seeded only when no way the group can still go would change it."""

    def test_a_placing_a_remaining_match_could_change_is_not_decided(self, a_team: TeamFactory, played: MatchFactory):
        """The table shows an order, and seeding from it here leaves the public bracket confidently wrong."""

        teams = [a_team(1, punkte=9), a_team(2, punkte=3), a_team(3, punkte=3)]
        decided = standing(teams, [played(9, 2, 3)])

        assert not decided.is_complete
        assert 2 not in decided.by_platz and 3 not in decided.by_platz

    def test_a_lead_a_remaining_match_could_erase_is_not_decided(self, a_team: TeamFactory, played: MatchFactory):
        teams = [a_team(1, punkte=6), a_team(2, punkte=3), a_team(3, punkte=3)]

        assert standing(teams, [played(9, 2, 3)]).by_platz == {}

    def test_a_lead_only_a_goal_margin_could_erase_is_not_decided(self, a_team: TeamFactory, played: MatchFactory):
        """Nothing bounds how much Team 2 could win by, so today's goal difference cannot seed a bracket."""

        teams = [a_team(1, punkte=6, scored=20, conceded=0), a_team(2, punkte=3, scored=0, conceded=1), a_team(3, punkte=0)]

        assert standing(teams, [played(9, 2, 3)]).by_platz == {}

    @pytest.mark.parametrize("sonderereignis", SONDEREREIGNIS_WITHOUT_A_RESULT)
    def test_a_spiel_that_can_award_nothing_is_never_coming(self, a_team: TeamFactory, played: MatchFactory, sonderereignis: str):
        """Nothing recorded awards nobody, so it does not hold the group open; a forfeit is `test_bracket.py`'s."""

        teams = [a_team(1, punkte=9), a_team(2, punkte=6)]
        decided = standing(teams, [played(9, 1, 2, sonderereignis=sonderereignis)])

        assert decided.is_complete
        assert decided.by_platz[1].name == "Team 1"

    def test_an_abandoned_spiel_with_no_result_still_holds_the_group_open(self, a_team: TeamFactory, played: MatchFactory):
        """The distinction the boolean hid: an abandonment may yet be replayed, so a point it could award is still to come."""

        teams = [a_team(1, punkte=9), a_team(2, punkte=6)]
        decided = standing(teams, [played(9, 1, 2, sonderereignis="abgebrochen")])

        assert not decided.is_complete
        assert decided.by_platz == {}

    def test_a_pending_spiel_with_no_sides_blocks_every_group(self, a_team: TeamFactory, spiel: PayloadFactory, played: MatchFactory):
        """It will award points inside some group and nothing can say which. Reachable only by hand: fixtures are created with their teams."""

        teams = [a_team(1, punkte=9), a_team(2, punkte=6)]
        unentered = spiel(_id=MATCH_ID.format(9), spiel_nr=9, saison_phase="gruppenphase", team1=None, team2=None, ergebnis=None)

        assert standing(teams, [played(1, 1, 2, 2, 0), unentered]).by_platz == {}

    def test_a_group_past_the_spiel_limit_seeds_nothing_yet_and_still_counts_its_teams(self, a_team: TeamFactory, played: MatchFactory):
        """Even a lead no remaining fixture can close waits until no more than `CERTAINTY_SPIEL_LIMIT` fixtures stay open.

        The bracket still reads how many clubs can place and whether the group is played out, so both stay counted.
        """

        seeds = [1, 2, 3, 4, 5]
        teams = [a_team(1, punkte=50), *(a_team(seed) for seed in seeds[1:])]
        decided = standing(teams, [played(number + 1, home, away) for number, (home, away) in enumerate(all_pairs(seeds))])

        assert len(all_pairs(seeds)) > CERTAINTY_SPIEL_LIMIT
        assert (decided.eligible, decided.is_complete, decided.by_platz) == (5, False, {})

    def test_the_walk_runs_at_the_spiel_limit_and_not_one_past_it(self, a_team: TeamFactory, played: MatchFactory):
        """Team 1's first place is beyond reach: every club that could take it has left the season."""

        teams = [
            a_team(1, punkte=3, played=1),
            a_team(2, punkte=0, played=1, austritt=EXITED),
            *(a_team(seed, punkte=0, played=0, austritt=EXITED) for seed in (3, 4, 5)),
        ]
        pairs = all_pairs([1, 2, 3, 4, 5])

        def spiele(*called_off: int) -> list[dict[str, Any]]:
            states = {0: (1, 0), **dict.fromkeys(called_off, CALLED_OFF)}
            return [in_state(played, number + 1, home, away, states.get(number)) for number, (home, away) in enumerate(pairs)]

        # Team 1 beat Team 2, and a CALL-OFF closes the second fixture: it takes the open count down
        # without moving a figure, so the two lists rank everybody alike.
        at_the_cap = spiele(pairs.index((3, 4)))
        one_past_it = spiele()

        assert sum(1 for spiel in at_the_cap if spiel["ergebnis"] is None and spiel["sonderereignis"] is None) == CERTAINTY_SPIEL_LIMIT
        assert standing(teams, at_the_cap).by_platz[1].name == "Team 1"
        assert standing(teams, one_past_it).by_platz == {}


class TestACallOffIsAnEndingToo:
    """An outstanding fixture may be called off, awarding nothing to EITHER club and leaving neither with it to play.

    No ending that awards something expresses either half.
    """

    def test_a_team_with_nothing_counted_and_one_spiel_left_holds_no_placing(self, a_team: TeamFactory, played: MatchFactory):
        """The minimal witness, and reachable under any points scheme.

        A call-off takes the club out of `_may_hold_a_platz`, and its own placing with it.
        """

        teams = [a_team(1, punkte=4, played=2, austritt=EXITED), a_team(2, punkte=0, played=0)]
        decided = standing(teams, [played(9, 1, 2)])

        assert decided.eligible == 1
        assert decided.by_platz == {}

    def test_the_same_team_with_one_match_counted_does_hold_it(self, a_team: TeamFactory, played: MatchFactory):
        """One figure apart from the case above, so neither can pass for the wrong reason: a counted match cannot be called off."""

        teams = [a_team(1, punkte=4, played=2, austritt=EXITED), a_team(2, punkte=0, played=1)]
        decided = standing(teams, [played(9, 1, 2)])

        assert decided.eligible == 1
        assert decided.by_platz[1].name == "Team 2"

    @pytest.mark.parametrize(
        ("left_on", "seeded"),
        [
            pytest.param(None, ["Team 1"], id="a club in the season"),
            pytest.param("2026-03-16", ["Team 1"], id="a club leaving the day after the group's last fixture"),
            pytest.param("2026-03-15", ["Team 1", "Team 3"], id="the control, a club leaving on that day"),
        ],
    )
    def test_a_team_yet_to_play_its_first_match_holds_open_the_place_it_could_win(
        self, a_team: TeamFactory, played: MatchFactory, left_on: str | None, seeded: list[str]
    ):
        """Team 2 has played nothing and meets Team 3, three points ahead, in the group's last fixture.

        A win draws Team 2 level, so second place waits on that fixture; only the call-off, the one ending leaving Team 2
        nothing counted, takes it out of the set. Leaving on the fixture's own day it holds no place in any ending, and
        Team 3's second place is decided whatever the fixture brings.
        """

        teams = [
            a_team(1, punkte=9),
            a_team(2, punkte=0, played=0, austritt=None if left_on is None else austritt_on(left_on)),
            a_team(3, punkte=3, played=2),
        ]
        # Dated 2026-03-15 by the factory, the day the group is decided on.
        decided = standing(teams, [played(1, 2, 3)])

        assert [decided.by_platz[platz].name for platz in sorted(decided.by_platz)] == seeded

    def test_a_call_off_is_told_from_a_draw_awarding_the_same_nothing(self, a_team: TeamFactory, played: MatchFactory):
        """`FLSaisonRules` bounds `draw_points` below at zero, where the draw and the call-off leave every total identical.

        They rank differently all the same, so a deduplication reading the table alone skips one and
        seeds a placing the call-off empties.
        """

        nothing_for_a_draw = RULES.model_copy(update={"draw_points": 0})
        departed = [a_team(1, punkte=3, played=1, austritt=EXITED), a_team(3, punkte=0, played=1, austritt=EXITED)]
        spiele = [played(1, 1, 3, 1, 0), played(2, 1, 2)]

        assert standing([departed[0], a_team(2, punkte=0, played=0), departed[1]], spiele, nothing_for_a_draw).by_platz == {}
        assert standing([departed[0], a_team(2, punkte=0, played=1), departed[1]], spiele, nothing_for_a_draw).by_platz[1].name == "Team 2"


def gruppe_faults(resolution: BracketResolution) -> list[tuple[int, str, int, str]]:
    """The `isinstance` is an assertion, not a type-checker concession: only a group reference carries a `gruppe` and a `platz`."""

    faults = []
    for fault in resolution.bracket_faults:
        assert isinstance(fault, FLBracketFaultGruppe), f"{fault.reason} is not a group reference"
        faults.append((fault.spiel_nr, fault.gruppe, fault.platz, fault.reason))

    return faults


class TestSeedingTheSlot:
    def seeded(self, decided, quelle: dict[str, Any], spiel: PayloadFactory, stored: dict[str, Any] | None = None):
        knockout_spiel = spiel(
            _id=MATCH_ID.format(25), spiel_nr=25, saison_phase="viertelfinale", team1=stored, team2=None, team1_quelle=quelle
        )

        return resolve_bracket(FLSpielListAdapter.validate_python([knockout_spiel]), {"A": decided})

    def test_a_decided_placing_fills_the_slot(self, a_team: TeamFactory, spiel: PayloadFactory):
        decided = standing([a_team(1, punkte=9), a_team(2, punkte=6)], [])
        resolution = self.seeded(decided, {"type": "gruppe", "gruppe": "A", "platz": 1}, spiel)

        assert resolution.advancements[0].team1 is not None
        assert resolution.advancements[0].team1.team_id == a_team(1).id
        # Arriving in a fixture it has not played, exactly as a match-fed winner does.
        assert resolution.advancements[0].team1.tore is None
        assert resolution.bracket_faults == []

    def test_an_undecided_placing_empties_the_slot_and_reports_nothing(self, a_team: TeamFactory, played: MatchFactory, spiel: PayloadFactory):
        """A slot seeded from an earlier table gives that team back the moment a result stops supporting it."""

        teams = [a_team(1, punkte=3), a_team(2, punkte=3)]
        decided = standing(teams, [played(9, 1, 2)])
        stored = {"team_id": TEAM_ID.format(1), "tore": None}

        resolution = self.seeded(decided, {"type": "gruppe", "gruppe": "A", "platz": 1}, spiel, stored=stored)

        assert resolution.advancements[0].team1 is None
        assert resolution.bracket_faults == []

    def test_a_platz_the_group_will_never_produce_is_reported_and_the_slot_left_alone(self, a_team: TeamFactory, spiel: PayloadFactory):
        """A typo, not an outcome: erasing a team over a number nobody can resolve destroys more than it reports."""

        decided = standing([a_team(1, punkte=9), a_team(2, punkte=6)], [])
        stored = {"team_id": TEAM_ID.format(1), "tore": None}

        resolution = self.seeded(decided, {"type": "gruppe", "gruppe": "A", "platz": 5}, spiel, stored=stored)

        assert resolution.advancements == []
        assert gruppe_faults(resolution) == [(25, "A", 5, "gruppe_too_small")]

    def test_a_tie_the_chain_cannot_break_is_reported_once_the_group_is_played_out(
        self, a_team: TeamFactory, played: MatchFactory, spiel: PayloadFactory
    ):
        """Reported and emptied, unlike the typo above: naming either team would be a guess."""

        teams = [a_team(1, punkte=6, scored=5, conceded=5), a_team(2, punkte=6, scored=5, conceded=5)]
        decided = standing(teams, [played(1, 1, 2, 1, 1)])
        stored = {"team_id": TEAM_ID.format(1), "tore": None}

        resolution = self.seeded(decided, {"type": "gruppe", "gruppe": "A", "platz": 1}, spiel, stored=stored)

        assert resolution.advancements[0].team1 is None
        assert gruppe_faults(resolution) == [(25, "A", 1, "tie_unresolved")]

    def test_a_second_pass_over_a_seeded_bracket_writes_nothing(self, a_team: TeamFactory, spiel: PayloadFactory):
        """Idempotence across the group-seeded half too."""

        decided = standing([a_team(1, punkte=9), a_team(2, punkte=6)], [])
        stored = {"team_id": TEAM_ID.format(1), "tore": None}

        resolution = self.seeded(decided, {"type": "gruppe", "gruppe": "A", "platz": 1}, spiel, stored=stored)

        assert resolution.advancements == []


def austritt_on(date: str, route: str = "disqualifikation") -> dict[str, Any]:
    return {"type": route, "reason": "Ausgeschieden", "date": date}


class TestAnExitIsWeighedAgainstTheDayItsGroupWasDecided:
    """A place decided before a club's exit stands, one decided on or after it is vacated, for either route out.

    Team 1 tops group A on every table here, so whether it holds the first place is the exit rule and nothing else.
    """

    def _group(
        self, a_team: TeamFactory, played: MatchFactory, austritt: dict[str, Any], **last: Any
    ) -> tuple[list[FLTeam], list[dict[str, Any]]]:
        teams = [a_team(1, punkte=6, austritt=austritt), a_team(2, punkte=3), a_team(3, punkte=0)]
        # Dated 2026-03-15 by the factory unless `last` dates the third.
        spiele = [played(1, 1, 2, 1, 0), played(2, 1, 3, 1, 0), played(3, 2, 3, 1, 0, **last)]

        return teams, spiele

    @pytest.mark.parametrize("route", ["disqualifikation", "rueckzug"])
    def test_an_exit_after_the_last_spiel_keeps_its_place_and_its_seed(self, a_team: TeamFactory, played: MatchFactory, route: str):
        teams, spiele = self._group(a_team, played, austritt_on("2026-03-16", route))

        assert platz_by_team_id(teams, spiele) == {TEAM_ID.format(1): 1, TEAM_ID.format(2): 2, TEAM_ID.format(3): 3}
        assert standing(teams, spiele).by_platz[1].id == teams[0].id

    @pytest.mark.parametrize("route", ["disqualifikation", "rueckzug"])
    def test_an_exit_on_the_last_spiele_day_vacates_it(self, a_team: TeamFactory, played: MatchFactory, route: str):
        """The exit's own day counts as after it, as the eligibility rule orders a day against it."""

        teams, spiele = self._group(a_team, played, austritt_on("2026-03-15", route))

        assert platz_by_team_id(teams, spiele) == {TEAM_ID.format(2): 1, TEAM_ID.format(3): 2}
        assert standing(teams, spiele).by_platz[1].id == teams[1].id

    def test_an_undated_spiel_that_can_still_award_points_vacates_it(self, a_team: TeamFactory, played: MatchFactory):
        """Nothing says the group was decided before the exit, so the place is not the departed club's."""

        teams, spiele = self._group(a_team, played, austritt_on("2026-12-31"), date=None)

        assert TEAM_ID.format(1) not in platz_by_team_id(teams, spiele)

    @pytest.mark.parametrize("sides", [(2, 3), (1, 3)], ids=["between two clubs that stay", "fielding the departed club"])
    def test_an_undated_call_off_leaves_the_group_undecided(self, a_team: TeamFactory, played: MatchFactory, sides: tuple[int, int]):
        """It awards nothing, and still nothing says the group was decided before the exit, so the place is not the departed club's."""

        teams, spiele = self._group(a_team, played, austritt_on("2026-03-16"))
        spiele.append(played(4, *sides, date=None, sonderereignis=CALLED_OFF))

        assert TEAM_ID.format(1) not in platz_by_team_id(teams, spiele)
        assert standing(teams, spiele).by_platz[1].id == teams[1].id

    @pytest.mark.parametrize("last", [{}, {"sonderereignis": CALLED_OFF}], ids=["still to play", "called off"])
    def test_a_place_the_walk_decides_stays_decided_when_its_undated_spiel_is_called_off(
        self, a_team: TeamFactory, played: MatchFactory, last: dict[str, Any]
    ):
        """While the one undated fixture is open the walk seeds the club below the departed one, so calling it off may not hand the place back.

        Club 1 left the day after every dated fixture, so a day read off the call-off would date the group before the exit
        and give club 1 back the first place, rewriting a slot the bracket had seeded with club 2.
        """

        teams = [a_team(1, punkte=9, austritt=austritt_on("2026-03-16")), a_team(2, punkte=6), a_team(3), a_team(4)]
        dated = [played(nr, home, away, 1, 0) for nr, (home, away) in enumerate(all_pairs([1, 2, 3, 4])[:-1], start=1)]
        spiele = [*dated, played(6, 3, 4, date=None, **last)]

        assert standing(teams, spiele).by_platz[1].id == teams[1].id

    @pytest.mark.parametrize(("date", "seeded"), [("2026-03-21", True), ("2026-03-20", False)], ids=["after", "on the day"])
    def test_the_walk_weighs_the_day_of_a_spiel_still_to_play(self, a_team: TeamFactory, played: MatchFactory, date: str, seeded: bool):
        """With a fixture still open the group is decided on its day, which the walk reads for every ending alike."""

        teams = [a_team(1, punkte=9, austritt=austritt_on(date)), a_team(2, punkte=3), a_team(3, punkte=0)]
        spiele = [played(1, 1, 2, 1, 0), played(2, 1, 3, 1, 0), played(3, 2, 3, date="2026-03-20")]

        holder = standing(teams, spiele).by_platz.get(1)

        assert (holder is not None and holder.id == teams[0].id) is seeded

    @pytest.mark.parametrize("rules", [RULES, DIREKTER_VERGLEICH], ids=["tordifferenz", "direkter_vergleich"])
    def test_a_team_that_left_after_the_group_is_decided_counts_in_its_tiebreak(
        self, a_team: TeamFactory, played: MatchFactory, rules: FLSaisonRules
    ):
        """Level with two clubs and having met neither, so no meeting ranks the three: they share the place their band starts at.

        Gone before the decision, the same club would be left out and the meeting of the other two would rank them.
        """

        level = {"punkte": 6, "scored": 4, "conceded": 4}
        teams = [a_team(1, **level), a_team(2, **level), a_team(3, **level, austritt=austritt_on("2026-03-16"))]
        met = [played(1, 1, 2, 2, 0)]

        assert platz_by_team_id(teams, met, rules) == {TEAM_ID.format(1): 1, TEAM_ID.format(2): 1, TEAM_ID.format(3): 1}
