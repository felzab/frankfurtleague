"""
SPIELE · filter and sort construction

Translates `FLSpieleFilterParams` into a Mongo filter document and a sort specification. Pure -- no I/O,
no collection access -- which is what makes the query semantics testable on their own.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `saison_phase="playoffs"` compiles to `!= "gruppenphase"`. It is a query alias and never a stored
    value.
  • `spiel_status` compiles to a date or cancellation filter. Note `ausstehend` is `>= today`, so it
    INCLUDES today -- the frontend's own status derivation excludes it and labels those matches
    `heute`. The two definitions differ deliberately; see the glossary before changing either.
  • `unbekannt` has no branch and therefore filters nothing: passing it returns everything.
  • `team_id` matches either side of the fixture, so it needs `$or` rather than a field equality.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/glossary.md -- spiel_status, for the two definitions side by side
"""

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
        query["$or"] = [
            {"team1.team_id": filters.team_id},
            {"team2.team_id": filters.team_id},
        ]

    return query
