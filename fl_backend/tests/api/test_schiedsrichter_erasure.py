from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.schiedsrichter.admin_router import (
    delete_schiedsrichter,
    patch_schiedsrichter,
)
from app.api.schiedsrichter.schemas import (
    FLPatchSchiedsrichterPayload,
)
from app.api.schiedsrichter.services import compose_confirmation
from app.api.spiele.schemas import (
    SONDEREREIGNIS_WITHOUT_A_RESULT,
)
from app.core.collections import Collection
from app.shared.folding import sign_in_identifier
from app.shared.schemas.kontakt import FLKontaktPayload
from app.shared.tokens import hash_token
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import SCHIEDSRICHTER_TEXT_VERSIONS, own_einwilligung_document, saison_document, spiel_document
from tests.erasure import erased
from tests.outbox import MAIL_NOW
from tests.worker import worker_database

from .address_change_harness import answer as answer_the_change
from .address_change_harness import start as start_the_change

DATABASE_NAME = worker_database("fl_schiedsrichter_erasure_test")


# Fixed rather than generated, so a failure names the same row every run.
SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607800001")
OTHER_SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607800002")

REFEREE_NAMES = {SCHIEDSRICHTER_OID: "Anna Körner", OTHER_SCHIEDSRICHTER_OID: "Bernd Kraus"}

SCHULE = "Carl-Schurz-Schule"
DEFAULT_PAYMENT = 20

# The pair the seeded edit replaced.
FORMER_KONTAKT = {
    SCHIEDSRICHTER_OID: {"phone": "+49 69 7654321", "email": "ak-vertretung@example.com"},
    OTHER_SCHIEDSRICHTER_OID: {"phone": "+49 69 9998887", "email": "bk-vertretung@example.com"},
}

# What each referee holds when the erasure runs.
KONTAKT = {
    SCHIEDSRICHTER_OID: {"phone": "+49 69 1234567", "email": "koerner.anna@example.com"},
    OTHER_SCHIEDSRICHTER_OID: {"phone": "+49 69 2223334", "email": "kraus.bernd@example.com"},
}

# Injected through `get_germany_now`, and in summer, so the conversion below moves the clock. A century ahead of the
# real one, as `tests/outbox.py :: MAIL_NOW` is: a mail owed under a clock long past is erased by the TTL monitor's next
# pass, which can fall before the hand-out claims it. Every day below moves with it.
NOW = datetime(2126, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

# `get_german_date_str`'s answer for `NOW`, written out rather than computed, which would agree with any conversion.
TODAY = "2126-04-01"

# A day the endpoints here are never handed, so a stamp found unmoved cannot be one they wrote.
AN_EARLIER_RETIREMENT = "2125-11-20"

# Handed to the retire endpoint alone, and later than every other day here: a stamp that moved is
# then unmistakable rather than equal to what another write would have left.
A_LATER_PRESS = "2126-05-04"

# The day the seeded links were minted, earlier than every press here, so a block found carrying it
# is the seed's rather than one a case wrote.
MINTED_ON = "2126-03-02"
BIRTH_DATE = "1984-05-09"

TOKEN_HASHES = {oid: hash_token(f"raw-token-for-{oid}") for oid in REFEREE_NAMES}


# Two fixtures for the erased referee, so an erasure stopping at the first row fails, and one for the
# other, so one ignoring its filter fails too.
SPIEL_OIDS: dict[ObjectId, tuple[ObjectId, ...]] = {
    SCHIEDSRICHTER_OID: (ObjectId("6890a1b2c3d4e5f607800011"), ObjectId("6890a1b2c3d4e5f607800012")),
    OTHER_SCHIEDSRICHTER_OID: (ObjectId("6890a1b2c3d4e5f607800013"),),
}

# The first of their pair is moved per case and the second left as `booked_spiel_document` seeds it, so one league
# drives both halves of what the erasure does to a booking.
MOVED_SPIEL_OID, PLAYED_SPIEL_OID = SPIEL_OIDS[SCHIEDSRICHTER_OID]

(OTHER_SPIEL_OID,) = SPIEL_OIDS[OTHER_SCHIEDSRICHTER_OID]

# Read off the declaration, so a member leaving that set fails here rather than leaving the case below
# asserting nothing about a cancellation.
A_CANCELLATION = SONDEREREIGNIS_WITHOUT_A_RESULT[0]

SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f6078000a1")
SAISON_ID = "2026"

PAST_SAISON_ID = "2025"
PAST_SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f6078000a2")

# Seeded per case rather than into the league below, whose booking assertions count the fixtures each
# referee holds.
ARCHIVED_SPIEL_OID = ObjectId("6890a1b2c3d4e5f607800014")


def referee_document(schiedsrichter_id: ObjectId) -> dict[str, Any]:
    """Every field `FLSchiedsrichterRecord` requires, and the referee SERVING: no retire-first precondition attaches to this endpoint."""

    return {
        "_id": schiedsrichter_id,
        "name": REFEREE_NAMES[schiedsrichter_id],
        "schule": SCHULE,
        "default_payment": DEFAULT_PAYMENT,
        "kontakt": dict(FORMER_KONTAKT[schiedsrichter_id]),
        "inactive_since": None,
        # Seeded because the erasure adds no `$set` for any of the three: a row carrying none of
        # them would let a nulling write pass every case below.
        "confirmation": {**compose_confirmation(today=MINTED_ON), "token_hashes": [TOKEN_HASHES[schiedsrichter_id]]},
        "einwilligung": own_einwilligung_document(text_versions=SCHIEDSRICHTER_TEXT_VERSIONS, confirmed_at=MINTED_ON, media=True),
        "birth_date": BIRTH_DATE,
        "version": 0,
    }


def booked_spiel_document(schiedsrichter_id: ObjectId, spiel_id: ObjectId, spiel_nr: int) -> dict[str, Any]:
    """A PLAYED fixture, kicked off before `NOW` and its result stored."""

    return spiel_document(
        spiel_id=spiel_id,
        saison_id=SAISON_ID,
        spiel_nr=spiel_nr,
        spieltag_id=SPIELTAG_OID,
        date="2126-03-15",
        time="14:00:00",
        schiedsrichter={"schiedsrichter_id": schiedsrichter_id, "payment": DEFAULT_PAYMENT},
        ergebnis="2:1",
    )


def spiel_documents() -> list[dict[str, Any]]:
    return [
        booked_spiel_document(schiedsrichter_id, spiel_id, spiel_nr)
        for spiel_nr, (schiedsrichter_id, spiel_id) in enumerate(
            ((referee, spiel_id) for referee, spiel_ids in SPIEL_OIDS.items() for spiel_id in spiel_ids), start=1
        )
    ]


# What every played fixture of theirs holds afterwards: nobody named, and the fee this match itself agreed.
NAMELESS_BOOKING: dict[str, Any] = {"schiedsrichter_id": None, "payment": DEFAULT_PAYMENT}


async def an_archived_spiel(database: AsyncDatabase) -> None:
    """One more of their played fixtures, in a season that is CLOSED.

    The PAST row alone, `on_a_league` seeding the running one: an erasure reading a status then
    finds a season rather than an empty collection.
    """

    await database[Collection.SAISONS].insert_one(saison_document(PAST_SAISON_ID, "past"))
    await database[Collection.SPIELE].insert_one(
        {
            **booked_spiel_document(SCHIEDSRICHTER_OID, ARCHIVED_SPIEL_OID, 4),
            "saison_id": PAST_SAISON_ID,
            "spieltag_id": PAST_SPIELTAG_OID,
        }
    )


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


async def a_referee_with_a_history(database: AsyncDatabase, client: AsyncMongoClient, schiedsrichter_id: ObjectId) -> None:
    """Details EDITED through the real endpoints: the telephone by the editor's save, the address by the referee's own change."""

    former_email = FORMER_KONTAKT[schiedsrichter_id]["email"]
    served = await database[Collection.SCHIEDSRICHTER].find_one({"_id": schiedsrichter_id}, {"version": 1})
    assert served is not None
    await patch_schiedsrichter(
        schiedsrichter_id=schiedsrichter_id,
        schiedsrichter_data=FLPatchSchiedsrichterPayload(
            name=REFEREE_NAMES[schiedsrichter_id],
            schule=SCHULE,
            default_payment=DEFAULT_PAYMENT,
            kontakt=FLKontaktPayload(phone=KONTAKT[schiedsrichter_id]["phone"], email=former_email),
            version=served["version"],
        ),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        today=TODAY,
        now=MAIL_NOW,
    )
    minted = await start_the_change(
        database, client, email=KONTAKT[schiedsrichter_id]["email"], identifier=sign_in_identifier(former_email), germany_now=NOW
    )
    await answer_the_change(database, client, minted.token, germany_now=NOW)


def on_a_league(url: str, body: Body) -> Any:
    """The REAL indexes."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            # A referee save carrying an address reads the running season, the ban list being
            # judged against it, so a league with none would 404 in the seed rather than in a case.
            await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active"))
            await database[Collection.SCHIEDSRICHTER].insert_many([referee_document(oid) for oid in REFEREE_NAMES])
            await database[Collection.SPIELE].insert_many(spiel_documents())
            for oid in REFEREE_NAMES:
                await a_referee_with_a_history(database, client, oid)

            return await body(database, client)

    return on_the_seed_loop(_run())


async def erase_the_referee(database: AsyncDatabase, client: AsyncMongoClient, schiedsrichter_id: ObjectId = SCHIEDSRICHTER_OID) -> None:
    """The registry's erasure of the address the referee's history left them holding: the erasure is keyed on a mailbox, never on an id."""

    await erased(database, client, KONTAKT[schiedsrichter_id]["email"], germany_now=NOW)


async def call_retirement(database: AsyncDatabase, client: AsyncMongoClient, *, today: str) -> None:
    """Every seeded fixture of this referee is PLAYED, so `find_referee_retire_refusal` refuses nothing and a case below fails on the date."""

    return await delete_schiedsrichter(
        schiedsrichter_id=SCHIEDSRICHTER_OID,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spiele_collection=database[Collection.SPIELE],
        db=client,
        today=today,
    )


async def one_of_their_spiele_moved(database: AsyncDatabase, *, date: str, sonderereignis: str | None = None) -> None:
    """`MOVED_SPIEL_OID` dated `date` and owing a result, `booked_spiel_document` having seeded every fixture played."""

    await database[Collection.SPIELE].update_one(
        {"_id": MOVED_SPIEL_OID}, {"$set": {"date": date, "ergebnis": None, "sonderereignis": sonderereignis}}
    )


# A day after `NOW`, and one before it.
TO_COME, KICKED_OFF = "2126-04-15", "2126-03-29"


async def stored_spiele(database: AsyncDatabase) -> dict[Any, Mapping[str, Any]]:
    """Keyed by `_id`, so a failing assertion names the fixture rather than a list position."""

    return {row["_id"]: row for row in await database[Collection.SPIELE].find().to_list(length=None)}


async def stored_referees(database: AsyncDatabase) -> dict[Any, Mapping[str, Any]]:
    """Keyed by `_id`, so a failing assertion names the referee rather than a list position."""

    return {row["_id"]: row for row in await database[Collection.SCHIEDSRICHTER].find().to_list(length=None)}


def after_erasure(url: str) -> dict[Any, Mapping[str, Any]]:
    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await erase_the_referee(database, client)

        return await stored_referees(database)

    return on_a_league(url, body)


@pytest.mark.db
def test_the_referees_document_is_gone(mongo_replica_set_url: str):
    """The case the endpoint exists for. Kills nulling the row in place, and a transaction that never commits."""

    referees = after_erasure(mongo_replica_set_url)

    assert SCHIEDSRICHTER_OID not in referees
    # The control, without which emptying the whole collection would pass.
    assert referees[OTHER_SCHIEDSRICHTER_OID]["name"] == REFEREE_NAMES[OTHER_SCHIEDSRICHTER_OID]


@pytest.mark.db
def test_two_erasures_leave_no_referee_row_behind(mongo_replica_set_url: str):
    """Kills a row standing in for the erased: a nameless row would be booked, listed and counted as somebody."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await erase_the_referee(database, client, SCHIEDSRICHTER_OID)
        await erase_the_referee(database, client, OTHER_SCHIEDSRICHTER_OID)

        return await stored_referees(database), await stored_spiele(database)

    referees, spiele = on_a_league(mongo_replica_set_url, body)

    assert referees == {}
    assert [row["schiedsrichter"] for row in spiele.values()] == [NAMELESS_BOOKING] * 3


def after_moving_one_spiel(
    url: str, *, date: str, sonderereignis: str | None = None
) -> tuple[dict[Any, Mapping[str, Any]], dict[Any, Mapping[str, Any]]]:
    """One league holding a fixture moved to `date` beside a played one, so both halves are read off a single run."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await one_of_their_spiele_moved(database, date=date, sonderereignis=sonderereignis)
        await erase_the_referee(database, client)

        return await stored_spiele(database), await stored_referees(database)

    return on_a_league(url, body)


@pytest.mark.db
def test_a_spiel_still_to_come_does_not_stop_the_erasure_and_loses_the_booking(mongo_replica_set_url: str):
    """`DELETE` owes `schiedsrichter_still_assigned` and this does not: a request to be forgotten is not something a booking may block.

    Kills consulting that refusal here, and kills a match to come keeping a booking that names nobody, which no confirmation
    asks and no referee can take.
    """

    spiele, referees = after_moving_one_spiel(mongo_replica_set_url, date=TO_COME)

    assert SCHIEDSRICHTER_OID not in referees
    assert spiele[MOVED_SPIEL_OID]["schiedsrichter"] is None
    # The played one beside it, so this cannot pass on an erasure taking every booking off.
    assert spiele[PLAYED_SPIEL_OID]["schiedsrichter"] == NAMELESS_BOOKING
    # Both counts raised, so an editor read before the erasure is refused rather than booking the referee back.
    assert [spiele[spiel_id]["version"] for spiel_id in (MOVED_SPIEL_OID, PLAYED_SPIEL_OID)] == [1, 1]


@pytest.mark.db
def test_a_spiel_kicked_off_with_no_result_yet_keeps_the_booking_naming_nobody(mongo_replica_set_url: str):
    """Kills a partition reading the result: the match took place, and its record says somebody officiated it and what it cost."""

    spiele, _ = after_moving_one_spiel(mongo_replica_set_url, date=KICKED_OFF)

    assert spiele[MOVED_SPIEL_OID]["schiedsrichter"] == NAMELESS_BOOKING


@pytest.mark.db
@pytest.mark.parametrize(
    ("date", "booking"), [pytest.param(TO_COME, None, id="before-its-day"), pytest.param(KICKED_OFF, NAMELESS_BOOKING, id="after-its-day")]
)
def test_a_cancelled_spiel_is_judged_by_its_day(mongo_replica_set_url: str, date: str, booking: Any):
    """Kills a partition reading `sonderereignis`: a fixture called off keeps its booking once its day has passed, as a retirement does."""

    spiele, _ = after_moving_one_spiel(mongo_replica_set_url, date=date, sonderereignis=A_CANCELLATION)

    assert spiele[MOVED_SPIEL_OID]["schiedsrichter"] == booking


@pytest.mark.db
def test_another_referees_spiel_keeps_its_assignment(mongo_replica_set_url: str):
    """Kills an erasure ignoring the id in its filter, which would take away a referee nobody asked about."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SPIELE].update_one({"_id": OTHER_SPIEL_OID}, {"$set": {"ergebnis": None}})
        await erase_the_referee(database, client)

        return await stored_spiele(database)

    spiele = on_a_league(mongo_replica_set_url, body)

    assert spiele[OTHER_SPIEL_OID]["schiedsrichter"] == {"schiedsrichter_id": OTHER_SCHIEDSRICHTER_OID, "payment": DEFAULT_PAYMENT}


def spiele_after_erasure(url: str) -> dict[Any, Mapping[str, Any]]:
    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await erase_the_referee(database, client)

        return await stored_spiele(database)

    return on_a_league(url, body)


@pytest.mark.db
def test_every_played_spiel_they_officiated_names_nobody(mongo_replica_set_url: str):
    """Kills an erasure reaching the row alone: a fixture stores its own reference.

    Both of their fixtures, so an erasure stopping at one fails here rather than passing on whichever it reached.
    """

    spiele = spiele_after_erasure(mongo_replica_set_url)

    assert [spiele[spiel_id]["schiedsrichter"] for spiel_id in SPIEL_OIDS[SCHIEDSRICHTER_OID]] == [NAMELESS_BOOKING] * 2


@pytest.mark.db
def test_a_closed_seasons_spiel_names_nobody_as_well(mongo_replica_set_url: str):
    """The archive records them too, and a referee's fan-out carries no `past` bound where a club's stops."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await an_archived_spiel(database)
        await erase_the_referee(database, client)

        return await stored_spiele(database)

    spiele = on_a_league(mongo_replica_set_url, body)

    assert spiele[ARCHIVED_SPIEL_OID]["saison_id"] == PAST_SAISON_ID, "the archived fixture was seeded into the open season"
    assert spiele[ARCHIVED_SPIEL_OID]["schiedsrichter"] == NAMELESS_BOOKING


@pytest.mark.db
def test_the_fee_the_match_agreed_survives_the_erasure(mongo_replica_set_url: str):
    """Kills an erasure that `$set`s the whole `schiedsrichter` block: `payment` records what THIS match cost and no request rewrites it."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SPIELE].update_one({"_id": PLAYED_SPIEL_OID}, {"$set": {"schiedsrichter.payment": 45}})
        await erase_the_referee(database, client)

        return await stored_spiele(database)

    spiele = on_a_league(mongo_replica_set_url, body)

    assert spiele[PLAYED_SPIEL_OID]["schiedsrichter"]["payment"] == 45
    # The fixture beside it keeps its own, so this cannot pass on an erasure copying one fee everywhere.
    assert spiele[MOVED_SPIEL_OID]["schiedsrichter"]["payment"] == DEFAULT_PAYMENT


@pytest.mark.db
def test_the_other_referee_keeps_their_contact_details(mongo_replica_set_url: str):
    """Kills a write that ignores its filter: the cases above all pass for one that empties the collection."""

    referees = after_erasure(mongo_replica_set_url)

    assert referees[OTHER_SCHIEDSRICHTER_OID]["kontakt"] == KONTAKT[OTHER_SCHIEDSRICHTER_OID]


class TestTheRetirePressKeepsTheDayItFinds:
    """Driven through the endpoint, since what keeps the day is the write's own filter (`app/core/crud.py :: set_inactive_since`)."""

    @pytest.mark.db
    def test_a_press_after_an_earlier_retirement_leaves_that_day(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SCHIEDSRICHTER].update_one(
                {"_id": SCHIEDSRICHTER_OID}, {"$set": {"inactive_since": AN_EARLIER_RETIREMENT}}
            )
            await call_retirement(database, client, today=A_LATER_PRESS)

            return await stored_referees(database)

        referees = on_a_league(mongo_replica_set_url, body)

        assert referees[SCHIEDSRICHTER_OID]["inactive_since"] == AN_EARLIER_RETIREMENT
