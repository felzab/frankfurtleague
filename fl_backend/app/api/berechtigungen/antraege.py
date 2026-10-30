"""
API · the grants' requests: a grant or a promotion to owner waiting on a second administrator's approval

Every read filters on `bis`, so a lapsed request is gone the moment it lapses, whatever the TTL monitor has not yet
removed or a restore has put back.
"""

from collections.abc import Mapping, Sequence, Set
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from typing import Any, Literal

from bson import ObjectId
from pydantic import SecretStr
from pymongo import ASCENDING
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.berechtigungen.schemas import as_utc
from app.api.berechtigungen.services import haelt_seit
from app.api.postausgang.services import final_update
from app.core.codes import Code
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, delete_many_from_db, loeschen_many_from_db, patch_many_in_db, refuse
from app.core.exceptions import DocumentNotFoundError, WriteRefusal
from app.core.journal import JournalLine
from app.core.security import loeschung_journal_hash
from app.shared.schemas.bounds import GENEHMIGUNG_TAGE
from app.shared.schemas.literals import FLApprovalDenied, FLVerwaltung


def compose_antrag(*, adresse: str, verwaltung: str, grant_id: ObjectId | None, started_by: str, now: datetime) -> dict[str, Any]:
    """The whole request a grant or a promotion inserts, its `approval` the block an address change's approval keeps."""

    return {
        "adresse": adresse,
        "grant_id": grant_id,
        "approval": {
            "verwaltung": verwaltung,
            # Its approver held their grant since then (`app/api/berechtigungen/services.py :: haelt_seit`).
            "asked_at": now.astimezone(UTC),
            # The address change's week: an approver away for a weekend is no reason to ask again.
            "bis": now.astimezone(UTC) + timedelta(days=GENEHMIGUNG_TAGE),
            "started_by": started_by,
        },
    }


def build_offen_filter(now: datetime) -> dict[str, Any]:
    """The requests not yet lapsed, the term every read carries: a row's presence says nothing."""

    return {"approval.bis": {"$gt": now.astimezone(UTC)}}


def ist_offen(antrag: Mapping[str, Any], *, now: datetime) -> bool:
    return as_utc(antrag["approval"]["bis"]) > now.astimezone(UTC)


def antrag_steht(
    antrag: Mapping[str, Any], *, grants: Sequence[Mapping[str, Any]], announced: Sequence[Mapping[str, Any]], barred: Set[str]
) -> bool:
    """Whether the request's requester still holds, since before it and unbarred, the tier it asks for.

    A revoke, a demotion or a ban stops a person acting, so it stops what they asked for too.
    """

    genehmigung = antrag["approval"]
    von = str(genehmigung["started_by"])

    return von not in barred and haelt_seit(
        von, verwaltung=str(genehmigung["verwaltung"]), vor=genehmigung["asked_at"], grants=grants, announced=announced
    )


async def read_the_antraege(
    *, berechtigungen_antraege_collection: AsyncCollection, now: datetime, session: AsyncClientSession | None = None
) -> list[Mapping[str, Any]]:
    """Every request not yet lapsed, oldest first, unbounded: one per address, as few as the grants that make them."""

    return await aggregate_many_from_db(
        collection=berechtigungen_antraege_collection,
        pipeline=[{"$match": build_offen_filter(now)}, {"$sort": {"approval.asked_at": ASCENDING, "_id": ASCENDING}}],
        session=session,
    )


async def read_the_antraege_of(
    *, berechtigungen_antraege_collection: AsyncCollection, identifier: str, now: datetime, session: AsyncClientSession | None
) -> list[Mapping[str, Any]]:
    """Every request not yet lapsed about this folded address or made by it, oldest first: what an erasure of it removes."""

    return await aggregate_many_from_db(
        collection=berechtigungen_antraege_collection,
        pipeline=[
            {"$match": {"$or": [{"adresse": identifier}, {"approval.started_by": identifier}], **build_offen_filter(now)}},
            {"$project": {"adresse": 1, "approval.verwaltung": 1, "approval.asked_at": 1}},
            {"$sort": {"approval.asked_at": ASCENDING, "_id": ASCENDING}},
        ],
        session=session,
    )


async def pull_the_antrag(
    *, berechtigungen_antraege_collection: AsyncCollection, approval_request_id: ObjectId, now: datetime, session: AsyncClientSession
) -> Mapping[str, Any]:
    """The request this id names, or 404 where none stands: decided, withdrawn, erased or lapsed alike."""

    found = await aggregate_many_from_db(
        collection=berechtigungen_antraege_collection,
        pipeline=[{"$match": {"_id": approval_request_id, **build_offen_filter(now)}}],
        session=session,
    )
    if not found:
        raise DocumentNotFoundError()

    return found[0]


async def clear_the_address_in_session(
    *, berechtigungen_antraege_collection: AsyncCollection, adresse: str, now: datetime, session: AsyncClientSession
) -> None:
    """Refuse a second request for this folded address, and remove a lapsed one the unique index would hold against it.

    Removed by id, its image kept: a filter on the address would copy it into the log's filter text.
    """

    rows = await aggregate_many_from_db(
        collection=berechtigungen_antraege_collection,
        pipeline=[{"$match": {"adresse": adresse}}, {"$project": {"approval.bis": 1}}],
        session=session,
    )
    refuse(find_antrag_offen_refusal(offen=any(ist_offen(row, now=now) for row in rows)))
    if rows:
        await delete_many_from_db(
            collection=berechtigungen_antraege_collection, db_filter={"_id": {"$in": [row["_id"] for row in rows]}}, session=session
        )


async def settle_the_notices_in_session(
    *, postausgang_collection: AsyncCollection, antrag_ids: Sequence[ObjectId], now: datetime, session: AsyncClientSession
) -> None:
    """A decided or erased request's notices still unsent, settled as gone: nothing is left to approve.

    One a drain holds already is sent all the same, its claim settling it.
    """

    if antrag_ids:
        await patch_many_in_db(
            collection=postausgang_collection,
            db_filter={
                "reference.collection": str(Collection.BERECHTIGUNGEN_ANTRAEGE),
                "reference.id": {"$in": list(antrag_ids)},
                "reference.seat": None,
                "stand": "open",
            },
            update=final_update("dropped", now=now),
            session=session,
        )


async def settle_the_requesters_notices_in_session(
    *,
    berechtigungen_antraege_collection: AsyncCollection,
    postausgang_collection: AsyncCollection,
    started_by: str,
    verwaltung: FLVerwaltung | None,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """The unsent notices of the open requests this folded address made and its grant no longer carries.

    Every one where the grant went (`verwaltung` None), and those asking `verwaltung` alone where the holder lost that
    tier. The requests stay, `antrag_steht` refusing their approval; their mail goes, since no approver could act on it.
    """

    rows = await aggregate_many_from_db(
        collection=berechtigungen_antraege_collection,
        pipeline=[
            {
                "$match": {
                    "approval.started_by": started_by,
                    **({} if verwaltung is None else {"approval.verwaltung": verwaltung}),
                    **build_offen_filter(now),
                }
            },
            {"$project": {"_id": 1}},
        ],
        session=session,
    )
    await settle_the_notices_in_session(
        postausgang_collection=postausgang_collection, antrag_ids=[row["_id"] for row in rows], now=now, session=session
    )


async def remove_the_antrag_in_session(
    *,
    berechtigungen_antraege_collection: AsyncCollection,
    postausgang_collection: AsyncCollection,
    approval_request_id: ObjectId,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Remove a decided request, its image kept: who asked, for what and when stays on the log beside the grant it made."""

    await delete_many_from_db(collection=berechtigungen_antraege_collection, db_filter={"_id": approval_request_id}, session=session)
    await settle_the_notices_in_session(
        postausgang_collection=postausgang_collection, antrag_ids=[approval_request_id], now=now, session=session
    )


async def end_the_antraege_about_in_session(
    *,
    berechtigungen_antraege_collection: AsyncCollection,
    postausgang_collection: AsyncCollection,
    adresse: str,
    now: datetime,
    session: AsyncClientSession,
) -> list[Mapping[str, Any]]:
    """End every request about this folded address as a refusal ends it, lapsed ones too, answering each for the caller's journal.

    Never carried to the new address, which would grant what its approvers never judged.
    """

    rows = await aggregate_many_from_db(
        collection=berechtigungen_antraege_collection,
        pipeline=[{"$match": {"adresse": adresse}}, {"$project": {"adresse": 1, "approval": 1}}],
        session=session,
    )
    for row in rows:
        await remove_the_antrag_in_session(
            berechtigungen_antraege_collection=berechtigungen_antraege_collection,
            postausgang_collection=postausgang_collection,
            approval_request_id=row["_id"],
            now=now,
            session=session,
        )

    return rows


async def loeschen_antraege_in_session(
    *,
    berechtigungen_antraege_collection: AsyncCollection,
    postausgang_collection: AsyncCollection,
    identifier: str,
    now: datetime,
    session: AsyncClientSession,
) -> int:
    """Every request about this folded address or made by it, lapsed or not, removed by id and imageless.

    A request outlives neither person: the requester's grant goes in the same erasure, the subject's address is what it destroys.
    """

    rows = await aggregate_many_from_db(
        collection=berechtigungen_antraege_collection,
        pipeline=[{"$match": {"$or": [{"adresse": identifier}, {"approval.started_by": identifier}]}}, {"$project": {"_id": 1}}],
        session=session,
    )
    if rows:
        await loeschen_many_from_db(
            collection=berechtigungen_antraege_collection, db_filter={"_id": {"$in": [row["_id"] for row in rows]}}, session=session
        )
        await settle_the_notices_in_session(
            postausgang_collection=postausgang_collection, antrag_ids=[row["_id"] for row in rows], now=now, session=session
        )

    return len(rows)


# How a request ended, as its journal line names it: the replay tells again whom the end told.
AntragEndeLine = Literal["antrag_abgelehnt", "antrag_zurueckgezogen", "antrag_beendet"]


def antrag_line(*, antrag: Mapping[str, Any], art: AntragEndeLine, am: str, key: SecretStr) -> JournalLine:
    """An ended request's line, so a restore from before its end does not bring it back to be approved."""

    return JournalLine(
        person_hash=loeschung_journal_hash(str(antrag["adresse"]), key=key),
        art=art,
        collection=Collection.BERECHTIGUNGEN_ANTRAEGE,
        record_id=antrag["_id"],
        am=am,
    )


def find_antrag_offen_refusal(*, offen: bool) -> WriteRefusal | None:
    """`grant_approval_request_open`: a request for this address waits already, which its approver or a refusal decides first."""

    if not offen:
        return None

    return WriteRefusal(
        error_code=Code.GRANT_APPROVAL_REQUEST_OPEN,
        status=HTTPStatus.CONFLICT,
    )


def find_genehmigung_verwehrt_refusal(*, denied: FLApprovalDenied | None) -> WriteRefusal | None:
    """Why this administrator may not decide the request, or `None`.

    `grant_approval_denied` for a request about the actor or made by them, `grant_approval_owner` for an owner's
    without an owner's power, `grant_approval_younger` for a younger grant.
    """

    if denied is None:
        return None

    if denied == "younger":
        return WriteRefusal(
            error_code=Code.GRANT_APPROVAL_YOUNGER,
            status=HTTPStatus.FORBIDDEN,
        )

    if denied == "owner":
        return WriteRefusal(
            error_code=Code.GRANT_APPROVAL_OWNER,
            status=HTTPStatus.FORBIDDEN,
        )

    return WriteRefusal(
        error_code=Code.GRANT_APPROVAL_DENIED,
        status=HTTPStatus.FORBIDDEN,
    )


def find_antrag_verfallen_refusal(*, stands: bool) -> WriteRefusal | None:
    """`grant_approval_request_lapsed`: the request's requester does not hold, since before it, the tier it asks for."""

    if stands:
        return None

    return WriteRefusal(
        error_code=Code.GRANT_APPROVAL_REQUEST_LAPSED,
        status=HTTPStatus.CONFLICT,
    )
