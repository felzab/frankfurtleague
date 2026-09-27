"""
API · every read and write of the grants that reaches a collection

The anchor lives here beside the read it protects, so no caller can judge the list without writing
every row of it (`docs/backend/spec.md :: I53`).
"""

from collections.abc import Mapping
from datetime import datetime
from typing import Any

from pydantic import SecretStr
from pymongo import ASCENDING
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.berechtigungen.schemas import FLVerwaltung
from app.api.berechtigungen.services import lebendige_adresse
from app.api.saisons.crud import pull_massgebliche_saison_id
from app.api.sperrliste.crud import gesperrte_adressen
from app.core.crud import aggregate_many_from_db, patch_many_in_db, pull_many_from_db
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
    """Read every grant, then write each one, in the caller's transaction (`docs/backend/spec.md :: I438`).

    A snapshot re-validates no read: a rival judging the list writes the same rows, so whichever
    lands second meets a write conflict and retries.
    """

    grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)

    # Exactly the rows the read returned, each named: the rows judged are the rows a rival must meet.
    await patch_many_in_db(
        collection=berechtigungen_collection,
        db_filter={"_id": {"$in": [grant["_id"] for grant in grants]}},
        update={"$inc": {"bounded_writes": 1}},
        session=session,
    )

    return grants


async def verwaltung_of(*, berechtigungen_collection: AsyncCollection, adresse: str) -> FLVerwaltung | None:
    """The tier this folded address holds, or `None`: one equality `uniq_berechtigung_adresse` serves.

    No dead-row check: its one caller folds an address the address rule admitted, and a row equal to
    that is live (`docs/backend/spec.md :: I453`).
    """

    found = await pull_many_from_db(collection=berechtigungen_collection, db_filter={"adresse": adresse}, limit=1, projection=["verwaltung"])

    return found[0]["verwaltung"] if found else None


async def holds_a_live_unbarred_grant(
    identifier: str,
    *,
    berechtigungen_collection: AsyncCollection,
    sperrliste_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    schluessel: SecretStr,
) -> bool:
    """The actor check's question: one equality on the grants, then one on the ban list by the identifier's hash.

    A barred holder is no administrator, the reason a barred grant holds no floor
    (`docs/backend/spec.md :: I463`).
    """

    found = await pull_many_from_db(collection=berechtigungen_collection, db_filter={"adresse": identifier}, limit=1, projection=["adresse"])
    if not found or lebendige_adresse(found[0]) is None:
        return False

    return not await gesperrte_adressen(
        [identifier],
        sperrliste_collection=sperrliste_collection,
        schluessel=schluessel,
        massgebliche_saison_id=await pull_massgebliche_saison_id(saisons_collection),
    )


async def withhold_in_the_outbox(*, berechtigungen_postausgang_collection: AsyncCollection, adresse: str, session: AsyncClientSession) -> None:
    """Every queued row naming this folded address, as a grant's address or as its actor, withheld in place (`docs/backend/spec.md :: I462`).

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
                update={"$set": {"geaendert_von": None, "vorenthalten": "gesperrt"}},
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
    """The outbox rows no claim holds, oldest first, a page at a time (`docs/backend/spec.md :: I454`).

    The lease is compared by the database, which holds the stamp as UTC and compares it as one.
    """

    return await pull_many_from_db(
        collection=berechtigungen_postausgang_collection,
        db_filter={"$or": [{"beansprucht_bis": None}, {"beansprucht_bis": {"$lte": now}}]},
        sort_by=[("erfasst_am", ASCENDING), ("_id", ASCENDING)],
        limit=LIST_LIMIT_DEFAULT,
        session=session,
    )
