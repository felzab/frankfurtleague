import asyncio
import functools
import logging
import re
from collections.abc import AsyncIterator
from http import HTTPStatus
from typing import Any

import pytest
from bson import ObjectId
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient
from httpx2 import Response
from pydantic import BaseModel, Field, ValidationError
from pymongo.errors import BulkWriteError, PyMongoError, WriteError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.codes import Code
from app.core.exception_handlers import (
    ROUTING_CODES,
    db_exception_handler,
    pydantic_validation_exception_handler,
    register_exception_handlers,
)
from app.core.exceptions import APIError
from app.core.logging import JSONFormatter, TraceContextFilter
from app.core.middlewares import TracedApp
from app.main import create_app
from app.shared.schemas.custom import PERSON_NAME_PATTERN
from tests.config import BASE_AUTH, build_test_config
from tests.core.app_source import application

# Module level: building the app re-runs the logging dictConfig, which inside a test would strip the
# handler caplog attaches at setup.
APP = application()


def client() -> TestClient:
    # No context manager, so the lifespan must not run: a client that never opens the database makes
    # the first guarded read raise a real `DB-CONN-001` rather than a hand-mocked exception.
    return TestClient(APP, raise_server_exceptions=False)


def error_records(caplog) -> list[logging.LogRecord]:
    return [record for record in caplog.records if getattr(record, "error_code", None) is not None]


# The value the pattern below refuses. Distinctive, so its absence from a whole log document is
# evidence rather than coincidence.
REJECTED_MARKUP = "<script>"
REJECTED_NAME = f"Maximilian{REJECTED_MARKUP}"


class NamePayload(BaseModel):
    """A write payload's name field, carrying the pattern every real one carries."""

    vorname: str = Field(min_length=1, pattern=PERSON_NAME_PATTERN)


class NestedKontakt(BaseModel):
    email: str = Field(max_length=5)


class NestedPayload(BaseModel):
    """The two shapes a form path takes past a top-level key: a sub-object and a list entry."""

    kontakt: NestedKontakt
    namen: list[NamePayload]


# A second app: `APP`'s routes all 503 on the database dependency before parsing can fail, so a
# payload refusal needs a route that depends on nothing.
VALIDATION_APP = TracedApp()
register_exception_handlers(VALIDATION_APP)


@VALIDATION_APP.post("/nested")
async def refuse_a_nested_field(payload: NestedPayload) -> dict[str, bool]:
    """Never reached: every case posts a body the route refuses."""

    return {"ok": True}


# A code of a rule no route here enforces, so only this case's own route answers it.
PLANTED_REFUSAL = Code.RULES_GROUPS_IN_USE
JUDGED_PATH = ("kontakt", "email")


@VALIDATION_APP.post("/refused/{status}")
async def refuse_at(status: int) -> None:
    """Refuses at the status its path names, a 422 naming the body path it judged."""

    judged = (JUDGED_PATH,) if status == HTTPStatus.UNPROCESSABLE_CONTENT else ()
    raise APIError(HTTPStatus(status), PLANTED_REFUSAL, fields=judged)


@VALIDATION_APP.get("/starlette/{status}")
async def raise_starlettes_own(status: int) -> None:
    """Raises the base class the router raises, at the status its path names."""

    raise StarletteHTTPException(status_code=status)


def rejected_name_error() -> ValidationError:
    with pytest.raises(ValidationError) as refused:
        NamePayload(vorname=REJECTED_NAME)

    return refused.value


def logged_document(caplog) -> str:
    """The line as the sink receives it -- message and fields both, so nothing hides in a field."""

    records = error_records(caplog)
    assert len(records) == 1, records

    return JSONFormatter().format(records[0])


class TestFailureBodies:
    def test_missing_credentials_answer_names_its_code_and_id(self):
        response = client().get("/api/v0/spiele")

        assert response.status_code == 401
        body = response.json()
        assert body["error_code"] == Code.MISSING_TOKEN
        assert re.fullmatch(r"[a-f0-9]{32}", body["trace_id"])
        assert response.headers["WWW-Authenticate"] == "Bearer"

    def test_a_wrong_key_is_distinguishable_by_code(self):
        response = client().get("/api/v0/spiele", headers={"Authorization": "Bearer wrong"})

        assert (response.status_code, response.json()["error_code"]) == (401, Code.WRONG_BASE_KEY)

    def test_an_unavailable_database_is_503_with_its_code(self):
        response = client().get("/api/v0/spiele", headers=BASE_AUTH)

        assert (response.status_code, response.json()["error_code"]) == (503, Code.NO_DATABASE_CLIENT)

    def test_the_body_and_the_headers_carry_nothing_but_the_code_the_id_and_the_challenge(self):
        """`error_response` forwards `exc.headers` as well as the body, so either is a channel a message could leak through."""

        response = client().get("/api/v0/spiele")

        assert set(response.json()) == {"error_code", "trace_id"}
        # The exact set, so a message copied into any header, under any name, moves this.
        assert set(response.headers) == {"www-authenticate", "content-length", "content-type"}


def refused(body: object) -> dict[str, Any]:
    """The 422 a payload earns at `/nested`, asserted to BE one, so no case reads fields off a success."""

    response = TestClient(VALIDATION_APP, raise_server_exceptions=False).post("/nested", json=body)

    assert (response.status_code, response.json()["error_code"]) == (422, Code.PAYLOAD_REFUSED)
    return response.json()


class TestTheRefusedFieldsReachTheCaller:
    """A 422 names where each refusal sits, so a form marks that field."""

    def test_each_field_is_named_by_its_path_inside_the_body(self):
        body = refused({"kontakt": {"email": "far-too-long"}, "namen": [{"vorname": "Anna"}, {"vorname": REJECTED_NAME}]})

        # An integer rather than `"1"`: a caller joining the path gets the dotted name its input carries.
        assert body["fields"] == [
            {"in": "body", "path": ["kontakt", "email"], "kind": "string_too_long"},
            {"in": "body", "path": ["namen", 1, "vorname"], "kind": "string_pattern_mismatch"},
        ]

    def test_the_value_and_pydantics_english_stay_off_the_wire(self):
        body = refused({"kontakt": {"email": "a@b"}, "namen": [{"vorname": REJECTED_NAME}]})

        # The exact key sets, so a value or a message under any name moves this.
        assert set(body) == {"error_code", "trace_id", "fields"}
        assert [set(field) for field in body["fields"]] == [{"in", "path", "kind"}]
        assert REJECTED_NAME not in str(body)
        assert "String should match pattern" not in str(body)

    def test_an_undecodable_body_is_malformed_syntax_naming_no_field(self):
        """400 and no `fields`: nothing inside the body was read, so no field is at fault."""

        response = TestClient(VALIDATION_APP, raise_server_exceptions=False).post(
            "/nested", content=b'{"kontakt": ', headers={"content-type": "application/json"}
        )

        assert response.status_code == 400
        assert set(response.json()) == {"error_code", "trace_id"} and response.json()["error_code"] == Code.BODY_UNREADABLE


class TestARefusalIsAnsweredAtTheStatusItsCheckChose:
    def test_a_422_names_the_body_path_its_rule_judged_under_the_rule_s_own_code(self):
        response = TestClient(VALIDATION_APP, raise_server_exceptions=False).post(f"/refused/{int(HTTPStatus.UNPROCESSABLE_CONTENT)}")

        assert response.status_code == HTTPStatus.UNPROCESSABLE_CONTENT
        assert response.json()["fields"] == [{"in": "body", "path": list(JUDGED_PATH), "kind": PLANTED_REFUSAL}]

    def test_a_refusal_off_422_carries_no_fields(self):
        response = TestClient(VALIDATION_APP, raise_server_exceptions=False).post(f"/refused/{int(HTTPStatus.CONFLICT)}")

        assert (response.status_code, set(response.json())) == (409, {"error_code", "trace_id"})

    def test_fields_off_a_422_are_refused_where_the_refusal_is_built(self):
        """They would reach no body: only a 422's publishes `fields`."""

        with pytest.raises(ValueError, match=PLANTED_REFUSAL):
            APIError(HTTPStatus.CONFLICT, PLANTED_REFUSAL, fields=(JUDGED_PATH,))

    @pytest.mark.parametrize("status", sorted(ROUTING_CODES))
    def test_each_status_the_routing_layer_raises_answers_its_own_code(self, status: int):
        response = TestClient(VALIDATION_APP, raise_server_exceptions=False).get(f"/starlette/{status}")

        assert (response.status_code, response.json()["error_code"]) == (status, ROUTING_CODES[status])


def access_codes(caplog, request: Any) -> list[Any]:
    """Each access line's code for one request, read off the line the middleware writes."""

    with caplog.at_level(logging.INFO, logger="frankfurtleague"):
        request()

    return [getattr(record, "error_code", None) for record in caplog.records if getattr(record, "method", None) is not None]


class TestTheAccessLineCarriesTheRefusal:
    """A refusal writes no line of its own, so the access line is the one record of which code a request answered."""

    def test_a_refusal_s_code_rides_its_access_line(self, caplog):
        assert access_codes(caplog, lambda: client().get("/api/v0/spiele")) == [Code.MISSING_TOKEN]

    def test_a_success_s_access_line_carries_no_code(self, caplog):
        assert access_codes(caplog, lambda: client().get("/")) == [None]


# The values the two reports below carry. Distinctive, so absence from a whole log document is
# evidence rather than coincidence.
REFUSED_CONSENT_SCOPE = "Quillfeather-Kaderoeffentlich"
REFUSED_SPIELER_OID = "6890a1b2c3d4e5f60fff0016"

# A refusal in the shape `mongod` 8 reports it, taken from a real one. A hand-shortened copy would
# prove the handler against a report the server never sends.
REFUSED_DOCUMENT_REPORT: dict[str, Any] = {
    "index": 0,
    "code": 121,
    "errmsg": "Document failed validation",
    "errInfo": {
        "failingDocumentId": ObjectId("6890a1b2c3d4e5f60fff0011"),
        "details": {
            "operatorName": "$jsonSchema",
            "schemaRulesNotSatisfied": [
                {
                    "operatorName": "properties",
                    "propertiesNotSatisfied": [
                        {
                            "propertyName": "einwilligung",
                            "details": [
                                {
                                    "operatorName": "properties",
                                    "propertiesNotSatisfied": [
                                        {
                                            "propertyName": "umfang",
                                            "details": [
                                                {
                                                    "operatorName": "enum",
                                                    "specifiedAs": {"enum": ["kader_oeffentlich", "intern"]},
                                                    "reason": "value was not found in enum",
                                                    "consideredValue": REFUSED_CONSENT_SCOPE,
                                                }
                                            ],
                                        }
                                    ],
                                }
                            ],
                        }
                    ],
                },
                {
                    "operatorName": "required",
                    "specifiedAs": {"required": ["_id", "vorname", "nachname", "einwilligung", "inactive_since"]},
                    "missingProperties": ["nachname"],
                },
            ],
        },
    },
}

# A validator's refusal inside a batch, carrying the `op` the driver adds: the whole document it
# tried to write.
REFUSED_BULK_INSERT_REPORT: dict[str, Any] = {
    "writeErrors": [
        {
            **REFUSED_DOCUMENT_REPORT,
            "op": {
                "_id": ObjectId(REFUSED_SPIELER_OID),
                "vorname": "Anna",
                "einwilligung": {"umfang": REFUSED_CONSENT_SCOPE},
                "inactive_since": None,
            },
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

# The same refusal with an ARRAY of documents as the refused value, each shaped like a report: a walk
# reading every key would descend into these, where a value of any other shape would slip past unseen.
REFUSED_SUBDOCUMENT_REPORT: dict[str, Any] = {
    "index": 0,
    "code": 121,
    "errmsg": "Document failed validation",
    "errInfo": {
        "failingDocumentId": ObjectId("6890a1b2c3d4e5f60fff0011"),
        "details": {
            "operatorName": "$jsonSchema",
            "schemaRulesNotSatisfied": [
                {
                    "operatorName": "properties",
                    "propertiesNotSatisfied": [
                        {
                            "propertyName": "einwilligung",
                            "details": [
                                {
                                    "operatorName": "bsonType",
                                    "specifiedAs": {"bsonType": "object"},
                                    "reason": "type did not match",
                                    "consideredValue": [{"propertyName": "umfang", "reason": REFUSED_CONSENT_SCOPE}],
                                    "consideredType": "object",
                                }
                            ],
                        }
                    ],
                }
            ],
        },
    },
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
        assert "vorname" in document and "string_pattern_mismatch" in document and Code.STORED_DATA_INVALID in document

    def test_a_validator_s_refusal_names_its_property_and_never_its_value(self, caplog):
        document = database_crash_document(caplog, WriteError("Document failed validation", 121, REFUSED_DOCUMENT_REPORT))

        assert REFUSED_CONSENT_SCOPE not in document
        # The key the server puts the value under: naming it would fail this even for a value the test cannot guess.
        assert "consideredValue" not in document
        # The dotted path, not the leaf, and the second rule in the same report.
        assert "einwilligung.umfang" in document and "value was not found in enum" in document and "nachname" in document
        assert Code.DATABASE_FAILED in document

    def test_the_walk_never_descends_into_the_refused_value(self, caplog):
        """Catches widening the report keys walked to the ones a refused value sits under."""

        document = database_crash_document(caplog, WriteError("Document failed validation", 121, REFUSED_SUBDOCUMENT_REPORT))

        assert REFUSED_CONSENT_SCOPE not in document
        # Still reported, so this cannot pass by the walk having found nothing at all.
        assert "einwilligung" in document and "type did not match" in document

    def test_a_bulk_write_s_refused_document_never_reaches_the_line(self, caplog):
        document = database_crash_document(caplog, BulkWriteError(REFUSED_BULK_INSERT_REPORT))

        # `op` holds the refused value a second time, beside the validator's `consideredValue`.
        assert REFUSED_SPIELER_OID not in document and REFUSED_CONSENT_SCOPE not in document
        assert "einwilligung.umfang" in document


TRACEPARENT = f"00-{'c0ffee00' * 4}-{'ab' * 8}-01"


class TestTraceContext:
    def test_a_well_formed_traceparent_s_trace_id_reaches_the_failure_body(self):
        response = client().get("/api/v0/spiele", headers={"traceparent": TRACEPARENT, **BASE_AUTH})

        assert response.json()["trace_id"] == "c0ffee00" * 4

    def test_nothing_is_echoed_on_the_response(self):
        """The failure body is the one channel handing the id back: a response header would put it where nothing reads it."""
        response = client().get("/api/v0/spiele", headers={"traceparent": TRACEPARENT, **BASE_AUTH})

        assert not {"traceparent", "x-correlation-id"} & {name.lower() for name in response.headers}

    def test_a_malformed_traceparent_is_replaced_not_honoured(self):
        response = client().get("/api/v0/spiele", headers={"traceparent": "NOT/AN/ID", **BASE_AUTH})

        minted = response.json()["trace_id"]
        assert minted != "NOT/AN/ID"
        assert re.fullmatch(r"[a-f0-9]{32}", minted)

    def test_the_retired_header_is_read_by_nothing(self):
        """A hop still sending the old header must find it ignored rather than honoured: it carries no span and no version."""
        response = client().get("/api/v0/spiele", headers={"X-Correlation-ID": "c0ffee00" * 4, **BASE_AUTH})

        assert response.json()["trace_id"] != "c0ffee00" * 4


class TestAccessLine:
    def test_every_request_writes_one_line_with_both_ids_and_timing(self, caplog):
        with caplog.at_level(logging.INFO, logger="frankfurtleague"):
            client().get("/", headers={"traceparent": TRACEPARENT})

        lines = [record for record in caplog.records if getattr(record, "method", None) is not None]
        assert len(lines) == 1
        line = lines[0]
        assert line.method == "GET"
        assert line.path == "/"
        assert line.status == 200
        assert isinstance(line.duration_ms, float)
        assert line.trace_id == "c0ffee00" * 4

    def test_the_query_string_is_part_of_the_logged_path(self, caplog):
        with caplog.at_level(logging.INFO, logger="frankfurtleague"):
            client().get("/api/v0/spiele", params={"limit": 5}, headers=BASE_AUTH)

        paths = [record.path for record in caplog.records if getattr(record, "path", None)]
        assert "/api/v0/spiele?limit=5" in paths


async def crash() -> None:
    raise KeyError("verwaltung")


async def break_after_the_status() -> StreamingResponse:
    async def body() -> AsyncIterator[bytes]:
        yield b"{"
        raise RuntimeError("the body failed after its status was sent")

    return StreamingResponse(body())


@functools.cache
def _crashing_app() -> FastAPI:
    """The shipped stack around two routes that fail: an app of its own, `APP` being every module's.

    Built on first use rather than at import, which every xdist worker pays at collection.
    """

    crashing = create_app(build_test_config())
    crashing.add_api_route("/crash", crash)
    crashing.add_api_route("/broken-stream", break_after_the_status)

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

    def test_the_failure_body_quotes_the_request_s_trace_id(self, caplog):
        response, _ = _crashed(caplog, "/crash")

        assert (response.status_code, response.json()) == (500, {"error_code": Code.UNHANDLED_CRASH, "trace_id": "c0ffee00" * 4})

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
