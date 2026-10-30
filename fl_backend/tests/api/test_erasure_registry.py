"""
API · the erasure registry's decisions a database need not answer

Collections standing in for the reads each decision makes: `app/api/identitaet/crud.py :: ErasureJournal`'s
one `find` after the commit, and the aggregates `:: resolve_subject` sends.
"""

import asyncio
import logging
from dataclasses import fields
from typing import Any, cast

import pytest
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import NetworkTimeout

from app.api.identitaet.crud import ErasureJournal, Subject, resolve_subject
from app.api.identitaet.schemas import FLErasure
from app.core.codes import Code
from app.core.journal import JOURNAL_TOKEN
from tests.config import build_test_config

IDENTIFIER = "zorbanax.quillfeather@example.org"

# One grant taken, so the journal reads the grants once the erasure committed.
A_GRANT_TAKEN = FLErasure(
    spieler=0,
    saison_spieler=0,
    schiedsrichter=0,
    spiele=0,
    kontakt_sitze=0,
    registrierungen=0,
    adresswechsel=0,
    berechtigungen=1,
    berechtigungen_antraege=0,
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
    assert [message for message in messages if message.startswith(JOURNAL_TOKEN)] != []
    assert [getattr(record, "error_code", None) for record in caplog.records].count(Code.DATABASE_FAILED) == 1
    assert [message for message in messages if IDENTIFIER in message] == []


class _NoRows:
    async def to_list(self, length: int | None) -> list[Any]:
        return []


class _Counted:
    """A collection answering every aggregate with no rows, counting each one."""

    def __init__(self) -> None:
        self.reads = 0

    async def aggregate(self, *args: Any, **kwargs: Any) -> _NoRows:
        self.reads += 1
        return _NoRows()


# Every kind `Subject` holds but the two the pupil scope reads, so a kind it gains is held here too.
UNREAD_IN_THE_PUPIL_SCOPE = sorted(
    {field.name.removeprefix("_") for field in fields(Subject) if field.name.startswith("_")} - {"spieler", "registrierungen"}
)


@pytest.mark.parametrize("kind", UNREAD_IN_THE_PUPIL_SCOPE)
def test_the_pupil_scope_reads_no_other_kind_and_a_step_reading_one_raises(kind: str):
    """Catches a kind read for no step, and a kind left unread answered as an empty list, on which a step erases nothing."""

    collections = {name: _Counted() for name in ("saison_teams", "bewerbungen", "schiedsrichter", "spieler", "registrierungen")}

    subject = asyncio.run(
        resolve_subject(
            IDENTIFIER,
            **{f"{name}_collection": cast(AsyncCollection, collection) for name, collection in collections.items()},
            schluessel=build_test_config().sperrliste_schluessel,
            session=cast(AsyncClientSession, None),
            scope=frozenset({"spieler"}),
        )
    )

    assert {name: collection.reads for name, collection in collections.items()} == {
        "saison_teams": 0,
        "bewerbungen": 0,
        "schiedsrichter": 0,
        "spieler": 1,
        "registrierungen": 1,
    }
    assert (subject.spieler, subject.registrierungen) == ([], [])
    with pytest.raises(RuntimeError):
        getattr(subject, kind)
