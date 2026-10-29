"""
API · the grants' requests: a grant or a promotion to owner waiting on a second administrator's approval

Every read filters on `bis`, so a lapsed request is gone the moment it lapses, whatever the TTL monitor has not yet
removed or a restore has put back.
"""

from collections.abc import Mapping, Sequence, Set
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from typing import Any, Final, Literal, get_args

from bson import ObjectId
from pydantic import SecretStr
from pymongo import ASCENDING
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.berechtigungen.schemas import FLBerechtigungAntragEndeArt, FLBerechtigungStand, FLGenehmigungVerwehrt, as_utc
from app.api.berechtigungen.services import compose_postausgang, haelt_seit
from app.api.sperrliste.lookup import BanList, adressen_gesperrt
from app.core.codes import Code
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, delete_many_from_db, erase_many_from_db, post_many_to_db, refuse
from app.core.exceptions import DocumentNotFoundError, WriteRefusal
from app.core.journal import JournalLine
from app.core.security import loeschung_journal_hash
from app.shared.schemas.bounds import GENEHMIGUNG_TAGE

# The outbox kinds telling a requester how their request ended, each mailed to them alone.
ANTRAG_ENDEN: Final = frozenset(get_args(FLBerechtigungAntragEndeArt))


def compose_antrag(*, adresse: str, verwaltung: str, berechtigung_id: ObjectId | None, gestartet_von: str, now: datetime) -> dict[str, Any]:
    """The whole request a grant or a promotion inserts, its `genehmigung` the block an address change's approval keeps."""

    return {
        "adresse": adresse,
        "berechtigung_id": berechtigung_id,
        "genehmigung": {
            "verwaltung": verwaltung,
            # Its approver held their grant since then (`app/api/berechtigungen/services.py :: haelt_seit`).
            "angefragt_am": now.astimezone(UTC),
            # The address change's week: an approver away for a weekend is no reason to ask again.
            "bis": now.astimezone(UTC) + timedelta(days=GENEHMIGUNG_TAGE),
            "gestartet_von": gestartet_von,
        },
    }


def build_offen_filter(now: datetime) -> dict[str, Any]:
    """The requests not yet lapsed, the term every read carries: a row's presence says nothing."""

    return {"genehmigung.bis": {"$gt": now.astimezone(UTC)}}


def ist_offen(antrag: Mapping[str, Any], *, now: datetime) -> bool:
    return as_utc(antrag["genehmigung"]["bis"]) > now.astimezone(UTC)


def antrag_steht(
    antrag: Mapping[str, Any], *, grants: Sequence[Mapping[str, Any]], announced: Sequence[Mapping[str, Any]], gesperrt: Set[str]
) -> bool:
    """Whether the request's requester still holds, since before it and unbarred, the tier it asks for.

    A revoke, a demotion or a ban stops a person acting, so it stops what they asked for too.
    """

    genehmigung = antrag["genehmigung"]
    von = str(genehmigung["gestartet_von"])

    return von not in gesperrt and haelt_seit(
        von, verwaltung=str(genehmigung["verwaltung"]), vor=genehmigung["angefragt_am"], grants=grants, announced=announced
    )


async def read_the_antraege(
    *, berechtigungen_antraege_collection: AsyncCollection, now: datetime, session: AsyncClientSession | None = None
) -> list[Mapping[str, Any]]:
    """Every request not yet lapsed, oldest first, unbounded: one per address, as few as the grants that make them."""

    return await aggregate_many_from_db(
        collection=berechtigungen_antraege_collection,
        pipeline=[{"$match": build_offen_filter(now)}, {"$sort": {"genehmigung.angefragt_am": ASCENDING, "_id": ASCENDING}}],
        session=session,
    )


async def read_the_antraege_of(
    *, berechtigungen_antraege_collection: AsyncCollection, identifier: str, now: datetime, session: AsyncClientSession | None
) -> list[Mapping[str, Any]]:
    """Every request not yet lapsed about this folded address or made by it, oldest first: what an erasure of it removes."""

    return await aggregate_many_from_db(
        collection=berechtigungen_antraege_collection,
        pipeline=[
            {"$match": {"$or": [{"adresse": identifier}, {"genehmigung.gestartet_von": identifier}], **build_offen_filter(now)}},
            {"$project": {"adresse": 1, "genehmigung.verwaltung": 1, "genehmigung.angefragt_am": 1}},
            {"$sort": {"genehmigung.angefragt_am": ASCENDING, "_id": ASCENDING}},
        ],
        session=session,
    )


async def pull_the_antrag(
    *, berechtigungen_antraege_collection: AsyncCollection, antrag_id: ObjectId, now: datetime, session: AsyncClientSession
) -> Mapping[str, Any]:
    """The request this id names, or 404 where none stands: decided, withdrawn, erased or lapsed alike."""

    found = await aggregate_many_from_db(
        collection=berechtigungen_antraege_collection, pipeline=[{"$match": {"_id": antrag_id, **build_offen_filter(now)}}], session=session
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
        pipeline=[{"$match": {"adresse": adresse}}, {"$project": {"genehmigung.bis": 1}}],
        session=session,
    )
    refuse(find_antrag_offen_refusal(offen=any(ist_offen(row, now=now) for row in rows)))
    if rows:
        await delete_many_from_db(
            collection=berechtigungen_antraege_collection, db_filter={"_id": {"$in": [row["_id"] for row in rows]}}, session=session
        )


async def remove_the_antrag_in_session(
    *,
    berechtigungen_antraege_collection: AsyncCollection,
    berechtigungen_postausgang_collection: AsyncCollection,
    antrag_id: ObjectId,
    session: AsyncClientSession,
) -> None:
    """Remove a decided request, its image kept: who asked, for what and when stays on the log beside the grant it made."""

    await delete_many_from_db(collection=berechtigungen_antraege_collection, db_filter={"_id": antrag_id}, session=session)
    # Its queued notice goes too, imageless as the outbox's bookkeeping is, and by the id
    # alone, as an erasure's filter is: only that notice holds the request's id. Claimed already, it is still sent.
    await erase_many_from_db(collection=berechtigungen_postausgang_collection, db_filter={"berechtigung_id": antrag_id}, session=session)


async def queue_the_ending_in_session(
    antraege: Sequence[Mapping[str, Any]],
    *,
    art: FLBerechtigungAntragEndeArt,
    sperrliste: BanList,
    berechtigungen_postausgang_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Tell each requester how their request ended, after the removal that takes its own notices.

    The requester stands in `geaendert_von`, where an erasure, a ban and an address change reach any actor; none names the
    decider.
    """

    if not antraege:
        return
    beteiligt = {str(antrag["adresse"]) for antrag in antraege} | {str(antrag["genehmigung"]["gestartet_von"]) for antrag in antraege}
    barred = await adressen_gesperrt(sperrliste, beteiligt, session=session)
    await post_many_to_db(
        collection=berechtigungen_postausgang_collection,
        documents=[
            compose_postausgang(
                berechtigung_id=antrag["_id"],
                art=art,
                # The address and tier it asked for, as its own notice named them to its approvers.
                jetzt=FLBerechtigungStand.model_validate(
                    {"adresse": str(antrag["adresse"]), "verwaltung": antrag["genehmigung"]["verwaltung"]}
                ),
                vorher=None,
                geaendert_von=str(antrag["genehmigung"]["gestartet_von"]),
                now=now,
                gesperrt=barred,
            )
            for antrag in antraege
        ],
        session=session,
    )


async def end_the_antraege_about_in_session(
    *,
    berechtigungen_antraege_collection: AsyncCollection,
    berechtigungen_postausgang_collection: AsyncCollection,
    sperrliste: BanList,
    adresse: str,
    now: datetime,
    session: AsyncClientSession,
) -> list[Mapping[str, Any]]:
    """End every request about this folded address as a refusal ends it, lapsed ones too, answering each for the caller's journal.

    Never carried to the new address, which would grant what its approvers never judged.
    """

    rows = await aggregate_many_from_db(
        collection=berechtigungen_antraege_collection,
        pipeline=[{"$match": {"adresse": adresse}}, {"$project": {"adresse": 1, "genehmigung": 1}}],
        session=session,
    )
    for row in rows:
        await remove_the_antrag_in_session(
            berechtigungen_antraege_collection=berechtigungen_antraege_collection,
            berechtigungen_postausgang_collection=berechtigungen_postausgang_collection,
            antrag_id=row["_id"],
            session=session,
        )
    # One still open tells its requester; a lapsed one ended at its lapse, and nobody hears of it again.
    await queue_the_ending_in_session(
        [row for row in rows if ist_offen(row, now=now)],
        art="antrag_beendet",
        sperrliste=sperrliste,
        berechtigungen_postausgang_collection=berechtigungen_postausgang_collection,
        now=now,
        session=session,
    )

    return rows


async def erase_antraege_in_session(
    *, berechtigungen_antraege_collection: AsyncCollection, identifier: str, session: AsyncClientSession
) -> int:
    """Every request about this folded address or made by it, lapsed or not, removed by id and imageless.

    A request outlives neither person: the requester's grant goes in the same erasure, the subject's address is what it destroys.
    """

    rows = await aggregate_many_from_db(
        collection=berechtigungen_antraege_collection,
        pipeline=[{"$match": {"$or": [{"adresse": identifier}, {"genehmigung.gestartet_von": identifier}]}}, {"$project": {"_id": 1}}],
        session=session,
    )
    if rows:
        await erase_many_from_db(
            collection=berechtigungen_antraege_collection, db_filter={"_id": {"$in": [row["_id"] for row in rows]}}, session=session
        )

    return len(rows)


# How a request ended, as its journal line names it: the replay tells again whom the end told.
AntragEndeLine = Literal["antrag_abgelehnt", "antrag_zurueckgezogen", "antrag_beendet"]


def antrag_line(*, antrag: Mapping[str, Any], art: AntragEndeLine, am: str, schluessel: SecretStr) -> JournalLine:
    """An ended request's line, so a restore from before its end does not bring it back to be approved."""

    return JournalLine(
        person_hash=loeschung_journal_hash(str(antrag["adresse"]), schluessel=schluessel),
        art=art,
        collection=Collection.BERECHTIGUNGEN_ANTRAEGE,
        record_id=antrag["_id"],
        am=am,
    )


def find_antrag_offen_refusal(*, offen: bool) -> WriteRefusal | None:
    """`REQ-BERECHTIGUNG-008`: a request for this address waits already, which its approver or a refusal decides first."""

    if not offen:
        return None

    return WriteRefusal(
        error_code=Code.BERECHTIGUNG_ANTRAG_OFFEN,
        status=HTTPStatus.CONFLICT,
    )


def find_genehmigung_verwehrt_refusal(*, verwehrt: FLGenehmigungVerwehrt | None) -> WriteRefusal | None:
    """`-009` for a request about the actor or made by them, `-010` for an owner's without an owner's power, `-011` for a younger grant."""

    if verwehrt is None:
        return None

    if verwehrt == "juenger":
        return WriteRefusal(
            error_code=Code.BERECHTIGUNG_GENEHMIGUNG_JUENGER,
            status=HTTPStatus.FORBIDDEN,
        )

    if verwehrt == "inhaber":
        return WriteRefusal(
            error_code=Code.BERECHTIGUNG_GENEHMIGUNG_INHABER,
            status=HTTPStatus.FORBIDDEN,
        )

    return WriteRefusal(
        error_code=Code.BERECHTIGUNG_GENEHMIGUNG_VERWEHRT,
        status=HTTPStatus.FORBIDDEN,
    )


def find_antrag_verfallen_refusal(*, steht: bool) -> WriteRefusal | None:
    """`REQ-BERECHTIGUNG-012`: the request's requester does not hold, since before it, the tier it asks for."""

    if steht:
        return None

    return WriteRefusal(
        error_code=Code.BERECHTIGUNG_ANTRAG_VERFALLEN,
        status=HTTPStatus.CONFLICT,
    )
