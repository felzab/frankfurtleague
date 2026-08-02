"""
TEAMS · read endpoints

`GET /teams` in two shapes, discriminated by a `format` field on the response -- a plain list, or the
four groups -- plus `GET /teams/{team_id}` for one team. Writing them is `admin_router.py`, a separate
module so the two authorization levels never share a file.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • Omitting `saison_id` means the current season. Beyond the default itself, this flips `strict_join`
    on in the pipeline -- and that is the point: without a season the `$lookup` returns one row per
    season a team ever played in.
  • The season is resolved to a DOCUMENT, not just an id, because the derived table is scored with
    that season's own `rules` (ADR-0026). One query answers both.
  • `statistik_scope` defaults to `gruppenphase`, so the shape a caller gets by saying nothing is the
    league table (ADR-0029). `gesamt` is the opt-in, not the other way round.
  • The grouped response always contains all four group keys, even when a group is empty. It once built
    the map from the teams present, so a season with nobody in group D omitted "D" and the frontend
    parse failed, taking down /dashboard/saisontabelle.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  app/api/teams/services.py -- the pipeline, including how `statistik` is derived
  docs/backend/spec.md -- invariants I10, I11
"""

from fastapi import APIRouter, Depends

from app.api.saisons.crud import pull_saison_id_and_rules
from app.api.teams.schemas import (
    FLGruppen,
    FLTeam,
    FLTeamListAdapter,
    FLTeamsFilterParams,
    FLTeamsGroupedResponse,
    FLTeamSingleFilterParams,
    FLTeamsListResponse,
    FLTeamsResponse,
    FLTeamsSingleResponse,
)
from app.api.teams.services import build_team_pipeline
from app.core.config import backend_config
from app.core.crud import aggregate_many_from_db
from app.core.dependencies import SaisonsCollection, TeamsCollection
from app.core.exceptions import DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import verify_access_base
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{backend_config.api_version}/teams",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLTeamsResponse, summary="List teams, flat or grouped")
async def get_teams(
    teams_collection: TeamsCollection,
    saisons_collection: SaisonsCollection,
    filters: FLTeamsFilterParams = Depends(),
) -> FLTeamsResponse:
    """
    List teams for a season.

    The response shape depends on the query: `in_gruppen=true` returns the four groups keyed A-D, and
    otherwise a plain list. Check the `format` field to tell them apart.

    Omitting `saison_id` returns the **current** season. Group and disqualification are season-scoped
    and come from a junction collection, so a team with no entry for the requested season is absent
    from the response entirely. Statistics are season-scoped as well, and are computed from that
    season's matches on every read rather than stored.

    `statistik_scope` chooses which matches those statistics count. It defaults to `gruppenphase` —
    the league table, which playoff results must not move. Pass `gesamt` for a team's figures across
    every phase of the season. Both scopes return the same fields.
    """

    # Omitting `saison_id` means "the current season", not "every season" (ADR-0002). Resolved here
    # rather than as a field default because a default cannot reach the database.
    # This also flips `strict_join` on in the pipeline, which is the point: without a season the
    # `$lookup` returns one row per season a team ever played, and a team with no row at all
    # survives with `gruppe` unset and then fails response validation.
    # The season's `rules` come back with it: the derived table is scored with that season's own win
    # and draw points rather than a constant (ADR-0026).
    filters.saison_id, saison_rules = await pull_saison_id_and_rules(saisons_collection=saisons_collection, saison_id=filters.saison_id)

    pipeline = build_team_pipeline(filters=filters, rules=saison_rules)

    teams_raw = await aggregate_many_from_db(
        collection=teams_collection,
        pipeline=pipeline,
    )

    teams = FLTeamListAdapter.validate_python(teams_raw)
    if filters.in_gruppen:
        return FLTeamsGroupedResponse(gruppen=FLGruppen.from_teams(teams=teams))

    return FLTeamsListResponse(teams=teams)


@router.get(by_id("team_id"), response_model=FLTeamsSingleResponse, summary="One team")
async def get_team(
    team_id: CustomRouteObjectId,
    teams_collection: TeamsCollection,
    saisons_collection: SaisonsCollection,
    filters: FLTeamSingleFilterParams = Depends(),
) -> FLTeamsSingleResponse:
    """
    Return one team, with its group and its statistics for a season.

    The path names **which team**; the query still names **which season's figures to compute**, because
    `gruppe` and `statistik` are season-scoped — the former joined from a junction, the latter derived
    from that season's matches on every read (ADR-0026). So `saison_id` and `statistik_scope` remain
    query parameters here and are not a redundant second identifier.

    404 when the id names no team, and equally when it names a team with no junction row for the
    requested season — the join is strict, and a team that did not play that season has no group and no
    table position to report.
    """

    saison_id, saison_rules = await pull_saison_id_and_rules(saisons_collection=saisons_collection, saison_id=filters.saison_id)

    # Placeholders and retired clubs are addressable by id even though both are hidden from the list.
    # A caller holding an id was given it by something, and answering 404 for a document that plainly
    # exists is the less useful of the two lies.
    pipeline_filters = FLTeamsFilterParams(
        saison_id=saison_id,
        statistik_scope=filters.statistik_scope,
        include_placeholders=True,
        include_inactive=True,
    )

    teams_raw = await aggregate_many_from_db(
        collection=teams_collection,
        pipeline=build_team_pipeline(filters=pipeline_filters, rules=saison_rules, team_id=team_id),
    )
    if not teams_raw:
        raise DocumentNotFoundException(filter={"_id": team_id}, error_code="DB-COMMON-001")

    return FLTeamsSingleResponse(team=FLTeam.model_validate(teams_raw[0]))
