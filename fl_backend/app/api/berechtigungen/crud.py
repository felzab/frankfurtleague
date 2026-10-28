"""
API · every read and write of the grants that reaches a collection

The anchor lives here beside the read it protects, so no caller can judge the list without writing
every row of it.
"""

from collections.abc import Mapping, Sequence, Set
from datetime import datetime
from typing import Any

from bson import ObjectId
from pymongo import ASCENDING
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.berechtigungen.schemas import FLVerwaltung
from app.api.berechtigungen.services import (
    berechtigt_seit,
    compare,
    compose_announced,
    compose_postausgang,
    inhaber_seit,
    lebendige_adresse,
    stand_of,
)
from app.api.sperrliste.lookup import BanList, adressen_gesperrt
from app.core.collections import Collection
from app.core.concurrency import gather_cancelling
from app.core.crud import (
    aggregate_many_from_db,
    anchor_in_db,
    delete_many_from_db,
    erase_many_from_db,
    patch_many_in_db,
    post_one_to_db,
    pull_many_from_db,
)
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT


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
            {"$project": {field: 1 for field in [*fields, "adresse", "erteilt_am", "gefunden_am", "gesehen_am"]}},
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

    No dead-row check: each caller folds an address the address rule admitted, and a row equal to
    that is live.
    """

    grant = await _grant_and_its_record(
        berechtigungen_collection=berechtigungen_collection, adresse=adresse, fields=["verwaltung", "ernannt_am"]
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
    grant, barred = await gather_cancelling(
        _grant_and_its_record(berechtigungen_collection=berechtigungen_collection, adresse=identifier, fields=[]),
        adressen_gesperrt(sperrliste, [identifier]),
    )
    if grant is None or lebendige_adresse(grant[0]) is None or barred:
        return None

    return berechtigt_seit(*grant)


async def live_unbarred_grant_in(
    identifier: str,
    *,
    berechtigungen_collection: AsyncCollection,
    sperrliste: BanList,
    session: AsyncClientSession,
) -> tuple[ObjectId, datetime] | None:
    """`live_unbarred_grant_since`'s question asked in a transaction's session, with the row that answered it for the anchor.

    `None` where that question answers `None`, a row admitting nobody included.
    """

    # One after the other: a session carries one operation at a time.
    grant = await _grant_and_its_record_in(berechtigungen_collection=berechtigungen_collection, adresse=identifier, fields=[], session=session)
    barred = await adressen_gesperrt(sperrliste, [identifier], session=session)
    if grant is None or lebendige_adresse(grant[0]) is None or barred:
        return None

    seit = berechtigt_seit(*grant)

    return None if seit is None else (grant[0]["_id"], seit)


async def anchor_the_actors_grant(
    *,
    berechtigungen_collection: AsyncCollection,
    berechtigung_id: ObjectId,
    # REQUIRED, as every anchor's session is: committed on its own it closes nothing.
    session: AsyncClientSession,
) -> None:
    """Write the acting administrator's own grant row, so a revoke committing after the judgement's read conflicts with this transaction."""

    await anchor_in_db(
        collection=berechtigungen_collection,
        db_filter={"_id": berechtigung_id},
        session=session,
    )


async def withhold_in_the_outbox(*, berechtigungen_postausgang_collection: AsyncCollection, adresse: str, session: AsyncClientSession) -> None:
    """Every queued row naming this folded address, as a grant's address or as its actor, withheld in place.

    Read, then written by id: a write filtered on the address copies it into the log's filter text.
    """

    # A page at a time until none is left: a row once withheld fails the filter, so each read meets the rest.
    while rows := await pull_many_from_db(
        collection=berechtigungen_postausgang_collection,
        db_filter={"$or": [{"jetzt.adresse": adresse}, {"vorher.adresse": adresse}, {"geaendert_von": adresse}]},
        limit=LIST_LIMIT_DEFAULT,
        projection=["jetzt", "vorher", "geaendert_von"],
        session=session,
    ):
        for field in ("jetzt", "vorher"):
            ids = [row["_id"] for row in rows if (row.get(field) or {}).get("adresse") == adresse]
            if ids:
                await patch_many_in_db(
                    collection=berechtigungen_postausgang_collection,
                    db_filter={"_id": {"$in": ids}},
                    update={"$set": {f"{field}.adresse": None, "vorenthalten": "gesperrt"}},
                    session=session,
                )

        ids = [row["_id"] for row in rows if row.get("geaendert_von") == adresse]
        if ids:
            await patch_many_in_db(
                collection=berechtigungen_postausgang_collection,
                db_filter={"_id": {"$in": ids}},
                # No reason: it is the grant address's, and a null actor on an application's change says it alone.
                update={"$set": {"geaendert_von": None}},
                session=session,
            )


async def read_the_announced(
    *, berechtigungen_angekuendigt_collection: AsyncCollection, session: AsyncClientSession | None = None
) -> list[Mapping[str, Any]]:
    """Every announced row: the whole record is the other half of every comparison."""

    return await aggregate_many_from_db(
        collection=berechtigungen_angekuendigt_collection, pipeline=[{"$sort": {"_id": ASCENDING}}], session=session
    )


async def read_the_claimable(
    *, berechtigungen_postausgang_collection: AsyncCollection, now: datetime, session: AsyncClientSession
) -> list[Mapping[str, Any]]:
    """The outbox rows no claim holds, oldest first, a page at a time.

    The lease is compared by the database, which holds the stamp as UTC and compares it as one.
    """

    return await pull_many_from_db(
        collection=berechtigungen_postausgang_collection,
        db_filter={"$or": [{"beansprucht_bis": None}, {"beansprucht_bis": {"$lte": now}}]},
        sort_by=[("erfasst_am", ASCENDING), ("_id", ASCENDING)],
        limit=LIST_LIMIT_DEFAULT,
        session=session,
    )


async def grant_in_session(
    *,
    adresse: str,
    verwaltung: str,
    erteilt_von: str,
    gesperrt: Set[str],
    berechtigungen_collection: AsyncCollection,
    berechtigungen_angekuendigt_collection: AsyncCollection,
    berechtigungen_postausgang_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
    # A move's alone: the replaced row's since-whens (`app/api/berechtigungen/services.py :: compose_fortgefuehrt`).
    fortgefuehrt: Mapping[str, Any] | None = None,
) -> ObjectId:
    """Write a grant, its announced row and its outbox row, answering its id.

    The announced row moves with the grant and the outbox carries its notice, so the comparison never announces this write
    twice.
    """

    document: dict[str, Any] = {
        "adresse": adresse,
        "verwaltung": verwaltung,
        # The bound actor rather than a payload field, so the grant and its `aktionen` row name one person.
        "erteilt_von": erteilt_von,
        "erteilt_am": now,
        # Seen as it is written, so a copy of it put back after a revoke reads as an edit rather
        # than a fresh paste.
        "gesehen_am": now,
        **({} if fortgefuehrt is None else {"fortgefuehrt": fortgefuehrt}),
    }
    created = await post_one_to_db(collection=berechtigungen_collection, document=document, session=session)

    stand = stand_of(document)
    await post_one_to_db(
        collection=berechtigungen_angekuendigt_collection,
        document=compose_announced(berechtigung_id=created.inserted_id, stand=stand, now=now),
        session=session,
    )
    await post_one_to_db(
        collection=berechtigungen_postausgang_collection,
        document=compose_postausgang(
            berechtigung_id=created.inserted_id, art="erteilt", jetzt=stand, vorher=None, geaendert_von=erteilt_von, now=now, gesperrt=gesperrt
        ),
        session=session,
    )

    return created.inserted_id


async def revoke_in_session(
    *,
    grant: Mapping[str, Any],
    # The grant's own announced row, or none.
    announced: Sequence[Mapping[str, Any]],
    entzogen_von: str,
    gesperrt: Set[str],
    berechtigungen_collection: AsyncCollection,
    berechtigungen_angekuendigt_collection: AsyncCollection,
    berechtigungen_postausgang_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Remove one grant and its announced row, queueing the notice of its end.

    A database edit nobody was told of goes out first, or the revoke's notice would be its only trace.
    """

    for changed_id, art, jetzt, vorher in compare(grants=[grant], announced=announced):
        await post_one_to_db(
            collection=berechtigungen_postausgang_collection,
            document=compose_postausgang(
                berechtigung_id=changed_id, art=art, jetzt=jetzt, vorher=vorher, geaendert_von=None, now=now, gesperrt=gesperrt
            ),
            session=session,
        )

    if lebendige_adresse(grant) is not None:
        await post_one_to_db(
            collection=berechtigungen_postausgang_collection,
            document=compose_postausgang(
                berechtigung_id=grant["_id"],
                art="entzogen",
                jetzt=None,
                vorher=stand_of(grant),
                geaendert_von=entzogen_von,
                now=now,
                gesperrt=gesperrt,
            ),
            session=session,
        )

    await delete_many_from_db(collection=berechtigungen_collection, db_filter={"_id": grant["_id"]}, session=session)
    # The grant keeps its image, the administrator's act; its announced row is bookkeeping and keeps
    # none.
    await erase_many_from_db(collection=berechtigungen_angekuendigt_collection, db_filter={"_id": grant["_id"]}, session=session)
