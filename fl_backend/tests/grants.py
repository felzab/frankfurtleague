from collections.abc import Iterable

from fastapi import FastAPI

from app.core.security import GrantLookup, get_grant_lookup
from tests.config import ADMINISTRATORS


def admit(app: FastAPI, addresses: Iterable[str] = ADMINISTRATORS) -> FastAPI:
    """`app`, the actor check's one read answered from `addresses`, so a case with no database still reaches what follows the check.

    That read alone: every handler still opens the grants collection the case configured.
    """

    granted = frozenset(addresses)

    def answered_from_the_set() -> GrantLookup:
        async def holds_a_live_grant(identifier: str) -> bool:
            return identifier in granted

        return holds_a_live_grant

    app.dependency_overrides[get_grant_lookup] = answered_from_the_set

    return app
