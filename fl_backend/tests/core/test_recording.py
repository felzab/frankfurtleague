import asyncio
from datetime import datetime, timedelta
from typing import Any, Mapping, Sequence, cast

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorCollection
from pymongo import ReturnDocument
from pymongo.results import InsertManyResult, InsertOneResult, UpdateResult

from app.core.collections import Collection
from app.core.constraints import COLLECTION_VALIDATORS
from app.core.crud import patch_many_in_db, patch_one_in_db, post_many_to_db, post_one_to_db
from app.core.exceptions import DocumentNotFoundException
from app.core.logging import correlation_id_var
from app.core.recording import Actor, _stringify_filter, actor_var, record_write, request_var

# Fixed rather than generated, so a failing test names the same document every run.
TEAM_OID = ObjectId("6890a1b2c3d4e5f607500001")
CREATED_OID = ObjectId("6890a1b2c3d4e5f607500002")

# The two images share no value, so a row holding the wrong one cannot pass by resembling the right one.
BEFORE_DOCUMENT: Mapping[str, Any] = {"_id": TEAM_OID, "name": "Lessing", "shorthand": "LE"}
AFTER_DOCUMENT: Mapping[str, Any] = {"_id": TEAM_OID, "name": "Lessing-Gymnasium", "shorthand": "LG"}

CREATED_DOCUMENT: Mapping[str, Any] = {"_id": CREATED_OID, "name": "Carl-Schurz", "shorthand": "CS"}

# More than two, so a row per document rather than per call is unmistakable, and none of them
# carries an `_id`: a generated fixture leaves those to the driver.
CREATED_DOCUMENTS: Sequence[Mapping[str, Any]] = [{"name": f"Club {index}", "shorthand": f"C{index}"} for index in range(5)]

FILTER: Mapping[str, Any] = {"saison_id": "2026", "team_id": TEAM_OID}
UPDATE: Mapping[str, Any] = {"$set": {"name": "Lessing-Gymnasium"}}

# Far above one, so a row per matched document rather than per write is unmistakable.
MATCHED = 40

ADMIN_ACTOR = Actor(kind="admin_session", email="admin@example.com")

# The route TEMPLATE, which is the half of this pair the binder stores.
ROUTE = ("PATCH", "/api/v0/teams/{team_id}")
CORRELATION_ID = "0123456789abcdef0123456789abcdef"

# A stand-in for a transaction handle: what is proved is that the row travels inside whatever the caller passed.
SESSION = cast(AsyncIOMotorClientSession, object())


class _FakeCollection:
    """One collection, called as `app/core/crud.py` and `app/core/recording.py` call the driver.

    `name` is a plain `str` as Motor's is, which leaves the recursion guard a real `StrEnum`
    comparison to make rather than an identity one it would pass for free.
    """

    def __init__(
        self,
        name: str,
        *,
        before: Mapping[str, Any] | None = None,
        after: Mapping[str, Any] | None = None,
        modified_count: int = 0,
        log: "_FakeCollection | None" = None,
    ) -> None:
        self.name = str(name)
        self.before = before
        self.after = after
        self.modified_count = modified_count
        self.inserted: list[Mapping[str, Any]] = []
        self.sessions: list[Any] = []
        # A collection reaches the log through its own database handle, and for the log itself that
        # resolves back to the same collection -- the shape the recursion guard has to survive.
        self.database: dict[str, "_FakeCollection"] = {Collection.AKTIONEN: self if log is None else log}

    async def find_one(self, *, filter: Any, projection: Any = None, session: Any = None) -> Mapping[str, Any] | None:
        """The post-image: a patch re-reads for the caller's echo once the update has carried the pre-image out."""
        return self.after

    async def find_one_and_update(
        self, *, filter: Any, update: Any, session: Any = None, return_document: Any = None
    ) -> Mapping[str, Any] | None:
        """Answers the image it was asked for, as the driver does -- which is what makes the pre-image atomic."""
        return self.before if return_document is ReturnDocument.BEFORE else self.after

    async def update_many(self, *, filter: Any, update: Any, session: Any = None) -> UpdateResult:
        return UpdateResult({"n": self.modified_count, "nModified": self.modified_count, "ok": 1.0}, True)

    async def insert_one(self, document: Mapping[str, Any], session: Any = None) -> InsertOneResult:
        self.inserted.append(document)
        self.sessions.append(session)

        return InsertOneResult(document.get("_id", CREATED_OID), True)

    async def insert_many(self, documents: Sequence[Mapping[str, Any]], session: Any = None) -> InsertManyResult:
        """Ids in input order, as the driver answers: `post_many_to_db` counts them to fill the row."""
        self.inserted.extend(documents)
        self.sessions.append(session)

        return InsertManyResult([document.get("_id", ObjectId()) for document in documents], True)


def build(name: str = Collection.TEAMS, **state: Any) -> tuple[_FakeCollection, _FakeCollection]:
    """The written-to collection and the log its database holds, as two objects: one list each is what makes "recorded nothing" checkable."""

    log = _FakeCollection(Collection.AKTIONEN)

    return _FakeCollection(name, log=log, **state), log


def as_collection(stub: _FakeCollection) -> AsyncIOMotorCollection:
    return cast(AsyncIOMotorCollection, stub)


def record_inside_a_request(**arguments: Any) -> None:
    """Bound inside the coroutine: `asyncio.run` runs it in a copied context, so nothing set here reaches another test."""

    async def _run() -> None:
        actor_var.set(ADMIN_ACTOR)
        request_var.set(ROUTE)
        correlation_id_var.set(CORRELATION_ID)
        await record_write(**arguments)

    asyncio.run(_run())


class TestTheLogNeverRecordsItself:
    def test_a_write_to_the_log_itself_records_nothing(self):
        """Recording the log's own rows would recurse without end, and a redaction is itself a write."""
        log = _FakeCollection(Collection.AKTIONEN)

        asyncio.run(record_write(collection=as_collection(log), operation="insert", document_id=TEAM_OID))

        assert log.inserted == []

    def test_the_identical_call_against_another_collection_does_record(self):
        """The control: a guard refusing every collection would pass the case above while logging nothing at all."""
        target, log = build()

        asyncio.run(record_write(collection=as_collection(target), operation="insert", document_id=TEAM_OID))

        assert len(log.inserted) == 1


class TestWhatEachWriteRecords:
    def test_a_single_document_patch_records_one_row_naming_the_document(self):
        target, log = build(before=BEFORE_DOCUMENT, after=AFTER_DOCUMENT)

        asyncio.run(patch_one_in_db(collection=as_collection(target), db_filter=FILTER, update=UPDATE))

        assert len(log.inserted) == 1
        assert log.inserted[0]["operation"] == "patch_one"
        assert log.inserted[0]["collection"] == Collection.TEAMS
        assert log.inserted[0]["document_id"] == TEAM_OID

    def test_a_single_document_patch_records_the_image_the_write_replaced(self):
        """The whole feature: a row holding the POST-image restores nothing, because it describes the state already stored."""
        target, log = build(before=BEFORE_DOCUMENT, after=AFTER_DOCUMENT)

        asyncio.run(patch_one_in_db(collection=as_collection(target), db_filter=FILTER, update=UPDATE))

        assert log.inserted[0]["before"] == BEFORE_DOCUMENT

    def test_a_single_document_patch_records_neither_a_filter_nor_a_count(self):
        """Both belong to the fan-out, and which of the two a row carries is how a reader tells a restorable write from a bulk one."""
        target, log = build(before=BEFORE_DOCUMENT, after=AFTER_DOCUMENT)

        asyncio.run(patch_one_in_db(collection=as_collection(target), db_filter=FILTER, update=UPDATE))

        assert log.inserted[0]["db_filter"] is None
        assert log.inserted[0]["modified_count"] is None

    def test_a_patch_matching_no_document_records_nothing(self):
        """A row for a write that never landed is a restore the page would offer over a document nobody touched."""
        target, log = build(before=None, after=None)

        with pytest.raises(DocumentNotFoundException):
            asyncio.run(patch_one_in_db(collection=as_collection(target), db_filter=FILTER, update=UPDATE))

        assert log.inserted == []

    def test_a_fan_out_records_one_row_however_many_documents_it_matched(self):
        """One row per write, never one per match: a club rename reaches every fixture that club ever played."""
        target, log = build(modified_count=MATCHED)

        asyncio.run(patch_many_in_db(collection=as_collection(target), db_filter=FILTER, update=UPDATE))

        assert len(log.inserted) == 1
        assert log.inserted[0]["operation"] == "patch_many"
        assert log.inserted[0]["modified_count"] == MATCHED

    def test_a_fan_out_records_the_filter_it_matched_on_and_no_prior_image(self):
        """It matched a filter rather than a document, so there is no single image to hold and nothing to name in `document_id`."""
        target, log = build(modified_count=MATCHED)

        asyncio.run(patch_many_in_db(collection=as_collection(target), db_filter=FILTER, update=UPDATE))

        assert log.inserted[0]["db_filter"] == {"saison_id": "2026", "team_id": str(TEAM_OID)}
        assert log.inserted[0]["before"] is None
        assert log.inserted[0]["document_id"] is None

    def test_a_create_records_one_row_naming_the_inserted_document(self):
        target, log = build()

        asyncio.run(post_one_to_db(collection=as_collection(target), document=CREATED_DOCUMENT))

        assert len(log.inserted) == 1
        assert log.inserted[0]["operation"] == "insert"
        assert log.inserted[0]["document_id"] == CREATED_OID

    def test_a_create_records_no_prior_image(self):
        """A null `before` is what tells the page this row offers a deletion to undo rather than a restore."""
        target, log = build()

        asyncio.run(post_one_to_db(collection=as_collection(target), document=CREATED_DOCUMENT))

        assert log.inserted[0]["before"] is None

    def test_a_bulk_create_records_one_row_however_many_documents_it_inserted(self):
        """One row per call, never one per document: a generated season is one action that writes its whole fixture draw."""
        target, log = build()

        asyncio.run(post_many_to_db(collection=as_collection(target), documents=CREATED_DOCUMENTS))

        assert len(log.inserted) == 1
        assert log.inserted[0]["operation"] == "insert_many"
        assert log.inserted[0]["modified_count"] == len(CREATED_DOCUMENTS)

    def test_a_bulk_create_names_no_document_and_no_prior_image(self):
        """It named no single document and replaced nothing, so the count is the whole of what the row can say."""
        target, log = build()

        asyncio.run(post_many_to_db(collection=as_collection(target), documents=CREATED_DOCUMENTS))

        assert log.inserted[0]["document_id"] is None
        assert log.inserted[0]["before"] is None
        assert log.inserted[0]["db_filter"] is None

    def test_a_bulk_create_hands_the_driver_the_documents_unchanged(self):
        """A helper editing what it was given would put a document into the database no caller composed."""
        target, _ = build()

        asyncio.run(post_many_to_db(collection=as_collection(target), documents=CREATED_DOCUMENTS))

        assert target.inserted == list(CREATED_DOCUMENTS)

    def test_the_row_travels_inside_the_session_the_write_used(self):
        """A row written outside an aborting transaction survives it, and the log then holds a write the database rolled back."""
        target, log = build(before=BEFORE_DOCUMENT, after=AFTER_DOCUMENT)

        asyncio.run(patch_one_in_db(collection=as_collection(target), db_filter=FILTER, update=UPDATE, session=SESSION))

        assert log.sessions == [SESSION]

    def test_a_bulk_create_carries_the_session_into_the_documents_and_the_row_alike(self):
        """The generator writes a whole season in one transaction, and a row landing outside it survives an abort the documents do not."""
        target, log = build()

        asyncio.run(post_many_to_db(collection=as_collection(target), documents=CREATED_DOCUMENTS, session=SESSION))

        assert target.sessions == [SESSION]
        assert log.sessions == [SESSION]


class TestWhoAndWhenARowIsAttributedTo:
    def test_a_write_outside_a_request_is_attributed_to_the_system_actor(self):
        """A migration, a script or a fixture records honestly rather than needing a branch at each recording site."""
        target, log = build()

        asyncio.run(record_write(collection=as_collection(target), operation="insert", document_id=TEAM_OID))

        assert log.inserted[0]["actor"] == {"kind": "system", "email": "SYSTEM"}
        assert log.inserted[0]["request"] is None

    def test_the_bound_administrator_and_route_reach_the_row(self):
        """The method and path are what let a reader see which kind of action ran, which the collection name alone cannot say."""
        target, log = build()

        record_inside_a_request(collection=as_collection(target), operation="patch_one", document_id=TEAM_OID)

        assert log.inserted[0]["actor"] == {"kind": "admin_session", "email": "admin@example.com"}
        assert log.inserted[0]["request"] == {"method": "PATCH", "path": "/api/v0/teams/{team_id}"}

    def test_the_row_carries_the_correlation_id_of_the_request_that_caused_it(self):
        """A fan-out's rows and the write behind them are one action on the page only because they share this id."""
        target, log = build()

        record_inside_a_request(collection=as_collection(target), operation="patch_many", modified_count=MATCHED)

        assert log.inserted[0]["correlation_id"] == CORRELATION_ID

    def test_the_timestamp_is_utc_and_carries_its_offset(self):
        """The log is ordered and ranged by this field, and a local-time string sorts October's two identical clock hours the wrong way."""
        target, log = build()

        asyncio.run(record_write(collection=as_collection(target), operation="insert", document_id=TEAM_OID))

        assert datetime.fromisoformat(log.inserted[0]["at"]).utcoffset() == timedelta(0)

    def test_a_fresh_row_is_not_yet_redacted(self):
        """Null means the row still holds what it recorded, and an absent key would read the same as a redaction to nothing."""
        target, log = build()

        asyncio.run(record_write(collection=as_collection(target), operation="insert", document_id=TEAM_OID))

        assert log.inserted[0]["redacted_at"] is None


class TestTheRowAndTheValidatorAgree:
    def test_a_recorded_row_carries_exactly_the_fields_the_validator_requires(self):
        """Row and `$jsonSchema` are hand-written from one shape, so without this a row short of a field is refused first in production."""
        target, log = build()

        asyncio.run(record_write(collection=as_collection(target), operation="insert", document_id=TEAM_OID))

        # `_id` is the driver's to add, and the one required field no row arrives carrying.
        assert set(log.inserted[0]) | {"_id"} == set(COLLECTION_VALIDATORS[Collection.AKTIONEN]["$jsonSchema"]["required"])

    def test_the_recorded_collection_name_is_one_the_validator_admits(self):
        target, log = build()

        asyncio.run(record_write(collection=as_collection(target), operation="insert", document_id=TEAM_OID))

        declared = COLLECTION_VALIDATORS[Collection.AKTIONEN]["$jsonSchema"]["properties"]["collection"]["enum"]
        assert log.inserted[0]["collection"] in declared


class TestStringifyFilter:
    def test_every_value_is_rendered_as_text(self):
        # A boolean is in the sample deliberately: `False` renders as text a reader could otherwise
        # mistake for a stored string, and the validator admits only strings.
        rendered = _stringify_filter({"team_id": TEAM_OID, "spiel_nr": 1, "is_captain": False, "saison_id": "2026"})

        assert rendered == {"team_id": str(TEAM_OID), "spiel_nr": "1", "is_captain": "False", "saison_id": "2026"}

    def test_an_objectid_survives_as_the_hex_string_that_names_it(self):
        """Most fan-outs match on one, and a reader comparing the row against a document has only this text to do it with."""
        assert _stringify_filter({"_id": TEAM_OID})["_id"] == "6890a1b2c3d4e5f607500001"

    def test_an_operator_becomes_text_rather_than_a_nested_document(self):
        """Stored for the reader rather than for replay: a validator admitting a nested operator admits anything at all."""
        rendered = _stringify_filter({"_id": {"$in": [TEAM_OID]}})

        assert rendered == {"_id": str({"$in": [TEAM_OID]})}

    def test_a_dotted_key_is_left_as_the_field_path_it_names(self):
        """Every reference fan-out matches on one -- `ort.spielort_id`, `team1.team_id` -- so a mangled key would hide what a rename touched."""
        assert _stringify_filter({"ort.spielort_id": TEAM_OID}) == {"ort.spielort_id": str(TEAM_OID)}
