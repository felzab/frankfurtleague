"""
CORE · what the boot says about the grants, and that it boots anyway

`app/core/db.py :: warn_about_the_grants` reads one `find`, so a collection standing in for that
read is all it meets; the lifespan's own call is exercised by every boot the db tier makes.
"""

import asyncio
import logging
from collections.abc import Mapping, Sequence
from typing import Any, cast

import pytest
from pymongo.asynchronous.collection import AsyncCollection

from app.core.db import NO_GRANT, NO_OWNER, UNFOLDED_GRANT, warn_about_the_grants
from app.core.logging import FL_LOGGER_NAME


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


def warned(rows: Sequence[Mapping[str, Any]], caplog: pytest.LogCaptureFixture) -> list[tuple[str, str]]:
    with caplog.at_level(logging.WARNING, logger=FL_LOGGER_NAME):
        asyncio.run(warn_about_the_grants(cast(AsyncCollection, _Grants(rows))))

    return [(getattr(record, "error_code", ""), record.getMessage()) for record in caplog.records]


OWNER = {"adresse": "inhaberin@frankfurtleague.de", "verwaltung": "owner"}
ADMINISTRATOR = {"adresse": "anna@frankfurtleague.de", "verwaltung": "administration"}
# What the Playground stores where the paste was typed in capitals: nothing refuses it, and no
# folded header ever equals it.
UNFOLDED = {"adresse": "Bernd.Admin@Frankfurtleague.de", "verwaltung": "administration"}


def test_a_list_holding_an_owner_and_folded_addresses_says_nothing(caplog):
    """The control: a check warning on every boot would pass each case below."""

    assert warned([OWNER, ADMINISTRATOR], caplog) == []


def test_no_grant_at_all_is_named_and_nothing_else_is(caplog):
    """Nothing else, because no owner and no unfolded row are both implied and say nothing more."""

    assert warned([], caplog) == [(NO_GRANT.error_code, NO_GRANT.sentence)]


def test_a_list_with_no_owner_is_named(caplog):
    assert warned([ADMINISTRATOR], caplog) == [(NO_OWNER.error_code, NO_OWNER.sentence)]


def test_an_unfolded_row_is_counted_and_its_address_stays_out_of_the_line(caplog):
    """A count and never the address: the container log outlives the grant it would describe."""

    lines = warned([OWNER, UNFOLDED], caplog)

    assert lines == [(UNFOLDED_GRANT.error_code, UNFOLDED_GRANT.sentence.format(count=1))]
    assert "bernd" not in lines[0][1].lower()
