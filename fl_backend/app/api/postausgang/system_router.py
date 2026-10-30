import secrets
from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from bson import ObjectId
from fastapi import APIRouter, Body, Depends, status
from pymongo import ASCENDING
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.postausgang.schemas import (
    FLOutboxEventPayload,
    FLOutboxEventResponse,
    FLOutboxHandout,
    FLOutboxHandoutResponse,
    FLOutboxResultPayload,
    FLOutboxResultResponse,
    FLOutboxSignInPayload,
)
from app.api.postausgang.services import (
    ANMELDE_ARTEN,
    BEANSPRUCHUNG_DAUER,
    ENDSTAND,
    FOLGT_AUF,
    SEITE,
    UNGESPERRT,
    OwedMail,
    final_update,
    retry_update,
    row_of,
)
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import patch_many_in_db, post_one_to_db, pull_many_from_db, stamp_in_db
from app.core.dependencies import DB, DBClient, PostausgangCollection, get_germany_now
from app.core.security import bind_system_actor, verify_access_system
from app.core.transactions import transaction_session
from app.shared.tokens import mint_token

# System tier and the system actor: the drain, the sign-in library and the provider's callback hold no session.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/outbox",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)


# Open, and no live claim holding it.
def _frei(now: datetime) -> dict[str, Any]:
    return {"stand": "open", "$or": [{"leased_until": None}, {"leased_until": {"$lte": now}}]}


def _link_record_filter(row: Mapping[str, Any]) -> dict[str, Any]:
    """The record a mail's link is minted on, while it still holds the mail's address at every path the link names.

    A seat emptied, handed on or re-addressed since the mail was owed matches nothing, and neither does a record gone,
    so the mail is dropped rather than minting a live link for an address the record no longer names. Each array's
    parent an object, as a write through a null one is refused, which would abort the whole claim.
    """

    link = row["link"]
    parents = {pfad.rpartition(".")[0] for pfad in link["paths"]} - {""}

    return {
        "_id": row["reference"]["id"],
        **{adresse: row["an"] for adresse in link["adressen"]},
        **{parent: {"$type": "object"} for parent in sorted(parents)},
    }


def _link_update(link: Mapping[str, Any], token_hash: str) -> dict[str, Any]:
    if link["replaced"]:
        return {"$set": {pfad: [token_hash] for pfad in link["paths"]}}

    return {"$addToSet": {pfad: token_hash for pfad in link["paths"]}}


@router.post("/handout", response_model=FLOutboxHandoutResponse, summary="Claim the mails owed now and hand them out")
async def post_handout(
    postausgang_collection: PostausgangCollection,
    sperrliste: SperrlisteLookup,
    db: DB,
    db_client: DBClient,
    now: datetime = Depends(get_germany_now),
) -> FLOutboxHandoutResponse:
    """
    Claim, a page at a time, the owed mails no claim holds, for five minutes, and hand each out.

    The sign-in library's mails come first, each tried once, then the rest, each oldest first. A mail past its deadline
    is given up rather than handed out, and counted in `abandoned`. A mail to an address a standing ban holds is stopped
    as `barred`, the ban's own notice alone excepted. A mail carrying a link has it minted here, its hash written to
    the record the mail is about and the raw token answered once, in `token`; a record gone since, or one no longer
    holding the mail's address where its link names it, stops the mail as `dropped`. A second call inside the lease is
    answered none of these rows. The caller sends each under the idempotency key its `attempt` names and reports every
    outcome, with `lease`, to `POST /postausgang/ergebnis`;
    where the lease lapses first, the next call hands the row out again with a fresh link and number, every earlier link
    staying valid unless the mail's link supersedes them. Server to server alone: the answer names addresses, live links
    and secrets.
    """

    async def claim(session: AsyncClientSession) -> tuple[list[FLOutboxHandout], str | None, int]:
        overdue = await patch_many_in_db(
            collection=postausgang_collection,
            db_filter={**_frei(now), "frist": {"$lte": now}},
            update=final_update("abandoned", now=now),
            session=session,
        )
        # The sign-in library's mails first, then the rest, each oldest first: a sign-in mail has one attempt, and a queue
        # of league mail ahead of it would spend the drain's deadline before its claim.
        anmelde_arten = list(ANMELDE_ARTEN)
        due: list[Mapping[str, Any]] = []
        for art_filter in ({"$in": anmelde_arten}, {"$nin": anmelde_arten}):
            if len(due) == SEITE:
                break
            due += await pull_many_from_db(
                collection=postausgang_collection,
                db_filter={**_frei(now), "frist": {"$gt": now}, "art": art_filter},
                sort_by=[("recorded_at", ASCENDING), ("_id", ASCENDING)],
                limit=SEITE - len(due),
                session=session,
            )
        if not due:
            return [], None, overdue.modified_count

        # The ban is judged here, at the last moment before the send, rather than when the mail was owed.
        judged = {str(row["an"]) for row in due if row["art"] not in UNGESPERRT}
        barred = await adressen_gesperrt(sperrliste, judged, session=session) if judged else set()
        gesperrt = [row["_id"] for row in due if row["art"] not in UNGESPERRT and row["an"] in barred]
        entfallen: list[Any] = []

        tokens: dict[Any, str] = {}
        for row in due:
            if row["_id"] in gesperrt or row["link"] is None:
                continue
            raw, token_hash = mint_token()
            minted = await stamp_in_db(
                collection=db[Collection(row["reference"]["collection"])],
                db_filter=_link_record_filter(row),
                update=_link_update(row["link"], token_hash),
                session=session,
            )
            if not minted:
                entfallen.append(row["_id"])
                continue
            tokens[row["_id"]] = raw

        if gesperrt:
            await patch_many_in_db(
                collection=postausgang_collection,
                db_filter={"_id": {"$in": gesperrt}},
                update=final_update("barred", now=now),
                session=session,
            )
        if entfallen:
            await patch_many_in_db(
                collection=postausgang_collection,
                db_filter={"_id": {"$in": entfallen}},
                update=final_update("dropped", now=now),
                session=session,
            )

        handed = [row for row in due if row["_id"] not in gesperrt and row["_id"] not in entfallen]
        if not handed:
            return [], None, overdue.modified_count

        beanspruchung = secrets.token_urlsafe(24)
        # Every claimed row written, so two overlapping claims conflict on the rows both read and the retry finds them held;
        # the count rises in this write, so a retried claim counts once.
        await patch_many_in_db(
            collection=postausgang_collection,
            db_filter={"_id": {"$in": [row["_id"] for row in handed]}},
            update={"$set": {"lease": beanspruchung, "leased_until": now + BEANSPRUCHUNG_DAUER}, "$inc": {"attempts": 1}},
            session=session,
        )

        return (
            [
                FLOutboxHandout(
                    id=row["_id"],
                    an=row["an"],
                    data=row["data"],
                    token=tokens.get(row["_id"]),
                    secret=row["secret"],
                    attempt=row["attempts"] + 1,
                )
                for row in handed
            ],
            beanspruchung,
            overdue.modified_count,
        )

    async with transaction_session(db_client) as session:
        mails, beanspruchung, aufgegeben = await session.with_transaction(claim)

    return FLOutboxHandoutResponse(
        lease=beanspruchung,
        mails=mails,
        abandoned=aufgegeben,
    )


@router.post("/result", response_model=FLOutboxResultResponse, summary="Settle one mail a claim handed out")
async def post_result(
    ergebnis_data: Annotated[FLOutboxResultPayload, Body()],
    postausgang_collection: PostausgangCollection,
    now: datetime = Depends(get_germany_now),
) -> FLOutboxResultResponse:
    """
    Settle the named mail, where the named claim still holds it, by the outcome of its send, and nothing else.

    `sent` records the provider's message id; `withheld` a deployment that sends no mail; `abandon` a
    refusal every send would meet, any 4xx but a 429. A failed send's `grund`, the provider's own name for the refusal,
    is recorded on the row, the send's one record of why. `retry`, for a 429, a 5xx or a send that never reached the
    provider, hands the mail back for a drain a minute from now, or gives it up where it has grown past its deadline; a
    mail of the sign-in library is given up at once, its library's repair being a fresh one. A mail the claim does not
    hold -- unknown, settled already, or claimed since by another drain after this claim lapsed -- is left alone and
    counted in `ignored`; the answer counts one outcome. Each write names the claim, so its check and the outcome are
    one atomic operation on one row, needing no transaction; a settled row keeps no facts and no secret.
    """

    held = {"_id": ergebnis_data.id, "lease": ergebnis_data.lease, "stand": "open"}

    async def settled(update: Mapping[str, Any], narrowed: Mapping[str, Any]) -> bool:
        # Every report writes its refusal or none, so a mail sent after a failed send keeps no reason it no longer has.
        with_grund = {**update, "$set": {**update["$set"], "grund": ergebnis_data.grund}}
        result = await patch_many_in_db(collection=postausgang_collection, db_filter={**held, **narrowed}, update=with_grund)
        return result.modified_count > 0

    ergebnis = ergebnis_data.result
    stand = ENDSTAND[ergebnis]
    # A send to be tried again ends here only where it may not be: a sign-in mail, or one past its deadline.
    endet = {"$or": [{"art": {"$in": list(ANMELDE_ARTEN)}}, {"frist": {"$lte": now}}]} if ergebnis == "retry" else {}
    gezaehlt: str
    if await settled(final_update(stand, now=now, message_id=ergebnis_data.message_id), endet):
        gezaehlt = stand
    elif ergebnis == "retry" and await settled(retry_update(now=now), {}):
        gezaehlt = "repeated"
    else:
        gezaehlt = "ignored"

    return FLOutboxResultResponse.model_validate({feld: int(feld == gezaehlt) for feld in FLOutboxResultResponse.model_fields})


@router.post("/sign_in", status_code=status.HTTP_204_NO_CONTENT, summary="Owe one mail of the sign-in library")
async def post_sign_in(
    anmeldung_data: Annotated[FLOutboxSignInPayload, Body()],
    postausgang_collection: PostausgangCollection,
    now: datetime = Depends(get_germany_now),
) -> None:
    """
    Owe one mail the sign-in library sends -- the code, a passkey notice, the deletion link -- to the address named.

    Every call owes a mail of its own, under a key minted here: the library asks for each send once, and nothing repeats
    the call. `secret` is stored as it arrives, encrypted under a key this service never holds, and dropped once the mail
    is settled; `valid_until` is both the last moment a hand-out may send it and the moment the row is deleted, settled
    or not.
    """

    mail = OwedMail(key=f"{anmeldung_data.data.art}/{ObjectId()}", an=anmeldung_data.an, data=anmeldung_data.data)
    await post_one_to_db(
        collection=postausgang_collection,
        document=row_of(mail, now=now, secret=anmeldung_data.secret, valid_until=anmeldung_data.valid_until),
    )


@router.post("/event", response_model=FLOutboxEventResponse, summary="Record one delivery event on its mail's row")
async def post_event(
    ereignis_data: Annotated[FLOutboxEventPayload, Body()],
    postausgang_collection: PostausgangCollection,
) -> FLOutboxEventResponse:
    """
    Record what the mail provider reported about one message, on the row of the mail it was.

    The row is the one `id` names, which the send carried as a tag, so an event arriving before the send's report finds
    it all the same. Applied only where the row's delivery state is one the event's may follow -- a delay before
    anything, a complaint after a delivery, nothing after a refusal -- so a redelivery or an event arriving after a later
    one changes nothing. Both answer `angewendet: false`, as does an id no row has, rather than a refusal the provider
    would retry for hours.
    """

    # One document, so the filter's condition and the write are one atomic operation and need no transaction.
    result = await patch_many_in_db(
        collection=postausgang_collection,
        db_filter={
            "_id": ereignis_data.id,
            "delivery.stand": {"$in": list(FOLGT_AUF[ereignis_data.stand])},
        },
        update={"$set": {"delivery": {"stand": ereignis_data.stand, "grund": ereignis_data.grund, "am": ereignis_data.am}}},
    )

    return FLOutboxEventResponse(applied=result.modified_count > 0)
