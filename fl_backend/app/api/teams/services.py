from typing import Any

from app.api.teams.schemas import FLTeamsFilterParams


def build_teams_sort(sort_by: str, order: str) -> list[tuple[str, int]]:
    direction = 1 if order == "asc" else -1

    return [(sort_by, direction)]


def build_teams_filter(filters: FLTeamsFilterParams) -> dict[str, Any]:
    query = filters.model_dump(
        include={"saison_id", "gruppe", "is_placeholder", "is_qualified", "team_id"},
        exclude_none=True,
        by_alias=True,
        context={"keep_oid": True},
    )

    return query
