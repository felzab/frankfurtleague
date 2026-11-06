from typing import Any

import pytest

from app.api.bewerbungen.services import saison_nimmt_bewerbungen_an
from app.api.registrierungen.services import saison_nimmt_registrierungen_an
from app.api.saisons.services import entry_is_a_nominee

START, END = "2026-03-01", "2026-04-30"

# A day inside the span, so a case moving one field moves the only thing under test.
INSIDE = "2026-04-01"


class TestTheApplicationWindow:
    """A closed application window taking a submission puts a school in the triage queue the league said it would not take.

    One predicate answers the landing's window, `/window/{saison_id}`, the colour read and the submission: today between
    its two dates, both included, on a season not yet ended.
    """

    WINDOW: dict[str, Any] = {"start": START, "end": END}

    def runs(self, *, bewerbung: Any = WINDOW, today: str = INSIDE, saison_status: str = "future") -> bool:
        return saison_nimmt_bewerbungen_an(saison_status=saison_status, bewerbung=bewerbung, today=today)

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
    """A link running where the league closed it, or shut where a late pupil still has to come through it.

    One predicate answers every `running` a link is shown with and the submission's refusal: the season the site is
    on and its link not paused. The window's `end` closes nothing, it makes a nominee.
    """

    WINDOW: dict[str, Any] = {"open": True, "end": END}

    def runs(self, *, registrierung: Any = WINDOW, saison_status: str = "active") -> bool:
        return saison_nimmt_registrierungen_an(saison_status=saison_status, registrierung=registrierung)

    def test_a_season_not_yet_activated_takes_none(self):
        """The window opens at the activation: a link minted while the season is `future` opens nothing before it."""

        assert self.runs(saison_status="future") is False

    def test_a_season_that_has_ended_takes_none(self):
        """A link minted while the season ran outlives it, and its stored dates alone would still admit."""

        assert self.runs(saison_status="past") is False

    def test_a_paused_link_takes_none(self):
        """The window still runs, and the pause is the whole answer."""

        assert self.runs(registrierung={**self.WINDOW, "open": False}) is False

    def test_a_season_recording_no_window_takes_none(self):
        assert self.runs(registrierung=None) is False


class TestTheNominee:
    """The one verdict the marker, the cap and the link's page read: wrong, a late pupil is capped or an early one marked for good."""

    WINDOW: dict[str, Any] = {"open": True, "end": END}

    def test_the_last_day_of_the_window_is_an_ordinary_entry(self):
        assert entry_is_a_nominee(registrierung=self.WINDOW, day=END) is False

    def test_the_day_after_it_is_a_nominee(self):
        assert entry_is_a_nominee(registrierung=self.WINDOW, day="2026-05-01") is True

    def test_a_season_storing_no_window_never_closes_it(self):
        assert entry_is_a_nominee(registrierung=None, day="2026-05-01") is False
