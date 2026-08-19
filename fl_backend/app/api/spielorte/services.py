"""
SPIELORTE · filter and sort construction

Pure translation of `FLSpielorteFilterParams` into a Mongo filter and sort. No I/O.

Soft-deleted venues are excluded unless `include_inactive` asks for them, so an admin list can offer
the retired ones for reactivation while every public read sees only what is live.
"""

from typing import Any, Sequence

from app.api.spielorte.schemas import FLSpielorteFilterParams
from app.core.exceptions import WriteRefusal


def build_spielorte_sort(sort_by: str, order: str) -> list[tuple[str, int]]:
    direction = 1 if order == "asc" else -1

    return [(sort_by, direction)]


def build_spielorte_filter(filters: FLSpielorteFilterParams) -> dict[str, Any]:
    query: dict[str, Any] = {}

    # Matching null rather than testing absence: `inactive_since` is required and carries null while
    # the venue is live, so this is an equality test. It would also match a document missing the key,
    # which the validator forbids.
    if not filters.include_inactive:
        query["inactive_since"] = None

    return query


# The venue is still booked for a fixture nobody has played (decided 2026-08-08). Retiring it takes it
# out of every picker while matches are still scheduled there -- the state the soft delete exists to
# prevent, reached through the soft delete itself.

# A played fixture never blocks: its `ort` is an embedded record of where the match was held, so the
# venue document has nothing left to supply.
VENUE_STILL_BOOKED = "REQ-RETIRE-003"


def find_venue_retire_refusal(*, upcoming_spiel_nrs: Sequence[int]) -> WriteRefusal | None:
    """
    Why retiring this venue must be refused, as a `WriteRefusal` -- or `None`.

    `upcoming_spiel_nrs` is every fixture referencing it that has no result and is not cancelled -- the
    same definition of "not played yet" the rollover gate uses (`unplayed_spiel_nrs`), so the two rules
    cannot disagree about what is still to come.
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
