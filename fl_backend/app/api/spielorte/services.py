from collections.abc import Mapping, Sequence
from http import HTTPStatus
from typing import Any

from app.api.spiele.schemas import unplayed_filter
from app.core.exceptions import WriteRefusal

# A played fixture never blocks: its `ort` is an embedded record.
VENUE_STILL_BOOKED = "REQ-RETIRE-003"


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

    named = ", ".join(str(nr) for nr in upcoming_spiel_nrs[:5])
    rest = f" and {len(upcoming_spiel_nrs) - 5} more" if len(upcoming_spiel_nrs) > 5 else ""

    return WriteRefusal(
        error_code=VENUE_STILL_BOOKED,
        status=HTTPStatus.CONFLICT,
        message=f"{len(upcoming_spiel_nrs)} unplayed fixture(s) are booked here (spiel_nr {named}{rest}); "
        "move them to another venue or cancel them first",
    )
