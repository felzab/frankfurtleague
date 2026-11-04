from collections.abc import Mapping
from http import HTTPStatus
from typing import Any

from app.core.codes import Code
from app.core.exceptions import WriteRefusal
from app.shared.alter import whole_years_between
from app.shared.einwilligung_nachweis import is_given
from app.shared.schemas.bounds import MEDIEN_MIN_AGE_YEARS


def medien_angeboten(*, geburtsdatum: Any, today: str) -> bool:
    """Whether this person may switch the media consent on: their birthdate reaches `MEDIEN_MIN_AGE_YEARS` today.

    Fails CLOSED on a null or unreadable date.
    """

    if not isinstance(geburtsdatum, str):
        return False

    try:
        return whole_years_between(born=geburtsdatum, today=today) >= MEDIEN_MIN_AGE_YEARS
    except ValueError:
        return False


def find_self_medien_refusal(*, gespeichert: Any, medien: bool, geburtsdatum: Any, today: str) -> WriteRefusal | None:
    """Why a media consent moving to `true` is refused, judged on the birthdate the write leaves.

    Only a move off the stored block is judged, so a resent `true` never blocks the other switch; a
    confirmation passes `None`.
    """

    stand_erteilt = isinstance(gespeichert, Mapping) and is_given("medien", gespeichert.get("medien"))
    if not medien or stand_erteilt or medien_angeboten(geburtsdatum=geburtsdatum, today=today):
        return None

    return WriteRefusal(
        error_code=Code.MEDIEN_AGE,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        fields=(("medien",),),
    )
