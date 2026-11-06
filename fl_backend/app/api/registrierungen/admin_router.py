import asyncio

from fastapi import APIRouter, Depends

from app.api.berechtigungen.guard import verify_actor_is_admin
from app.api.registrierungen.schemas import FLRegistrierungAdminRow, FLRegistrierungenAdminListResponse
from app.api.registrierungen.services import REGISTRIERUNG_LIST_FIELDS, SUBMITTED, build_registrierungen_sort, registrierung_ist_bestaetigt
from app.api.teams.crud import pull_saison_team_names
from app.core.config import API_VERSION
from app.core.crud import pull_one_from_db, pull_whole_from_db
from app.core.dependencies import RegistrierungenReadCollection, SaisonsReadCollection, SaisonTeamsReadCollection
from app.core.security import bind_actor, verify_access_admin

# Admin-guarded, not base, as the application's own list is: a registration holds a pupil's name,
# their address and, once they have confirmed, their date of birth (`READ-CONTACT-001`).

# `public_router.py` shares this prefix at base tier and reads no stored registration but the one a
# link it was handed opens.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/registrierungen",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


# Two static segments, matching `GET /saisons/list/admin`.
@router.get("/list/admin", response_model=FLRegistrierungenAdminListResponse, summary="One Saison's pending Registrierungen for its list")
async def get_registrierungen_admin(
    saison_id: str,
    registrierungen_collection: RegistrierungenReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    saisons_collection: SaisonsReadCollection,
) -> FLRegistrierungenAdminListResponse:
    """
    The Registrierungen page in one read: the season's pending rows, newest first, each named and with its club.

    Read whole, as every list but the Protokoll is, the page narrowing what it holds; a declined row waits out its month
    and asks nothing of an administrator. `confirmed` says whether the pupil answered their own link. 404 where no season
    holds that id.
    """

    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])
    rows, team_names = await asyncio.gather(
        pull_whole_from_db(
            collection=registrierungen_collection,
            db_filter={"saison_id": saison_id, "status": SUBMITTED},
            what=f"season {saison_id}'s pending registrations",
            sort_by=build_registrierungen_sort(sort_by="submitted_at", order="desc"),
            # An inclusion: no address, birthdate or token crosses the wire for a list showing none.
            projection=list(REGISTRIERUNG_LIST_FIELDS),
        ),
        pull_saison_team_names(saison_teams_collection=saison_teams_collection, saison_id=saison_id),
    )

    return FLRegistrierungenAdminListResponse(
        registrierungen=[
            FLRegistrierungAdminRow.model_validate(
                {
                    **row,
                    "id": row["_id"],
                    "team_name": team_names.get(row["team_id"]),
                    "confirmed": registrierung_ist_bestaetigt(einwilligung=row.get("einwilligung")),
                }
            )
            for row in rows
        ]
    )
