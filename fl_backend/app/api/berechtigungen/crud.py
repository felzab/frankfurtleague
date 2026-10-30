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
    berechtigt_seit,
    compare,
    compose_announced,
    compose_mitteilung,
    inhaber_seit,
    stand_of,
)
from app.api.postausgang.schemas import FLGrantData, FLPostausgangBezug
from app.api.postausgang.services import OwedMail, enqueue_mails
from app.api.sperrliste.lookup import BanList, adressen_gesperrt
from app.core.collections import Collection
from app.core.crud import (
    aggregate_many_from_db,
    anchor_in_db,
    delete_many_from_db,
    loeschen_many_from_db,
    patch_many_in_db,
    post_one_to_db,
)
from app.shared.schemas.literals import FLVerwaltung


async def read_berechtigungen(
    *, berechtigungen_collection: AsyncCollection, session: AsyncClientSession | None = None
) -> list[Mapping[str, Any]]:
    """Every grant, by address, and unbounded: the floor and the recipients are both judged over the whole list."""

    return await aggregate_many_from_db(collection=berechtigungen_collection, pipeline=[{"$sort": {"adresse": ASCENDING}}], session=session)


async def pull_the_list_to_judge(
    *,
    berechtigungen_collection: AsyncCollection,
    # REQUIRED: the anchor is what closes the race, so forgetting the session has to be a TypeError
    # at the call rather than a silent reopening of it.
    session: AsyncClientSession,
) -> list[Mapping[str, Any]]:
    """Read every grant, then write each one, in the caller's transaction.

    A snapshot re-validates no read: a rival judging the list writes the same rows, so whichever
    lands second meets a write conflict and retries.
    """

    grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)

    # Exactly the rows the read returned, each named: the rows judged are the rows a rival must meet.
    await anchor_in_db(
        collection=berechtigungen_collection,
        db_filter={"_id": {"$in": [grant["_id"] for grant in grants]}},
        session=session,
    )

    return grants


async def _grant_and_its_record_in(
    *, berechtigungen_collection: AsyncCollection, adresse: str, fields: list[str], session: AsyncClientSession
) -> tuple[Mapping[str, Any], Mapping[str, Any] | None] | None:
    """The row this folded address holds and its record in `berechtigungen_angekuendigt`, joined in one read.

    Every admin-tier request makes it, and a second read by the row's id would cost each a round trip.
    """

    found = await aggregate_many_from_db(
        collection=berechtigungen_collection,
        pipeline=[
            {"$match": {"adresse": adresse}},
            {"$limit": 1},
            {"$project": {field: 1 for field in [*fields, "adresse", "granted_at", "gefunden_am", "gesehen_am"]}},
            {
                "$lookup": {
                    "from": Collection.BERECHTIGUNGEN_ANGEKUENDIGT,
                    "localField": "_id",
                    "foreignField": "_id",
                    "pipeline": [{"$project": {"adresse": 1, "verwaltung": 1}}],
                    "as": "angekuendigt",
                }
            },
        ],
        session=session,
    )
    if not found:
        return None

    return found[0], next(iter(found[0]["angekuendigt"]), None)


async def _grant_and_its_record(
    *, berechtigungen_collection: AsyncCollection, adresse: str, fields: list[str]
) -> tuple[Mapping[str, Any], Mapping[str, Any] | None] | None:
    # A snapshot, or a commit landing between the row's read and the join pairs the row before it
    # with the record after.
    async with berechtigungen_collection.database.client.start_session(snapshot=True) as session:
        return await _grant_and_its_record_in(
            berechtigungen_collection=berechtigungen_collection, adresse=adresse, fields=fields, session=session
        )


async def verwaltung_of(*, berechtigungen_collection: AsyncCollection, adresse: str) -> tuple[FLVerwaltung, datetime, datetime | None] | None:
    """The tier this address holds, and when the grant and the tier took effect, or `None`.

    Each caller folds an address the address rule admitted, and a row equal to
    that is live.
    """

    grant = await _grant_and_its_record(
        berechtigungen_collection=berechtigungen_collection, adresse=adresse, fields=["verwaltung", "appointed_at"]
    )
    if grant is None:
        return None

    row, angekuendigt = grant
    seit = berechtigt_seit(row, angekuendigt)
    if seit is None:
        return None

    # The tier in effect rather than the row's: a promotion made in the database and not yet found is
    # no session's, so it is answered as the administrator it still is.
    inhaber = inhaber_seit(row, angekuendigt)

    return ("administration" if inhaber is None else "owner"), seit, inhaber


async def live_unbarred_grant_since(
    identifier: str,
    *,
    berechtigungen_collection: AsyncCollection,
    sperrliste: BanList,
) -> datetime | None:
    """The actor check's question: when the live grant this identifier holds took effect, read by one equality beside the ban list's.

    `None` for a barred holder, who is no administrator.
    """

    # Both at once rather than the ban after a grant is found: an admin-tier caller passed the
    # frontend's own grant read moments before, so the ban read that order would spare is almost never spared.
    grant, barred = await asyncio.gather(
        _grant_and_its_record(berechtigungen_collection=berechtigungen_collection, adresse=identifier, fields=[]),
        adressen_gesperrt(sperrliste, [identifier]),
    )
    if grant is None or barred:
        return None

    return berechtigt_seit(*grant)


# A grant's notice still to be handed out: the one shape a ban or an erasure rewrites, a sent one being past saying.
OFFENE_MITTEILUNG: Final[Mapping[str, Any]] = {"stand": "open", "art": "grant"}


async def owe_in_session(
    mitteilungen: Sequence[Mitteilung],
    *,
    postausgang_collection: AsyncCollection,
    berechtigungen_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
    # A request's approvers, in place of every holder.
    an: Sequence[str] | None = None,
    # The request a decision settles its notice by.
    reference: FLPostausgangBezug | None = None,
) -> None:
    """Owe each notice, in the caller's transaction, to every live holder and to each address it names, one row apiece.

    The holders are read after the caller's write, on its session, so a new grant's holder is among them and a removed one
    is told through the notice's `before`. A barred recipient is stopped at the hand-out, not here
    (`app/api/postausgang/system_router.py :: post_ausgabe`).
    """

    if not mitteilungen:
        return
    holders: set[str] = set()
    if an is None:
        grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
        holders = {str(row["adresse"]) for row in grants}

    mails: list[OwedMail] = []
    for mitteilung in mitteilungen:
        daten = FLGrantData.model_validate(mitteilung.data)
        genannt = {stand.adresse for stand in (daten.now, daten.before) if stand is not None and stand.adresse is not None}
        mails.extend(
            OwedMail(
                # The write's own instant and the notice's origin keep two notices about one grant apart: a revoke owes
                # a database edit's notice beside its own (`revoke_in_session`).
                key=f"grant/{mitteilung.grant_id}/{daten.change}/{daten.author}/{now.isoformat()}/{adresse}",
                an=adresse,
                data=daten,
                reference=reference,
            )
            for adresse in sorted(set(an) if an is not None else holders | genannt)
        )
    await enqueue_mails(postausgang_collection=postausgang_collection, session=session, mails=mails, now=now)


async def withhold_in_the_postausgang(*, postausgang_collection: AsyncCollection, adresse: str, session: AsyncClientSession) -> None:
    """Every grant notice still owed naming this folded address, as a grant's address or as its actor, withheld in place."""

    for site in ("now", "before"):
        await patch_many_in_db(
            collection=postausgang_collection,
            db_filter={**OFFENE_MITTEILUNG, f"data.{site}.adresse": adresse},
            update={"$set": {f"data.{site}.adresse": None, "data.withheld": "barred"}},
            session=session,
        )
    await patch_many_in_db(
        collection=postausgang_collection,
        db_filter={**OFFENE_MITTEILUNG, "data.changed_by": adresse},
        # No reason: it is the grant address's, and a null actor on an application's change says it alone.
        update={"$set": {"data.changed_by": None}},
        session=session,
    )


async def read_the_announced(
    *, berechtigungen_angekuendigt_collection: AsyncCollection, session: AsyncClientSession | None = None
) -> list[Mapping[str, Any]]:
    """Every announced row: the whole record is the other half of every comparison."""

    return await aggregate_many_from_db(
        collection=berechtigungen_angekuendigt_collection, pipeline=[{"$sort": {"_id": ASCENDING}}], session=session
    )


async def grant_in_session(
    *,
    adresse: str,
    verwaltung: str,
    granted_by: str,
    barred: Set[str],
    berechtigungen_collection: AsyncCollection,
    berechtigungen_angekuendigt_collection: AsyncCollection,
    postausgang_collection: AsyncCollection,
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
        "verwaltung": verwaltung,
        # The bound actor rather than a payload field, so the grant and its `aktionen` row name one person.
        "granted_by": granted_by,
        "granted_at": now,
        # Seen as it is written, so a copy of it put back after a revoke reads as an edit rather
        # than a fresh paste.
        "gesehen_am": now,
        **({} if fortgefuehrt is None else {"fortgefuehrt": fortgefuehrt}),
    }
    created = await post_one_to_db(collection=berechtigungen_collection, document=document, session=session)

    stand = stand_of(document)
    await post_one_to_db(
        collection=berechtigungen_angekuendigt_collection,
        document=compose_announced(grant_id=created.inserted_id, stand=stand, now=now),
        session=session,
    )
    await owe_in_session(
        [
            compose_mitteilung(
                grant_id=created.inserted_id,
                art="granted",
                jetzt=stand,
                before=None,
                changed_by=granted_by,
                now=now,
                barred=barred,
            )
        ],
        postausgang_collection=postausgang_collection,
        berechtigungen_collection=berechtigungen_collection,
        now=now,
        session=session,
    )

    return created.inserted_id


async def revoke_in_session(
    *,
    grant: Mapping[str, Any],
    # The grant's own announced row, or none.
    announced: Sequence[Mapping[str, Any]],
    entzogen_von: str,
    barred: Set[str],
    berechtigungen_collection: AsyncCollection,
    berechtigungen_angekuendigt_collection: AsyncCollection,
    postausgang_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Remove one grant and its announced row, owing the notice of its end.

    A database edit nobody was told of goes out first, or the revoke's notice would be its only trace.
    """

    mitteilungen = [
        compose_mitteilung(grant_id=changed_id, art=art, jetzt=jetzt, before=vorher, changed_by=None, now=now, barred=barred)
        for changed_id, art, jetzt, vorher in compare(grants=[grant], announced=announced)
    ]
    mitteilungen.append(
        compose_mitteilung(
            grant_id=grant["_id"],
            art="revoked",
            jetzt=None,
            before=stand_of(grant),
            changed_by=entzogen_von,
            now=now,
            barred=barred,
        )
    )

    await delete_many_from_db(collection=berechtigungen_collection, db_filter={"_id": grant["_id"]}, session=session)
    # The grant keeps its image, the administrator's act; its announced row is bookkeeping and keeps
    # none.
    await loeschen_many_from_db(collection=berechtigungen_angekuendigt_collection, db_filter={"_id": grant["_id"]}, session=session)
    # After the removal, so the holders told are the ones who remain, and the revoked one through the notice's `before`.
    await owe_in_session(
        mitteilungen,
        postausgang_collection=postausgang_collection,
        berechtigungen_collection=berechtigungen_collection,
        now=now,
        session=session,
    )
