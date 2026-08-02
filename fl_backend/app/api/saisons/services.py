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
    query = filters.model_dump(include={"status"}, exclude_none=True, by_alias=True)

    return query
