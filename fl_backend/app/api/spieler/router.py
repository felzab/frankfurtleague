from fastapi import APIRouter, Depends

from app.api.saisons.crud import pull_current_saison_id
from app.api.saisons.visibility import saison_is_withheld, withheld_saison_ids
from app.api.spieler.schemas import (
    FLSpielerFilterParams,
    FLSpielerListAdapter,
    FLSpielerListResponse,
    FLSpielerSingleResponse,
)
from app.api.spieler.services import build_spieler_pipeline, public_person
from app.core.config import API_VERSION
from app.core.crud import GERMAN_COLLATION, aggregate_many_from_db, pull_one_from_db
from app.core.dependencies import SaisonsCollection, SpielerCollection
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE
from app.core.routing import by_id
from app.core.security import verify_access_base
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieler",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLSpielerListResponse, summary="List Spieler", responses={404: DOCUMENT_NOT_FOUND_RESPONSE})
async def get_spieler(
    spieler_collection: SpielerCollection,
    saisons_collection: SaisonsCollection,
    filters: FLSpielerFilterParams = Depends(),
) -> FLSpielerListResponse:
    """
    List players, normally one team's squad in one season.

    Naming a `team_id` without a `saison_id` returns that team's squad in the CURRENT season, and 404s
    while no season is active. Naming neither lists every season's players, a season this tier may not
    read adding no row. BASE TIER: a pupil reads back redacted (`READ-PUPIL-001`).

    Both names are `null` where the person's consent record does not publish them (`READ-PUPIL-003`);
    the row keeps its `nummer` and `position`.
    """

    # Resolved here, never as a field default, and only beside a team: a squad is one season's
    # (`saison_spieler`), and a season-less one lists a player once per season they stood in it.
    if filters.saison_id is None and filters.team_id is not None:
        filters.saison_id = await pull_current_saison_id(saisons_collection=saisons_collection)

    # Only where the caller NAMED one: the resolve above answers with the `active` season or 404s.
    elif filters.saison_id is not None:
        # Empty rather than 404, as `GET /spiele` answers it: an id naming no season already lists
        # nothing here, so a refusal would be the one answer confirming a withheld one exists.
        if await saison_is_withheld(saisons_collection=saisons_collection, saison_id=filters.saison_id):
            return FLSpielerListResponse(spieler=[])

    # The other half, and the reason it is a second read: the caller named no season, so the rows
    # have to be narrowed on the whole withheld set. Skipped where one id already answered above.
    withheld = [] if filters.saison_id is not None else await withheld_saison_ids(saisons_collection=saisons_collection)

    pipeline = build_spieler_pipeline(filters=filters, withheld_saison_ids=withheld)
    spieler_raw = await aggregate_many_from_db(collection=spieler_collection, pipeline=pipeline, collation=GERMAN_COLLATION)

    spieler = FLSpielerListAdapter.validate_python(spieler_raw)
    return FLSpielerListResponse(spieler=spieler)


@router.get(by_id("spieler_id"), response_model=FLSpielerSingleResponse, summary="One Spieler", responses={404: DOCUMENT_NOT_FOUND_RESPONSE})
async def get_spieler_by_id(spieler_id: CustomRouteObjectId, spieler_collection: SpielerCollection) -> FLSpielerSingleResponse:
    """
    Return one player -- an id, a forename and an INITIAL, which is all this surface needs.

    Both names are `null` where the person's consent record does not publish them (`READ-PUPIL-003`).

    NOT the flattened squad shape the list returns: those are season-scoped, and picking a season
    here would make the answer depend on a default nobody asked for.
    """

    # An allow-list, as the list read's `$project` is: the whole person is a birthdate, an address
    # and a consent record, and one materialised here to be discarded is one a later edit can serve.
    spieler_raw = await pull_one_from_db(
        collection=spieler_collection,
        db_filter={"_id": spieler_id},
        projection={"vorname": 1, "nachname": 1, "einwilligung": 1},
    )

    # Redacted HERE and whole on the admin echo: the list publishes every pupil's id, so a name
    # left standing on this path would be one dereference away from public.
    served = public_person(
        vorname=spieler_raw.get("vorname"),
        nachname=spieler_raw.get("nachname"),
        einwilligung=spieler_raw.get("einwilligung"),
    )

    return FLSpielerSingleResponse(spieler_id=spieler_raw["_id"], vorname=served.vorname, nachname=served.nachname)
