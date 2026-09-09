from datetime import datetime
from typing import Any, Awaitable, Callable, Mapping
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError, OperationFailure

from app.api.schiedsrichter.admin_router import (
    anonymise_schiedsrichter,
    delete_schiedsrichter,
    patch_schiedsrichter,
    reactivate_schiedsrichter,
)
from app.api.schiedsrichter.schemas import FLPatchSchiedsrichterPayload, FLSchiedsrichterWriteResponse
from app.api.schiedsrichter.services import (
    ANONYMISATION_UNDONE_BY_AN_EDIT,
    ANONYMISED_KONTAKT,
    ANONYMISED_REFEREE_REACTIVATED,
    ANONYMISED_SCHIEDSRICHTER,
    ANONYMISIERT_AM,
    KONTAKT_RE_ENTERED_MID_ANONYMISATION,
    build_booked_image_filter,
    build_unplayed_assignment_filter,
    find_anonymisation_undo_refusal,
    find_reactivation_refusal,
    first_stamped,
    holds_an_anonymisable_value,
)
from app.api.spiele.schemas import (
    SONDEREREIGNIS_WITHOUT_A_RESULT,
    FLPatchSpielDataPayload,
    FLSpielListAdapter,
    FLSpielSchiedsrichterField,
    FLSpielSchiedsrichterFieldPublic,
)
from app.api.spiele.services import BOOKING_UNKNOWN_RESOURCE, BookedReferee, ResolvedReferences, find_booking_refusal
from app.core.collections import Collection
from app.core.constraints import SUPPORT_INDEXES, UNIQUE_INDEXES
from app.core.crud import delete_many_from_db, patch_one_in_db
from app.core.exceptions import DocumentConflictException
from app.core.recording import build_redaction_filter
from app.shared.schemas.kontakt import FLKontakt, FLKontaktPayload
from tests.database import a_clean_database, on_the_seed_loop
from tests.payloads import spiel_patch_body
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_schiedsrichter_anonymisierung_test")

# Asserted on rather than caught broadly, so an unrelated failure cannot pass as a rejection.
DOCUMENT_VALIDATION_FAILED = 121

# Fixed rather than generated, so a failure names the same row every run.
SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607800001")
OTHER_SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607800002")

REFEREE_NAMES = {SCHIEDSRICHTER_OID: "Anna Körner", OTHER_SCHIEDSRICHTER_OID: "Bernd Kraus"}

SCHULE = "Carl-Schurz-Schule"
DEFAULT_PAYMENT = 20

# The pair the seeded edit replaced. It survives in one place only -- the log row that edit wrote --
# which is the copy an anonymisation stopping at the collection leaves standing.
FORMER_KONTAKT = {
    SCHIEDSRICHTER_OID: {"telefon": "+49 69 7654321", "email": "ak-vertretung@example.com"},
    OTHER_SCHIEDSRICHTER_OID: {"telefon": "+49 69 9998887", "email": "bk-vertretung@example.com"},
}

# What each referee holds when the anonymisation runs. No value here or above is shared between the
# two, so the log sweep below can attribute every hit it finds to one referee.
KONTAKT = {
    SCHIEDSRICHTER_OID: {"telefon": "+49 69 1234567", "email": "koerner.anna@example.com"},
    OTHER_SCHIEDSRICHTER_OID: {"telefon": "+49 69 2223334", "email": "kraus.bernd@example.com"},
}

# Read off the model, so a contact member added later is cleared here too and the guard's cases stay
# about the name alone.
A_CLEARED_KONTAKT: dict[str, None] = {field: None for field in FLKontakt.model_fields}

# Injected through `get_germany_now`, and in summer, so the conversion below moves the clock.
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

# Written out rather than computed from `log_stamp`, which would agree with any conversion of `NOW`, including none.
REDACTED_AT = "2026-04-01T10:30:00+00:00"

# `get_german_date_str`'s answer for `NOW`, spelled out for `REDACTED_AT`'s reason.
TODAY = "2026-04-01"

# A day the endpoint is never handed, so a stamp found unmoved cannot be the one it would have written.
AN_EARLIER_ERASURE = "2026-03-02"

# The same, for the retirement the erasure writes beside it, and a different day: one value for both
# would pass a run that stamped each from the other.
AN_EARLIER_RETIREMENT = "2025-11-20"

# Handed to the retire endpoint alone, and later than every other day here: a stamp that moved off the
# erasure's own is then unmistakable rather than equal to what the erasure would have written.
A_LATER_PRESS = "2026-05-04"

# What the seeded fixture edit moves. The field is arbitrary; the edit is not -- it is what files a log
# row carrying the whole fixture, the referee's embedded name included.
A_RESCHEDULED_TIME = "15:00:00"

# Read off the declaration, so renaming the index fails here rather than leaving these cases asserting nothing.
NAME_INDEX = next(index for index in UNIQUE_INDEXES if index.collection == Collection.SCHIEDSRICHTER)

# Read off the declaration rather than typed here, so renaming the index fails at its one source.
TARGET_INDEX = next(index for index in SUPPORT_INDEXES if index.collection == Collection.AKTIONEN and "document_id" in dict(index.keys))


# Two fixtures for the erased referee, so a fan-out stopping at the first row fails, and one for the
# other, so a fan-out ignoring its filter fails too.
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

# Seeded per case rather than into the league below, whose fan-out assertions count the fixtures each
# referee holds.
ARCHIVED_SPIEL_OID = ObjectId("6890a1b2c3d4e5f607800014")

# Read by no path here -- a referee's fan-out asks no season for its status, which is what the
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
        ANONYMISIERT_AM: None,
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

    Both season rows, so a fan-out that started reading a status would find one and stop at this
    fixture rather than passing because no season exists.
    """

    await database[Collection.SAISONS].insert_many([saison_document(SAISON_ID, "active"), saison_document(PAST_SAISON_ID, "past")])
    await database[Collection.SPIELE].insert_one(
        {
            **fixture_document(SCHIEDSRICHTER_OID, ARCHIVED_SPIEL_OID, 4),
            "saison_id": PAST_SAISON_ID,
            "spieltag_id": PAST_SPIELTAG_OID,
        }
    )


class TestTheUpdateNamesTheMembersAndNeverTheBlock:
    """The spelling the write turns on, apart from a database.

    `app/core/constraints.py :: _KONTAKT` types `kontakt` as required and non-nullable, so the
    obvious spelling -- one key, the whole object nulled -- is refused where it lands.
    """

    def test_each_contact_member_is_named_by_its_dotted_path(self):
        assert ANONYMISED_KONTAKT == {"kontakt.telefon": None, "kontakt.email": None}

    def test_the_block_itself_is_never_a_key(self):
        """Stated separately from the equality above: this is the one spelling the validator rejects outright."""

        assert "kontakt" not in ANONYMISED_KONTAKT

    def test_a_kontakt_cleared_this_way_still_validates(self):
        """The endpoint echoes the document it wrote through `FLSchiedsrichter`, so a member that stopped being nullable is a 500."""

        cleared = FLKontakt.model_validate({field: None for field in FLKontakt.model_fields})

        assert all(value is None for value in cleared.model_dump().values())

    def test_the_name_and_the_school_ride_in_the_same_mapping_as_the_details(self):
        """One whole mapping asserted rather than membership, so a run that clears one member and forgets another fails.

        Two `$set`s could land apart, and a transaction retrying between them is what leaves a
        person named.
        """

        assert ANONYMISED_SCHIEDSRICHTER == {**ANONYMISED_KONTAKT, "name": None, "schule": None}

    def test_the_erasure_writes_no_word_into_the_name_column(self):
        """A word there is one value for every erased person, which `uniq_schiedsrichter_name` refuses the second of.

        Asserted over the values rather than on the name alone, so a label smuggled into a contact
        member fails here too.
        """

        assert set(ANONYMISED_SCHIEDSRICHTER.values()) == {None}

    def test_a_nulled_name_reaches_the_base_tier_as_a_null_and_not_as_an_initial(self):
        """`READ-REFEREE-001`'s reduction composes a forename and an initial, and one composed from nothing would read as a name."""

        booking = {"schiedsrichter_id": SCHIEDSRICHTER_OID, "name": None}

        assert FLSpielSchiedsrichterFieldPublic.model_validate(booking).name is None


class TestTheGuardWeighsTheNameBesideTheDetails:
    """The name half of the guard, on the predicate itself.

    The write runs whatever the guard answers, and the refusal it gates needs a second read to
    agree, so this weighing has no separate answer at the endpoint.
    """

    def test_a_name_standing_over_an_empty_contact_block_is_work_to_do(self):
        assert holds_an_anonymisable_value({"kontakt": A_CLEARED_KONTAKT, "name": REFEREE_NAMES[SCHIEDSRICHTER_OID]})

    def test_a_nulled_name_over_the_same_block_is_not(self):
        """The control: a predicate answering `True` for every row would pass the case above."""

        assert not holds_an_anonymisable_value({"kontakt": A_CLEARED_KONTAKT, "name": None})


# The row as the anonymisation leaves it, which is the only state the undo guard has anything to say about.
ANONYMISED_ROW: dict[str, Any] = {
    "kontakt": dict(A_CLEARED_KONTAKT),
    "name": None,
    "schule": None,
    "inactive_since": TODAY,
    ANONYMISIERT_AM: AN_EARLIER_ERASURE,
}

A_NAMED_ROW: dict[str, Any] = {
    "kontakt": dict(KONTAKT[SCHIEDSRICHTER_OID]),
    "name": REFEREE_NAMES[SCHIEDSRICHTER_OID],
    "schule": SCHULE,
    "inactive_since": None,
    ANONYMISIERT_AM: None,
}


class TestTheErasureStampSurvivesEveryLaterRun:
    """A second run is not hypothetical.

    One happens whenever a re-entry refuses the first (`REQ-ANONYMISE-001`), which is exactly when
    moving the date would be least visible.
    """

    def test_a_row_already_stamped_keeps_its_own_day(self):
        assert first_stamped(stored=ANONYMISED_ROW, field=ANONYMISIERT_AM, today=TODAY) == AN_EARLIER_ERASURE

    def test_a_row_never_erased_takes_today(self):
        """The control: a stamp reading the row unconditionally would leave a first erasure unstamped, and the index covering it."""

        assert first_stamped(stored=A_NAMED_ROW, field=ANONYMISIERT_AM, today=TODAY) == TODAY

    def test_a_referee_retired_before_the_erasure_keeps_the_day_they_retired(self):
        """The retirement is a fact about the past: a referee retired last season and erased today retired last season."""

        retired_earlier = {**A_NAMED_ROW, "inactive_since": AN_EARLIER_RETIREMENT}

        assert first_stamped(stored=retired_earlier, field="inactive_since", today=TODAY) == AN_EARLIER_RETIREMENT

    def test_a_referee_still_serving_is_retired_the_day_of_the_erasure(self):
        """The control on the case above, and the one date the erasure writes for itself."""

        assert first_stamped(stored=A_NAMED_ROW, field="inactive_since", today=TODAY) == TODAY


class TestTheUndoRefusalReadsTheErasureStampAlone:
    """The stamp is the whole of the weighing, and each case below is a row a guard reading anything else answers wrongly."""

    def test_an_erased_row_is_refused(self):
        refusal = find_anonymisation_undo_refusal(stored=ANONYMISED_ROW)

        assert refusal is not None
        assert refusal.error_code == ANONYMISATION_UNDONE_BY_AN_EDIT

    def test_a_row_whose_details_were_typed_back_outside_the_api_is_still_refused(self):
        """A detail re-entered where no endpoint refused it must not read as never erased (`docs/backend/spec.md :: I214`)."""

        re_entered = {**A_NAMED_ROW, ANONYMISIERT_AM: AN_EARLIER_ERASURE}

        refusal = find_anonymisation_undo_refusal(stored=re_entered)

        assert refusal is not None
        assert refusal.error_code == ANONYMISATION_UNDONE_BY_AN_EDIT

    def test_a_row_holding_nulls_that_nobody_erased_still_takes_an_edit(self):
        """The stamp is what the refusal keys on: a row whose values happen to be empty is not a row somebody asked to leave."""

        never_erased = {**ANONYMISED_ROW, ANONYMISIERT_AM: None}

        assert find_anonymisation_undo_refusal(stored=never_erased) is None

    def test_a_row_still_naming_them_takes_the_edit(self):
        """The ordinary rename this endpoint exists for, which a guard reaching past the stamp would refuse."""

        assert find_anonymisation_undo_refusal(stored=A_NAMED_ROW) is None


class TestBringingAnErasedRefereeBackIsRefused:
    """`REQ-ANONYMISE-003`. Without it the erasure's retirement is undone by one press and the row is bookable with no name."""

    def test_an_erased_referee_is_refused(self):
        refusal = find_reactivation_refusal(anonymisiert_am=AN_EARLIER_ERASURE)

        assert refusal is not None
        assert refusal.error_code == ANONYMISED_REFEREE_REACTIVATED

    def test_the_refusal_does_not_offer_a_way_back(self):
        """A sentence naming one would promise an undo no endpoint can honour, on the one write that has none."""

        refusal = find_reactivation_refusal(anonymisiert_am=AN_EARLIER_ERASURE)

        assert refusal is not None
        assert "cannot be brought back" in refusal.message

    def test_an_ordinary_retired_referee_still_comes_back(self):
        """The control: a guard reading the retirement rather than the erasure would refuse every reactivation there is."""

        assert find_reactivation_refusal(anonymisiert_am=None) is None


# A fixture the erased referee does NOT hold, so a payload naming them MOVES the booking, which is the
# only case `find_booking_refusal` judges.
A_FIXTURE_HELD_BY_THE_OTHER_REFEREE: dict[str, Any] = fixture_document(OTHER_SCHIEDSRICHTER_OID, ARCHIVED_SPIEL_OID, 9)

AN_ERASED_REFEREE = BookedReferee(name=None, inactive_since=TODAY)
A_RETIRED_REFEREE = BookedReferee(name=REFEREE_NAMES[SCHIEDSRICHTER_OID], inactive_since=AN_EARLIER_RETIREMENT)


def booking_refusal(booked: BookedReferee):
    """A NEW booking of `booked` onto a fixture that holds somebody else, judged as the fixture patch judges it."""

    payload = FLPatchSpielDataPayload(
        **spiel_patch_body(
            A_FIXTURE_HELD_BY_THE_OTHER_REFEREE,
            schiedsrichter={"schiedsrichter_id": str(SCHIEDSRICHTER_OID), "payment": DEFAULT_PAYMENT},
        )
    )

    return find_booking_refusal(
        ARCHIVED_SPIEL_OID,
        payload,
        FLSpielListAdapter.validate_python([A_FIXTURE_HELD_BY_THE_OTHER_REFEREE]),
        ResolvedReferences(teams={}, schiedsrichter=booked),
    )


class TestAnErasedRefereeTakesNoNewFixture:
    """The erasure retires the referee, and `REQ-BOOKING-001` is what that buys.

    Driven here rather than beside the venue's cases: these pin a consequence of the erasure, where
    the refusal itself is one mechanism serving both references.
    """

    def test_a_referee_the_erasure_retired_is_refused_the_fixture(self):
        refusal = booking_refusal(AN_ERASED_REFEREE)

        assert refusal is not None
        assert refusal.error_code == BOOKING_UNKNOWN_RESOURCE

    def test_the_refusal_names_no_null_where_the_name_is_gone(self):
        """The message interpolated the row's name, so an erased referee read „Schiedsrichter None retired on ...“."""

        refusal = booking_refusal(AN_ERASED_REFEREE)

        assert refusal is not None
        assert "None" not in refusal.message, refusal.message

    def test_the_refusal_offers_no_reactivation_to_an_erased_referee(self):
        """`REQ-ANONYMISE-003` refuses that reactivation, so naming it here sends an administrator into a second refusal."""

        refusal = booking_refusal(AN_ERASED_REFEREE)

        assert refusal is not None
        assert "reactivate" not in refusal.message

    def test_an_ordinarily_retired_referee_is_still_told_to_reactivate_them(self):
        """The control on the two cases above: a message that dropped the route back for every retired row would pass them."""

        refusal = booking_refusal(A_RETIRED_REFEREE)

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
        db=client,
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
    )


def on_a_league(url: str, body: Body, *, mutates_schema: bool = False) -> Any:
    """The REAL validators and support indexes, so a namespace a transaction cannot create is there.

    `mutates_schema=True` where the body narrows one of those validators (`tests/database.py :: a_clean_database`).
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
            await database[Collection.SCHIEDSRICHTER].insert_many([referee_document(oid) for oid in REFEREE_NAMES])
            await database[Collection.SPIELE].insert_many(fixture_documents())
            for oid in REFEREE_NAMES:
                await a_referee_with_a_history(database, client, oid)
            for spiel_id in (spiel_id for spiel_ids in SPIEL_OIDS.values() for spiel_id in spiel_ids):
                await a_fixture_with_a_history(database, spiel_id)

            return await body(database, client)

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
        today=TODAY,
    )


async def call_retirement(database: AsyncDatabase, *, today: str) -> FLSchiedsrichterWriteResponse:
    """Every seeded fixture of this referee is PLAYED, so `find_referee_retire_refusal` refuses nothing and a case below fails on the date."""

    return await delete_schiedsrichter(
        schiedsrichter_id=SCHIEDSRICHTER_OID,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spiele_collection=database[Collection.SPIELE],
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
def test_the_validator_accepts_the_write_and_both_details_are_gone(mongo_replica_set_url: str):
    """The case the endpoint exists for. Kills dropping the `$set`, and a transaction that never commits."""

    _, referees, _ = after_anonymising(mongo_replica_set_url)
    kontakt = referees[SCHIEDSRICHTER_OID]["kontakt"]

    assert kontakt["telefon"] is None
    assert kontakt["email"] is None


@pytest.mark.db
def test_the_kontakt_block_survives_with_both_of_its_keys(mongo_replica_set_url: str):
    """Kills clearing by `$unset`, which satisfies the case above on a database without the validator."""

    _, referees, _ = after_anonymising(mongo_replica_set_url)

    assert set(referees[SCHIEDSRICHTER_OID]["kontakt"]) == {"telefon", "email"}


@pytest.mark.db
def test_nulling_the_whole_block_is_what_the_validator_refuses(mongo_replica_set_url: str):
    """Without this the dotted keys read as style. The refusal is what makes them the only spelling that works."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
        try:
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER_OID}, {"$set": {"kontakt": None}})
        except OperationFailure as failure:
            assert failure.code == DOCUMENT_VALIDATION_FAILED, f"expected a validation failure, got {failure.code}: {failure}"
            return "rejected"
        return "accepted"

    assert on_a_league(mongo_replica_set_url, body) == "rejected"


@pytest.mark.db
def test_the_name_and_the_school_are_nulled_and_the_fee_survives(mongo_replica_set_url: str):
    """Kills a write that stops at `kontakt`, one that leaves the school, and one that widens onto the fee."""

    _, referees, _ = after_anonymising(mongo_replica_set_url)
    stored = referees[SCHIEDSRICHTER_OID]

    assert (stored["name"], stored["schule"]) == (None, None)
    assert stored["default_payment"] == DEFAULT_PAYMENT


@pytest.mark.db
def test_the_erasure_retires_the_referee(mongo_replica_set_url: str):
    """Kills clearing the values and leaving the row live: `REQ-BOOKING-001` reads this field and nothing else."""

    _, referees, _ = after_anonymising(mongo_replica_set_url)

    assert referees[SCHIEDSRICHTER_OID]["inactive_since"] == TODAY
    # The control, without which retiring the whole collection would pass.
    assert referees[OTHER_SCHIEDSRICHTER_OID]["inactive_since"] is None


def after_anonymising_one_fixture_left_to_play(url: str) -> tuple[dict[Any, Mapping[str, Any]], dict[Any, Mapping[str, Any]]]:
    """One league holding a played fixture and an unplayed one, so the two halves are read off a single run."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await one_of_their_fixtures_left_to_play(database)
        await call_anonymisation(database, client)

        return await stored_fixtures(database), await stored_referees(database)

    return on_a_league(url, body)


@pytest.mark.db
def test_an_unplayed_fixture_does_not_stop_the_erasure_and_loses_its_assignment(mongo_replica_set_url: str):
    """`DELETE` owes `REQ-RETIRE-004` and this does not: the erasure empties the booking rather than being blocked by it.

    Kills consulting that refusal here, and kills leaving an erased person named on work still to come.
    """

    fixtures, referees = after_anonymising_one_fixture_left_to_play(mongo_replica_set_url)

    assert referees[SCHIEDSRICHTER_OID][ANONYMISIERT_AM] == TODAY
    # Still owing a result, so this cannot pass on an erasure that composed one instead.
    assert fixtures[UNPLAYED_SPIEL_OID]["ergebnis"] is None
    assert fixtures[UNPLAYED_SPIEL_OID]["schiedsrichter"] is None


@pytest.mark.db
def test_the_played_fixture_beside_it_keeps_its_assignment_under_a_nulled_name(mongo_replica_set_url: str):
    """Kills an unassign ignoring the result: a match that was played records who officiated it, and no request rewrites that."""

    fixtures, _ = after_anonymising_one_fixture_left_to_play(mongo_replica_set_url)

    assert fixtures[PLAYED_SPIEL_OID]["schiedsrichter"] == {
        "schiedsrichter_id": SCHIEDSRICHTER_OID,
        "name": None,
        "payment": DEFAULT_PAYMENT,
    }


@pytest.mark.db
def test_a_cancelled_fixture_keeps_its_assignment(mongo_replica_set_url: str):
    """Kills an unassign reading `ergebnis` alone: a fixture called off owes no result, so nothing on it is still to be played."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await one_of_their_fixtures_left_to_play(database, sonderereignis=A_CANCELLATION)
        await call_anonymisation(database, client)

        return await stored_fixtures(database)

    fixtures = on_a_league(mongo_replica_set_url, body)

    assert fixtures[UNPLAYED_SPIEL_OID]["schiedsrichter"] == {
        "schiedsrichter_id": SCHIEDSRICHTER_OID,
        "name": None,
        "payment": DEFAULT_PAYMENT,
    }


@pytest.mark.db
def test_another_referees_unplayed_fixture_keeps_its_assignment(mongo_replica_set_url: str):
    """Kills an unassign ignoring the id in its filter, which would strip a referee nobody asked about."""

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


@pytest.mark.db
def test_a_referee_retired_earlier_keeps_the_day_they_retired(mongo_replica_set_url: str):
    """Kills stamping today over a retirement the row already carries.

    The person retired last season, and a fee is reconciled against the day they stopped officiating.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER_OID}, {"$set": {"inactive_since": AN_EARLIER_RETIREMENT}})
        await call_anonymisation(database, client)

        return await stored_referees(database)

    referees = on_a_league(mongo_replica_set_url, body)

    assert referees[SCHIEDSRICHTER_OID]["inactive_since"] == AN_EARLIER_RETIREMENT
    # The erasure's own date still lands, so this cannot pass on a write that stamped neither.
    assert referees[SCHIEDSRICHTER_OID][ANONYMISIERT_AM] == TODAY


@pytest.mark.db
def test_the_row_carries_the_day_the_erasure_ran(mongo_replica_set_url: str):
    """Kills nulling the fields and leaving the flag alone: the row would then read as one nobody had ever named.

    Which is also the state `uniq_schiedsrichter_name`'s filter still indexes, so the erasure after
    this one collides.
    """

    _, referees, _ = after_anonymising(mongo_replica_set_url)

    assert referees[SCHIEDSRICHTER_OID][ANONYMISIERT_AM] == TODAY
    assert referees[OTHER_SCHIEDSRICHTER_OID][ANONYMISIERT_AM] is None


def fixtures_after_anonymising(url: str) -> dict[Any, Mapping[str, Any]]:
    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await call_anonymisation(database, client)

        return await stored_fixtures(database)

    return on_a_league(url, body)


@pytest.mark.db
def test_every_fixture_they_officiated_loses_the_name(mongo_replica_set_url: str):
    """Kills an erasure reaching the row alone: a fixture stores its own copy of the name.

    Both of their fixtures, so a fan-out modifying one row and stopping fails here rather than
    passing on whichever row it reached.
    """

    fixtures = fixtures_after_anonymising(mongo_replica_set_url)

    assert [fixtures[spiel_id]["schiedsrichter"]["name"] for spiel_id in SPIEL_OIDS[SCHIEDSRICHTER_OID]] == [None] * 2


@pytest.mark.db
def test_the_other_referees_fixture_keeps_their_name(mongo_replica_set_url: str):
    """Kills a fan-out ignoring its filter, which the case above passes for."""

    fixtures = fixtures_after_anonymising(mongo_replica_set_url)
    (other_spiel_id,) = SPIEL_OIDS[OTHER_SCHIEDSRICHTER_OID]

    assert fixtures[other_spiel_id]["schiedsrichter"]["name"] == REFEREE_NAMES[OTHER_SCHIEDSRICHTER_OID]


@pytest.mark.db
def test_the_booking_and_the_fee_survive_the_nulled_name(mongo_replica_set_url: str):
    """Kills a fan-out that `$set`s the whole `schiedsrichter` block: the reference is what makes the fixture resolvable."""

    fixtures = fixtures_after_anonymising(mongo_replica_set_url)
    booking = fixtures[SPIEL_OIDS[SCHIEDSRICHTER_OID][0]]["schiedsrichter"]

    assert (booking["schiedsrichter_id"], booking["payment"]) == (SCHIEDSRICHTER_OID, DEFAULT_PAYMENT)


@pytest.mark.db
def test_a_referee_whose_contact_block_is_already_empty_is_not_a_no_op(mongo_replica_set_url: str):
    """A row cleared of its details but still named is the state the erasure exists for: the name is the copy every match carries."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER_OID}, {"$set": dict(ANONYMISED_KONTAKT)})
        response = await call_anonymisation(database, client)

        return response.updated_document.name, await stored_fixtures(database)

    echoed, fixtures = on_a_league(mongo_replica_set_url, body)

    assert echoed is None
    assert [fixtures[spiel_id]["schiedsrichter"]["name"] for spiel_id in SPIEL_OIDS[SCHIEDSRICHTER_OID]] == [None] * 2


@pytest.mark.db
def test_the_written_fixture_is_read_back_by_both_tiers_rather_than_refused(mongo_replica_set_url: str):
    """A read model refusing what the erasure stored would answer 500 for a whole season's fixture list over one erased referee.

    Both models, because the base tier reduces the surname where the admin tier serves it whole.
    """

    fixtures = fixtures_after_anonymising(mongo_replica_set_url)
    booking = fixtures[SPIEL_OIDS[SCHIEDSRICHTER_OID][0]]["schiedsrichter"]

    assert FLSpielSchiedsrichterFieldPublic.model_validate(booking).name is None
    assert FLSpielSchiedsrichterField.model_validate(booking).name is None


@pytest.mark.db
def test_the_other_referee_keeps_their_contact_details(mongo_replica_set_url: str):
    """Kills a write that ignores its filter: the cases above all pass for one that clears the collection."""

    _, referees, _ = after_anonymising(mongo_replica_set_url)

    assert referees[OTHER_SCHIEDSRICHTER_OID]["kontakt"] == KONTAKT[OTHER_SCHIEDSRICHTER_OID]


@pytest.mark.db
def test_the_echo_carries_the_referee_as_they_now_stand(mongo_replica_set_url: str):
    """Kills echoing the pre-image, which is the state this write just replaced and still shows the details."""

    response, _, _ = after_anonymising(mongo_replica_set_url)
    referee = response.updated_document

    assert referee.id == SCHIEDSRICHTER_OID
    assert (referee.name, referee.schule) == (None, None)
    assert (referee.anonymisiert_am, referee.inactive_since) == (TODAY, TODAY)
    assert (referee.kontakt.telefon, referee.kontakt.email) == (None, None)


@pytest.mark.db
def test_bringing_an_erased_referee_back_is_refused_at_the_endpoint(mongo_replica_set_url: str):
    """Kills a guard the router never consults, and one reading the retirement rather than the erasure's stamp.

    The retirement is left standing, which is what makes the refusal worth having.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await call_anonymisation(database, client)

        with pytest.raises(DocumentConflictException) as refused:
            await reactivate_schiedsrichter(schiedsrichter_id=SCHIEDSRICHTER_OID, schiedsrichter_collection=database[Collection.SCHIEDSRICHTER])

        return refused.value.error_code, await stored_referees(database)

    code, referees = on_a_league(mongo_replica_set_url, body)

    assert code == ANONYMISED_REFEREE_REACTIVATED
    assert referees[SCHIEDSRICHTER_OID]["inactive_since"] == TODAY


@pytest.mark.db
def test_an_ordinary_retired_referee_is_still_reactivated_by_the_endpoint(mongo_replica_set_url: str):
    """The control on the case above: a router refusing every reactivation would pass it and strand every retired referee there is."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SCHIEDSRICHTER].update_one(
            {"_id": OTHER_SCHIEDSRICHTER_OID}, {"$set": {"inactive_since": AN_EARLIER_RETIREMENT}}
        )
        response = await reactivate_schiedsrichter(
            schiedsrichter_id=OTHER_SCHIEDSRICHTER_OID, schiedsrichter_collection=database[Collection.SCHIEDSRICHTER]
        )

        return response.updated_document.inactive_since

    assert on_a_league(mongo_replica_set_url, body) is None


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
    assert len(rows) > len(seeded), "the anonymisation's own patch recorded no row"
    assert all(row["before"] is None for row in rows)
    assert {row["redacted_at"] for row in rows} == {REDACTED_AT}


@pytest.mark.db
def test_the_row_the_anonymisations_own_patch_wrote_is_redacted_too(mongo_replica_set_url: str):
    """Kills redacting BEFORE the patch: the patch's own row would then hold the very pair just cleared.

    The row is identified as the one this call added, so no ordering of the log can hide it.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        seeded = {row["_id"] for row in await log_rows_naming(database, SCHIEDSRICHTER_OID)}
        await call_anonymisation(database, client)

        return seeded, [row for row in await log_rows_naming(database, SCHIEDSRICHTER_OID) if row["_id"] not in seeded]

    seeded, added = on_a_league(mongo_replica_set_url, body)

    assert seeded, "the seeded history left no row to tell the new one from"
    assert len(added) == 1
    assert added[0]["before"] is None
    assert added[0]["redacted_at"] == REDACTED_AT


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
    """Every log row naming ONE fixture, the fan-out's own row excluded: that one carries a count and names no document."""

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

    reassigned = SPIEL_OIDS[SCHIEDSRICHTER_OID][0]

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


def test_the_unplayed_assignment_filter_spells_the_definition_once():
    """The retirement's refusal and the erasure's unassign read this one filter, so a widening here moves both at once."""

    assert build_unplayed_assignment_filter(SCHIEDSRICHTER_OID) == {
        "schiedsrichter.schiedsrichter_id": SCHIEDSRICHTER_OID,
        "ergebnis": None,
        "sonderereignis": {"$nin": list(SONDEREREIGNIS_WITHOUT_A_RESULT)},
    }


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

    # The referee patch and both fan-outs, the unassign's row recording a count of nothing on a seed
    # whose every fixture is played.
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
def test_a_refused_redaction_takes_the_clearing_back(mongo_replica_set_url: str):
    """Kills running the two writes outside one transaction, and dropping the session from either.

    A `$jsonSchema` refusing a stamped row fails the SECOND write, once the clearing has landed.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await a_validator_refusing_the_redaction(database)

        with pytest.raises(OperationFailure) as failure:
            await call_anonymisation(database, client)

        return failure.value.code, await stored_referees(database), await log_rows_naming(database, SCHIEDSRICHTER_OID)

    code, referees, rows = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

    # Asserted on the code, so this cannot pass because something else failed before any write.
    assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the redaction, got code {code}"
    assert referees[SCHIEDSRICHTER_OID]["kontakt"] == KONTAKT[SCHIEDSRICHTER_OID], "the clearing outlived a redaction that failed"
    assert [row for row in rows if row["before"] is not None], "the log lost its image to a transaction that never committed"
    assert all(row["redacted_at"] is None for row in rows)


@pytest.mark.db
def test_a_refused_redaction_takes_the_unassignment_back(mongo_replica_set_url: str):
    """Kills dropping the session from the unassign: a run that failed would leave a match with nobody to officiate it."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await one_of_their_fixtures_left_to_play(database)
        await a_validator_refusing_the_redaction(database)

        with pytest.raises(OperationFailure) as failure:
            await call_anonymisation(database, client)

        return failure.value.code, await stored_fixtures(database)

    code, fixtures = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

    assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the redaction, got code {code}"
    assert fixtures[UNPLAYED_SPIEL_OID]["schiedsrichter"] == {
        "schiedsrichter_id": SCHIEDSRICHTER_OID,
        "name": REFEREE_NAMES[SCHIEDSRICHTER_OID],
        "payment": DEFAULT_PAYMENT,
    }


class AktionenRunningAHookBeforeTheRedaction:
    """A stand-in whose hook runs before the redaction, so the interleaving is a fact rather than a race.

    The one point where the referee row is written and nothing has committed. Not a subclass:
    `database[name]` builds the collection.
    """

    def __init__(self, inner: Any, hook: Callable[[], Awaitable[Any]]) -> None:
        self._inner = inner
        self._hook: Callable[[], Awaitable[Any]] | None = hook

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    async def update_many(self, *args: Any, **kwargs: Any) -> Any:
        # ONE-SHOT: a retry has to judge what landed rather than run the interference again.
        if self._hook is not None:
            hook, self._hook = self._hook, None
            await hook()

        return await self._inner.update_many(*args, **kwargs)


async def anonymise_under(database: AsyncDatabase, client: AsyncMongoClient, hook: Callable[[], Awaitable[Any]] | None) -> Any:
    """The endpoint with `hook` landing between the referee write and the redaction. Only a refusal is caught."""

    aktionen: Any = database[Collection.AKTIONEN]
    if hook is not None:
        aktionen = AktionenRunningAHookBeforeTheRedaction(aktionen, hook)

    return await anonymise_schiedsrichter(
        schiedsrichter_id=SCHIEDSRICHTER_OID,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spiele_collection=database[Collection.SPIELE],
        aktionen_collection=aktionen,
        db=client,
        germany_now=NOW,
        today=TODAY,
    )


class TestAReEntryLandingMidAnonymisationIsRefused:
    """The referee is CLEARED already, so the second run's `$set` rewrites nothing.

    A rewrite of nothing joins no write set, so nothing inside the transaction judges a re-entry.
    Only the read outside the session refuses this.
    """

    @pytest.mark.db
    def test_details_re_entered_under_the_erasure_are_refused_rather_than_left_standing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # The first run is what leaves the row cleared, which is the state this case is about.
            await anonymise_under(database, client, None)

            async def re_enter_the_details() -> None:
                # Not through `PATCH`, which refuses this restore itself (`REQ-ANONYMISE-002`): what
                # can still land under a running erasure is a writer outside the API.
                await database[Collection.SCHIEDSRICHTER].update_one(
                    {"_id": SCHIEDSRICHTER_OID}, {"$set": {"kontakt": dict(KONTAKT[SCHIEDSRICHTER_OID])}}
                )

            try:
                await anonymise_under(database, client, re_enter_the_details)
                outcome = "the anonymisation committed"
            except DocumentConflictException as refusal:
                outcome = refusal.error_code

            return outcome, (await stored_referees(database))[SCHIEDSRICHTER_OID]["kontakt"]

        outcome, kontakt = on_a_league(mongo_replica_set_url, body)

        # Unrefused, the endpoint answers 200 with a null `kontakt` over a row holding the pair again,
        # and an administrator is told a person's details are gone while they are not.
        assert outcome == KONTAKT_RE_ENTERED_MID_ANONYMISATION
        assert kontakt == KONTAKT[SCHIEDSRICHTER_OID], "the interference never re-entered the details, so the rule had nothing to refuse"

    @pytest.mark.db
    def test_a_second_run_with_nothing_interfering_still_answers(self, mongo_replica_set_url: str):
        """The control: without it the guard above could refuse every re-run, which is a working erasure an admin cannot repeat."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await anonymise_under(database, client, None)
            response = await anonymise_under(database, client, None)

            return response.updated_document.kontakt, (await stored_referees(database))[SCHIEDSRICHTER_OID]["kontakt"]

        echoed, stored = on_a_league(mongo_replica_set_url, body)

        assert (echoed.telefon, echoed.email) == (None, None)
        assert stored == {"telefon": None, "email": None}

    @pytest.mark.db
    def test_a_repeat_leaves_the_day_the_person_was_given_where_it_is(self, mongo_replica_set_url: str):
        """The date is what a later request for it is answered with, and the log holding the first run was redacted by that run."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await anonymise_under(database, client, None)
            # Backdated between the runs, so the second run is handed a stamp no clock here could have written.
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER_OID}, {"$set": {ANONYMISIERT_AM: AN_EARLIER_ERASURE}})
            response = await anonymise_under(database, client, None)

            return response.updated_document.anonymisiert_am, (await stored_referees(database))[SCHIEDSRICHTER_OID][ANONYMISIERT_AM]

        echoed, stored = on_a_league(mongo_replica_set_url, body)

        assert (echoed, stored) == (AN_EARLIER_ERASURE, AN_EARLIER_ERASURE)


def after_editing_the_details_back_in(url: str) -> tuple[str, Mapping[str, Any], Mapping[str, Any]]:
    """The outcome, the row and the archived fixture together: one seeded database serves all three."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await an_archived_fixture(database)
        await call_anonymisation(database, client)

        try:
            # The edit that seeded their details, run again a week after the erasure committed.
            await a_referee_with_a_history(database, client, SCHIEDSRICHTER_OID)
            outcome = "the edit committed"
        except DocumentConflictException as refusal:
            outcome = refusal.error_code

        return outcome, (await stored_referees(database))[SCHIEDSRICHTER_OID], (await stored_fixtures(database))[ARCHIVED_SPIEL_OID]

    return on_a_league(url, body)


class TestAnEditPuttingTheDetailsBackAfterTheErasureIsRefused:
    """`REQ-ANONYMISE-001` judges a re-entry landing WHILE the erasure runs and meets nothing after it.

    The seeded league renames both referees before any erasure, so a guard reaching an ordinary edit
    fails every case in this module rather than passing quietly.
    """

    @pytest.mark.db
    def test_the_edit_is_refused_and_the_row_keeps_its_nulls(self, mongo_replica_set_url: str):
        outcome, referee, _ = after_editing_the_details_back_in(mongo_replica_set_url)

        assert outcome == ANONYMISATION_UNDONE_BY_AN_EDIT
        assert referee["name"] is None
        assert referee["kontakt"] == {"telefon": None, "email": None}

    @pytest.mark.db
    def test_the_closed_seasons_fixture_keeps_its_null_too(self, mongo_replica_set_url: str):
        """The archive is what an unrefused edit re-names.

        A referee's fan-out carries no `past` bound where a club's stops (`docs/backend/spec.md :: I13`).
        """

        _, _, archived = after_editing_the_details_back_in(mongo_replica_set_url)

        assert archived["saison_id"] == PAST_SAISON_ID, "the archived fixture was seeded into the open season"
        assert archived["schiedsrichter"]["name"] is None


class TestASecondPersonsErasureLandsAndTwoLiveNamesakesStillDoNot:
    """Both directions of the partial filter on `app/core/constraints.py :: uniq_schiedsrichter_name`."""

    @pytest.mark.db
    def test_both_referees_are_erased_in_succession(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_anonymisation(database, client, SCHIEDSRICHTER_OID)
            await call_anonymisation(database, client, OTHER_SCHIEDSRICHTER_OID)

            return await stored_referees(database)

        referees = on_a_league(mongo_replica_set_url, body)

        assert [referees[oid]["name"] for oid in REFEREE_NAMES] == [None, None]
        assert all(referees[oid][ANONYMISIERT_AM] == TODAY for oid in REFEREE_NAMES)

    @pytest.mark.db
    def test_the_index_is_built_narrowed_rather_than_dropped(self, mongo_replica_set_url: str):
        """The case above also passes where the rule is gone altogether, so the built index is read back."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return {row["name"]: row.get("partialFilterExpression") async for row in await database[Collection.SCHIEDSRICHTER].list_indexes()}

        built = on_a_league(mongo_replica_set_url, body)

        assert NAME_INDEX.name in built, f"the name rule is not built at all: {sorted(built)}"
        assert built[NAME_INDEX.name] == NAME_INDEX.partial_filter

    @pytest.mark.db
    def test_a_second_live_referee_under_one_name_is_still_refused(self, mongo_replica_set_url: str):
        """The half the narrowing must not take with it: two people the league can still write to, under one name."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            namesake = {**referee_document(SCHIEDSRICHTER_OID), "_id": ObjectId()}
            try:
                await database[Collection.SCHIEDSRICHTER].insert_one(namesake)
            except DuplicateKeyError:
                return "refused"
            return "accepted"

        assert on_a_league(mongo_replica_set_url, body) == "refused"


class TestTheRetirePressIsTheSecondWriterOfInactiveSince:
    """Driven through the endpoint rather than over `first_stamped`, which the default tier already covers.

    What needs a database is whether the retire path consults it at all.
    """

    @pytest.mark.db
    def test_a_press_after_the_erasure_leaves_the_erasures_own_day(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_anonymisation(database, client)
            await call_retirement(database, today=A_LATER_PRESS)

            return await stored_referees(database)

        referees = on_a_league(mongo_replica_set_url, body)

        assert referees[SCHIEDSRICHTER_OID]["inactive_since"] == TODAY
        # The erasure's own stamp beside it, so this cannot pass on a row neither write reached.
        assert referees[SCHIEDSRICHTER_OID][ANONYMISIERT_AM] == TODAY

    @pytest.mark.db
    def test_a_referee_still_serving_is_retired_on_the_day_of_the_press(self, mongo_replica_set_url: str):
        """The control: a press that stamped nothing at all would pass the case above and retire nobody."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_retirement(database, today=A_LATER_PRESS)

            return await stored_referees(database)

        referees = on_a_league(mongo_replica_set_url, body)

        assert referees[SCHIEDSRICHTER_OID]["inactive_since"] == A_LATER_PRESS
        # The control's own control: retiring the whole collection would otherwise pass.
        assert referees[OTHER_SCHIEDSRICHTER_OID]["inactive_since"] is None
