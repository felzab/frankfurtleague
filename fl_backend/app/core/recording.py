"""
CORE · the action log's write side

Every write in the application funnels through `app/core/crud.py`, so recording there is what makes
the log complete by construction rather than by discipline -- a page listing some of the writes is a
page nobody trusts. Nothing here reads the log; `app/api/aktionen/` serves it.

This module deliberately stores submitted VALUES, which `docs/logging/spec.md` forbids the log
stream: a restore replays what a write replaced, so the prior document is the point. That is what
makes retention and the erasure redaction this module's problem rather than the stream's.
"""

from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal, Mapping

from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorCollection

from app.core.collections import Collection
from app.core.logging import correlation_id_var

Operation = Literal["insert", "patch_one", "patch_many"]

# What a write not made through a request is attributed to -- a migration, a script, a fixture. The
# spelling matches `app/core/logging.py :: NO_REQUEST_SENTINEL`, so one grep finds both.
SYSTEM_ACTOR_EMAIL = "SYSTEM"


@dataclass(frozen=True)
class Actor:
    """Who a write is attributed to.

    A sub-document, not a bare address: the backend authenticates a tier and never a person, so
    `kind` records how strongly the identity is held. A stronger scheme later writes a different one.
    """

    kind: Literal["admin_session", "system"]
    email: str

    def as_document(self) -> dict[str, str]:
        return {"kind": self.kind, "email": self.email}


SYSTEM_ACTOR = Actor(kind="system", email=SYSTEM_ACTOR_EMAIL)

# Set by `app/core/security.py :: bind_actor`, which every admin router depends on. The default is
# the system actor rather than `None`, so a write outside a request records honestly instead of
# needing a branch at each recording site.
actor_var: ContextVar[Actor] = ContextVar("actor", default=SYSTEM_ACTOR)

# Set by the same dependency. The route's METHOD and PATH are what let the page say "a team was
# renamed" rather than "an update ran on `teams`", which the collection alone cannot distinguish.
request_var: ContextVar[tuple[str, str] | None] = ContextVar("request", default=None)


def _now() -> str:
    """UTC with an offset, not German local time.

    The log is ordered and ranged by this field, and a local-time string carrying no offset sorts
    its two identical clock hours the wrong way round on the October changeover.
    """

    return datetime.now(timezone.utc).isoformat(timespec="seconds")


async def record_write(
    *,
    collection: AsyncIOMotorCollection,
    operation: Operation,
    document_id: Any = None,
    db_filter: Mapping[str, Any] | None = None,
    before: Mapping[str, Any] | None = None,
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
        "at": _now(),
        "actor": actor.as_document(),
        # The request's own id, so a fan-out's rows and the write that caused them are one action on
        # the page instead of forty.
        "correlation_id": correlation_id_var.get(),
        "request": {"method": request[0], "path": request[1]} if request is not None else None,
        "collection": str(collection.name),
        "operation": operation,
        "document_id": document_id,
        "db_filter": _stringify_filter(db_filter) if db_filter is not None else None,
        "before": dict(before) if before is not None else None,
        "modified_count": modified_count,
        # Set when a person is erased and their values are overwritten here. Null means the row still
        # holds what it recorded (`docs/backend/spec.md :: I42`).
        "redacted_at": None,
    }

    # The target's own database handle, not an injected one: that is what keeps this module off
    # `app/core/db.py`'s import path and out of a cycle.
    await collection.database[Collection.AKTIONEN].insert_one(row, session=session)


def _stringify_filter(db_filter: Mapping[str, Any]) -> dict[str, str]:
    """A filter's values rendered as text.

    Stored for the reader rather than for replay: a filter can hold an ObjectId, a regex or a nested
    operator, and a validator admitting all of those admits anything at all.
    """

    return {key: str(value) for key, value in db_filter.items()}
