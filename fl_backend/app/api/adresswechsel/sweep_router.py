import secrets
from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any, Final

from fastapi import APIRouter, Body, Depends, Query
from pydantic import SecretStr
from pymongo import ASCENDING, AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.api.adresswechsel.crud import end_the_change_in_session, ending_line, queue_the_refusal_notice_in_session, take_effect_in_session
from app.api.adresswechsel.schemas import (
    FLAdresswechselAdressePayload,
    FLAdresswechselAdresseResponse,
    FLAdresswechselPostausgangArt,
    FLAdresswechselPostausgangResponse,
    FLAdresswechselPostausgangZeile,
    FLAdresswechselSweepParams,
    FLAdresswechselSweepResponse,
    FLAdresswechselZugestelltPayload,
    FLAdresswechselZugestelltResponse,
)
from app.api.adresswechsel.services import (
    GEHALTEN,
    LIVE_TERMS,
    build_due_terms,
    build_lapsed_terms,
    build_parked_terms,
    ist_abgelaufen,
)
from app.api.berechtigungen.services import BEANSPRUCHUNG_DAUER, VERSUCHE_HOECHSTENS
from app.api.bewerbungen.services import hash_token
from app.api.identitaet.lookup import RecordCollections, SubjektLookup
from app.api.sperrliste.lookup import BanList, SperrlisteLookup, sperrliste_saison
from app.core.collections import Collection
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import aggregate_many_from_db, erase_many_from_db, patch_many_in_db, pull_many_from_db, pull_one_from_db
from app.core.dependencies import (
    AdressankerCollection,
    AdresswechselCollection,
    AdresswechselPostausgangCollection,
    AktionenCollection,
    BerechtigungenAngekuendigtCollection,
    BerechtigungenAntraegeCollection,
    BerechtigungenCollection,
    BerechtigungenPostausgangCollection,
    BewerbungenCollection,
    DBClient,
    DrosselungCollection,
    EinladungenCollection,
    RegistrierungenCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SperrlisteCollection,
    SpielbestaetigungenCollection,
    SpielerCollection,
    get_germany_now,
)
from app.core.exception_handlers import DATABASE_FAILED, DUPLICATE_KEY_RESPONSE, UNKNOWN_OUTCOME, stores_nothing
from app.core.exceptions import DocumentNotFoundException
from app.core.journal import Journal
from app.core.logging import fl_logger
from app.core.recording import log_stamp
from app.core.security import bind_system_actor, verify_access_system
from app.core.transactions import UNKNOWN_COMMIT_RESULT, diagnosis_of, transaction_session
from app.shared.folding import sign_in_identifier
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT

# System tier and the system actor: the clock ends a lapsed change and makes a due one take effect, and no administrator
# pressed anything.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/adresswechsel/sweep",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)

# The largest share inside `app/core/middlewares.py :: REQUEST_DEADLINE_S` for the
# dearest change over a 40,000-row action log a due change reads whole; the arithmetic is
# `fl_backend/tests/api/test_adresswechsel_sweep_refusal.py`'s, its counts pinned on the wire; a dearer change meets the deadline.
ADRESSWECHSEL_PER_PASS: Final = 4


def _pipeline(*, now: datetime, nach: Any, groesse: int) -> list[dict[str, Any]]:
    """Every lapsed and due change after `nach`, in `_id` order, at most `groesse`, with the count, as ONE document.

    No index serves the instants: the collection holds live changes and recent tombstones alone.
    """

    seite: list[dict[str, Any]] = [{"$sort": {"_id": 1}}, {"$limit": groesse}]

    return [
        {"$match": {"$or": [build_lapsed_terms(now), build_due_terms(now)]}},
        # A change parked on an owed approval while its grant stands is neither due nor the pass's remainder.
        {
            "$lookup": {
                "from": Collection.BERECHTIGUNGEN,
                "localField": "adresse",
                "foreignField": "adresse",
                "pipeline": [{"$project": {"_id": 1}}],
                "as": GEHALTEN,
            }
        },
        {"$match": {"$nor": [build_parked_terms(now)]}},
        # What `ist_abgelaufen` labels a lapse by: a confirmed change whose approval's week passed holds a `wirksam_ab` too,
        # and is no due change for that.
        {"$project": {"_id": 1, "gueltig_bis": 1, "genehmigung.bis": 1, "genehmigung.genehmigt_am": 1}},
        {"$facet": {"seite": seite if nach is None else [{"$match": {"_id": {"$gt": nach}}}, *seite], "anzahl": [{"$count": "anzahl"}]}},
    ]


async def _end_the_lapsed_change(
    row: Mapping[str, Any],
    *,
    adresswechsel_collection: AsyncCollection,
    adresswechsel_postausgang_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    db: AsyncMongoClient,
    now: datetime,
    stamp: str,
) -> None:
    """One change in a transaction of its own, judged again there: `DocumentNotFoundException` where it has not lapsed.

    Unjournalled: restored, a lapsed change lapses again at the next pass.
    """

    async def end_the_lapsed_change(session: AsyncClientSession) -> None:
        stored = await end_the_change_in_session(
            adresswechsel_collection=adresswechsel_collection,
            aktionen_collection=aktionen_collection,
            db_filter={"_id": row["_id"], **build_lapsed_terms(now)},
            art="abgelaufen",
            now=now,
            stamp=stamp,
            session=session,
        )
        # A confirmed change lapsing on its owed approval: its new mailbox was told it waits on the administration, so it is
        # told it did not take effect, as a refused due change's is.
        if stored.get("bestaetigt_am") is not None:
            await queue_the_refusal_notice_in_session(
                stored, adresswechsel_postausgang_collection=adresswechsel_postausgang_collection, now=now, session=session
            )

    async with transaction_session(db) as session:
        await session.with_transaction(end_the_lapsed_change)


async def _make_the_due_change_take_effect(
    row: Mapping[str, Any],
    *,
    records: RecordCollections,
    sperrliste: BanList,
    massgebliche_saison_id: str | None,
    adresswechsel_collection: AsyncCollection,
    spieler_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    spielbestaetigungen_collection: AsyncCollection,
    berechtigungen_collection: AsyncCollection,
    berechtigungen_angekuendigt_collection: AsyncCollection,
    berechtigungen_postausgang_collection: AsyncCollection,
    berechtigungen_antraege_collection: AsyncCollection,
    einladungen_collection: AsyncCollection,
    sperrliste_collection: AsyncCollection,
    adresswechsel_postausgang_collection: AsyncCollection,
    drosselung_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    adressanker_collection: AsyncCollection,
    db: AsyncMongoClient,
    schluessel: SecretStr,
    now: datetime,
    stamp: str,
) -> FLAdresswechselPostausgangArt | None:
    """One due change in its own transaction, judged again as its confirmation was.

    Answers which notice it queued, or `None` where it waits on an approval; `DocumentNotFoundException` where stopped,
    discarded or replaced since the page was read.
    """

    journal = Journal()

    @journal.attempted
    async def take_effect(session: AsyncClientSession) -> FLAdresswechselPostausgangArt | None:
        record = await pull_one_from_db(
            collection=adresswechsel_collection, db_filter={"_id": row["_id"], **build_due_terms(now)}, session=session
        )
        urteil, wirksam = await take_effect_in_session(
            record=record,
            records=records,
            sperrliste=sperrliste,
            massgebliche_saison_id=massgebliche_saison_id,
            adresswechsel_collection=adresswechsel_collection,
            spieler_collection=spieler_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            saison_teams_collection=saison_teams_collection,
            bewerbungen_collection=bewerbungen_collection,
            registrierungen_collection=registrierungen_collection,
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            berechtigungen_collection=berechtigungen_collection,
            berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
            berechtigungen_postausgang_collection=berechtigungen_postausgang_collection,
            berechtigungen_antraege_collection=berechtigungen_antraege_collection,
            einladungen_collection=einladungen_collection,
            sperrliste_collection=sperrliste_collection,
            adresswechsel_postausgang_collection=adresswechsel_postausgang_collection,
            drosselung_collection=drosselung_collection,
            aktionen_collection=aktionen_collection,
            adressanker_collection=adressanker_collection,
            schluessel=schluessel,
            now=now,
            journal=journal,
            session=session,
            # Confirmed and due: its new mailbox was told it waits on this pass.
            mitteilen=True,
        )
        if wirksam:
            return "wirksam"
        # Waits on an approval: one owed while its address holds a grant again since the page's read, or one given whose
        # approver could not give it now, taken off.
        if urteil.wartet:
            return None

        # Every judgement the confirmation makes, at the end of the waiting time as at its start.
        if not urteil.leer:
            await end_the_change_in_session(
                adresswechsel_collection=adresswechsel_collection,
                aktionen_collection=aktionen_collection,
                db_filter={"_id": record["_id"]},
                art="verworfen",
                now=now,
                stamp=stamp,
                session=session,
            )
            # Journalled, as an administrator's discard is: the cause refusing it may postdate a snapshot a restore brings
            # the change back from, due.
            journal.note(
                ending_line(
                    art="adresswechsel_verworfen_mitgeteilt",
                    neue=str(record["email"]),
                    record_id=record["_id"],
                    am=stamp,
                    schluessel=schluessel,
                )
            )
            await queue_the_refusal_notice_in_session(
                record, adresswechsel_postausgang_collection=adresswechsel_postausgang_collection, now=now, session=session
            )
        return "verworfen"

    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(take_effect)


@router.post(
    "",
    response_model=FLAdresswechselSweepResponse,
    summary="End the lapsed address changes, and make the due ones take effect",
    responses={409: DUPLICATE_KEY_RESPONSE},
)
async def sweep_adresswechsel(
    params: Annotated[FLAdresswechselSweepParams, Query()],
    records: SubjektLookup,
    adresswechsel_collection: AdresswechselCollection,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    registrierungen_collection: RegistrierungenCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    berechtigungen_postausgang_collection: BerechtigungenPostausgangCollection,
    berechtigungen_antraege_collection: BerechtigungenAntraegeCollection,
    einladungen_collection: EinladungenCollection,
    sperrliste_collection: SperrlisteCollection,
    adresswechsel_postausgang_collection: AdresswechselPostausgangCollection,
    drosselung_collection: DrosselungCollection,
    sperrliste: SperrlisteLookup,
    aktionen_collection: AktionenCollection,
    adressanker_collection: AdressankerCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLAdresswechselSweepResponse:
    """
    End a bounded share of the live changes whose waiting step lapsed, and make the due ones take effect.

    **A lapsed change** -- its link, the approval it asked of the address on file, or its grant's approval by another
    administrator -- ends as `abgelaufen`: its address and reason out of the record and every log image of it
    (`entfernt`). **A due change**, one whose waiting time has ended and whose grant's move, where its address still
    holds the grant, was approved, is judged again as its confirmation was: a ban on either address, another pupil
    signing in on the new one, a grant its approval does not cover, a grant at the new address, or nothing left to move
    ends it discarded, and
    `verworfen` counts it, its new address queued to be told it did not take effect and never why; otherwise
    everything the replaced address holds moves, and `wirksam` counts it, its completion notice queued. The notices are
    `POST /adresswechsel/sweep/postausgang`'s to claim, queued in each change's own transaction, so none rides on this answer.

    Each change is handled in a transaction of its own that judges it again, so one confirmed, stopped, discarded or
    replaced since this call read it is left standing. **A pass is a run of calls, each handing the next the `nach` the last
    answered**, the first naming none; it ends at the call answering `nach` null. A call reaches at most a fixed share of the
    changes after `nach`, in `_id` order, and the pass holds no state on the server. A change whose handling fails is
    logged by its id and passed, holding back nobody behind it; it stays due, and the next pass tries it again. Where the
    request's deadline cuts the call, it stops at that change, warns once, and answers what it did. `verbleibend` counts
    the changes standing due after the call, so it is no stopping condition.
    """

    [gelesen] = await aggregate_many_from_db(
        collection=adresswechsel_collection,
        # One past the share, so a call ending exactly at the share's last row can tell whether any follow.
        pipeline=_pipeline(now=germany_now, nach=params.nach, groesse=ADRESSWECHSEL_PER_PASS + 1),
    )
    # The lapse and the due terms are disjoint, so the lapse's own judgement parts them.
    seite = [{"_id": row["_id"], "faellig": not ist_abgelaufen(row, now=germany_now)} for row in gelesen["seite"]]
    anzahl = sum(row["anzahl"] for row in gelesen["anzahl"])
    stamp = log_stamp(germany_now)
    # Outside every change's transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`), and only where a due change
    # asks the ban list: a page of lapses reads no season.
    massgebliche_saison_id = await sperrliste_saison(sperrliste) if any(row["faellig"] for row in seite[:ADRESSWECHSEL_PER_PASS]) else None

    entfernt, uebersprungen = 0, 0
    verworfen, wirksam = 0, 0
    erreicht: Any = None
    abgebrochen = False
    for row in seite[:ADRESSWECHSEL_PER_PASS]:
        erreicht = row["_id"]
        welche, was = ("due", "effect") if row["faellig"] else ("lapsed", "end")
        # Each caught outside the change's session.
        try:
            if row["faellig"]:
                ergebnis = await _make_the_due_change_take_effect(
                    row,
                    records=records,
                    sperrliste=sperrliste,
                    massgebliche_saison_id=massgebliche_saison_id,
                    adresswechsel_collection=adresswechsel_collection,
                    spieler_collection=spieler_collection,
                    schiedsrichter_collection=schiedsrichter_collection,
                    saison_teams_collection=saison_teams_collection,
                    bewerbungen_collection=bewerbungen_collection,
                    registrierungen_collection=registrierungen_collection,
                    spielbestaetigungen_collection=spielbestaetigungen_collection,
                    berechtigungen_collection=berechtigungen_collection,
                    berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
                    berechtigungen_postausgang_collection=berechtigungen_postausgang_collection,
                    berechtigungen_antraege_collection=berechtigungen_antraege_collection,
                    einladungen_collection=einladungen_collection,
                    sperrliste_collection=sperrliste_collection,
                    adresswechsel_postausgang_collection=adresswechsel_postausgang_collection,
                    drosselung_collection=drosselung_collection,
                    aktionen_collection=aktionen_collection,
                    adressanker_collection=adressanker_collection,
                    db=db,
                    schluessel=config.sperrliste_schluessel,
                    now=germany_now,
                    stamp=stamp,
                )
            else:
                await _end_the_lapsed_change(
                    row,
                    adresswechsel_collection=adresswechsel_collection,
                    adresswechsel_postausgang_collection=adresswechsel_postausgang_collection,
                    aktionen_collection=aktionen_collection,
                    db=db,
                    now=germany_now,
                    stamp=stamp,
                )
        except DocumentNotFoundException:
            # The filter is the judgement: confirmed, stopped, discarded or sent a fresh link since the read, and not due.
            uebersprungen += 1
            continue
        # Any class, or the next pass stops at this change again and holds back every one behind it;
        # not `BaseException`, so a cancellation still ends the call.
        except Exception as failure:
            # The only branch an unanswered commit reaches: `with_transaction` retries one until the deadline and raises
            # it as a timeout keeping the label.
            if isinstance(failure, PyMongoError) and failure.timeout:
                ungewiss = failure.has_error_label(UNKNOWN_COMMIT_RESULT)
                # Below the handler's ERROR: no record is at fault, and every later change would fail the same way.
                fl_logger.warning(
                    f"Database deadline passed at the {welche} address change {row['_id']}"
                    f"{f', its {was} unanswered' if ungewiss else ''}: the call stops, and the rest stay due",
                    extra={"error_code": UNKNOWN_OUTCOME if ungewiss else DATABASE_FAILED},
                )
                abgebrochen = True
                break

            # The id and what locates the failure, never an address this pass handles.
            code, diagnosis = diagnosis_of(failure)
            fl_logger.error(f"The {welche} address change {row['_id']} saw no {was}: {diagnosis}", extra={"error_code": code})
            continue

        if not row["faellig"]:
            entfernt += 1
        elif ergebnis is None:
            # Waiting on an approval, as the pipeline parks one: neither an effect nor the remainder.
            uebersprungen += 1
        elif ergebnis == "verworfen":
            verworfen += 1
        else:
            wirksam += 1

    return FLAdresswechselSweepResponse(
        entfernt=entfernt,
        verworfen=verworfen,
        wirksam=wirksam,
        verbleibend=anzahl - entfernt - verworfen - wirksam - uebersprungen,
        nach=erreicht if abgebrochen or len(seite) > ADRESSWECHSEL_PER_PASS else None,
    )


@router.post(
    "/postausgang",
    response_model=FLAdresswechselPostausgangResponse,
    summary="Claim the notices the address changes' ends still owe",
)
async def post_adresswechsel_postausgang(
    adresswechsel_postausgang_collection: AdresswechselPostausgangCollection,
    db: DBClient,
    now: datetime = Depends(get_germany_now),
) -> FLAdresswechselPostausgangResponse:
    """
    Claim, oldest first and a page at a time, every owed notice no claim holds or whose claim has lapsed, for ten minutes.

    Each end owing a notice queued it in its own transaction: an effect its completion notice and its sign-in account's
    carry, a due change the pass refused its new address's notice. A second call inside the lease is answered none of
    them; the caller delivers each and hands the ids it delivered, with `beanspruchung`, to
    `POST /adresswechsel/sweep/postausgang/zugestellt`, and where the lease lapses first the next call claims them again,
    so a notice is delivered at least once. A notice handed out past the grants' attempt cap is answered `aufgegeben`:
    the caller delivers nothing, logs it by id and stamps it. Server to server alone: the answer names addresses.
    """

    async def claim(session: AsyncClientSession) -> tuple[list[Mapping[str, Any]], str | None]:
        claimable = await pull_many_from_db(
            collection=adresswechsel_postausgang_collection,
            db_filter={"$or": [{"beansprucht_bis": None}, {"beansprucht_bis": {"$lte": now}}]},
            sort_by=[("erfasst_am", ASCENDING), ("_id", ASCENDING)],
            limit=LIST_LIMIT_DEFAULT,
            session=session,
        )
        if not claimable:
            return [], None

        token = secrets.token_urlsafe(24)
        # Every claimed row written, so two overlapping calls conflict and the retry sees them held; the count rises in
        # this write, so a retried claim counts once.
        await patch_many_in_db(
            collection=adresswechsel_postausgang_collection,
            db_filter={"_id": {"$in": [row["_id"] for row in claimable]}},
            update={"$set": {"beanspruchung": token, "beansprucht_bis": now + BEANSPRUCHUNG_DAUER}, "$inc": {"versuche": 1}},
            session=session,
        )

        return claimable, token

    async with transaction_session(db) as session:
        claimable, token = await session.with_transaction(claim)

    return FLAdresswechselPostausgangResponse(
        beanspruchung=token,
        beansprucht_bis=None if token is None else now + BEANSPRUCHUNG_DAUER,
        mitteilungen=[
            FLAdresswechselPostausgangZeile.model_validate(
                # The row as read before this claim raised its count.
                {**row, "id": row["_id"], "aufgegeben": row["versuche"] + 1 > VERSUCHE_HOECHSTENS}
            )
            for row in claimable
        ],
    )


@router.post(
    "/postausgang/zugestellt",
    response_model=FLAdresswechselZugestelltResponse,
    summary="Remove the delivered notices a claim holds",
)
async def post_adresswechsel_zugestellt(
    zugestellt_data: Annotated[FLAdresswechselZugestelltPayload, Body()],
    adresswechsel_postausgang_collection: AdresswechselPostausgangCollection,
    db: DBClient,
) -> FLAdresswechselZugestelltResponse:
    """
    Remove each named notice the named claim still holds, and nothing else.

    A notice the claim does not hold -- unknown, removed already, or claimed since by another call after this claim
    lapsed -- is left alone and counted in `ignoriert`. A repeated id counts once. One transaction, imageless: a row
    names addresses, and the log keeps no image of its removal.
    """

    ids = sorted(set(zugestellt_data.ids))

    async def remove(session: AsyncClientSession) -> int:
        held = await pull_many_from_db(
            collection=adresswechsel_postausgang_collection,
            db_filter={"_id": {"$in": ids}, "beanspruchung": zugestellt_data.beanspruchung},
            limit=len(ids),
            projection=["_id"],
            session=session,
        )
        if not held:
            return 0
        removed = await erase_many_from_db(
            collection=adresswechsel_postausgang_collection, db_filter={"_id": {"$in": [row["_id"] for row in held]}}, session=session
        )

        return removed.deleted_count

    async with transaction_session(db) as session:
        zugestellt = await session.with_transaction(remove)

    return FLAdresswechselZugestelltResponse(zugestellt=zugestellt, ignoriert=len(ids) - zugestellt)


@router.post(
    "/adresse",
    response_model=FLAdresswechselAdresseResponse,
    summary="Say which address a live change would move to",
    dependencies=[Depends(stores_nothing)],
)
async def get_adresswechsel_adresse(
    adresse_data: Annotated[FLAdresswechselAdressePayload, Body()],
    adresswechsel_collection: AdresswechselCollection,
) -> FLAdresswechselAdresseResponse:
    """
    Answer the new address of the live change the new mailbox's link token or the change's id names, folded to the sign-in identifier.

    For the frontend's server alone, which asks its sign-in store whether an account stands there before a press, a link's
    view or an approval; the link's own view never serves the address. A token or id naming no live change -- unknown,
    ended, or the stop link's token -- is answered null rather than refused, so a lapsed or answered link costs no
    error. Stores nothing, and a POST for `POST /identitaet/subjekt`'s reason: the token travels in the body, and the
    address only in the answer.
    """

    db_filter = (
        {"_id": adresse_data.adresswechsel_id, **LIVE_TERMS}
        if adresse_data.token is None
        else {"token_hash": hash_token(adresse_data.token), **LIVE_TERMS}
    )
    record = await adresswechsel_collection.find_one(db_filter, projection={"email": 1})

    return FLAdresswechselAdresseResponse(email=None if record is None else sign_in_identifier(str(record["email"])))
