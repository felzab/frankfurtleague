from typing import Any

import pytest

from app.api.bewerbungen.services import saison_nimmt_bewerbungen_an
from app.api.registrierungen.services import saison_nimmt_registrierungen_an

START, END = "2026-03-01", "2026-04-30"

# A day inside the span, so a case moving one field moves the only thing under test.
INSIDE = "2026-04-01"


class TestTheApplicationWindow:
    """A closed application window taking a submission puts a school in the triage queue the league said it would not take.

    One predicate answers the landing's window, `/window/{saison_id}`, the colour read and the submission, so these
    cases are the whole window rule: today between its two dates, both included, on a season not yet ended.
    """

    WINDOW: dict[str, Any] = {"start": START, "end": END}

    def runs(self, *, bewerbung: Any = WINDOW, today: str = INSIDE, saison_status: str = "future") -> bool:
        return saison_nimmt_bewerbungen_an(saison_status=saison_status, bewerbung=bewerbung, today=today)

    def test_a_day_inside_the_span_takes_applications(self):
        """The floor: without it every refusal below could pass for a reason nobody is testing."""

        assert self.runs() is True

    @pytest.mark.parametrize("today", [START, END], ids=["the first day", "the last day"])
    def test_both_ends_are_inside_the_span(self, today: str):
        """An exclusive comparison drops the day the window opens or the day it closes, which a school was told it had."""

        assert self.runs(today=today) is True

    @pytest.mark.parametrize("today", ["2026-02-28", "2026-05-01"], ids=["the day before", "the day after"])
    def test_a_day_outside_the_span_takes_none(self, today: str):
        assert self.runs(today=today) is False

    def test_a_reversed_span_covers_no_day(self):
        """Span ordering is the payload's alone, so a stored reversal is reachable, and comparing one end would open it for ever."""

        assert self.runs(bewerbung={"start": END, "end": START}) is False

    def test_a_season_recording_no_window_takes_none(self):
        assert self.runs(bewerbung=None) is False

    def test_a_season_that_has_ended_takes_none_while_its_dates_still_run(self):
        """The payload names the season, so a `past` one whose stored span holds today is reachable by the form's own request."""

        assert self.runs(saison_status="past") is False


class TestTheRegistrationWindow:
    """A closed registration window taking a submission enters a pupil in a squad the league closed before play began.

    One predicate answers every `running` a link is shown with and the submission's refusal: the season the site is
    on, its link not paused, today up to the window's `end`, both included.
    """

    WINDOW: dict[str, Any] = {"offen": True, "end": END}

    def runs(self, *, registrierung: Any = WINDOW, today: str = INSIDE, saison_status: str = "active") -> bool:
        return saison_nimmt_registrierungen_an(saison_status=saison_status, registrierung=registrierung, today=today)

    def test_the_active_season_takes_registrations_until_its_end(self):
        """The floor, on the last day too, which an exclusive comparison silently drops."""

        assert self.runs() is True
        assert self.runs(today=END) is True

    def test_the_day_after_the_end_takes_none(self):
        assert self.runs(today="2026-05-01") is False

    def test_a_season_not_yet_activated_takes_none(self):
        """The window opens at the activation: a link minted while the season is `future` opens nothing before it."""

        assert self.runs(saison_status="future") is False

    def test_a_season_that_has_ended_takes_none(self):
        """A link minted while the season ran outlives it, and its stored dates alone would still admit."""

        assert self.runs(saison_status="past") is False

    def test_a_paused_link_takes_none_inside_the_window(self):
        """The window still runs, and the pause is the whole answer."""

        assert self.runs(registrierung={**self.WINDOW, "offen": False}) is False

    def test_a_season_recording_no_window_takes_none(self):
        assert self.runs(registrierung=None) is False
