from fastapi import APIRouter, Depends

from app.api.teams.schemas import (
    FLGruppen,
    FLTeamCompactListAdapter,
    FLTeamListAdapter,
    FLTeamsCompactListResponse,
    FLTeamsFilterParams,
    FLTeamsGruppenResponse,
    FLTeamsListResponse,
    FLTeamsResponse,
)
from app.api.teams.services import build_team_pipeline
from app.core.config import backend_config
from app.core.crud import aggregate_many_from_db
from app.core.dependencies import TeamsCollection
from app.core.security import verify_access_base

router = APIRouter(
    prefix=f"/api/v{backend_config.api_version}/teams",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLTeamsResponse)
async def get_teams(
    teams_collection: TeamsCollection, filters: FLTeamsFilterParams = Depends()
) -> FLTeamsResponse:

    pipeline = build_team_pipeline(filters=filters)

    teams_raw = await aggregate_many_from_db(
        collection=teams_collection,
        pipeline=pipeline,
    )
    print(teams_raw)

    if filters.compact:
        return FLTeamsCompactListResponse(
            teams=FLTeamCompactListAdapter.validate_python(teams_raw)
        )

    teams = FLTeamListAdapter.validate_python(teams_raw)
    if filters.in_gruppen:
        return FLTeamsGruppenResponse(gruppen=FLGruppen.from_teams(teams=teams))

    return FLTeamsListResponse(teams=teams)
