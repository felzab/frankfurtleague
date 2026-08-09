"""
SPIELORTE · filter and sort construction

Pure translation of `FLSpielorteFilterParams` into a Mongo filter and sort. No I/O.

Soft-deleted venues are excluded unless `include_inactive` asks for them, so an admin list can offer
the retired ones for reactivation while every public read sees only what is live.
"""

from typing import Any, Sequence

from app.api.spielorte.schemas import FLSpielorteFilterParams


def build_spielorte_sort(sort_by: str, order: str) -> list[tuple[str, int]]:
    direction = 1 if order == "asc" else -1

    return [(sort_by, direction)]


def build_spielorte_filter(filters: FLSpielorteFilterParams) -> dict[str, Any]:
    query: dict[str, Any] = {}

    # Matching null rather than testing for absence: `inactive_since` is a REQUIRED field carrying
    # null while the venue is live (ADR-0032), so `{"inactive_since": None}` is an equality test. It
    # would also match a document missing the key entirely, which the validator does not permit.
    if not filters.include_inactive:
        query["inactive_since"] = None

    return query


# =====================================================================================================
# RETIRING IT
# =====================================================================================================
# The venue is still booked for a fixture nobody has played (decided 2026-08-08). Retiring it takes it out
# of every picker while matches are still scheduled there, which is the state the soft delete exists to
# prevent, reached through the soft delete itself -- exactly the reasoning behind `REQ-RETIRE-001` for a
# club, which this endpoint had no equivalent of.
#
# A PLAYED fixture never blocks. Its `ort` is an embedded record of where the match was held (ADR-0028
# rule 2), so the venue document has nothing left to supply.
VENUE_STILL_BOOKED = "REQ-RETIRE-003"


def find_venue_retire_refusal(*, upcoming_spiel_nrs: Sequence[int]) -> tuple[str, str] | None:
    """
    Why retiring this venue must be refused, as `(error_code, detail)` -- or `None`.

    `upcoming_spiel_nrs` is every fixture referencing it that has no result and is not cancelled -- the
    same definition of "not played yet" the rollover gate uses (`unplayed_spiel_nrs`), so the two rules
    cannot disagree about what is still to come.
    """

    if not upcoming_spiel_nrs:
        return None

    named = ", ".join(str(nr) for nr in upcoming_spiel_nrs[:5])
    rest = f" and {len(upcoming_spiel_nrs) - 5} more" if len(upcoming_spiel_nrs) > 5 else ""

    return (
        VENUE_STILL_BOOKED,
        f"{len(upcoming_spiel_nrs)} unplayed fixture(s) are booked here (spiel_nr {named}{rest}); "
        "move them to another venue or cancel them first",
    )
