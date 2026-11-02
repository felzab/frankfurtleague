"""
CORE · a collection that can only be read, so an operation writing nothing is one the type checker holds to it

A structural type (PEP 544): pymongo's `AsyncCollection` satisfies it as it stands, and it names the driver's reads
alone, each cursor they return narrowed to its reads too, so a write called on it, on what it returns, or a write
helper handed it, is a type error rather than a convention. Least privilege inside the one client the application holds; a second, read-only
client is what the ratified `db` line refuses.

What the types cannot hold, each a step outside them rather than a slip inside:
- the request's snapshot session (`app/core/dependencies.py :: SnapshotSession`), whose `client` is the driver's
  whole client: the one handle such an operation is handed that leads back to a write, kept because reading several
  times at one moment needs a session;
- an aggregation stage writing its output (`$out`, `$merge`), which a pipeline's type does not show;
- the client on `request.app.state`, for a handler or dependency taking the request, and a `cast` or `getattr`.
"""

from collections.abc import AsyncIterator, Mapping
from typing import Any, Protocol

from pymongo.asynchronous.client_session import AsyncClientSession


class ReadCommandCursor[DocumentT](Protocol):
    """What a read takes from `AsyncCommandCursor`: its documents, and not the `session` it holds."""

    def __aiter__(self) -> AsyncIterator[DocumentT]: ...

    async def to_list(self, length: int | None = None) -> list[DocumentT]: ...


class ReadCursor[DocumentT](ReadCommandCursor[DocumentT], Protocol):
    """What a read takes from `AsyncCursor`: ordered and paged, then its documents.

    Not the `collection` or the `session` it holds, each a way back to a write.
    """

    def sort(self, key_or_list: Any, direction: int | str | None = None) -> ReadCursor[DocumentT]: ...

    def limit(self, limit: int) -> ReadCursor[DocumentT]: ...

    def skip(self, skip: int) -> ReadCursor[DocumentT]: ...


class ReadCollection[DocumentT: Mapping[str, Any]](Protocol):
    """The reads of `pymongo.asynchronous.collection.AsyncCollection`, each returning a cursor narrowed to its reads.

    A pipeline and an index hint are `Any`, since the driver's own types for them are private to it.
    """

    def find(self, *args: Any, **kwargs: Any) -> ReadCursor[DocumentT]: ...

    async def find_one(self, filter: Any | None = None, *args: Any, **kwargs: Any) -> DocumentT | None: ...

    async def aggregate(
        self,
        pipeline: Any,
        session: AsyncClientSession | None = None,
        let: Mapping[str, Any] | None = None,
        comment: Any | None = None,
        **kwargs: Any,
    ) -> ReadCommandCursor[DocumentT]: ...

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
        hint: Any | None = None,
        **kwargs: Any,
    ) -> list[Any]: ...
