from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any, Final

from fastapi import APIRouter, Depends, Query
from pydantic import SecretStr
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.api.identitaet.lookup import RecordCollections, SubjektLookup
from app.api.konto.adresswechsel import (
    Mitteilung,
    discard_the_change_in_session,
    ending_line,
    move_the_address_in_session,
    read_the_bestand,
    wirksam_line,
)
from app.api.schiedsrichter.schemas import FLAdresswechselSweepParams, FLSchiedsrichterAdresswechselSweepResponse
from app.api.schiedsrichter.services import adresswechsel_adressen, build_due_adresswechsel_filter, build_lapsed_adresswechsel_filter
from app.api.sperrliste.lookup import BanList, SperrlisteLookup, adressen_gesperrt, sperrliste_saison
from app.api.spieler.crud import another_pupil_holds
from app.api.spieler.schemas import FLAdresswechselMitteilung
from app.api.spieler.services import (
    build_due_spieler_adresswechsel_filter,
    build_lapsed_spieler_adresswechsel_filter,
    build_selbst_pupil_filter,
    holds_an_address,
    spieler_adresswechsel_adressen,
)
from app.core.collections import Collection
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import aggregate_many_from_db, pull_one_from_db
from app.core.dependencies import (
    AdressankerCollection,
    AktionenCollection,
    BewerbungenCollection,
    DBClient,
    RegistrierungenCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielbestaetigungenCollection,
    SpielerCollection,
    get_germany_now,
)
from app.core.exception_handlers import DATABASE_FAILED, DUPLICATE_KEY_RESPONSE, UNKNOWN_OUTCOME
from app.core.exceptions import DocumentNotFoundException
from app.core.journal import Journal
from app.core.logging import fl_logger
from app.core.recording import log_stamp
from app.core.security import bind_system_actor, verify_access_system
from app.core.transactions import UNKNOWN_COMMIT_RESULT, diagnosis_of, transaction_session
from app.shared.adresswechsel import ADRESSWECHSEL_FELD
from app.shared.folding import sign_in_identifier

# System tier and the system actor: the clock removes a lapsed change and makes a due one take effect, and no
# administrator pressed anything.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter/sweep",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)

# A due change moving a pupil row and a referee row: 21 commands at 37 ms round trip plus 1.84 ms (effects timed lower,
# 2026-10-20), sized inside `app/core/middlewares.py :: REQUEST_DEADLINE_S`; a dearer one meets that deadline
# (`docs/backend/spec.md :: I322`).
ADRESSWECHSEL_PER_PASS: Final = 12

# Which collection a row is read from, carried beside its id through the one page every kind shares.
SCHIEDSRICHTER, SPIELER = "schiedsrichter", "spieler"

_COLLECTION_OF: Final = {SCHIEDSRICHTER: Collection.SCHIEDSRICHTER, SPIELER: Collection.SPIELER}


def _pipeline(*, now: datetime, nach: Any, groesse: int) -> list[dict[str, Any]]:
    """Every lapsed and due change after `nach`, both lanes in one `_id` order, at most `groesse`, with the count, as ONE document.

    A driver's `ObjectId` is unique across both collections; no index serves the instants, both holding a league's people.
    """

    def kinds(art: str, lapsed: Mapping[str, Any], due: Mapping[str, Any]) -> list[dict[str, Any]]:
        return [
            {"$match": {"$or": [lapsed, due]}},
            {"$project": {"_id": 1, "art": {"$literal": art}, "faellig": {"$eq": [{"$type": f"${ADRESSWECHSEL_FELD}.wirksam_ab"}, "date"]}}},
        ]

    seite: list[dict[str, Any]] = [{"$sort": {"_id": 1}}, {"$limit": groesse}]

    return [
        *kinds(SCHIEDSRICHTER, build_lapsed_adresswechsel_filter(now=now), build_due_adresswechsel_filter(now=now)),
        {
            "$unionWith": {
                "coll": Collection.SPIELER,
                "pipeline": kinds(SPIELER, build_lapsed_spieler_adresswechsel_filter(now=now), build_due_spieler_adresswechsel_filter(now=now)),
            }
        },
        {"$facet": {"seite": seite if nach is None else [{"$match": {"_id": {"$gt": nach}}}, *seite], "anzahl": [{"$count": "anzahl"}]}},
    ]


async def _discard_the_lapsed_change(
    row: dict[str, Any],
    *,
    spieler_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    db: AsyncMongoClient,
    now: datetime,
    stamp: str,
) -> None:
    """One change in a transaction of its own, judged again there: `DocumentNotFoundException` where it has not lapsed."""

    db_filter = (
        build_lapsed_adresswechsel_filter(now=now, schiedsrichter_id=row["_id"])
        if row["art"] == SCHIEDSRICHTER
        else build_lapsed_spieler_adresswechsel_filter(now=now, spieler_id=row["_id"])
    )

    async def discard_the_lapsed_change(session: AsyncClientSession) -> None:
        await discard_the_change_in_session(
            collection=_COLLECTION_OF[row["art"]],
            spieler_collection=spieler_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            aktionen_collection=aktionen_collection,
            db_filter=db_filter,
            stamp=stamp,
            session=session,
        )

    async with transaction_session(db) as session:
        await session.with_transaction(discard_the_lapsed_change)


async def _make_the_due_change_take_effect(
    row: dict[str, Any],
    *,
    records: RecordCollections,
    spieler_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    sperrliste: BanList,
    massgebliche_saison_id: str | None,
    aktionen_collection: AsyncCollection,
    adressanker_collection: AsyncCollection,
    spielbestaetigungen_collection: AsyncCollection,
    db: AsyncMongoClient,
    schluessel: SecretStr,
    now: datetime,
    stamp: str,
) -> Mitteilung | None:
    """One due change in a transaction of its own, judged again there as its confirmation was; `None` where a judgement refused it.

    `DocumentNotFoundException` where it is not due: stopped, discarded or replaced since the page was read.
    """

    collection = _COLLECTION_OF[row["art"]]
    db_filter = (
        build_due_adresswechsel_filter(now=now, schiedsrichter_id=row["_id"])
        if row["art"] == SCHIEDSRICHTER
        else build_due_spieler_adresswechsel_filter(now=now, spieler_id=row["_id"])
    )
    journal = Journal()

    @journal.attempted
    async def take_effect(session: AsyncClientSession) -> Mitteilung | None:
        raw = await pull_one_from_db(
            collection=schiedsrichter_collection if row["art"] == SCHIEDSRICHTER else spieler_collection,
            db_filter=db_filter,
            projection={"email": 1, "kontakt.email": 1, ADRESSWECHSEL_FELD: 1},
            session=session,
        )
        neue, ersetzte = adresswechsel_adressen(raw) if row["art"] == SCHIEDSRICHTER else spieler_adresswechsel_adressen(raw)
        gesperrt = await adressen_gesperrt(sperrliste, [neue, ersetzte], massgebliche_saison_id=massgebliche_saison_id, session=session)
        pupil = await spieler_collection.find_one(
            build_selbst_pupil_filter(sign_in_identifier(ersetzte)), projection={"_id": 1}, session=session
        )
        vergeben = pupil is not None and await another_pupil_holds(
            spieler_collection=spieler_collection, identifier=sign_in_identifier(neue), spieler_id=pupil["_id"], session=session
        )
        bestand = await read_the_bestand(ersetzte, records=records, session=session)
        traeger = bestand.zeile(collection, row["_id"])

        # Every judgement the confirmation makes, at the end of the waiting time as at its start (`docs/backend/spec.md :: I795`).
        if bool(gesperrt) or vergeben or not holds_an_address(ersetzte) or traeger is None:
            await discard_the_change_in_session(
                collection=collection,
                spieler_collection=spieler_collection,
                schiedsrichter_collection=schiedsrichter_collection,
                aktionen_collection=aktionen_collection,
                db_filter=db_filter,
                stamp=stamp,
                session=session,
            )
            # Journalled, as an administrator's discard is: the ban or the other pupil refusing it may postdate a snapshot a
            # restore brings the change back from, due.
            journal.note(
                ending_line(
                    art="adresswechsel_verworfen", neue=neue, collection=collection, record_id=row["_id"], am=stamp, schluessel=schluessel
                )
            )
            return None

        mitteilung = await move_the_address_in_session(
            bestand=bestand,
            traeger=traeger,
            neue=neue,
            spieler_collection=spieler_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            saison_teams_collection=saison_teams_collection,
            bewerbungen_collection=bewerbungen_collection,
            registrierungen_collection=registrierungen_collection,
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            aktionen_collection=aktionen_collection,
            adressanker_collection=adressanker_collection,
            schluessel=schluessel,
            stamp=stamp,
            session=session,
        )
        journal.note(wirksam_line(neue=neue, traeger=traeger, now=now, schluessel=schluessel))

        return mitteilung

    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(take_effect)


@router.post(
    "/adresswechsel",
    response_model=FLSchiedsrichterAdresswechselSweepResponse,
    summary="Remove the lapsed address changes, and make the due ones take effect",
    responses={409: DUPLICATE_KEY_RESPONSE},
)
async def sweep_adresswechsel(
    params: Annotated[FLAdresswechselSweepParams, Query()],
    records: SubjektLookup,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    registrierungen_collection: RegistrierungenCollection,
    sperrliste: SperrlisteLookup,
    aktionen_collection: AktionenCollection,
    adressanker_collection: AdressankerCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterAdresswechselSweepResponse:
    """
    Remove a bounded share of the pending changes whose waiting step lapsed, and make the due ones take effect, a referee's and a pupil's.

    **A lapsed change** -- its link, or the approval it asked of the address on file -- goes as an administrator's discard
    takes it: the block, and its address out of every log image of that row, the rest of each image standing (`entfernt`).
    **A due change**, one an administrator started with a reason whose waiting time has ended, is judged again as its
    confirmation was: a ban on either address, a replaced address held by nobody, or another pupil signing in on the new
    one removes it as a lapse is (`verworfen`); otherwise every record of the replaced address moves, and `wirksam` names
    whom the caller mails the completion notice, never the new address.

    Each change is handled in a transaction of its own that judges it again, so one confirmed, stopped, discarded or
    replaced since this call read it is left standing. **A pass is a run of calls, each handing the next the `nach` the last
    answered**, the first naming none; it ends at the call answering `nach` null. A call reaches at most a fixed share of the
    changes after `nach`, both lanes in one `_id` order, and the pass holds no state on the server. A change whose handling
    fails is logged by its row's id and passed, holding back nobody behind it; it stays due, and the next pass tries it
    again. Where the request's deadline cuts the call, it stops at that change, warns once, and answers what it did.
    `verbleibend` counts the changes standing due after the call, so it is no stopping condition.
    """

    [gelesen] = await aggregate_many_from_db(
        collection=schiedsrichter_collection,
        # One past the share, so a call ending exactly at the share's last row can tell whether any follow.
        pipeline=_pipeline(now=germany_now, nach=params.nach, groesse=ADRESSWECHSEL_PER_PASS + 1),
    )
    seite, anzahl = gelesen["seite"], sum(row["anzahl"] for row in gelesen["anzahl"])
    stamp = log_stamp(germany_now)
    # Outside every row's transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`), and only where a due change asks
    # the ban list: a page of lapses reads no season.
    massgebliche_saison_id = await sperrliste_saison(sperrliste) if any(row["faellig"] for row in seite[:ADRESSWECHSEL_PER_PASS]) else None

    entfernt, verworfen, uebersprungen = 0, 0, 0
    wirksam: list[FLAdresswechselMitteilung] = []
    erreicht: Any = None
    abgebrochen = False
    for row in seite[:ADRESSWECHSEL_PER_PASS]:
        erreicht = row["_id"]
        wessen = "referee" if row["art"] == SCHIEDSRICHTER else "pupil"
        welche, was = ("due", "effect") if row["faellig"] else ("lapsed", "removal")
        # Each caught outside the row's session (`docs/backend/spec.md :: I539`).
        try:
            if row["faellig"]:
                mitteilung = await _make_the_due_change_take_effect(
                    row,
                    records=records,
                    spieler_collection=spieler_collection,
                    schiedsrichter_collection=schiedsrichter_collection,
                    saison_teams_collection=saison_teams_collection,
                    bewerbungen_collection=bewerbungen_collection,
                    registrierungen_collection=registrierungen_collection,
                    sperrliste=sperrliste,
                    massgebliche_saison_id=massgebliche_saison_id,
                    aktionen_collection=aktionen_collection,
                    adressanker_collection=adressanker_collection,
                    spielbestaetigungen_collection=spielbestaetigungen_collection,
                    db=db,
                    schluessel=config.sperrliste_schluessel,
                    now=germany_now,
                    stamp=stamp,
                )
            else:
                await _discard_the_lapsed_change(
                    row,
                    spieler_collection=spieler_collection,
                    schiedsrichter_collection=schiedsrichter_collection,
                    aktionen_collection=aktionen_collection,
                    db=db,
                    now=germany_now,
                    stamp=stamp,
                )
        except DocumentNotFoundException:
            # The filter is the judgement: confirmed, stopped, discarded or sent a fresh link since the read, and not due.
            uebersprungen += 1
            continue
        # Any class, or the next pass stops at this change again and holds back every one behind it
        # (`docs/backend/spec.md :: I717`); not `BaseException`, so a cancellation still ends the call.
        except Exception as failure:
            # The only branch an unanswered commit reaches: `with_transaction` retries one until the deadline and raises
            # it as a timeout keeping the label.
            if isinstance(failure, PyMongoError) and failure.timeout:
                ungewiss = failure.has_error_label(UNKNOWN_COMMIT_RESULT)
                # Below the handler's ERROR: no record is at fault, and every later change would fail the same way.
                fl_logger.warning(
                    f"Database deadline passed at the {welche} address change of {wessen} {row['_id']}"
                    f"{f', its {was} unanswered' if ungewiss else ''}: the call stops, and the rest stay due",
                    extra={"error_code": UNKNOWN_OUTCOME if ungewiss else DATABASE_FAILED},
                )
                abgebrochen = True
                break

            # The id and what locates the failure, never an address this pass handles.
            code, diagnosis = diagnosis_of(failure)
            fl_logger.error(f"The {welche} address change of {wessen} {row['_id']} saw no {was}: {diagnosis}", extra={"error_code": code})
            continue

        if not row["faellig"]:
            entfernt += 1
        elif mitteilung is None:
            verworfen += 1
        else:
            wirksam.append(FLAdresswechselMitteilung(bisherige_email=mitteilung.bisherige_email, vorname=mitteilung.vorname))

    return FLSchiedsrichterAdresswechselSweepResponse(
        entfernt=entfernt,
        verworfen=verworfen,
        wirksam=wirksam,
        verbleibend=anzahl - entfernt - verworfen - len(wirksam) - uebersprungen,
        nach=erreicht if abgebrochen or len(seite) > ADRESSWECHSEL_PER_PASS else None,
    )
