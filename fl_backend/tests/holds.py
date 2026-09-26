import asyncio
from typing import Any, ClassVar

import pytest


class HeldCollection:
    """A collection one write's transaction reaches through, parked after one of its operations until another write commits.

    Records each insert's failure: how the server ordered the two.
    """

    # What `until_held` fails with when the task answers without reaching the operation that holds it.
    MISSED: ClassVar[str]

    def __init__(self, collection: Any, committed: asyncio.Event) -> None:
        self._collection = collection
        self._committed = committed
        self.held = asyncio.Event()
        self.insert_failures: list[str] = []

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def hold(self) -> None:
        self.held.set()
        await self._committed.wait()

    async def insert_one(self, *args: Any, **kwargs: Any) -> Any:
        try:
            return await self._collection.insert_one(*args, **kwargs)
        except Exception as failure:
            self.insert_failures.append(f"{type(failure).__name__}:{getattr(failure, 'code', None)}")
            raise

    async def until_held(self, task: asyncio.Task[Any]) -> None:
        """Raced against the task, never polled: a task ending without its hold fails here rather than hanging the tier."""

        held = asyncio.create_task(self.held.wait())
        try:
            await asyncio.wait({task, held}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            # On every path, as `abandon` drains its task: `cancel()` only schedules the cancellation,
            # and awaiting the task finishes it inside this case rather than on the next one's loop pass.
            held.cancel()
            await asyncio.gather(held, return_exceptions=True)
        if self.held.is_set():
            return

        # A task that raised is its own failure, not a missing hold.
        if (error := task.exception()) is not None:
            raise error
        pytest.fail(self.MISSED)

    @staticmethod
    async def abandon(task: asyncio.Task[Any]) -> None:
        """Cancelled and drained: left parked on the shared seed loop, it holds its transaction open into the next test."""

        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


class HoldsAfterItsLookup(HeldCollection):
    """A second press held between its real key lookup and its insert until the first press has committed.

    Records each lookup's filter as well: what the endpoint asked for.
    """

    MISSED = "the second press answered without looking its key up, so nothing held it across the first press's commit"

    def __init__(self, collection: Any, committed: asyncio.Event) -> None:
        super().__init__(collection, committed)
        self.lookups = 0
        self.lookup_filters: list[Any] = []

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        found = await self._collection.find_one(*args, **kwargs)
        query = kwargs.get("filter", args[0] if args else {})
        if "idempotenz_schluessel" in query:
            self.lookups += 1
            self.lookup_filters.append(query)
            await self.hold()

        return found
