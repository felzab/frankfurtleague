from collections.abc import Mapping
from http import HTTPStatus
from typing import Any, Final, TypeGuard

from app.core.codes import Code
from app.core.exceptions import FieldFault
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


def seat_is_confirmed(person: Mapping[str, Any] | None) -> TypeGuard[Mapping[str, Any]]:
    """Whether a contact seat's stored person has confirmed it; an emptied seat holds null and confirms nothing."""

    # `TypeGuard` rather than `TypeIs`: a false answer may still be a person, one who has not confirmed.
    return isinstance(person, Mapping) and is_confirmed(person.get("einwilligung"))


# Whether a base-tier read may serve a person's name: their record present, its scope `kader_public` and its
# confirmation stamped. Failing closed, so a scope no enum holds withholds too. Shared so no two reads judge a name
# apart, and by `$type`, as an absent key and a stored null are one state.
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


def find_self_media_refusal(*, saved: Any, media: bool, birth_date: Any, today: str) -> FieldFault | None:
    """Why a media consent moving to `true` is refused, judged on the birthdate the write leaves.

    Only a move off the stored block is judged, so a resent `true` never blocks the other switch. `min` is the age the
    consent opens at, which the switch's phrase names.
    """

    state_given = isinstance(saved, Mapping) and is_given("media", saved.get("media"))
    if not media or state_given or media_offered(birth_date=birth_date, today=today):
        return None

    return FieldFault(path=("media",), code=Code.MEDIA_AGE, status=HTTPStatus.UNPROCESSABLE_CONTENT, bounds={"min": MEDIA_MIN_AGE_YEARS})
