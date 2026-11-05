from collections.abc import Mapping
from http import HTTPStatus
from typing import Any

from app.core.codes import Code
from app.core.exceptions import WriteRefusal
from app.shared.age import whole_years_between
from app.shared.einwilligung_evidence import is_given
from app.shared.schemas.bounds import MEDIA_MIN_AGE_YEARS


def media_offered(*, geburtsdatum: Any, today: str) -> bool:
    """Whether this person may switch the media consent on: their birthdate reaches `MEDIA_MIN_AGE_YEARS` today.

    Fails CLOSED on a null or unreadable date.
    """

    if not isinstance(geburtsdatum, str):
        return False

    try:
        return whole_years_between(born=geburtsdatum, today=today) >= MEDIA_MIN_AGE_YEARS
    except ValueError:
        return False


def find_self_media_refusal(*, saved: Any, media: bool, geburtsdatum: Any, today: str) -> WriteRefusal | None:
    """Why a media consent moving to `true` is refused, judged on the birthdate the write leaves.

    Only a move off the stored block is judged, so a resent `true` never blocks the other switch; a
    confirmation passes `None`.
    """

    state_given = isinstance(saved, Mapping) and is_given("media", saved.get("media"))
    if not media or state_given or media_offered(geburtsdatum=geburtsdatum, today=today):
        return None

    return WriteRefusal(
        error_code=Code.MEDIA_AGE,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        fields=(("media",),),
    )
