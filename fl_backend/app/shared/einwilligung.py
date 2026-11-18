from collections.abc import Mapping
from http import HTTPStatus
from typing import Any, Final

from app.core.codes import Code
from app.core.exceptions import WriteRefusal
from app.shared.age import whole_years_between
from app.shared.einwilligung_evidence import is_given
from app.shared.schemas.bounds import MEDIA_MIN_AGE_YEARS


def is_confirmed(einwilligung: Any) -> bool:
    """Whether a consent record carries its own person's confirmation.

    One judgement for every package, since a copy each lets one grant what another refuses.
    """

    # `confirmed_at` alone: the one key a seat's `Kenntnisnahme` and a person's `Einwilligung` share. A seat's
    # record is null until its person answers.
    return isinstance(einwilligung, Mapping) and einwilligung.get("confirmed_at") is not None


# `name_is_public` as a Mongo expression, kept equal to it, and shared so no two reads judge a name apart. By `$type`,
# as an absent key and a stored null are one state.
NAME_IS_PUBLIC: Final[Mapping[str, Any]] = {
    "$and": [
        {"$eq": [{"$type": "$einwilligung"}, "object"]},
        {"$eq": ["$einwilligung.scope", "kader_public"]},
        {"$eq": [{"$type": "$einwilligung.confirmed_at"}, "string"]},
    ]
}


def media_offered(*, birth_date: Any, today: str) -> bool:
    """Whether this person is old enough today to switch the media consent on, failing closed on a null or unreadable date."""

    if not isinstance(birth_date, str):
        return False

    try:
        return whole_years_between(born=birth_date, today=today) >= MEDIA_MIN_AGE_YEARS
    except ValueError:
        return False


def find_self_media_refusal(*, saved: Any, media: bool, birth_date: Any, today: str) -> WriteRefusal | None:
    """Why a media consent moving to `true` is refused, judged on the birthdate the write leaves.

    Only a move off the stored block is judged, so a resent `true` never blocks the other switch.
    """

    state_given = isinstance(saved, Mapping) and is_given("media", saved.get("media"))
    if not media or state_given or media_offered(birth_date=birth_date, today=today):
        return None

    return WriteRefusal(
        error_code=Code.MEDIA_AGE,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        fields=(("media",),),
    )
