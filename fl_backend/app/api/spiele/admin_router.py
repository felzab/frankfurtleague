from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Query
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.berechtigungen.guard import verify_actor_is_admin
from app.api.saisons.crud import pull_active_saison_id
from app.api.spiele.crud import (
    SpielSaveCollections,
    preview_spiel_save,
    save_spiel_in_session,
)
from app.api.spiele.editor import FLSpieleAdminSingleResponse, read_spiel_editor
from app.api.spiele.schemas import (
    FLPatchSpielDataPayload,
    FLPatchSpielDataResponse,
    FLSpieleAdminListResponse,
    FLSpieleFilterParams,
    FLSpielJoinedAdminListAdapter,
)
from app.api.spiele.services import (
    build_spiele_filter,
    build_spiele_pipeline,
    build_spiele_sort,
)
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db
from app.core.dependencies import (
    DBClient,
    OutboxCollection,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielberichteCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
    SpielerCollection,
    SpielorteCollection,
    SpieltageCollection,
    TeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.routing import SAFE_WHEN, by_id
from app.core.security import bind_actor, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spiele",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


# Two static segments, matching `GET /saisons/list/verwaltung`. Declared before `{spiel_id}/verwaltung`, whose
# only separation from this path is the `objectid` convertor.
@router.get(
    "/list/verwaltung",
    response_model=FLSpieleAdminListResponse,
    summary="Spiele for the admin surfaces",
)
async def get_spiele_verwaltung(
    spiele_collection: SpieleCollection,
    saisons_collection: SaisonsCollection,
    filters: FLSpieleFilterParams = Depends(),
    today: str = Depends(get_german_date_str),
) -> FLSpieleAdminListResponse:
    """
    List one season's Spiele, the active one's unless `saison_id` names another, a planned season's included, in the admin shape.

    Each referee carries their whole name, and each booking its money.
    """

    # No base-tier season gate: emptying the planned season is the one thing this must not do.
    if filters.saison_id is None:
        filters.saison_id = await pull_active_saison_id(saisons_collection=saisons_collection)

    # The joined pipeline, as the public reads use: a plain `find` drops `austritt`.
    spiele_raw = await aggregate_many_from_db(
        collection=spiele_collection,
        pipeline=build_spiele_pipeline(
            db_filter=build_spiele_filter(filters=filters, today=today),
            sort_by=build_spiele_sort(sort_by=filters.sort_by, order=filters.order),
            limit=filters.limit,
        ),
        limit=filters.limit,
    )

    return FLSpieleAdminListResponse(spiele=FLSpielJoinedAdminListAdapter.validate_python(spiele_raw))


# A static suffix rather than a second `GET /{spiel_id}`: the public router owns that path at this
# same prefix, so whichever router registered first would answer both.
@router.get(
    f"{by_id('spiel_id')}/verwaltung",
    response_model=FLSpieleAdminSingleResponse,
    summary="One Spiel and all the match editor offers and shows beside it",
)
async def get_spiel_verwaltung(
    spiel_id: CustomRouteObjectId,
    spiele_collection: SpieleCollection,
    saisons_collection: SaisonsCollection,
    spielorte_collection: SpielorteCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    spieler_collection: SpielerCollection,
    spielberichte_collection: SpielberichteCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    outbox_collection: OutboxCollection,
) -> FLSpieleAdminSingleResponse:
    """
    The match editor's one read: the fixture in the admin shape, money and `version` included, and its season's status.

    Beside it every live venue and referee to book, the fixture's own where it has retired, each referee saying whether
    they confirmed their entry; the fixture's report as its Spielbericht section shows it, its goals, its proposal and
    the state it reads in, null where none stands; and the fixture's confirmation rows as the confirmations' read serves
    them. `document_not_found` for an id no fixture holds.
    """

    return await read_spiel_editor(
        spiel_id=spiel_id,
        spiele_collection=spiele_collection,
        saisons_collection=saisons_collection,
        spielorte_collection=spielorte_collection,
        schiedsrichter_collection=schiedsrichter_collection,
        saison_spieler_collection=saison_spieler_collection,
        spieler_collection=spieler_collection,
        spielberichte_collection=spielberichte_collection,
        spielbestaetigungen_collection=spielbestaetigungen_collection,
        outbox_collection=outbox_collection,
    )


async def previewing(
    dry_run: Annotated[bool, Query(description="Report what this payload would move and destroy, and write nothing")] = False,
) -> bool:
    return dry_run


@router.patch(
    by_id("spiel_id"),
    response_model=FLPatchSpielDataResponse,
    summary="Update a Spiel",
    openapi_extra=SAFE_WHEN,
)
async def patch_spiel(
    spiel_id: CustomRouteObjectId,
    spiel_data: Annotated[FLPatchSpielDataPayload, Body()],
    db: DBClient,
    spiele_collection: SpieleCollection,
    teams_collection: TeamsCollection,
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spieltage_collection: SpieltageCollection,
    spielorte_collection: SpielorteCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    spielberichte_collection: SpielberichteCollection,
    adopts_bericht: Annotated[
        int | None,
        Query(ge=1, description="The `version` of the fixture's Spielbericht the editor was seeded from, to stamp it adopted"),
    ] = None,
    now: datetime = Depends(get_germany_now),
    dry_run: Annotated[bool, Depends(previewing)] = False,
) -> FLPatchSpielDataResponse:
    """
    Save one Spiel wholesale and resolve the season's bracket, answering every fixture the save moved beyond it.

    The fixture stores no name: every read joins it. With `adopts_bericht` the save also stamps the fixture's Spielbericht
    adopted, where it still stands at that version about the clubs the save leaves; a miss refuses nothing. A
    `dry_run` answers the same report and writes nothing. A `past` season's fixture is refused (`saison_past`), the
    `dry_run` included.
    """

    collections = SpielSaveCollections(
        spiele=spiele_collection,
        teams=teams_collection,
        saisons=saisons_collection,
        saison_teams=saison_teams_collection,
        spieltage=spieltage_collection,
        spielorte=spielorte_collection,
        schiedsrichter=schiedsrichter_collection,
        spielberichte=spielberichte_collection,
    )

    if dry_run:
        return await preview_spiel_save(spiel_id=spiel_id, payload=spiel_data, collections=collections)

    async def write_and_resolve_the_bracket(session: AsyncClientSession) -> FLPatchSpielDataResponse:
        return await save_spiel_in_session(
            spiel_id=spiel_id, payload=spiel_data, collections=collections, adopts_bericht=adopts_bericht, now=now, session=session
        )

    # `with_transaction` rather than a bare `start_transaction`: two saves in one season can
    # write-conflict on the same advanced fixture, and the callback is safe to retry, every pass
    # re-reading what it judges.
    async with transaction_session(db) as session:
        return await session.with_transaction(write_and_resolve_the_bracket)
