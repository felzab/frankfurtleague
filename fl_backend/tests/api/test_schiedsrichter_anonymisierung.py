from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError, OperationFailure

from app.api.bewerbungen.services import hash_token
from app.api.saisons.cache import invalidate_saison_cache
from app.api.saisons.schemas import FLSaisonRules
from app.api.schiedsrichter.admin_router import (
    anonymise_schiedsrichter,
    delete_schiedsrichter,
    patch_schiedsrichter,
    reactivate_schiedsrichter,
)
from app.api.schiedsrichter.router import get_schiedsrichter, get_schiedsrichter_by_id
from app.api.schiedsrichter.schemas import (
    FLPatchSchiedsrichterPayload,
    FLSchiedsrichterFilterParams,
    FLSchiedsrichterWriteResponse,
)
from app.api.schiedsrichter.services import (
    GHOST_ERASED,
    build_booked_image_filter,
    build_ghost_repoint,
    build_ghost_schiedsrichter,
    build_unplayed_assignment_filter,
    compose_bestaetigung,
    compose_einwilligung,
    find_ghost_erasure_refusal,
    first_stamped,
)
from app.api.spiele.schemas import (
    SONDEREREIGNIS_WITHOUT_A_RESULT,
    FLPatchSpielDataPayload,
    FLSpielListAdapter,
    FLSpielSchiedsrichterField,
    FLSpielSchiedsrichterFieldPublic,
    unplayed_filter,
)
from app.api.spiele.services import BOOKING_UNKNOWN_RESOURCE, BookedReferee, ResolvedReferences, find_booking_refusal
from app.core.collections import Collection
from app.core.constraints import SUPPORT_INDEXES, UNIQUE_INDEXES
from app.core.crud import delete_many_from_db, patch_one_in_db
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
from app.core.recording import build_redaction_filter
from app.core.sentinels import GHOST_INACTIVE_SINCE, GHOST_SCHIEDSRICHTER_ID
from app.shared.schemas.kontakt import FLKontakt, FLKontaktPayload
from tests.config import build_test_config
from tests.database import a_clean_database, on_the_seed_loop
from tests.payloads import spiel_patch_body
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_schiedsrichter_anonymisierung_test")

CONFIG = build_test_config()

# Asserted on rather than caught broadly, so an unrelated failure cannot pass as a rejection.
DOCUMENT_VALIDATION_FAILED = 121

# Fixed rather than generated, so a failure names the same row every run.
SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607800001")
OTHER_SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607800002")

REFEREE_NAMES = {SCHIEDSRICHTER_OID: "Anna Körner", OTHER_SCHIEDSRICHTER_OID: "Bernd Kraus"}

SCHULE = "Carl-Schurz-Schule"
DEFAULT_PAYMENT = 20

# The pair the seeded edit replaced. It survives in one place only -- the log row that edit wrote --
# which is the copy an erasure stopping at the collection leaves standing.
FORMER_KONTAKT = {
    SCHIEDSRICHTER_OID: {"telefon": "+49 69 7654321", "email": "ak-vertretung@example.com"},
    OTHER_SCHIEDSRICHTER_OID: {"telefon": "+49 69 9998887", "email": "bk-vertretung@example.com"},
}

# What each referee holds when the erasure runs. No value here or above is shared between the two,
# so the log sweep below can attribute every hit it finds to one referee.
KONTAKT = {
    SCHIEDSRICHTER_OID: {"telefon": "+49 69 1234567", "email": "koerner.anna@example.com"},
    OTHER_SCHIEDSRICHTER_OID: {"telefon": "+49 69 2223334", "email": "kraus.bernd@example.com"},
}

# Injected through `get_germany_now`, and in summer, so the conversion below moves the clock.
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

# Written out rather than computed from `log_stamp`, which would agree with any conversion of `NOW`, including none.
REDACTED_AT = "2026-04-01T10:30:00+00:00"

# `get_german_date_str`'s answer for `NOW`, spelled out for `REDACTED_AT`'s reason.
TODAY = "2026-04-01"

# A day the endpoints here are never handed, so a stamp found unmoved cannot be one they wrote.
AN_EARLIER_RETIREMENT = "2025-11-20"

# Handed to the retire endpoint alone, and later than every other day here: a stamp that moved is
# then unmistakable rather than equal to what another write would have left.
A_LATER_PRESS = "2026-05-04"

# What the seeded fixture edit moves. The field is arbitrary; the edit is not -- it is what files a log
# row carrying the whole fixture, the referee's embedded name included.
A_RESCHEDULED_TIME = "15:00:00"

# The day the seeded links were minted, earlier than every press here, so a block found carrying it
# is the seed's rather than one a case wrote.
MINTED_ON = "2026-03-02"
GEBURTSDATUM = "1984-05-09"

TOKEN_HASHES = {oid: hash_token(f"raw-token-for-{oid}") for oid in REFEREE_NAMES}

# Read off the declaration, so renaming the index fails here rather than leaving these cases asserting nothing.
NAME_INDEX = next(index for index in UNIQUE_INDEXES if index.collection == Collection.SCHIEDSRICHTER)

# Read off the declaration rather than typed here, so renaming the index fails at its one source.
TARGET_INDEX = next(index for index in SUPPORT_INDEXES if index.collection == Collection.AKTIONEN and "document_id" in dict(index.keys))


# Two fixtures for the erased referee, so a repoint stopping at the first row fails, and one for the
# other, so a repoint ignoring its filter fails too.
SPIEL_OIDS: dict[ObjectId, tuple[ObjectId, ...]] = {
    SCHIEDSRICHTER_OID: (ObjectId("6890a1b2c3d4e5f607800011"), ObjectId("6890a1b2c3d4e5f607800012")),
    OTHER_SCHIEDSRICHTER_OID: (ObjectId("6890a1b2c3d4e5f607800013"),),
}

# The first of their pair is emptied of its result per case and the second left as `fixture_document`
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

# Read by no path here -- a referee's repoint asks no season for its status, which is what the
# archived case drives -- and required of any season row by the shipped validator.
SAISON_RULES: dict[str, Any] = {
    "win_points": 3,
    "draw_points": 1,
    "qualifiers_per_group": 2,
    "number_of_groups": 4,
    "teams_per_group": 4,
    "tiebreak_order": "tordifferenz",
    "max_kadergroesse": 18,
    "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
    "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
}


def referee_document(schiedsrichter_id: ObjectId) -> dict[str, Any]:
    """Every field the validator requires, and the referee SERVING: no retire-first precondition attaches to this endpoint."""

    return {
        "_id": schiedsrichter_id,
        "name": REFEREE_NAMES[schiedsrichter_id],
        "schule": SCHULE,
        "default_payment": DEFAULT_PAYMENT,
        "kontakt": dict(FORMER_KONTAKT[schiedsrichter_id]),
        "inactive_since": None,
        # Seeded because the erasure adds no `$set` for any of the three: a row carrying none of
        # them would let a nulling write pass every case below.
        "bestaetigung": compose_bestaetigung(token_hash=TOKEN_HASHES[schiedsrichter_id], today=MINTED_ON),
        "einwilligung": compose_einwilligung(umfang="kader_oeffentlich", medien=True, text_version="v1", today=MINTED_ON),
        "geburtsdatum": GEBURTSDATUM,
    }


def fixture_document(schiedsrichter_id: ObjectId, spiel_id: ObjectId, spiel_nr: int) -> dict[str, Any]:
    """A PLAYED fixture: a stored result is what makes it a match no reassignment can take the name off.

    Every field `app/core/constraints.py :: COLLECTION_VALIDATORS` requires of `spiele`, since this
    module seeds against the real validators.
    """

    return {
        "_id": spiel_id,
        "spiel_nr": spiel_nr,
        "saison_id": SAISON_ID,
        "saison_phase": "gruppenphase",
        "spieltag_id": SPIELTAG_OID,
        "team1": None,
        "team2": None,
        "team1_quelle": None,
        "team2_quelle": None,
        "datum": "2026-03-15",
        "uhrzeit": "14:00:00",
        "ort": None,
        "schiedsrichter": {
            "schiedsrichter_id": schiedsrichter_id,
            "name": REFEREE_NAMES[schiedsrichter_id],
            "payment": DEFAULT_PAYMENT,
        },
        "ergebnis": "2:1",
        "elfmeterschiessen": None,
        "sonderereignis": None,
    }


def fixture_documents() -> list[dict[str, Any]]:
    return [
        fixture_document(schiedsrichter_id, spiel_id, spiel_nr)
        for spiel_nr, (schiedsrichter_id, spiel_id) in enumerate(
            ((referee, spiel_id) for referee, spiel_ids in SPIEL_OIDS.items() for spiel_id in spiel_ids), start=1
        )
    ]


# What every repointed fixture holds afterwards: the ghost's id under a nulled name, and the fee this
# match itself agreed.
REPOINTED_BOOKING: dict[str, Any] = {"schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID, "name": None, "payment": DEFAULT_PAYMENT}


def saison_document(saison_id: str, status: str) -> dict[str, Any]:
    return {
        "_id": saison_id,
        "start_date": f"{saison_id}-01-01",
        "end_date": f"{saison_id}-06-30",
        "status": status,
        "rules": dict(SAISON_RULES),
    }


async def an_archived_fixture(database: AsyncDatabase) -> None:
    """One more of their played fixtures, in a season that is CLOSED.

    The PAST row alone, `on_a_league` seeding the running one: a repoint reading a status then
    finds a season rather than an empty collection.
    """

    await database[Collection.SAISONS].insert_one(saison_document(PAST_SAISON_ID, "past"))
    await database[Collection.SPIELE].insert_one(
        {
            **fixture_document(SCHIEDSRICHTER_OID, ARCHIVED_SPIEL_OID, 4),
            "saison_id": PAST_SAISON_ID,
            "spieltag_id": PAST_SPIELTAG_OID,
        }
    )


class TestTheGhostTheFixturesAreHandedTo:
    """The row every erasure points its fixtures at, apart from a database.

    Nothing here is derived at run time: the id is fixed, the retirement makes it unbookable, and a
    name on it reaches the fixtures of everybody erased.
    """

    def test_it_carries_no_name_and_no_school(self):
        ghost = build_ghost_schiedsrichter()

        assert (ghost["name"], ghost["schule"]) == (None, None)

    def test_every_contact_member_is_present_and_null(self):
        """Read off the model, so a member added later arrives null rather than missing and failing the validator."""

        assert build_ghost_schiedsrichter()["kontakt"] == dict.fromkeys(FLKontakt.model_fields)

    def test_it_is_retired(self):
        """`REQ-BOOKING-001` reads this field and nothing else, and it is the whole of what keeps the ghost off a new fixture."""

        assert build_ghost_schiedsrichter()["inactive_since"] == GHOST_INACTIVE_SINCE

    def test_it_carries_the_fixed_id_and_no_fee(self):
        ghost = build_ghost_schiedsrichter()

        assert ghost["_id"] == GHOST_SCHIEDSRICHTER_ID
        assert ghost["default_payment"] == 0

    def test_the_repoint_moves_the_reference_and_the_name_and_nothing_else(self):
        """One whole update asserted rather than membership: a repoint also clearing `payment` would rewrite what a match cost."""

        assert build_ghost_repoint() == {"$set": {"schiedsrichter.schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID, "schiedsrichter.name": None}}

    def test_a_nulled_name_reaches_the_base_tier_as_a_null_and_not_as_an_initial(self):
        """`READ-REFEREE-001`'s reduction composes a forename and an initial, and one composed from nothing would read as a name."""

        booking = {"schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID, "name": None}

        assert FLSpielSchiedsrichterFieldPublic.model_validate(booking).name is None


class TestErasingTheGhostIsRefused:
    """`REQ-ANONYMISE-004`.

    The ghost stands behind nobody, and deleting it would leave every erased referee's fixtures
    naming a row that is gone.
    """

    def test_the_ghosts_own_id_is_refused(self):
        refusal = find_ghost_erasure_refusal(schiedsrichter_id=GHOST_SCHIEDSRICHTER_ID)

        assert refusal is not None
        assert refusal.error_code == GHOST_ERASED

    def test_the_sentence_says_there_is_nothing_on_it_to_delete(self):
        """A bare 404 would read as a mistyped id, where the refusal an administrator needs is that there is no person here."""

        refusal = find_ghost_erasure_refusal(schiedsrichter_id=GHOST_SCHIEDSRICHTER_ID)

        assert refusal is not None
        assert "stands behind nobody" in refusal.message

    def test_any_other_referee_is_not(self):
        """The control: a guard refusing every id would refuse the erasure itself."""

        assert find_ghost_erasure_refusal(schiedsrichter_id=SCHIEDSRICHTER_OID) is None


class TestTheRetirementKeepsTheDayItAlreadyCarries:
    """`first_stamped` on its own, the retire endpoint being its one caller."""

    def test_a_row_retired_earlier_keeps_the_day_they_retired(self):
        """The retirement is a fact about the past: a referee retired last season and pressed again today retired last season."""

        retired_earlier = {"inactive_since": AN_EARLIER_RETIREMENT}

        assert first_stamped(stored=retired_earlier, field="inactive_since", today=TODAY) == AN_EARLIER_RETIREMENT

    def test_a_referee_still_serving_is_retired_today(self):
        """The control: a stamp reading the row unconditionally would retire nobody on the first press."""

        assert first_stamped(stored={"inactive_since": None}, field="inactive_since", today=TODAY) == TODAY


# A fixture the ghost does NOT hold, so a payload naming it MOVES the booking, which is the only case
# `find_booking_refusal` judges.
A_FIXTURE_HELD_BY_THE_OTHER_REFEREE: dict[str, Any] = fixture_document(OTHER_SCHIEDSRICHTER_OID, ARCHIVED_SPIEL_OID, 9)

THE_GHOST = BookedReferee(name=None, inactive_since=GHOST_INACTIVE_SINCE)
A_RETIRED_REFEREE = BookedReferee(name=REFEREE_NAMES[SCHIEDSRICHTER_OID], inactive_since=AN_EARLIER_RETIREMENT)


def booking_refusal(booked: BookedReferee, schiedsrichter_id: ObjectId):
    """A NEW booking of `booked` onto a fixture that holds somebody else, judged as the fixture patch judges it."""

    payload = FLPatchSpielDataPayload(
        **spiel_patch_body(
            A_FIXTURE_HELD_BY_THE_OTHER_REFEREE,
            schiedsrichter={"schiedsrichter_id": str(schiedsrichter_id), "payment": DEFAULT_PAYMENT},
        )
    )

    return find_booking_refusal(
        ARCHIVED_SPIEL_OID,
        payload,
        FLSpielListAdapter.validate_python([A_FIXTURE_HELD_BY_THE_OTHER_REFEREE]),
        ResolvedReferences(teams={}, schiedsrichter=booked),
        FLSaisonRules.model_validate(SAISON_RULES),
    )


class TestTheGhostTakesNoNewFixture:
    """The erasure retires nobody, and `REQ-BOOKING-001` still holds: the ghost is retired for good.

    Driven here rather than beside the venue's cases: these pin a consequence of the erasure, where
    the refusal is one mechanism serving both references.
    """

    def test_the_ghost_is_refused_the_fixture(self):
        refusal = booking_refusal(THE_GHOST, GHOST_SCHIEDSRICHTER_ID)

        assert refusal is not None
        assert refusal.error_code == BOOKING_UNKNOWN_RESOURCE

    def test_the_refusal_names_no_null_where_there_is_no_name(self):
        """The message interpolates the row's name, so a nameless row would read „Schiedsrichter None retired on ...“."""

        refusal = booking_refusal(THE_GHOST, GHOST_SCHIEDSRICHTER_ID)

        assert refusal is not None
        assert "None" not in refusal.message, refusal.message

    def test_the_refusal_offers_the_ghost_no_reactivation(self):
        """The reactivation endpoint answers 404 for this id, so naming it here sends an administrator nowhere."""

        refusal = booking_refusal(THE_GHOST, GHOST_SCHIEDSRICHTER_ID)

        assert refusal is not None
        assert "reactivate" not in refusal.message

    def test_an_ordinarily_retired_referee_is_still_told_to_reactivate_them(self):
        """The control on the case above: a message that dropped the route back for every retired row would pass it."""

        refusal = booking_refusal(A_RETIRED_REFEREE, SCHIEDSRICHTER_OID)

        assert refusal is not None
        assert REFEREE_NAMES[SCHIEDSRICHTER_OID] in refusal.message
        assert "reactivate it or pick another" in refusal.message


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


async def a_referee_with_a_history(database: AsyncDatabase, client: AsyncMongoClient, schiedsrichter_id: ObjectId) -> None:
    """Details EDITED through the real endpoint, which leaves the log holding the pair the edit replaced.

    Without the edit the log would hold no contact value at all and every assertion below would pass
    vacuously.
    """

    await patch_schiedsrichter(
        schiedsrichter_id=schiedsrichter_id,
        schiedsrichter_data=FLPatchSchiedsrichterPayload(
            name=REFEREE_NAMES[schiedsrichter_id],
            schule=SCHULE,
            default_payment=DEFAULT_PAYMENT,
            kontakt=FLKontaktPayload(**KONTAKT[schiedsrichter_id]),
        ),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spiele_collection=database[Collection.SPIELE],
        sperrliste_collection=database[Collection.SPERRLISTE],
        saisons_collection=database[Collection.SAISONS],
        db=client,
        config=CONFIG,
        today=TODAY,
    )


async def a_fixture_with_a_history(database: AsyncDatabase, spiel_id: ObjectId) -> None:
    """One edit to a fixture, through the recording helper the editor's own save uses.

    Its image carries the referee's embedded name under the FIXTURE's id. Without it the log names no
    fixture and the sweeps below pass vacuously.
    """

    await patch_one_in_db(
        collection=database[Collection.SPIELE],
        db_filter={"_id": spiel_id},
        update={"$set": {"uhrzeit": A_RESCHEDULED_TIME}},
        return_document=ReturnDocument.BEFORE,
    )


def on_a_league(url: str, body: Body, *, mutates_schema: bool = False) -> Any:
    """The REAL validators and support indexes, so a namespace a transaction cannot create is there.

    `mutates_schema=True` where the body narrows one of those validators (`tests/database.py :: a_clean_database`).
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
            # The season cache is PROCESS-WIDE and outlives a clean database, so the seeded save
            # would otherwise judge the ban list against a season a sibling left cached. Dropped on
            # both sides: this case reads none of another's, and leaves none.
            invalidate_saison_cache()

            try:
                # A referee save carrying an address reads the running season, the ban list being
                # judged against it, so a league with none would 404 in the seed rather than in a case.
                await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active"))
                await database[Collection.SCHIEDSRICHTER].insert_many([referee_document(oid) for oid in REFEREE_NAMES])
                await database[Collection.SPIELE].insert_many(fixture_documents())
                for oid in REFEREE_NAMES:
                    await a_referee_with_a_history(database, client, oid)
                for spiel_id in (spiel_id for spiel_ids in SPIEL_OIDS.values() for spiel_id in spiel_ids):
                    await a_fixture_with_a_history(database, spiel_id)

                return await body(database, client)
            finally:
                invalidate_saison_cache()

    return on_the_seed_loop(_run())


async def call_anonymisation(
    database: AsyncDatabase, client: AsyncMongoClient, schiedsrichter_id: ObjectId = SCHIEDSRICHTER_OID
) -> FLSchiedsrichterWriteResponse:
    return await anonymise_schiedsrichter(
        schiedsrichter_id=schiedsrichter_id,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spiele_collection=database[Collection.SPIELE],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        germany_now=NOW,
    )


async def call_retirement(database: AsyncDatabase, client: AsyncMongoClient, *, today: str) -> FLSchiedsrichterWriteResponse:
    """Every seeded fixture of this referee is PLAYED, so `find_referee_retire_refusal` refuses nothing and a case below fails on the date."""

    return await delete_schiedsrichter(
        schiedsrichter_id=SCHIEDSRICHTER_OID,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spiele_collection=database[Collection.SPIELE],
        db=client,
        today=today,
    )


async def one_of_their_fixtures_left_to_play(database: AsyncDatabase, *, sonderereignis: str | None = None) -> None:
    """`UNPLAYED_SPIEL_OID` owing a result, `fixture_document` having seeded every fixture played."""

    await database[Collection.SPIELE].update_one({"_id": UNPLAYED_SPIEL_OID}, {"$set": {"ergebnis": None, "sonderereignis": sonderereignis}})


async def a_validator_refusing_the_redaction(database: AsyncDatabase) -> None:
    """Narrow enough to refuse the redaction's `$set`, wide enough to admit every row recorded with `redacted_at` null."""

    await database.command(
        "collMod",
        Collection.AKTIONEN.value,
        validator={"$jsonSchema": {"bsonType": "object", "properties": {"redacted_at": {"bsonType": "null"}}}},
        validationLevel="strict",
    )


async def stored_fixtures(database: AsyncDatabase) -> dict[Any, Mapping[str, Any]]:
    """Keyed by `_id`, so a failing assertion names the fixture rather than a list position."""

    return {row["_id"]: row for row in await database[Collection.SPIELE].find().to_list(length=None)}


async def stored_referees(database: AsyncDatabase) -> dict[Any, Mapping[str, Any]]:
    """Keyed by `_id`, so a failing assertion names the referee rather than a list position."""

    return {row["_id"]: row for row in await database[Collection.SCHIEDSRICHTER].find().to_list(length=None)}


async def log_rows_naming(database: AsyncDatabase, schiedsrichter_id: ObjectId) -> list[Mapping[str, Any]]:
    """Every log row about this referee, spelled out here rather than taken from the endpoint's own filter.

    A wrong filter in the endpoint cannot then make these assertions agree with it.
    """

    rows = database[Collection.AKTIONEN].find({"collection": str(Collection.SCHIEDSRICHTER), "document_id": schiedsrichter_id})

    return await rows.to_list(length=None)


def index_names(plan: Any) -> set[str]:
    """Every `indexName` at any depth of an explain plan: the tree's shape differs by engine and version."""

    found: set[str] = set()

    if isinstance(plan, Mapping):
        if "indexName" in plan:
            found.add(str(plan["indexName"]))
        for value in plan.values():
            found |= index_names(value)
    elif isinstance(plan, list):
        for item in plan:
            found |= index_names(item)

    return found


def after_anonymising(url: str) -> tuple[FLSchiedsrichterWriteResponse, dict[Any, Mapping[str, Any]], list[Mapping[str, Any]]]:
    """The echo, the whole collection and the whole log together: one seeded database serves all three."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        response = await call_anonymisation(database, client)
        log = await database[Collection.AKTIONEN].find().sort("_id", 1).to_list(length=None)

        return response, await stored_referees(database), log

    return on_a_league(url, body)


@pytest.mark.db
def test_the_referees_document_is_gone(mongo_replica_set_url: str):
    """The case the endpoint exists for. Kills nulling the row in place, and a transaction that never commits."""

    _, referees, _ = after_anonymising(mongo_replica_set_url)

    assert SCHIEDSRICHTER_OID not in referees
    # The control, without which emptying the whole collection would pass.
    assert referees[OTHER_SCHIEDSRICHTER_OID]["name"] == REFEREE_NAMES[OTHER_SCHIEDSRICHTER_OID]


@pytest.mark.db
def test_the_ghost_is_written_where_no_ghost_stood(mongo_replica_set_url: str):
    """Kills leaving the seed to a deploy step: a repoint onto a row nothing holds is a reference no rule and no report can resolve."""

    _, referees, _ = after_anonymising(mongo_replica_set_url)
    ghost = referees[GHOST_SCHIEDSRICHTER_ID]

    assert (ghost["name"], ghost["schule"]) == (None, None)
    assert ghost["inactive_since"] == GHOST_INACTIVE_SINCE


@pytest.mark.db
def test_a_second_erasure_reuses_the_one_ghost(mongo_replica_set_url: str):
    """Kills writing a fresh sentinel per run, which would leave one nameless row per erased person and refuse the second on the name index."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await call_anonymisation(database, client, SCHIEDSRICHTER_OID)
        await call_anonymisation(database, client, OTHER_SCHIEDSRICHTER_OID)

        return await stored_referees(database), await stored_fixtures(database)

    referees, fixtures = on_a_league(mongo_replica_set_url, body)

    assert list(referees) == [GHOST_SCHIEDSRICHTER_ID]
    assert {row["schiedsrichter"]["schiedsrichter_id"] for row in fixtures.values()} == {GHOST_SCHIEDSRICHTER_ID}


@pytest.mark.db
def test_the_echo_carries_the_ghost_rather_than_the_person(mongo_replica_set_url: str):
    """Kills answering with the pre-image, which would serve the name and the contact details this call exists to destroy."""

    response, _, _ = after_anonymising(mongo_replica_set_url)
    echoed = response.updated_document

    assert echoed.id == GHOST_SCHIEDSRICHTER_ID
    assert (echoed.name, echoed.schule) == (None, None)
    assert (echoed.kontakt.telefon, echoed.kontakt.email) == (None, None)


async def listed_ids(database: AsyncDatabase) -> list[ObjectId]:
    """Read by id: the ghost has no name to find a row under.

    `include_inactive` is on, which is what makes these cases about the ghost rather than about the
    retirement beside it.
    """

    answered = await get_schiedsrichter(
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        filters=FLSchiedsrichterFilterParams(include_inactive=True),
    )

    return [row.id for row in answered.schiedsrichter]


@pytest.mark.db
def test_the_ghost_is_off_the_list_an_administrator_works_from(mongo_replica_set_url: str):
    """The ghost can be booked, edited or reactivated by nobody, and the list offers what can be acted on.

    Kills serving it anyway: a permanent nameless line in the list an administrator scans for somebody to book.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await call_anonymisation(database, client)

        return await listed_ids(database)

    working_list = on_a_league(mongo_replica_set_url, body)

    assert GHOST_SCHIEDSRICHTER_ID not in working_list
    # The control: a read narrowed to nothing satisfies the line above without excluding anything.
    assert OTHER_SCHIEDSRICHTER_OID in working_list


@pytest.mark.db
def test_the_single_read_answers_for_neither_the_erased_referee_nor_the_ghost(mongo_replica_set_url: str):
    """Kills a by-id read that still serves the ghost, whose page would be a referee nobody can act on.

    Both ids in one case, the answer being the same 404 for the same reason: neither names a person.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await call_anonymisation(database, client)

        answers = []
        for schiedsrichter_id in (SCHIEDSRICHTER_OID, GHOST_SCHIEDSRICHTER_ID):
            try:
                await get_schiedsrichter_by_id(
                    schiedsrichter_id=schiedsrichter_id,
                    schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                )
                answers.append("answered")
            except DocumentNotFoundException:
                answers.append("not found")

        return answers

    assert on_a_league(mongo_replica_set_url, body) == ["not found", "not found"]


@pytest.mark.db
def test_erasing_the_ghost_is_refused_at_the_endpoint(mongo_replica_set_url: str):
    """Kills a guard the router never consults: the ghost would be deleted and every fixture already repointed left naming nothing."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await call_anonymisation(database, client)

        with pytest.raises(DocumentConflictException) as refused:
            await call_anonymisation(database, client, GHOST_SCHIEDSRICHTER_ID)

        return refused.value.error_code, await stored_referees(database)

    code, referees = on_a_league(mongo_replica_set_url, body)

    assert code == GHOST_ERASED
    assert GHOST_SCHIEDSRICHTER_ID in referees


@pytest.mark.db
def test_an_id_already_erased_answers_not_found(mongo_replica_set_url: str):
    """Kills an erasure that repoints and deletes for an id holding nothing, which would file a log row about nobody."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await call_anonymisation(database, client)

        with pytest.raises(DocumentNotFoundException):
            await call_anonymisation(database, client)

        return "not found"

    assert on_a_league(mongo_replica_set_url, body) == "not found"


@pytest.mark.db
@pytest.mark.parametrize("press", ["patch", "delete", "reactivate"])
def test_no_write_endpoint_reaches_the_ghost(mongo_replica_set_url: str, press: str):
    """A name on the ghost reaches the fixtures of everyone erased, and a reactivation makes it bookable.

    All three presses: each addresses the row through its own filter, and one missing the exclusion
    is the defect no other case shows.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await call_anonymisation(database, client)
        # One of the ghost's fixtures put back among those still to be played, which is what a
        # bracket resolution leaves: the retirement would otherwise refuse 409 before it reads the
        # row and the 404 below would never be reached.
        await database[Collection.SPIELE].update_one({"_id": UNPLAYED_SPIEL_OID}, {"$set": {"ergebnis": None}})

        with pytest.raises(DocumentNotFoundException):
            if press == "patch":
                await patch_schiedsrichter(
                    schiedsrichter_id=GHOST_SCHIEDSRICHTER_ID,
                    schiedsrichter_data=FLPatchSchiedsrichterPayload(
                        name="Nicht Der Geist",
                        schule=SCHULE,
                        default_payment=DEFAULT_PAYMENT,
                        kontakt=FLKontaktPayload(**KONTAKT[SCHIEDSRICHTER_OID]),
                    ),
                    schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                    spiele_collection=database[Collection.SPIELE],
                    sperrliste_collection=database[Collection.SPERRLISTE],
                    saisons_collection=database[Collection.SAISONS],
                    db=client,
                    config=CONFIG,
                    today=TODAY,
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
                await reactivate_schiedsrichter(
                    schiedsrichter_id=GHOST_SCHIEDSRICHTER_ID,
                    schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                )

        return (await stored_referees(database))[GHOST_SCHIEDSRICHTER_ID], await stored_fixtures(database)

    ghost, fixtures = on_a_league(mongo_replica_set_url, body)

    assert (ghost["name"], ghost["inactive_since"]) == (None, GHOST_INACTIVE_SINCE)
    assert [fixtures[spiel_id]["schiedsrichter"]["name"] for spiel_id in SPIEL_OIDS[SCHIEDSRICHTER_OID]] == [None] * 2


@pytest.mark.db
def test_an_ordinary_retired_referee_is_still_brought_back(mongo_replica_set_url: str):
    """The control on the case above: a by-id filter matching nothing would pass it and strand every retired referee.

    Written for the reactivation alone; the edit and the retirement are driven by the seed and by
    `TestTheRetirePressKeepsTheDayItFinds`.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SCHIEDSRICHTER].update_one(
            {"_id": OTHER_SCHIEDSRICHTER_OID}, {"$set": {"inactive_since": AN_EARLIER_RETIREMENT}}
        )
        response = await reactivate_schiedsrichter(
            schiedsrichter_id=OTHER_SCHIEDSRICHTER_OID, schiedsrichter_collection=database[Collection.SCHIEDSRICHTER]
        )

        return response.updated_document.inactive_since

    assert on_a_league(mongo_replica_set_url, body) is None


def after_anonymising_one_fixture_left_to_play(url: str) -> tuple[dict[Any, Mapping[str, Any]], dict[Any, Mapping[str, Any]]]:
    """One league holding a played fixture and an unplayed one, so the two halves are read off a single run."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await one_of_their_fixtures_left_to_play(database)
        await call_anonymisation(database, client)

        return await stored_fixtures(database), await stored_referees(database)

    return on_a_league(url, body)


@pytest.mark.db
def test_an_unplayed_fixture_does_not_stop_the_erasure_and_takes_the_ghost(mongo_replica_set_url: str):
    """`DELETE` owes `REQ-RETIRE-004` and this does not: a request to be forgotten is not something a booking may block.

    Kills consulting that refusal here, and kills leaving an erased person named on work still to come.
    """

    fixtures, referees = after_anonymising_one_fixture_left_to_play(mongo_replica_set_url)

    assert SCHIEDSRICHTER_OID not in referees
    # Still owing a result, so this cannot pass on an erasure that composed one instead.
    assert fixtures[UNPLAYED_SPIEL_OID]["ergebnis"] is None
    assert fixtures[UNPLAYED_SPIEL_OID]["schiedsrichter"] == REPOINTED_BOOKING


@pytest.mark.db
def test_the_played_fixture_beside_it_takes_the_ghost_too(mongo_replica_set_url: str):
    """Kills a repoint narrowed to what is still to be played: a match that was played records that somebody officiated it and what it cost."""

    fixtures, _ = after_anonymising_one_fixture_left_to_play(mongo_replica_set_url)

    assert fixtures[PLAYED_SPIEL_OID]["schiedsrichter"] == REPOINTED_BOOKING


@pytest.mark.db
def test_a_cancelled_fixture_takes_the_ghost(mongo_replica_set_url: str):
    """Kills a repoint reading `ergebnis` at all: every fixture naming the person is repointed whatever state it is in."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await one_of_their_fixtures_left_to_play(database, sonderereignis=A_CANCELLATION)
        await call_anonymisation(database, client)

        return await stored_fixtures(database)

    fixtures = on_a_league(mongo_replica_set_url, body)

    assert fixtures[UNPLAYED_SPIEL_OID]["schiedsrichter"] == REPOINTED_BOOKING


@pytest.mark.db
def test_another_referees_fixture_keeps_its_assignment(mongo_replica_set_url: str):
    """Kills a repoint ignoring the id in its filter, which would hand away a referee nobody asked about."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SPIELE].update_one({"_id": OTHER_SPIEL_OID}, {"$set": {"ergebnis": None}})
        await call_anonymisation(database, client)

        return await stored_fixtures(database)

    fixtures = on_a_league(mongo_replica_set_url, body)

    assert fixtures[OTHER_SPIEL_OID]["schiedsrichter"] == {
        "schiedsrichter_id": OTHER_SCHIEDSRICHTER_OID,
        "name": REFEREE_NAMES[OTHER_SCHIEDSRICHTER_OID],
        "payment": DEFAULT_PAYMENT,
    }


def fixtures_after_anonymising(url: str) -> dict[Any, Mapping[str, Any]]:
    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await call_anonymisation(database, client)

        return await stored_fixtures(database)

    return on_a_league(url, body)


@pytest.mark.db
def test_every_fixture_they_officiated_is_repointed(mongo_replica_set_url: str):
    """Kills an erasure reaching the row alone: a fixture stores its own copy of the name and the reference.

    Both of their fixtures, so a repoint stopping at one fails here rather than passing on whichever
    it reached.
    """

    fixtures = fixtures_after_anonymising(mongo_replica_set_url)

    assert [fixtures[spiel_id]["schiedsrichter"] for spiel_id in SPIEL_OIDS[SCHIEDSRICHTER_OID]] == [REPOINTED_BOOKING] * 2


@pytest.mark.db
def test_a_closed_seasons_fixture_is_repointed_as_well(mongo_replica_set_url: str):
    """The archive records them too, and a referee's fan-out carries no `past` bound where a club's stops (`docs/backend/spec.md :: I13`)."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await an_archived_fixture(database)
        await call_anonymisation(database, client)

        return await stored_fixtures(database)

    fixtures = on_a_league(mongo_replica_set_url, body)

    assert fixtures[ARCHIVED_SPIEL_OID]["saison_id"] == PAST_SAISON_ID, "the archived fixture was seeded into the open season"
    assert fixtures[ARCHIVED_SPIEL_OID]["schiedsrichter"] == REPOINTED_BOOKING


@pytest.mark.db
def test_the_fee_the_match_agreed_survives_the_repoint(mongo_replica_set_url: str):
    """Kills a repoint that `$set`s the whole `schiedsrichter` block: `payment` records what THIS match cost and no request rewrites it."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SPIELE].update_one({"_id": PLAYED_SPIEL_OID}, {"$set": {"schiedsrichter.payment": 45}})
        await call_anonymisation(database, client)

        return await stored_fixtures(database)

    fixtures = on_a_league(mongo_replica_set_url, body)

    assert fixtures[PLAYED_SPIEL_OID]["schiedsrichter"]["payment"] == 45
    # The fixture beside it keeps its own, so this cannot pass on a repoint copying one fee everywhere.
    assert fixtures[UNPLAYED_SPIEL_OID]["schiedsrichter"]["payment"] == DEFAULT_PAYMENT


@pytest.mark.db
def test_the_written_fixture_is_read_back_by_both_tiers_rather_than_refused(mongo_replica_set_url: str):
    """A read model refusing what the erasure stored would answer 500 for a whole season's fixture list over one repointed booking.

    Both models, because the base tier reduces the surname where the admin tier serves it whole.
    """

    fixtures = fixtures_after_anonymising(mongo_replica_set_url)
    booking = fixtures[PLAYED_SPIEL_OID]["schiedsrichter"]

    assert FLSpielSchiedsrichterFieldPublic.model_validate(booking).name is None
    assert FLSpielSchiedsrichterField.model_validate(booking).name is None


@pytest.mark.db
def test_the_other_referee_keeps_their_contact_details(mongo_replica_set_url: str):
    """Kills a write that ignores its filter: the cases above all pass for one that empties the collection."""

    _, referees, _ = after_anonymising(mongo_replica_set_url)

    assert referees[OTHER_SCHIEDSRICHTER_OID]["kontakt"] == KONTAKT[OTHER_SCHIEDSRICHTER_OID]


@pytest.mark.db
def test_the_removal_files_no_image_of_the_person(mongo_replica_set_url: str):
    """Kills `delete_many_from_db` in the erasure's place: it keeps every image, so the row recording the deletion would hold the whole person.

    The row is identified as the one this call added, so no ordering of the log can hide it.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        seeded = {row["_id"] for row in await log_rows_naming(database, SCHIEDSRICHTER_OID)}
        await call_anonymisation(database, client)
        rows = database[Collection.AKTIONEN].find({"collection": str(Collection.SCHIEDSRICHTER), "operation": "erase_many"})

        return seeded, await rows.to_list(length=None)

    seeded, removals = on_a_league(mongo_replica_set_url, body)

    assert seeded, "the seeded history left no row to tell the new one from"
    assert len(removals) == 1, f"the erasure filed no removal row of its own: {removals}"
    assert removals[0]["before"] is None
    # The log stores a filter's values as TEXT, which is why the erasure's filter may name ids alone
    # (`app/core/crud.py :: erase_many_from_db`).
    assert removals[0]["db_filter"] == {"_id": str(SCHIEDSRICHTER_OID)}


@pytest.mark.db
def test_every_log_row_naming_them_is_emptied_and_stamped(mongo_replica_set_url: str):
    """Kills dropping the redaction, one that stamps without clearing, and one that clears without stamping."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        seeded = await log_rows_naming(database, SCHIEDSRICHTER_OID)
        await call_anonymisation(database, client)

        return seeded, await log_rows_naming(database, SCHIEDSRICHTER_OID)

    seeded, rows = on_a_league(mongo_replica_set_url, body)

    # The pre-state, without which a filter matching nothing would pass.
    assert [row for row in seeded if row["before"] is not None], "the seeded log held no image to redact"
    assert all(row["before"] is None for row in rows)
    assert {row["redacted_at"] for row in rows} == {REDACTED_AT}


@pytest.mark.db
def test_no_value_of_theirs_survives_anywhere_in_the_log(mongo_replica_set_url: str):
    """Kills a redaction narrowed to some of their rows.

    The NAME is in the set because a fixture's image carries it under that fixture's id. The other
    referee's values are asserted present, or a log emptied wholesale would pass.
    """

    _, _, log = after_anonymising(mongo_replica_set_url)
    rendered = str(log)
    theirs = (REFEREE_NAMES[SCHIEDSRICHTER_OID], *FORMER_KONTAKT[SCHIEDSRICHTER_OID].values(), *KONTAKT[SCHIEDSRICHTER_OID].values())

    assert [value for value in theirs if value in rendered] == []
    # Their replaced pair, not their live one: only what an edit replaced is ever in the log at all.
    assert FORMER_KONTAKT[OTHER_SCHIEDSRICHTER_OID]["telefon"] in rendered
    assert REFEREE_NAMES[OTHER_SCHIEDSRICHTER_OID] in rendered


async def fixture_log_rows(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    """Every log row naming ONE fixture, the repoint's own row excluded: that one carries a count and names no document."""

    rows = database[Collection.AKTIONEN].find({"collection": str(Collection.SPIELE), "document_id": {"$ne": None}})

    return await rows.to_list(length=None)


@pytest.mark.db
def test_every_fixture_image_holding_their_name_is_emptied_and_stamped(mongo_replica_set_url: str):
    """Kills a redaction reaching the referee's own rows alone.

    `build_redaction_filter`'s `(collection, document_id)` selection cannot reach these: a fixture's
    image is filed under the FIXTURE's id, and the name inside it is a copy the erasure has to follow.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        seeded = await fixture_log_rows(database)
        await call_anonymisation(database, client)

        return seeded, await fixture_log_rows(database)

    seeded, rows = on_a_league(mongo_replica_set_url, body)

    assert [row for row in seeded if row["before"] is not None], "the seeded log held no fixture image to redact"

    theirs = [row for row in rows if row["document_id"] in SPIEL_OIDS[SCHIEDSRICHTER_OID]]
    assert len(theirs) == len(SPIEL_OIDS[SCHIEDSRICHTER_OID]), "a fixture of theirs filed no log row at all"
    assert all(row["before"] is None for row in theirs)
    assert {row["redacted_at"] for row in theirs} == {REDACTED_AT}

    # The control: a sweep over every fixture row would empty this one too.
    (other,) = [row for row in rows if row["document_id"] in SPIEL_OIDS[OTHER_SCHIEDSRICHTER_OID]]
    assert other["before"] is not None
    assert other["redacted_at"] is None


@pytest.mark.db
def test_an_image_of_a_fixture_since_reassigned_is_emptied_too(mongo_replica_set_url: str):
    """The row no id can name: this fixture books somebody else now, so nothing the erasure reads still points at it.

    Kills a redaction selecting the fixtures they hold TODAY, which the case above passes for.
    """

    reassigned = UNPLAYED_SPIEL_OID

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        # Through the recording helper, so the image this files is the one a real reassignment leaves.
        await patch_one_in_db(
            collection=database[Collection.SPIELE],
            db_filter={"_id": reassigned},
            update={
                "$set": {
                    "schiedsrichter": {
                        "schiedsrichter_id": OTHER_SCHIEDSRICHTER_OID,
                        "name": REFEREE_NAMES[OTHER_SCHIEDSRICHTER_OID],
                        "payment": DEFAULT_PAYMENT,
                    }
                }
            },
            return_document=ReturnDocument.BEFORE,
        )
        await call_anonymisation(database, client)

        return [row for row in await fixture_log_rows(database) if row["document_id"] == reassigned]

    rows = on_a_league(mongo_replica_set_url, body)

    # Two: the seeded reschedule and the reassignment, both filed before the erasure ran.
    assert len(rows) == 2, f"the reassignment filed no row of its own: {rows}"
    assert all(row["before"] is None for row in rows)
    assert {row["redacted_at"] for row in rows} == {REDACTED_AT}


@pytest.mark.db
def test_the_array_image_a_removal_files_is_emptied_too(mongo_replica_set_url: str):
    """An undraw removes a season's fixtures and keeps every image in ONE row, `document_id` an array.

    Kills a filter reading `before` as a single document (`docs/backend/spec.md :: I48`).
    """

    removed = SPIEL_OIDS[SCHIEDSRICHTER_OID]

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        # Through the helper the undraw uses, which is what files the array rather than one row each.
        async with client.start_session() as session:
            await delete_many_from_db(collection=database[Collection.SPIELE], db_filter={"_id": {"$in": list(removed)}}, session=session)
        await call_anonymisation(database, client)

        rows = database[Collection.AKTIONEN].find({"collection": str(Collection.SPIELE), "operation": "delete_many"})

        return await rows.to_list(length=None)

    (row,) = on_a_league(mongo_replica_set_url, body)

    assert sorted(row["document_id"]) == sorted(removed), "the removal filed no array of the ids it took"
    assert row["before"] is None
    assert row["redacted_at"] == REDACTED_AT


def test_the_two_seasons_this_suite_seeds_are_two_rows():
    """`on_a_league` writes the running season and `an_archived_fixture` the closed one.

    A floor rather than the whole guard: one id for both is a duplicate `_id`, and the database
    tier is where mongod answers `E11000` for it.
    """

    assert SAISON_ID != PAST_SAISON_ID
    assert saison_document(SAISON_ID, "active")["status"] == "active"
    assert saison_document(PAST_SAISON_ID, "past")["status"] == "past"


def test_the_unplayed_assignment_filter_spells_the_definition_once():
    """The retirement's refusal reads this one filter, composed from the path the erasure's own repoint asks for."""

    assert build_unplayed_assignment_filter(SCHIEDSRICHTER_OID) == {"schiedsrichter.schiedsrichter_id": SCHIEDSRICHTER_OID, **unplayed_filter()}


def test_the_fixture_image_filter_names_the_collection_it_reads():
    """Nothing indexes inside `before`, so this filter is a scan narrowed by `collection` and by nothing else.

    Pinned because widening it to every collection would sweep the whole log on every erasure.
    """

    assert build_booked_image_filter(SCHIEDSRICHTER_OID) == {
        "collection": str(Collection.SPIELE),
        "before.schiedsrichter.schiedsrichter_id": SCHIEDSRICHTER_OID,
    }


@pytest.mark.db
def test_the_other_referees_log_rows_keep_their_images(mongo_replica_set_url: str):
    """Kills a filter matching on `collection` alone, which would empty every referee's rows at once."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await call_anonymisation(database, client)

        return await log_rows_naming(database, OTHER_SCHIEDSRICHTER_OID)

    rows = on_a_league(mongo_replica_set_url, body)

    assert [row for row in rows if row["before"] is not None], "the other referee's log rows were emptied too"
    assert all(row["redacted_at"] is None for row in rows)


@pytest.mark.db
def test_the_redaction_writes_no_row_of_its_own(mongo_replica_set_url: str):
    """Kills removing `record_write`'s early return on the log: the redaction would record a copy of what it cleared.

    None of the rows the erasure adds names the log at all.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        before_count = await database[Collection.AKTIONEN].count_documents({})
        await call_anonymisation(database, client)

        return (
            before_count,
            await database[Collection.AKTIONEN].count_documents({}),
            await database[Collection.AKTIONEN].count_documents({"collection": str(Collection.AKTIONEN)}),
        )

    before_count, after_count, self_recorded = on_a_league(mongo_replica_set_url, body)

    # The ghost's insert, the fixtures' repoint and the removal; the two redaction passes record nothing.
    assert after_count == before_count + 3
    assert self_recorded == 0


@pytest.mark.db
def test_the_redaction_filter_reads_the_target_index(mongo_replica_set_url: str):
    """Kills a filter shape that scans: the log holds a year of recorded writes, so a scan reads every one of them."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        plan = await database.command(
            "explain",
            {
                "find": Collection.AKTIONEN.value,
                "filter": build_redaction_filter([(Collection.SCHIEDSRICHTER, [SCHIEDSRICHTER_OID])]),
            },
            verbosity="queryPlanner",
        )

        return plan["queryPlanner"]["winningPlan"]

    winning = on_a_league(mongo_replica_set_url, body)

    assert index_names(winning) == {TARGET_INDEX.name}, f"the redaction filter did not reach `{TARGET_INDEX.name}`: {winning}"


@pytest.mark.db
def test_a_refused_redaction_takes_the_removal_back(mongo_replica_set_url: str):
    """Kills running the writes outside one transaction, and dropping the session from any of them.

    A `$jsonSchema` refusing a stamped row fails the LAST write, once the row is already deleted.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await a_validator_refusing_the_redaction(database)

        with pytest.raises(OperationFailure) as failure:
            await call_anonymisation(database, client)

        return failure.value.code, await stored_referees(database), await log_rows_naming(database, SCHIEDSRICHTER_OID)

    code, referees, rows = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

    # Asserted on the code, so this cannot pass because something else failed before any write.
    assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the redaction, got code {code}"
    assert referees[SCHIEDSRICHTER_OID]["kontakt"] == KONTAKT[SCHIEDSRICHTER_OID], "the removal outlived a redaction that failed"
    assert GHOST_SCHIEDSRICHTER_ID not in referees, "the ghost outlived a transaction that never committed"
    assert [row for row in rows if row["before"] is not None], "the log lost its image to a transaction that never committed"
    assert all(row["redacted_at"] is None for row in rows)


@pytest.mark.db
def test_a_refused_redaction_takes_the_repoint_back(mongo_replica_set_url: str):
    """Kills dropping the session from the repoint: a run that failed would leave a match naming a referee whose row still stands."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await a_validator_refusing_the_redaction(database)

        with pytest.raises(OperationFailure) as failure:
            await call_anonymisation(database, client)

        return failure.value.code, await stored_fixtures(database)

    code, fixtures = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

    assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the redaction, got code {code}"
    assert fixtures[PLAYED_SPIEL_OID]["schiedsrichter"] == {
        "schiedsrichter_id": SCHIEDSRICHTER_OID,
        "name": REFEREE_NAMES[SCHIEDSRICHTER_OID],
        "payment": DEFAULT_PAYMENT,
    }


class TestTheNameRuleReachesEveryRow:
    """The widened `uniq_schiedsrichter_name`: an erasure deletes rather than nulls, so the one null name it can ever meet is the ghost's."""

    @pytest.mark.db
    def test_the_index_is_built_over_every_row(self, mongo_replica_set_url: str):
        """Kills a partial filter left behind, which would index a subset and let a second nameless row in beside the ghost."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return {row["name"]: row.get("partialFilterExpression") async for row in await database[Collection.SCHIEDSRICHTER].list_indexes()}

        built = on_a_league(mongo_replica_set_url, body)

        assert NAME_INDEX.name in built, f"the name rule is not built at all: {sorted(built)}"
        assert built[NAME_INDEX.name] is None

    @pytest.mark.db
    def test_a_second_nameless_row_beside_the_ghost_is_refused(self, mongo_replica_set_url: str):
        """What the widening buys: a sentinel written twice, which would split the erased fixtures across two rows nobody can tell apart."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await call_anonymisation(database, client)
            try:
                await database[Collection.SCHIEDSRICHTER].insert_one({**build_ghost_schiedsrichter(), "_id": ObjectId()})
            except DuplicateKeyError:
                return "refused"
            return "accepted"

        assert on_a_league(mongo_replica_set_url, body) == "refused"

    @pytest.mark.db
    def test_a_second_live_referee_under_one_name_is_still_refused(self, mongo_replica_set_url: str):
        """The half the widening must not lose: two people the league can still write to, under one name."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            namesake = {**referee_document(SCHIEDSRICHTER_OID), "_id": ObjectId()}
            try:
                await database[Collection.SCHIEDSRICHTER].insert_one(namesake)
            except DuplicateKeyError:
                return "refused"
            return "accepted"

        assert on_a_league(mongo_replica_set_url, body) == "refused"


class TestTheRetirePressKeepsTheDayItFinds:
    """Driven through the endpoint rather than over `first_stamped`, which the default tier already covers.

    What needs a database is whether the retire path consults it at all.
    """

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

    @pytest.mark.db
    def test_a_referee_still_serving_is_retired_on_the_day_of_the_press(self, mongo_replica_set_url: str):
        """The control: a press that stamped nothing at all would pass the case above and retire nobody."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_retirement(database, client, today=A_LATER_PRESS)

            return await stored_referees(database)

        referees = on_a_league(mongo_replica_set_url, body)

        assert referees[SCHIEDSRICHTER_OID]["inactive_since"] == A_LATER_PRESS
        # The control's own control: retiring the whole collection would otherwise pass.
        assert referees[OTHER_SCHIEDSRICHTER_OID]["inactive_since"] is None
