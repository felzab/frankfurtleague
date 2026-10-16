"""
API · the erasure registry's decisions a database need not answer

`app/api/identitaet/crud.py :: ErasureJournal` reads `berechtigungen` with one `find` after the commit, so
a collection standing in for that read is all a case needs.
"""

import asyncio
import logging
from typing import Any, cast

import pytest
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import NetworkTimeout

from app.api.identitaet.crud import ERASURE_JOURNAL_EVENT, ErasureJournal
from app.api.identitaet.schemas import FLErasure
from app.core.exception_handlers import DATABASE_FAILED
from tests.config import build_test_config

IDENTIFIER = "zorbanax.quillfeather@example.org"

# One grant taken, so the journal reads the grants once the erasure committed.
A_GRANT_TAKEN = FLErasure(
    spieler=0, saison_spieler=0, schiedsrichter=0, spiele=0, kontakt_sitze=0, registrierungen=0, adresswechsel=0, berechtigungen=1, drosselung=0
)


class _DeadlinePassed:
    async def to_list(self, length: int | None) -> list[Any]:
        raise NetworkTimeout("the request's deadline passed")


class _GrantsUnread:
    """`berechtigungen` as the request's deadline leaves it once the commit has landed."""

    def find(self, *args: Any, **kwargs: Any) -> _DeadlinePassed:
        return _DeadlinePassed()


def test_a_committed_erasure_whose_grant_warning_fails_answers_and_journals(caplog: pytest.LogCaptureFixture):
    """Catches the warning's read raising out of the journal: the person is answered an error for an erasure that landed."""

    async def erased() -> FLErasure:
        journal = ErasureJournal[FLErasure](
            IDENTIFIER,
            schluessel=build_test_config().sperrliste_schluessel,
            berechtigungen_collection=cast(AsyncCollection, _GrantsUnread()),
        )
        async with journal:
            return journal.took(A_GRANT_TAKEN)

    with caplog.at_level(logging.INFO):
        answer = asyncio.run(erased())

    messages = [record.getMessage() for record in caplog.records]

    assert answer == A_GRANT_TAKEN
    assert [message for message in messages if message.startswith(ERASURE_JOURNAL_EVENT)] != []
    assert [getattr(record, "error_code", None) for record in caplog.records].count(DATABASE_FAILED) == 1
    assert [message for message in messages if IDENTIFIER in message] == []
