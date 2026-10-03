from collections.abc import Mapping
from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app.api.identitaet.crud import funktionen_of
from app.api.identitaet.services import find_funktion_refusal, seat_is_confirmed
from app.api.kontakte.services import KONTAKT_SLOTS
from app.api.teams.schemas import FLTeamSitz, FLTeamSitzeResponse
from app.core.config import API_VERSION
from app.core.crud import refuse
from app.core.dependencies import DBClient, SaisonsCollection, SaisonTeamsCollection, SchiedsrichterCollection, SpielerCollection
from app.core.security import PERSON_ACTOR_BINDERS, verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

# The person lane's binder, as `app/api/registrierungen/person_router.py` declares it and for its reason.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/teams",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["kontakt"])],
)

Kontakt = Annotated[str, Depends(PERSON_ACTOR_BINDERS["kontakt"])]


def _as_sitz(kontakte: Mapping[str, Any], slot: str) -> FLTeamSitz:
    person = kontakte.get(slot)
    if not isinstance(person, Mapping):
        return FLTeamSitz.model_validate({"rolle": slot, "name": None, "bestaetigt": False})

    return FLTeamSitz.model_validate(
        {
            "rolle": slot,
            "name": " ".join(str(person.get(field) or "").strip() for field in ("vorname", "nachname")).strip() or None,
            "bestaetigt": seat_is_confirmed({"kontakte": kontakte}, slot),
        }
    )


# `/person/sitze`, its own segment: the admin router serves this team and season under its own paths,
# and `fl_backend/tests/api/test_admin_guard.py` fails at collection on two routes serving one operation.
@router.get("/{team_id:objectid}/saisons/{saison_id}/person/sitze", response_model=FLTeamSitzeResponse, summary="A team's seats in one season")
async def get_team_sitze(
    team_id: CustomRouteObjectId,
    saison_id: str,
    identifier: Kontakt,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    db: DBClient,
) -> FLTeamSitzeResponse:
    """
    The team's three seats in this season, each with its holder's name and whether that person has confirmed it.

    Always three lines, an empty slot answered with no name. No seat's address, telephone number, birthdate or
    confirmation date is served, whoever asks.
    """

    # A snapshot rather than a transaction, for `get_offene_registrierungen`'s reason.
    async with db.start_session(snapshot=True) as session:
        subjekt = await funktionen_of(
            identifier,
            saison_teams_collection=saison_teams_collection,
            saisons_collection=saisons_collection,
            spieler_collection=spieler_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            session=session,
        )
        refuse(find_funktion_refusal(sitze=subjekt.sitze, team_id=team_id, saison_id=saison_id))

        # The seat just judged lives on this row, read in the same snapshot, so it stands and no 404 is owed.
        row = await saison_teams_collection.find_one(
            {"saison_id": saison_id, "team_id": team_id},
            [f"kontakte.{slot}.{field}" for slot in KONTAKT_SLOTS for field in ("vorname", "nachname", "einwilligung.bestaetigt_am")],
            session=session,
        )
        kontakte = (row or {}).get("kontakte") or {}

    return FLTeamSitzeResponse(team_id=team_id, saison_id=saison_id, sitze=[_as_sitz(kontakte, slot) for slot in KONTAKT_SLOTS])
