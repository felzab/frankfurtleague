from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any, Final, Literal

from fastapi import APIRouter, Body, Depends, Query
from pydantic import SecretStr
from pymongo import ASCENDING, AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.api.address_change.crud import end_the_change_in_session, ending_line, owe_the_refusal_notice_in_session, take_effect_in_session
from app.api.address_change.schemas import (
    FLAddressChangeAdressePayload,
    FLAddressChangeAdresseResponse,
    FLAddressChangeMovesDonePayload,
    FLAddressChangeMovesDoneResponse,
    FLAddressChangeMovesResponse,
    FLAddressChangeOpenMove,
    FLAddressChangeSweepParams,
    FLAddressChangeSweepResponse,
)
from app.api.address_change.services import (
    HELD,
    LIVE_TERMS,
    build_due_terms,
    build_lapsed_terms,
    build_parked_terms,
    is_expired,
)
from app.api.identity.lookup import RecordCollections, SubjectLookup
from app.api.sperrliste.lookup import BanList, SperrlisteLookup, sperrliste_saison
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import aggregate_many_from_db, patch_many_in_db, pull_many_from_db, pull_one_from_db
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
    InvitationsCollection,
    OutboxCollection,
    RegistrierungenCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielbestaetigungenCollection,
    SpielerCollection,
    get_germany_now,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.journal import Journal
from app.core.logging import fl_logger
from app.core.recording import log_stamp
from app.core.routing import SAFE
from app.core.security import bind_system_actor, verify_access_system
from app.core.transactions import UNKNOWN_COMMIT_RESULT, diagnosis_of, transaction_session
from app.shared.folding import sign_in_identifier
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.tokens import hash_token

# System tier and the system actor: the clock ends a lapsed change and makes a due one take effect, and no administrator
# pressed anything.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/address_change",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)

# The largest share inside `app/core/middlewares.py :: REQUEST_DEADLINE_S` for the dearest change over a 40,000-row
# action log a due change reads whole; a dearer change meets the deadline.
ADDRESS_CHANGE_PER_PASS: Final = 4


def _pipeline(*, now: datetime, nach: Any, size: int) -> list[dict[str, Any]]:
    """Every lapsed and due change after `nach`, in `_id` order, at most `size`, with the count, as ONE document.

    No index serves the instants: the collection holds live changes and recent tombstones alone.
    """

    seite: list[dict[str, Any]] = [{"$sort": {"_id": 1}}, {"$limit": size}]

    return [
        {"$match": {"$or": [build_lapsed_terms(now), build_due_terms(now)]}},
        # A change parked on an owed approval while its grant stands is neither due nor the pass's remainder.
        {
            "$lookup": {
                "from": Collection.GRANTS,
                "localField": "adresse",
                "foreignField": "adresse",
                "pipeline": [{"$project": {"_id": 1}}],
                "as": HELD,
            }
        },
        {"$match": {"$nor": [build_parked_terms(now)]}},
        # What `is_expired` labels a lapse by: a confirmed change whose approval's week passed holds a `effective_from` too,
        # and is no due change for that.
        {"$project": {"_id": 1, "valid_until": 1, "approval.bis": 1, "approval.approved_at": 1}},
        {"$facet": {"seite": seite if nach is None else [{"$match": {"_id": {"$gt": nach}}}, *seite], "count": [{"$count": "count"}]}},
    ]


async def _end_the_lapsed_change(
    row: Mapping[str, Any],
    *,
    address_change_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    action_log_collection: AsyncCollection,
    db: AsyncMongoClient,
    now: datetime,
    stamp: str,
) -> None:
    """One change in a transaction of its own, judged again there: `DocumentNotFoundError` where it has not lapsed.

    Unjournalled: restored, a lapsed change lapses again at the next pass.
    """

    async def end_the_lapsed_change(session: AsyncClientSession) -> None:
        stored = await end_the_change_in_session(
            address_change_collection=address_change_collection,
            action_log_collection=action_log_collection,
            db_filter={"_id": row["_id"], **build_lapsed_terms(now)},
            art="expired",
            now=now,
            stamp=stamp,
            session=session,
        )
        # A confirmed change lapsing on its owed approval: its new mailbox was told it waits on the administration, so it is
        # told it did not take effect, as a refused due change's is.
        if stored.get("confirmed_at") is not None:
            await owe_the_refusal_notice_in_session(stored, outbox_collection=outbox_collection, now=now, session=session)

    async with transaction_session(db) as session:
        await session.with_transaction(end_the_lapsed_change)


async def _make_the_due_change_take_effect(
    row: Mapping[str, Any],
    *,
    records: RecordCollections,
    sperrliste: BanList,
    governing_saison_id: str | None,
    address_change_collection: AsyncCollection,
    spieler_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    spielbestaetigungen_collection: AsyncCollection,
    grants_collection: AsyncCollection,
    grants_announced_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    grants_approval_requests_collection: AsyncCollection,
    invitations_collection: AsyncCollection,
    ban_list_collection: AsyncCollection,
    action_log_collection: AsyncCollection,
    db: AsyncMongoClient,
    key: SecretStr,
    now: datetime,
    stamp: str,
) -> Literal["effective", "discarded"] | None:
    """One due change in its own transaction, judged again as its confirmation was.

    Answers how it ended, its notice owed, or `None` where it waits on an approval; `DocumentNotFoundError` where stopped,
    discarded or replaced since the page was read.
    """

    journal = Journal()

    @journal.attempted
    async def take_effect(session: AsyncClientSession) -> Literal["effective", "discarded"] | None:
        record = await pull_one_from_db(
            collection=address_change_collection, db_filter={"_id": row["_id"], **build_due_terms(now)}, session=session
        )
        verdict, effective = await take_effect_in_session(
            record=record,
            records=records,
            sperrliste=sperrliste,
            governing_saison_id=governing_saison_id,
            address_change_collection=address_change_collection,
            spieler_collection=spieler_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            saison_teams_collection=saison_teams_collection,
            bewerbungen_collection=bewerbungen_collection,
            registrierungen_collection=registrierungen_collection,
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            grants_collection=grants_collection,
            grants_announced_collection=grants_announced_collection,
            outbox_collection=outbox_collection,
            grants_approval_requests_collection=grants_approval_requests_collection,
            invitations_collection=invitations_collection,
            ban_list_collection=ban_list_collection,
            action_log_collection=action_log_collection,
            key=key,
            now=now,
            journal=journal,
            session=session,
            # Confirmed and due: its new mailbox was told it waits on this pass.
            notify=True,
        )
        if effective:
            return "effective"
        # Waits on an approval: one owed while its address holds a grant again since the page's read, or one given whose
        # approver could not give it now, taken off.
        if verdict.waits:
            return None

        # Every judgement the confirmation makes, at the end of the waiting time as at its start.
        if not verdict.empty:
            await end_the_change_in_session(
                address_change_collection=address_change_collection,
                action_log_collection=action_log_collection,
                db_filter={"_id": record["_id"]},
                art="discarded",
                now=now,
                stamp=stamp,
                session=session,
            )
            # Journalled, as an administrator's discard is: the cause refusing it may postdate a snapshot a restore brings
            # the change back from, due.
            journal.note(
                ending_line(
                    art="address_change_discarded_notified",
                    new_address=str(record["email"]),
                    record_id=record["_id"],
                    am=stamp,
                    key=key,
                )
            )
            await owe_the_refusal_notice_in_session(record, outbox_collection=outbox_collection, now=now, session=session)
        return "discarded"

    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(take_effect)


@router.post(
    "/sweep",
    response_model=FLAddressChangeSweepResponse,
    summary="End the lapsed address changes, and make the due ones take effect",
)
async def sweep_address_change(
    params: Annotated[FLAddressChangeSweepParams, Query()],
    records: SubjectLookup,
    address_change_collection: AddressChangeCollection,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    registrierungen_collection: RegistrierungenCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    grants_collection: GrantsCollection,
    grants_announced_collection: GrantsAnnouncedCollection,
    outbox_collection: OutboxCollection,
    grants_approval_requests_collection: GrantApprovalRequestsCollection,
    invitations_collection: InvitationsCollection,
    ban_list_collection: BanListCollection,
    sperrliste: SperrlisteLookup,
    action_log_collection: ActionLogCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLAddressChangeSweepResponse:
    """
    End a bounded share of the live changes whose waiting step lapsed, and make the due ones take effect.

    **A lapsed change** -- its new mailbox's link, the question it asked the address on file, or its grant's approval by
    another administrator -- ends as `expired`: its address and reason out of the record and every log image of it
    (`removed`). **A due change**, one whose waiting time has ended and whose grant's move, where its address still
    holds the grant, was approved, is judged again as its confirmation was: a ban on either address, another pupil
    signing in on the new one, a grant its approval does not cover, a grant at the new address, or nothing left to move
    ends it discarded, and
    `discarded` counts it, its new address owed a notice that it did not take effect and never why; otherwise
    everything the replaced address holds moves, and `effective` counts it, its completion notice owed. Each notice is owed
    in the Postausgang in its change's own transaction, so none rides on this answer.

    Each change is handled in a transaction of its own that judges it again, so one confirmed, stopped, discarded or
    replaced since this call read it is left standing. **A pass is a run of calls, each handing the next the `nach` the last
    answered**, the first naming none; it ends at the call answering `nach` null. A call reaches at most a fixed share of the
    changes after `nach`, in `_id` order, and the pass holds no state on the server. A change whose handling fails is
    logged by its id and passed, holding back nobody behind it; it stays due, and the next pass tries it again. Where the
    request's deadline cuts the call, it stops at that change, warns once, and answers what it did. `remaining` counts
    the changes standing due after the call, so it is no stopping condition.
    """

    [read] = await aggregate_many_from_db(
        collection=address_change_collection,
        # One past the share, so a call ending exactly at the share's last row can tell whether any follow.
        pipeline=_pipeline(now=germany_now, nach=params.nach, size=ADDRESS_CHANGE_PER_PASS + 1),
    )
    # The lapse and the due terms are disjoint, so the lapse's own judgement parts them.
    seite = [{"_id": row["_id"], "due": not is_expired(row, now=germany_now)} for row in read["seite"]]
    count = sum(row["count"] for row in read["count"])
    stamp = log_stamp(germany_now)
    # Outside every change's transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`), and only where a due change
    # asks the ban list: a page of lapses reads no season.
    governing_saison_id = await sperrliste_saison(sperrliste) if any(row["due"] for row in seite[:ADDRESS_CHANGE_PER_PASS]) else None

    removed, skipped = 0, 0
    discarded, effective = 0, 0
    reached: Any = None
    abgebrochen = False
    for row in seite[:ADDRESS_CHANGE_PER_PASS]:
        reached = row["_id"]
        which, was = ("due", "effect") if row["due"] else ("lapsed", "end")
        # Each caught outside the change's session.
        try:
            if row["due"]:
                ergebnis = await _make_the_due_change_take_effect(
                    row,
                    records=records,
                    sperrliste=sperrliste,
                    governing_saison_id=governing_saison_id,
                    address_change_collection=address_change_collection,
                    spieler_collection=spieler_collection,
                    schiedsrichter_collection=schiedsrichter_collection,
                    saison_teams_collection=saison_teams_collection,
                    bewerbungen_collection=bewerbungen_collection,
                    registrierungen_collection=registrierungen_collection,
                    spielbestaetigungen_collection=spielbestaetigungen_collection,
                    grants_collection=grants_collection,
                    grants_announced_collection=grants_announced_collection,
                    outbox_collection=outbox_collection,
                    grants_approval_requests_collection=grants_approval_requests_collection,
                    invitations_collection=invitations_collection,
                    ban_list_collection=ban_list_collection,
                    action_log_collection=action_log_collection,
                    db=db,
                    key=config.sperrliste_key,
                    now=germany_now,
                    stamp=stamp,
                )
            else:
                await _end_the_lapsed_change(
                    row,
                    address_change_collection=address_change_collection,
                    outbox_collection=outbox_collection,
                    action_log_collection=action_log_collection,
                    db=db,
                    now=germany_now,
                    stamp=stamp,
                )
        except DocumentNotFoundError:
            # The filter is the judgement: confirmed, stopped, discarded or sent a fresh link since the read, and not due.
            skipped += 1
            continue
        # Any class, or the next pass stops at this change again and holds back every one behind it;
        # not `BaseException`, so a cancellation still ends the call.
        except Exception as failure:
            # The only branch an unanswered commit reaches: `with_transaction` retries one until the deadline and raises
            # it as a timeout keeping the label.
            if isinstance(failure, PyMongoError) and failure.timeout:
                uncertain = failure.has_error_label(UNKNOWN_COMMIT_RESULT)
                # Below the handler's ERROR: no record is at fault, and every later change would fail the same way.
                fl_logger.warning(
                    "address_change.sweep_cut",
                    extra={
                        "error_code": Code.UNKNOWN_OUTCOME if uncertain else Code.DATABASE_FAILED,
                        "art": which,
                        "address_change_id": str(row["_id"]),
                        # The step whose commit went out unanswered, null where none did.
                        "unanswered": was if uncertain else None,
                    },
                )
                abgebrochen = True
                break

            # The id and what locates the failure, never an address this pass handles.
            code, diagnosis = diagnosis_of(failure)
            fl_logger.error(
                "address_change.sweep_row_failed",
                extra={"error_code": code, "art": which, "step": was, "address_change_id": str(row["_id"]), "diagnosis": diagnosis},
            )
            continue

        if not row["due"]:
            removed += 1
        elif ergebnis is None:
            # Waiting on an approval, as the pipeline parks one: neither an effect nor the remainder.
            skipped += 1
        elif ergebnis == "discarded":
            discarded += 1
        else:
            effective += 1

    return FLAddressChangeSweepResponse(
        removed=removed,
        discarded=discarded,
        effective=effective,
        remaining=count - removed - discarded - effective - skipped,
        nach=reached if abgebrochen or len(seite) > ADDRESS_CHANGE_PER_PASS else None,
    )


@router.get("/sweep/moves", response_model=FLAddressChangeMovesResponse, summary="List the sign-in accounts the effects still owe to carry")
async def get_address_change_moves(address_change_collection: AddressChangeCollection) -> FLAddressChangeMovesResponse:
    """
    List, oldest first and a page at a time, the ended changes still owing to carry a sign-in account to their new address.

    Each effect owed its carry in its own transaction, so a lost answer loses none. The caller moves each account and
    hands the ids it moved to `POST /address_change/sweep/moves/done`; one it could not move is listed again by the
    next call. Moving one twice finds no account left, so no claim holds them. Server to server alone: the answer names
    addresses.
    """

    owed = await pull_many_from_db(
        collection=address_change_collection,
        db_filter={"move": {"$type": "object"}},
        sort_by=[("_id", ASCENDING)],
        limit=LIST_LIMIT_DEFAULT,
        projection=["move"],
    )

    return FLAddressChangeMovesResponse(
        moves=[FLAddressChangeOpenMove(id=row["_id"], von=row["move"]["von"], nach=row["move"]["nach"]) for row in owed]
    )


@router.post(
    "/sweep/moves/done",
    response_model=FLAddressChangeMovesDoneResponse,
    summary="Take the carries done off their changes",
)
async def post_address_change_moves_done(
    done_data: Annotated[FLAddressChangeMovesDonePayload, Body()],
    address_change_collection: AddressChangeCollection,
) -> FLAddressChangeMovesDoneResponse:
    """Take the owed carry off each named change, counting the ones that owed one; an id owing none is left alone."""

    # By id alone: the log keeps the filter, and an address would stand in it.
    result = await patch_many_in_db(
        collection=address_change_collection,
        db_filter={"_id": {"$in": sorted(set(done_data.ids))}, "move": {"$type": "object"}},
        update={"$unset": {"move": ""}},
    )

    return FLAddressChangeMovesDoneResponse(done=result.modified_count)


@router.post(
    "/adresse",
    response_model=FLAddressChangeAdresseResponse,
    summary="Say which address a live change would move to",
    openapi_extra=SAFE,
)
async def get_address_change_adresse(
    adresse_data: Annotated[FLAddressChangeAdressePayload, Body()],
    address_change_collection: AddressChangeReadCollection,
) -> FLAddressChangeAdresseResponse:
    """
    Answer the new address of the live change the new mailbox's link token or the change's id names, folded to the sign-in identifier.

    For the frontend's server alone, which asks its sign-in store whether an account stands there before a press, a link's
    view or an approval; the link's own view never serves the address. A token or id naming no live change -- unknown,
    ended, or the stop link's token -- is answered null rather than refused, so a lapsed or answered link costs no
    error. Stores nothing, and a POST for `POST /identity/subject`'s reason: the token travels in the body, and the
    address only in the answer.
    """

    db_filter = (
        {"_id": adresse_data.address_change_id, **LIVE_TERMS}
        if adresse_data.token is None
        else {"token_hashes": hash_token(adresse_data.token), **LIVE_TERMS}
    )
    record = await address_change_collection.find_one(db_filter, projection={"email": 1})

    return FLAddressChangeAdresseResponse(email=None if record is None else sign_in_identifier(str(record["email"])))
