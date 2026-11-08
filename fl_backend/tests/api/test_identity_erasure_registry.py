"""
API · the erasure registry's decisions a database need not answer

Collections standing in for the reads each decision makes: the aggregates `app/api/identity/crud.py :: resolve_subject`
sends.
"""

import asyncio
from dataclasses import fields
from datetime import UTC, datetime
from typing import Any, cast

import pytest
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.identity.crud import Subject, resolve_subject
from app.api.outbox.schemas import FLAddressChangeEffectiveData, FLDeletionNoticeData
from app.api.outbox.services import DELIVERY_DEADLINE, OwedMail, row_of

IDENTIFIER = "zorbanax.quillfeather@example.org"

NOW = datetime(2126, 4, 1, 12, 30, tzinfo=UTC)


@pytest.mark.parametrize(
    "data",
    [
        pytest.param(FLDeletionNoticeData(kind="deletion_notice", saison_id=None), id="the notice an erasure spares"),
        pytest.param(FLAddressChangeEffectiveData(kind="address_change_effective", instant=NOW), id="the replaced address's"),
    ],
)
def test_a_row_no_erasure_reaches_goes_at_its_deadline(data: Any):
    """Catches the row kept a retention longer: it holds an address the person's erasure no longer finds, past the erasure."""

    row = row_of(OwedMail(key="a-key", to=IDENTIFIER, data=data), now=NOW, secret=None, valid_until=None)

    assert row["erase_at"] == NOW + DELIVERY_DEADLINE


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

    collections = {
        name: _Counted()
        for name in ("saison_teams", "bewerbungen", "schiedsrichter", "spieler", "registrierungen", "address_changes", "grants")
    }

    subject = asyncio.run(
        resolve_subject(
            IDENTIFIER,
            **{f"{name}_collection": cast(AsyncCollection, collection) for name, collection in collections.items()},
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
        "address_changes": 0,
        "grants": 0,
    }
    assert (subject.spieler, subject.registrierungen) == ([], [])
    with pytest.raises(RuntimeError):
        getattr(subject, kind)
