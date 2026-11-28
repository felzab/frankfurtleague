from typing import Annotated

from fastapi import APIRouter, Query
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.grants.guard import ADMIN_TIER
from app.api.spiele.crud import (
    SpielSaveCollections,
    preview_spiel_save,
    save_spiel_in_session,
)
from app.api.spiele.editor import FLSpieleAdminSingleResponse, read_spiel_editor
from app.api.spiele.schemas import (
    FLPatchSpielDataPayload,
    FLPatchSpielDataResponse,
)
from app.api.spiele.services import (
    build_spiele_pipeline,
)
from app.api.spieltage.schemas import FLSpieleSpielplanAdminResponse
from app.api.spieltage.services import build_admin_spielplan, current_spieltag_id
from app.core.concurrency import concurrently
from app.core.crud import aggregate_many_from_db, pull_many_from_db, pull_one_from_db
from app.core.dependencies import (
    AufstellungenCollection,
    AufstellungenReadCollection,
    DBClient,
    GermanyNow,
    SaisonsCollection,
    SaisonsReadCollection,
    SaisonTeamsCollection,
    SaisonTeamsReadCollection,
    SchiedsrichterCollection,
    SchiedsrichterReadCollection,
    SnapshotSession,
    SpielberichteCollection,
    SpielberichteReadCollection,
    SpielbestaetigungenReadCollection,
    SpieleCollection,
    SpieleReadCollection,
    SpielerReadCollection,
    SpielorteCollection,
    SpielorteReadCollection,
    SpieltageCollection,
    SpieltageReadCollection,
    TeamsCollection,
)
from app.core.routing import SAFE_WHEN, by_id
from app.core.transactions import transact
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.custom import CustomObjectId

router = APIRouter(
    prefix="/spiele",
    dependencies=ADMIN_TIER,
)


@router.get(
    "",
    summary="One Saison's Spiele by matchday, for the admin Spiele list",
)
async def get_spiele_spielplan(
    saison_id: Annotated[str, Query(description="The season whose matchdays and knockout rounds the list shows")],
    saisons_collection: SaisonsReadCollection,
    spieltage_collection: SpieltageReadCollection,
    spiele_collection: SpieleReadCollection,
) -> FLSpieleSpielplanAdminResponse:
    """
    Every matchday and knockout round of one season, a planned one included, its matches in the admin shape, in play order.

    `current_spieltag_id` is the matchday to open on: the first holding a match still to be played, else the last.
    """

    saison_raw, spieltage_raw, spiele_raw = await concurrently(
        pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"]),
        pull_many_from_db(collection=spieltage_collection, db_filter={"saison_id": saison_id}, limit=LIST_LIMIT_DEFAULT),
        aggregate_many_from_db(collection=spiele_collection, pipeline=build_spiele_pipeline(db_filter={"saison_id": saison_id})),
    )

    spieltage = build_admin_spielplan(spieltage_raw, spiele_raw)

    return FLSpieleSpielplanAdminResponse(
        spieltage=spieltage, current_spieltag_id=current_spieltag_id(spieltage, saison_status=saison_raw["status"])
    )


@router.get(
    by_id("spiel_id"),
    summary="One Spiel and all the match editor offers and shows beside it",
)
async def get_spiel_admin(
    spiel_id: CustomObjectId,
    spiele_collection: SpieleReadCollection,
    saisons_collection: SaisonsReadCollection,
    spielorte_collection: SpielorteReadCollection,
    schiedsrichter_collection: SchiedsrichterReadCollection,
    spieler_collection: SpielerReadCollection,
    spielberichte_collection: SpielberichteReadCollection,
    spielbestaetigungen_collection: SpielbestaetigungenReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    aufstellungen_collection: AufstellungenReadCollection,
    germany_now: GermanyNow,
) -> FLSpieleAdminSingleResponse:
    """
    The match editor's one read: the fixture in the admin shape, money and `version` included, and its season's status.

    Beside it come the venues and referees to book, the clubs a knockout fixture may field, and the fixture's report,
    confirmation rows and line-up counts.
    """

    return await read_spiel_editor(
        spiel_id=spiel_id,
        spiele_collection=spiele_collection,
        saisons_collection=saisons_collection,
        spielorte_collection=spielorte_collection,
        schiedsrichter_collection=schiedsrichter_collection,
        spieler_collection=spieler_collection,
        spielberichte_collection=spielberichte_collection,
        spielbestaetigungen_collection=spielbestaetigungen_collection,
        saison_teams_collection=saison_teams_collection,
        aufstellungen_collection=aufstellungen_collection,
        now=germany_now,
    )


@router.patch(
    by_id("spiel_id"),
    summary="Update a Spiel",
    openapi_extra=SAFE_WHEN,
)
async def patch_spiel(
    spiel_id: CustomObjectId,
    spiel_data: FLPatchSpielDataPayload,
    db: DBClient,
    spiele_collection: SpieleCollection,
    teams_collection: TeamsCollection,
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spieltage_collection: SpieltageCollection,
    spielorte_collection: SpielorteCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    spielberichte_collection: SpielberichteCollection,
    aufstellungen_collection: AufstellungenCollection,
    # Read on a `dry_run` alone, for whom the confirmation pass would mail of the save.
    spielbestaetigungen_collection: SpielbestaetigungenReadCollection,
    session: SnapshotSession,
    germany_now: GermanyNow,
    adopts_bericht: Annotated[
        int | None,
        Query(ge=0, description="The `version` of the fixture's Spielbericht the editor was seeded from, to stamp it adopted"),
    ] = None,
    dry_run: Annotated[bool, Query(description="Report what this payload would move and destroy, and write nothing")] = False,
) -> FLPatchSpielDataResponse:
    """
    Save one Spiel wholesale and resolve the season's bracket, answering every fixture the save moved beyond it.

    A save storing what stands, where the bracket's resolution would move nothing either, writes no fixture and raises
    no `version`: with `adopts_bericht` it stamps the Spielbericht alone, and it is refused where that stamp matches
    nothing. A `dry_run` writes nothing and answers the same report, with the parties the confirmation pass would mail and the
    later results the save would delete, which the save's `voided_ergebnisse` must name back.
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
        aufstellungen=aufstellungen_collection,
    )

    if dry_run:
        return await preview_spiel_save(
            spiel_id=spiel_id,
            payload=spiel_data,
            collections=collections,
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            now=germany_now,
            session=session,
        )

    async def write_and_resolve_the_bracket(session: AsyncClientSession) -> FLPatchSpielDataResponse:
        return await save_spiel_in_session(
            spiel_id=spiel_id, payload=spiel_data, collections=collections, adopts_bericht=adopts_bericht, now=germany_now, session=session
        )

    # `transact` rather than a bare `start_transaction`: two saves in one season can
    # write-conflict on the same advanced fixture.
    return await transact(db, write_and_resolve_the_bracket)
