from typing import Any

from app.api.spieler.schemas import FLSpielerFilterParams


def build_spieler_sort(sort_by: str, order: str) -> list[tuple[str, int]]:
    direction = 1 if order == "asc" else -1

    if sort_by == "vorname":
        return [("vorname", direction), ("nachname", 1)]
    elif sort_by == "nachname":
        return [("nachname", direction), ("vorname", 1)]
    else:
        return [(sort_by, direction), ("vorname", direction), ("nachname", 1)]


def build_spieler_filter(filters: FLSpielerFilterParams) -> dict[str, Any]:
    query = filters.model_dump(include={"saison_id", "is_nachgetragen", "stufe"}, exclude_none=True)

    if filters.team_id is not None:
        query["team_id"] = filters.team_id

    return query
