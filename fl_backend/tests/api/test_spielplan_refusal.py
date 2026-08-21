from typing import Any, Mapping

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.saisons.services import (
    SPIELPLAN_ALREADY_DRAWN,
    SPIELPLAN_GRUPPEN_OFF_RULES,
    SPIELPLAN_MATCHDAYS_HELD,
    SPIELPLAN_SAISON_FINISHED,
    find_spielplan_refusal,
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
) -> WriteRefusal | None:
    return find_spielplan_refusal(
        saison_status=saison_status,
        fixtures_drawn=fixtures_drawn,
        spieltage_held=spieltage_held,
        watermark=watermark,
        rules=rules,
        occupancy_by_gruppe=occupancy,
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
        )

        assert refusal is None
