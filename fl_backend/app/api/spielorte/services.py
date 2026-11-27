from collections.abc import Sequence
from http import HTTPStatus

from app.core.codes import Code
from app.core.exceptions import APIError, FieldFault, Subject
from app.shared.schemas.addresses import FLAddress


def compose_maps_query(name: str, address: FLAddress) -> str:
    """The Google Maps search, derived here so a client can never supply one."""
    return f"{name}, {address.to_string}, Deutschland"


def find_venue_retire_refusal(*, upcoming_spiel_nrs: Sequence[int]) -> APIError | None:
    """Why retiring this venue must be refused, or `None`.

    `upcoming_spiel_nrs` are the fixtures still to be played at it. The refusal names them and their count on the
    path's id, so the administrator is told which fixtures to move first.
    """

    if not upcoming_spiel_nrs:
        return None

    return APIError(
        HTTPStatus.CONFLICT,
        Code.SPIELORT_STILL_BOOKED,
        subject=Subject(
            path=("spielort_id",), location="path", bounds={"spiel_nrs": list(upcoming_spiel_nrs), "count": len(upcoming_spiel_nrs)}
        ),
    )


def find_venue_name_refusal(*, taken: bool) -> FieldFault | None:
    """`duplicate_key` on the name: another venue, a retired one included, holds it.

    Takes the answer rather than the lookup, so the caller's read runs in the caller's transaction.
    The unique index still answers a race between two creates, as `duplicate_key` with no field.
    """

    if not taken:
        return None

    return FieldFault(path=("name",), code=Code.DUPLICATE_KEY, status=HTTPStatus.CONFLICT)
