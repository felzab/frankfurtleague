from typing import Any

import pytest

from app.shared.einwilligung import is_confirmed

STAMP = "2026-02-01"


@pytest.mark.parametrize(
    "einwilligung",
    [None, "2026-02-01", {}, {"bestaetigt_am": None}, {"bestaetigt_am": ""}],
    ids=["null record", "no mapping", "no stamp key", "null stamp", "empty stamp"],
)
def test_every_shape_short_of_a_stamp_is_unconfirmed(einwilligung: Any):
    """The seat's, the pupil's and the referee's shapes together; the empty string is the one a presence test calls stamped."""

    assert is_confirmed(einwilligung) is False


def test_a_stamp_confirms():
    """The control: without it every case above passes on a predicate answering no to everything."""

    assert is_confirmed({"umfang": "kontaktdaten", "bestaetigt_am": STAMP}) is True
