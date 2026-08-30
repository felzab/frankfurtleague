import asyncio
import logging
import re
from typing import Any

import pytest
from bson import ObjectId
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field, ValidationError
from pymongo.errors import BulkWriteError, PyMongoError, WriteError

from app.core.exception_handlers import (
    motor_db_exception_handler,
    pydantic_validation_exception_handler,
    register_exception_handlers,
)
from app.core.logging import JSONFormatter
from app.core.middlewares import CorrelationIdMiddleware
from app.main import create_app
from app.shared.schemas.custom import PERSON_NAME_PATTERN
from tests.config import build_test_config

# Module level: building the app re-runs the logging dictConfig, which inside a test would strip the
# handler caplog attaches at setup.
APP = create_app(build_test_config())

BASE_AUTH = {"Authorization": "Bearer test-key-base"}


def client() -> TestClient:
    # No context manager, so the lifespan must not run: a client that never opens the database makes
    # the first guarded read raise a real `DB-CONN-001` rather than a hand-mocked exception.
    return TestClient(APP, raise_server_exceptions=False)


def error_records(caplog) -> list[logging.LogRecord]:
    return [record for record in caplog.records if getattr(record, "error_code", None) is not None]


# The value the pattern below refuses. Distinctive, so its absence from a whole log document is
# evidence rather than coincidence.
REJECTED_NAME = "Maximilian<script>"


class NamePayload(BaseModel):
    """A write payload's name field, carrying the pattern every real one carries."""

    vorname: str = Field(min_length=1, pattern=PERSON_NAME_PATTERN)


# A second app: `APP`'s routes all 503 on the database dependency before parsing can fail, so a
# payload rejection needs a route that depends on nothing.
VALIDATION_APP = FastAPI()
register_exception_handlers(VALIDATION_APP)
VALIDATION_APP.add_middleware(CorrelationIdMiddleware)


@VALIDATION_APP.post("/name")
async def refuse_a_name(payload: NamePayload) -> dict[str, bool]:
    """Never reached: the pattern refuses the only body the tests post."""

    return {"ok": True}


def rejected_name_error() -> ValidationError:
    with pytest.raises(ValidationError) as refused:
        NamePayload(vorname=REJECTED_NAME)

    return refused.value


def logged_document(caplog) -> str:
    """The line as the sink receives it -- message and extras both, so nothing hides in a field."""

    records = error_records(caplog)
    assert len(records) == 1, records

    return JSONFormatter().format(records[0])


class TestFailureBodies:
    def test_missing_credentials_answer_names_its_code_and_id(self):
        response = client().get("/api/v0/spiele")

        assert response.status_code == 401
        body = response.json()
        assert body["error_code"] == "REQ-AUTH-001"
        assert re.fullmatch(r"[a-f0-9]{32}", body["correlation_id"])
        assert response.headers["WWW-Authenticate"] == "Bearer"

    def test_a_wrong_key_is_distinguishable_by_code(self):
        response = client().get("/api/v0/spiele", headers={"Authorization": "Bearer wrong"})

        assert response.status_code == 401
        assert response.json()["error_code"] == "REQ-AUTH-002"

    def test_an_unavailable_database_is_503_with_dbconn001(self):
        response = client().get("/api/v0/spiele", headers=BASE_AUTH)

        assert response.status_code == 503
        assert response.json()["error_code"] == "DB-CONN-001"
        assert response.headers["Retry-After"] == "30"

    def test_a_request_validation_failure_maps_to_reqval001(self):
        # Invoked directly: a lifespan-less client 503s on the database dependency before query parsing
        # can fail, so the routed path cannot reach this handler. The handler ignores its request.
        import asyncio
        import json as jsonlib

        from fastapi.exceptions import RequestValidationError

        from app.core.exception_handlers import request_validation_exception_handler

        response = asyncio.run(request_validation_exception_handler(None, RequestValidationError([])))  # type: ignore[arg-type]

        assert response.status_code == 422
        assert jsonlib.loads(bytes(response.body))["error_code"] == "REQ-VAL-001"

    def test_the_body_carries_nothing_but_the_code_and_the_id(self):
        body = client().get("/api/v0/spiele").json()

        # Messages, validation details and stack traces belong to the log, never the wire.
        assert set(body) == {"error_code", "correlation_id"}

    def test_no_header_carries_the_message_either(self):
        """The other channel out: `error_response` forwards `exc.headers`, so a leak is one line away.

        Pinning the body alone leaves that line invisible, and a header reaches every proxy between
        (`docs/logging/spec.md :: L9`).
        """

        response = client().get("/api/v0/spiele")

        # The exact SET, not a search for words: a message copied into any header, under any name,
        # moves this. `www-authenticate` is the one header this exception is allowed to add.
        assert response.status_code == 401
        assert set(response.headers) == {"www-authenticate", "content-length", "content-type", "x-correlation-id"}

        # Named too, so the case cannot pass on a set that matched while a value leaked: this is
        # the message the 401 above actually carries.
        assert "does not exist or is not valid" not in " ".join(response.headers.values())


class TestErrorCodeLogging:
    def test_the_logged_code_is_the_exceptions_own(self, caplog):
        # A `getattr` fallback in the handler would log every `BaseAPIException` as one fixed string
        # (`docs/logging/error-codes.md`).
        with caplog.at_level(logging.WARNING, logger="frankfurtleague"):
            client().get("/api/v0/spiele")

        codes = [getattr(record, "error_code", None) for record in error_records(caplog)]
        assert "REQ-AUTH-001" in codes
        assert "API_ERROR" not in codes


# The values the two reports below carry. Distinctive, so absence from a whole log document is
# evidence rather than coincidence.
REFUSED_CONSENT_SOURCE = "Quillfeather-Erziehungsberechtigt"
REFUSED_SPIELER_OID = "6890a1b2c3d4e5f60fff0016"

# Two refusals in the shape `mongod` 8 reports them, taken from real ones. A hand-shortened copy
# would prove the handler against a report the server never sends.
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
                                            "propertyName": "erteilt_von",
                                            "details": [
                                                {
                                                    "operatorName": "enum",
                                                    "specifiedAs": {"enum": ["erziehungsberechtigt", "volljaehrig", "bestandsuebernahme"]},
                                                    "reason": "value was not found in enum",
                                                    "consideredValue": REFUSED_CONSENT_SOURCE,
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

REFUSED_BULK_INSERT_REPORT: dict[str, Any] = {
    "writeErrors": [
        {
            "index": 1,
            "code": 11000,
            "errmsg": (
                "E11000 duplicate key error collection: fl_test.saison_spieler index: uniq_spieler_id_saison_id"
                f" dup key: {{ spieler_id: ObjectId('{REFUSED_SPIELER_OID}'), saison_id: \"2026\" }}"
            ),
            "keyPattern": {"spieler_id": 1, "saison_id": 1},
            "keyValue": {"spieler_id": ObjectId(REFUSED_SPIELER_OID), "saison_id": "2026"},
            "op": {
                "spieler_id": ObjectId(REFUSED_SPIELER_OID),
                "saison_id": "2026",
                "team_id": ObjectId("6890a1b2c3d4e5f60fff0013"),
                "is_nachgetragen": False,
                "rolle": None,
                "stufe": "Q1",
                "position": "Tor",
                "nummer": "99",
                "inactive_since": None,
                "_id": ObjectId("6890a1b2c3d4e5f60fff0018"),
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
                                    "consideredValue": [{"propertyName": "erteilt_von", "reason": REFUSED_CONSENT_SOURCE}],
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
    """The line the database handler writes, with the exception LIVE.

    Raised rather than handed over: `exc_info` reads `sys.exc_info()`, so an unraised exception
    renders no traceback and a test on one could not see the message a traceback repeats.
    """

    with caplog.at_level(logging.ERROR, logger="frankfurtleague"):
        try:
            raise exc
        except PyMongoError as live:
            asyncio.run(motor_db_exception_handler(None, live))  # type: ignore[arg-type]

    return logged_document(caplog)


class TestValidationLoggingWithholdsTheValue:
    """The refusal reaches the log naming its field, with the value gone (`docs/logging/spec.md :: L9`).

    Asserted on the LOG, never the wire: the body carries only the code and the id, so a wire test
    passes whatever the handler writes.
    """

    def test_a_refused_payload_value_never_reaches_the_line(self, caplog):
        with caplog.at_level(logging.WARNING, logger="frankfurtleague"):
            response = TestClient(VALIDATION_APP, raise_server_exceptions=False).post("/name", json={"vorname": REJECTED_NAME})

        assert response.status_code == 422
        document = logged_document(caplog)
        assert REJECTED_NAME not in document
        assert "<script>" not in document

    def test_a_refused_payload_still_names_the_field_the_kind_and_the_reason(self, caplog):
        with caplog.at_level(logging.WARNING, logger="frankfurtleague"):
            TestClient(VALIDATION_APP, raise_server_exceptions=False).post("/name", json={"vorname": REJECTED_NAME})

        document = logged_document(caplog)
        assert "body.vorname" in document
        assert "string_pattern_mismatch" in document
        assert "String should match pattern" in document
        assert "REQ-VAL-001" in document

    def test_a_refused_stored_document_never_reaches_the_line(self, caplog):
        with caplog.at_level(logging.ERROR, logger="frankfurtleague"):
            asyncio.run(pydantic_validation_exception_handler(None, rejected_name_error()))  # type: ignore[arg-type]

        document = logged_document(caplog)
        assert REJECTED_NAME not in document
        assert "<script>" not in document

    def test_a_refused_stored_document_still_names_the_field_the_kind_and_the_reason(self, caplog):
        with caplog.at_level(logging.ERROR, logger="frankfurtleague"):
            asyncio.run(pydantic_validation_exception_handler(None, rejected_name_error()))  # type: ignore[arg-type]

        document = logged_document(caplog)
        assert "vorname" in document
        assert "string_pattern_mismatch" in document
        assert "String should match pattern" in document
        assert "SRV-VAL-001" in document

    def test_a_refused_stored_documents_value_never_reaches_the_line(self, caplog):
        document = database_crash_document(caplog, WriteError("Document failed validation", 121, REFUSED_DOCUMENT_REPORT))

        assert REFUSED_CONSENT_SOURCE not in document
        # The key the server puts the value under: naming it would fail this even for a value the test cannot guess.
        assert "consideredValue" not in document

    def test_a_refused_stored_document_still_names_the_property_the_rule_and_the_reason(self, caplog):
        document = database_crash_document(caplog, WriteError("Document failed validation", 121, REFUSED_DOCUMENT_REPORT))

        # The dotted path, not the leaf: `erteilt_von` alone would not say which sub-document failed.
        assert "einwilligung.erteilt_von" in document
        assert "value was not found in enum" in document
        # The second rule in the same report, whose shape names properties the document never carried.
        assert "nachname" in document
        assert "WriteError" in document and "code 121" in document
        assert "DB-FAIL-001" in document

    def test_the_walk_never_descends_into_the_refused_value(self, caplog):
        """Catches widening the report keys walked to the ones a refused value sits under."""

        document = database_crash_document(caplog, WriteError("Document failed validation", 121, REFUSED_SUBDOCUMENT_REPORT))

        assert REFUSED_CONSENT_SOURCE not in document
        # The refusal is still reported, so this cannot pass by the walk having found nothing at all.
        assert "einwilligung" in document and "type did not match" in document

    def test_a_bulk_writes_refused_document_never_reaches_the_line(self, caplog):
        document = database_crash_document(caplog, BulkWriteError(REFUSED_BULK_INSERT_REPORT))

        # A batch reports the whole document it tried to write as `op`, and quotes the duplicated key.
        assert REFUSED_SPIELER_OID not in document
        assert "dup key" not in document
        assert "DB-FAIL-001" in document

    def test_the_refusal_still_hands_back_an_id_to_quote(self):
        response = TestClient(VALIDATION_APP, raise_server_exceptions=False).post("/name", json={"vorname": REJECTED_NAME})

        # The one join between a 422 nobody can read and the line that says which field failed.
        assert re.fullmatch(r"[a-f0-9]{32}", response.json()["correlation_id"])


class TestCorrelation:
    def test_a_well_formed_incoming_id_is_echoed(self):
        response = client().get("/api/v0/spiele", headers={"X-Correlation-ID": "c0ffee00" * 4, **BASE_AUTH})

        assert response.headers["X-Correlation-ID"] == "c0ffee00" * 4
        assert response.json()["correlation_id"] == "c0ffee00" * 4

    def test_a_malformed_incoming_id_is_replaced_not_echoed(self):
        response = client().get("/api/v0/spiele", headers={"X-Correlation-ID": "NOT/AN/ID", **BASE_AUTH})

        echoed = response.headers["X-Correlation-ID"]
        assert echoed != "NOT/AN/ID"
        assert re.fullmatch(r"[a-f0-9]{32}", echoed)


class TestAccessLine:
    def test_every_request_writes_one_line_with_the_id_and_timing(self, caplog):
        with caplog.at_level(logging.INFO, logger="frankfurtleague"):
            client().get("/", headers={"X-Correlation-ID": "ab" * 16})

        lines = [record for record in caplog.records if getattr(record, "method", None) is not None]
        assert len(lines) == 1
        line = lines[0]
        assert line.method == "GET"
        assert line.path == "/"
        assert line.status == 200
        assert isinstance(line.duration_ms, float)
        assert line.correlation_id == "ab" * 16

    def test_the_query_string_is_part_of_the_logged_path(self, caplog):
        with caplog.at_level(logging.INFO, logger="frankfurtleague"):
            client().get("/api/v0/spiele", params={"limit": 5}, headers=BASE_AUTH)

        paths = [record.path for record in caplog.records if getattr(record, "path", None)]
        assert "/api/v0/spiele?limit=5" in paths
