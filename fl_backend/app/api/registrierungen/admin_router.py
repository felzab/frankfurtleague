from typing import Annotated

from fastapi import APIRouter, Query

from app.api.grants.guard import ADMIN_TIER
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
from app.core.concurrency import concurrently
from app.core.crud import pull_many_from_db, pull_one_from_db
from app.core.dependencies import RegistrierungenReadCollection, SaisonsReadCollection, SaisonTeamsReadCollection
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT

# Admin-guarded, not base, as the application's own list is: a registration holds a pupil's name,
# their address and, once they have confirmed, their date of birth.

# The public router shares this prefix at base tier and reads no stored registration but the one a
# link it was handed opens.
router = APIRouter(
    prefix="/registrierungen",
    dependencies=ADMIN_TIER,
)


FLRegistrierungenAdminFilters = Annotated[FLRegistrierungenAdminFilterParams, Query()]


# Two static segments, matching `GET /saisons/list/admin`.
@router.get("/list/admin", summary="One Saison's pending Registrierungen for its list")
async def get_registrierungen_admin(
    registrierungen_collection: RegistrierungenReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    saisons_collection: SaisonsReadCollection,
    filters: FLRegistrierungenAdminFilters,
) -> FLRegistrierungenAdminListResponse:
    """One season's pending registrations, newest first, each with its club and whether its pupil confirmed it.

    `unmailed` marks a row owed no mail, its mailbox already holding the most open links, and `complete` says whether
    the read's cap cut the list.
    """

    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": filters.saison_id}, projection=["_id"])
    read, team_names = await concurrently(
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
            # Sliced before validation, so the probe row is never parsed and never reaches the wire. Cut rather than
            # refused: anybody a team's link reached writes these rows, and a refusal would hand them the power to fail
            # this page.
            for row in read[:LIST_LIMIT_DEFAULT]
        ],
        complete=len(read) <= LIST_LIMIT_DEFAULT,
    )
