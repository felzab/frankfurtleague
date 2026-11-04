from fastapi import APIRouter, Depends

from app.api.saisons.visibility import resolve_public_saison
from app.api.teams.schemas import FLTeam, FLTeamsFilterParams, FLTeamSingleFilterParams, FLTeamsSingleResponse
from app.api.teams.services import build_team_pipeline
from app.core.config import API_VERSION
from app.core.crud import GERMAN_COLLATION, aggregate_many_from_db
from app.core.dependencies import SaisonsCollection, TeamsCollection
from app.core.exceptions import DocumentNotFoundError
from app.core.routing import by_id
from app.core.security import verify_access_base
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/teams",
    dependencies=[Depends(verify_access_base)],
)


@router.get(by_id("team_id"), response_model=FLTeamsSingleResponse, summary="One team")
async def get_team(
    team_id: CustomRouteObjectId,
    teams_collection: TeamsCollection,
    saisons_collection: SaisonsCollection,
    filters: FLTeamSingleFilterParams = Depends(),
) -> FLTeamsSingleResponse:
    """One team with its group and its figures in the season the query names, the season the site is on where it names none.

    404 where the team, its row in that season or the season is one this tier may not read.
    """

    # Before the pipeline: the season is what scopes `gruppe` and `statistik`, so a withheld one has
    # to be refused whatever the club.
    saison = await resolve_public_saison(saisons_collection=saisons_collection, saison_id=filters.saison_id)

    # A retired club stays addressable by id: a caller holding one was given it by something.
    pipeline_filters = FLTeamsFilterParams(
        saison_id=saison.id,
        statistik_scope=filters.statistik_scope,
        include_inactive=True,
    )

    teams_raw = await aggregate_many_from_db(
        collection=teams_collection,
        pipeline=build_team_pipeline(filters=pipeline_filters, rules=saison.rules, team_id=team_id),
        collation=GERMAN_COLLATION,
    )
    if not teams_raw:
        raise DocumentNotFoundError()

    return FLTeamsSingleResponse(team=FLTeam.model_validate(teams_raw[0]))
