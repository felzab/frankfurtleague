import asyncio
import functools
import logging
import re
from collections.abc import AsyncIterator
from typing import Any

import pytest
from bson import ObjectId
from fastapi import Depends, FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient
from httpx2 import Response
from pydantic import BaseModel, Field, ValidationError
from pymongo.errors import BulkWriteError, NetworkTimeout, PyMongoError

from app.api.registrierungen.schemas import FLRegistrierungenFilterParams
from app.core.codes import Code
from app.core.exception_handlers import (
    db_exception_handler,
    pydantic_validation_exception_handler,
    register_exception_handlers,
)
from app.core.logging import JSONFormatter, TraceContextFilter
from app.core.middlewares import TracedApp
from app.core.routing import SAFE, SAFE_WHEN
from app.main import create_app
from app.shared.schemas.custom import PERSON_NAME_PATTERN
from tests.config import BASE_AUTH, build_test_config
from tests.core.app_source import application

# Module level: building the app re-runs the logging dictConfig, which inside a test would strip the
# handler caplog attaches at setup.
APP = application()


def client() -> TestClient:
    # No context manager, so the lifespan must not run: a client that never opens the database makes
    # the first guarded read raise a real `no_database_client` rather than a hand-mocked exception.
    return TestClient(APP, raise_server_exceptions=False)


# A base-tier read that reaches the database, so a request passing the key meets the missing client.
GUARDED_READ = "/api/v0/saisons/frame"


def error_records(caplog) -> list[logging.LogRecord]:
    return [record for record in caplog.records if getattr(record, "error_code", None) is not None]


# The value the pattern below refuses. Distinctive, so its absence from a whole log document is
# evidence rather than coincidence.
REJECTED_MARKUP = "<script>"
REJECTED_NAME = f"Maximilian{REJECTED_MARKUP}"


class NamePayload(BaseModel):
    """A write payload's name field, carrying the pattern every real one carries."""

    first_name: str = Field(min_length=1, pattern=PERSON_NAME_PATTERN)


class NestedKontakt(BaseModel):
    email: str = Field(max_length=5)


class NestedPayload(BaseModel):
    """The two shapes a form path takes past a top-level key: a sub-object and a list entry."""

    kontakt: NestedKontakt
    names: list[NamePayload]


# A second app: `APP`'s routes all 503 on the database dependency before parsing can fail, so a
# payload refusal needs a route that depends on nothing, and so does a success that writes its access line.
VALIDATION_APP = TracedApp()
register_exception_handlers(VALIDATION_APP)
ANSWERED_PATH = "/answered"


@VALIDATION_APP.get(ANSWERED_PATH)
async def answer() -> dict[str, bool]:
    return {"ok": True}


@VALIDATION_APP.post("/nested")
async def refuse_a_nested_field(payload: NestedPayload) -> dict[str, bool]:
    """Never reached: every case posts a body the route refuses."""

    return {"ok": True}


FILTERED_PATH = "/filtered"


@VALIDATION_APP.get(FILTERED_PATH)
async def read_the_query(filters: FLRegistrierungenFilterParams = Depends()) -> dict[str, str]:
    """The pending list's query, declared as its route declares it, naming the type its `team_id` reached it as."""

    return {"team_id": type(filters.team_id).__name__}


def rejected_name_error() -> ValidationError:
    with pytest.raises(ValidationError) as refused:
        NamePayload(first_name=REJECTED_NAME)

    return refused.value


def logged_document(caplog) -> str:
    """The line as the sink receives it -- message and fields both, so nothing hides in a field."""

    records = error_records(caplog)
    assert len(records) == 1, records

    return JSONFormatter().format(records[0])


class TestFailureBodies:
    def test_the_body_and_the_headers_carry_nothing_but_the_code_the_id_and_the_challenge(self):
        """`error_response` forwards `exc.headers` as well as the body, so either is a channel a message could leak through."""

        response = client().get(GUARDED_READ)

        assert (set(response.json()), response.json()["fields"]) == ({"error_code", "trace_id", "fields"}, [])
        # The exact set, so a message copied into any header, under any name, moves this.
        assert set(response.headers) == {"www-authenticate", "content-length", "content-type"}


def refused(body: object) -> dict[str, Any]:
    """The 422 a payload earns at `/nested`, asserted to BE one, so no case reads fields off a success."""

    response = TestClient(VALIDATION_APP, raise_server_exceptions=False).post("/nested", json=body)

    assert (response.status_code, response.json()["error_code"]) == (422, Code.PAYLOAD_REFUSED)
    return response.json()


class TestTheRefusedFieldsReachTheCaller:
    """A 422 names where each refusal sits and what kind it is, and nothing the caller sent."""

    def test_the_value_and_pydantics_english_stay_off_the_wire(self):
        body = refused({"kontakt": {"email": "a@b"}, "names": [{"first_name": REJECTED_NAME}]})

        # The exact key sets, so a value or a message under any name moves this.
        assert set(body) == {"error_code", "trace_id", "fields"}
        assert [set(field) for field in body["fields"]] == [{"in", "path", "kind", "ctx"}]
        assert REJECTED_NAME not in str(body)
        assert "String should match pattern" not in str(body)


QUERY_ID = "6890a1b2c3d4e5f607182930"

# Each malformed a different way: `ObjectId` tests length before it decodes hex, so the third is refused on its characters.
MALFORMED_QUERY_IDS = ["not-an-id", QUERY_ID[:-1], "z" * 24, f"{QUERY_ID}0"]


class TestAMalformedQueryIdIsARefusedPayload:
    """A query validates, so a malformed id is a 422, never the 404 a path's would be (`tests/api/test_malformed_ids.py`)."""

    @pytest.mark.parametrize("team_id", MALFORMED_QUERY_IDS)
    def test_a_malformed_query_id_is_a_422(self, team_id: str):
        response = TestClient(VALIDATION_APP, raise_server_exceptions=False).get(FILTERED_PATH, params={"team_id": team_id})

        assert (response.status_code, response.json()["error_code"]) == (422, Code.PAYLOAD_REFUSED)


# The values the report below carries. Distinctive, so absence from a whole log document is
# evidence rather than coincidence.
REFUSED_FIRST_NAME = "Quillfeather"
REFUSED_SPIELER_OID = "6890a1b2c3d4e5f60fff0016"

# A unique index refusing one document of a batch: the server's message and `keyValue` quote the
# key, and the `op` the driver adds is the whole document it tried to write.
REFUSED_BULK_INSERT_REPORT: dict[str, Any] = {
    "writeErrors": [
        {
            "index": 0,
            "code": 11000,
            "errmsg": (
                "E11000 duplicate key error collection: frankfurtleague.spieler index: _id_ dup key: "
                f"{{ _id: ObjectId('{REFUSED_SPIELER_OID}') }}"
            ),
            "keyPattern": {"_id": 1},
            "keyValue": {"_id": ObjectId(REFUSED_SPIELER_OID)},
            "op": {"_id": ObjectId(REFUSED_SPIELER_OID), "first_name": REFUSED_FIRST_NAME, "inactive_since": None},
        }
    ],
    "writeConcernErrors": [],
    "nInserted": 1,
    "nUpserted": 0,
    "nMatched": 0,
    "nModified": 0,
    "nRemoved": 0,
    "upserted": [],
}


def database_crash_document(caplog, exc: PyMongoError) -> str:
    """The line the database handler writes for one live exception."""

    with caplog.at_level(logging.ERROR, logger="frankfurtleague"):
        try:
            raise exc
        except PyMongoError as live:
            asyncio.run(db_exception_handler(Request({"type": "http", "method": "GET", "headers": []}), live))

    return logged_document(caplog)


class TestAServerFaultsLineWithholdsTheValue:
    """The 5xx line names the field and the rule, with the value gone.

    A person's erasure reaches no log sink, so a value written there outlives them. Asserted on the
    LOG, never the wire: the body carries no value, so a wire test passes whatever the handler writes.
    """

    def test_a_refused_stored_document_names_its_field_and_never_its_value(self, caplog):
        with caplog.at_level(logging.ERROR, logger="frankfurtleague"):
            asyncio.run(pydantic_validation_exception_handler(None, rejected_name_error()))  # type: ignore[arg-type]

        document = logged_document(caplog)
        assert REJECTED_NAME not in document and REJECTED_MARKUP not in document
        assert "first_name" in document and "string_pattern_mismatch" in document and Code.STORED_DATA_INVALID in document

    def test_a_bulk_write_s_refused_document_never_reaches_the_line(self, caplog):
        document = database_crash_document(caplog, BulkWriteError(REFUSED_BULK_INSERT_REPORT))

        assert REFUSED_SPIELER_OID not in document and REFUSED_FIRST_NAME not in document
        # Still the handler's own line, so this cannot pass by no line having been written.
        assert Code.DATABASE_FAILED in document and "BulkWriteError" in document


TRACEPARENT = f"00-{'c0ffee00' * 4}-{'ab' * 8}-01"


class TestTraceContext:
    def test_a_well_formed_traceparent_s_trace_id_reaches_the_failure_body(self):
        response = client().get(GUARDED_READ, headers={"traceparent": TRACEPARENT, **BASE_AUTH})

        assert response.json()["trace_id"] == "c0ffee00" * 4

    def test_a_malformed_traceparent_is_replaced_not_honoured(self):
        response = client().get(GUARDED_READ, headers={"traceparent": "NOT/AN/ID", **BASE_AUTH})

        minted = response.json()["trace_id"]
        assert minted != "NOT/AN/ID"
        assert re.fullmatch(r"[a-f0-9]{32}", minted)


class TestAccessLine:
    def test_every_request_writes_one_line_with_its_trace_id_and_timing(self, caplog):
        with caplog.at_level(logging.INFO, logger="frankfurtleague"):
            TestClient(VALIDATION_APP).get(ANSWERED_PATH, headers={"traceparent": TRACEPARENT})

        lines = [record for record in caplog.records if getattr(record, "method", None) is not None]
        assert len(lines) == 1
        line = lines[0]
        assert line.method == "GET"
        assert line.path == ANSWERED_PATH
        assert line.status == 200
        assert isinstance(line.duration_ms, float)
        assert line.trace_id == "c0ffee00" * 4


async def crash() -> None:
    raise KeyError("admin_tier")


async def break_after_the_status() -> StreamingResponse:
    async def body() -> AsyncIterator[bytes]:
        yield b"{"
        raise RuntimeError("the body failed after its status was sent")

    return StreamingResponse(body())


async def cut_by_the_deadline() -> None:
    raise NetworkTimeout("the request's deadline cut the command")


@functools.cache
def _crashing_app() -> FastAPI:
    """The shipped stack around routes that fail: an app of its own, `APP` being every module's.

    Built on first use rather than at import, which every xdist worker pays at collection.
    """

    crashing = create_app(build_test_config())
    crashing.add_api_route("/crash", crash)
    crashing.add_api_route("/broken-stream", break_after_the_status)
    # Marked as the application's routes are, so the deadline's answer is judged by the route the router matched.
    crashing.add_api_route("/cut-read", cut_by_the_deadline, methods=["POST"], openapi_extra=SAFE)
    crashing.add_api_route("/cut-save", cut_by_the_deadline, methods=["PATCH"], openapi_extra=SAFE_WHEN)

    return crashing


@pytest.fixture(scope="module", autouse=True)
def _built_before_any_case() -> None:
    """Never inside a case: a build re-runs the logging `dictConfig`, which strips the handler `caplog` reads that case's records from."""

    _crashing_app()


CRASHES = [
    pytest.param("/crash", 500, id="a crash no handler answers"),
    pytest.param("/broken-stream", 200, id="a body failing after its status was sent"),
]


def _crashed(caplog: pytest.LogCaptureFixture, path: str) -> tuple[Response, list[Any]]:
    # The filter the console handler stamps each line with, so a record carries the ids the sink would read.
    caplog.handler.addFilter(TraceContextFilter())
    with caplog.at_level(logging.INFO, logger="frankfurtleague"):
        response = TestClient(_crashing_app(), raise_server_exceptions=False).get(path, headers={"traceparent": TRACEPARENT})

    return response, caplog.records


class TestACrashIsAnsweredInsideItsRequest:
    """Starlette runs the catch-all handler in its outermost layer.

    So the handler reads the request's ids only where they are bound around that layer.
    """

    @pytest.mark.parametrize(("path", "status"), CRASHES)
    def test_the_crash_line_carries_the_access_line_s_ids(self, caplog, path: str, status: int):
        _, records = _crashed(caplog, path)
        access = [(record.status, record.trace_id) for record in records if getattr(record, "method", None) is not None]
        # Never the access line, which carries the same code once the failure body records it.
        crashes = [
            (record.trace_id,)
            for record in records
            if getattr(record, "error_code", None) == Code.UNHANDLED_CRASH and not hasattr(record, "method")
        ]

        assert [line[:2] for line in access] == [(status, "c0ffee00" * 4)]
        assert crashes == [access[0][1:]]


CUTS = [
    pytest.param("POST", "/cut-read", Code.DATABASE_FAILED, id="a read over POST, marked safe"),
    pytest.param("PATCH", "/cut-save?dry_run=true", Code.DATABASE_FAILED, id="a save's dry run, marked safe when asked for"),
    pytest.param("PATCH", "/cut-save", Code.UNKNOWN_OUTCOME, id="the same save, which may have written"),
    # Present and false is a save: a mark read by presence would judge it safe and send the person to repeat it.
    pytest.param("PATCH", "/cut-save?dry_run=false", Code.UNKNOWN_OUTCOME, id="the same save, its dry run declined"),
]


@pytest.mark.parametrize(("method", "path", "code"), CUTS)
def test_a_deadline_s_cut_is_of_unknown_outcome_only_where_the_request_could_write(method: str, path: str, code: Code):
    """A cut read answered unknown tells the person a view may have saved something.

    The frontend reads the same marks for its own lost answers.
    """

    response = TestClient(_crashing_app(), raise_server_exceptions=False).request(method, path)

    assert (response.status_code, response.json()["error_code"]) == (500, code)
