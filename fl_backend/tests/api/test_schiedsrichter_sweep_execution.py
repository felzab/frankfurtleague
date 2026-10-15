"""
API · the lapsed pending referee address, removed by its clock against the shipped validators

A confirmed referee's pending address goes the day after its link's deadline, as an administrator's
discard takes it. The share's sizing is `tests/api/test_schiedsrichter_sweep_refusal.py`'s.
"""

from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient, ReturnDocument, monitoring
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.schiedsrichter.services import ADRESSWECHSEL_FELD, build_ghost_schiedsrichter, compose_adresswechsel, compose_einwilligung
from app.api.schiedsrichter.sweep_router import ADRESSWECHSEL_PER_PASS, sweep_adresswechsel
from app.core.collections import Collection
from app.core.crud import patch_one_in_db
from app.core.exception_handlers import DATABASE_FAILED
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import saison_document, schiedsrichter_document
from tests.whole_database import where_held
from tests.worker import worker_database

from .test_schiedsrichter_sweep_refusal import COMMANDS_A_REFEREE

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_schiedsrichter_sweep_test")

TODAY = "2026-04-16"
# Minted on these days, the link's deadline is yesterday and today.
MINTED_TO_LAPSE_YESTERDAY = "2026-04-01"
MINTED_TO_LAPSE_TODAY = "2026-04-02"
NOW = datetime(2026, 4, 16, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
# Written out rather than computed from `log_stamp`, which would agree with any conversion of `NOW`.
REDACTED_AT = "2026-04-16T10:30:00+00:00"


def numbered(position: int) -> ObjectId:
    return ObjectId(f"6890a1b2c3d4e5f607e2{position:04d}")


def on_file(position: int) -> str:
    return f"schiedsrichter.{position}@beispielschule.de"


def pending(position: int) -> str:
    return f"neue.adresse.{position}@anderswo.example.org"


def a_referee(position: int, *, minted: str | None, **fields: Any) -> dict[str, Any]:
    """A referee who confirmed their own record, holding a pending address minted on `minted` where one is given."""

    wechsel = (
        {}
        if minted is None
        else {ADRESSWECHSEL_FELD: compose_adresswechsel(email=pending(position), token_hash=hash_token(f"t{position}"), today=minted)}
    )

    return schiedsrichter_document(
        numbered(position),
        email=on_file(position),
        name=f"Schiedsrichter {position}",
        default_payment=20,
        einwilligung=compose_einwilligung(umfang="kader_oeffentlich", medien=False, text_version="v1", today="2026-03-01"),
        **wechsel,
        **fields,
    )


async def with_history(database: AsyncDatabase, *referees: dict[str, Any]) -> None:
    """Each referee stored, then edited once, so the log holds an image of the block as it stood."""

    await database[Collection.SCHIEDSRICHTER].insert_many(list(referees))
    for referee in referees:
        await patch_one_in_db(
            collection=database[Collection.SCHIEDSRICHTER],
            db_filter={"_id": referee["_id"]},
            update={"$set": {"schule": "Lindenschule"}},
            return_document=ReturnDocument.BEFORE,
        )


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(saison_document("2026", "active"))
            await database[Collection.SCHIEDSRICHTER].insert_one(build_ghost_schiedsrichter())

            return await body(database, client)

    return on_the_seed_loop(_run())


async def sweep(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    return await sweep_adresswechsel(
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        today=TODAY,
        germany_now=NOW,
    )


async def images_of(database: AsyncDatabase, schiedsrichter_id: ObjectId) -> list[Mapping[str, Any]]:
    return (
        await database[Collection.AKTIONEN]
        .find({"collection": str(Collection.SCHIEDSRICHTER), "document_id": schiedsrichter_id, "before": {"$ne": None}})
        .to_list(None)
    )


class TestALapsedAddressGoesTheDayAfterItsDeadline:
    def test_the_block_and_its_address_in_the_images_go_and_the_rest_stands(self, mongo_replica_set_url: str):
        """A bystander's pending address, still running, keeps its block and its images whole."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await with_history(database, a_referee(1, minted=MINTED_TO_LAPSE_YESTERDAY), a_referee(2, minted=MINTED_TO_LAPSE_TODAY))
            answer = await sweep(database, client)

            return (
                answer,
                await database[Collection.SCHIEDSRICHTER].find_one({"_id": numbered(1)}),
                await images_of(database, numbered(1)),
                await images_of(database, numbered(2)),
                await where_held(database, pending(1), pending(2), on_file(1)),
            )

        answer, row, lapsed_images, bystander_images, held = on_a_league(mongo_replica_set_url, body)

        assert (answer.entfernt, answer.verbleibend) == (1, 0)
        assert ADRESSWECHSEL_FELD not in row
        assert row["kontakt"]["email"] == on_file(1)
        held_the_block = [image for image in lapsed_images if ADRESSWECHSEL_FELD in image["before"]]
        assert held_the_block, "no image held the block, so the redaction proves nothing"
        assert [(image["before"][ADRESSWECHSEL_FELD], image["redacted_at"]) for image in held_the_block] == [(None, REDACTED_AT)] * len(
            held_the_block
        )
        assert {image["before"]["kontakt"]["email"] for image in held_the_block} == {on_file(1)}
        assert [(image["before"][ADRESSWECHSEL_FELD]["email"], image["redacted_at"]) for image in bystander_images] == [(pending(2), None)]
        assert held == {pending(1): [], pending(2): ["aktionen", "schiedsrichter"], on_file(1): ["aktionen", "schiedsrichter"]}

    def test_a_retired_referees_lapsed_address_goes_too(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await with_history(database, a_referee(1, minted=MINTED_TO_LAPSE_YESTERDAY, inactive_since="2026-02-01"))
            answer = await sweep(database, client)

            return answer.entfernt, await database[Collection.SCHIEDSRICHTER].find_one({"_id": numbered(1)})

        removed, row = on_a_league(mongo_replica_set_url, body)

        assert removed == 1
        assert ADRESSWECHSEL_FELD not in row
        assert row["inactive_since"] == "2026-02-01"

    def test_the_ghost_is_never_read(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answer = await sweep(database, client)

            return (answer.entfernt, answer.verbleibend), await database[Collection.SCHIEDSRICHTER].find_one(
                {"_id": build_ghost_schiedsrichter()["_id"]}
            )

        counts, ghost = on_a_league(mongo_replica_set_url, body)

        assert counts == (0, 0)
        assert ghost == build_ghost_schiedsrichter()


class TestEachCallTakesAShare:
    def test_a_share_and_one_more_take_two_calls_and_the_third_finds_none(self, mongo_replica_set_url: str):
        """The shipped share, seeded one over: ignore it and the first call takes every one."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[tuple[int, int]]:
            await database[Collection.SCHIEDSRICHTER].insert_many(
                [a_referee(position, minted=MINTED_TO_LAPSE_YESTERDAY) for position in range(ADRESSWECHSEL_PER_PASS + 1)]
            )

            return [(answer.entfernt, answer.verbleibend) for answer in [await sweep(database, client) for _ in range(3)]]

        assert on_a_league(mongo_replica_set_url, body) == [(ADRESSWECHSEL_PER_PASS, 1), (1, 0), (0, 0)]


class TestOneRecordHoldsBackNoOther:
    def test_a_refused_removal_is_passed_over_and_the_next_goes(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A log image stored before its validator required `trace_id` refuses the redaction's update. Remove the catch and the call fails."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first, second = a_referee(1, minted=MINTED_TO_LAPSE_YESTERDAY), a_referee(2, minted=MINTED_TO_LAPSE_YESTERDAY)
            await database[Collection.SCHIEDSRICHTER].insert_many([first, second])
            await database[Collection.AKTIONEN].insert_one(
                {
                    "at": "2026-04-01T00:00:00+00:00",
                    "actor": {"kind": "system", "email": "SYSTEM"},
                    "request": None,
                    "collection": str(Collection.SCHIEDSRICHTER),
                    "operation": "patch_one",
                    "document_id": numbered(1),
                    "db_filter": None,
                    "before": first,
                    "modified_count": None,
                    "redacted_at": None,
                },
                bypass_document_validation=True,
            )
            answer = await sweep(database, client)

            return (answer.entfernt, answer.verbleibend), await database[Collection.SCHIEDSRICHTER].distinct(
                "_id", {ADRESSWECHSEL_FELD: {"$type": "object"}}
            )

        with caplog.at_level("ERROR"):
            counts, still_pending = on_a_league(mongo_replica_set_url, body)

        assert counts == (1, 1)
        assert still_pending == [numbered(1)]
        failures = [record.getMessage() for record in caplog.records if getattr(record, "error_code", None) == DATABASE_FAILED]
        assert [str(numbered(1)) in message and pending(1) not in message for message in failures] == [True]


class _Counting(monitoring.CommandListener):
    def __init__(self) -> None:
        self.commands = 0

    def started(self, event: monitoring.CommandStartedEvent) -> None:
        self.commands += 1

    def succeeded(self, event: monitoring.CommandSucceededEvent) -> None:
        pass

    def failed(self, event: monitoring.CommandFailedEvent) -> None:
        pass


FEW = ADRESSWECHSEL_PER_PASS // 2


class TestOneRefereeCostsTheCommandsItsShareIsSizedAt:
    def test_counted_on_the_wire(self, mongo_replica_set_url: str):
        """`AFTER` at the call site, or a write more a referee, turns this red."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, int]:
            async def counted(due: int) -> int:
                await database[Collection.SCHIEDSRICHTER].delete_many({"_id": {"$ne": build_ghost_schiedsrichter()["_id"]}})
                await database[Collection.AKTIONEN].delete_many({})
                await with_history(database, *(a_referee(position, minted=MINTED_TO_LAPSE_YESTERDAY) for position in range(due)))

                listener = _Counting()
                counting = AsyncMongoClient(mongo_replica_set_url, event_listeners=[listener])
                try:
                    await sweep(counting[DATABASE_NAME], counting)
                finally:
                    await counting.close()

                return listener.commands

            return await counted(FEW), await counted(2 * FEW)

        few, twice = on_a_league(mongo_replica_set_url, body)

        assert (twice - few) / FEW == COMMANDS_A_REFEREE
