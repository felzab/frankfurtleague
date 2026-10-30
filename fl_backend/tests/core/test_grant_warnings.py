"""
CORE · what the boot says about the grants, and that it boots anyway

`app/core/db.py :: warn_about_the_grants` reads one `find`, so a collection standing in for that
read is all most cases meet; one db case boots over a real collection, so the lifespan's own call
is asserted as well as run.
"""

import asyncio
import logging
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, cast

import pytest
from fastapi import FastAPI
from pydantic import SecretStr
from pymongo import MongoClient
from pymongo.asynchronous.collection import AsyncCollection

from app.core.collections import Collection
from app.core.db import NO_GRANT, NO_OWNER, lifespan, warn_about_the_grants
from app.core.logging import FL_LOGGER_NAME
from tests.config import build_test_config
from tests.worker import worker_database


class _Cursor:
    def __init__(self, rows: Sequence[Mapping[str, Any]]) -> None:
        self._rows = list(rows)

    async def to_list(self, length: int | None) -> list[Mapping[str, Any]]:
        return self._rows


class _Grants:
    def __init__(self, rows: Sequence[Mapping[str, Any]]) -> None:
        self._rows = rows

    def find(self, filter: Mapping[str, Any], projection: Mapping[str, Any]) -> _Cursor:
        return _Cursor(self._rows)


def warned(rows: Sequence[Mapping[str, Any]], caplog: pytest.LogCaptureFixture) -> list[str]:
    with caplog.at_level(logging.WARNING, logger=FL_LOGGER_NAME):
        asyncio.run(warn_about_the_grants(cast(AsyncCollection, _Grants(rows))))

    return [record.getMessage() for record in caplog.records]


OWNER = {"adresse": "inhaberin@frankfurtleague.de", "verwaltung": "owner"}
ADMINISTRATOR = {"adresse": "anna@frankfurtleague.de", "verwaltung": "administration"}


def test_a_list_holding_an_owner_and_live_addresses_says_nothing(caplog):
    """The control: a check warning on every boot would pass each case below."""

    assert warned([OWNER, ADMINISTRATOR], caplog) == []


def test_no_grant_at_all_is_named_and_nothing_else_is(caplog):
    """Nothing else, because no owner is implied and says nothing more."""

    assert warned([], caplog) == [NO_GRANT]


def test_a_list_with_no_owner_is_named(caplog):
    assert warned([ADMINISTRATOR], caplog) == [NO_OWNER]


def booted_over(grants: Sequence[Mapping[str, Any]], mongo_url: str, caplog: pytest.LogCaptureFixture) -> set[str]:
    """The lifespan entered and left over a database holding these grants; the grant warnings it logged."""

    name = worker_database("fl_boot_grants")
    config = build_test_config().model_copy(update={"mongodb_uri": SecretStr(mongo_url), "db_base_name": name})
    client: MongoClient = MongoClient(mongo_url)

    async def enter() -> None:
        app = FastAPI()
        app.state.config = config
        async with lifespan(app):
            pass

    try:
        client.drop_database(name)
        if grants:
            stamped = {"erteilt_von": "PLAYGROUND", "erteilt_am": datetime(2026, 1, 1, tzinfo=UTC)}
            client[name][Collection.BERECHTIGUNGEN].insert_many([{**grant, **stamped} for grant in grants])
        with caplog.at_level(logging.WARNING, logger=FL_LOGGER_NAME):
            asyncio.run(enter())
    finally:
        client.drop_database(name)
        client.close()

    return {record.getMessage() for record in caplog.records} & {NO_GRANT, NO_OWNER}


@pytest.mark.db
class TestTheBootWarnsAboutTheGrantsItFinds:
    """The lifespan's own call, over a real collection: a boot that stopped asking would leave the operator warned of nothing."""

    def test_an_empty_list_is_named_at_boot(self, mongo_url: str, caplog: pytest.LogCaptureFixture):
        assert booted_over([], mongo_url, caplog) == {NO_GRANT}

    def test_an_owner_and_an_administrator_boot_in_silence(self, mongo_url: str, caplog: pytest.LogCaptureFixture):
        """The control: a boot warning every time would pass the case above."""

        assert booted_over([OWNER, ADMINISTRATOR], mongo_url, caplog) == set()
