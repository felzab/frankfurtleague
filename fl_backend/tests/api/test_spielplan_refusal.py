from typing import Any, Mapping

import pytest

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.saisons.services import (
    SPIELPLAN_ALREADY_DRAWN,
    SPIELPLAN_GRUPPEN_OFF_RULES,
    SPIELPLAN_MATCHDAYS_HELD,
    SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW,
    SPIELPLAN_SAISON_FINISHED,
    find_spielplan_refusal,
    holds_a_recorded_fact,
)
from app.api.teams.schemas import FLGruppenNames
from app.core.exceptions import WriteRefusal

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
    watermark: Mapping[str, Any] | None = None,
    occupancy: Mapping[FLGruppenNames, int] = FULL,
    rules: FLSaisonRules = RULES,
    replace: bool = False,
    recorded: int = 0,
) -> WriteRefusal | None:
    return find_spielplan_refusal(
        saison_status=saison_status,
        fixtures_drawn=fixtures_drawn,
        spieltage_held=spieltage_held,
        watermark=watermark,
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


class TestASeasonAlreadyDrawn:
    """`REQ-SPIELPLAN-001`: the draw is one-way, and the fixtures are what say it has happened."""

    def test_a_stored_fixture_refuses_the_draw(self):
        refusal = refusal_for(fixtures_drawn=1)

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_ALREADY_DRAWN

    def test_the_watermark_names_what_already_exists(self):
        """An admin arriving by a stale tab reads what is there rather than an error code."""

        refusal = refusal_for(fixtures_drawn=67, spieltage_held=8, watermark={"generiert_am": "2026-08-21", "spieltage": 8, "spiele": 67})

        assert refusal is not None
        assert "2026-08-21" in refusal.message
        assert "67" in refusal.message

    def test_a_draw_this_endpoint_did_not_write_is_still_refused(self):
        """The live database holds seasons drawn outside the API: a watermark-only guard would offer to draw over them."""

        refusal = refusal_for(fixtures_drawn=31, spieltage_held=6, watermark=None)

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_ALREADY_DRAWN
        assert "31" in refusal.message

    def test_the_fixtures_are_read_before_the_matchdays(self):
        """Both hold, and naming the draw is more use than naming the rows it hangs on."""

        refusal = refusal_for(fixtures_drawn=67, spieltage_held=8)

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_ALREADY_DRAWN

    def test_a_season_inside_the_replace_window_is_offered_the_replace(self):
        """The remedy exists here, and naming it is what turns a 409 into a next step."""

        refusal = refusal_for(fixtures_drawn=67, spieltage_held=8)

        assert refusal is not None
        assert "a replace is confirmed" in refusal.message

    @pytest.mark.parametrize(
        ("saison_status", "recorded", "why"),
        [
            ("active", 0, "a running season, which `REQ-SPIELPLAN-005` refuses on its status"),
            ("past", 0, "a finished season, refused on its status too"),
            ("future", 1, "a planned season one fixture has already been entered against"),
        ],
    )
    def test_a_season_outside_the_replace_window_is_not_offered_one(self, saison_status: str, recorded: int, why: str):
        """State the remedy unconditionally and this fails: an admin who confirms the replace meets a second 409."""

        refusal = refusal_for(fixtures_drawn=67, spieltage_held=8, saison_status=saison_status, recorded=recorded)

        assert refusal is not None, why
        assert refusal.error_code == SPIELPLAN_ALREADY_DRAWN
        assert "a replace is confirmed" not in refusal.message
        assert "no replace can remove it" in refusal.message


class TestASeasonHoldingMatchdays:
    """`REQ-SPIELPLAN-002`: the draw writes the whole matchday list, so it cannot join one already there."""

    def test_a_matchday_without_fixtures_refuses_the_draw(self):
        refusal = refusal_for(spieltage_held=1)

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_MATCHDAYS_HELD


class TestAFinishedSeason:
    """`REQ-SPIELPLAN-003`: a finished season's table is the record of what happened, and a draw would reopen it."""

    def test_a_past_season_refuses_the_draw(self):
        refusal = refusal_for(saison_status="past")

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_SAISON_FINISHED
        assert "past" in refusal.message

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
        assert refusal.error_code == SPIELPLAN_GRUPPEN_OFF_RULES

    def test_a_group_holding_more_than_the_rules_ask_refuses_the_draw(self):
        """The other direction: a group past `teams_per_group` draws more fixtures than its matchdays account for."""

        refusal = refusal_for(occupancy={**FULL, "A": 7})

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_GRUPPEN_OFF_RULES

    def test_a_group_beyond_the_offered_ones_refuses_the_draw(self):
        """A club in a group the season does not run draws into no round robin at all.

        `REQ-ENTER-002` and `REQ-RULES-002` close the write path to this, so what reaches it is a
        hand-edited row.
        """

        two_groups = RULES.model_copy(update={"number_of_groups": 2})
        refusal = refusal_for(occupancy={"A": 6, "B": 6, "C": 1}, rules=two_groups)

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_GRUPPEN_OFF_RULES

    def test_an_offered_group_nobody_is_entered_into_is_named_as_holding_none(self):
        """A group nobody is entered into is absent from the map rather than present at 0.

        The ordinary state of a season about to be drawn, so reading the map by subscript would turn
        its most frequent refusal into a 500.
        """

        refusal = refusal_for(occupancy={"A": 6, "B": 6})

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_GRUPPEN_OFF_RULES
        assert "gruppe C holds 0 of 6" in refusal.message
        assert "gruppe D holds 0 of 6" in refusal.message

    def test_every_short_group_is_named_at_once(self):
        """One press, one list: an admin filling them one at a time would meet this refusal per group."""

        refusal = refusal_for(occupancy={"A": 6, "B": 4, "C": 6, "D": 2})

        assert refusal is not None
        assert refusal.message.split(";")[0] == "gruppe B holds 4 of 6, gruppe D holds 2 of 6"

    def test_the_message_names_the_group_and_what_it_holds(self):
        """The same sentence the short direction gets, because an admin repairing either reads the same page."""

        refusal = refusal_for(occupancy={"A": 7, "B": 6, "C": 6, "D": 9})

        assert refusal is not None
        assert "gruppe A holds 7 of 6" in refusal.message
        assert "gruppe D holds 9 of 6" in refusal.message

    def test_both_directions_are_reported_by_one_press(self):
        """Repairing a season one refusal at a time is what naming every offending group at once avoids."""

        refusal = refusal_for(occupancy={"A": 7, "B": 4, "C": 6, "D": 6})

        assert refusal is not None
        assert "gruppe A holds 7 of 6" in refusal.message
        assert "gruppe B holds 4 of 6" in refusal.message

    def test_the_message_names_the_group_what_it_holds_and_what_the_season_offers(self):
        """A 500 out of `_squads` names the club and reaches no admin; this is the same fact as an answer to the press."""

        two_groups = RULES.model_copy(update={"number_of_groups": 2})
        refusal = refusal_for(occupancy={"A": 6, "B": 6, "C": 1, "D": 3}, rules=two_groups)

        assert refusal is not None
        assert "gruppe C holds 1 and a season of 2 group(s) does not offer it" in refusal.message
        assert "gruppe D holds 3 and a season of 2 group(s) does not offer it" in refusal.message

    def test_a_stranded_club_is_reported_beside_a_group_off_its_size(self):
        """One question, so one answer: every group the season cannot draw truthfully, in one message."""

        two_groups = RULES.model_copy(update={"number_of_groups": 2})
        refusal = refusal_for(occupancy={"A": 5, "B": 6, "C": 1}, rules=two_groups)

        assert refusal is not None
        assert "gruppe A holds 5 of 6" in refusal.message
        assert "gruppe C holds 1 and a season of 2 group(s) does not offer it" in refusal.message

    def test_the_message_names_every_group_in_one_fixed_order(self):
        """The refusal is the admin's answer and the log line alike, and an order that moves between runs is neither.

        Offered groups in the season's own order, then the stranded ones by name, whatever order the
        occupancy map arrived in.
        """

        two_groups = RULES.model_copy(update={"number_of_groups": 2})
        # Out of name order on purpose: `generate_spielplan` counts rows off a cursor no index sorts.
        refusal = refusal_for(occupancy={"D": 3, "C": 4, "B": 4, "A": 5}, rules=two_groups)

        assert refusal is not None
        assert refusal.message.split(";")[0] == (
            "gruppe A holds 5 of 6, gruppe B holds 4 of 6, "
            "gruppe C holds 4 and a season of 2 group(s) does not offer it, "
            "gruppe D holds 3 and a season of 2 group(s) does not offer it"
        )

    def test_a_group_the_season_does_not_offer_is_not_counted(self):
        """`offered_gruppen` bounds it: a two-group season is not short because C and D are absent from the map."""

        two_groups = RULES.model_copy(update={"number_of_groups": 2})
        refusal = find_spielplan_refusal(
            saison_status="future",
            fixtures_drawn=0,
            spieltage_held=0,
            watermark=None,
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
        assert refusal.error_code == SPIELPLAN_GRUPPEN_OFF_RULES


class TestAReplaceRunsOnlyInsideItsWindow:
    """`REQ-SPIELPLAN-005`, both halves under one code: `future`, and nothing played.

    Asymmetric with `REQ-SPIELPLAN-003`: that one refuses `past` alone, so a running season may be
    drawn a FIRST time on a status the replace is refused on.
    """

    def test_a_confirmed_replace_of_an_undrawn_future_season_is_permitted(self):
        """The control: a rule refusing every confirmed replace would pass every case below."""

        assert refusal_for(replace=True) is None

    def test_a_running_season_is_refused_the_replace_it_would_be_permitted_a_first_draw(self):
        """Widen the window to `!= "past"` and this fails, which is the whole asymmetry with `REQ-SPIELPLAN-003`."""

        refusal = refusal_for(replace=True, saison_status="active", fixtures_drawn=67, spieltage_held=8)

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW

    def test_a_past_season_reads_the_replace_window_rather_than_the_draw_freeze(self):
        """Judge this after `REQ-SPIELPLAN-003` and it fails: an admin who asked to replace reads the whole window, not half of it."""

        refusal = refusal_for(replace=True, saison_status="past", fixtures_drawn=67, spieltage_held=8)

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW

    def test_one_fixture_that_already_happened_refuses_the_replace(self):
        """Drop the `recorded_fixtures` half and this fails: the replace would delete the record of a match that was played."""

        refusal = refusal_for(replace=True, fixtures_drawn=67, spieltage_held=8, recorded=1)

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW

    def test_a_replace_of_a_season_holding_nothing_is_bounded_by_the_window_too(self):
        """Gate the window on there being something to delete and this fails: the flag would then mean a replace here and a first draw there."""

        refusal = refusal_for(replace=True, saison_status="active")

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW

    def test_the_message_names_the_status_and_how_many_fixtures_happened(self):
        """A bare code sends an admin to the database; both halves are what say which one closed the window."""

        refusal = refusal_for(replace=True, saison_status="active", fixtures_drawn=67, spieltage_held=8, recorded=3)

        assert refusal is not None
        assert "active" in refusal.message
        assert "3 fixture(s)" in refusal.message

    def test_an_unconfirmed_draw_is_judged_by_the_draw_rules_alone(self):
        """Read the window off the season rather than off the flag and this fails: a running season's first draw is permitted."""

        refusal = refusal_for(saison_status="active", fixtures_drawn=67, spieltage_held=8)

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_ALREADY_DRAWN


# A fixture exactly as the draw wrote it: every field a record could land in, empty. No `notiz` key
# at all, which is the shape `app/api/saisons/spielplan.py :: _spiel` leaves.
UNTOUCHED_FIXTURE: Mapping[str, Any] = {
    "ergebnis": None,
    "sonderereignis": None,
    "team1": {"tore": None},
    "team2": {"tore": None},
    "ort": {"spielort_id": None},
    "schiedsrichter": {"schiedsrichter_id": None},
}


class TestWhatCountsAsRecordedAgainstAFixture:
    """`holds_a_recorded_fact`, which is what the endpoint counts for `REQ-SPIELPLAN-005`.

    The refusal reads a COUNT, so no test of it reaches this: the window closes on a cancellation
    and on a booking as well as on a result.
    """

    @pytest.mark.parametrize(
        ("recorded", "why"),
        [
            ({"ergebnis": "2:1"}, "a result"),
            ({"sonderereignis": "abgebrochen"}, "an abandonment"),
            ({"sonderereignis": "nichtantreten_team1"}, "a no-show"),
            ({"sonderereignis": "ausgefallen"}, "a cancellation, which `has_taken_place` reads as untouched"),
            ({"sonderereignis": "annulliert"}, "an annulment, for the same reason"),
            ({"team1": {"tore": 0}}, "a goal count standing without a result"),
            ({"team2": {"tore": 0}}, "the same count on the other side, which a loop over one slot would miss"),
            ({"ort": {"spielort_id": "68f0a1b2c3d4e5f607600001"}}, "a booked venue"),
            ({"schiedsrichter": {"schiedsrichter_id": "68f0a1b2c3d4e5f607600002"}}, "a booked referee"),
            ({"notiz": "Platz gesperrt"}, "an admin's note, which only `PATCH /spiele/{spiel_id}` writes"),
        ],
    )
    def test_a_fixture_carrying_one_of_these_closes_the_window(self, recorded: Mapping[str, Any], why: str):
        assert holds_a_recorded_fact({**UNTOUCHED_FIXTURE, **recorded}) is True, why

    def test_a_fixture_the_draw_left_alone_does_not(self):
        """The floor: a predicate answering True for everything would pass every case above."""

        assert holds_a_recorded_fact(UNTOUCHED_FIXTURE) is False

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
