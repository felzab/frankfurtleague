from typing import Any, Sequence

from app.api.spielorte.schemas import FLSpielorteFilterParams
from app.core.exceptions import WriteRefusal


def build_spielorte_sort(sort_by: str, order: str) -> list[tuple[str, int]]:
    direction = 1 if order == "asc" else -1

    return [(sort_by, direction)]


def build_spielorte_filter(filters: FLSpielorteFilterParams) -> dict[str, Any]:
    query: dict[str, Any] = {}

    # `inactive_since` is required and carries null while the venue is live, so this is equality.
    if not filters.include_inactive:
        query["inactive_since"] = None

    return query


# A played fixture never blocks: its `ort` is an embedded record.
VENUE_STILL_BOOKED = "REQ-RETIRE-003"


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
        message=f"{len(upcoming_spiel_nrs)} unplayed fixture(s) are booked here (spiel_nr {named}{rest}); "
        "move them to another venue or cancel them first",
    )
