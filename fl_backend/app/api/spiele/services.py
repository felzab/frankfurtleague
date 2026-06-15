from typing import Any

from app.api.spiele.schemas import FLSpieleFilterParams


def build_spiele_sort(sort_by: str, order: str) -> list[tuple[str, int]]:
    direction = 1 if order == "asc" else -1

    if sort_by == "datum":
        return [("datum", direction), ("spiel_nr", 1)]
    elif sort_by == "spiel_nr":
        return [("spiel_nr", direction), ("datum", 1)]
    else:
        return [(sort_by, direction), ("datum", direction), ("spiel_nr", 1)]


def build_spiele_filter(filters: FLSpieleFilterParams, today: str) -> dict[str, Any]:
    query = filters.model_dump(include={"saison_id", "saison_phase"}, exclude_none=True)

    # Phase
    if filters.saison_phase == "playoffs":
        query["saison_phase"] = {"$ne": "gruppenphase"}

    # Status
    match filters.spiel_status:
        case "heute":
            query["datum"] = today
        case "vergangen":
            query["datum"] = {"$lt": today}
        case "ausstehend":
            query["datum"] = {"$gte": today}
        case "abgesagt":
            query["is_canceled"] = True

    if filters.team_id is not None:
        query["$or"] = [{"team1.team_id": filters.team_id}, {"team2.team_id": filters.team_id}]

    return query
