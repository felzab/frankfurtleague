from collections.abc import Mapping, Sequence, Set
from datetime import datetime
from typing import Annotated, Any

from bson import ObjectId
from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.address_change.services import build_awaiting_approval_filter
from app.api.berechtigungen.antraege import (
    antrag_line,
    antrag_steht,
    clear_the_address_in_session,
    compose_antrag,
    find_antrag_verfallen_refusal,
    find_approval_denied_refusal,
    pull_the_antrag,
    read_the_antraege,
    remove_the_antrag_in_session,
    settle_the_requesters_notices_in_session,
)
from app.api.berechtigungen.crud import (
    grant_in_session,
    owe_in_session,
    pull_the_list_to_judge,
    read_berechtigungen,
    read_the_announced,
    revoke_in_session,
)
from app.api.berechtigungen.guard import verify_actor_is_admin
from app.api.berechtigungen.schemas import (
    FLBerechtigung,
    FLGrantAddressChange,
    FLGrantApprovalRequestDeclinedResponse,
    FLGrantApprovalRequestRow,
    FLGrantRow,
    FLGrantsListResponse,
    FLGrantSnapshot,
    FLGrantStufeResponse,
    FLGrantWriteResponse,
    FLPatchGrantPayload,
    FLPostGrantPayload,
    FLPostGrantResponse,
)
from app.api.berechtigungen.services import (
    OWNER,
    compare,
    compose_announced,
    compose_mitteilung,
    find_barred_refusal,
    find_inhaber_refusal,
    find_letzter_inhaber_refusal,
    find_mindestzahl_refusal,
    find_nur_inhaber_refusal,
    find_vorhanden_refusal,
    found_ids,
    genehmiger_of,
    genehmigung_verwehrt,
    holds_an_owners_power,
    stand_of,
)
from app.api.identity.services import address_change_viewable_denied
from app.api.outbox.schemas import FLOutboxReference
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, hash_gesperrt
from app.api.sperrliste.services import withheld_actor
from app.core.collections import Collection
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import aggregate_many_from_db, erase_many_from_db, patch_one_in_db, post_one_to_db, refuse
from app.core.dependencies import (
    AddressChangeCollection,
    DBClient,
    GrantApprovalRequestsCollection,
    GrantsAnnouncedCollection,
    GrantsCollection,
    OutboxCollection,
    get_germany_now,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.journal import Journal
from app.core.recording import log_stamp
from app.core.routing import by_id
from app.core.security import bind_actor, get_actor_auth_time, get_actor_email, verify_access_admin, verify_recent_confirmation, verify_step_up
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/grants",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)

# The one tier a grant is made with: `owner` is reached only by an owner's tier change.
ADMINISTRATION = "administration"


@router.get("", response_model=FLGrantsListResponse, summary="List who may enter the administration")
async def get_grants(
    grants_collection: GrantsCollection,
    grants_announced_collection: GrantsAnnouncedCollection,
    address_changes_collection: AddressChangeCollection,
    grant_approval_requests_collection: GrantApprovalRequestsCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    now: datetime = Depends(get_germany_now),
) -> FLGrantsListResponse:
    """
    List every grant of access to the administration, by address: its tier, who granted it and when.

    Uncapped, as few people hold one. An address on the ban list is answered as `null` beside `barred`,
    never in plain, and so is a barred `granted_by`, beside `granted_by_barred`; it is otherwise an administrator's address
    for a grant made here and whatever the database edit wrote for one made there.

    `address_change` names the change of a grant's address waiting on an administrator's approval: its new address, how it was
    started (`way`), the administrator who started it and the reason they recorded, and why this administrator may not approve
    it, where they may not: their own, one they started, or an owner's without an owner's power
    (`POST /address_change/{address_change_id}/approval`); and why the address tool refuses it them (`viewable_denied`). An
    owner's change withholds its new address, starter and reason from that non-owner, as the address tool refuses them an
    owner's address; a barred new address or starter is withheld as on a grant's row. A change any step of which lapsed is
    left out: its approval is refused, and the next hourly pass ends it.

    `approval_requests` lists every grant and promotion waiting on a second administrator's approval and not yet lapsed, oldest first:
    the address, the tier asked, who asked and when, until when it waits, whether its requester still holds that tier since
    before it (`stands`), and why this administrator may not approve it, where they may not. A barred address is withheld as on a
    grant's row.
    """

    actor = sign_in_identifier(operator)
    # A snapshot, so the grants, their records and the changes waiting on an approval are read as of one moment.
    async with db.start_session(snapshot=True) as session:
        rows = await read_berechtigungen(grants_collection=grants_collection, session=session)
        announced = await read_the_announced(grants_announced_collection=grants_announced_collection, session=session)
        antraege = await read_the_antraege(grant_approval_requests_collection=grant_approval_requests_collection, now=now, session=session)
        grants = [FLBerechtigung.model_validate(row) for row in rows]
        barred = await adressen_gesperrt(
            sperrliste,
            [grant.adresse for grant in grants]
            + [sign_in_identifier(grant.granted_by) for grant in grants]
            + [str(approval_request["adresse"]) for approval_request in antraege]
            + [str(approval_request["approval"]["started_by"]) for approval_request in antraege],
            session=session,
        )
        wartend = {
            record["adresse"]: record
            for record in await aggregate_many_from_db(
                collection=address_changes_collection,
                pipeline=[
                    {"$match": build_awaiting_approval_filter([grant.adresse for grant in grants if grant.adresse not in barred], now=now)}
                ],
                session=session,
            )
        }
        # A pending new address and an administrator's start are judged as every address the page serves is.
        barred_im_wechsel = await adressen_gesperrt(
            sperrliste,
            [str(record["email"]) for record in wartend.values()] + [str(record["approval"]["started_by"]) for record in wartend.values()],
            session=session,
        )
    owner = holds_an_owners_power(actor=actor, auth_time=auth_time, grants=rows, announced=announced)

    served = []
    for grant in grants:
        is_barred = grant.adresse in barred
        erteilt_von = withheld_actor(grant.granted_by, barred)
        record = None if is_barred else wartend.get(grant.adresse)
        served.append(
            FLGrantRow(
                id=grant.id,
                adresse=None if is_barred else grant.adresse,
                barred=is_barred,
                admin_tier=grant.admin_tier,
                granted_by=erteilt_von,
                granted_by_barred=erteilt_von is None,
                granted_at=grant.granted_at,
                address_change=None
                if record is None
                else _adresswechsel_zeile(
                    record, actor=actor, auth_time=auth_time, owner=owner, grants=rows, announced=announced, barred=barred_im_wechsel
                ),
                version=grant.version,
            )
        )

    return FLGrantsListResponse(
        grants=served,
        approval_requests=[
            _antrag_zeile(approval_request, actor=actor, owner=owner, grants=rows, announced=announced, barred=barred)
            for approval_request in antraege
        ],
    )


def _adresswechsel_zeile(
    record: Mapping[str, Any],
    *,
    actor: str,
    auth_time: int,
    owner: bool,
    grants: Sequence[Mapping[str, Any]],
    announced: Sequence[Mapping[str, Any]],
    barred: Set[str],
) -> FLGrantAddressChange:
    approval, way = record["approval"], record["way"]
    denied = genehmigung_verwehrt(target=record["adresse"], approval=approval, actor=actor, owner=owner, grants=grants, announced=announced)
    # `admin_address`'s reach: the tool refuses a non-owner an owner's address, so this row tells them no more of it.
    withheld = denied == "owner"
    email = str(record["email"])
    # On the person's own start the starter is the address on file, the row's own.
    by = None if way == "account" else str(approval["started_by"])

    return FLGrantAddressChange(
        id=record["_id"],
        email=None if withheld or email in barred else email,
        email_barred=email in barred,
        way=way,
        started_by=None if withheld else withheld_actor(by, barred),
        started_by_barred=by is not None and withheld_actor(by, barred) is None,
        grund=None if withheld else record.get("grund"),
        confirmed=record.get("confirmed_at") is not None,
        until=approval["until"],
        denied=denied,
        viewable_denied=address_change_viewable_denied(record["adresse"], actor=actor, auth_time=auth_time, grants=grants, announced=announced),
    )


def _antrag_zeile(
    approval_request: Mapping[str, Any],
    *,
    actor: str,
    owner: bool,
    grants: Sequence[Mapping[str, Any]],
    announced: Sequence[Mapping[str, Any]],
    barred: Set[str],
) -> FLGrantApprovalRequestRow:
    adresse, approval = str(approval_request["adresse"]), approval_request["approval"]
    by = withheld_actor(str(approval["started_by"]), barred)

    return FLGrantApprovalRequestRow(
        id=approval_request["_id"],
        adresse=None if adresse in barred else adresse,
        barred=adresse in barred,
        grant_id=approval_request["grant_id"],
        admin_tier=approval["admin_tier"],
        started_by=by,
        started_by_barred=by is None,
        asked_at=approval["asked_at"],
        until=approval["until"],
        stands=antrag_steht(approval_request, grants=grants, announced=announced, barred=barred),
        denied=genehmigung_verwehrt(target=adresse, approval=approval, actor=actor, owner=owner, grants=grants, announced=announced),
    )


@router.post(
    "",
    response_model=FLPostGrantResponse,
    status_code=201,
    summary="Grant access to the administration",
    dependencies=[Depends(verify_recent_confirmation)],
)
async def post_grant(
    berechtigung_data: Annotated[FLPostGrantPayload, Body()],
    grants_collection: GrantsCollection,
    grants_announced_collection: GrantsAnnouncedCollection,
    outbox_collection: OutboxCollection,
    grant_approval_requests_collection: GrantApprovalRequestsCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    granted_by: str = Depends(get_actor_email),
    now: datetime = Depends(get_germany_now),
) -> FLPostGrantResponse:
    """
    Grant an address access to the administration, as `administration`, or ask another administrator to. No request grants `owner`.

    **Four eyes**: where another administrator could approve it -- a live, unbarred grant in effect now, neither this administrator
    nor the address -- the grant is not made: a request is, answered with `requested` set and its id, and the grant takes effect
    only on that approval (`POST /grants/approval_requests/{approval_request_id}/approval`). A lone administrator grants alone.

    The address is stored folded to its sign-in identifier, the spelling every admin-tier request is judged by. Refused where a live
    grant already holds the address (`grant_exists`), where the ban list
    holds it (`grant_barred`), and where a request about it waits already (`grant_approval_request_open`). The grant takes effect on
    the next request, for a session signed in after it alone -- an older one is refused `session_refused` on every admin-tier route -- and
    its announcement is owed to every administrator in the same transaction. Like a revoke and a tier
    change, it takes a passkey sign-in or confirmation no older than `ENROLMENT_WINDOW_MINUTES`, refused `confirmation_required` otherwise.
    """

    adresse = sign_in_identifier(str(berechtigung_data.email))
    actor = sign_in_identifier(granted_by)
    # Keyed from the payload's own value, as the ban write keys it (`app/api/identity/system_router.py :: get_subjekt`).
    hashed = sperrliste.hash_of(str(berechtigung_data.email))

    async def judge_and_grant(session: AsyncClientSession) -> tuple[ObjectId, bool]:
        """Anchor and read the list, ask the ban list, then write the request, or the grant and its announced row, owing its notice."""

        grants = await pull_the_list_to_judge(grants_collection=grants_collection, session=session)
        refuse(find_vorhanden_refusal(adresse=adresse, grants=grants))

        barred = await hash_gesperrt(sperrliste, hashed, session=session)
        refuse(find_barred_refusal(barred=barred))

        await clear_the_address_in_session(
            grant_approval_requests_collection=grant_approval_requests_collection, adresse=adresse, now=now, session=session
        )
        if approver := await _genehmiger(
            ADMINISTRATION,
            excepted={adresse, actor},
            grants=grants,
            grants_announced_collection=grants_announced_collection,
            sperrliste=sperrliste,
            now=now,
            session=session,
        ):
            created = await post_one_to_db(
                collection=grant_approval_requests_collection,
                document=compose_antrag(adresse=adresse, admin_tier=ADMINISTRATION, grant_id=None, started_by=actor, now=now),
                session=session,
            )
            await _queue_the_request(
                created.inserted_id,
                adresse=adresse,
                admin_tier=ADMINISTRATION,
                started_by=granted_by,
                approver=approver,
                grants_collection=grants_collection,
                outbox_collection=outbox_collection,
                now=now,
                session=session,
            )

            return created.inserted_id, True

        created_id = await grant_in_session(
            adresse=adresse,
            admin_tier=ADMINISTRATION,
            granted_by=granted_by,
            barred=frozenset(),
            grants_collection=grants_collection,
            grants_announced_collection=grants_announced_collection,
            outbox_collection=outbox_collection,
            now=now,
            session=session,
        )

        return created_id, False

    async with transaction_session(db) as session:
        created_id, beantragt = await session.with_transaction(judge_and_grant)

    return FLPostGrantResponse(created_id=created_id, requested=beantragt)


async def _queue_the_request(
    approval_request_id: ObjectId,
    *,
    adresse: str,
    admin_tier: str,
    started_by: str,
    approver: Sequence[str],
    grants_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Owe the request to whoever could approve it now, about the request itself, so its decision settles what is still unsent."""

    await owe_in_session(
        [
            compose_mitteilung(
                grant_id=approval_request_id,
                art="requested",
                current=FLGrantSnapshot.model_validate({"adresse": adresse, "admin_tier": admin_tier}),
                before=None,
                changed_by=started_by,
                now=now,
                # Neither address is barred: the request's own write refused a barred one, and a barred actor writes nothing.
                barred=frozenset(),
            )
        ],
        outbox_collection=outbox_collection,
        grants_collection=grants_collection,
        now=now,
        session=session,
        an=approver,
        reference=FLOutboxReference(collection=Collection.GRANT_APPROVAL_REQUESTS, id=approval_request_id, seat=None),
    )


async def _genehmiger(
    admin_tier: str,
    *,
    excepted: Set[str],
    grants: Sequence[Mapping[str, Any]],
    grants_announced_collection: AsyncCollection,
    sperrliste: SperrlisteLookup,
    now: datetime,
    session: AsyncClientSession,
) -> list[str]:
    """Everybody but `excepted` who could approve an act on a grant of `admin_tier` asked now.

    Judged on the grants the caller anchored, so a grant or a revoke beside it conflicts.
    """

    announced = await read_the_announced(grants_announced_collection=grants_announced_collection, session=session)
    barred = await adressen_gesperrt(sperrliste, [str(row["adresse"]) for row in grants], session=session)

    return genehmiger_of(admin_tier=admin_tier, excepted=excepted, grants=grants, announced=announced, barred=barred, before=now)


@router.delete(
    by_id("grant_id"),
    response_model=FLGrantWriteResponse,
    summary="Revoke access to the administration",
    dependencies=[Depends(verify_recent_confirmation)],
)
async def delete_grant(
    grant_id: CustomRouteObjectId,
    grants_collection: GrantsCollection,
    grants_announced_collection: GrantsAnnouncedCollection,
    outbox_collection: OutboxCollection,
    grant_approval_requests_collection: GrantApprovalRequestsCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    revoked_by: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    now: datetime = Depends(get_germany_now),
) -> FLGrantWriteResponse:
    """
    Revoke one grant, removing the row. HARD, no soft form; the revoked address meets `actor_not_admin` on its next request.

    Only an `owner` revokes (`grant_only_owner`), judged on the actor's own grant inside the transaction, and before anything
    about the target is answered; an owner's sign-in older than the moment they became one is refused the same. 404 where no grant
    has the id. Refused for an `owner` row (`grant_owner`), which is made an
    administrator first, and where fewer than two live, unbarred grants would remain (`grant_minimum_count`). The removal's
    announcement is queued in the same transaction, after any change to the row made in the database and not yet announced. A sign-in
    or confirmation older than `ENROLMENT_WINDOW_MINUTES` is refused `confirmation_required`, as the grant's is.
    """

    actor = sign_in_identifier(revoked_by)

    async def judge_and_revoke(session: AsyncClientSession) -> None:
        """Anchor and read the list, judge the actor and the row against it, then remove the row, its announced row, and queue both notices."""

        grants = await pull_the_list_to_judge(grants_collection=grants_collection, session=session)
        records = await read_the_announced(grants_announced_collection=grants_announced_collection, session=session)
        refuse(find_nur_inhaber_refusal(actor=actor, auth_time=auth_time, grants=grants, announced=records))

        grant = next((row for row in grants if row["_id"] == grant_id), None)
        if grant is None:
            # Resolved from the list already read rather than a second query, so a miss is a 404 before
            # anything is removed: `delete_many_from_db` taking no row would answer 200.
            raise DocumentNotFoundError()

        refuse(find_inhaber_refusal(grant=grant))

        live = grants
        barred = await adressen_gesperrt(sperrliste, [str(row["adresse"]) for row in live], session=session)
        remaining = [row for row in live if row["_id"] != grant_id and row["adresse"] not in barred]
        refuse(find_mindestzahl_refusal(remaining=len(remaining)))

        await revoke_in_session(
            grant=grant,
            announced=[record for record in records if record["_id"] == grant_id],
            revoked_by=revoked_by,
            barred=barred,
            grants_collection=grants_collection,
            grants_announced_collection=grants_announced_collection,
            outbox_collection=outbox_collection,
            now=now,
            session=session,
        )
        await settle_the_requesters_notices_in_session(
            grant_approval_requests_collection=grant_approval_requests_collection,
            outbox_collection=outbox_collection,
            started_by=str(grant["adresse"]),
            admin_tier=None,
            now=now,
            session=session,
        )

    async with transaction_session(db) as session:
        await session.with_transaction(judge_and_revoke)

    return FLGrantWriteResponse(grant_id=grant_id)


@router.patch(
    by_id("grant_id"),
    response_model=FLGrantStufeResponse,
    summary="Change a grant between administrator and owner",
    dependencies=[Depends(verify_recent_confirmation)],
)
async def patch_grant(
    grant_id: CustomRouteObjectId,
    berechtigung_data: Annotated[FLPatchGrantPayload, Body()],
    grants_collection: GrantsCollection,
    grants_announced_collection: GrantsAnnouncedCollection,
    outbox_collection: OutboxCollection,
    grant_approval_requests_collection: GrantApprovalRequestsCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    changed_by: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    now: datetime = Depends(get_germany_now),
) -> FLGrantStufeResponse:
    """
    Make an administrator an owner, or an owner an administrator; an owner steps down by naming their own grant.

    Only an `owner` changes a tier (`grant_only_owner`), judged on the actor's own grant inside the transaction, and before
    anything about the target is answered; an owner's sign-in older than the moment they became one is refused the same.

    **Four eyes on a promotion**: where another owner could approve it -- a live, unbarred `owner` grant in effect now, neither this
    owner nor the promoted address -- the tier is not moved: a request is, answered with `requested` set, and the promotion takes
    effect only on that approval (`POST /grants/approval_requests/{approval_request_id}/approval`). A lone owner promotes alone. A demotion
    and a step-down take effect at once.

    A promotion holds for a sign-in after it alone: the promoted administrator's older sessions keep administering and take no owner's
    step until they sign in again. A demotion takes the tier from every session at once. 404 where no live grant has the id. A
    promotion of an address on the ban list is refused (`grant_barred`), one whose request waits already
    (`grant_approval_request_open`), and a demotion leaving no live, unbarred owner (`grant_last_owner`). Naming the tier the grant
    holds changes nothing and answers 200. The change reaches the next request; its announcement is queued in the same transaction, after
    any change to the row made in the database and not yet announced, and a grant found that way is stamped `gefunden_am` as
    `POST /grants/reconciliation` stamps one. A sign-in or confirmation older than `ENROLMENT_WINDOW_MINUTES` is refused
    `confirmation_required`, as the grant's is.
    """

    actor = sign_in_identifier(changed_by)
    admin_tier = berechtigung_data.admin_tier

    async def judge_and_change(session: AsyncClientSession) -> bool:
        """Read the list, judge the actor and the row against it, then anchor and ask for the promotion, or move the tier."""

        grants = await read_berechtigungen(grants_collection=grants_collection, session=session)
        records = await read_the_announced(grants_announced_collection=grants_announced_collection, session=session)
        refuse(find_nur_inhaber_refusal(actor=actor, auth_time=auth_time, grants=grants, announced=records))

        live = grants
        # A live row alone: the list serves no other, and an owner nobody can sign in as could demote nobody back.
        grant = next((row for row in live if row["_id"] == grant_id), None)
        if grant is None:
            raise DocumentNotFoundError()

        # Ahead of the anchor, so the tier already held writes nothing, not even an `aktionen` row: an
        # answer that writes nothing is a snapshot no rival can make wrong.
        if grant["admin_tier"] == admin_tier:
            return False

        # Rereads this snapshot's rows and writes each, so a rival judging the list conflicts.
        await pull_the_list_to_judge(grants_collection=grants_collection, session=session)

        barred = await adressen_gesperrt(sperrliste, [str(row["adresse"]) for row in live], session=session)
        if admin_tier == OWNER:
            refuse(find_barred_refusal(barred=grant["adresse"] in barred))
            await clear_the_address_in_session(
                grant_approval_requests_collection=grant_approval_requests_collection, adresse=str(grant["adresse"]), now=now, session=session
            )
            if approver := await _genehmiger(
                OWNER,
                excepted={str(grant["adresse"]), actor},
                grants=grants,
                grants_announced_collection=grants_announced_collection,
                sperrliste=sperrliste,
                now=now,
                session=session,
            ):
                created = await post_one_to_db(
                    collection=grant_approval_requests_collection,
                    document=compose_antrag(adresse=str(grant["adresse"]), admin_tier=OWNER, grant_id=grant_id, started_by=actor, now=now),
                    session=session,
                )
                await _queue_the_request(
                    created.inserted_id,
                    adresse=str(grant["adresse"]),
                    admin_tier=OWNER,
                    started_by=changed_by,
                    approver=approver,
                    grants_collection=grants_collection,
                    outbox_collection=outbox_collection,
                    now=now,
                    session=session,
                )
                return True
        else:
            owners = [row for row in live if row["admin_tier"] == OWNER and row["_id"] != grant_id and row["adresse"] not in barred]
            refuse(find_letzter_inhaber_refusal(remaining_owners=len(owners)))

        await _move_the_tier_in_session(
            grant,
            admin_tier=admin_tier,
            version=berechtigung_data.version,
            records=records,
            barred=barred,
            changed_by=changed_by,
            grants_collection=grants_collection,
            grants_announced_collection=grants_announced_collection,
            outbox_collection=outbox_collection,
            now=now,
            session=session,
        )
        if admin_tier != OWNER:
            await settle_the_requesters_notices_in_session(
                grant_approval_requests_collection=grant_approval_requests_collection,
                outbox_collection=outbox_collection,
                started_by=str(grant["adresse"]),
                admin_tier=OWNER,
                now=now,
                session=session,
            )

        return False

    async with transaction_session(db) as session:
        beantragt = await session.with_transaction(judge_and_change)

    return FLGrantStufeResponse(grant_id=grant_id, requested=beantragt)


async def _move_the_tier_in_session(
    grant: Mapping[str, Any],
    *,
    admin_tier: str,
    # Required, so no caller forgets the form's version: the payload's, or `None` where no form was read.
    version: int | None,
    records: Sequence[Mapping[str, Any]],
    barred: Set[str],
    changed_by: str,
    grants_collection: AsyncCollection,
    grants_announced_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Move one live grant's tier, its announced row and its notice, as the tier change and a promotion's approval both do."""

    grant_id = grant["_id"]
    announced = [record for record in records if record["_id"] == grant_id]
    # A database edit to this row nobody was told of goes out first, as the revoke's does.
    pending = compare(grants=[grant], announced=announced)

    await patch_one_in_db(
        collection=grants_collection,
        db_filter={"_id": grant_id},
        # Stamped and seen as the pass stamps and sees a grant it finds, since the announced row moved
        # below leaves the pass nothing of this grant to find.
        update={
            "$set": {
                "admin_tier": admin_tier,
                **({"gefunden_am": now} if found_ids(pending) else {}),
                **({"gesehen_am": now} if grant.get("gesehen_am") is None else {}),
                # Its owner's power dates from now, so the promoted holder's older sessions keep
                # administering and hold none of it.
                **({"appointed_at": now} if admin_tier == OWNER else {}),
            }
        },
        # A tier change opened before another write is refused.
        expected_version=version,
        session=session,
        return_document=ReturnDocument.BEFORE,
    )

    before = stand_of(grant)
    current = before.model_copy(update={"admin_tier": admin_tier})
    await owe_in_session(
        [
            *(
                compose_mitteilung(grant_id=changed_id, art=art, current=was, before=before, changed_by=None, now=now, barred=barred)
                for changed_id, art, was, before in pending
            ),
            compose_mitteilung(
                grant_id=grant_id,
                art="changed",
                current=current,
                before=before,
                changed_by=changed_by,
                now=now,
                barred=barred,
            ),
        ],
        outbox_collection=outbox_collection,
        grants_collection=grants_collection,
        now=now,
        session=session,
    )
    # The announced row is bookkeeping, so replaced with no image.
    await erase_many_from_db(collection=grants_announced_collection, db_filter={"_id": grant_id}, session=session)
    await post_one_to_db(
        collection=grants_announced_collection,
        document=compose_announced(grant_id=grant_id, stand=current, now=now),
        session=session,
    )


@router.post(
    f"/approval_requests{by_id('approval_request_id')}/approval",
    response_model=FLGrantWriteResponse,
    summary="Approve a grant or a promotion another administrator asked for",
    # The enrolment window a grant takes, not the step-up's: the approval hands access to the administration over.
    dependencies=[Depends(verify_recent_confirmation)],
)
async def post_approval_request_approval(
    approval_request_id: CustomRouteObjectId,
    grants_collection: GrantsCollection,
    grants_announced_collection: GrantsAnnouncedCollection,
    outbox_collection: OutboxCollection,
    grant_approval_requests_collection: GrantApprovalRequestsCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    now: datetime = Depends(get_germany_now),
) -> FLGrantWriteResponse:
    """
    Approve a request, the second pair of eyes a grant or a promotion waits on.

    The grant is made, or the tier moved, and the request removed, in one transaction, the change announced to every
    administrator as one made directly is, under this administrator's name.

    Refused to the address the request is about and to the administrator who made it (`grant_approval_denied`), to anyone but an
    owner, signed in since becoming one, for a promotion (`grant_approval_owner`), to an administrator whose grant, or owner's tier,
    took effect after the request (`grant_approval_younger`), and where the requester does not hold that tier since before it,
    revoked, demoted or barred since (`grant_approval_request_lapsed`); and, as the direct act would be, where the address holds a grant by now
    (`grant_exists`) or is on the ban list (`grant_barred`). 404 for an id naming no request, a request decided, withdrawn or
    lapsed among them, and for a promotion whose grant has gone. A promotion whose grant is an owner's already removes the request and changes
    nothing. A sign-in or confirmation older than `ENROLMENT_WINDOW_MINUTES` is refused `confirmation_required`, as a grant's is.
    """

    actor = sign_in_identifier(operator)

    async def approve_the_antrag(session: AsyncClientSession) -> ObjectId:
        """Read the request and anchor the list, judge the approver and the requester, then remove the request and make the act."""

        approval_request = await pull_the_antrag(
            grant_approval_requests_collection=grant_approval_requests_collection,
            approval_request_id=approval_request_id,
            now=now,
            session=session,
        )
        adresse = str(approval_request["adresse"])
        # Written, so a revoke or a demotion of the approver or the requester committing beside it conflicts.
        grants = await pull_the_list_to_judge(grants_collection=grants_collection, session=session)
        records = await read_the_announced(grants_announced_collection=grants_announced_collection, session=session)
        barred = await adressen_gesperrt(sperrliste, [str(row["adresse"]) for row in grants] + [adresse], session=session)

        owner = holds_an_owners_power(actor=actor, auth_time=auth_time, grants=grants, announced=records)
        refuse(
            find_approval_denied_refusal(
                denied=genehmigung_verwehrt(
                    target=adresse, approval=approval_request["approval"], actor=actor, owner=owner, grants=grants, announced=records
                )
            )
        )
        refuse(find_antrag_verfallen_refusal(stands=antrag_steht(approval_request, grants=grants, announced=records, barred=barred)))

        # Removed by the write that reads it, so a second approval, a refusal or an erasure beside this one conflicts and finds none.
        await remove_the_antrag_in_session(
            grant_approval_requests_collection=grant_approval_requests_collection,
            outbox_collection=outbox_collection,
            approval_request_id=approval_request_id,
            now=now,
            session=session,
        )

        if approval_request["grant_id"] is None:
            refuse(find_vorhanden_refusal(adresse=adresse, grants=grants))
            refuse(find_barred_refusal(barred=adresse in barred))
            created_id = await grant_in_session(
                adresse=adresse,
                admin_tier=ADMINISTRATION,
                granted_by=operator,
                barred=frozenset(),
                grants_collection=grants_collection,
                grants_announced_collection=grants_announced_collection,
                outbox_collection=outbox_collection,
                now=now,
                session=session,
            )
            return created_id

        # The grant the request named, at the address it named: one repointed in the database since is somebody else's.
        grant = next((row for row in grants if row["_id"] == approval_request["grant_id"] and row["adresse"] == adresse), None)
        if grant is None:
            raise DocumentNotFoundError()
        if grant["admin_tier"] != OWNER:
            refuse(find_barred_refusal(barred=adresse in barred))
            await _move_the_tier_in_session(
                grant,
                admin_tier=OWNER,
                # An approval saves no form, so it is checked against no version.
                version=None,
                records=records,
                barred=barred,
                changed_by=operator,
                grants_collection=grants_collection,
                grants_announced_collection=grants_announced_collection,
                outbox_collection=outbox_collection,
                now=now,
                session=session,
            )

        return grant["_id"]

    async with transaction_session(db) as session:
        grant_id = await session.with_transaction(approve_the_antrag)

    return FLGrantWriteResponse(grant_id=grant_id)


@router.delete(
    f"/approval_requests{by_id('approval_request_id')}",
    response_model=FLGrantApprovalRequestDeclinedResponse,
    summary="Refuse a grant or a promotion another administrator asked for, or withdraw one's own",
    dependencies=[Depends(verify_step_up)],
)
async def delete_approval_request(
    approval_request_id: CustomRouteObjectId,
    grants_collection: GrantsCollection,
    grants_announced_collection: GrantsAnnouncedCollection,
    grant_approval_requests_collection: GrantApprovalRequestsCollection,
    outbox_collection: OutboxCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    now: datetime = Depends(get_germany_now),
) -> FLGrantApprovalRequestDeclinedResponse:
    """
    Refuse a request, or withdraw one's own: it is removed, and nothing it asked for happens. HARD, no soft form.

    Decided by whoever may approve it, refused with the approval's own codes otherwise (`grant_approval_denied`,
    `grant_approval_owner`, `grant_approval_younger`), and withdrawn by the administrator who made it, whatever their tier
    now. 404 for an id naming no request, a request decided, withdrawn or lapsed among them. A restore from a snapshot taken before it brings
    the request back only until the replay of its journal line.

    A refusal queues, in the same transaction, a notice to the request's requester naming the address and tier it asked for and
    nobody who refused it, for `POST /grants/reconciliation` to hand out; a withdrawal tells nobody.
    """

    actor = sign_in_identifier(operator)
    journal = Journal()

    @journal.attempted
    async def refuse_the_antrag(session: AsyncClientSession) -> None:
        approval_request = await pull_the_antrag(
            grant_approval_requests_collection=grant_approval_requests_collection,
            approval_request_id=approval_request_id,
            now=now,
            session=session,
        )
        grants = await read_berechtigungen(grants_collection=grants_collection, session=session)
        records = await read_the_announced(grants_announced_collection=grants_announced_collection, session=session)
        denied = genehmigung_verwehrt(
            target=approval_request["adresse"],
            approval=approval_request["approval"],
            actor=actor,
            owner=holds_an_owners_power(actor=actor, auth_time=auth_time, grants=grants, announced=records),
            grants=grants,
            announced=records,
        )
        # Its requester withdraws it: who made a request may always take it back.
        zurueckgezogen = denied == "started"
        refuse(find_approval_denied_refusal(denied=None if zurueckgezogen else denied))

        await remove_the_antrag_in_session(
            grant_approval_requests_collection=grant_approval_requests_collection,
            outbox_collection=outbox_collection,
            approval_request_id=approval_request_id,
            now=now,
            session=session,
        )
        journal.note(
            antrag_line(
                approval_request=approval_request,
                art="approval_request_withdrawn" if zurueckgezogen else "approval_request_declined",
                at=log_stamp(now),
                key=config.sperrliste_key,
            )
        )

    async with journal:
        async with transaction_session(db) as session:
            await session.with_transaction(refuse_the_antrag)

    return FLGrantApprovalRequestDeclinedResponse(approval_request_id=approval_request_id)
