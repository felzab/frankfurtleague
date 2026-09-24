from collections.abc import Callable
from typing import Annotated

from bson import ObjectId
from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

# The application's slice owns the two judges, and the rules inside them are the whole idempotency
# of both routers: a second copy would let one home settle an event the other replays.
from app.api.bewerbungen.services import zustellung_event_applies, zustellung_send_applies
from app.api.zustellung.schemas import (
    FLZustellungAbgewiesenPayload,
    FLZustellungAngenommenPayload,
    FLZustellungEreignisPayload,
    FLZustellungResponse,
    FLZustellungZiel,
)
from app.api.zustellung.services import ABGEWIESENER_VERSAND_STAND, ZIEL_PFADE, compose_ziel_zustellung_update, zustellung_projektion
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, pull_one_from_db
from app.core.dependencies import DB, DBClient
from app.core.exception_handlers import DUPLICATE_KEY_RESPONSE
from app.core.security import bind_system_actor, verify_access_system

# Beside the application's own delivery router rather than replacing it: moving that one would
# rewrite its tests for no behaviour. System tier and the system actor because no session stands
# behind a mail provider's callback.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/zustellung",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)


async def _apply(
    *,
    db: DB,
    db_client: DBClient,
    ziel: FLZustellungZiel,
    ziel_id: ObjectId,
    judge: Callable[..., bool],
    stand: str,
    nachricht_id: str,
    grund: str | None,
    am: str,
) -> FLZustellungResponse:
    """Judge this record and write it where it qualifies, in one transaction.

    Judged in-session because a re-send landing between the read and the write mints the very
    `nachricht_id` the comparison exists to reject.
    """

    pfad = ZIEL_PFADE[ziel]
    collection = db[pfad.collection]

    async def write_the_state(session: AsyncClientSession) -> bool:
        raw = await pull_one_from_db(collection=collection, db_filter={"_id": ziel_id}, projection=zustellung_projektion(pfad), session=session)
        # The carrier is what the judges read a seat's entry off, so the projected document stands in
        # for the application's seat block and the carrier's key for the seat.
        if not judge(bestaetigungen=raw, seat=pfad.traeger):
            return False

        await patch_one_in_db(
            collection=collection,
            db_filter={"_id": ziel_id},
            update=compose_ziel_zustellung_update(pfad=pfad, nachricht_id=nachricht_id, stand=stand, grund=grund, am=am),
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

        return True

    async with db_client.start_session() as session:
        return FLZustellungResponse(angewendet=await session.with_transaction(write_the_state))


@router.post(
    "/angenommen",
    response_model=FLZustellungResponse,
    summary="Record the message the provider accepted for this record",
    responses={409: DUPLICATE_KEY_RESPONSE},
)
async def angenommen_zustellung(
    angenommen_data: Annotated[FLZustellungAngenommenPayload, Body()],
    db: DB,
    db_client: DBClient,
) -> FLZustellungResponse:
    """
    Record that the mail provider accepted one message about the record named, under the id it answered with.

    That id is the only join between a send and any later delivery event, so a record carrying none is a record every event about it
    is discarded for. Accepting a request is not delivering it: what this records is that the provider took the message, and
    `POST /zustellung` is where the recipient's own mail server is heard from.

    Applied only where this send is newer than the ACCEPT the record already holds, so a call retried after a later one landed
    writes nothing, and the answer says whether anything was written; a delivery state the provider stamped never blocks it, that
    stamp being the provider's clock rather than this sender's. A record whose document carries no delivery bookkeeping at all --
    never mailed, or emptied by an erasure -- is skipped rather than refused. 404 where no document of that kind has the id.
    """

    return await _apply(
        db=db,
        db_client=db_client,
        ziel=angenommen_data.ziel,
        ziel_id=angenommen_data.ziel_id,
        judge=lambda *, bestaetigungen, seat: zustellung_send_applies(bestaetigungen=bestaetigungen, seat=seat, am=angenommen_data.am),
        stand="angenommen",
        nachricht_id=angenommen_data.nachricht_id,
        # Null by construction: an accepted send has nothing to explain, and a token carried over
        # from the refusal before it would read as this message's own.
        grund=None,
        am=angenommen_data.am,
    )


@router.post(
    "/abgewiesen",
    response_model=FLZustellungResponse,
    summary="Record the send the provider refused for this record",
    responses={409: DUPLICATE_KEY_RESPONSE},
)
async def abgewiesen_zustellung(
    abgewiesen_data: Annotated[FLZustellungAbgewiesenPayload, Body()],
    db: DB,
    db_client: DBClient,
) -> FLZustellungResponse:
    """
    Record that the mail provider refused the send itself, so no message about this record exists.

    The send is where a refused address is learnt at all: nothing is minted, no delivery event ever follows, and a record left without
    this state is one the reminder clocks chase and the deadline clocks erase as though the link had been read.

    Judged as an accepted send is, both stamps being this sender's: applied only where this refusal is newer than the ACCEPT the record
    already holds, so a call retried after the re-send that repaired the address writes nothing, and a delivery state the provider
    stamped never blocks it. A record whose document carries no delivery bookkeeping at all is skipped rather than refused. 404 where no
    document of that kind has the id.
    """

    return await _apply(
        db=db,
        db_client=db_client,
        ziel=abgewiesen_data.ziel,
        ziel_id=abgewiesen_data.ziel_id,
        judge=lambda *, bestaetigungen, seat: zustellung_send_applies(bestaetigungen=bestaetigungen, seat=seat, am=abgewiesen_data.am),
        stand=ABGEWIESENER_VERSAND_STAND,
        # Empty by construction: no message was minted, so a synthetic id would let a real event
        # about a real message read as unrelated to the record it was sent about.
        nachricht_id="",
        grund=abgewiesen_data.grund,
        am=abgewiesen_data.am,
    )


@router.post(
    "",
    response_model=FLZustellungResponse,
    summary="Apply one delivery event to the record its message was sent about",
    responses={409: DUPLICATE_KEY_RESPONSE},
)
async def post_zustellung(
    ereignis_data: Annotated[FLZustellungEreignisPayload, Body()],
    db: DB,
    db_client: DBClient,
) -> FLZustellungResponse:
    """
    Record what the mail provider reported about one message, on the record that message was sent about.

    Applied only where the event names the message the record still holds AND is stamped strictly later than the state it holds: a
    re-send mints a new message, so the old one's bounce must not mark the fresh link, and a redelivery or an event overtaken by a
    later one changes nothing. Both are answered with `angewendet: false` rather than with a refusal, because the provider retries
    anything but a success and would resend a settled event for hours.

    404 where no document of that kind has the id, which a record erased between the send and the event is: a caller that must not
    retry maps it rather than repeating the call.
    """

    return await _apply(
        db=db,
        db_client=db_client,
        ziel=ereignis_data.ziel,
        ziel_id=ereignis_data.ziel_id,
        judge=lambda *, bestaetigungen, seat: zustellung_event_applies(
            bestaetigungen=bestaetigungen, seat=seat, nachricht_id=ereignis_data.nachricht_id, am=ereignis_data.am
        ),
        stand=ereignis_data.stand,
        nachricht_id=ereignis_data.nachricht_id,
        grund=ereignis_data.grund,
        am=ereignis_data.am,
    )
