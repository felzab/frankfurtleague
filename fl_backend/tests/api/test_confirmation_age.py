"""
API · the one `confirmation_age` refusal three consent pages answer

One code takes one phrase, which names the range from the bounds its refusal carries, so every raise carries them: a raise
without them words the field with the unexpected line, which nothing else reports.
"""

import pytest

from app.core.codes import Code
from app.shared.links import find_age_refusal
from app.shared.schemas.bounds import BIRTH_DATE_MAX_AGE_YEARS

TODAY = "2026-04-01"
# The caller's floor, which every page serves beside the ceiling.
FLOOR = 18


@pytest.mark.parametrize("birth_date", ["2018-01-01", "1900-01-01"], ids=["under_the_floor", "over_the_ceiling"])
def test_every_raise_carries_the_range_its_page_serves(birth_date: str):
    """Without the bounds, or with a floor other than the one the caller judged, the birthdate's message is wrong or missing."""

    refusal = find_age_refusal(birth_date=birth_date, today=TODAY, minimum_age=FLOOR)

    assert refusal is not None
    assert (refusal.code, refusal.path, refusal.bounds) == (
        Code.CONFIRMATION_AGE,
        ("birth_date",),
        {"min": FLOOR, "max": BIRTH_DATE_MAX_AGE_YEARS},
    )
