from typing import Any

import pytest

from app.api.bewerbungen.services import window_is_running
from app.api.einladungen.services import registrierungsfenster_laeuft

START, END = "2026-03-01", "2026-04-30"

OPEN_WINDOW: dict[str, Any] = {"offen": True, "von": START, "end": END}

# A day inside the span, so a case moving one field moves the only thing under test.
INSIDE = "2026-04-01"


def window(**overrides: Any) -> dict[str, Any]:
    return {**OPEN_WINDOW, **overrides}


def as_bewerbung(block: dict[str, Any] | None) -> dict[str, Any] | None:
    """The same window in the application window's shape, which stores its start as `start` where this one says `von`."""

    return None if block is None else {("start" if key == "von" else key): value for key, value in block.items()}


class TestTheRegistrationWindowsTwoClosedShapes:
    def test_a_season_recording_no_window_is_not_running(self):
        assert registrierungsfenster_laeuft(registrierung=None, today=INSIDE) is False

    def test_a_window_switched_off_is_not_running(self):
        """The span still covers today, and the flag is the whole answer."""

        assert registrierungsfenster_laeuft(registrierung=window(offen=False), today=INSIDE) is False


class TestBothBoundaryDays:
    """Both ends are compared, and both are INCLUSIVE.

    Span ordering is enforced on the season payload alone, so a stored reversal is reachable and
    each end has to be compared against `today` rather than assumed to follow the other.
    """

    def test_the_first_day_of_the_span_is_inside_it(self):
        assert registrierungsfenster_laeuft(registrierung=window(), today=START) is True

    def test_the_last_day_of_the_span_is_inside_it(self):
        assert registrierungsfenster_laeuft(registrierung=window(), today=END) is True

    def test_the_day_before_the_span_is_outside_it(self):
        assert registrierungsfenster_laeuft(registrierung=window(), today="2026-02-28") is False

    def test_the_day_after_the_span_is_outside_it(self):
        assert registrierungsfenster_laeuft(registrierung=window(), today="2026-05-01") is False

    def test_a_reversed_span_covers_no_day(self):
        """A stored `von` after `end` is reachable, and comparing one end alone would open the window for ever."""

        assert registrierungsfenster_laeuft(registrierung=window(von=END, end=START), today=INSIDE) is False


class TestTheTwoWindowPredicatesMeanOneThing:
    """Two blocks read by one rule, run over the same values: the shapes a season's write stores, a null among them.

    A change made to one predicate and not the other fails here rather than in a season taking what
    the other flow refuses.
    """

    @pytest.mark.parametrize(
        ("block", "today"),
        [
            (OPEN_WINDOW, START),
            (OPEN_WINDOW, END),
            (OPEN_WINDOW, "2026-02-28"),
            (OPEN_WINDOW, "2026-05-01"),
            ({**OPEN_WINDOW, "offen": False}, INSIDE),
            (None, INSIDE),
        ],
    )
    def test_both_predicates_answer_alike(self, block: Any, today: str):
        assert registrierungsfenster_laeuft(registrierung=block, today=today) == window_is_running(bewerbung=as_bewerbung(block), today=today)
