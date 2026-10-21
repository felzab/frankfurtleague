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

from app.api.berechtigungen.schemas import FLBerechtigungAenderungArt, FLBerechtigungStand
from app.api.berechtigungen.services import compare, compose_postausgang, lebendige_adresse, stand_of
from app.api.kontakte.services import same_address
from app.api.sperrliste.lookup import BanList, adressen_gesperrt
from app.core.crud import aggregate_many_from_db, erase_many_from_db, patch_many_in_db, post_many_to_db
from app.core.recording import ERASED_ACTOR_MARKER
from app.shared.folding import sign_in_identifier

# The sites of an outbox row naming an address: the grant's own, before and after, and its actor's.
_GRANT_SITES = ("jetzt", "vorher")
_QUEUED_SITES = (*(f"{site}.adresse" for site in _GRANT_SITES), "geaendert_von")


@dataclass(frozen=True)
class ErasedGrantsAndAuthorship:
    removed_berechtigungen: int
    removed_angekuendigt: int
    # The notices this erasure queued, its own grant's ending among them.
    queued_postausgang: int
    # The notices queued before it that named the person.
    withheld_postausgang: int
    # The records whose author now reads `ERASED_ACTOR_MARKER`, the five fields together.
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
) -> list[Mapping[str, Any]]:
    """Every row holding this person's address at one of `paths`, unbounded: a capped read leaves the rest naming them."""

    pattern = same_address(identifier)
    pipeline: list[Mapping[str, Any]] = [{"$match": {"$or": [{path: pattern} for path in paths]}}]
    if not whole:
        pipeline.append({"$project": dict.fromkeys(paths, 1)})

    rows = await aggregate_many_from_db(collection=collection, pipeline=pipeline, session=session)

    return [row for row in rows if any(_names(_held_at(row, path), identifier) for path in paths)]


def _withholding(row: Mapping[str, Any], identifier: str) -> dict[str, Any]:
    """The `$set` taking this person out of one outbox row: the grant's address withheld, its actor given the marker.

    The stored reason is the grant address's alone; an actor's reads off `geaendert_von`, null for a ban.
    """

    update: dict[str, Any] = {}
    for site in _GRANT_SITES:
        if _names(_held_at(row, f"{site}.adresse"), identifier):
            update[f"{site}.adresse"] = None
            update["vorenthalten"] = "geloescht"
    if _names(row.get("geaendert_von"), identifier):
        update["geaendert_von"] = ERASED_ACTOR_MARKER

    return update


def _withheld(document: Mapping[str, Any], identifier: str) -> dict[str, Any]:
    """A composed outbox row as `_withholding` leaves it, so the insert itself never carries the address."""

    withheld = dict(document)
    for path, value in _withholding(document, identifier).items():
        head, _, tail = path.partition(".")
        withheld[head] = {**withheld[head], tail: value} if tail else value

    return withheld


async def _withhold_queued(collection: AsyncCollection, identifier: str, session: AsyncClientSession) -> int:
    """Every notice still queued naming this person, written by id: a filter on the address copies it into the log."""

    rows = await _rows_naming(collection, _QUEUED_SITES, identifier, session)

    by_update: dict[tuple[tuple[str, Any], ...], list[ObjectId]] = {}
    for row in rows:
        by_update.setdefault(tuple(sorted(_withholding(row, identifier).items())), []).append(row["_id"])

    for update, ids in by_update.items():
        await patch_many_in_db(collection=collection, db_filter={"_id": {"$in": ids}}, update={"$set": dict(update)}, session=session)

    return len(rows)


async def carry_authorship_in_session(
    *,
    berechtigungen_collection: AsyncCollection,
    berechtigungen_postausgang_collection: AsyncCollection,
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
    """Re-key every record and queued notice the person made to the new address, whatever they hold now.

    Each collection named by its own parameter, as the erasure names them, so the traces resolve every write
    (`docs/backend/spec.md :: I842`).
    """

    carried = await _set_authored(berechtigungen_collection, "erteilt_von", alt, neue, session)
    carried += await _set_authored(bewerbungen_collection, "entscheidung.von", alt, neue, session)
    carried += await _set_authored(registrierungen_collection, "entscheidung.von", alt, neue, session)
    carried += await _set_authored(sperrliste_collection, "erstellt_von", alt, neue, session)
    carried += await _set_authored(einladungen_collection, "erstellt_von", alt, neue, session)
    carried += await _set_authored(berechtigungen_postausgang_collection, "geaendert_von", alt, neue, session)
    # A moved requester's request is approvable by nobody, their grant written anew, and waits for its refusal: carried
    # so it holds no address an erasure at the new one misses.
    carried += await _set_authored(berechtigungen_antraege_collection, "genehmigung.gestartet_von", alt, neue, session)

    return carried


async def _set_authored(collection: AsyncCollection, field: str, identifier: str, value: str, session: AsyncClientSession) -> int:
    """Put `value` in `field` of every record this person made, by id, so the log keeps the ids and no address."""

    ids = [row["_id"] for row in await _rows_naming(collection, (field,), identifier, session)]
    if not ids:
        return 0

    marked = await patch_many_in_db(collection=collection, db_filter={"_id": {"$in": ids}}, update={"$set": {field: value}}, session=session)

    return marked.modified_count


async def erase_grants_and_authorship_in_session(
    *,
    berechtigungen_collection: AsyncCollection,
    berechtigungen_angekuendigt_collection: AsyncCollection,
    berechtigungen_postausgang_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    einladungen_collection: AsyncCollection,
    # By name, as every collection a write reaches: the duplicate-key trace resolves a collection by
    # its parameter's spelling, never through the ban list's attribute.
    sperrliste_collection: AsyncCollection,
    # Answers which other address in a queued notice is barred (`docs/backend/spec.md :: I462`).
    sperrliste: BanList,
    # Folded (`app/shared/folding.py :: sign_in_identifier`).
    identifier: str,
    # Who the erasure is attributed to: an administrator's address, or `identifier` itself on the
    # person's own request, which the notice then names by the marker.
    geaendert_von: str,
    now: datetime,
    # REQUIRED: the grants, the notices and the authored records go in one transaction or none.
    session: AsyncClientSession,
) -> ErasedGrantsAndAuthorship:
    """Removes an `owner` grant and breaks the floor of two, refusing neither (`docs/backend/spec.md :: I435`, `:: I436`).

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
        # A database edit to the row nobody was told of goes out first, as a revoke's does
        # (`docs/backend/spec.md :: I451`); `geaendert_von` null names the database as its source.
        changes += [(*change, None) for change in compare(grants=[grant], announced=[] if record is None else [record])]
        if lebendige_adresse(grant) is not None:
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

    documents = [
        _withheld(
            compose_postausgang(berechtigung_id=grant_id, art=art, jetzt=jetzt, vorher=vorher, geaendert_von=von, now=now, gesperrt=barred),
            identifier,
        )
        for grant_id, art, jetzt, vorher, von in changes
    ]
    if documents:
        await post_many_to_db(collection=berechtigungen_postausgang_collection, documents=documents, session=session)

    # No image of either: a grant's image is the address itself, and the announced record is bookkeeping
    # (`docs/backend/spec.md :: I465`).
    if grant_ids:
        await erase_many_from_db(collection=berechtigungen_collection, db_filter={"_id": {"$in": grant_ids}}, session=session)
    if records:
        await erase_many_from_db(
            collection=berechtigungen_angekuendigt_collection, db_filter={"_id": {"$in": list(records_by_id)}}, session=session
        )

    withheld = await _withhold_queued(berechtigungen_postausgang_collection, identifier, session)

    # Fields an address change's effect carries too (`fl_backend/app/api/berechtigungen/erasure.py :: carry_authorship_in_session`).
    marked = await _set_authored(berechtigungen_collection, "erteilt_von", identifier, ERASED_ACTOR_MARKER, session)
    marked += await _set_authored(bewerbungen_collection, "entscheidung.von", identifier, ERASED_ACTOR_MARKER, session)
    marked += await _set_authored(registrierungen_collection, "entscheidung.von", identifier, ERASED_ACTOR_MARKER, session)
    marked += await _set_authored(sperrliste_collection, "erstellt_von", identifier, ERASED_ACTOR_MARKER, session)
    marked += await _set_authored(einladungen_collection, "erstellt_von", identifier, ERASED_ACTOR_MARKER, session)

    return ErasedGrantsAndAuthorship(
        removed_berechtigungen=len(grant_ids),
        removed_angekuendigt=len(records),
        queued_postausgang=len(documents),
        withheld_postausgang=withheld,
        marked=marked,
    )
