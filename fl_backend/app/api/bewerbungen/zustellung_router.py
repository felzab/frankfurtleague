from typing import Annotated, Callable, Mapping, Sequence

from bson import ObjectId
from fastapi import APIRouter, Body, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.schemas import (
    FLBewerbungZustellungAngenommenPayload,
    FLBewerbungZustellungEreignisPayload,
    FLBewerbungZustellungResponse,
    FLKontaktRolle,
)
from app.api.bewerbungen.services import KONTAKT_SEATS, compose_zustellung_update, zustellung_event_applies, zustellung_send_applies
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, pull_one_from_db
from app.core.dependencies import BewerbungenCollection, DBClient
from app.core.security import bind_system_actor, verify_access_system

# Its own router rather than an endpoint on the sweep's: `.claude/rules/backend.md` **routing**
# refuses a merge that moves a guard onto an endpoint. System tier and the system actor for the
# sweep's reason: no session stands behind either caller.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/bewerbungen/zustellung",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)

# Every seat this write may reach, ONLY the fields it judges: the block holds three people's names,
# addresses and telephone numbers, and none of them decides anything here.
ZUSTELLUNG_FIELDS: Mapping[str, int] = {f"bestaetigungen.{seat}.zustellung": 1 for seat in KONTAKT_SEATS}


def _in_declaration_order(rollen: Sequence[FLKontaktRolle]) -> list[FLKontaktRolle]:
    """The named seats deduplicated, so a repeated one is answered once and the answer reads the same for any spelling of the request."""

    return sorted(set(rollen), key=KONTAKT_SEATS.index)


async def _apply(
    *,
    bewerbungen_collection: BewerbungenCollection,
    db: DBClient,
    bewerbung_id: ObjectId,
    rollen: Sequence[FLKontaktRolle],
    judge: Callable[..., bool],
    stand: str,
    nachricht_id: str,
    grund: str | None,
    am: str,
) -> FLBewerbungZustellungResponse:
    """Judge every named seat and write the ones that qualify, in one transaction.

    Judged in-session because a re-send landing between the read and the write mints the very
    `nachricht_id` the comparison exists to reject.
    """

    async def write_the_state(session: AsyncClientSession) -> list[FLKontaktRolle]:
        bewerbung_raw = await pull_one_from_db(
            collection=bewerbungen_collection, db_filter={"_id": bewerbung_id}, projection=ZUSTELLUNG_FIELDS, session=session
        )
        bestaetigungen = bewerbung_raw.get("bestaetigungen")
        applying: list[FLKontaktRolle] = [seat for seat in _in_declaration_order(rollen) if judge(bestaetigungen=bestaetigungen, seat=seat)]
        if not applying:
            return []

        await patch_one_in_db(
            collection=bewerbungen_collection,
            db_filter={"_id": bewerbung_id},
            update=compose_zustellung_update(seats=applying, nachricht_id=nachricht_id, stand=stand, grund=grund, am=am),
            session=session,
        )

        return applying

    async with db.start_session() as session:
        return FLBewerbungZustellungResponse(angewendet=await session.with_transaction(write_the_state))


@router.post("/angenommen", response_model=FLBewerbungZustellungResponse, summary="Record the message the provider accepted for these seats")
async def angenommen_zustellung(
    angenommen_data: Annotated[FLBewerbungZustellungAngenommenPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    db: DBClient,
) -> FLBewerbungZustellungResponse:
    """
    Record that the mail provider accepted one message for the seats named, under the id it answered with.

    That id is the only join between a send and any later delivery event, so a seat carrying none is a seat every event
    about it is discarded for. Accepting a request is not delivering it: what this records is that the provider took the
    message, and `POST /bewerbungen/zustellung` is where the recipient's own mail server is heard from.

    Applied per seat and only where this send is newer than what the seat already holds, so a call retried after a
    later one landed writes nothing. A seat the application does not hold -- erased, or never mailed -- is skipped
    rather than refused, and the answer names the seats that were written. 404 where no application has the id.
    """

    return await _apply(
        bewerbungen_collection=bewerbungen_collection,
        db=db,
        bewerbung_id=angenommen_data.bewerbung_id,
        rollen=angenommen_data.rollen,
        judge=lambda *, bestaetigungen, seat: zustellung_send_applies(bestaetigungen=bestaetigungen, seat=seat, am=angenommen_data.am),
        stand="angenommen",
        nachricht_id=angenommen_data.nachricht_id,
        # Null by construction: an accepted send has nothing to explain, and a token carried over
        # from the refusal before it would read as this message's own.
        grund=None,
        am=angenommen_data.am,
    )


@router.post("", response_model=FLBewerbungZustellungResponse, summary="Apply one delivery event to the seats its message was sent to")
async def post_zustellung(
    ereignis_data: Annotated[FLBewerbungZustellungEreignisPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    db: DBClient,
) -> FLBewerbungZustellungResponse:
    """
    Record what the mail provider reported about one message, on every seat that message was sent to.

    Applied only where the event names the message the seat still holds AND is stamped strictly later than the state
    it holds: a re-send mints a new message, so the old one's bounce must not mark the fresh link, and a redelivery or
    an event overtaken by a later one changes nothing. Both are answered with the seats written -- none, where nothing
    qualified -- rather than with a refusal, because the provider retries anything but a success and would resend a
    settled event for hours.

    404 where no application has the id, which an application erased between the send and the event is: a caller that
    must not retry maps it rather than repeating the call.
    """

    return await _apply(
        bewerbungen_collection=bewerbungen_collection,
        db=db,
        bewerbung_id=ereignis_data.bewerbung_id,
        rollen=ereignis_data.rollen,
        judge=lambda *, bestaetigungen, seat: zustellung_event_applies(
            bestaetigungen=bestaetigungen, seat=seat, nachricht_id=ereignis_data.nachricht_id, am=ereignis_data.am
        ),
        stand=ereignis_data.stand,
        nachricht_id=ereignis_data.nachricht_id,
        grund=ereignis_data.grund,
        am=ereignis_data.am,
    )
