from http import HTTPStatus
from typing import Annotated

from fastapi import APIRouter, Body, Depends

from app.api.aufstellungen.schemas import FLAufstellungPayload, FLAufstellungResponse
from app.api.grants.guard import verify_actor_is_admin
from app.core.codes import Code
from app.core.config import API_VERSION
from app.core.exceptions import APIError
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/aufstellungen",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)

AUFSTELLUNG_PATH = f"{by_id('spiel_id')}{by_id('team_id')}"


@router.get(AUFSTELLUNG_PATH, response_model=FLAufstellungResponse, summary="One club's line-up for one fixture as an administrator reads it")
async def get_aufstellung(spiel_id: CustomRouteObjectId, team_id: CustomRouteObjectId) -> FLAufstellungResponse:
    """
    The line-up screen of one club for one fixture, as the club's own seat holders read it.

    `document_not_found` for a fixture that does not exist or does not field this club.
    """

    # Session 8: the read the seat holder's screen makes, behind the administrator's guard.
    raise APIError(HTTPStatus.NOT_IMPLEMENTED, Code.UNHANDLED_CRASH)


@router.put(
    AUFSTELLUNG_PATH,
    response_model=FLAufstellungResponse,
    summary="Save one club's line-up for one fixture as an administrator",
    responses={201: {"model": FLAufstellungResponse, "description": "The line-up did not stand before, and this save created it"}},
)
async def put_aufstellung(
    spiel_id: CustomRouteObjectId,
    team_id: CustomRouteObjectId,
    aufstellung_data: Annotated[FLAufstellungPayload, Body()],
) -> FLAufstellungResponse:
    """
    Save the whole line-up of one club for one fixture, at any time on a fixture holding a day and an hour.

    The document a seat holder's save writes, on the same payload, so the lock never reaches this save
    (`aufstellung_locked` is the seat's alone) and a save between the two is refused as any stale one is. Recorded as
    `aufstellung.saved`.

    Refuses, in this order, each writing nothing: a fixture that does not exist or does not field this club
    (`document_not_found`); a fixture holding no day or no hour (`aufstellung_spiel_undated`); a `version` other than
    the document's now, or than null where none stands (`version_stale`); a pupil newly named whom the club's live
    squad of the season does not hold (`spieler_not_in_kader`); and a nominee past the shortage
    (`aufstellung_nominee_without_shortage`). The payload's own rules refuse as they do a seat's save.
    """

    # Session 8: the save the seat holder's handler makes, without the lock and under the administrator's actor.
    raise APIError(HTTPStatus.NOT_IMPLEMENTED, Code.UNHANDLED_CRASH)
