"""
TEAMS · read endpoint

Serves `GET /teams` in three shapes, discriminated by a `format` field on the response: a plain list, a
compact projection, and the four groups. Pydantic picks the model from that discriminator.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • Omitting `saison_id` means the current season. Beyond the default itself, this flips `strict_join`
    on in the pipeline -- and that is the point: without a season the `$lookup` returns one row per
    season a team ever played in.
  • The season is resolved to a DOCUMENT, not just an id, because the derived table is scored with
    that season's own `rules` (ADR-0026). One query answers both.
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


@router.get("", response_model=FLTeamsResponse, summary="List teams, compact or grouped")
async def get_teams(
    teams_collection: TeamsCollection,
    saisons_collection: SaisonsCollection,
    filters: FLTeamsFilterParams = Depends(),
) -> FLTeamsResponse:
    """
    List teams for a season.

    The response shape depends on the query: `compact=true` returns a reduced projection,
    `in_gruppen=true` returns the four groups keyed A-D, and otherwise a plain list. Check the
    `format` field to tell them apart.

    Omitting `saison_id` returns the **current** season. Group and disqualification are season-scoped
    and come from a junction collection, so a team with no entry for the requested season is absent
    from the response entirely. Statistics are season-scoped as well, and are computed from that
    season's matches on every read rather than stored.
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

    if filters.compact:
        return FLTeamsCompactListResponse(teams=FLTeamCompactListAdapter.validate_python(teams_raw))

    teams = FLTeamListAdapter.validate_python(teams_raw)
    if filters.in_gruppen:
        return FLTeamsGroupedResponse(gruppen=FLGruppen.from_teams(teams=teams))

    return FLTeamsListResponse(teams=teams)
