import pytest

from app.api.spiele.schemas import SONDEREREIGNIS_PRODUCING_A_RECORD, SONDEREREIGNIS_WITHOUT_A_RESULT
from app.api.teams.services import (
    CLUB_RETIRED,
    REPLACE_INCOMING_ALREADY_ENTERED,
    REPLACE_OUTGOING_HAS_A_RECORD,
    REPLACE_SAISON_FINISHED,
    find_replacement_refusal,
    has_taken_place,
)


def replacement(**overrides):
    """A legal replacement, with the field under test overridden."""

    payload = {
        "saison_status": "active",
        "fixtures_with_a_record": 0,
        "incoming_inactive_since": None,
        "incoming_already_entered": False,
    }
    payload.update(overrides)

    return find_replacement_refusal(**payload)


def fixture(**overrides):
    """A drawn fixture nobody has played, with the field under test overridden."""

    return {"ergebnis": None, "sonderereignis": None, "team1": {"tore": None}, "team2": {"tore": None}, **overrides}


class TestWhichSeasonsAreOpenToAReplacement:
    def test_a_started_season_permits_one(self):
        """The window is NOT D34's `future`-only one: a club withdraws mid-season by definition."""

        assert replacement(saison_status="active") is None

    def test_a_planned_season_permits_one(self):
        assert replacement(saison_status="future") is None

    def test_a_finished_season_is_refused(self):
        """Kills the mutation that borrows the entry gate's `!= "future"`, which would refuse the season this rule is FOR."""

        refusal = replacement(saison_status="past")

        assert refusal is not None
        assert refusal.error_code == REPLACE_SAISON_FINISHED


class TestTheOutgoingClubMustHavePlayedNothing:
    def test_a_club_with_only_drawn_fixtures_is_replaceable(self):
        assert replacement(fixtures_with_a_record=0) is None

    def test_one_fixture_with_a_record_is_enough(self):
        """No threshold: the incoming club inherits the schedule, so one played fixture would credit it with a match it never played."""

        refusal = replacement(fixtures_with_a_record=1)

        assert refusal is not None
        assert refusal.error_code == REPLACE_OUTGOING_HAS_A_RECORD

    def test_the_refusal_says_how_much_has_taken_place(self):
        refusal = replacement(fixtures_with_a_record=3)

        assert refusal is not None
        assert "3" in refusal.message


class TestTheIncomingClubMustBeNewToTheSeason:
    def test_a_club_holding_no_row_arrives(self):
        assert replacement(incoming_already_entered=False) is None

    def test_a_club_already_entered_is_refused(self):
        """Kills the mutation that leaves the collision to `uniq_saison_id_team_id`, which answers a duplicate-key error instead."""

        refusal = replacement(incoming_already_entered=True)

        assert refusal is not None
        assert refusal.error_code == REPLACE_INCOMING_ALREADY_ENTERED


class TestARetiredClubDoesNotArrive:
    def test_a_club_still_in_the_league_arrives(self):
        assert replacement(incoming_inactive_since=None) is None

    def test_a_club_that_left_the_league_is_refused_under_the_entry_code(self):
        """One home for the rule: a replacement brings a club into a season, so it is the gate `post_saison_team` already names."""

        refusal = replacement(incoming_inactive_since="2026-02-01")

        assert refusal is not None
        assert refusal.error_code == CLUB_RETIRED
        assert "2026-02-01" in refusal.message


class TestTheOrderOfTheArmsIsTheArgument:
    def test_a_finished_season_outranks_the_outgoing_clubs_record(self):
        """Both terminal, and the season is the wider statement: it refuses every replacement, not this pairing."""

        refusal = replacement(saison_status="past", fixtures_with_a_record=2)

        assert refusal is not None
        assert refusal.error_code == REPLACE_SAISON_FINISHED

    @pytest.mark.parametrize(
        ("terminal", "expected"),
        [({"saison_status": "past"}, REPLACE_SAISON_FINISHED), ({"fixtures_with_a_record": 1}, REPLACE_OUTGOING_HAS_A_RECORD)],
    )
    def test_a_terminal_refusal_outranks_reactivating_the_incoming_club(self, terminal, expected):
        """The point of the order: nobody should reactivate a club for a replacement that was never going to happen."""

        refusal = replacement(**terminal, incoming_inactive_since="2026-02-01")

        assert refusal is not None
        assert refusal.error_code == expected

    def test_the_leagues_question_outranks_the_seasons(self):
        """A club that has left the LEAGUE is a candidate for no season, so picking another one would not repair it."""

        refusal = replacement(incoming_inactive_since="2026-02-01", incoming_already_entered=True)

        assert refusal is not None
        assert refusal.error_code == CLUB_RETIRED


class TestWhatCountsAsARecord:
    """`has_taken_place`, whose subject is the FIXTURE: a goal count on either side is a record whoever put it there."""

    def test_a_drawn_fixture_nobody_played_holds_none(self):
        assert has_taken_place(fixture()) is False

    def test_a_result_is_a_record(self):
        assert has_taken_place(fixture(ergebnis="2:1")) is True

    @pytest.mark.parametrize("sonderereignis", SONDEREREIGNIS_PRODUCING_A_RECORD)
    def test_every_record_producing_event_counts(self, sonderereignis):
        """Read off the constant, so an event added to it cannot slip past this rule while the suite stays green."""

        assert has_taken_place(fixture(sonderereignis=sonderereignis)) is True

    @pytest.mark.parametrize("sonderereignis", SONDEREREIGNIS_WITHOUT_A_RESULT)
    def test_a_fixture_called_off_or_struck_out_holds_none(self, sonderereignis):
        """Kills the mutation trusting `REQ-SWAP-002`/`-004`'s summaries: `ausgefallen` reads as "called off" there and leaves NO record."""

        assert has_taken_place(fixture(sonderereignis=sonderereignis)) is False

    @pytest.mark.parametrize("slot", ["team1", "team2"])
    def test_a_goal_count_without_a_result_is_a_record(self, slot):
        """The hand-edited shape: nothing refuses a `tore` with no `ergebnis`, and moving it would credit another club with the goals."""

        assert has_taken_place(fixture(**{slot: {"tore": 0}})) is True

    def test_an_empty_bracket_slot_does_not_raise(self):
        """A knockout fixture carries a null side until the bracket resolves, and the outgoing club can stand opposite one."""

        assert has_taken_place(fixture(team2=None)) is False
