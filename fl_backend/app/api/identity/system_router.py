from collections.abc import Mapping
from typing import Any

from fastapi import APIRouter
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.ban_list.crud import address_is_barred
from app.api.grants.crud import read_admin_tier_of
from app.api.identity.crud import erase_if_still_due, erasure_due_page, find_sign_in, find_subject, saison_statuses, unreferenced_of
from app.api.identity.lookup import ErasureHandles, SubjectLookup
from app.api.identity.schemas import (
    FLErasure,
    FLErasureSweepResponse,
    FLReferencesPayload,
    FLReferencesResponse,
    FLSignInResponse,
    FLSubjectPayload,
    FLSubjectResponse,
)
from app.api.identity.services import completed_saison_id
from app.core.concurrency import concurrently
from app.core.dependencies import (
    AddressChangeReadCollection,
    BanListReadCollection,
    DBClient,
    GermanyNow,
    GrantsReadCollection,
    SaisonsCollection,
)
from app.core.middlewares import PASS
from app.core.recording import ACT_BY_SYSTEM, record_act
from app.core.routing import SAFE
from app.core.security import SYSTEM_TIER
from app.core.transactions import save_each
from app.shared.folding import sign_in_identifier
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT

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


# System-tier: the rule deletes whichever caller triggers it, and no person's session stands behind the hourly pass.
@router.post(
    "/erasure/sweep",
    summary="Delete the pupils the season-after rule makes due",
    openapi_extra=PASS,
)
async def sweep_erasure(
    saisons_collection: SaisonsCollection,
    collections: ErasureHandles,
    db: DBClient,
    germany_now: GermanyNow,
) -> FLErasureSweepResponse:
    """Delete the pupils whose last squad season is over by a whole season, one at a time, and answer what went.

    A pupil whose erasure fails is counted in `failed` and stays due, and those the call's deadline leaves are the next pass's.
    """

    statuses = await saison_statuses(saisons_collection=saisons_collection)
    saison_id = completed_saison_id(statuses)
    # One read's worth: the deadline cuts the call long before the read's last pupil, and the rest are the next pass's.
    page = await erasure_due_page(
        statuses,
        size=LIST_LIMIT_DEFAULT,
        spieler_collection=collections.spieler_collection,
        registrierungen_collection=collections.registrierungen_collection,
    )

    async def erase_the_pupil_if_still_due(session: AsyncClientSession, row: Mapping[str, Any]) -> FLErasure | None:
        erased = await erase_if_still_due(
            row["_id"],
            saisons_collection=saisons_collection,
            collections=collections,
            now=germany_now,
            session=session,
        )
        # In the pupil's transaction, so no deletion stands without its row.
        if erased is not None:
            await record_act(
                collection=collections.spieler_collection,
                action="retention.spieler",
                by=ACT_BY_SYSTEM,
                saison_id=saison_id,
                count=erased.spieler,
                session=session,
            )

        return erased

    saved = await save_each(db=db, rows=page, save=erase_the_pupil_if_still_due, what="Spieler", clock="season after")
    # The one skip: judged again in its own transaction, a pupil another call deleted first reads as gone, since a rival
    # committing after the snapshot sends the attempt round rather than leaving a step a row to miss. No line, unlike a
    # request's erasure: the rule deletes these pupils again after a restore, and repeating one by hand would erase the
    # whole address.
    erased = [answer for answer in saved.answers if answer is not None]

    return FLErasureSweepResponse(
        completed_saison_id=saison_id,
        spieler=sum(answer.spieler for answer in erased),
        saison_spieler=sum(answer.saison_spieler for answer in erased),
        registrierungen=sum(answer.registrierungen for answer in erased),
        skipped=len(saved.answers) - len(erased),
        failed=saved.failed,
    )
