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
from app.api.identity.crud import erase_if_still_due, erasure_due_page, find_sign_in, find_subject, saison_statuses, unreferenced_of
from app.api.identity.lookup import SubjectLookup
from app.api.identity.schemas import (
    FLErasure,
    FLErasureSweepParams,
    FLErasureSweepResponse,
    FLReferencesPayload,
    FLReferencesResponse,
    FLSignInResponse,
    FLSubjectPayload,
    FLSubjectResponse,
)
from app.api.identity.services import completed_saison_id
from app.api.sperrliste.lookup import BanList, SperrlisteLookup, hash_gesperrt
from app.core.codes import Code
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.dependencies import (
    ActionLogCollection,
    AddressChangeCollection,
    AddressChangeReadCollection,
    BanListCollection,
    BewerbungenCollection,
    DBClient,
    GrantApprovalRequestsCollection,
    GrantsAnnouncedCollection,
    GrantsCollection,
    GrantsReadCollection,
    InvitationsCollection,
    OutboxCollection,
    RegistrierungenCollection,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SnapshotSession,
    SpielberichteCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
    SpielerCollection,
    get_germany_now,
)
from app.core.logging import fl_logger
from app.core.recording import log_stamp
from app.core.routing import SAFE
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
    openapi_extra=SAFE,
)
async def get_subject(
    subject_data: Annotated[FLSubjectPayload, Body()],
    records: SubjectLookup,
    sperrliste: SperrlisteLookup,
    grants_collection: GrantsReadCollection,
    session: SnapshotSession,
) -> FLSubjectResponse:
    """Answer which confirmed, live contact seats, pupil records and referee records one mailbox holds, with its ban and its grant.

    The address is matched on the sign-in fold, and a mailbox the league holds nothing for is answered with three empty lists rather
    than a 404.
    """

    identifier = sign_in_identifier(str(subject_data.email))

    # Keyed from the payload's own value, as the ban write keys it: that payload type runs the rule
    # `league_address` runs, so an address the hash would refuse was answered 422 before here.
    ban_key = sperrliste.hash_of(str(subject_data.email))

    # Concurrently, every page a signed-in person or an administrator renders waiting on this answer:
    # the records, the ban and the grant cost the longest of the three rather than their sum.
    subject, barred, grant = await asyncio.gather(
        find_subject(identifier, records),
        hash_gesperrt(sperrliste, ban_key),
        verwaltung_of(grants_collection=grants_collection, adresse=identifier, session=session),
    )
    admin_tier, granted_since, owner_since = (None, None, None) if grant is None else grant

    return FLSubjectResponse(**subject.model_dump(), barred=barred, admin_tier=admin_tier, granted_since=granted_since, owner_since=owner_since)


@router.post(
    "/sign_in",
    response_model=FLSignInResponse,
    summary="Say whether one mailbox may be offered a sign-in",
    openapi_extra=SAFE,
)
async def get_sign_in(
    sign_in_data: Annotated[FLSubjectPayload, Body()],
    records: SubjectLookup,
    sperrliste: SperrlisteLookup,
    grants_collection: GrantsReadCollection,
    session: SnapshotSession,
) -> FLSignInResponse:
    """Answer what the sign-in gate decides on for one mailbox: two flags, its ban and its grant's tier, and never a record.

    The address is matched on the sign-in fold, and a mailbox the league holds nothing for is answered with both flags false.
    """

    # Keyed as `get_subject` keys, for its reason.
    identifier = sign_in_identifier(str(sign_in_data.email))
    ban_key = sperrliste.hash_of(str(sign_in_data.email))

    # Concurrently, for `get_subject`'s reason: a sign-in waits on this answer.
    sign_in, barred, grant = await asyncio.gather(
        find_sign_in(identifier, records),
        hash_gesperrt(sperrliste, ban_key),
        verwaltung_of(grants_collection=grants_collection, adresse=identifier, session=session),
    )

    return FLSignInResponse(**sign_in.model_dump(), barred=barred, admin_tier=None if grant is None else grant[0])


@router.post(
    "/references",
    response_model=FLReferencesResponse,
    summary="Say which of these sign-in addresses no record references",
    openapi_extra=SAFE,
)
async def get_references(
    references_data: Annotated[FLReferencesPayload, Body()],
    records: SubjectLookup,
    grants_collection: GrantsReadCollection,
    address_change_collection: AddressChangeReadCollection,
) -> FLReferencesResponse:
    """Answer which of these sign-in addresses no league record references, each once and in the spelling it was asked in.

    The whole batch is refused while no live grant is an owner's, since such a database would call every address unreferenced.
    """

    return FLReferencesResponse(
        unreferenced=await unreferenced_of(
            references_data.identifiers,
            records,
            grants_collection=grants_collection,
            address_change_collection=address_change_collection,
        )
    )


# The erasure pass is system-tier for the same reason: the rule deletes, whichever caller triggers
# it, and neither the hourly pass nor an activation's press holds a person's session here.
# Twenty-two commands for a pupil a report names, whose repoint writes a log row, each the round trip plus at
# most 2.03 ms, timed locally 2026-10-16 and again over 20,000 log rows: this share fits
# `app/core/middlewares.py :: REQUEST_DEADLINE_S` at a 37 ms round trip.
ERASURES_PER_PASS: Final = 10


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
    action_log_collection: AsyncCollection,
    grants_collection: AsyncCollection,
    grants_announced_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    invitations_collection: AsyncCollection,
    ban_list_collection: AsyncCollection,
    address_change_collection: AsyncCollection,
    grants_approval_requests_collection: AsyncCollection,
    sperrliste: BanList,
    db: AsyncMongoClient,
    key: SecretStr,
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
            action_log_collection=action_log_collection,
            grants_collection=grants_collection,
            grants_announced_collection=grants_announced_collection,
            outbox_collection=outbox_collection,
            invitations_collection=invitations_collection,
            ban_list_collection=ban_list_collection,
            address_change_collection=address_change_collection,
            grants_approval_requests_collection=grants_approval_requests_collection,
            sperrliste=sperrliste,
            key=key,
            stamp=stamp,
            now=now,
            session=session,
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(erase_the_pupil_if_still_due)


@router.post(
    "/erasure/sweep",
    response_model=FLErasureSweepResponse,
    summary="Delete one share of the pupils the season-after rule makes due",
)
async def sweep_erasure(
    params: Annotated[FLErasureSweepParams, Query()],
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
    action_log_collection: ActionLogCollection,
    grants_collection: GrantsCollection,
    grants_announced_collection: GrantsAnnouncedCollection,
    outbox_collection: OutboxCollection,
    invitations_collection: InvitationsCollection,
    ban_list_collection: BanListCollection,
    address_change_collection: AddressChangeCollection,
    grants_approval_requests_collection: GrantApprovalRequestsCollection,
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

    **A pass is a run of calls, each handing the next the `after` the last answered**, the first naming none; it ends at the call
    answering `after` null. A call reaches at most a fixed share of the due pupils after `after`, in `_id` order, and the pass
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
    seite, count = await erasure_due_page(
        statuses,
        after=params.after,
        size=ERASURES_PER_PASS + 1,
        spieler_collection=spieler_collection,
        registrierungen_collection=registrierungen_collection,
    )
    share = seite[:ERASURES_PER_PASS]
    # One instant for every redaction this call makes, as one erasure's steps share one.
    stamp = log_stamp(germany_now)

    spieler, saison_spieler, registrierungen = 0, 0, 0
    erased_count, skipped, failed = 0, 0, 0
    reached: Any = None
    abgebrochen = False
    for row in share:
        reached = row["_id"]

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
                action_log_collection=action_log_collection,
                grants_collection=grants_collection,
                grants_announced_collection=grants_announced_collection,
                outbox_collection=outbox_collection,
                invitations_collection=invitations_collection,
                ban_list_collection=ban_list_collection,
                address_change_collection=address_change_collection,
                grants_approval_requests_collection=grants_approval_requests_collection,
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
                uncertain = failure.has_error_label(UNKNOWN_COMMIT_RESULT)
                # Below the handler's ERROR: no record is at fault, and every later pupil would fail the same way.
                fl_logger.warning(
                    "identity.erasure_cut",
                    extra={
                        "error_code": Code.UNKNOWN_OUTCOME if uncertain else Code.DATABASE_FAILED,
                        "spieler_id": str(row["_id"]),
                        "erasure_unanswered": uncertain,
                    },
                )
                abgebrochen = True
                break

            # The id and what locates the failure, never a value: a line naming the pupil would outlive the erasure it reports.
            code, diagnosis = diagnosis_of(failure)
            fl_logger.error("identity.erasure_failed", extra={"error_code": code, "spieler_id": str(row["_id"]), "diagnosis": diagnosis})
            failed += 1
            continue

        # The one skip: judged again in its own transaction, a pupil another call deleted first reads as gone, since a
        # rival committing after the snapshot sends the attempt round rather than leaving a step a row to miss.
        if erased is None:
            skipped += 1
            continue

        # No journal line, unlike a request's erasure: the rule deletes these pupils again after a restore,
        # where a replay would erase the whole address.
        erased_count += 1
        spieler += erased.spieler
        saison_spieler += erased.saison_spieler
        registrierungen += erased.registrierungen

    return FLErasureSweepResponse(
        completed_saison_id=completed_saison_id(statuses),
        spieler=spieler,
        saison_spieler=saison_spieler,
        registrierungen=registrierungen,
        skipped=skipped,
        failed=failed,
        remaining=count - erased_count - skipped,
        after=reached if abgebrochen or len(seite) > ERASURES_PER_PASS else None,
    )
