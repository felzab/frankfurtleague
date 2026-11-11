import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.grants.guard import verify_actor_is_admin
from app.api.registrierungen.schemas import (
    FLRegistrierungAdminRow,
    FLRegistrierungenAdminFilterParams,
    FLRegistrierungenAdminListResponse,
)
from app.api.registrierungen.services import (
    REGISTRIERUNG_LIST_FIELDS,
    SUBMITTED,
    build_registrierungen_sort,
    registrierung_is_confirmed,
    registrierung_was_left_unmailed,
)
from app.api.teams.crud import pull_saison_team_names
from app.core.config import API_VERSION
from app.core.crud import pull_many_from_db, pull_one_from_db
from app.core.dependencies import RegistrierungenReadCollection, SaisonsReadCollection, SaisonTeamsReadCollection
from app.core.security import bind_actor, verify_access_admin
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT

# Admin-guarded, not base, as the application's own list is: a registration holds a pupil's name,
# their address and, once they have confirmed, their date of birth (`READ-CONTACT-001`).

# `public_router.py` shares this prefix at base tier and reads no stored registration but the one a
# link it was handed opens.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/registrierungen",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


FLRegistrierungenAdminFilters = Annotated[FLRegistrierungenAdminFilterParams, Query()]


# Two static segments, matching `GET /saisons/list/admin`.
@router.get("/list/admin", response_model=FLRegistrierungenAdminListResponse, summary="One Saison's pending Registrierungen for its list")
async def get_registrierungen_admin(
    registrierungen_collection: RegistrierungenReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    saisons_collection: SaisonsReadCollection,
    filters: FLRegistrierungenAdminFilters,
) -> FLRegistrierungenAdminListResponse:
    """
    The Registrierungen page in one read: the season's pending rows, newest first, each named and with its club.

    The page narrows what the read holds; a declined row waits out its 14 days and asks nothing of an administrator.
    `confirmed` says whether the pupil answered their own link, `unmailed` whether the row was owed none, its mailbox past
    `OPEN_LINKS_PER_MAILBOX`. 404 where no season holds that id. Degrades rather than
    refusing, as `GET /bewerbungen/list/admin` does: the rows are written through a link anybody it reached can use, so a
    tripwire would hand them the power to 500 this page, and `complete` reports the cut.
    """

    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": filters.saison_id}, projection=["_id"])
    read, team_names = await asyncio.gather(
        pull_many_from_db(
            collection=registrierungen_collection,
            db_filter={"saison_id": filters.saison_id, "status": SUBMITTED},
            limit=LIST_LIMIT_DEFAULT + 1,
            sort_by=build_registrierungen_sort(),
            # An inclusion: no address, birthdate or token crosses the wire for a list showing none.
            projection=list(REGISTRIERUNG_LIST_FIELDS),
        ),
        pull_saison_team_names(saison_teams_collection=saison_teams_collection, saison_id=filters.saison_id),
    )

    return FLRegistrierungenAdminListResponse(
        registrierungen=[
            FLRegistrierungAdminRow.model_validate(
                {
                    **row,
                    "id": row["_id"],
                    "team_name": team_names.get(row["team_id"]),
                    "confirmed": registrierung_is_confirmed(einwilligung=row.get("einwilligung")),
                    "unmailed": registrierung_was_left_unmailed(confirmation=row.get("confirmation")),
                }
            )
            # Sliced before validation, so the probe row is never parsed and never reaches the wire.
            for row in read[:LIST_LIMIT_DEFAULT]
        ],
        complete=len(read) <= LIST_LIMIT_DEFAULT,
    )
