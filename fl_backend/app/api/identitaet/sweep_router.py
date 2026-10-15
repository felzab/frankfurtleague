from datetime import datetime
from typing import Annotated, Any, Final

from fastapi import APIRouter, Depends
from pydantic import SecretStr
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.api.identitaet.crud import erase_if_still_due, faellige_spieler, saison_statuses
from app.api.identitaet.schemas import FLErasure, FLLoeschungLaufResponse
from app.api.identitaet.services import abgeschlossene_saison_id
from app.api.sperrliste.lookup import BanList, SperrlisteLookup
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.db import get_drosselung_collection
from app.core.dependencies import (
    AktionenCollection,
    BerechtigungenAngekuendigtCollection,
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
    SpieleCollection,
    SpielerCollection,
    get_germany_now,
)
from app.core.exception_handlers import DATABASE_FAILED, DOCUMENT_NOT_FOUND_RESPONSE, DUPLICATE_KEY_RESPONSE, UNKNOWN_OUTCOME
from app.core.logging import fl_logger
from app.core.recording import log_stamp
from app.core.security import bind_system_actor, verify_access_system
from app.core.transactions import transaction_session

# System tier and the system actor, as the application sweep's router is: the rule deletes, whichever
# caller triggers it, and neither the hourly pass nor an activation's press holds a person's session here.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/identitaet/loeschung",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)

# Twenty-three commands a pupil, each costing the round trip plus at most 2.03 ms (whole calls timed
# locally, 2026-10-16): this share keeps a call inside `app/core/middlewares.py :: REQUEST_DEADLINE_S`
# up to a 37 ms round trip (`docs/backend/spec.md :: I322`).
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
    registrierungen_collection: AsyncCollection,
    drosselung_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    berechtigungen_collection: AsyncCollection,
    berechtigungen_angekuendigt_collection: AsyncCollection,
    berechtigungen_postausgang_collection: AsyncCollection,
    einladungen_collection: AsyncCollection,
    sperrliste_collection: AsyncCollection,
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
            registrierungen_collection=registrierungen_collection,
            drosselung_collection=drosselung_collection,
            aktionen_collection=aktionen_collection,
            berechtigungen_collection=berechtigungen_collection,
            berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
            berechtigungen_postausgang_collection=berechtigungen_postausgang_collection,
            einladungen_collection=einladungen_collection,
            sperrliste_collection=sperrliste_collection,
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
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
)
async def post_loeschung_lauf(
    saisons_collection: SaisonsCollection,
    spieler_collection: SpielerCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    registrierungen_collection: RegistrierungenCollection,
    drosselung_collection: Annotated[AsyncCollection, Depends(get_drosselung_collection)],
    aktionen_collection: AktionenCollection,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    berechtigungen_postausgang_collection: BerechtigungenPostausgangCollection,
    einladungen_collection: EinladungenCollection,
    sperrliste_collection: SperrlisteCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLLoeschungLaufResponse:
    """
    Delete a bounded share of the pupils whose last squad season is over by a whole season, and answer what went and how many remain.

    The rule, read from the seasons' stored statuses at each call: a pupil is due once they hold no squad row, live or retired,
    in the latest `past` season or in any season that is not `past`, and no registration still `eingereicht` at their address,
    compared as the sign-in folds it. While no season is `past` nobody is due, and `abgeschlossene_saison_id` is null. A pupil
    holding no address is never due: nothing else erases by a name.

    Each pupil is deleted in a transaction of their own, which first judges them again: one who has gained a squad row or a
    pending registration since this call read them, or whom another call deleted first, is counted `uebersprungen` and left
    standing. Two calls at once therefore delete each pupil once. Deleted are the pupil's own data alone: the pupil record,
    every squad row it holds and every registration at the address, a declined one included, each with its log images. A
    contact seat, a referee record, a grant and anything else held at the same address stand, and so do the log images naming
    them.

    One call deletes at most a fixed share in `_id` order; `verbleibend` counts the pupils still due afterwards, those beyond the
    share and those that failed. **A pupil whose deletion the database refuses is counted `fehlgeschlagen` and logged by id, and
    the call goes on to the next**: one unreachable record holds back nobody else. Such a pupil stays due, so a caller looping
    until `verbleibend` is zero never ends where one fails; stop at a call that deleted nobody. No body: the call takes no
    season and no limit.

    The 404 and the 409 are the registry's, published for the steps this call reaches, and neither is answered: each pupil is
    read in the transaction that deletes them, and a write the database refuses is counted rather than raised.
    """

    statuses = await saison_statuses(saisons_collection=saisons_collection)
    faellig = await faellige_spieler(statuses, spieler_collection=spieler_collection, registrierungen_collection=registrierungen_collection)
    # One instant for every redaction this call makes, as one erasure's steps share one.
    stamp = log_stamp(germany_now)

    spieler, saison_spieler, registrierungen = 0, 0, 0
    geloescht, uebersprungen, fehlgeschlagen = 0, 0, 0
    for spieler_id in faellig[:LOESCHUNGEN_PER_PASS]:
        # Caught outside the person's session, as `app/api/saisons/admin_router.py :: _mail_one_team` catches
        # a team's: a failure the session never saw leaves its transaction open (`docs/backend/spec.md :: I539`).
        try:
            erased = await _erase_one(
                spieler_id,
                saisons_collection=saisons_collection,
                spieler_collection=spieler_collection,
                saison_spieler_collection=saison_spieler_collection,
                saison_teams_collection=saison_teams_collection,
                bewerbungen_collection=bewerbungen_collection,
                schiedsrichter_collection=schiedsrichter_collection,
                spiele_collection=spiele_collection,
                registrierungen_collection=registrierungen_collection,
                drosselung_collection=drosselung_collection,
                aktionen_collection=aktionen_collection,
                berechtigungen_collection=berechtigungen_collection,
                berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
                berechtigungen_postausgang_collection=berechtigungen_postausgang_collection,
                einladungen_collection=einladungen_collection,
                sperrliste_collection=sperrliste_collection,
                sperrliste=sperrliste,
                db=db,
                schluessel=config.sperrliste_schluessel,
                stamp=stamp,
                now=germany_now,
            )
        except PyMongoError as failure:
            ungewiss = failure.has_error_label("UnknownTransactionCommitResult")
            # The id and the class alone: a line naming the pupil would outlive the erasure it reports.
            fl_logger.error(
                f"Pupil {spieler_id} was {'erased or not, the commit unanswered' if ungewiss else 'not erased'}: {type(failure).__name__}",
                extra={"error_code": UNKNOWN_OUTCOME if ungewiss else DATABASE_FAILED},
            )
            fehlgeschlagen += 1
            continue

        if erased is None:
            uebersprungen += 1
            continue

        # No journal line, unlike a request's erasure: the rule deletes these pupils again after a restore,
        # where a replay would erase the whole address (`docs/backend/spec.md :: I690`).
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
        verbleibend=len(faellig) - geloescht - uebersprungen,
    )
