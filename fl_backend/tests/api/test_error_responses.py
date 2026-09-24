import asyncio
import logging
import re
from typing import Any

import pytest
from bson import ObjectId
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field, ValidationError
from pymongo.errors import BulkWriteError, DuplicateKeyError, PyMongoError, WriteError

from app.core.config import API_VERSION
from app.core.domain import OPERATION_SEPARATOR, RULES
from app.core.exception_handlers import (
    NO_DATA_TEXT,
    db_exception_handler,
    duplicate_key_exception_handler,
    pydantic_validation_exception_handler,
    refusal_response,
    refused_codes,
    register_exception_handlers,
)
from app.core.logging import JSONFormatter
from app.core.middlewares import TraceContextMiddleware
from app.main import api_routes, create_app, publish_refusals, refusal_codes, with_refusals
from app.shared.schemas.custom import PERSON_NAME_PATTERN
from app.shared.schemas.responses import FLFailureBody, FLRefusedPayloadBody
from tests.config import BASE_AUTH, build_test_config
from tests.openapi_document import build_document

# Module level: building the app re-runs the logging dictConfig, which inside a test would strip the
# handler caplog attaches at setup.
APP = create_app(build_test_config())


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
VALIDATION_APP.add_middleware(TraceContextMiddleware)


@VALIDATION_APP.post("/name")
async def refuse_a_name(payload: NamePayload) -> dict[str, bool]:
    """Never reached: the pattern refuses the only body the tests post."""

    return {"ok": True}


class NestedKontakt(BaseModel):
    email: str = Field(max_length=5)


class NestedPayload(BaseModel):
    """The two shapes a form path takes past a top-level key: a sub-object and a list entry."""

    kontakt: NestedKontakt
    namen: list[NamePayload]


@VALIDATION_APP.post("/nested")
async def refuse_a_nested_field(payload: NestedPayload, limit: int = 0) -> dict[str, bool]:
    """Never reached: every case posts a body or a query the route refuses."""

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
        assert re.fullmatch(r"[a-f0-9]{32}", body["trace_id"])
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
        assert jsonlib.loads(bytes(response.body))["fields"] == []

    def test_the_body_carries_nothing_but_the_code_and_the_id(self):
        body = client().get("/api/v0/spiele").json()

        # Messages, refused values and stack traces belong to the log, never the wire.
        assert set(body) == {"error_code", "trace_id"}

    def test_no_header_carries_the_message_either(self):
        """The other channel out: `error_response` forwards `exc.headers`, so a leak is one line away.

        Pinning the body alone leaves that line invisible, and a header reaches every proxy between
        (`docs/logging/spec.md :: L9`).
        """

        response = client().get("/api/v0/spiele")

        # The exact SET, not a search for words: a message copied into any header, under any name,
        # moves this. `www-authenticate` is the one header this exception is allowed to add.
        assert response.status_code == 401
        assert set(response.headers) == {"www-authenticate", "content-length", "content-type", "vary"}
        # `CORSMiddleware` adds `vary` to every response granting no origin; its value is pinned so
        # nothing else rides in it.
        assert response.headers["vary"] == "Origin"

        # Named too, so the case cannot pass on a set that matched while a value leaked: this is
        # the message the 401 above actually carries.
        assert "does not exist or is not valid" not in " ".join(response.headers.values())


def refused(body: object | None = None, *, content: bytes | None = None, query: str = "") -> dict[str, Any]:
    """The 422 a payload earns at `/nested`, asserted to BE one, so no case reads fields off a success."""

    validation_client = TestClient(VALIDATION_APP, raise_server_exceptions=False)
    if content is None:
        response = validation_client.post(f"/nested{query}", json=body)
    else:
        response = validation_client.post("/nested", content=content, headers={"content-type": "application/json"})

    assert (response.status_code, response.json()["error_code"]) == (422, "REQ-VAL-001")
    return response.json()


VALID_NESTED = {"kontakt": {"email": "a@b"}, "namen": [{"vorname": "Anna"}]}


class TestTheRefusedFieldsReachTheCaller:
    """`docs/logging/spec.md :: L4`: a 422 names where each refusal sits, so a form marks that field."""

    def test_a_nested_field_is_named_by_its_path_inside_the_body(self):
        body = refused({"kontakt": {"email": "far-too-long"}, "namen": []})

        assert body["fields"] == [{"in": "body", "path": ["kontakt", "email"], "kind": "string_too_long"}]

    def test_a_list_entry_is_named_by_its_index(self):
        body = refused({"kontakt": {"email": "a@b"}, "namen": [{"vorname": "Anna"}, {"vorname": REJECTED_NAME}]})

        # An integer rather than `"1"`: a caller joining the path gets the dotted name its input carries.
        assert body["fields"] == [{"in": "body", "path": ["namen", 1, "vorname"], "kind": "string_pattern_mismatch"}]

    def test_every_refusal_is_named_rather_than_the_first(self):
        body = refused({"kontakt": {}, "namen": [{"vorname": REJECTED_NAME}]})

        assert [(field["path"], field["kind"]) for field in body["fields"]] == [
            (["kontakt", "email"], "missing"),
            (["namen", 0, "vorname"], "string_pattern_mismatch"),
        ]

    def test_a_refused_query_parameter_is_named_where_it_arrived(self):
        body = refused(VALID_NESTED, query="?limit=many")

        assert body["fields"] == [{"in": "query", "path": ["limit"], "kind": "int_parsing"}]

    def test_an_undecodable_body_names_no_path(self):
        """FastAPI reports the character offset parsing stopped at, which a form would read as a list index."""

        body = refused(content=b'{"kontakt": ')

        assert body["fields"] == [{"in": "body", "path": [], "kind": "json_invalid"}]

    def test_the_value_and_pydantics_english_stay_off_the_wire(self):
        body = refused({"kontakt": {"email": "a@b"}, "namen": [{"vorname": REJECTED_NAME}]})

        # The exact key sets, so a value or a message under any name moves this.
        assert set(body) == {"error_code", "trace_id", "fields"}
        assert [set(field) for field in body["fields"]] == [{"in", "path", "kind"}]
        assert REJECTED_NAME not in str(body)
        assert "String should match pattern" not in str(body)


def published_operations() -> list[tuple[str, dict[str, Any]]]:
    return [
        (f"{method.upper()} {path}", operation) for path, methods in build_document()["paths"].items() for method, operation in methods.items()
    ]


def published_schema(response: dict[str, Any]) -> str:
    return response["content"]["application/json"]["schema"]["$ref"].removeprefix("#/components/schemas/")


# The operations publishing a 409 on the tree this was written against, so an equality over two
# maps that both went empty still fails.
REFUSING_OPERATIONS_FLOOR = 59


def refusal_codes_by_operation() -> dict[str, set[str]]:
    """Read off `RULES` and the routes here rather than through the publisher, which is what this is compared against."""

    declared: dict[str, set[str]] = {}
    for rule in RULES:
        for token in rule.operation.split(OPERATION_SEPARATOR):
            method, route = token.split(" ", 1)
            declared.setdefault(f"{method} /api/v{API_VERSION}{route}", set()).add(rule.code)

    for route in api_routes(APP):
        for status, response in route.responses.items():
            if str(status) == "409":
                for method in route.methods or ():
                    declared.setdefault(f"{method} {route.path_format}", set()).update(
                        narrowed_codes(response["content"]["application/json"]["schema"])
                    )

    return declared


def published_refusals() -> dict[str, dict[str, Any]]:
    return {
        name: operation["responses"]["409"]["content"]["application/json"]["schema"]
        for name, operation in published_operations()
        if "409" in operation["responses"]
    }


def narrowed_codes(schema: dict[str, Any]) -> set[str]:
    """Empty for a 409 left as a route declared it, so the comparison names that operation rather than raising."""

    return {code for part in schema.get("allOf", [])[1:] for code in part.get("properties", {}).get("error_code", {}).get("enum", [])}


class TestThePublishedFailureBodies:
    """`docs/backend/spec.md :: I345`: the document describes the bodies the handlers send."""

    def test_every_operation_publishes_the_envelope_for_its_failures(self):
        operations = published_operations()

        assert [name for name, operation in operations if "default" not in operation["responses"]] == []
        assert {published_schema(operation["responses"]["default"]) for _, operation in operations} == {"FLFailureBody"}

    def test_the_refused_payload_is_published_on_every_operation_taking_input_and_nowhere_else(self):
        """Read off the operation's own `parameters` and `requestBody`, a listing the 422 declaration never feeds."""

        operations = published_operations()
        takes_input = {name for name, operation in operations if operation.get("parameters") or "requestBody" in operation}

        assert {name for name, operation in operations if "422" in operation["responses"]} == takes_input
        assert {published_schema(operation["responses"]["422"]) for name, operation in operations if name in takes_input} == {
            "FLRefusedPayloadBody"
        }
        # Both sides at once, so the equality above cannot hold over two empty sets.
        assert takes_input and len(takes_input) < len(operations)

    def test_every_operation_publishes_on_its_409_exactly_the_codes_it_refuses_with(self):
        """Both ways: an operation neither a rule nor its route names publishes no 409, and one either names publishes that code."""

        published = {name: narrowed_codes(schema) for name, schema in published_refusals().items()}

        assert published == refusal_codes_by_operation()
        assert len(published) >= REFUSING_OPERATIONS_FLOOR

    def test_every_409_narrows_the_one_failure_body(self):
        assert {schema.get("allOf", [schema])[0].get("$ref") for schema in published_refusals().values()} == {
            "#/components/schemas/FLFailureBody"
        }

    def test_the_schemas_are_published_in_the_order_fastapi_writes_its_own(self):
        """Sorted, so a rewrite of `fl_backend/openapi.json` never moves a schema it did not change."""

        schemas = list(build_document()["components"]["schemas"])

        assert schemas == sorted(schemas)

    def test_fastapis_own_validation_body_is_published_nowhere(self):
        assert {"HTTPValidationError", "ValidationError"}.isdisjoint(build_document()["components"]["schemas"])

    def test_a_refused_payload_is_the_published_shape_and_nothing_more(self):
        body = refused({"kontakt": {"email": "far-too-long"}, "namen": [{"vorname": REJECTED_NAME}]})

        assert FLRefusedPayloadBody.model_validate(body).model_dump(by_alias=True) == body

    def test_any_other_failure_is_the_published_shape_and_nothing_more(self):
        body = client().get("/api/v0/spiele").json()

        assert FLFailureBody.model_validate(body).model_dump() == body


PLANTED_PATH = "/planted"
# A code no rule and no handler raises, so only the declaration can put it on the 409.
A_SECOND_REASON = "REQ-PLANTED-001"


def planted_app(conflict: dict[str, Any]) -> FastAPI:
    """One route declaring `conflict` as its 409, on a path `RULES` never names."""

    app = FastAPI()

    @app.post(PLANTED_PATH, responses={409: conflict})
    def planted() -> None: ...

    return app


class TestTheDeclared409:
    def test_the_codes_a_declaration_names_are_published_and_no_other(self):
        """A second reason a route conflicts for, where reading every declaration as the duplicate key would relabel it `DB-COMMON-002`.

        Through the document pass as well as the reading: the pass is where a 409 FastAPI already
        placed could be taken for the duplicate key.
        """

        app = planted_app(refusal_response({A_SECOND_REASON}))
        published = with_refusals(app.openapi(), refusal_codes(app))["paths"][PLANTED_PATH]["post"]["responses"]["409"]

        assert refused_codes(published) == {A_SECOND_REASON}

    def test_every_read_of_the_document_answers_the_published_refusals(self):
        """FastAPI answers each read after the first from `app.openapi_schema`, which a pass returning its edit alone would leave unedited."""

        app = create_app(build_test_config())
        first = app.openapi()

        assert app.openapi() == first

    def test_a_409_declared_naming_no_code_stops_the_build(self):
        """Refused before `RULES` is checked against the routes, which this app serves none of."""

        with pytest.raises(ValueError, match=f"POST {PLANTED_PATH}"):
            publish_refusals(planted_app({"model": FLFailureBody}))


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
                "ist_nachnominiert": False,
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


# Distinctive for the same reason `REJECTED_NAME` is: its absence from a whole log document has to be
# evidence rather than coincidence.
REFUSED_SHORTHAND = "ZRBX"

# The server's whole report for a single-document duplicate key: `errmsg` quotes the refused value a
# second time beside `keyValue`, which is why neither may travel to the line.
REFUSED_DUPLICATE_KEY_REPORT: dict[str, Any] = {
    "index": 0,
    "code": 11000,
    "errmsg": f'E11000 duplicate key error collection: fl_test.teams index: uniq_shorthand dup key: {{ shorthand: "{REFUSED_SHORTHAND}" }}',
    "keyPattern": {"shorthand": 1},
    "keyValue": {"shorthand": REFUSED_SHORTHAND},
}


def duplicate_key_document(caplog, details: dict[str, Any] | None) -> str:
    """The line the duplicate-key handler writes for one server report."""

    with caplog.at_level(logging.WARNING, logger="frankfurtleague"):
        asyncio.run(duplicate_key_exception_handler(None, DuplicateKeyError("E11000 duplicate key error", 11000, details)))  # type: ignore[arg-type]

    return logged_document(caplog)


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
            asyncio.run(db_exception_handler(Request({"type": "http", "method": "GET", "headers": []}), live))

    return logged_document(caplog)


class TestValidationLoggingWithholdsTheValue:
    """The refusal reaches the log naming its field, with the value gone (`docs/logging/spec.md :: L9`).

    Asserted on the LOG, never the wire: the body carries no message and no value, so a wire test
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

    def test_a_duplicate_keys_refused_value_never_reaches_the_line(self, caplog):
        document = duplicate_key_document(caplog, REFUSED_DUPLICATE_KEY_REPORT)

        # `errmsg` quotes the value once and `keyValue` carries it again, so both stay off the line.
        assert REFUSED_SHORTHAND not in document
        assert "dup key" not in document

    def test_a_duplicate_key_still_names_the_index_that_refused(self, caplog):
        document = duplicate_key_document(caplog, REFUSED_DUPLICATE_KEY_REPORT)

        assert "uniq_shorthand" in document
        assert "DB-COMMON-002" in document

    @pytest.mark.parametrize("details", [None, {"code": 11000}, {"errmsg": "E11000 duplicate key error, malformed"}])
    def test_a_report_with_no_parsable_index_still_writes_a_line(self, caplog, details):
        """Total over whatever the driver hands it: only the server decides the report's shape, and a handler must not raise while handling."""

        document = duplicate_key_document(caplog, details)

        assert NO_DATA_TEXT in document
        assert "DB-COMMON-002" in document

    def test_the_refusal_still_hands_back_an_id_to_quote(self):
        response = TestClient(VALIDATION_APP, raise_server_exceptions=False).post("/name", json={"vorname": REJECTED_NAME})

        # The one join between a 422 and the line saying why its field failed.
        assert re.fullmatch(r"[a-f0-9]{32}", response.json()["trace_id"])


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
        # This hop's OWN span, never the one the header carried (L12).
        assert line.span_id != "ab" * 8
        assert re.fullmatch(r"[a-f0-9]{16}", line.span_id)

    def test_the_query_string_is_part_of_the_logged_path(self, caplog):
        with caplog.at_level(logging.INFO, logger="frankfurtleague"):
            client().get("/api/v0/spiele", params={"limit": 5}, headers=BASE_AUTH)

        paths = [record.path for record in caplog.records if getattr(record, "path", None)]
        assert "/api/v0/spiele?limit=5" in paths
