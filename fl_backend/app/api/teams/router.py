from collections import defaultdict

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import JSONResponse

from app.api.spiele.schemas import FLSpielListAdapter
from app.api.teams.schemas import (
    FLGruppen,
    FLSpielerListAdapter,
    FLTeamListAdapter,
    FLTeamWithSpieler,
    FLTeamWithSpielerListAdapter,
)
from app.core.config import backend_config
from app.core.crud import pull_from_db
from app.core.dependencies import SpieleCollection, SpielerCollection, TeamsCollection
from app.core.security import verify_access_base

router = APIRouter(prefix=f"/api/v{backend_config.api_version}/teams", dependencies=[Depends(verify_access_base)])


@router.get("/saisontabelle")
async def get_saisontabelle(request: Request, teams_collection: TeamsCollection) -> JSONResponse:

    teams_raw = await pull_from_db(collection=teams_collection, filter={"is_placeholder": False})
    teams = FLTeamListAdapter.validate_python(teams_raw)

    gruppen = FLGruppen.from_teams(teams=teams)

    return JSONResponse(content={"acknowledged": 1, "gruppen": gruppen.model_dump(mode="json")})


@router.get("/all_teams")
async def get_all_teams(
    spieler_collection: SpielerCollection,
    teams_collection: TeamsCollection,
    with_spieler: bool = Query(default=False),
    include_placeholder: bool = Query(default=False),
) -> JSONResponse:

    teams_raw = await pull_from_db(collection=teams_collection, filter={} if include_placeholder else {"is_placeholder": False})
    teams = FLTeamListAdapter.validate_python(teams_raw)

    # Return here, if players were not requested
    if not with_spieler:
        return JSONResponse(
            content={"acknowledged": 1, "teams": FLTeamListAdapter.dump_python(teams, mode="json")},
            status_code=status.HTTP_200_OK,
        )

    alle_spieler_raw = await pull_from_db(
        collection=spieler_collection,
        filter={"team_id": {"$in": [team.id for team in teams]}},
    )
    alle_spieler = FLSpielerListAdapter.validate_python(alle_spieler_raw)

    # Group teams and players
    alle_spieler_map = defaultdict(list)
    for spieler in alle_spieler:
        alle_spieler_map[spieler.team_id].append(spieler)

    teams_with_spieler = [
        FLTeamWithSpieler(**team.model_dump(by_alias=True), spieler=alle_spieler_map.get(team.id, [])) for team in teams
    ]
    return JSONResponse(
        content={"acknowledged": 1, "teams": FLTeamWithSpielerListAdapter.dump_python(teams_with_spieler, mode="json")},
        status_code=status.HTTP_200_OK,
    )


@router.get("/all_teams_detail")
async def get_all_teams_detail(
    spiele_collection: SpieleCollection,
    teams_collection: TeamsCollection,
) -> JSONResponse:

    teams_raw = await pull_from_db(collection=teams_collection, filter={"is_placeholder": False})
    teams = FLTeamListAdapter.validate_python(teams_raw)
    teams_ids = [team.id for team in teams]

    spiele_raw = await pull_from_db(
        collection=spiele_collection,
        filter={"$or": [{"team1.team_id": {"$in": teams_ids}}, {"team2.team_id": {"$in": teams_ids}}]},
    )
    spiele = FLSpielListAdapter.validate_python(spiele_raw)

    return JSONResponse({
        "acknowledged": 1,
        "spiele": FLSpielListAdapter.dump_python(spiele, mode="json"),
        "teams": FLTeamListAdapter.dump_python(teams, mode="json"),
    })
