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

from app.api.grants.crud import OPEN_NOTICE, owe_in_session
from app.api.grants.services import Notice, compose_notice
from app.api.kontakte.services import same_address
from app.core.crud import aggregate_many_from_db, erase_many_from_db, patch_many_in_db
from app.core.recording import ERASED_ACTOR_MARKER
from app.shared.folding import sign_in_identifier

# The sites of a grant notice naming an address in full: a change's masked new address matches nobody's.
_QUEUED_SITES = ("data.address", "data.changed_by")


@dataclass(frozen=True)
class ErasedGrantsAndAuthorship:
    removed_grants: int
    # The notices this erasure owes, its own grant's ending among them, before each is owed to every holder.
    queued_outbox: int
    # The notices owed before it and not yet sent that named the person.
    withheld_outbox: int
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
    also: Mapping[str, Any] | None = None,
) -> list[Mapping[str, Any]]:
    """Every row holding this person's address at one of `paths`, unbounded: a capped read leaves the rest naming them."""

    pattern = same_address(identifier)
    pipeline: list[Mapping[str, Any]] = [{"$match": {**(also or {}), "$or": [{path: pattern} for path in paths]}}]
    if not whole:
        pipeline.append({"$project": dict.fromkeys(paths, 1)})

    rows = await aggregate_many_from_db(collection=collection, pipeline=pipeline, session=session)

    return [row for row in rows if any(_names(_held_at(row, path), identifier) for path in paths)]


def _withholding(data: Mapping[str, Any], identifier: str) -> dict[str, Any]:
    """What takes this person out of one notice's facts: the address emptied, the actor given the marker."""

    update: dict[str, Any] = {}
    if _names(data.get("address"), identifier):
        update["address"] = None
    if _names(data.get("changed_by"), identifier):
        update["changed_by"] = ERASED_ACTOR_MARKER

    return update


def _withheld(notice: Notice, identifier: str) -> Notice:
    """A composed notice as `_withholding` leaves it, so no row owed carries the address."""

    return Notice(grant_id=notice.grant_id, data={**notice.data, **_withholding(notice.data, identifier)})


async def _withhold_queued(outbox_collection: AsyncCollection, identifier: str, session: AsyncClientSession) -> int:
    """Every grant notice still owed naming this person, written by id and grouped by what each loses."""

    rows = await _rows_naming(outbox_collection, _QUEUED_SITES, identifier, session, also=OPEN_NOTICE)

    by_update: dict[tuple[tuple[str, Any], ...], list[ObjectId]] = {}
    for row in rows:
        update = tuple(sorted((f"data.{path}", value) for path, value in _withholding(row["data"], identifier).items()))
        by_update.setdefault(update, []).append(row["_id"])

    for update, ids in by_update.items():
        await patch_many_in_db(collection=outbox_collection, db_filter={"_id": {"$in": ids}}, update={"$set": dict(update)}, session=session)

    return len(rows)


async def carry_authorship_in_session(
    *,
    grants_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    invitations_collection: AsyncCollection,
    ban_list_collection: AsyncCollection,
    # Both folded (`app/shared/folding.py :: sign_in_identifier`).
    old: str,
    new_address: str,
    session: AsyncClientSession,
) -> int:
    """Re-key every record the person made to the new address, whatever they hold now.

    Each collection named by its own parameter, as the erasure names them, so the traces resolve every write.
    """

    carried = await _set_authored(grants_collection, "granted_by", old, new_address, session)
    carried += await _set_authored(bewerbungen_collection, "decision.by", old, new_address, session)
    carried += await _set_authored(registrierungen_collection, "decision.by", old, new_address, session)
    carried += await _set_authored(ban_list_collection, "created_by", old, new_address, session)
    carried += await _set_authored(invitations_collection, "created_by", old, new_address, session)

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
    grants_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    invitations_collection: AsyncCollection,
    # By name, as every collection a write reaches: the duplicate-key trace resolves a collection by
    # its parameter's spelling.
    ban_list_collection: AsyncCollection,
    # Folded (`app/shared/folding.py :: sign_in_identifier`).
    identifier: str,
    # Who the erasure is attributed to: an administrator's address, or `identifier` itself on the
    # person's own request, which the notice then names by the marker.
    changed_by: str,
    now: datetime,
    # REQUIRED: the grants, the notices and the authored records go in one transaction or none.
    session: AsyncClientSession,
) -> ErasedGrantsAndAuthorship:
    """Removes an `owner` grant, refusing nothing.

    Who may erase an owner is the caller's judgement, and so is any line once the transaction commits.
    """

    # Read before the removal, after which no grant matches.
    grants = await _rows_naming(grants_collection, ("address",), identifier, session, whole=True)
    grant_ids = [grant["_id"] for grant in grants]

    notices = [
        _withheld(
            compose_notice(
                grant_id=grant["_id"], change="revoked", stage="completed", address=str(grant["address"]), changed_by=changed_by, now=now
            ),
            identifier,
        )
        for grant in grants
    ]

    # Owed before this erasure's own: they are not yet withheld, and this erasure's carry no address of the person.
    withheld = await _withhold_queued(outbox_collection, identifier, session)

    # No image: a grant's image is the address itself.
    if grant_ids:
        await erase_many_from_db(collection=grants_collection, db_filter={"_id": {"$in": grant_ids}}, session=session)

    # After the removal, so the person is no holder told: every holder who remains is.
    await owe_in_session(
        notices,
        outbox_collection=outbox_collection,
        grants_collection=grants_collection,
        now=now,
        session=session,
    )

    # Fields an address change's effect carries too (`fl_backend/app/api/grants/erasure.py :: carry_authorship_in_session`).
    marked = await _set_authored(grants_collection, "granted_by", identifier, ERASED_ACTOR_MARKER, session)
    marked += await _set_authored(bewerbungen_collection, "decision.by", identifier, ERASED_ACTOR_MARKER, session)
    marked += await _set_authored(registrierungen_collection, "decision.by", identifier, ERASED_ACTOR_MARKER, session)
    marked += await _set_authored(ban_list_collection, "created_by", identifier, ERASED_ACTOR_MARKER, session)
    marked += await _set_authored(invitations_collection, "created_by", identifier, ERASED_ACTOR_MARKER, session)

    return ErasedGrantsAndAuthorship(
        removed_grants=len(grant_ids),
        queued_outbox=len(notices),
        withheld_outbox=withheld,
        marked=marked,
    )
