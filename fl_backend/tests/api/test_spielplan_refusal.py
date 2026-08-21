from typing import Any, Mapping

import pytest

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.saisons.services import (
    SPIELPLAN_ALREADY_DRAWN,
    SPIELPLAN_GRUPPE_SHORT,
    SPIELPLAN_MATCHDAYS_HELD,
    SPIELPLAN_SAISON_NOT_FUTURE,
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
) -> WriteRefusal | None:
    return find_spielplan_refusal(
        saison_status=saison_status,
        fixtures_drawn=fixtures_drawn,
        spieltage_held=spieltage_held,
        watermark=watermark,
        rules=RULES,
        occupancy_by_gruppe=occupancy,
    )


class TestASeasonReadyToBeDrawn:
    """The one shape that passes, so every refusal below is shown to need its own reason."""

    def test_a_future_season_with_full_groups_and_nothing_drawn_is_permitted(self):
        assert refusal_for() is None

    def test_a_group_holding_more_than_the_rules_ask_is_not_short(self):
        """Over-occupancy is `find_entry_refusal`'s to prevent; this rule reads only the short direction."""

        assert refusal_for(occupancy={**FULL, "A": 7}) is None


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


class TestASeasonThatIsNotFuture:
    """`REQ-SPIELPLAN-003`: entries close while a season is future, and a running season is played against its draw."""

    @pytest.mark.parametrize("status", ["active", "past"])
    def test_a_started_season_refuses_the_draw(self, status):
        refusal = refusal_for(saison_status=status)

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_SAISON_NOT_FUTURE
        assert status in refusal.message


class TestAGroupShortOfTeams:
    """`REQ-SPIELPLAN-004`: every group plays the same round robin, so a short one draws a different count."""

    def test_a_short_group_refuses_the_draw(self):
        refusal = refusal_for(occupancy={**FULL, "B": 4})

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_GRUPPE_SHORT

    def test_every_short_group_is_named_at_once(self):
        """One press, one list: an admin filling them one at a time would meet this refusal per group."""

        refusal = refusal_for(occupancy={"A": 6, "B": 4, "C": 6, "D": 2})

        assert refusal is not None
        assert "gruppe B holds 4 of 6" in refusal.message
        assert "gruppe D holds 2 of 6" in refusal.message

    def test_a_group_the_season_does_not_offer_is_not_counted(self):
        """`offered_gruppen` bounds it: a two-group season is not short because C and D hold nobody."""

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
