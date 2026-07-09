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

    return query
