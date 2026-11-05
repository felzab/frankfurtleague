"""
API · every read and write of the grants that reaches a collection

The anchor lives here beside the read it protects, so no caller can judge the list without writing
every row of it.
"""

import asyncio
from collections.abc import Mapping, Sequence, Set
from datetime import datetime
from typing import Any, Final

from bson import ObjectId
from pymongo import ASCENDING
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.berechtigungen.services import (
    Mitteilung,
    compare,
    compose_announced,
    compose_mitteilung,
    granted_since,
    owner_since,
    stand_of,
)
from app.api.outbox.schemas import FLGrantData, FLOutboxReference
from app.api.outbox.services import OwedMail, enqueue_mails
from app.api.sperrliste.lookup import BanList, adressen_gesperrt
from app.core.collections import Collection
from app.core.crud import (
    aggregate_many_from_db,
    anchor_in_db,
    delete_many_from_db,
    erase_many_from_db,
    patch_many_in_db,
    post_one_to_db,
)
from app.core.readonly import ReadCollection
from app.shared.schemas.literals import FLAdminTier


async def read_berechtigungen(*, grants_collection: ReadCollection, session: AsyncClientSession | None = None) -> list[Mapping[str, Any]]:
    """Every grant, by address, and unbounded: the floor and the recipients are both judged over the whole list."""

    return await aggregate_many_from_db(collection=grants_collection, pipeline=[{"$sort": {"adresse": ASCENDING}}], session=session)


async def pull_the_list_to_judge(
    *,
    grants_collection: AsyncCollection,
    # REQUIRED: the anchor is what closes the race, so forgetting the session has to be a TypeError
    # at the call rather than a silent reopening of it.
    session: AsyncClientSession,
) -> list[Mapping[str, Any]]:
    """Read every grant, then write each one, in the caller's transaction.

    A snapshot re-validates no read: a rival judging the list writes the same rows, so whichever
    lands second meets a write conflict and retries.
    """

    grants = await read_berechtigungen(grants_collection=grants_collection, session=session)

    # Exactly the rows the read returned, each named: the rows judged are the rows a rival must meet.
    await anchor_in_db(
        collection=grants_collection,
        db_filter={"_id": {"$in": [grant["_id"] for grant in grants]}},
        session=session,
    )

    return grants


async def _grant_and_its_record_in(
    *,
    grants_collection: ReadCollection,
    adresse: str,
    fields: list[str],
    # The request's snapshot session (`app/core/dependencies.py :: SnapshotSession`), or a commit landing between the
    # row's read and the join pairs the row before it with the record after.
    session: AsyncClientSession,
) -> tuple[Mapping[str, Any], Mapping[str, Any] | None] | None:
    """The row this folded address holds and its record in `berechtigungen_angekuendigt`, joined in one read.

    Every admin-tier request makes it, and a second read by the row's id would cost each a round trip.
    """

    found = await aggregate_many_from_db(
        collection=grants_collection,
        pipeline=[
            {"$match": {"adresse": adresse}},
            {"$limit": 1},
            {"$project": {field: 1 for field in [*fields, "adresse", "granted_at", "gefunden_am", "gesehen_am"]}},
            {
                "$lookup": {
                    "from": Collection.GRANTS_ANNOUNCED,
                    "localField": "_id",
                    "foreignField": "_id",
                    "pipeline": [{"$project": {"adresse": 1, "admin_tier": 1}}],
                    "as": "angekuendigt",
                }
            },
        ],
        session=session,
    )
    if not found:
        return None

    return found[0], next(iter(found[0]["angekuendigt"]), None)


async def verwaltung_of(
    *, grants_collection: ReadCollection, adresse: str, session: AsyncClientSession
) -> tuple[FLAdminTier, datetime, datetime | None] | None:
    """The tier this address holds, and when the grant and the tier took effect, or `None`.

    Each caller folds an address the address rule admitted, and a row equal to
    that is live.
    """

    grant = await _grant_and_its_record_in(
        grants_collection=grants_collection, adresse=adresse, fields=["admin_tier", "appointed_at"], session=session
    )
    if grant is None:
        return None

    row, angekuendigt = grant
    seit = granted_since(row, angekuendigt)
    if seit is None:
        return None

    # The tier in effect rather than the row's: a promotion made in the database and not yet found is
    # no session's, so it is answered as the administrator it still is.
    owner = owner_since(row, angekuendigt)

    return ("administration" if owner is None else "owner"), seit, owner


async def live_unbarred_grant_since(
    identifier: str,
    *,
    grants_collection: ReadCollection,
    sperrliste: BanList,
    session: AsyncClientSession,
) -> datetime | None:
    """The actor check's question: when the live grant this identifier holds took effect, read by one equality beside the ban list's.

    `None` for a barred holder, who is no administrator.
    """

    # Both at once rather than the ban after a grant is found: an admin-tier caller passed the
    # frontend's own grant read moments before, so the ban read that order would spare is almost never spared. The ban
    # read takes no session, so the gathered pair never runs two operations on one.
    grant, barred = await asyncio.gather(
        _grant_and_its_record_in(grants_collection=grants_collection, adresse=identifier, fields=[], session=session),
        adressen_gesperrt(sperrliste, [identifier]),
    )
    if grant is None or barred:
        return None

    return granted_since(*grant)


# A grant's notice still to be handed out: the one shape a ban or an erasure rewrites, a sent one being past saying.
OFFENE_MITTEILUNG: Final[Mapping[str, Any]] = {"state": "open", "art": "grant"}


async def owe_in_session(
    mitteilungen: Sequence[Mitteilung],
    *,
    outbox_collection: AsyncCollection,
    grants_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
    # A request's approvers, in place of every holder.
    an: Sequence[str] | None = None,
    # The request a decision settles its notice by.
    reference: FLOutboxReference | None = None,
) -> None:
    """Owe each notice, in the caller's transaction, to every live holder and to each address it names, one row apiece.

    The holders are read after the caller's write, on its session, so a new grant's holder is among them and a removed one
    is told through the notice's `before`. A barred recipient is stopped at the hand-out, not here
    (`app/api/outbox/system_router.py :: post_handout`).
    """

    if not mitteilungen:
        return
    holders: set[str] = set()
    if an is None:
        grants = await read_berechtigungen(grants_collection=grants_collection, session=session)
        holders = {str(row["adresse"]) for row in grants}

    mails: list[OwedMail] = []
    for mitteilung in mitteilungen:
        data = FLGrantData.model_validate(mitteilung.data)
        genannt = {stand.adresse for stand in (data.now, data.before) if stand is not None and stand.adresse is not None}
        mails.extend(
            OwedMail(
                # The write's own instant and the notice's origin keep two notices about one grant apart: a revoke owes
                # a database edit's notice beside its own (`revoke_in_session`).
                key=f"grant/{mitteilung.grant_id}/{data.change}/{data.author}/{now.isoformat()}/{adresse}",
                an=adresse,
                data=data,
                reference=reference,
            )
            for adresse in sorted(set(an) if an is not None else holders | genannt)
        )
    await enqueue_mails(outbox_collection=outbox_collection, session=session, mails=mails, now=now)


async def withhold_in_the_postausgang(*, outbox_collection: AsyncCollection, adresse: str, session: AsyncClientSession) -> None:
    """Every grant notice still owed naming this folded address, as a grant's address or as its actor, withheld in place."""

    for site in ("now", "before"):
        await patch_many_in_db(
            collection=outbox_collection,
            db_filter={**OFFENE_MITTEILUNG, f"data.{site}.adresse": adresse},
            update={"$set": {f"data.{site}.adresse": None, "data.withheld": "barred"}},
            session=session,
        )
    await patch_many_in_db(
        collection=outbox_collection,
        db_filter={**OFFENE_MITTEILUNG, "data.changed_by": adresse},
        # No reason: it is the grant address's, and a null actor on an application's change says it alone.
        update={"$set": {"data.changed_by": None}},
        session=session,
    )


async def read_the_announced(
    *, grants_announced_collection: ReadCollection, session: AsyncClientSession | None = None
) -> list[Mapping[str, Any]]:
    """Every announced row: the whole record is the other half of every comparison."""

    return await aggregate_many_from_db(collection=grants_announced_collection, pipeline=[{"$sort": {"_id": ASCENDING}}], session=session)


async def grant_in_session(
    *,
    adresse: str,
    admin_tier: str,
    granted_by: str,
    barred: Set[str],
    grants_collection: AsyncCollection,
    grants_announced_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
    # A move's alone: the replaced row's since-whens (`app/api/berechtigungen/services.py :: compose_fortgefuehrt`).
    fortgefuehrt: Mapping[str, Any] | None = None,
) -> ObjectId:
    """Write a grant and its announced row and owe its notice, answering its id.

    The announced row moves with the grant, so the comparison never announces this write twice.
    """

    document: dict[str, Any] = {
        "adresse": adresse,
        "admin_tier": admin_tier,
        # The bound actor rather than a payload field, so the grant and its `aktionen` row name one person.
        "granted_by": granted_by,
        "granted_at": now,
        # Seen as it is written, so a copy of it put back after a revoke reads as an edit rather
        # than a fresh paste.
        "gesehen_am": now,
        **({} if fortgefuehrt is None else {"fortgefuehrt": fortgefuehrt}),
    }
    created = await post_one_to_db(collection=grants_collection, document=document, session=session)

    stand = stand_of(document)
    await post_one_to_db(
        collection=grants_announced_collection,
        document=compose_announced(grant_id=created.inserted_id, stand=stand, now=now),
        session=session,
    )
    await owe_in_session(
        [
            compose_mitteilung(
                grant_id=created.inserted_id,
                art="granted",
                current=stand,
                before=None,
                changed_by=granted_by,
                now=now,
                barred=barred,
            )
        ],
        outbox_collection=outbox_collection,
        grants_collection=grants_collection,
        now=now,
        session=session,
    )

    return created.inserted_id


async def revoke_in_session(
    *,
    grant: Mapping[str, Any],
    # The grant's own announced row, or none.
    announced: Sequence[Mapping[str, Any]],
    revoked_by: str,
    barred: Set[str],
    grants_collection: AsyncCollection,
    grants_announced_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Remove one grant and its announced row, owing the notice of its end.

    A database edit nobody was told of goes out first, or the revoke's notice would be its only trace.
    """

    mitteilungen = [
        compose_mitteilung(grant_id=changed_id, art=art, current=current, before=before, changed_by=None, now=now, barred=barred)
        for changed_id, art, current, before in compare(grants=[grant], announced=announced)
    ]
    mitteilungen.append(
        compose_mitteilung(
            grant_id=grant["_id"],
            art="revoked",
            current=None,
            before=stand_of(grant),
            changed_by=revoked_by,
            now=now,
            barred=barred,
        )
    )

    await delete_many_from_db(collection=grants_collection, db_filter={"_id": grant["_id"]}, session=session)
    # The grant keeps its image, the administrator's act; its announced row is bookkeeping and keeps
    # none.
    await erase_many_from_db(collection=grants_announced_collection, db_filter={"_id": grant["_id"]}, session=session)
    # After the removal, so the holders told are the ones who remain, and the revoked one through the notice's `before`.
    await owe_in_session(
        mitteilungen,
        outbox_collection=outbox_collection,
        grants_collection=grants_collection,
        now=now,
        session=session,
    )
