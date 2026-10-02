from collections.abc import Iterable
from datetime import UTC, datetime

from fastapi import FastAPI

from app.core.security import GrantLookup, get_grant_lookup
from tests.config import ADMINISTRATORS

# Before any sign-in a case signs a token for, so the check this answers admits every one of them.
GRANTED_SINCE = datetime(2026, 1, 1, tzinfo=UTC)


def admit(app: FastAPI, addresses: Iterable[str] = ADMINISTRATORS) -> FastAPI:
    """`app`, the actor check's one read answered from `addresses`, so a case with no database still reaches what follows the check.

    That read alone: every handler still opens the grants collection the case configured.
    """

    granted = frozenset(addresses)

    def answered_from_the_set() -> GrantLookup:
        async def grant_since(identifier: str) -> datetime | None:
            return GRANTED_SINCE if identifier in granted else None

        return grant_since

    app.dependency_overrides[get_grant_lookup] = answered_from_the_set

    return app
