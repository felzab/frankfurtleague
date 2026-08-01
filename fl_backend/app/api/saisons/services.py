"""
SAISONS · filter and sort construction

Pure translation of `FLSaisonsFilterOptions` into a Mongo filter and sort. No I/O.
"""

from typing import Any

from app.api.saisons.schemas import FLSaisonsFilterOptions


def build_saisons_sort(sort_by: str, order: str) -> list[tuple[str, int]]:
    direction = 1 if order == "asc" else -1

    return [(sort_by, direction)]


def build_saisons_filter(filters: FLSaisonsFilterOptions) -> dict[str, Any]:
    # `by_alias`, because the field is `saison_id` but the column is `_id` — it carries
    # `serialization_alias="_id"` and only a by-alias dump applies it. `include` names the *field*,
    # so it must say `saison_id`; naming a key that is not a field (this said `"id"`) is not an
    # error in pydantic, it just matches nothing and drops the filter silently.
    query = filters.model_dump(include={"saison_id", "status"}, exclude_none=True, by_alias=True)

    return query
