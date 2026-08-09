"""
TEAMS · read endpoints

`GET /teams` in two shapes discriminated by `format` — a plain list, or the four groups — plus
`GET /teams/{team_id}` for one team. Writing them is `admin_router.py` (ADR-0034).

Invariants:
- Omitting `saison_id` means the current season, and flips the strict junction join on.
- The season is resolved to a document, because the table is scored with its `rules` (ADR-0026).
- `statistik_scope` defaults to `gruppenphase` — the league table is the no-argument answer (ADR-0029).
- The grouped response always contains all four group keys, even when a group is empty.
- Only the grouped shape reads the season's matches — it is a standing, the flat list is not (ADR-0043).
- The head-to-head reads the same matches `statistik_scope` counted.

See:
- app/api/teams/services.py — the pipeline, and the standing's own half
- docs/backend/spec.md — invariants I10, I11
"""

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
from app.core.exceptions import DocumentNotFoundException
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
    if not filters.in_gruppen:
        return FLTeamsListResponse(teams=teams)

    # The grouped shape is a STANDING, so it is ordered by the competition's tiebreak chain rather than
    # by name -- and the chain's last criterion is the head-to-head table among teams nothing above it
    # separated, which needs the matches themselves (ADR-0043). The flat list above is sorted by name
    # and is not a standing, so it pays for none of this.
    #
    # Filtered to the SAME matches the statistics counted, or the head-to-head would be drawn from a
    # different set of results than the points it is breaking a tie in (ADR-0029).
    spiele_filter: dict[str, Any] = {"saison_id": filters.saison_id}
    if filters.statistik_scope == "gruppenphase":
        spiele_filter["saison_phase"] = "gruppenphase"

    spiele_raw = await pull_many_from_db(collection=spiele_collection, db_filter=spiele_filter)
    spiele = FLSpielListAdapter.validate_python(spiele_raw)

    return FLTeamsGroupedResponse(
        gruppen=build_gruppen(teams=teams, spiele=spiele, rules=saison_rules),
        # The season's own number, carried beside the table it applies to: a caller marking the teams in
        # a playoff place needs to know where each list's qualifying prefix ends, and reading it from a
        # separate request would let a page draw the cutoff from a different season than the table.
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

    The path names **which team**; the query still names **which season's figures to compute**, because
    `gruppe` and `statistik` are season-scoped — the former joined from a junction, the latter derived
    from that season's matches on every read (ADR-0026). So `saison_id` and `statistik_scope` remain
    query parameters here and are not a redundant second identifier.

    404 when the id names no team, and equally when it names a team with no junction row for the
    requested season — the join is strict, and a team that did not play that season has no group and no
    table position to report.
    """

    saison_id, saison_rules = await pull_saison_id_and_rules(saisons_collection=saisons_collection, saison_id=filters.saison_id)

    # A retired club is addressable by id even though it is hidden from the list. A caller holding an
    # id was given it by something, and answering 404 for a document that plainly exists is the less
    # useful of the two lies.
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
        raise DocumentNotFoundException(filter={"_id": team_id}, error_code="DB-COMMON-001")

    return FLTeamsSingleResponse(team=FLTeam.model_validate(teams_raw[0]))
