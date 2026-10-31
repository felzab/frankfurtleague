import asyncio
from datetime import datetime
from typing import Annotated, Any, Final

from fastapi import APIRouter, Body, Depends, Query
from pydantic import SecretStr
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.api.berechtigungen.crud import verwaltung_of
from app.api.identitaet.crud import faellige_seite, find_anmeldung, find_subjekt, loeschen_if_still_due, saison_statuses, unreferenced_of
from app.api.identitaet.lookup import SubjektLookup
from app.api.identitaet.schemas import (
    FLErasureSweepResponse,
    FLLoeschung,
    FLLoeschungSweepParams,
    FLReferencesPayload,
    FLReferencesResponse,
    FLSignInResponse,
    FLSubjectPayload,
    FLSubjectResponse,
)
from app.api.identitaet.services import abgeschlossene_saison_id
from app.api.sperrliste.lookup import BanList, SperrlisteLookup, hash_gesperrt
from app.core.codes import Code
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.dependencies import (
    ActionLogCollection,
    AddressChangeCollection,
    BewerbungenCollection,
    DBClient,
    GrantApprovalRequestsCollection,
    GrantsAnnouncedCollection,
    GrantsCollection,
    InvitationsCollection,
    OutboxCollection,
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
from app.shared.folding import sign_in_identifier

# System tier and the system actor: the key is held by the frontend process alone, which is exactly
# who may ask which records a mailbox matches, and no session stands behind the caller.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/identity",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)


@router.post(
    "/subject",
    response_model=FLSubjectResponse,
    summary="Say which league records one mailbox holds",
)
async def get_subject(
    subjekt_data: Annotated[FLSubjectPayload, Body()],
    records: SubjektLookup,
    sperrliste: SperrlisteLookup,
    berechtigungen_collection: GrantsCollection,
) -> FLSubjectResponse:
    """Answer which confirmed, live contact seats, pupil records and referee records one mailbox holds, with its ban and its grant.

    The address is matched on the sign-in fold, and a mailbox the league holds nothing for is answered with three empty lists rather
    than a 404.
    """

    identifier = sign_in_identifier(str(subjekt_data.email))

    # Keyed from the payload's own value, as the ban write keys it: that payload type runs the rule
    # `canonical_address` runs, so an address the hash would refuse was answered 422 before here.
    ban_key = sperrliste.hash_of(str(subjekt_data.email))

    # Concurrently, every page a signed-in person or an administrator renders waiting on this answer:
    # the records, the ban and the grant cost the longest of the three rather than their sum.
    subjekt, gesperrt, grant = await asyncio.gather(
        find_subjekt(identifier, records),
        hash_gesperrt(sperrliste, ban_key),
        verwaltung_of(berechtigungen_collection=berechtigungen_collection, adresse=identifier),
    )
    verwaltung, berechtigt_seit, inhaber_seit = (None, None, None) if grant is None else grant

    return FLSubjectResponse(
        **subjekt.model_dump(), barred=gesperrt, verwaltung=verwaltung, granted_since=berechtigt_seit, inhaber_seit=inhaber_seit
    )


@router.post(
    "/sign_in",
    response_model=FLSignInResponse,
    summary="Say whether one mailbox may be offered a sign-in",
)
async def get_sign_in(
    anmeldung_data: Annotated[FLSubjectPayload, Body()],
    records: SubjektLookup,
    sperrliste: SperrlisteLookup,
    berechtigungen_collection: GrantsCollection,
) -> FLSignInResponse:
    """Answer what the sign-in gate decides on for one mailbox: two flags, its ban and its grant's tier, and never a record.

    The address is matched on the sign-in fold, and a mailbox the league holds nothing for is answered with both flags false.
    """

    # Keyed as `get_subject` keys, for its reason.
    identifier = sign_in_identifier(str(anmeldung_data.email))
    ban_key = sperrliste.hash_of(str(anmeldung_data.email))

    # Concurrently, for `get_subject`'s reason: a sign-in waits on this answer.
    anmeldung, gesperrt, grant = await asyncio.gather(
        find_anmeldung(identifier, records),
        hash_gesperrt(sperrliste, ban_key),
        verwaltung_of(berechtigungen_collection=berechtigungen_collection, adresse=identifier),
    )

    return FLSignInResponse(**anmeldung.model_dump(), barred=gesperrt, verwaltung=None if grant is None else grant[0])


@router.post(
    "/references",
    response_model=FLReferencesResponse,
    summary="Say which of these sign-in addresses no record references",
)
async def get_references(
    referenzen_data: Annotated[FLReferencesPayload, Body()],
    records: SubjektLookup,
    berechtigungen_collection: GrantsCollection,
    adresswechsel_collection: AddressChangeCollection,
) -> FLReferencesResponse:
    """Answer which of these sign-in addresses no league record references, each once and in the spelling it was asked in.

    The whole batch is refused while no live grant is an owner's, since such a database would call every address unreferenced.
    """

    return FLReferencesResponse(
        unreferenced=await unreferenced_of(
            referenzen_data.identifiers,
            records,
            berechtigungen_collection=berechtigungen_collection,
            adresswechsel_collection=adresswechsel_collection,
        )
    )


# The erasure pass is system-tier for the same reason: the rule deletes, whichever caller triggers
# it, and neither the hourly pass nor an activation's press holds a person's session here.
# Twenty commands a pupil, each the round trip plus at most 2.03 ms, timed locally 2026-10-16 and
# again over 20,000 log rows: this share fits `app/core/middlewares.py :: REQUEST_DEADLINE_S` at a 37 ms
# round trip.
LOESCHUNGEN_PER_PASS: Final = 10


async def _loeschen_one(
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
    outbox_collection: AsyncCollection,
    einladungen_collection: AsyncCollection,
    sperrliste_collection: AsyncCollection,
    adresswechsel_collection: AsyncCollection,
    berechtigungen_antraege_collection: AsyncCollection,
    sperrliste: BanList,
    db: AsyncMongoClient,
    key: SecretStr,
    stamp: str,
    now: datetime,
) -> FLLoeschung | None:
    """One pupil in a transaction of their own: a conflict on one takes back nobody already erased."""

    async def loeschen_the_pupil_if_still_due(session: AsyncClientSession) -> FLLoeschung | None:
        return await loeschen_if_still_due(
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
            outbox_collection=outbox_collection,
            einladungen_collection=einladungen_collection,
            sperrliste_collection=sperrliste_collection,
            adresswechsel_collection=adresswechsel_collection,
            berechtigungen_antraege_collection=berechtigungen_antraege_collection,
            sperrliste=sperrliste,
            key=key,
            stamp=stamp,
            now=now,
            session=session,
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(loeschen_the_pupil_if_still_due)


@router.post(
    "/erasure/sweep",
    response_model=FLErasureSweepResponse,
    summary="Delete one share of the pupils the season-after rule makes due",
)
async def sweep_erasure(
    params: Annotated[FLLoeschungSweepParams, Query()],
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
    aktionen_collection: ActionLogCollection,
    berechtigungen_collection: GrantsCollection,
    berechtigungen_angekuendigt_collection: GrantsAnnouncedCollection,
    outbox_collection: OutboxCollection,
    einladungen_collection: InvitationsCollection,
    sperrliste_collection: SperrlisteCollection,
    adresswechsel_collection: AddressChangeCollection,
    berechtigungen_antraege_collection: GrantApprovalRequestsCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLErasureSweepResponse:
    """
    Delete a bounded share of the pupils whose last squad season is over by a whole season, and answer what went and how many remain.

    The rule, read from the seasons' stored statuses at each call: a pupil is due once they hold no squad row, live or retired,
    in the latest `past` season, in any season with a greater id or in the running one, and no registration still `submitted`
    at their address, compared as the sign-in folds it. While no season is `past` nobody is due, and `completed_saison_id`
    is null. A pupil holding no address is never due: nothing else erases by a name.

    Each pupil is deleted in a transaction of their own, which first judges them again: one who has gained a squad row or a
    pending registration since this call read them, the two committing before that transaction writes included, or whom another
    call deleted first, is counted `skipped` and left standing. A squad entry or a registration meeting that transaction's
    writes waits for it to end: the entry then finds nobody, and the registration is stored for a pupil already gone.
    Two calls at once therefore delete each pupil once. Deleted are
    the pupil's own data alone: the pupil record, every squad row it holds and every registration at the address, a declined
    one included, each with its log images; every log row they wrote as a pupil keeps a
    fixed marker in their place. A contact seat, a referee record, a grant and anything else held at the same
    address stand, and so do the log images naming them.

    **A pass is a run of calls, each handing the next the `nach` the last answered**, the first naming none; it ends at the call
    answering `nach` null. A call reaches at most a fixed share of the due pupils after `nach`, in `_id` order, and the pass
    holds no state on the server. A pupil whose deletion fails, the database refusing it or anything else, is counted
    `failed`, logged by id and passed, so a failing record holds back nobody behind it in the pass; it stays due, and
    the next pass tries it again. Where the request's deadline cuts the call, it stops at that pupil, warns once, and answers
    what it did; the rest stay due, and the pass goes on from the next call. `remaining` counts the pupils due after the
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
    # One instant for every redaction this call makes, as one erasure's steps share one.
    stamp = log_stamp(germany_now)

    spieler, saison_spieler, registrierungen = 0, 0, 0
    geloescht, uebersprungen, fehlgeschlagen = 0, 0, 0
    erreicht: Any = None
    abgebrochen = False
    for row in share:
        erreicht = row["_id"]

        # Caught outside the person's session, as `app/api/saisons/admin_router.py :: _mail_one_team` catches
        # a team's: a failure the session never saw leaves its transaction open.
        try:
            geloeschte = await _loeschen_one(
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
                outbox_collection=outbox_collection,
                einladungen_collection=einladungen_collection,
                sperrliste_collection=sperrliste_collection,
                adresswechsel_collection=adresswechsel_collection,
                berechtigungen_antraege_collection=berechtigungen_antraege_collection,
                sperrliste=sperrliste,
                db=db,
                key=config.sperrliste_key,
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
                    "identity.erasure_cut",
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
            fl_logger.error("identity.erasure_failed", extra={"error_code": code, "spieler_id": str(row["_id"]), "diagnosis": diagnosis})
            fehlgeschlagen += 1
            continue

        # The one skip: judged again in its own transaction, a pupil another call deleted first reads as gone, since a
        # rival committing after the snapshot sends the attempt round rather than leaving a step a row to miss.
        if geloeschte is None:
            uebersprungen += 1
            continue

        # No journal line, unlike a request's erasure: the rule deletes these pupils again after a restore,
        # where a replay would erase the whole address.
        geloescht += 1
        spieler += geloeschte.spieler
        saison_spieler += geloeschte.saison_spieler
        registrierungen += geloeschte.registrierungen

    return FLErasureSweepResponse(
        completed_saison_id=abgeschlossene_saison_id(statuses),
        spieler=spieler,
        saison_spieler=saison_spieler,
        registrierungen=registrierungen,
        skipped=uebersprungen,
        failed=fehlgeschlagen,
        remaining=anzahl - geloescht - uebersprungen,
        nach=erreicht if abgebrochen or len(seite) > LOESCHUNGEN_PER_PASS else None,
    )
