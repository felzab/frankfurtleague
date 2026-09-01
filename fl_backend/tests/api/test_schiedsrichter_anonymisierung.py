from datetime import datetime
from typing import Any, Awaitable, Callable, Mapping
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import OperationFailure

from app.api.schiedsrichter.admin_router import anonymise_schiedsrichter, patch_schiedsrichter
from app.api.schiedsrichter.schemas import FLPatchSchiedsrichterPayload, FLSchiedsrichterWriteResponse
from app.api.schiedsrichter.services import ANONYMISED_KONTAKT
from app.core.collections import Collection
from app.core.constraints import SUPPORT_INDEXES
from app.core.recording import build_redaction_filter
from app.shared.schemas.kontakt import FLKontakt
from tests.database import a_clean_database, on_the_seed_loop

DATABASE_NAME = "fl_schiedsrichter_anonymisierung_test"

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

# Injected through `get_germany_now`, so the stamp under test is not the wall clock. Summer time,
# which is what puts an offset on the conversion below.
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

# The instant above as a log row spells it: 12:30 in Frankfurt is 10:30 in the log. Written out
# rather than computed from `log_stamp`, a stored stamp compared against the function that produced
# it agreeing with any conversion of it, including none.
REDACTED_AT = "2026-04-01T10:30:00+00:00"

# Read off the declaration rather than typed here, so renaming the index fails at its one source.
TARGET_INDEX = next(index for index in SUPPORT_INDEXES if index.collection == Collection.AKTIONEN and "document_id" in dict(index.keys))


def referee_document(schiedsrichter_id: ObjectId) -> dict[str, Any]:
    """Every field the validator requires, and the referee SERVING: D60 attaches no retire-first precondition to this endpoint."""

    return {
        "_id": schiedsrichter_id,
        "name": REFEREE_NAMES[schiedsrichter_id],
        "schule": SCHULE,
        "default_payment": DEFAULT_PAYMENT,
        "kontakt": dict(FORMER_KONTAKT[schiedsrichter_id]),
        "inactive_since": None,
    }


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


Body = Callable[[AsyncIOMotorDatabase, AsyncIOMotorClient], Awaitable[Any]]


async def a_referee_with_a_history(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient, schiedsrichter_id: ObjectId) -> None:
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

    `mutates_schema=True` where the body narrows one of those validators: `tests/database.py` then
    keeps the change off every later test.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
            await database[Collection.SCHIEDSRICHTER].insert_many([referee_document(oid) for oid in REFEREE_NAMES])
            for oid in REFEREE_NAMES:
                await a_referee_with_a_history(database, client, oid)

            return await body(database, client)

    return on_the_seed_loop(_run())


async def call_anonymisation(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> FLSchiedsrichterWriteResponse:
    return await anonymise_schiedsrichter(
        schiedsrichter_id=SCHIEDSRICHTER_OID,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        germany_now=NOW,
    )


async def stored_referees(database: AsyncIOMotorDatabase) -> dict[Any, Mapping[str, Any]]:
    """Keyed by `_id`, so a failing assertion names the referee rather than a list position."""

    return {row["_id"]: row for row in await database[Collection.SCHIEDSRICHTER].find().to_list(length=None)}


async def log_rows_naming(database: AsyncIOMotorDatabase, schiedsrichter_id: ObjectId) -> list[Mapping[str, Any]]:
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

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
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

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> str:
        try:
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER_OID}, {"$set": {"kontakt": None}})
        except OperationFailure as failure:
            assert failure.code == DOCUMENT_VALIDATION_FAILED, f"expected a validation failure, got {failure.code}: {failure}"
            return "rejected"
        return "accepted"

    assert on_a_league(mongo_replica_set_url, body) == "rejected"


@pytest.mark.db
def test_the_referee_keeps_their_name_and_every_other_field(mongo_replica_set_url: str):
    """Kills widening the write past `kontakt`: `spiele` embeds the name on every fixture they officiated."""

    _, referees, _ = after_anonymising(mongo_replica_set_url)
    stored = referees[SCHIEDSRICHTER_OID]

    assert stored["name"] == REFEREE_NAMES[SCHIEDSRICHTER_OID]
    assert (stored["schule"], stored["default_payment"], stored["inactive_since"]) == (SCHULE, DEFAULT_PAYMENT, None)


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
    assert referee.name == REFEREE_NAMES[SCHIEDSRICHTER_OID]
    assert (referee.kontakt.telefon, referee.kontakt.email) == (None, None)


@pytest.mark.db
def test_every_log_row_naming_them_is_emptied_and_stamped(mongo_replica_set_url: str):
    """Kills dropping the redaction, one that stamps without clearing, and one that clears without stamping.

    The pre-state is asserted too, without which a filter matching nothing would pass.
    """

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
        seeded = await log_rows_naming(database, SCHIEDSRICHTER_OID)
        await call_anonymisation(database, client)

        return seeded, await log_rows_naming(database, SCHIEDSRICHTER_OID)

    seeded, rows = on_a_league(mongo_replica_set_url, body)

    assert [row for row in seeded if row["before"] is not None], "the seeded log held no image to redact"
    assert len(rows) > len(seeded), "the anonymisation's own patch recorded no row"
    assert all(row["before"] is None for row in rows)
    assert {row["redacted_at"] for row in rows} == {REDACTED_AT}


@pytest.mark.db
def test_the_row_the_anonymisations_own_patch_wrote_is_redacted_too(mongo_replica_set_url: str):
    """Kills redacting BEFORE the patch: the patch's own row would then hold the very pair just cleared.

    The row is identified as the one this call added, so no ordering of the log can hide it.
    """

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
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

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
        await call_anonymisation(database, client)

        return await log_rows_naming(database, OTHER_SCHIEDSRICHTER_OID)

    rows = on_a_league(mongo_replica_set_url, body)

    assert [row for row in rows if row["before"] is not None], "the other referee's log rows were emptied too"
    assert all(row["redacted_at"] is None for row in rows)


@pytest.mark.db
def test_the_redaction_writes_no_row_of_its_own(mongo_replica_set_url: str):
    """Kills removing `record_write`'s early return on the log: the redaction would record a copy of what it cleared.

    Exactly one row is added, the patch's own, and none of them names the log.
    """

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
        before_count = await database[Collection.AKTIONEN].count_documents({})
        await call_anonymisation(database, client)

        return (
            before_count,
            await database[Collection.AKTIONEN].count_documents({}),
            await database[Collection.AKTIONEN].count_documents({"collection": str(Collection.AKTIONEN)}),
        )

    before_count, after_count, self_recorded = on_a_league(mongo_replica_set_url, body)

    assert after_count == before_count + 1
    assert self_recorded == 0


@pytest.mark.db
def test_the_redaction_filter_reads_the_target_index(mongo_replica_set_url: str):
    """Kills a filter shape that scans: the log is the one collection that only grows, so a scan degrades forever."""

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
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

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
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
