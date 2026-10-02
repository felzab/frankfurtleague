from collections.abc import Awaitable, Callable
from typing import Any

from app.core.exceptions import WriteRefusalException

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
    except WriteRefusalException as refusal:
        return str(refusal.error_code)

    return COMMITTED


class InterleavedCollection:
    """A collection one write reaches through, running a rival write inside it once, at the operation a subclass names.

    Not a subclass of the driver's collection: the driver builds one off a database handle, so every
    other call delegates.
    """

    def __init__(self, collection: Any, rival: Rival) -> None:
        self._collection = collection
        self._rival: Rival | None = rival
        # Every arrival at the rival's point. A second is the write's retry, which a rival committing
        # before the write's first read never causes: a case asserting it tells an interleaving from a
        # serial order with the same outcome.
        self.passes = 0

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def run_the_rival(self) -> None:
        self.passes += 1
        # ONE-SHOT: a retry of the write's transaction has to meet what the rival left rather than run
        # it again, and a second rival would answer on its own account and mask what the case proves.
        if self._rival is not None:
            rival, self._rival = self._rival, None
            await rival()
