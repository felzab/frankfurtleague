from collections.abc import Awaitable
from typing import Any

from app.core.exceptions import DocumentConflictException

# What a case reports where nothing refused at all. Reported rather than raised, so a write that
# lands names the state it left instead of an exception that failed to arrive.
COMMITTED = "the write committed"


async def outcome_of(call: Awaitable[Any]) -> str:
    """A refusal's code, or `COMMITTED`.

    Only a refusal is caught: a write conflict reaching the caller is a retry that never happened,
    and must surface as itself rather than as a write that declined.
    """

    try:
        await call
    except DocumentConflictException as refusal:
        return str(refusal.error_code)

    return COMMITTED
