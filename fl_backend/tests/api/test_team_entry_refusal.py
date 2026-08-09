"""
TEAMS · the rules guarding `POST /teams/{team_id}/saisons`

Decided 2026-08-07: a team enters only a `future` season, only into a group that season offers,
and only while that group has space. Pure, so the default tier covers it without a container.
"""

from app.api.saisons.schemas import FLSaisonRules
from app.api.spieler.schemas import FLSpielerStufe
from app.api.teams.services import (
    ENTRY_GRUPPE_FULL,
    ENTRY_GRUPPE_NOT_OFFERED,
    ENTRY_SAISON_NOT_FUTURE,
    find_entry_refusal,
    offered_gruppen,
)

# The levels the seeded season offers. Its own name so the rule lines stay readable, and typed as
# the Literal list `FLSaisonRules` declares -- a bare list of `str` is invariant against it.
STUFEN: list[FLSpielerStufe] = ["E1", "Q1", "Q2", "Q3", "Q4"]

RULES = FLSaisonRules(win_points=3, draw_points=1, qualifiers_per_group=2, number_of_groups=2, teams_per_group=4, erlaubte_stufen=STUFEN)


class TestOfferedGruppen:
    def test_the_count_takes_the_first_names_of_the_closed_set_in_order(self):
        assert offered_gruppen(2) == ("A", "B")

    def test_four_is_the_whole_set(self):
        assert offered_gruppen(4) == ("A", "B", "C", "D")


class TestEnteringASeason:
    def test_a_future_season_with_space_takes_the_team(self):
        assert find_entry_refusal(saison_status="future", gruppe="A", rules=RULES, occupied=3) is None

    def test_the_active_season_is_refused(self):
        refusal = find_entry_refusal(saison_status="active", gruppe="A", rules=RULES, occupied=0)
        assert refusal is not None
        assert refusal[0] == ENTRY_SAISON_NOT_FUTURE

    def test_a_past_season_is_refused(self):
        refusal = find_entry_refusal(saison_status="past", gruppe="A", rules=RULES, occupied=0)
        assert refusal is not None
        assert refusal[0] == ENTRY_SAISON_NOT_FUTURE

    def test_a_group_the_season_does_not_run_is_refused(self):
        refusal = find_entry_refusal(saison_status="future", gruppe="C", rules=RULES, occupied=0)
        assert refusal is not None
        assert refusal[0] == ENTRY_GRUPPE_NOT_OFFERED

    def test_a_full_group_is_refused(self):
        refusal = find_entry_refusal(saison_status="future", gruppe="B", rules=RULES, occupied=4)
        assert refusal is not None
        assert refusal[0] == ENTRY_GRUPPE_FULL

    def test_the_season_gate_outranks_the_group_gates(self):
        """The first rule an admin can act on is named first: a past season's full group reports the season."""
        refusal = find_entry_refusal(saison_status="past", gruppe="C", rules=RULES, occupied=4)
        assert refusal is not None
        assert refusal[0] == ENTRY_SAISON_NOT_FUTURE
