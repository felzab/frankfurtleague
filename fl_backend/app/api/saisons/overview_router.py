from fastapi import APIRouter

from app.api.grants.guard import ADMIN_TIER
from app.api.saisons.overview import SPIELE_AS, FLSaisonOverviewResponse, build_overview_pipeline, overview_of
from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.crud import bracket_faults_of
from app.api.spiele.schemas import FLSpielJoinedInternalListAdapter
from app.core import clock
from app.core.crud import aggregate_many_from_db
from app.core.dependencies import (
    GermanyNow,
    SaisonsReadCollection,
    SchiedsrichterReadCollection,
    SpieleReadCollection,
    SpielorteReadCollection,
    TeamsReadCollection,
)
from app.core.exceptions import DocumentNotFoundError

router = APIRouter(
    prefix="/saisons",
    dependencies=ADMIN_TIER,
)


@router.get("/{saison_id}/overview", summary="One Saison's open work, card by card")
async def get_saison_overview(
    saison_id: str,
    saisons_collection: SaisonsReadCollection,
    spiele_collection: SpieleReadCollection,
    teams_collection: TeamsReadCollection,
    spielorte_collection: SpielorteReadCollection,
    schiedsrichter_collection: SchiedsrichterReadCollection,
    germany_now: GermanyNow,
) -> FLSaisonOverviewResponse:
    """The administrator's Übersicht for one season: its open work on the cards `due`, `ergebnisse`, `dates` and `bewerbungen`.

    Every card is served, an empty one included, and each row carries what its act needs, the fixture with its `version`
    among it.
    """

    read = await aggregate_many_from_db(
        collection=saisons_collection, pipeline=build_overview_pipeline(saison_id=saison_id, today=clock.german_day(germany_now))
    )
    if not read:
        raise DocumentNotFoundError()

    (season,) = read
    # The internal fixture, which the fault walk needs; every row serves it in the admin shape.
    spiele = FLSpielJoinedInternalListAdapter.validate_python(season[SPIELE_AS])
    faults = await bracket_faults_of(
        spiele=spiele,
        rules=FLSaisonRules.model_validate(season["rules"]),
        saison_id=saison_id,
        spiele_collection=spiele_collection,
        teams_collection=teams_collection,
        spielorte_collection=spielorte_collection,
        schiedsrichter_collection=schiedsrichter_collection,
    )

    return overview_of(read=season, spiele=spiele, faults=faults, now=germany_now)
