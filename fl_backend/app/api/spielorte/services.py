"""
SPIELORTE · filter and sort construction

Pure translation of `FLSpielorteFilterParams` into a Mongo filter and sort. No I/O.

Soft-deleted venues are excluded unless `include_inactive` asks for them, so an admin list can offer
the retired ones for reactivation while every public read sees only what is live.
"""

from typing import Any

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
