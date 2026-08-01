from fastapi import APIRouter, Depends

from app.api.saisons.crud import pull_current_saison_id
from app.api.teams.schemas import (
    FLGruppen,
    FLTeamCompactListAdapter,
    FLTeamListAdapter,
    FLTeamsCompactListResponse,
    FLTeamsFilterParams,
    FLTeamsGroupedResponse,
    FLTeamsListResponse,
    FLTeamsResponse,
)
from app.api.teams.services import build_team_pipeline
from app.core.config import backend_config
from app.core.crud import aggregate_many_from_db
from app.core.dependencies import SaisonsCollection, TeamsCollection
from app.core.security import verify_access_base

router = APIRouter(
    prefix=f"/api/v{backend_config.api_version}/teams",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLTeamsResponse)
async def get_teams(
    teams_collection: TeamsCollection,
    saisons_collection: SaisonsCollection,
    filters: FLTeamsFilterParams = Depends(),
) -> FLTeamsResponse:

    # Omitting `saison_id` means "the current season", not "every season" (BE-1). Resolved here
    # rather than as a field default because a default cannot reach the database.
    # This also flips `strict_join` on in the pipeline, which is the point: without a season the
    # `$lookup` returns one row per season a team ever played, and a team with no row at all
    # survives with `gruppe`/`statistik` unset and then fails response validation.
    if filters.saison_id is None:
        filters.saison_id = await pull_current_saison_id(saisons_collection=saisons_collection)

    pipeline = build_team_pipeline(filters=filters)

    teams_raw = await aggregate_many_from_db(
        collection=teams_collection,
        pipeline=pipeline,
    )

    if filters.compact:
        return FLTeamsCompactListResponse(teams=FLTeamCompactListAdapter.validate_python(teams_raw))

    teams = FLTeamListAdapter.validate_python(teams_raw)
    if filters.in_gruppen:
        return FLTeamsGroupedResponse(gruppen=FLGruppen.from_teams(teams=teams))

    return FLTeamsListResponse(teams=teams)
