from datetime import datetime
from typing import Any, Awaitable, Callable, Mapping
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError, OperationFailure

from app.api.schiedsrichter.admin_router import anonymise_schiedsrichter, patch_schiedsrichter
from app.api.schiedsrichter.schemas import FLPatchSchiedsrichterPayload, FLSchiedsrichterWriteResponse
from app.api.schiedsrichter.services import (
    ANONYMISATION_UNDONE_BY_AN_EDIT,
    ANONYMISED_KONTAKT,
    ANONYMISED_SCHIEDSRICHTER,
    ANONYMISIERT_AM,
    KONTAKT_RE_ENTERED_MID_ANONYMISATION,
    anonymisation_stamp,
    find_anonymisation_undo_refusal,
    holds_an_anonymisable_value,
)
from app.api.spiele.schemas import FLSpielSchiedsrichterField, FLSpielSchiedsrichterFieldPublic
from app.core.collections import Collection
from app.core.constraints import SUPPORT_INDEXES, UNIQUE_INDEXES
from app.core.exceptions import DocumentConflictException
from app.core.recording import build_redaction_filter
from app.shared.schemas.kontakt import FLKontakt
from tests.database import a_clean_database, on_the_seed_loop
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


def a_patch(**overrides: Any) -> dict[str, Any]:
    """A whole payload as the endpoint hands it over, defaulting to the referee's own values.

    Built through the model rather than as a literal, so no case can pass over a shape the endpoint
    cannot receive -- which is what pins that the payload has no way to spell a nulled name.
    """

    fields: dict[str, Any] = {
        "name": REFEREE_NAMES[SCHIEDSRICHTER_OID],
        "schule": SCHULE,
        "default_payment": DEFAULT_PAYMENT,
        "kontakt": FLKontakt(**A_CLEARED_KONTAKT),
        **overrides,
    }

    return FLPatchSchiedsrichterPayload(**fields).model_dump(mode="json")


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

    def test_the_name_rides_in_the_same_mapping_as_the_details(self):
        """Two `$set`s could land apart, and a transaction retrying between them is what leaves a person named."""

        assert ANONYMISED_SCHIEDSRICHTER == {**ANONYMISED_KONTAKT, "name": None}

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
ANONYMISED_ROW: dict[str, Any] = {"kontakt": dict(A_CLEARED_KONTAKT), "name": None, ANONYMISIERT_AM: AN_EARLIER_ERASURE}

A_NAMED_ROW: dict[str, Any] = {
    "kontakt": dict(KONTAKT[SCHIEDSRICHTER_OID]),
    "name": REFEREE_NAMES[SCHIEDSRICHTER_OID],
    ANONYMISIERT_AM: None,
}


class TestTheErasureStampSurvivesEveryLaterRun:
    """The stamp is the date a person was given, so a repeat has to leave it where it is.

    A second run happens whenever a re-entry refuses the first (`REQ-ANONYMISE-001`), which is
    exactly when moving the date would be least visible.
    """

    def test_a_row_already_stamped_keeps_its_own_day(self):
        assert anonymisation_stamp(stored=ANONYMISED_ROW, today=TODAY) == AN_EARLIER_ERASURE

    def test_a_row_never_erased_takes_today(self):
        """The control: a stamp reading the row unconditionally would leave a first erasure unstamped, and the index covering it."""

        assert anonymisation_stamp(stored=A_NAMED_ROW, today=TODAY) == TODAY


class TestAnUndoOfTheAnonymisationIsWeighedFromBothSides:
    """Each half alone gets a case wrong.

    The payload alone refuses the ordinary rename this endpoint exists for, and the values alone
    cannot tell an erased row from one nobody has named yet.
    """

    def test_a_name_put_back_onto_an_anonymised_row_is_refused(self):
        refusal = find_anonymisation_undo_refusal(stored=ANONYMISED_ROW, patched=a_patch())

        assert refusal is not None
        assert refusal.error_code == ANONYMISATION_UNDONE_BY_AN_EDIT

    def test_a_contact_detail_put_back_is_refused_with_the_name_left_out(self):
        """The details are as much of the erasure as the name is, and a guard reading the name alone lets them back."""

        refusal = find_anonymisation_undo_refusal(stored=ANONYMISED_ROW, patched=a_patch(kontakt=FLKontakt(**KONTAKT[SCHIEDSRICHTER_OID])))

        assert refusal is not None
        assert refusal.error_code == ANONYMISATION_UNDONE_BY_AN_EDIT

    def test_a_row_holding_nulls_that_nobody_erased_still_takes_an_edit(self):
        """The stamp is what the refusal keys on: a row whose values happen to be empty is not a row somebody asked to leave."""

        never_erased = {**ANONYMISED_ROW, ANONYMISIERT_AM: None}

        assert find_anonymisation_undo_refusal(stored=never_erased, patched=a_patch()) is None

    def test_the_same_restoring_payload_against_a_row_still_naming_them_passes(self):
        """The control: without it a guard reading the payload alone would refuse every rename."""

        assert find_anonymisation_undo_refusal(stored=A_NAMED_ROW, patched=a_patch()) is None


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
            kontakt=FLKontakt(**KONTAKT[schiedsrichter_id]),
        ),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spiele_collection=database[Collection.SPIELE],
        db=client,
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
def test_the_referees_name_is_nulled_and_every_other_field_survives(mongo_replica_set_url: str):
    """Kills a write that stops at `kontakt`, and one that widens past the name onto the school or the fee."""

    _, referees, _ = after_anonymising(mongo_replica_set_url)
    stored = referees[SCHIEDSRICHTER_OID]

    assert stored["name"] is None
    assert (stored["schule"], stored["default_payment"], stored["inactive_since"]) == (SCHULE, DEFAULT_PAYMENT, None)


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
    assert referee.name is None
    assert referee.anonymisiert_am == TODAY
    assert (referee.kontakt.telefon, referee.kontakt.email) == (None, None)


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
def test_no_contact_value_of_theirs_survives_anywhere_in_the_log(mongo_replica_set_url: str):
    """Kills a redaction narrowed to some of their rows: the WHOLE log is swept, not the rows a filter named.

    The other referee's replaced number is asserted present, without which a log emptied wholesale
    would pass.
    """

    _, _, log = after_anonymising(mongo_replica_set_url)
    rendered = str(log)
    theirs = (*FORMER_KONTAKT[SCHIEDSRICHTER_OID].values(), *KONTAKT[SCHIEDSRICHTER_OID].values())

    assert [value for value in theirs if value in rendered] == []
    # Their replaced pair, not their live one: only what an edit replaced is ever in the log at all.
    assert FORMER_KONTAKT[OTHER_SCHIEDSRICHTER_OID]["telefon"] in rendered


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

    Two rows are added -- the referee patch's and the fan-out's -- and none of them names the log.
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

    assert after_count == before_count + 2
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
        # Narrow enough to refuse the redaction's `$set`, wide enough to admit the patch's own row,
        # which is recorded with `redacted_at` null.
        await database.command(
            "collMod",
            Collection.AKTIONEN.value,
            validator={"$jsonSchema": {"bsonType": "object", "properties": {"redacted_at": {"bsonType": "null"}}}},
            validationLevel="strict",
        )

        with pytest.raises(OperationFailure) as failure:
            await call_anonymisation(database, client)

        return failure.value.code, await stored_referees(database), await log_rows_naming(database, SCHIEDSRICHTER_OID)

    code, referees, rows = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

    # Asserted on the code, so this cannot pass because something else failed before any write.
    assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the redaction, got code {code}"
    assert referees[SCHIEDSRICHTER_OID]["kontakt"] == KONTAKT[SCHIEDSRICHTER_OID], "the clearing outlived a redaction that failed"
    assert [row for row in rows if row["before"] is not None], "the log lost its image to a transaction that never committed"
    assert all(row["redacted_at"] is None for row in rows)


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
            await database[Collection.SCHIEDSRICHTER].update_one(
                {"_id": SCHIEDSRICHTER_OID}, {"$set": {ANONYMISIERT_AM: AN_EARLIER_ERASURE}}
            )
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
    """`uniq_schiedsrichter_name` covers the rows whose data stand and no others.

    An index over every row refuses the SECOND erasure the league ever performs, because the nulled
    names collide; one over none lets two live referees be created under one name, which nothing
    merges and only a person can undo.
    """

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
            return {
                row["name"]: row.get("partialFilterExpression")
                async for row in await database[Collection.SCHIEDSRICHTER].list_indexes()
            }

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
