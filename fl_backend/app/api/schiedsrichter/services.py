from typing import Any, Sequence

from app.api.schiedsrichter.schemas import FLSchiedsrichterFilterParams
from app.core.exceptions import WriteRefusal


def build_schiedsrichter_sort(sort_by: str, order: str) -> list[tuple[str, int]]:
    direction = 1 if order == "asc" else -1

    return [(sort_by, direction)]


def build_schiedsrichter_filter(
    filters: FLSchiedsrichterFilterParams,
) -> dict[str, Any]:
    query = filters.model_dump(
        include={"default_payment"},
        exclude_none=True,
        by_alias=True,
        context={"keep_oid": True},
    )

    # A switch whose False means "add a filter", so a by-value dump would write it into the query as
    # a field to match on.
    if not filters.include_inactive:
        query["inactive_since"] = None

    return query


# A played fixture never blocks: its `schiedsrichter` is a record of who officiated.
REFEREE_STILL_ASSIGNED = "REQ-RETIRE-004"


def find_referee_retire_refusal(*, upcoming_spiel_nrs: Sequence[int]) -> WriteRefusal | None:
    """Why retiring this referee must be refused, or `None`.

    `upcoming_spiel_nrs` is `unplayed_spiel_nrs`'s definition of "still to come".
    """

    if not upcoming_spiel_nrs:
        return None

    named = ", ".join(str(nr) for nr in upcoming_spiel_nrs[:5])
    rest = f" and {len(upcoming_spiel_nrs) - 5} more" if len(upcoming_spiel_nrs) > 5 else ""

    return WriteRefusal(
        error_code=REFEREE_STILL_ASSIGNED,
        message=(
            f"{len(upcoming_spiel_nrs)} unplayed fixture(s) are assigned to them (spiel_nr {named}{rest}); "
            "reassign or cancel those fixtures first"
        ),
    )
