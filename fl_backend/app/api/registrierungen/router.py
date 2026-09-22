from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.api.registrierungen.schemas import FLRegistrierungenFilterParams, FLRegistrierungenListResponse, FLRegistrierungListAdapter
from app.api.registrierungen.services import WITHOUT_TOKEN_HASHES, build_registrierungen_sort, registrierung_ist_bestaetigt
from app.core.config import API_VERSION
from app.core.crud import pull_many_from_db
from app.core.dependencies import RegistrierungenCollection
from app.core.security import verify_access_admin

# Admin-guarded, not base, as the application's own list is: a registration holds a pupil's name,
# their address and, once they have confirmed, their date of birth (`READ-CONTACT-001`).

# `public_router.py` and `einwilligung_router.py` share this prefix at base tier and read no stored
# registration but the one a link they were handed opens.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/registrierungen",
    dependencies=[Depends(verify_access_admin)],
)

FLRegistrierungenFilters = Annotated[FLRegistrierungenFilterParams, Query()]


@router.get("", response_model=FLRegistrierungenListResponse, summary="List Registrierungen")
async def get_registrierungen(
    registrierungen_collection: RegistrierungenCollection,
    filters: FLRegistrierungenFilters,
) -> FLRegistrierungenListResponse:
    """
    Every pending registration, newest first, narrowable by season, by team and by status.

    `bestaetigt` says whether the pupil answered their own confirmation link, composed here rather
    than left to the reader: an admission is offered on no registration lacking it.
    `vollstaendig` is false where more rows exist than one read serves.
    """

    # Each term omitted where the request names nothing, so an absent parameter reads as every value
    # rather than as a null to match on.
    db_filter: dict[str, Any] = {
        field: value
        for field, value in (("saison_id", filters.saison_id), ("team_id", filters.team_id), ("status", filters.status))
        if value is not None
    }

    # One row over what is served, and the extra never is: it answers whether the list is whole
    # without a count, and counting the filtered set is the unbounded work this read must not do.

    # The projection keeps the token hashes from crossing the wire at all, where the read model would
    # drop them only after they had.
    read = await pull_many_from_db(
        collection=registrierungen_collection,
        db_filter=db_filter,
        limit=filters.limit + 1,
        sort_by=build_registrierungen_sort(sort_by=filters.sort_by, order=filters.order),
        projection=WITHOUT_TOKEN_HASHES,
    )

    # Sliced before validation, so the probe row is never parsed and never reaches the wire.
    served = read[: filters.limit]

    return FLRegistrierungenListResponse(
        registrierungen=FLRegistrierungListAdapter.validate_python(
            [{**row, "bestaetigt": registrierung_ist_bestaetigt(einwilligung=row.get("einwilligung"))} for row in served]
        ),
        vollstaendig=len(read) <= filters.limit,
    )
