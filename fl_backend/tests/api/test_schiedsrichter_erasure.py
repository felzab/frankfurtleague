from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.schemas import FLSaisonRules
from app.api.schiedsrichter.admin_router import (
    delete_schiedsrichter,
    patch_schiedsrichter,
    reactivate_schiedsrichter,
)
from app.api.schiedsrichter.schemas import (
    FLPatchSchiedsrichterPayload,
)
from app.api.schiedsrichter.services import (
    build_ghost_repoint,
    build_ghost_schiedsrichter,
    compose_confirmation,
)
from app.api.spiele.schemas import (
    SONDEREREIGNIS_WITHOUT_A_RESULT,
    FLPatchSpielDataPayload,
    FLSpielListAdapter,
)
from app.api.spiele.services import BookedReferee, ResolvedReferences, find_booking_refusal
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import DocumentNotFoundError
from app.core.sentinels import GHOST_INACTIVE_SINCE, GHOST_SCHIEDSRICHTER_ID
from app.shared.folding import sign_in_identifier
from app.shared.schemas.kontakt import FLKontakt, FLKontaktPayload
from app.shared.tokens import hash_token
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import SCHIEDSRICHTER_TEXT_VERSIONS, own_einwilligung_document, rules_document, saison_document, spiel_document
from tests.erasure import erased
from tests.outbox import MAIL_NOW
from tests.payloads import spiel_patch_body
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


# Two fixtures for the erased referee, so a repoint stopping at the first row fails, and one for the
# other, so a repoint ignoring its filter fails too.
SPIEL_OIDS: dict[ObjectId, tuple[ObjectId, ...]] = {
    SCHIEDSRICHTER_OID: (ObjectId("6890a1b2c3d4e5f607800011"), ObjectId("6890a1b2c3d4e5f607800012")),
    OTHER_SCHIEDSRICHTER_OID: (ObjectId("6890a1b2c3d4e5f607800013"),),
}

# The first of their pair is emptied of its result per case and the second left as `booked_spiel_document`
# seeds it, so one league drives both halves of what the erasure does to a booking.
UNPLAYED_SPIEL_OID, PLAYED_SPIEL_OID = SPIEL_OIDS[SCHIEDSRICHTER_OID]

(OTHER_SPIEL_OID,) = SPIEL_OIDS[OTHER_SCHIEDSRICHTER_OID]

# Read off the declaration, so a member leaving that set fails here rather than leaving the case below
# asserting nothing about a cancellation.
A_CANCELLATION = SONDEREREIGNIS_WITHOUT_A_RESULT[0]

SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f6078000a1")
SAISON_ID = "2026"

PAST_SAISON_ID = "2025"
PAST_SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f6078000a2")

# Seeded per case rather than into the league below, whose repoint assertions count the fixtures each
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
    """A PLAYED fixture: a stored result is what makes it a match no reassignment can take the name off."""

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


# What every repointed fixture holds afterwards: the ghost's id, no name, and the fee this match itself agreed.
REPOINTED_BOOKING: dict[str, Any] = {"schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID, "payment": DEFAULT_PAYMENT}


async def an_archived_spiel(database: AsyncDatabase) -> None:
    """One more of their played fixtures, in a season that is CLOSED.

    The PAST row alone, `on_a_league` seeding the running one: a repoint reading a status then
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


class TestTheGhostTheSpieleAreHandedTo:
    """The row every erasure points its fixtures at, apart from a database.

    Nothing here is derived at run time: the id is fixed, the retirement makes it unbookable, and a
    name on it reaches the fixtures of everybody erased.
    """

    def test_every_contact_member_is_present_and_null(self):
        """Read off the model, so a member added later arrives null rather than missing and failing the record model."""

        assert build_ghost_schiedsrichter()["kontakt"] == dict.fromkeys(FLKontakt.model_fields)

    def test_it_carries_the_fixed_id_and_no_fee(self):
        ghost = build_ghost_schiedsrichter()

        assert ghost["_id"] == GHOST_SCHIEDSRICHTER_ID
        assert ghost["default_payment"] == 0

    def test_the_repoint_moves_the_reference_and_nothing_else(self):
        """One whole update asserted rather than membership: a repoint also clearing `payment` would rewrite what a match cost."""

        assert build_ghost_repoint() == {"$set": {"schiedsrichter.schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID}}


# A fixture the ghost does NOT hold, so a payload naming it MOVES the booking, which is the only case
# `find_booking_refusal` judges.
A_SPIEL_HELD_BY_THE_OTHER_REFEREE: dict[str, Any] = booked_spiel_document(OTHER_SCHIEDSRICHTER_OID, ARCHIVED_SPIEL_OID, 9)

THE_GHOST = BookedReferee(inactive_since=GHOST_INACTIVE_SINCE, confirmed=False)


def booking_refusal(booked: BookedReferee, schiedsrichter_id: ObjectId):
    """A NEW booking of `booked` onto a fixture that holds somebody else, judged as the fixture patch judges it."""

    payload = FLPatchSpielDataPayload(
        **spiel_patch_body(
            A_SPIEL_HELD_BY_THE_OTHER_REFEREE,
            schiedsrichter={"schiedsrichter_id": str(schiedsrichter_id), "payment": DEFAULT_PAYMENT},
        )
    )

    return find_booking_refusal(
        ARCHIVED_SPIEL_OID,
        payload,
        FLSpielListAdapter.validate_python([A_SPIEL_HELD_BY_THE_OTHER_REFEREE]),
        ResolvedReferences(teams={}, schiedsrichter=booked),
        FLSaisonRules.model_validate(rules_document()),
    )


class TestTheGhostTakesNoNewSpiel:
    """The erasure retires nobody, and `booking_unknown_resource` still holds: the ghost is retired for good.

    Driven here rather than beside the venue's cases: these pin a consequence of the erasure, where
    the refusal is one mechanism serving both references.
    """

    def test_the_ghost_is_refused_the_spiel(self):
        refusal = booking_refusal(THE_GHOST, GHOST_SCHIEDSRICHTER_ID)

        assert refusal is not None
        assert refusal.error_code == Code.BOOKING_UNKNOWN_RESOURCE


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


async def call_reactivation(database: AsyncDatabase, client: AsyncMongoClient, schiedsrichter_id: ObjectId) -> Any:
    return await reactivate_schiedsrichter(
        schiedsrichter_id=schiedsrichter_id,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        today=TODAY,
        now=MAIL_NOW,
    )


async def call_retirement(database: AsyncDatabase, client: AsyncMongoClient, *, today: str) -> None:
    """Every seeded fixture of this referee is PLAYED, so `find_referee_retire_refusal` refuses nothing and a case below fails on the date."""

    return await delete_schiedsrichter(
        schiedsrichter_id=SCHIEDSRICHTER_OID,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spiele_collection=database[Collection.SPIELE],
        db=client,
        today=today,
    )


async def one_of_their_spiele_left_to_play(database: AsyncDatabase, *, sonderereignis: str | None = None) -> None:
    """`UNPLAYED_SPIEL_OID` owing a result, `booked_spiel_document` having seeded every fixture played."""

    await database[Collection.SPIELE].update_one({"_id": UNPLAYED_SPIEL_OID}, {"$set": {"ergebnis": None, "sonderereignis": sonderereignis}})


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
def test_the_ghost_is_written_where_no_ghost_stood(mongo_replica_set_url: str):
    """Kills leaving the seed to a deploy step: a repoint onto a row nothing holds is a reference no rule and no report can resolve."""

    referees = after_erasure(mongo_replica_set_url)
    ghost = referees[GHOST_SCHIEDSRICHTER_ID]

    assert (ghost["name"], ghost["schule"]) == (None, None)
    assert ghost["inactive_since"] == GHOST_INACTIVE_SINCE


@pytest.mark.db
def test_a_second_erasure_reuses_the_one_ghost(mongo_replica_set_url: str):
    """Kills writing a fresh sentinel per run, which would leave one nameless row per erased person and refuse the second on the name index."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await erase_the_referee(database, client, SCHIEDSRICHTER_OID)
        await erase_the_referee(database, client, OTHER_SCHIEDSRICHTER_OID)

        return await stored_referees(database), await stored_spiele(database)

    referees, spiele = on_a_league(mongo_replica_set_url, body)

    assert list(referees) == [GHOST_SCHIEDSRICHTER_ID]
    assert {row["schiedsrichter"]["schiedsrichter_id"] for row in spiele.values()} == {GHOST_SCHIEDSRICHTER_ID}


@pytest.mark.db
@pytest.mark.parametrize("press", ["patch", "delete", "reactivate"])
def test_no_write_endpoint_reaches_the_ghost(mongo_replica_set_url: str, press: str):
    """A name on the ghost reaches the fixtures of everyone erased, and a reactivation makes it bookable.

    All three presses: each addresses the row through its own filter, and one missing the exclusion
    is the defect no other case shows.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await erase_the_referee(database, client)
        # One of the ghost's fixtures put back among those still to be played, which is what a
        # bracket resolution leaves: the retirement would otherwise refuse 409 before it reads the
        # row and the 404 below would never be reached.
        await database[Collection.SPIELE].update_one({"_id": UNPLAYED_SPIEL_OID}, {"$set": {"ergebnis": None}})

        with pytest.raises(DocumentNotFoundError):
            if press == "patch":
                await patch_schiedsrichter(
                    schiedsrichter_id=GHOST_SCHIEDSRICHTER_ID,
                    schiedsrichter_data=FLPatchSchiedsrichterPayload(
                        name="Nicht Der Geist",
                        schule=SCHULE,
                        default_payment=DEFAULT_PAYMENT,
                        kontakt=FLKontaktPayload(**KONTAKT[SCHIEDSRICHTER_OID]),
                        version=0,
                    ),
                    schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                    outbox_collection=database[Collection.OUTBOX],
                    db=client,
                    today=TODAY,
                    now=MAIL_NOW,
                )
            elif press == "delete":
                await delete_schiedsrichter(
                    schiedsrichter_id=GHOST_SCHIEDSRICHTER_ID,
                    schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                    spiele_collection=database[Collection.SPIELE],
                    db=client,
                    today=A_LATER_PRESS,
                )
            else:
                await call_reactivation(database, client, GHOST_SCHIEDSRICHTER_ID)

        return (await stored_referees(database))[GHOST_SCHIEDSRICHTER_ID], await stored_spiele(database)

    ghost, spiele = on_a_league(mongo_replica_set_url, body)

    assert (ghost["name"], ghost["inactive_since"]) == (None, GHOST_INACTIVE_SINCE)
    assert [spiele[spiel_id]["schiedsrichter"] for spiel_id in SPIEL_OIDS[SCHIEDSRICHTER_OID]] == [REPOINTED_BOOKING] * 2


def after_erasing_one_spiel_left_to_play(url: str) -> tuple[dict[Any, Mapping[str, Any]], dict[Any, Mapping[str, Any]]]:
    """One league holding a played fixture and an unplayed one, so the two halves are read off a single run."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await one_of_their_spiele_left_to_play(database)
        await erase_the_referee(database, client)

        return await stored_spiele(database), await stored_referees(database)

    return on_a_league(url, body)


@pytest.mark.db
def test_an_unplayed_spiel_does_not_stop_the_erasure_and_takes_the_ghost(mongo_replica_set_url: str):
    """`DELETE` owes `schiedsrichter_still_assigned` and this does not: a request to be forgotten is not something a booking may block.

    Kills consulting that refusal here, and kills leaving an erased person named on work still to come.
    """

    spiele, referees = after_erasing_one_spiel_left_to_play(mongo_replica_set_url)

    assert SCHIEDSRICHTER_OID not in referees
    # Still owing a result, so this cannot pass on an erasure that composed one instead.
    assert spiele[UNPLAYED_SPIEL_OID]["ergebnis"] is None
    assert spiele[UNPLAYED_SPIEL_OID]["schiedsrichter"] == REPOINTED_BOOKING


@pytest.mark.db
def test_the_played_spiel_beside_it_takes_the_ghost_too(mongo_replica_set_url: str):
    """Kills a repoint narrowed to what is still to be played: a match that was played records that somebody officiated it and what it cost."""

    spiele, _ = after_erasing_one_spiel_left_to_play(mongo_replica_set_url)

    assert spiele[PLAYED_SPIEL_OID]["schiedsrichter"] == REPOINTED_BOOKING


@pytest.mark.db
def test_a_cancelled_spiel_takes_the_ghost(mongo_replica_set_url: str):
    """Kills a repoint reading `ergebnis` at all: every fixture naming the person is repointed whatever state it is in."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await one_of_their_spiele_left_to_play(database, sonderereignis=A_CANCELLATION)
        await erase_the_referee(database, client)

        return await stored_spiele(database)

    spiele = on_a_league(mongo_replica_set_url, body)

    assert spiele[UNPLAYED_SPIEL_OID]["schiedsrichter"] == REPOINTED_BOOKING


@pytest.mark.db
def test_another_referees_spiel_keeps_its_assignment(mongo_replica_set_url: str):
    """Kills a repoint ignoring the id in its filter, which would hand away a referee nobody asked about."""

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
def test_every_spiel_they_officiated_is_repointed(mongo_replica_set_url: str):
    """Kills an erasure reaching the row alone: a fixture stores its own copy of the name and the reference.

    Both of their fixtures, so a repoint stopping at one fails here rather than passing on whichever
    it reached.
    """

    spiele = spiele_after_erasure(mongo_replica_set_url)

    assert [spiele[spiel_id]["schiedsrichter"] for spiel_id in SPIEL_OIDS[SCHIEDSRICHTER_OID]] == [REPOINTED_BOOKING] * 2


@pytest.mark.db
def test_a_closed_seasons_spiel_is_repointed_as_well(mongo_replica_set_url: str):
    """The archive records them too, and a referee's fan-out carries no `past` bound where a club's stops."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await an_archived_spiel(database)
        await erase_the_referee(database, client)

        return await stored_spiele(database)

    spiele = on_a_league(mongo_replica_set_url, body)

    assert spiele[ARCHIVED_SPIEL_OID]["saison_id"] == PAST_SAISON_ID, "the archived fixture was seeded into the open season"
    assert spiele[ARCHIVED_SPIEL_OID]["schiedsrichter"] == REPOINTED_BOOKING


@pytest.mark.db
def test_the_fee_the_match_agreed_survives_the_repoint(mongo_replica_set_url: str):
    """Kills a repoint that `$set`s the whole `schiedsrichter` block: `payment` records what THIS match cost and no request rewrites it."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SPIELE].update_one({"_id": PLAYED_SPIEL_OID}, {"$set": {"schiedsrichter.payment": 45}})
        await erase_the_referee(database, client)

        return await stored_spiele(database)

    spiele = on_a_league(mongo_replica_set_url, body)

    assert spiele[PLAYED_SPIEL_OID]["schiedsrichter"]["payment"] == 45
    # The fixture beside it keeps its own, so this cannot pass on a repoint copying one fee everywhere.
    assert spiele[UNPLAYED_SPIEL_OID]["schiedsrichter"]["payment"] == DEFAULT_PAYMENT


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
