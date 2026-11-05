"""
API · the one `confirmation_age` refusal three consent pages answer

One code takes one phrase, which names the range from the bounds its refusal carries, so every page raising it carries
them: a raise without them words the field with the unexpected line, which nothing else reports.
"""

from collections.abc import Callable

import pytest

from app.api.bewerbungen.services import find_alter_refusal as find_contact_age_refusal
from app.api.registrierungen.services import find_alter_refusal as find_pupil_age_refusal
from app.api.schiedsrichter.services import find_alter_refusal as find_referee_age_refusal
from app.core.codes import Code
from app.core.exceptions import WriteRefusal
from app.shared.schemas.bounds import BEWERBUNG_KONTAKT_MAX_AGE_YEARS, REGISTRIERUNG_MIN_AGE_YEARS, SCHIEDSRICHTER_MIN_AGE_YEARS

TODAY = "2026-04-01"
# A contact seat's floor is the caller's, the highest of the seats a person holds.
CONTACT_FLOOR = 18


@pytest.mark.parametrize(
    ("judge", "floor"),
    [
        (lambda geburtsdatum: find_contact_age_refusal(geburtsdatum=geburtsdatum, today=TODAY, minimum_age=CONTACT_FLOOR), CONTACT_FLOOR),
        (lambda geburtsdatum: find_pupil_age_refusal(geburtsdatum=geburtsdatum, today=TODAY), REGISTRIERUNG_MIN_AGE_YEARS),
        (lambda geburtsdatum: find_referee_age_refusal(geburtsdatum=geburtsdatum, today=TODAY), SCHIEDSRICHTER_MIN_AGE_YEARS),
    ],
    ids=["contact", "pupil", "referee"],
)
@pytest.mark.parametrize("geburtsdatum", ["2018-01-01", "1900-01-01"], ids=["under_the_floor", "over_the_ceiling"])
def test_every_raise_carries_the_range_its_page_serves(judge: Callable[[str], WriteRefusal | None], floor: int, geburtsdatum: str):
    """Without the bounds, or with a floor other than the one the page served, the birthdate's message is wrong or missing."""

    refusal = judge(geburtsdatum)

    assert refusal is not None
    assert (refusal.error_code, refusal.fields, refusal.bounds) == (
        Code.CONFIRMATION_AGE,
        (("geburtsdatum",),),
        {"min": floor, "max": BEWERBUNG_KONTAKT_MAX_AGE_YEARS},
    )
