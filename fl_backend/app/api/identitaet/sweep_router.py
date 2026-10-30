from datetime import datetime
from typing import Annotated, Any, Final

from fastapi import APIRouter, Depends, Query
from pydantic import SecretStr
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.api.identitaet.crud import erase_if_still_due, faellige_seite, saison_statuses
from app.api.identitaet.schemas import FLErasure, FLLoeschungLaufParams, FLLoeschungLaufResponse
from app.api.identitaet.services import abgeschlossene_saison_id, ohne_passende_adresse
from app.api.sperrliste.lookup import BanList, SperrlisteLookup
from app.core.codes import Code
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.dependencies import (
    AdresswechselCollection,
    AdresswechselPostausgangCollection,
    AktionenCollection,
    BerechtigungenAngekuendigtCollection,
    BerechtigungenAntraegeCollection,
    BerechtigungenCollection,
    BerechtigungenPostausgangCollection,
    BewerbungenCollection,
    DBClient,
    EinladungenCollection,
    RegistrierungenCollection,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SperrlisteCollection,
    SpielberichteCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
    SpielerCollection,
    get_germany_now,
)
from app.core.logging import fl_logger
from app.core.recording import log_stamp
from app.core.security import bind_system_actor, verify_access_system
from app.core.transactions import UNKNOWN_COMMIT_RESULT, diagnosis_of, transaction_session

# System tier and the system actor, as the application sweep's router is: the rule deletes, whichever
# caller triggers it, and neither the hourly pass nor an activation's press holds a person's session here.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/identitaet/loeschung",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)

# Twenty commands a pupil, each the round trip plus at most 2.03 ms, timed locally 2026-10-16 and
# again over 20,000 log rows: this share fits `app/core/middlewares.py :: REQUEST_DEADLINE_S` at a 37 ms
# round trip.
LOESCHUNGEN_PER_PASS: Final = 10


async def _erase_one(
    spieler_id: Any,
    *,
    saisons_collection: AsyncCollection,
    spieler_collection: AsyncCollection,
    saison_spieler_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    spiele_collection: AsyncCollection,
    spielbestaetigungen_collection: AsyncCollection,
    spielberichte_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    berechtigungen_collection: AsyncCollection,
    berechtigungen_angekuendigt_collection: AsyncCollection,
    berechtigungen_postausgang_collection: AsyncCollection,
    einladungen_collection: AsyncCollection,
    sperrliste_collection: AsyncCollection,
    adresswechsel_collection: AsyncCollection,
    adresswechsel_postausgang_collection: AsyncCollection,
    berechtigungen_antraege_collection: AsyncCollection,
    sperrliste: BanList,
    db: AsyncMongoClient,
    schluessel: SecretStr,
    stamp: str,
    now: datetime,
) -> FLErasure | None:
    """One pupil in a transaction of their own: a conflict on one takes back nobody already erased."""

    async def erase_the_pupil_if_still_due(session: AsyncClientSession) -> FLErasure | None:
        return await erase_if_still_due(
            spieler_id,
            saisons_collection=saisons_collection,
            spieler_collection=spieler_collection,
            saison_spieler_collection=saison_spieler_collection,
            saison_teams_collection=saison_teams_collection,
            bewerbungen_collection=bewerbungen_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            spiele_collection=spiele_collection,
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            spielberichte_collection=spielberichte_collection,
            registrierungen_collection=registrierungen_collection,
            aktionen_collection=aktionen_collection,
            berechtigungen_collection=berechtigungen_collection,
            berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
            berechtigungen_postausgang_collection=berechtigungen_postausgang_collection,
            einladungen_collection=einladungen_collection,
            sperrliste_collection=sperrliste_collection,
            adresswechsel_collection=adresswechsel_collection,
            adresswechsel_postausgang_collection=adresswechsel_postausgang_collection,
            berechtigungen_antraege_collection=berechtigungen_antraege_collection,
            sperrliste=sperrliste,
            schluessel=schluessel,
            stamp=stamp,
            now=now,
            session=session,
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(erase_the_pupil_if_still_due)


@router.post(
    "/lauf",
    response_model=FLLoeschungLaufResponse,
    summary="Delete one share of the pupils the season-after rule makes due",
)
async def post_loeschung_lauf(
    params: Annotated[FLLoeschungLaufParams, Query()],
    saisons_collection: SaisonsCollection,
    spieler_collection: SpielerCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spielberichte_collection: SpielberichteCollection,
    registrierungen_collection: RegistrierungenCollection,
    aktionen_collection: AktionenCollection,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    berechtigungen_postausgang_collection: BerechtigungenPostausgangCollection,
    einladungen_collection: EinladungenCollection,
    sperrliste_collection: SperrlisteCollection,
    adresswechsel_collection: AdresswechselCollection,
    adresswechsel_postausgang_collection: AdresswechselPostausgangCollection,
    berechtigungen_antraege_collection: BerechtigungenAntraegeCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLLoeschungLaufResponse:
    """
    Delete a bounded share of the pupils whose last squad season is over by a whole season, and answer what went and how many remain.

    The rule, read from the seasons' stored statuses at each call: a pupil is due once they hold no squad row, live or retired,
    in the latest `past` season, in any season with a greater id or in the running one, and no registration still `eingereicht`
    at their address, compared as the sign-in folds it. While no season is `past` nobody is due, and `abgeschlossene_saison_id`
    is null. A pupil holding no address is never due: nothing else erases by a name. A pupil whose stored address no request
    matches, empty, unfolded or refused by the address rule, is passed over and named by id in a warning: a hand correction
    left it so, and an erasure by another spelling would remove nobody.

    Each pupil is deleted in a transaction of their own, which first judges them again: one who has gained a squad row or a
    pending registration since this call read them, the two committing before that transaction writes included, or whom another
    call deleted first, is counted `uebersprungen` and left standing. A squad entry or a registration meeting that transaction's
    writes waits for it to end: the entry then finds nobody, and the registration is stored for a pupil already gone.
    Two calls at once therefore delete each pupil once. Deleted are
    the pupil's own data alone: the pupil record, every squad row it holds and every registration at the address, a declined
    one included, each with its log images; every log row they wrote as a pupil keeps a
    fixed marker in their place. A contact seat, a referee record, a grant and anything else held at the same
    address stand, and so do the log images naming them.

    **A pass is a run of calls, each handing the next the `nach` the last answered**, the first naming none; it ends at the call
    answering `nach` null. A call reaches at most a fixed share of the due pupils after `nach`, in `_id` order, and the pass
    holds no state on the server. A pupil whose deletion fails, the database refusing it or anything else, is counted
    `fehlgeschlagen`, logged by id and passed, so a failing record holds back nobody behind it in the pass; it stays due, and
    the next pass tries it again. Where the request's deadline cuts the call, it stops at that pupil, warns once, and answers
    what it did; the rest stay due, and the pass goes on from the next call. `verbleibend` counts the pupils due after the
    call, those it failed or passed over among them, so it is no stopping condition. No body: the call takes no season and no
    limit.

    The 409 is published because the duplicate-key trace reaches the registry's insert of the pupils' sentinel and reads no
    handler; this call counts that failure as any other and never answers it.
    """

    statuses = await saison_statuses(saisons_collection=saisons_collection)
    # One past the share, so a call ending exactly at the share's last pupil can tell whether any follow.
    seite, anzahl = await faellige_seite(
        statuses,
        nach=params.nach,
        groesse=LOESCHUNGEN_PER_PASS + 1,
        spieler_collection=spieler_collection,
        registrierungen_collection=registrierungen_collection,
    )
    share = seite[:LOESCHUNGEN_PER_PASS]
    ohne_adresse = ohne_passende_adresse(share)
    if ohne_adresse:
        # The ids alone, as every line of this run: the address is what the pupil's erasure exists to remove.
        # Left out of the deletion: each one's stored address is empty, unfolded or refused by the address rule.
        fl_logger.warning(
            "identitaet.loeschung_unaddressed",
            extra={"error_code": Code.STORED_DATA_INVALID, "spieler_ids": [str(spieler_id) for spieler_id in ohne_adresse]},
        )

    # One instant for every redaction this call makes, as one erasure's steps share one.
    stamp = log_stamp(germany_now)

    spieler, saison_spieler, registrierungen = 0, 0, 0
    geloescht, uebersprungen, fehlgeschlagen = 0, 0, 0
    erreicht: Any = None
    abgebrochen = False
    for row in share:
        erreicht = row["_id"]
        if row["_id"] in ohne_adresse:
            continue

        # Caught outside the person's session, as `app/api/saisons/admin_router.py :: _mail_one_team` catches
        # a team's: a failure the session never saw leaves its transaction open.
        try:
            erased = await _erase_one(
                row["_id"],
                saisons_collection=saisons_collection,
                spieler_collection=spieler_collection,
                saison_spieler_collection=saison_spieler_collection,
                saison_teams_collection=saison_teams_collection,
                bewerbungen_collection=bewerbungen_collection,
                schiedsrichter_collection=schiedsrichter_collection,
                spiele_collection=spiele_collection,
                spielbestaetigungen_collection=spielbestaetigungen_collection,
                spielberichte_collection=spielberichte_collection,
                registrierungen_collection=registrierungen_collection,
                aktionen_collection=aktionen_collection,
                berechtigungen_collection=berechtigungen_collection,
                berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
                berechtigungen_postausgang_collection=berechtigungen_postausgang_collection,
                einladungen_collection=einladungen_collection,
                sperrliste_collection=sperrliste_collection,
                adresswechsel_collection=adresswechsel_collection,
                adresswechsel_postausgang_collection=adresswechsel_postausgang_collection,
                berechtigungen_antraege_collection=berechtigungen_antraege_collection,
                sperrliste=sperrliste,
                db=db,
                schluessel=config.sperrliste_schluessel,
                stamp=stamp,
                now=germany_now,
            )
        # Any class, or the next pass stops at this pupil again and holds back everyone behind them;
        # not `BaseException`, so a cancellation still ends the call.
        except Exception as failure:
            # The only branch an unanswered commit reaches: `with_transaction` retries one until the deadline and
            # raises it as a timeout keeping the label.
            if isinstance(failure, PyMongoError) and failure.timeout:
                ungewiss = failure.has_error_label(UNKNOWN_COMMIT_RESULT)
                # Below the handler's ERROR: no record is at fault, and every later pupil would fail the same way.
                fl_logger.warning(
                    "identitaet.loeschung_cut",
                    extra={
                        "error_code": Code.UNKNOWN_OUTCOME if ungewiss else Code.DATABASE_FAILED,
                        "spieler_id": str(row["_id"]),
                        "erasure_unanswered": ungewiss,
                    },
                )
                abgebrochen = True
                break

            # The id and what locates the failure, never a value: a line naming the pupil would outlive the erasure it reports.
            code, diagnosis = diagnosis_of(failure)
            fl_logger.error("identitaet.loeschung_failed", extra={"error_code": code, "spieler_id": str(row["_id"]), "diagnosis": diagnosis})
            fehlgeschlagen += 1
            continue

        # The one skip: judged again in its own transaction, a pupil another call deleted first reads as gone, since a
        # rival committing after the snapshot sends the attempt round rather than leaving a step a row to miss.
        if erased is None:
            uebersprungen += 1
            continue

        # No journal line, unlike a request's erasure: the rule deletes these pupils again after a restore,
        # where a replay would erase the whole address.
        geloescht += 1
        spieler += erased.spieler
        saison_spieler += erased.saison_spieler
        registrierungen += erased.registrierungen

    return FLLoeschungLaufResponse(
        abgeschlossene_saison_id=abgeschlossene_saison_id(statuses),
        spieler=spieler,
        saison_spieler=saison_spieler,
        registrierungen=registrierungen,
        uebersprungen=uebersprungen,
        fehlgeschlagen=fehlgeschlagen,
        verbleibend=anzahl - geloescht - uebersprungen,
        nach=erreicht if abgebrochen or len(seite) > LOESCHUNGEN_PER_PASS else None,
    )
