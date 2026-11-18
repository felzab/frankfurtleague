from datetime import datetime
from typing import Annotated, Any, Final

from fastapi import APIRouter, Query
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.api.ban_list.crud import address_is_barred
from app.api.grants.crud import read_admin_tier_of
from app.api.identity.crud import erase_if_still_due, erasure_due_page, find_sign_in, find_subject, saison_statuses, unreferenced_of
from app.api.identity.lookup import ErasureCollections, ErasureHandles, SubjectLookup
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
from app.core.codes import Code
from app.core.concurrency import concurrently
from app.core.dependencies import (
    AddressChangeReadCollection,
    BanListReadCollection,
    DBClient,
    GermanyNow,
    GrantsReadCollection,
    SaisonsCollection,
)
from app.core.logging import fl_logger
from app.core.middlewares import PASS
from app.core.recording import ACT_BY_SYSTEM, record_act
from app.core.routing import SAFE
from app.core.security import SYSTEM_TIER
from app.core.transactions import UNKNOWN_COMMIT_RESULT, diagnosis_of, transact
from app.shared.folding import sign_in_identifier

# System tier: the key is held by the frontend process alone, which is exactly who may ask which
# records a mailbox matches, and no session stands behind the caller.
router = APIRouter(
    prefix="/identity",
    dependencies=SYSTEM_TIER,
)


@router.post(
    "/subject",
    summary="Say which league records one mailbox holds",
    openapi_extra=SAFE,
)
async def get_subject(
    subject_data: FLSubjectPayload,
    records: SubjectLookup,
    grants_collection: GrantsReadCollection,
    germany_now: GermanyNow,
) -> FLSubjectResponse:
    """Answer which confirmed, live contact seats, pupil records and referee records one mailbox holds, with its grant.

    The address is matched on the sign-in fold, and a mailbox the league holds nothing for is answered with empty lists and no pupil
    rather than a 404.
    """

    identifier = sign_in_identifier(str(subject_data.email))

    # Concurrently, every page a signed-in person or an administrator renders waiting on this answer: the records and
    # the grant cost the longer of the two rather than their sum.
    subject, grant = await concurrently(
        find_subject(identifier, records),
        read_admin_tier_of(grants_collection=grants_collection, address=identifier, now=germany_now),
    )
    admin_tier, granted_since = (None, None) if grant is None else grant

    return FLSubjectResponse(**subject.model_dump(), admin_tier=admin_tier, granted_since=granted_since)


@router.post(
    "/sign_in",
    summary="Say whether one mailbox may be offered a sign-in",
    openapi_extra=SAFE,
)
async def get_sign_in(
    sign_in_data: FLSubjectPayload,
    records: SubjectLookup,
    ban_list_collection: BanListReadCollection,
    grants_collection: GrantsReadCollection,
    germany_now: GermanyNow,
) -> FLSignInResponse:
    """Answer what the sign-in gate decides on for one mailbox: two flags, its ban and its grant's tier, and never a record.

    The address is matched on the sign-in fold, and a mailbox the league holds nothing for is answered with both flags false.
    """

    identifier = sign_in_identifier(str(sign_in_data.email))

    # Concurrently, a sign-in waiting on this answer.
    sign_in, barred, grant = await concurrently(
        find_sign_in(identifier, records),
        address_is_barred(ban_list_collection=ban_list_collection, address=identifier),
        read_admin_tier_of(grants_collection=grants_collection, address=identifier, now=germany_now),
    )

    return FLSignInResponse(**sign_in.model_dump(), barred=barred, admin_tier=None if grant is None else grant[0])


@router.post(
    "/references",
    summary="Say which of these sign-in addresses no record references",
    openapi_extra=SAFE,
)
async def get_references(
    references_data: FLReferencesPayload,
    records: SubjectLookup,
    grants_collection: GrantsReadCollection,
    address_changes_collection: AddressChangeReadCollection,
) -> FLReferencesResponse:
    """Answer which of these sign-in addresses no league record references, each once and in the spelling it was asked in."""

    return FLReferencesResponse(
        unreferenced=await unreferenced_of(
            references_data.identifiers,
            records,
            grants_collection=grants_collection,
            address_changes_collection=address_changes_collection,
        )
    )


# The erasure pass is system-tier: the rule deletes whichever caller triggers it, and neither the hourly pass nor an
# activation's press holds a person's session here. A share of pupils each named by a report and a played match's
# line-up, at most sixteen commands apiece, fits the request's deadline.
ERASURES_PER_PASS: Final = 10


async def _erase_one(
    spieler_id: Any,
    *,
    saisons_collection: AsyncCollection,
    collections: ErasureCollections,
    db: AsyncMongoClient,
    saison_id: str | None,
    now: datetime,
) -> FLErasure | None:
    """One pupil in a transaction of their own: a conflict on one takes back nobody already erased."""

    async def erase_the_pupil_if_still_due(session: AsyncClientSession) -> FLErasure | None:
        erased = await erase_if_still_due(
            spieler_id,
            saisons_collection=saisons_collection,
            collections=collections,
            now=now,
            session=session,
        )
        # In the pupil's transaction, so no deletion stands without its row.
        if erased is not None:
            await record_act(
                collection=collections.spieler_collection,
                action="retention.spieler",
                by=ACT_BY_SYSTEM,
                label=saison_id,
                count=erased.spieler,
                session=session,
            )

        return erased

    return await transact(db, erase_the_pupil_if_still_due)


@router.post(
    "/erasure/sweep",
    summary="Delete one share of the pupils the season-after rule makes due",
    openapi_extra=PASS,
)
async def sweep_erasure(
    params: Annotated[FLErasureSweepParams, Query()],
    saisons_collection: SaisonsCollection,
    collections: ErasureHandles,
    db: DBClient,
    germany_now: GermanyNow,
) -> FLErasureSweepResponse:
    """Delete a bounded share of the pupils whose last squad season is over by a whole season, and answer what went and how many remain.

    A pass is a run of calls, each handing the next the `after` the last answered, and it ends at the call answering
    `after` null; `remaining` counts the pupils still due, the failed among them, so it is no stopping condition.
    """

    statuses = await saison_statuses(saisons_collection=saisons_collection)
    # One past the share, so a call ending exactly at the share's last pupil can tell whether any follow.
    page, count = await erasure_due_page(
        statuses,
        after=params.after,
        size=ERASURES_PER_PASS + 1,
        spieler_collection=collections.spieler_collection,
        registrierungen_collection=collections.registrierungen_collection,
    )
    share = page[:ERASURES_PER_PASS]

    spieler, saison_spieler, registrierungen = 0, 0, 0
    erased_count, skipped, failed = 0, 0, 0
    reached: Any = None
    broke_off = False
    for row in share:
        reached = row["_id"]

        # Caught outside the person's session: a failure the session never saw leaves its transaction open.
        try:
            erased = await _erase_one(
                row["_id"],
                saisons_collection=saisons_collection,
                collections=collections,
                db=db,
                saison_id=completed_saison_id(statuses),
                now=germany_now,
            )
        # Any class, or the next pass stops at this pupil again and holds back everyone behind them;
        # not `BaseException`, so a cancellation still ends the call.
        except Exception as failure:
            # The only branch an unanswered commit reaches: `transact` retries one until the deadline and
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
                broke_off = True
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

        # No line, unlike a request's erasure: the rule deletes these pupils again after a restore, and repeating one by
        # hand would erase the whole address.
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
        after=reached if broke_off or len(page) > ERASURES_PER_PASS else None,
    )
