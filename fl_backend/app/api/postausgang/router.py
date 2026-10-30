import secrets
from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ASCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.services import mint_token
from app.api.postausgang.schemas import (
    FLPostausgangAnmeldungPayload,
    FLPostausgangAnmeldungResponse,
    FLPostausgangAusgabe,
    FLPostausgangAusgabeResponse,
    FLPostausgangEreignisPayload,
    FLPostausgangEreignisResponse,
    FLPostausgangErgebnis,
    FLPostausgangErgebnisPayload,
    FLPostausgangErgebnisResponse,
)
from app.api.postausgang.services import (
    ANMELDE_ARTEN,
    BEANSPRUCHUNG_DAUER,
    FOLGT_AUF,
    SEITE,
    UNGESPERRT,
    enqueue_mail,
    final_update,
    retry_update,
)
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import patch_many_in_db, patch_one_in_db, pull_many_from_db
from app.core.dependencies import DB, DBClient, PostausgangCollection, get_germany_now
from app.core.exceptions import DocumentNotFoundError
from app.core.security import bind_system_actor, verify_access_system
from app.core.transactions import transaction_session

# System tier and the system actor: the drain, the sign-in library and the provider's callback hold no session.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/postausgang",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)


# Open, and no live claim holding it.
def _frei(now: datetime) -> dict[str, Any]:
    return {"stand": "offen", "$or": [{"beansprucht_bis": None}, {"beansprucht_bis": {"$lte": now}}]}


@router.post("/ausgabe", response_model=FLPostausgangAusgabeResponse, summary="Claim the mails owed now and hand them out")
async def post_ausgabe(
    postausgang_collection: PostausgangCollection,
    sperrliste: SperrlisteLookup,
    db: DB,
    db_client: DBClient,
    now: datetime = Depends(get_germany_now),
) -> FLPostausgangAusgabeResponse:
    """
    Claim, a page at a time, the owed mails no claim holds, for five minutes, and hand each out.

    The sign-in library's mails come first, each tried once, then the rest, each oldest first. A mail past its deadline
    is given up rather than handed out, and counted in `aufgegeben`. A mail to an address a standing ban holds is stopped
    as `gesperrt`, the ban's own notice alone excepted. A mail carrying a link has it minted here, its hash written to
    the record the mail is about and the raw token answered once, in `token`; a record gone since stops the mail as
    `entfallen`. A second call inside the lease is answered none of these rows. The caller sends each under the
    idempotency key its `versuch` names and reports every outcome, with `beanspruchung`, to `POST /postausgang/ergebnis`;
    where the lease lapses first, the next call hands the row out again with a fresh link and number, every earlier link
    staying valid unless the mail's link supersedes them. Server to server alone: the answer names addresses, live links
    and secrets.
    """

    async def claim(session: AsyncClientSession) -> tuple[list[FLPostausgangAusgabe], str | None, int]:
        overdue = await patch_many_in_db(
            collection=postausgang_collection,
            db_filter={**_frei(now), "frist": {"$lte": now}},
            update=final_update("aufgegeben", now=now),
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
                sort_by=[("erfasst_am", ASCENDING), ("_id", ASCENDING)],
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
            pfad = row["link"]["pfad"]
            try:
                await patch_one_in_db(
                    collection=db[Collection(row["bezug"]["sammlung"])],
                    db_filter={"_id": row["bezug"]["id"]},
                    update={"$set": {pfad: [token_hash]}} if row["link"]["ersetzt"] else {"$addToSet": {pfad: token_hash}},
                    session=session,
                    return_document=ReturnDocument.BEFORE,
                )
            except DocumentNotFoundError:
                entfallen.append(row["_id"])
                continue
            tokens[row["_id"]] = raw

        if gesperrt:
            await patch_many_in_db(
                collection=postausgang_collection,
                db_filter={"_id": {"$in": gesperrt}},
                update=final_update("gesperrt", now=now),
                session=session,
            )
        if entfallen:
            await patch_many_in_db(
                collection=postausgang_collection,
                db_filter={"_id": {"$in": entfallen}},
                update=final_update("entfallen", now=now),
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
            update={"$set": {"beanspruchung": beanspruchung, "beansprucht_bis": now + BEANSPRUCHUNG_DAUER}, "$inc": {"versuche": 1}},
            session=session,
        )

        return (
            [
                FLPostausgangAusgabe(
                    id=row["_id"],
                    an=row["an"],
                    daten=row["daten"],
                    token=tokens.get(row["_id"]),
                    geheim=row["geheim"],
                    versuch=row["versuche"] + 1,
                )
                for row in handed
            ],
            beanspruchung,
            overdue.modified_count,
        )

    async with transaction_session(db_client) as session:
        mails, beanspruchung, aufgegeben = await session.with_transaction(claim)

    return FLPostausgangAusgabeResponse(
        beanspruchung=beanspruchung,
        beansprucht_bis=None if beanspruchung is None else now + BEANSPRUCHUNG_DAUER,
        mails=mails,
        aufgegeben=aufgegeben,
    )


@router.post("/ergebnis", response_model=FLPostausgangErgebnisResponse, summary="Settle the mails a claim handed out")
async def post_ergebnis(
    ergebnis_data: Annotated[FLPostausgangErgebnisPayload, Body()],
    postausgang_collection: PostausgangCollection,
    db_client: DBClient,
    now: datetime = Depends(get_germany_now),
) -> FLPostausgangErgebnisResponse:
    """
    Settle each named mail the named claim still holds, by the outcome of its send, and nothing else.

    `gesendet` records the provider's message id, which every later event about the message names; `zurueckgehalten` a
    deployment that sends no mail; `aufgeben` a refusal every send would meet, any 4xx but a 429. `wiederholen`, for a
    429, a 5xx or a send that never reached the provider, hands the mail back for a drain a minute from now, or gives it
    up where it has grown past its deadline; a mail of the sign-in library is given up at once, its library's repair
    being a fresh one. A mail the claim does not hold -- unknown,
    settled already, or claimed since by another drain after this claim lapsed -- is left alone and counted in `ignoriert`.
    A repeated id counts once, by its first outcome. One transaction; a settled row keeps no facts and no secret.
    """

    outcomes: dict[Any, FLPostausgangErgebnis] = {}
    for ergebnis in ergebnis_data.ergebnisse:
        outcomes.setdefault(ergebnis.id, ergebnis)

    async def settle(session: AsyncClientSession) -> FLPostausgangErgebnisResponse:
        held = await pull_many_from_db(
            collection=postausgang_collection,
            db_filter={"_id": {"$in": list(outcomes)}, "beanspruchung": ergebnis_data.beanspruchung, "stand": "offen"},
            limit=len(outcomes),
            projection=["_id", "art"],
            session=session,
        )
        by_outcome: dict[str, list[Any]] = {"gesendet": [], "wiederholen": [], "aufgeben": [], "zurueckgehalten": []}
        for row in held:
            ergebnis = outcomes[row["_id"]].ergebnis
            by_outcome["aufgeben" if ergebnis == "wiederholen" and row["art"] in ANMELDE_ARTEN else ergebnis].append(row["_id"])

        for row_id in by_outcome["gesendet"]:
            await patch_many_in_db(
                collection=postausgang_collection,
                db_filter={"_id": row_id, "stand": "offen"},
                update=final_update("gesendet", now=now, nachricht_id=outcomes[row_id].nachricht_id),
                session=session,
            )

        async def settled(ids: list[Any], update: Mapping[str, Any], **narrowed: Any) -> int:
            if not ids:
                return 0
            result = await patch_many_in_db(
                collection=postausgang_collection, db_filter={"_id": {"$in": ids}, "stand": "offen", **narrowed}, update=update, session=session
            )
            return result.modified_count

        zurueckgehalten = await settled(by_outcome["zurueckgehalten"], final_update("zurueckgehalten", now=now))
        aufgegeben = await settled(by_outcome["aufgeben"], final_update("aufgegeben", now=now))
        aufgegeben += await settled(by_outcome["wiederholen"], final_update("aufgegeben", now=now), frist={"$lte": now})
        wiederholt = await settled(by_outcome["wiederholen"], retry_update(now=now), frist={"$gt": now})

        return FLPostausgangErgebnisResponse(
            gesendet=len(by_outcome["gesendet"]),
            wiederholt=wiederholt,
            aufgegeben=aufgegeben,
            zurueckgehalten=zurueckgehalten,
            ignoriert=len(outcomes) - len(held),
        )

    async with transaction_session(db_client) as session:
        return await session.with_transaction(settle)


@router.post("/anmeldung", response_model=FLPostausgangAnmeldungResponse, summary="Owe one mail of the sign-in library")
async def post_anmeldung(
    anmeldung_data: Annotated[FLPostausgangAnmeldungPayload, Body()],
    postausgang_collection: PostausgangCollection,
    db_client: DBClient,
    now: datetime = Depends(get_germany_now),
) -> FLPostausgangAnmeldungResponse:
    """
    Owe one mail the sign-in library sends -- the code, a passkey notice, the deletion link -- to the address named.

    A replay of the same `schluessel` writes nothing and answers the row its first call wrote. `geheim` is stored as it
    arrives, encrypted under a key this service never holds, and dropped once the mail is settled; `gueltig_bis` is both
    the last moment a hand-out may send it and the moment the row is deleted, settled or not.
    """

    async def owe(session: AsyncClientSession) -> FLPostausgangAnmeldungResponse:
        row_id = await enqueue_mail(
            postausgang_collection=postausgang_collection,
            session=session,
            schluessel=anmeldung_data.schluessel,
            an=anmeldung_data.an,
            daten=anmeldung_data.daten,
            now=now,
            geheim=anmeldung_data.geheim,
            gueltig_bis=anmeldung_data.gueltig_bis,
        )
        return FLPostausgangAnmeldungResponse(id=row_id)

    async with transaction_session(db_client) as session:
        return await session.with_transaction(owe)


@router.post("/ereignis", response_model=FLPostausgangEreignisResponse, summary="Record one delivery event on its mail's row")
async def post_ereignis(
    ereignis_data: Annotated[FLPostausgangEreignisPayload, Body()],
    postausgang_collection: PostausgangCollection,
) -> FLPostausgangEreignisResponse:
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
            "zustellung.stand": {"$in": list(FOLGT_AUF[ereignis_data.stand])},
        },
        update={"$set": {"zustellung": {"stand": ereignis_data.stand, "grund": ereignis_data.grund, "am": ereignis_data.am}}},
    )

    return FLPostausgangEreignisResponse(angewendet=result.modified_count > 0)
