from collections.abc import Mapping
from typing import Any

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.spielbestaetigungen.schemas import FLSpielbestaetigungTermin
from app.api.spielbestaetigungen.services import AnsetzungLage
from app.api.teams.schemas import KONTAKT_ROLLEN

# --- The LINK's view and answer.

# What a link is judged on from the clubs: the season's name, the exit, the seat's address the ban
# list is asked about, and the names a reason may not hold.
VEREIN_FIELDS: Mapping[str, int] = {
    "team_id": 1,
    "name": 1,
    "austritt": 1,
    **{f"kontakte.{seat}.{part}": 1 for seat in KONTAKT_ROLLEN for part in ("email", "vorname", "nachname")},
}


async def pull_ansetzung_lage(
    *,
    spiele_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    spielbestaetigung_raw: Mapping[str, Any],
    session: AsyncClientSession | None = None,
) -> AnsetzungLage:
    """The fixture whole, and the season rows of the two clubs the row's snapshot names."""

    # `find_one` rather than `pull_one_from_db`'s 404: removing a fixture removes its rows with it in one
    # transaction, so a miss is a broken invariant rather than an answer.
    spiel = await spiele_collection.find_one({"_id": spielbestaetigung_raw["spiel_id"]}, session=session)
    assert spiel is not None, f"spielbestaetigung {spielbestaetigung_raw['_id']} outlived its fixture"

    snapshot = spielbestaetigung_raw["ansetzung"]
    vereine = await saison_teams_collection.find(
        {"saison_id": spielbestaetigung_raw["saison_id"], "team_id": {"$in": [snapshot["team1_id"], snapshot["team2_id"]]}},
        VEREIN_FIELDS,
        session=session,
    ).to_list(length=None)

    return AnsetzungLage(spiel=spiel, vereine=vereine)


async def pull_vorschlag_offen(
    *, spielbestaetigungen_collection: AsyncCollection, spielbestaetigung_raw: Mapping[str, Any]
) -> FLSpielbestaetigungTermin | None:
    """The other club's proposal about this same Ansetzung while its decline stands open, its date and hour alone.

    Open, because a discarded proposal is in front of nobody.
    """

    other = await spielbestaetigungen_collection.find_one(
        {
            "saison_id": spielbestaetigung_raw["saison_id"],
            "spiel_id": spielbestaetigung_raw["spiel_id"],
            "partei.art": "team",
            "partei.team_id": {"$ne": spielbestaetigung_raw["partei"]["team_id"]},
            "ansetzung.stand": spielbestaetigung_raw["ansetzung"]["stand"],
            "antwort.art": "abgelehnt",
            "geschlossen": None,
        },
        projection={"antwort.vorschlag": 1},
    )
    vorschlag = ((other or {}).get("antwort") or {}).get("vorschlag")

    return FLSpielbestaetigungTermin.model_validate(vorschlag) if isinstance(vorschlag, Mapping) else None
