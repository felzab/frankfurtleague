from collections.abc import Iterable, Mapping
from typing import Any

from bson import ObjectId
from fastapi import FastAPI, Request

from app.core.collections import Collection
from app.core.db import get_berechtigungen_collection
from app.core.exceptions import NO_DATABASE_CLIENT, DatabaseUnavailableException
from tests.config import ADMINISTRATORS


class _Cursor:
    def __init__(self, rows: list[Mapping[str, Any]]) -> None:
        self._rows = rows

    def sort(self, _: Any) -> _Cursor:
        return self

    def limit(self, _: int) -> _Cursor:
        return self

    async def to_list(self, length: int | None) -> list[Mapping[str, Any]]:
        return self._rows


class GrantedAddresses:
    """`berechtigungen` whose equality on `adresse` is answered from a fixed set; every other use reaches the application's client.

    So a handler writing the grants meets the database the case configured, or its absence, as the
    real dependency would.
    """

    def __init__(self, addresses: Iterable[str], request: Request) -> None:
        self.addresses = frozenset(addresses)
        self._request = request

    def find(self, *, filter: Mapping[str, Any], projection: Any, collation: Any, session: Any) -> _Cursor:
        return _Cursor([{"_id": ObjectId()}] if filter.get("adresse") in self.addresses else [])

    def __getattr__(self, name: str) -> Any:
        state = self._request.app.state
        # What `app/core/db.py :: get_database` answers where no client is held.
        if not hasattr(state, "db_client"):
            raise DatabaseUnavailableException(error_code=NO_DATABASE_CLIENT)

        return getattr(state.db_client[state.config.db_base_name][Collection.BERECHTIGUNGEN], name)


def admit(app: FastAPI, addresses: Iterable[str] = ADMINISTRATORS) -> FastAPI:
    """`app`, its actor check answered from `addresses` rather than a database, so a case with none still reaches what follows the check."""

    granted = frozenset(addresses)

    # Annotated, which a lambda cannot be: FastAPI reads an unannotated parameter as a query string.
    def answered_from_the_set(request: Request) -> GrantedAddresses:
        return GrantedAddresses(granted, request)

    app.dependency_overrides[get_berechtigungen_collection] = answered_from_the_set

    return app
