from typing import Any

from fastapi import APIRouter, Depends

from app.api.saisons.crud import pull_saison_id_and_rules
from app.api.spiele.schemas import FLSpielListAdapter
from app.api.teams.schemas import (
    FLTeam,
    FLTeamListAdapter,
    FLTeamsFilterParams,
    FLTeamsGroupedResponse,
    FLTeamSingleFilterParams,
    FLTeamsListResponse,
    FLTeamsResponse,
    FLTeamsSingleResponse,
)
from app.api.teams.services import build_gruppen, build_team_pipeline
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, pull_many_from_db
from app.core.dependencies import SaisonsCollection, SpieleCollection, TeamsCollection
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import verify_access_base
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/teams",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLTeamsResponse, summary="List teams, flat or grouped")
async def get_teams(
    teams_collection: TeamsCollection,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    filters: FLTeamsFilterParams = Depends(),
) -> FLTeamsResponse:
    """
    List teams for a season.

    `in_gruppen=true` returns the four groups keyed A-D, otherwise a plain list; check `format` to
    tell them apart. Omitting `saison_id` returns the CURRENT season, and a team not in it is absent.
    """

    # Resolved here, never as a field default, which cannot query the database. It also flips
    # `strict_join` on: without a season the `$lookup` returns one row per season a team played.
    filters.saison_id, saison_rules = await pull_saison_id_and_rules(saisons_collection=saisons_collection, saison_id=filters.saison_id)

    pipeline = build_team_pipeline(filters=filters, rules=saison_rules)

    teams_raw = await aggregate_many_from_db(
        collection=teams_collection,
        pipeline=pipeline,
    )

    teams = FLTeamListAdapter.validate_python(teams_raw)
    if not filters.in_gruppen:
        return FLTeamsListResponse(teams=teams)

    # The chain's last criterion is a head-to-head table, so a standing needs the matches, filtered
    # to the same set the statistics counted.
    spiele_filter: dict[str, Any] = {"saison_id": filters.saison_id}
    if filters.statistik_scope == "gruppenphase":
        spiele_filter["saison_phase"] = "gruppenphase"

    spiele_raw = await pull_many_from_db(collection=spiele_collection, db_filter=spiele_filter)
    spiele = FLSpielListAdapter.validate_python(spiele_raw)

    return FLTeamsGroupedResponse(
        gruppen=build_gruppen(teams=teams, spiele=spiele, rules=saison_rules),
        # Beside the table it applies to: a separate request could draw it from another season.
        qualifiers_per_group=saison_rules.qualifiers_per_group,
    )


@router.get(by_id("team_id"), response_model=FLTeamsSingleResponse, summary="One team")
async def get_team(
    team_id: CustomRouteObjectId,
    teams_collection: TeamsCollection,
    saisons_collection: SaisonsCollection,
    filters: FLTeamSingleFilterParams = Depends(),
) -> FLTeamsSingleResponse:
    """
    Return one team, with its group and its statistics for a season.

    The path names WHICH TEAM; the query names WHICH SEASON'S figures: `gruppe` and `statistik` are
    season-scoped. 404 for an id naming no team, and for one with no row that season.
    """

    saison_id, saison_rules = await pull_saison_id_and_rules(saisons_collection=saisons_collection, saison_id=filters.saison_id)

    # A retired club stays addressable by id: a caller holding one was given it by something.
    pipeline_filters = FLTeamsFilterParams(
        saison_id=saison_id,
        statistik_scope=filters.statistik_scope,
        include_inactive=True,
    )

    teams_raw = await aggregate_many_from_db(
        collection=teams_collection,
        pipeline=build_team_pipeline(filters=pipeline_filters, rules=saison_rules, team_id=team_id),
    )
    if not teams_raw:
        raise DocumentNotFoundException(filter={"_id": team_id}, error_code=DOCUMENT_NOT_FOUND)

    return FLTeamsSingleResponse(team=FLTeam.model_validate(teams_raw[0]))
