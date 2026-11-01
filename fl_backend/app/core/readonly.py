"""
CORE · a collection that can only be read, so an operation writing nothing is one the type checker holds to it

A structural type (PEP 544): pymongo's `AsyncCollection` satisfies it as it stands, and it names the driver's reads
alone, with the signatures the driver gives them, so a write called on it, or a write helper handed it, is a type
error rather than a convention. Least privilege inside the one client the application holds; a second, read-only
client is what the ratified `db` line refuses.

What the types cannot hold, each a step outside them rather than a slip inside:
- the request's snapshot session (`app/core/dependencies.py :: SnapshotSession`), whose `client` is the driver's
  whole client: the one handle such an operation is handed that leads back to a write, kept because reading several
  times at one moment needs a session;
- a cursor's `collection`, the driver's collection the cursor reads;
- an aggregation stage writing its output (`$out`, `$merge`), which a pipeline's type does not show;
- the client on `request.app.state`, for a handler or dependency taking the request, and a `cast` or `getattr`.
"""

from collections.abc import Mapping, Sequence
from typing import Any, Protocol

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.command_cursor import AsyncCommandCursor
from pymongo.asynchronous.cursor import AsyncCursor

# pymongo's own spellings of a pipeline and an index hint (`pymongo.typings._Pipeline`, `pymongo.operations._IndexKeyHint`),
# private there, so spelled again rather than imported.
type Pipeline = Sequence[Mapping[str, Any]]
type IndexKeyHint = str | Sequence[str | tuple[str, int | str | Mapping[str, Any]]] | Mapping[str, Any]


class ReadCollection[DocumentT: Mapping[str, Any]](Protocol):
    """The reads of `pymongo.asynchronous.collection.AsyncCollection`, signature for signature."""

    def find(self, *args: Any, **kwargs: Any) -> AsyncCursor[DocumentT]: ...

    async def find_one(self, filter: Any | None = None, *args: Any, **kwargs: Any) -> DocumentT | None: ...

    async def aggregate(
        self,
        pipeline: Pipeline,
        session: AsyncClientSession | None = None,
        let: Mapping[str, Any] | None = None,
        comment: Any | None = None,
        **kwargs: Any,
    ) -> AsyncCommandCursor[DocumentT]: ...

    async def count_documents(
        self,
        filter: Mapping[str, Any],
        session: AsyncClientSession | None = None,
        comment: Any | None = None,
        **kwargs: Any,
    ) -> int: ...

    async def distinct(
        self,
        key: str,
        filter: Mapping[str, Any] | None = None,
        session: AsyncClientSession | None = None,
        comment: Any | None = None,
        hint: IndexKeyHint | None = None,
        **kwargs: Any,
    ) -> list[Any]: ...
