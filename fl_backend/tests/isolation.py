from collections.abc import Awaitable, Callable
from typing import Any

import pytest

from app.core.exceptions import WriteRefusalException

# What a case reports where nothing refused at all. Reported rather than raised, so a write that
# lands names the state it left instead of an exception that failed to arrive.
COMMITTED = "the write committed"

# Both ways a case's count of judgements can miss the one a rival landing inside makes, for its failure
# to name whichever happened rather than the one its author had in mind.
MISCOUNTED_JUDGEMENTS = (
    "one short is a rival that landed outside the write or a conflict never judged again, one over a retry that conflicted again"
)

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
        # Every arrival at the rival's point, the rival's own included.
        self.passes = 0

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

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
