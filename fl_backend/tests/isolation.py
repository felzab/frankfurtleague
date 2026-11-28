from collections.abc import Awaitable, Callable
from typing import Any

import pytest

from app.core.exceptions import APIError

# What a case reports where nothing refused at all. Reported rather than raised, so a write that
# lands names the state it left instead of an exception that failed to arrive.
COMMITTED = "the write committed"

Rival = Callable[[], Awaitable[Any]]


async def outcome_of(call: Awaitable[Any]) -> str:
    """A refusal's code, or `COMMITTED`.

    Only a refusal is caught: a write conflict reaching the caller is a retry that never happened,
    and must surface as itself rather than as a write that declined.
    """

    try:
        await call
    except APIError as refusal:
        return str(refusal.error_code)

    return COMMITTED


async def refused_code(call: Awaitable[Any]) -> str:
    """The code of the refusal `call` must meet, failing the case where it lands instead."""

    with pytest.raises(APIError) as refused:
        await call

    return str(refused.value.error_code)


class InterleavedCollection:
    """A collection one write reaches through, running a rival write inside it once, at one operation.

    `before` or `after` names that operation, one the driver awaits; a subclass placing the rival anywhere else
    overrides the operation itself. Not a subclass of the driver's collection: the driver builds one off a
    database handle, so every other call delegates.
    """

    def __init__(self, collection: Any, rival: Rival, *, before: str | None = None, after: str | None = None) -> None:
        self._collection = collection
        self._before = before
        self._after = after
        self._rival: Rival | None = rival
        # Every arrival at the rival's point, the rival's own included.
        self.passes = 0

    def __getattr__(self, name: str) -> Any:
        operation = getattr(self._collection, name)
        if name == self._before:

            async def rival_first(*args: Any, **kwargs: Any) -> Any:
                await self.run_the_rival()
                return await operation(*args, **kwargs)

            return rival_first
        if name == self._after:

            async def rival_after(*args: Any, **kwargs: Any) -> Any:
                answered = await operation(*args, **kwargs)
                await self.run_the_rival()
                return answered

            return rival_after

        return operation

    def assert_landed_inside(self, *, serially: int) -> None:
        """`serially` is how often the write arrives at the rival's point with the rival committed before it.

        A rival landing inside takes the write further, to a retry or past a refusal, exceeding that
        count where the outcomes can match.
        """

        if self.passes <= serially:
            pytest.fail(
                f"the write arrived at the rival's point {self.passes} times, no more than with the rival committed "
                f"before it ({serially}): the rival landed outside the write"
            )

    async def run_the_rival(self) -> None:
        self.passes += 1
        # ONE-SHOT: a retry of the write's transaction has to meet what the rival left rather than run
        # it again, and a second rival would answer on its own account and mask what the case proves.
        if self._rival is not None:
            rival, self._rival = self._rival, None
            await rival()


class SeasonsRunningARivalAfterTheSessionRead(InterleavedCollection):
    """A `saisons` stand-in running its rival once, just after the first read made inside a transaction.

    A read before the transaction, such as a route's 404 check, would place the rival ahead of any snapshot.
    """

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        found = await self._collection.find_one(*args, **kwargs)
        if kwargs.get("session") is not None:
            await self.run_the_rival()

        return found


class RowsThenTheRival:
    """A `find` cursor reaching the rival's point once its rows have arrived; `sort` and `limit` chain as the driver's do."""

    def __init__(self, cursor: Any, reached: Callable[[], Awaitable[None]]) -> None:
        self._cursor = cursor
        self._reached = reached

    def sort(self, *args: Any, **kwargs: Any) -> RowsThenTheRival:
        self._cursor = self._cursor.sort(*args, **kwargs)
        return self

    def limit(self, *args: Any, **kwargs: Any) -> RowsThenTheRival:
        self._cursor = self._cursor.limit(*args, **kwargs)
        return self

    async def to_list(self, *args: Any, **kwargs: Any) -> list[Any]:
        rows = await self._cursor.to_list(*args, **kwargs)
        await self._reached()

        return rows


class TheRivalThenRows(RowsThenTheRival):
    """A `find` cursor reaching the rival's point as its read runs, before any of its rows arrives."""

    async def to_list(self, *args: Any, **kwargs: Any) -> list[Any]:
        await self._reached()

        return await self._cursor.to_list(*args, **kwargs)


class GrantsRunningARivalAfterTheFirstRead(InterleavedCollection):
    """The grants a judging transaction reads, a rival write run once after that read and before its anchor.

    So only the anchor can make the two conflict. The read is `read_grants`, a `find`; a `find_one` reads through the
    driver's own collection, never this one, so it reaches no rival.
    """

    def __init__(self, collection: Any, rival: Rival) -> None:
        async def reported() -> None:
            self.rival_outcome = await outcome_of(rival())

        super().__init__(collection, reported)
        self.rival_outcome: str | None = None

    def find(self, *args: Any, **kwargs: Any) -> RowsThenTheRival:
        return RowsThenTheRival(self._collection.find(*args, **kwargs), self.run_the_rival)
