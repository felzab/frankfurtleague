import logging
from collections.abc import Generator
from contextlib import contextmanager

import pytest
from pymongo.asynchronous.database import AsyncDatabase

from app.core.collections import Collection
from app.core.recording import FLAction, actor_var


@contextmanager
def acting_as(address: str) -> Generator[None]:
    """`address` as the administrator `bind_actor` binds on a request, for a handler a case calls directly.

    Reset in a `finally`, so a case that fails inside it leaves its actor to nothing after it.
    """

    token = actor_var.set(address)
    try:
        yield
    finally:
        actor_var.reset(token)


async def acts_of(database: AsyncDatabase) -> list[tuple[str, str, str | None, object]]:
    """Every row of the action log, oldest first, as what was done, who did it, for which team and to which record."""

    rows = database[Collection.ACTION_LOG].find().sort("_id", 1)

    return [(row["action"], row["by"], row["team"], row["record_id"]) async for row in rows]


async def deletions_of(database: AsyncDatabase, action: FLAction) -> list[tuple[str, str | None, int | None, object]]:
    """One pass's nameless rows, oldest first, as who ran it, the season, how many went and the record, which none names."""

    rows = database[Collection.ACTION_LOG].find({"action": action}).sort("_id", 1)

    return [(row["by"], row["saison_id"], row["count"], row["record_id"]) async for row in rows]


def journal_records(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    """Every journal line `caplog` captured, one record a line, so an act written over several lines counts each."""

    return [record for record in caplog.records if record.getMessage() == "journal.act"]
