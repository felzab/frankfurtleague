from typing import Any

from app.api.spielorte.schemas import FLSpielorteFilterParams


def build_spielorte_sort(sort_by: str, order: str) -> list[tuple[str, int]]:
    direction = 1 if order == "asc" else -1

    return [(sort_by, direction)]


def build_spielorte_filter(filters: FLSpielorteFilterParams) -> dict[str, Any]:
    query = filters.model_dump(
        include={},
        exclude_none=True,
        by_alias=True,
        context={"keep_oid": True},
    )

    return query
