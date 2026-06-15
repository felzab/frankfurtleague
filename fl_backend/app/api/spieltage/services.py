from typing import Any

from app.api.spieltage.schemas import FLSpieltageFilterParams


def build_spieltage_sort(sort_by: str, order: str) -> list[tuple[str, int]]:
    direction = 1 if order == "asc" else -1

    if sort_by == "order_val":
        return [("order_val", direction), ("beginn", 1)]
    elif sort_by == "beginn":
        return [("beginn", direction), ("order_val", 1)]
    else:
        return [(sort_by, direction), ("order_val", 1)]


def build_spieltage_filter(filters: FLSpieltageFilterParams) -> dict[str, Any]:
    query = filters.model_dump(include={"saison_id", "saison_phase"}, exclude_none=True)

    # Phase
    if filters.saison_phase == "playoffs":
        query["saison_phase"] = {"$ne": "gruppenphase"}

    return query
