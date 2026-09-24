from typing import Any

import pytest

from app.api.bewerbungen.services import window_is_running
from app.api.einladungen.services import registrierungsfenster_laeuft

VON, BIS = "2026-03-01", "2026-04-30"

OPEN_WINDOW: dict[str, Any] = {"offen": True, "von": VON, "bis": BIS}

# A day inside the span, so a case moving one field moves the only thing under test.
INSIDE = "2026-04-01"


def window(**overrides: Any) -> dict[str, Any]:
    return {**OPEN_WINDOW, **overrides}


class TestTheRegistrationWindowsThreeClosedShapes:
    """Each answers false, and each would otherwise raise on a subscript rather than answering.

    The three are what a season can hold short of a readable window: nothing recorded, a stored null
    and a mapping missing a field.
    """

    @pytest.mark.parametrize(
        ("registrierung", "shape"),
        [
            (None, "a season recording no window"),
            ({}, "a mapping holding none of the three fields"),
            ({"offen": True, "von": VON}, "a mapping missing `bis`"),
            ({"von": VON, "bis": BIS}, "a mapping missing `offen`"),
            ("2026-03-01", "a window stored as a bare string"),
        ],
        ids=lambda value: value if isinstance(value, str) else "",
    )
    def test_an_unreadable_window_is_not_running(self, registrierung: Any, shape: str):
        assert registrierungsfenster_laeuft(registrierung=registrierung, today=INSIDE) is False, shape

    def test_a_window_switched_off_is_not_running(self):
        """The second closed shape: the span still covers today, and the flag is the whole answer."""

        assert registrierungsfenster_laeuft(registrierung=window(offen=False), today=INSIDE) is False


class TestBothBoundaryDays:
    """Both ends are compared, and both are INCLUSIVE.

    Span ordering is enforced on the season payload alone, so a stored reversal is reachable and
    each end has to be compared against `today` rather than assumed to follow the other.
    """

    def test_the_first_day_of_the_span_is_inside_it(self):
        assert registrierungsfenster_laeuft(registrierung=window(), today=VON) is True

    def test_the_last_day_of_the_span_is_inside_it(self):
        assert registrierungsfenster_laeuft(registrierung=window(), today=BIS) is True

    def test_the_day_before_the_span_is_outside_it(self):
        assert registrierungsfenster_laeuft(registrierung=window(), today="2026-02-28") is False

    def test_the_day_after_the_span_is_outside_it(self):
        assert registrierungsfenster_laeuft(registrierung=window(), today="2026-05-01") is False

    def test_a_reversed_span_covers_no_day(self):
        """A stored `von` after `bis` is reachable, and comparing one end alone would open the window for ever."""

        assert registrierungsfenster_laeuft(registrierung=window(von=BIS, bis=VON), today=INSIDE) is False


class TestTheTwoWindowPredicatesMeanOneThing:
    """Two blocks read by one rule, run over the same values.

    A change made to one predicate and not the other fails here rather than in a season taking what
    the other flow refuses.
    """

    @pytest.mark.parametrize(
        ("block", "today"),
        [
            (OPEN_WINDOW, VON),
            (OPEN_WINDOW, BIS),
            (OPEN_WINDOW, "2026-02-28"),
            (OPEN_WINDOW, "2026-05-01"),
            ({**OPEN_WINDOW, "offen": False}, INSIDE),
            (None, INSIDE),
            ({"offen": True, "von": VON}, INSIDE),
        ],
    )
    def test_both_predicates_answer_alike(self, block: Any, today: str):
        assert registrierungsfenster_laeuft(registrierung=block, today=today) == window_is_running(bewerbung=block, today=today)
