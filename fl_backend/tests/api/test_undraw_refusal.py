from app.api.saisons.services import SPIELPLAN_UNDRAW_OUTSIDE_ITS_WINDOW, find_undraw_refusal
from app.core.exceptions import WriteRefusal


def refusal_for(*, saison_status: str = "future", recorded: int = 0) -> WriteRefusal | None:
    return find_undraw_refusal(saison_status=saison_status, recorded_fixtures=recorded)


class TestASeasonThatMayBeUndrawn:
    """The one shape that passes, so each refusal below is shown to need its own reason.

    Nothing here says whether the season is drawn: the rule reads the OPERATION, so a season already
    undrawn is judged by the same two answers and removes nothing.
    """

    def test_a_planned_season_with_nothing_recorded_is_permitted(self):
        assert refusal_for() is None


class TestAnUndrawRunsOnlyInsideItsWindow:
    """`REQ-SPIELPLAN-006`, both halves under one code: `future`, and nothing recorded.

    The replace's window (`REQ-SPIELPLAN-005`), because the two destroy the same thing -- one class,
    because `Rule.tested_by` cites one.
    """

    def test_a_running_season_is_refused(self):
        """Widen the window to `!= "past"` and this fails: an active league would lose the schedule it is playing."""

        refusal = refusal_for(saison_status="active")

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_UNDRAW_OUTSIDE_ITS_WINDOW

    def test_a_finished_season_is_refused(self):
        """Its table is the record of what happened, and the fixtures the table is scored from are what this would remove."""

        refusal = refusal_for(saison_status="past")

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_UNDRAW_OUTSIDE_ITS_WINDOW

    def test_one_fixture_carrying_a_record_is_refused(self):
        """Drop the `recorded_fixtures` half and this fails: a result, a cancellation, a booking or a note would be destroyed."""

        refusal = refusal_for(recorded=1)

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_UNDRAW_OUTSIDE_ITS_WINDOW

    def test_the_message_names_the_status_and_how_many_fixtures_hold_a_record(self):
        """A bare code sends an admin to the database; both halves are what say which one closed the window."""

        refusal = refusal_for(saison_status="active", recorded=3)

        assert refusal is not None
        assert "active" in refusal.message
        assert "3 fixture(s)" in refusal.message

    def test_the_message_names_the_repair_rather_than_the_rule(self):
        """The refusal is the admin's answer and the log line alike, so it states the window in words."""

        refusal = refusal_for(saison_status="past")

        assert refusal is not None
        assert "it runs only on a planned season with nothing entered against it" in refusal.message
