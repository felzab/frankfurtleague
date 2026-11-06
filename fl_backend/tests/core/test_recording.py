from __future__ import annotations

import asyncio
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Any, cast

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.results import InsertManyResult, InsertOneResult

from app.core.collections import Collection
from app.core.crud import patch_one_in_db, post_many_to_db, post_one_to_db
from app.core.recording import Actor, actor_var, build_image_redactions, log_stamp, record_write, request_var

# Fixed rather than generated, so a failing test names the same document every run.
TEAM_OID = ObjectId("6890a1b2c3d4e5f607500001")
CREATED_OID = ObjectId("6890a1b2c3d4e5f607500002")

# The two images share no value, so a row holding the wrong one cannot pass by resembling the right one.
BEFORE_DOCUMENT: Mapping[str, Any] = {"_id": TEAM_OID, "name": "Lessing", "shorthand": "LEX"}
AFTER_DOCUMENT: Mapping[str, Any] = {"_id": TEAM_OID, "name": "Lessing-Gymnasium", "shorthand": "LGX"}

CREATED_DOCUMENT: Mapping[str, Any] = {"_id": CREATED_OID, "name": "Carl-Schurz", "shorthand": "CSX"}

# None carries an `_id`: a generated fixture leaves those to the driver.
CREATED_DOCUMENTS: Sequence[Mapping[str, Any]] = [{"name": f"Club {index}", "shorthand": f"CL{chr(65 + index)}"} for index in range(5)]

FILTER: Mapping[str, Any] = {"saison_id": "2026", "team_id": TEAM_OID}
UPDATE: Mapping[str, Any] = {"$set": {"name": "Lessing-Gymnasium"}}

ADMIN_ACTOR = Actor(kind="admin_session", email="admin@example.com")

# The route TEMPLATE, which is the half of this pair the binder stores.
ROUTE = ("PATCH", "/api/v0/teams/{team_id}")

# Outside `EDITED_COLLECTIONS`, whose creates stamp a version (`app/core/crud.py`): the case reading
# what the helper passed on judges the recording alone.
UNVERSIONED = Collection.INVITATIONS

# A stand-in for the caller's session, outside a transaction: what is proved is that the row travels inside whatever the caller passed.
SESSION = cast(AsyncClientSession, SimpleNamespace(in_transaction=False))


class _FakeCollection:
    """One collection, called as `app/core/crud.py` and `app/core/recording.py` call the driver."""

    def __init__(
        self,
        name: str,
        *,
        before: Mapping[str, Any] | None = None,
        after: Mapping[str, Any] | None = None,
        log: _FakeCollection | None = None,
    ) -> None:
        self.name = str(name)
        self.before = before
        self.after = after
        self.inserted: list[Mapping[str, Any]] = []
        self.sessions: list[Any] = []
        # A collection reaches the log through its own database handle.
        self.database: dict[str, _FakeCollection] = {} if log is None else {Collection.ACTION_LOG: log}

    async def find_one(self, *, filter: Any, projection: Any = None, session: Any = None) -> Mapping[str, Any] | None:
        """The post-image: a patch re-reads for the caller's echo once the update has carried the pre-image out."""
        return self.after

    async def find_one_and_update(
        self, *, filter: Any, update: Any, session: Any = None, return_document: Any = None
    ) -> Mapping[str, Any] | None:
        """Answers the image it was asked for, as the driver does -- which is what makes the pre-image atomic."""
        return self.before if return_document is ReturnDocument.BEFORE else self.after

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

    log = _FakeCollection(Collection.ACTION_LOG)

    return _FakeCollection(name, log=log, **state), log


def as_collection(stub: _FakeCollection) -> AsyncCollection:
    return cast(AsyncCollection, stub)


def record_inside_a_request(**arguments: Any) -> None:
    """Bound inside the coroutine: `asyncio.run` runs it in a copied context, so nothing set here reaches another test."""

    async def _run() -> None:
        actor_var.set(ADMIN_ACTOR)
        request_var.set(ROUTE)
        await record_write(**arguments)

    asyncio.run(_run())


class TestWhatEachWriteRecords:
    def test_a_single_document_patch_records_one_row_naming_the_document(self):
        target, log = build(before=BEFORE_DOCUMENT, after=AFTER_DOCUMENT)

        asyncio.run(
            patch_one_in_db(
                collection=as_collection(target), db_filter=FILTER, update=UPDATE, expected_version=None, return_document=ReturnDocument.AFTER
            )
        )

        assert len(log.inserted) == 1
        assert log.inserted[0]["operation"] == "patch_one"
        assert log.inserted[0]["collection"] == Collection.TEAMS
        assert log.inserted[0]["document_id"] == TEAM_OID

    def test_a_single_document_patch_records_the_image_the_write_replaced(self):
        """The whole feature: a row holding the POST-image restores nothing, because it describes the state already stored."""
        target, log = build(before=BEFORE_DOCUMENT, after=AFTER_DOCUMENT)

        asyncio.run(
            patch_one_in_db(
                collection=as_collection(target), db_filter=FILTER, update=UPDATE, expected_version=None, return_document=ReturnDocument.AFTER
            )
        )

        assert log.inserted[0]["before"] == BEFORE_DOCUMENT

    def test_a_create_records_one_row_naming_the_inserted_document(self):
        target, log = build()

        asyncio.run(post_one_to_db(collection=as_collection(target), document=CREATED_DOCUMENT))

        assert len(log.inserted) == 1
        assert log.inserted[0]["operation"] == "insert"
        assert log.inserted[0]["document_id"] == CREATED_OID

    def test_a_bulk_create_hands_the_driver_the_documents_unchanged(self):
        """A helper editing what it was given would put a document into the database no caller composed."""
        target, _ = build(UNVERSIONED)

        asyncio.run(post_many_to_db(collection=as_collection(target), documents=CREATED_DOCUMENTS))

        assert target.inserted == list(CREATED_DOCUMENTS)

    def test_the_row_travels_inside_the_session_the_write_used(self):
        """A row written outside an aborting transaction survives it, and the log then holds a write the database rolled back."""
        target, log = build(before=BEFORE_DOCUMENT, after=AFTER_DOCUMENT)

        asyncio.run(
            patch_one_in_db(
                collection=as_collection(target),
                db_filter=FILTER,
                update=UPDATE,
                session=SESSION,
                expected_version=None,
                return_document=ReturnDocument.AFTER,
            )
        )

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

    def test_the_timestamp_is_utc_and_carries_its_offset(self):
        """The log is ordered and ranged by this field, and a local-time string sorts October's two identical clock hours the wrong way."""
        target, log = build()

        asyncio.run(record_write(collection=as_collection(target), operation="insert", document_id=TEAM_OID))

        assert datetime.fromisoformat(log.inserted[0]["at"]).utcoffset() == timedelta(0)

    def test_the_same_instant_is_stored_again_as_a_date(self):
        """A TTL index expires on a BSON date alone, so on `at`'s string it would expire nothing and report nothing."""
        target, log = build()

        asyncio.run(record_write(collection=as_collection(target), operation="insert", document_id=TEAM_OID))

        stamped = log.inserted[0]["at_date"]
        assert isinstance(stamped, datetime)
        assert stamped.utcoffset() == timedelta(0)
        # Compared rather than merely typed: read from the clock twice the two stamps straddle a
        # second, and the row then says the write happened at two instants.
        assert log_stamp(stamped) == log.inserted[0]["at"]


def their_seat(image: Mapping[str, Any]) -> Mapping[str, Any]:
    """A judge naming one person's seat in the images holding them."""

    return {"kontakte.trainer": None} if image.get("trainer") == "them" else {}


class TestAPerImageRedaction:
    def test_an_image_is_overwritten_where_the_judge_names_the_person_and_the_row_stamped(self):
        updates = build_image_redactions([{"_id": TEAM_OID, "before": {"trainer": "them"}}], judge=their_seat, at="stamp")

        assert updates == [([TEAM_OID], {"$set": {"before.kontakte.trainer": None, "redacted_at": "stamp"}})]

    def test_each_image_a_removal_kept_is_addressed_by_its_index(self):
        """A dotted path naming no index is refused inside an array, so the removal's row would abort the erasure."""

        rows = [{"_id": TEAM_OID, "before": [{"trainer": "somebody else"}, {"trainer": "them"}]}]

        assert build_image_redactions(rows, judge=their_seat, at="stamp") == [
            ([TEAM_OID], {"$set": {"before.1.kontakte.trainer": None, "redacted_at": "stamp"}})
        ]

    def test_a_row_naming_nobody_departing_is_left_unstamped(self):
        """A stamp on it would say a value went where every value stands as recorded."""

        rows = [{"_id": TEAM_OID, "before": {"trainer": "somebody else"}}, {"_id": CREATED_OID, "before": None}]

        assert build_image_redactions(rows, judge=their_seat, at="stamp") == []
