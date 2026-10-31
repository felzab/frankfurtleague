from collections.abc import Mapping, Sequence
from http import HTTPStatus
from typing import Any

from app.api.spiele.schemas import unplayed_filter
from app.core.codes import Code
from app.core.exceptions import WriteRefusal


def build_unplayed_booking_filter(spielort_id: Any) -> Mapping[str, Any]:
    """Named in the slice rather than spelled at its one call, as the referee's twin is.

    One spelling of the partition for the retirement's refusal and for any later reader of it
    (`app/api/schiedsrichter/services.py :: build_unplayed_assignment_filter`).
    """

    return {"ort.spielort_id": spielort_id, **unplayed_filter()}


def find_venue_retire_refusal(*, upcoming_spiel_nrs: Sequence[int]) -> WriteRefusal | None:
    """Why retiring this venue must be refused, or `None`.

    `upcoming_spiel_nrs` is `unplayed_spiel_nrs`'s definition, so the two rules cannot disagree
    about what is still to come.
    """

    if not upcoming_spiel_nrs:
        return None

    return WriteRefusal(
        error_code=Code.SPIELORT_STILL_BOOKED,
        status=HTTPStatus.CONFLICT,
    )
