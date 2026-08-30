"""
CORE · the action log's write side

Every write in the application funnels through `app/core/crud.py`, so recording there is what makes
the log complete by construction rather than by discipline -- a page listing some of the writes is a
page nobody trusts. Nothing here reads the log; `app/api/aktionen/` serves it.

This module deliberately stores submitted VALUES, which `docs/logging/spec.md` forbids the log
stream: a restore replays what a write replaced, so the prior document is the point. That is what
makes retention and redaction this module's problem rather than the stream's.
"""

from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal, Mapping, Sequence

from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorCollection

from app.core.collections import Collection
from app.core.logging import correlation_id_var

Operation = Literal["insert", "insert_many", "patch_one", "patch_many", "delete_many", "erase_many"]

# A redaction's reach: one collection, and the documents in it whose log rows are to be emptied.
RedactionTarget = tuple[Collection, Sequence[Any]]

# What a write not made through a request is attributed to -- a migration, a script, a fixture. The
# spelling matches `app/core/logging.py :: NO_REQUEST_SENTINEL`, so one grep finds both.
SYSTEM_ACTOR_EMAIL = "SYSTEM"

# What a write made through a request by NOBODY is attributed to. Spelled like the sentinel above
# because it is one: the public form authenticates no person, so no address is held.
PUBLIC_ACTOR_EMAIL = "PUBLIC"


@dataclass(frozen=True)
class Actor:
    """Who a write is attributed to.

    A sub-document, not a bare address: the backend authenticates a tier and never a person, so
    `kind` records how strongly the identity is held. A stronger scheme later writes a different one.
    """

    kind: Literal["admin_session", "system", "public"]
    email: str

    def as_document(self) -> dict[str, str]:
        return {"kind": self.kind, "email": self.email}


SYSTEM_ACTOR = Actor(kind="system", email=SYSTEM_ACTOR_EMAIL)

# Its own kind rather than `system`, which means a write made outside a request altogether: a public
# submission IS a request, made by a visitor the backend authenticates as nobody. Bound by
# `app/core/security.py :: bind_public_actor`.
PUBLIC_ACTOR = Actor(kind="public", email=PUBLIC_ACTOR_EMAIL)

# Set by `app/core/security.py :: bind_actor`, which every admin router depends on. The default is
# the system actor rather than `None`, so a write outside a request records honestly instead of
# needing a branch at each recording site.
actor_var: ContextVar[Actor] = ContextVar("actor", default=SYSTEM_ACTOR)

# Set by the same dependency. The route's METHOD and PATH are what let the page say "a team was
# renamed" rather than "an update ran on `teams`", which the collection alone cannot distinguish.
request_var: ContextVar[tuple[str, str] | None] = ContextVar("request", default=None)


def log_stamp(moment: datetime) -> str:
    """A log row's instant, spelled the one way both of its time fields are.

    UTC with an offset, never German local time: `at` orders and ranges the page, and a local-time
    string carrying no offset sorts October's two identical clock hours the wrong way.
    """

    return moment.astimezone(timezone.utc).isoformat(timespec="seconds")


async def record_write(
    *,
    collection: AsyncIOMotorCollection,
    operation: Operation,
    document_id: Any = None,
    db_filter: Mapping[str, Any] | None = None,
    before: Mapping[str, Any] | Sequence[Mapping[str, Any]] | None = None,
    modified_count: int | None = None,
    session: AsyncIOMotorClientSession | None = None,
) -> None:
    """Append one row describing a write that has just happened.

    Not wrapped in a try: a write nobody could record is what this feature exists to prevent, and
    inside a transaction the failure aborts it.
    """

    if collection.name == Collection.AKTIONEN:
        # The log recording its own rows would recurse without end, and a redaction is itself a
        # write. What a redaction did is recoverable from the erasure row that caused it.
        return

    actor = actor_var.get()
    request = request_var.get()

    row: dict[str, Any] = {
        "at": log_stamp(datetime.now(timezone.utc)),
        "actor": actor.as_document(),
        # The request's own id, so a fan-out's rows and the write that caused them are one action on
        # the page instead of forty.
        "correlation_id": correlation_id_var.get(),
        "request": {"method": request[0], "path": request[1]} if request is not None else None,
        "collection": str(collection.name),
        "operation": operation,
        "document_id": document_id,
        "db_filter": _stringify_filter(db_filter) if db_filter is not None else None,
        "before": _stored_image(before),
        "modified_count": modified_count,
        # Set when a person's erasure or a referee's anonymisation overwrites the values here. Null
        # means the row still holds what it recorded (`docs/backend/spec.md :: I42`).
        "redacted_at": None,
    }

    # The target's own database handle, not an injected one: that is what keeps this module off
    # `app/core/db.py`'s import path and out of a cycle.
    await collection.database[Collection.AKTIONEN].insert_one(row, session=session)


def _stored_image(before: Mapping[str, Any] | Sequence[Mapping[str, Any]] | None) -> dict[str, Any] | list[dict[str, Any]] | None:
    """One document for a patch, an array for a removal that took a set.

    A removal follows no write a restore could replay, so the images ARE the record, and one array
    keeps one action in one row as `insert_many` does.
    """

    if before is None:
        return None

    if isinstance(before, Mapping):
        return dict(before)

    return [dict(document) for document in before]


def _stringify_filter(db_filter: Mapping[str, Any]) -> dict[str, str]:
    """A filter's values rendered as text.

    Stored for the reader rather than for replay: a filter can hold an ObjectId, a regex or a nested
    operator, and a validator admitting all of those admits anything at all.
    """

    return {key: str(value) for key, value in db_filter.items()}


def build_redaction_filter(targets: Sequence[RedactionTarget]) -> Mapping[str, Any]:
    """Every log row whose `(collection, document_id)` names one of the documents handed in.

    NOT narrowed to rows holding an image: every row naming a redacted document carries a stamp,
    so "was this reached" is one query rather than a judgement per row.
    """

    # Equality on `collection` and a match on `document_id` in each branch, the shape
    # `aktionen_target` serves (`app/core/constraints.py :: SUPPORT_INDEXES`). An `$in` of no ids
    # matches nothing rather than everything.
    return {"$or": [{"collection": str(collection), "document_id": {"$in": list(document_ids)}} for collection, document_ids in targets]}


def build_redaction_update(*, at: str) -> Mapping[str, Any]:
    """Overwrite the values a row recorded and stamp it, in one `$set` (`docs/backend/spec.md :: I42`).

    `document_id` stays: it names what the row was about, and dropping it would leave a row
    nothing can attribute to the write that redacted it.
    """

    return {"$set": {"before": None, "redacted_at": at}}
