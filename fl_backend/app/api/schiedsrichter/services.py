"""
SCHIEDSRICHTER · filter and sort construction

Pure translation of `FLSchiedsrichterFilterParams` into a Mongo filter and sort. No I/O.

In practice the frontend always calls the endpoint with no arguments, so these branches are effectively
unexercised -- worth knowing before treating them as tested behaviour.
"""

from typing import Any

from app.api.schiedsrichter.schemas import FLSchiedsrichterFilterParams


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

    # Not part of the dump: `include_inactive` is a switch whose False means "add a filter", so a
    # by-value dump would write `include_inactive: False` into the query as a field to match.
    if not filters.include_inactive:
        query["inactive_since"] = None

    return query
