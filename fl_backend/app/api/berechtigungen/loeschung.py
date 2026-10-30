"""
API · the erasure's grants step: a person's grants, and their address on every record they made

Every match is the sign-in fold's, the pattern only narrowing the read: a Playground paste keeps the
case it was typed in, and is the one writer of a grant no fold reaches, so this step alone keeps a
case-blind read where every other record is read by equality.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.berechtigungen.crud import OFFENE_MITTEILUNG, owe_in_session
from app.api.berechtigungen.schemas import FLBerechtigungAenderungArt, FLBerechtigungStand
from app.api.berechtigungen.services import Mitteilung, compare, compose_mitteilung, stand_of
from app.api.kontakte.services import same_address
from app.api.sperrliste.lookup import BanList, adressen_gesperrt
from app.core.crud import aggregate_many_from_db, loeschen_many_from_db, patch_many_in_db
from app.core.recording import GELOESCHT_ACTOR_MARKER
from app.shared.folding import sign_in_identifier

# The sites of a grant notice naming an address: the grant's own, before and after, and its actor's.
_GRANT_SITES = ("jetzt", "vorher")
_QUEUED_SITES = (*(f"daten.{site}.adresse" for site in _GRANT_SITES), "daten.geaendert_von")


@dataclass(frozen=True)
class GeloeschtGrantsAndAuthorship:
    removed_berechtigungen: int
    removed_angekuendigt: int
    # The notices this erasure owes, its own grant's ending among them, before each is owed to every administrator.
    queued_postausgang: int
    # The notices owed before it and not yet sent that named the person.
    withheld_postausgang: int
    # The records whose author now reads `GELOESCHT_ACTOR_MARKER`, the five fields together.
    marked: int


def _names(value: Any, identifier: str) -> bool:
    # The fold decides: the pattern reads every mailbox sharing the local part, its `i` beyond ASCII (ſ for s).
    return isinstance(value, str) and sign_in_identifier(value) == identifier


def _held_at(row: Mapping[str, Any], path: str) -> Any:
    value: Any = row
    for key in path.split("."):
        value = value.get(key) if isinstance(value, Mapping) else None

    return value


async def _rows_naming(
    collection: AsyncCollection,
    paths: Sequence[str],
    identifier: str,
    session: AsyncClientSession,
    *,
    whole: bool = False,
    also: Mapping[str, Any] | None = None,
) -> list[Mapping[str, Any]]:
    """Every row holding this person's address at one of `paths`, unbounded: a capped read leaves the rest naming them."""

    pattern = same_address(identifier)
    pipeline: list[Mapping[str, Any]] = [{"$match": {**(also or {}), "$or": [{path: pattern} for path in paths]}}]
    if not whole:
        pipeline.append({"$project": dict.fromkeys(paths, 1)})

    rows = await aggregate_many_from_db(collection=collection, pipeline=pipeline, session=session)

    return [row for row in rows if any(_names(_held_at(row, path), identifier) for path in paths)]


def _withholding(daten: Mapping[str, Any], identifier: str) -> dict[str, Any]:
    """What takes this person out of one notice's facts: the grant's address withheld, its actor given the marker.

    The stored reason is the grant address's alone; an actor's reads off `geaendert_von`, null for a ban.
    """

    update: dict[str, Any] = {}
    for site in _GRANT_SITES:
        if _names(_held_at(daten, f"{site}.adresse"), identifier):
            update[f"{site}.adresse"] = None
            update["vorenthalten"] = "geloescht"
    if _names(daten.get("geaendert_von"), identifier):
        update["geaendert_von"] = GELOESCHT_ACTOR_MARKER

    return update


def _withheld(mitteilung: Mitteilung, identifier: str) -> Mitteilung:
    """A composed notice as `_withholding` leaves it, so no row owed carries the address."""

    daten = dict(mitteilung.daten)
    for path, value in _withholding(mitteilung.daten, identifier).items():
        head, _, tail = path.partition(".")
        daten[head] = {**daten[head], tail: value} if tail else value

    return Mitteilung(berechtigung_id=mitteilung.berechtigung_id, daten=daten)


async def _withhold_queued(postausgang_collection: AsyncCollection, identifier: str, session: AsyncClientSession) -> int:
    """Every grant notice still owed naming this person, written by id and grouped by what each loses."""

    rows = await _rows_naming(postausgang_collection, _QUEUED_SITES, identifier, session, also=OFFENE_MITTEILUNG)

    by_update: dict[tuple[tuple[str, Any], ...], list[ObjectId]] = {}
    for row in rows:
        update = tuple(sorted((f"daten.{path}", value) for path, value in _withholding(row["daten"], identifier).items()))
        by_update.setdefault(update, []).append(row["_id"])

    for update, ids in by_update.items():
        await patch_many_in_db(
            collection=postausgang_collection, db_filter={"_id": {"$in": ids}}, update={"$set": dict(update)}, session=session
        )

    return len(rows)


async def carry_authorship_in_session(
    *,
    berechtigungen_collection: AsyncCollection,
    berechtigungen_antraege_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    einladungen_collection: AsyncCollection,
    sperrliste_collection: AsyncCollection,
    # Both folded (`app/shared/folding.py :: sign_in_identifier`).
    alt: str,
    neue: str,
    session: AsyncClientSession,
) -> int:
    """Re-key every record the person made to the new address, whatever they hold now.

    Each collection named by its own parameter, as the erasure names them, so the traces resolve every write.
    """

    carried = await _set_authored(berechtigungen_collection, "erteilt_von", alt, neue, session)
    carried += await _set_authored(bewerbungen_collection, "entscheidung.von", alt, neue, session)
    carried += await _set_authored(registrierungen_collection, "entscheidung.von", alt, neue, session)
    carried += await _set_authored(sperrliste_collection, "erstellt_von", alt, neue, session)
    carried += await _set_authored(einladungen_collection, "erstellt_von", alt, neue, session)
    # A moved requester's request stays theirs, approvable as before: carried so it holds no
    # address an erasure at the new one misses.
    carried += await _set_authored(berechtigungen_antraege_collection, "genehmigung.gestartet_von", alt, neue, session)

    return carried


async def _set_authored(collection: AsyncCollection, field: str, identifier: str, value: str, session: AsyncClientSession) -> int:
    """Put `value` in `field` of every record this person made, by id, so the log keeps the ids and no address."""

    ids = [row["_id"] for row in await _rows_naming(collection, (field,), identifier, session)]
    if not ids:
        return 0

    marked = await patch_many_in_db(collection=collection, db_filter={"_id": {"$in": ids}}, update={"$set": {field: value}}, session=session)

    return marked.modified_count


async def loeschen_grants_and_authorship_in_session(
    *,
    berechtigungen_collection: AsyncCollection,
    berechtigungen_angekuendigt_collection: AsyncCollection,
    postausgang_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    einladungen_collection: AsyncCollection,
    # By name, as every collection a write reaches: the duplicate-key trace resolves a collection by
    # its parameter's spelling, never through the ban list's attribute.
    sperrliste_collection: AsyncCollection,
    # Answers which other address in a queued notice is barred.
    sperrliste: BanList,
    # Folded (`app/shared/folding.py :: sign_in_identifier`).
    identifier: str,
    # Who the erasure is attributed to: an administrator's address, or `identifier` itself on the
    # person's own request, which the notice then names by the marker.
    geaendert_von: str,
    now: datetime,
    # REQUIRED: the grants, the notices and the authored records go in one transaction or none.
    session: AsyncClientSession,
) -> GeloeschtGrantsAndAuthorship:
    """Removes an `owner` grant and breaks the floor of two, refusing neither.

    Who may erase an owner is the caller's judgement, and so is any line once the transaction commits.
    """

    # Both read before the removals below, after which neither a grant nor its record matches.
    grants = await _rows_naming(berechtigungen_collection, ("adresse",), identifier, session, whole=True)
    grant_ids = [grant["_id"] for grant in grants]
    # Keyed on one of those grants whatever address it holds, or holding this address under another
    # grant's id: either is what the administrators were told of this person's access.
    records = [
        record
        for record in await aggregate_many_from_db(
            collection=berechtigungen_angekuendigt_collection,
            pipeline=[{"$match": {"$or": [{"_id": {"$in": grant_ids}}, {"adresse": same_address(identifier)}]}}],
            session=session,
        )
        if record["_id"] in grant_ids or _names(record.get("adresse"), identifier)
    ]
    records_by_id = {record["_id"]: record for record in records}

    changes: list[tuple[ObjectId, FLBerechtigungAenderungArt, FLBerechtigungStand | None, FLBerechtigungStand | None, str | None]] = []
    for grant in grants:
        record = records_by_id.get(grant["_id"])
        # A database edit to the row nobody was told of goes out first, as a revoke's does;
        # `geaendert_von` null names the database as its source.
        changes += [(*change, None) for change in compare(grants=[grant], announced=[] if record is None else [record])]
        changes.append((grant["_id"], "entzogen", None, stand_of(grant), geaendert_von))
    for record in records:
        if record["_id"] not in grant_ids:
            # The row it was kept for now names somebody else, or nothing: the pass announces that one.
            changes += [(*change, None) for change in compare(grants=[], announced=[record])]

    others = {
        stand.adresse
        for _, _, jetzt, vorher, _ in changes
        for stand in (jetzt, vorher)
        if stand is not None and stand.adresse is not None and not _names(stand.adresse, identifier)
    } | ({sign_in_identifier(geaendert_von)} - {identifier})
    barred = await adressen_gesperrt(sperrliste, others, session=session) if others else set()

    mitteilungen = [
        _withheld(
            compose_mitteilung(berechtigung_id=grant_id, art=art, jetzt=jetzt, vorher=vorher, geaendert_von=von, now=now, gesperrt=barred),
            identifier,
        )
        for grant_id, art, jetzt, vorher, von in changes
    ]

    # Owed before this erasure's own: they are not yet withheld, and this erasure's carry no address of the person.
    withheld = await _withhold_queued(postausgang_collection, identifier, session)

    # No image of either: a grant's image is the address itself, and the announced record is bookkeeping.
    if grant_ids:
        await loeschen_many_from_db(collection=berechtigungen_collection, db_filter={"_id": {"$in": grant_ids}}, session=session)
    if records:
        await loeschen_many_from_db(
            collection=berechtigungen_angekuendigt_collection, db_filter={"_id": {"$in": list(records_by_id)}}, session=session
        )

    # After the removals, so the person is no holder told: every administrator who remains is.
    await owe_in_session(
        mitteilungen,
        postausgang_collection=postausgang_collection,
        berechtigungen_collection=berechtigungen_collection,
        now=now,
        session=session,
    )

    # Fields an address change's effect carries too (`fl_backend/app/api/berechtigungen/loeschung.py :: carry_authorship_in_session`).
    marked = await _set_authored(berechtigungen_collection, "erteilt_von", identifier, GELOESCHT_ACTOR_MARKER, session)
    marked += await _set_authored(bewerbungen_collection, "entscheidung.von", identifier, GELOESCHT_ACTOR_MARKER, session)
    marked += await _set_authored(registrierungen_collection, "entscheidung.von", identifier, GELOESCHT_ACTOR_MARKER, session)
    marked += await _set_authored(sperrliste_collection, "erstellt_von", identifier, GELOESCHT_ACTOR_MARKER, session)
    marked += await _set_authored(einladungen_collection, "erstellt_von", identifier, GELOESCHT_ACTOR_MARKER, session)

    return GeloeschtGrantsAndAuthorship(
        removed_berechtigungen=len(grant_ids),
        removed_angekuendigt=len(records),
        queued_postausgang=len(mitteilungen),
        withheld_postausgang=withheld,
        marked=marked,
    )
