from collections import Counter
from collections.abc import Awaitable, Callable
from typing import Any

from pymongo import AsyncMongoClient, monitoring
from pymongo.asynchronous.database import AsyncDatabase

Call = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


class _ByName(monitoring.CommandListener):
    """Every command sent while it is on, each one a round trip, by name."""

    def __init__(self) -> None:
        self.names: Counter[str] = Counter()

    def started(self, event: monitoring.CommandStartedEvent) -> None:
        self.names[event.command_name] += 1

    def succeeded(self, event: monitoring.CommandSucceededEvent) -> None:
        """Required by the listener interface; a command is counted as it is sent."""

    def failed(self, event: monitoring.CommandFailedEvent) -> None:
        """Required by the listener interface; a command is counted as it is sent."""


async def commands_by_name(url: str, database_name: str, call: Call) -> tuple[Any, Counter[str]]:
    """The call's answer and the commands it sent, on a client of its own so the case's other commands stay out.

    Read before the close sends `endSessions`, which is no command of the call's.
    """

    listener = _ByName()
    counting = AsyncMongoClient(url, event_listeners=[listener])
    try:
        return await call(counting[database_name], counting), Counter(listener.names)
    finally:
        await counting.close()


async def commands_sent(url: str, database_name: str, call: Call) -> int:
    _, names = await commands_by_name(url, database_name, call)

    return names.total()
