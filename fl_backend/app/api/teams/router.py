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
from app.api.teams.services import build_teams_filter, build_teams_sort
from app.core.config import backend_config
from app.core.crud import pull_many_from_db
from app.core.dependencies import TeamsCollection
from app.core.security import verify_access_base

router = APIRouter(prefix=f"/api/v{backend_config.api_version}/teams", dependencies=[Depends(verify_access_base)])


@router.get("", response_model=FLTeamsResponse)
async def get_teams(teams_collection: TeamsCollection, filters: FLTeamsFilterParams = Depends()) -> FLTeamsResponse:

    db_filter = build_teams_filter(filters=filters)
    db_sort = build_teams_sort(sort_by=filters.sort_by, order=filters.order)

    teams_raw = await pull_many_from_db(
        collection=teams_collection,
        db_filter=db_filter,
        limit=filters.limit,
        sort_by=db_sort,
        projection=["_id", "name", "address", "statistik", "shorthand"] if filters.compact else {},
    )
    if filters.compact:
        return FLTeamsCompactListResponse(teams=FLTeamCompactListAdapter.validate_python(teams_raw))

    teams = FLTeamListAdapter.validate_python(teams_raw)

    if filters.in_gruppen:
        return FLTeamsGruppenResponse(gruppen=FLGruppen.from_teams(teams=teams))

    return FLTeamsListResponse(teams=teams)
