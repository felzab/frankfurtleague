from fastapi import APIRouter, Depends

from app.api.berechtigungen.guard import verify_actor_is_admin
from app.api.saisons.overview import SPIELE_AS, FLSaisonOverviewResponse, build_overview_pipeline, overview_of
from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.crud import bracket_faults_of
from app.api.spiele.schemas import FLSpielJoinedInternalListAdapter
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db
from app.core.dependencies import (
    SaisonsReadCollection,
    SchiedsrichterReadCollection,
    SpieleReadCollection,
    SpielorteReadCollection,
    TeamsReadCollection,
    get_german_date_str,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.security import bind_actor, verify_access_admin

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/saisons",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


@router.get("/{saison_id}/overview", response_model=FLSaisonOverviewResponse, summary="One Saison's open work, card by card")
async def get_saison_overview(
    saison_id: str,
    saisons_collection: SaisonsReadCollection,
    spiele_collection: SpieleReadCollection,
    teams_collection: TeamsReadCollection,
    spielorte_collection: SpielorteReadCollection,
    schiedsrichter_collection: SchiedsrichterReadCollection,
    today: str = Depends(get_german_date_str),
) -> FLSaisonOverviewResponse:
    """The administrator's Übersicht for one season: its open work on four cards, every card served, an empty one included.

    In order: `due`, each fixture whose clubs owe their answer past its deadline or by today; `ergebnisse`, each fixture
    played without a result, and each report not adopted as it stands; `dates`, each club's open date proposal, each
    fixture lacking its date, time, venue, referee or, in the knockout stage, a side's club and source, each referee's own
    decline while the slot stays empty, and each fault of the bracket or its bookings; `bewerbungen`, each undecided
    application to play the season. A fixture called off or struck out lacks nothing. Each row carries what its act
    needs: the fixture with its `version`, each open party's confirmation row, a proposal's row and its date and hour.
    Answers 404 for a season that does not exist. Writes nothing.
    """

    read = await aggregate_many_from_db(collection=saisons_collection, pipeline=build_overview_pipeline(saison_id=saison_id, today=today))
    if not read:
        raise DocumentNotFoundError()

    (season,) = read
    # The INTERNAL fixture, which the fault walk needs; every row serves it in the admin shape.
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

    return overview_of(read=season, spiele=spiele, faults=faults, today=today)
