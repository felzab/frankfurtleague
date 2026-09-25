import ast
import asyncio
import logging
import re
import subprocess
import sys
from http import HTTPStatus
from typing import Any

import pytest
from bson import ObjectId
from fastapi import APIRouter, FastAPI, Request
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field, ValidationError
from pymongo.errors import BulkWriteError, DuplicateKeyError, PyMongoError, WriteError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import API_VERSION
from app.core.crud import refuse
from app.core.domain import OPERATION_SEPARATOR, RULES
from app.core.exception_handlers import (
    BODY_UNREADABLE,
    DATABASE_FAILED,
    JSON_MEDIA_TYPE,
    METHOD_NOT_SERVED,
    NO_DATA_TEXT,
    NO_ROUTE,
    PAYLOAD_REFUSED,
    ROUTING_CODES,
    STORED_DATA_INVALID,
    UNHANDLED_CRASH,
    db_exception_handler,
    duplicate_key_exception_handler,
    pydantic_validation_exception_handler,
    refusal_response,
    refused_codes,
    register_exception_handlers,
)
from app.core.exceptions import DUPLICATE_KEY, NO_DATABASE_CLIENT, BaseAPIException, RequestAuthorizationException, WriteRefusal
from app.core.logging import JSONFormatter
from app.core.middlewares import TraceContextMiddleware
from app.core.security import MISSING_TOKEN, WRONG_BASE_KEY
from app.main import create_app, dependency_refusals, document_routes, publish_refusals, refusal_codes, with_refusals
from app.shared.schemas.custom import PERSON_NAME_PATTERN
from app.shared.schemas.responses import FLFailureBody, FLRefusedPayloadBody
from tests.config import BASE_AUTH, build_test_config
from tests.core.app_source import APP_ROOT, BACKEND_ROOT, api_routes, app_calls, callee, parsed
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
REJECTED_MARKUP = "<script>"
REJECTED_NAME = f"Maximilian{REJECTED_MARKUP}"


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


# A code no rule declares, so only this case's own route can answer it.
PLANTED_REFUSAL = "REQ-PLANTED-002"
JUDGED_PATH = ("kontakt", "email")


@VALIDATION_APP.post("/refused/{status}")
async def refuse_at(status: int) -> None:
    """Refuses at the status its path names, a 422 naming the body path it judged."""

    judged = (JUDGED_PATH,) if status == HTTPStatus.UNPROCESSABLE_CONTENT else ()
    refuse(WriteRefusal(error_code=PLANTED_REFUSAL, status=HTTPStatus(status), message="planted", fields=judged))


@VALIDATION_APP.get("/starlette/{status}")
async def raise_starlettes_own(status: int) -> None:
    """Raises the base class the router raises, at the status its path names."""

    raise StarletteHTTPException(status_code=status)


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
        assert body["error_code"] == MISSING_TOKEN
        assert re.fullmatch(r"[a-f0-9]{32}", body["trace_id"])
        assert response.headers["WWW-Authenticate"] == "Bearer"

    def test_a_wrong_key_is_distinguishable_by_code(self):
        response = client().get("/api/v0/spiele", headers={"Authorization": "Bearer wrong"})

        assert response.status_code == 401
        assert response.json()["error_code"] == WRONG_BASE_KEY

    def test_an_unavailable_database_is_503_with_dbconn001(self):
        response = client().get("/api/v0/spiele", headers=BASE_AUTH)

        assert response.status_code == 503
        assert response.json()["error_code"] == NO_DATABASE_CLIENT
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
        assert jsonlib.loads(bytes(response.body))["error_code"] == PAYLOAD_REFUSED
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
        assert RequestAuthorizationException(MISSING_TOKEN).error_detail["message"] not in " ".join(response.headers.values())


def refused(body: object | None = None, *, query: str = "") -> dict[str, Any]:
    """The 422 a payload earns at `/nested`, asserted to BE one, so no case reads fields off a success."""

    response = TestClient(VALIDATION_APP, raise_server_exceptions=False).post(f"/nested{query}", json=body)

    assert (response.status_code, response.json()["error_code"]) == (422, PAYLOAD_REFUSED)
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

    def test_an_undecodable_body_is_malformed_syntax_naming_no_field(self):
        """400 and no `fields`: nothing inside the body was read, so no field is at fault."""

        response = TestClient(VALIDATION_APP, raise_server_exceptions=False).post(
            "/nested", content=b'{"kontakt": ', headers={"content-type": "application/json"}
        )

        assert (response.status_code, response.json()["error_code"]) == (400, BODY_UNREADABLE)
        assert FLFailureBody.model_validate(response.json()).model_dump() == response.json()

    def test_a_body_that_is_not_utf8_is_the_same_unreadable_body(self):
        """FastAPI raises its own 400 here rather than a validation error, and the routing handler answers it."""

        response = TestClient(VALIDATION_APP, raise_server_exceptions=False).post(
            "/nested", content=b'{"kontakt": "\xff"}', headers={"content-type": "application/json"}
        )

        assert (response.status_code, response.json()["error_code"]) == (400, BODY_UNREADABLE)
        assert FLFailureBody.model_validate(response.json()).model_dump() == response.json()

    def test_the_value_and_pydantics_english_stay_off_the_wire(self):
        body = refused({"kontakt": {"email": "a@b"}, "namen": [{"vorname": REJECTED_NAME}]})

        # The exact key sets, so a value or a message under any name moves this.
        assert set(body) == {"error_code", "trace_id", "fields"}
        assert [set(field) for field in body["fields"]] == [{"in", "path", "kind"}]
        assert REJECTED_NAME not in str(body)
        assert "String should match pattern" not in str(body)


class TestTheRouterAnswersInTheEnvelope:
    """`docs/backend/spec.md` §1.4: every failure answers `{error_code, trace_id}`, one no route serves included."""

    def test_a_path_no_route_serves_is_a_404_naming_its_own_code(self):
        response = client().get("/api/v0/nowhere")

        assert (response.status_code, response.json()["error_code"]) == (404, NO_ROUTE)
        assert FLFailureBody.model_validate(response.json()).model_dump() == response.json()

    def test_a_method_the_path_does_not_serve_is_a_405_keeping_its_allow_header(self):
        response = client().delete("/api/v0/spiele")

        assert (response.status_code, response.json()["error_code"]) == (405, METHOD_NOT_SERVED)
        assert response.headers["allow"] == "GET"

    def test_every_documented_paths_allow_names_every_method_the_document_serves_there(self):
        """RFC 9110 section 15.5.6: a 405 lists every method the target serves, whichever router serves it.

        Read off the document, each template matched as its parameters allow, so a second template
        reaching the path adds its methods.
        """

        document = build_document()
        short = {}
        for template in document["paths"]:
            url = PATH_PARAMETER.sub(lambda match, template=template: sample_segment(document, template, match[1]), template)
            expected = {
                method.upper()
                for other, operations in document["paths"].items()
                if re.fullmatch(template_pattern(document, other), url)
                for method in operations
            }
            response = client().put(url)
            answered = set(response.headers.get("allow", "").split(", "))
            if response.status_code != 405 or answered != expected:
                short[url] = (response.status_code, sorted(answered), sorted(expected))

        assert short == {}

    @pytest.mark.parametrize("status", sorted(ROUTING_CODES))
    def test_each_status_the_routing_layer_raises_answers_its_own_code(self, status: int):
        response = TestClient(VALIDATION_APP, raise_server_exceptions=False).get(f"/starlette/{status}")

        assert (response.status_code, response.json()["error_code"]) == (status, ROUTING_CODES[status])

    def test_a_status_the_routing_layer_never_raises_is_the_servers_fault(self):
        """No code names it, so a raise at it is a server bug the catch-all answers, never passed through."""

        response = TestClient(VALIDATION_APP, raise_server_exceptions=False).get("/starlette/418")

        assert (response.status_code, response.json()["error_code"]) == (500, UNHANDLED_CRASH)
        assert FLFailureBody.model_validate(response.json()).model_dump() == response.json()

    def test_the_application_raises_the_frameworks_exception_only_through_its_own_base(self):
        """A bare raise meets the routing handler, which answers a status it has no code for as a crash."""

        names = {
            alias.asname or alias.name
            for path in APP_ROOT.rglob("*.py")
            for node in ast.walk(parsed(path))
            if isinstance(node, ast.ImportFrom)
            for alias in node.names
            if alias.name == "HTTPException"
        }
        raised = [f"{module} :: {scope}" for module, scope, call in app_calls() if callee(call) in names]
        extended = {
            node.name
            for path in APP_ROOT.rglob("*.py")
            for node in ast.walk(parsed(path))
            if isinstance(node, ast.ClassDef) and any(isinstance(base, ast.Name) and base.id in names for base in node.bases)
        }

        assert names, "the walk found no import of the framework's exception, so it read nothing"
        assert raised == []
        assert extended == {BaseAPIException.__name__}


class TestARefusalIsAnsweredAtTheStatusItsCheckChose:
    @pytest.mark.parametrize("status", [HTTPStatus.CONFLICT, HTTPStatus.NOT_FOUND, HTTPStatus.GONE, HTTPStatus.FORBIDDEN])
    def test_a_refusal_off_422_answers_the_failure_body(self, status: HTTPStatus):
        response = TestClient(VALIDATION_APP, raise_server_exceptions=False).post(f"/refused/{int(status)}")

        assert response.status_code == status
        assert FLFailureBody.model_validate(response.json()).model_dump() == response.json()
        assert response.json()["error_code"] == PLANTED_REFUSAL

    def test_a_422_answers_the_refused_payload_naming_what_its_rule_judged(self):
        response = TestClient(VALIDATION_APP, raise_server_exceptions=False).post(f"/refused/{int(HTTPStatus.UNPROCESSABLE_CONTENT)}")

        assert response.status_code == HTTPStatus.UNPROCESSABLE_CONTENT
        assert FLRefusedPayloadBody.model_validate(response.json()).model_dump(by_alias=True) == response.json()
        assert response.json()["fields"] == [{"in": "body", "path": list(JUDGED_PATH), "kind": PLANTED_REFUSAL}]

    def test_fields_off_a_422_are_refused_where_the_check_builds_them(self):
        """They would reach no body: only a 422's publishes `fields`."""

        with pytest.raises(ValueError, match=PLANTED_REFUSAL):
            WriteRefusal(error_code=PLANTED_REFUSAL, status=HTTPStatus.CONFLICT, message="planted", fields=(JUDGED_PATH,))


PATH_PARAMETER = re.compile(r"\{(\w+)\}")
A_SEGMENT = "[^/]+"


def parameter_pattern(document: dict[str, Any], template: str, name: str) -> str | None:
    """The pattern a template's path parameter is published with, unanchored, or `None` for any segment."""

    for operation in document["paths"][template].values():
        for parameter in operation.get("parameters", []):
            if parameter["in"] == "path" and parameter["name"] == name and "pattern" in parameter["schema"]:
                return parameter["schema"]["pattern"].removeprefix("^").removesuffix("$")
    return None


def template_pattern(document: dict[str, Any], template: str) -> str:
    """The URLs a documented template serves, as a pattern."""

    literal = re.split(r"\{\w+\}", template)
    names = PATH_PARAMETER.findall(template)
    parameters = [f"(?:{parameter_pattern(document, template, name) or A_SEGMENT})" for name in names]

    return "".join(re.escape(part) + (parameters[index] if index < len(parameters) else "") for index, part in enumerate(literal))


def sample_segment(document: dict[str, Any], template: str, name: str) -> str:
    """A value the parameter takes: an id where the parameter is patterned, a word otherwise."""

    return "0" * 23 + "1" if parameter_pattern(document, template, name) else "x"


def published_operations() -> list[tuple[str, dict[str, Any]]]:
    return [
        (f"{method.upper()} {path}", operation) for path, methods in build_document()["paths"].items() for method, operation in methods.items()
    ]


def published_schema(response: dict[str, Any]) -> str:
    """The body a response publishes, the one a narrowing composes included."""

    schema = response["content"][JSON_MEDIA_TYPE]["schema"]

    return schema.get("allOf", [schema])[0]["$ref"].removeprefix("#/components/schemas/")


# The operations publishing a refusal on the tree this was written against, so an equality over two
# maps that both went empty still fails.
REFUSING_OPERATIONS_FLOOR = 59


def refusal_codes_by_operation() -> dict[str, dict[str, set[str]]]:
    """Read off `RULES`, the routes and the dependencies here rather than through the publisher, which is what this is compared against.

    A dependency's codes are taken from `app/main.py :: dependency_refusals`, which
    `tests/api/test_dependency_refusals.py` holds against what a request meets.
    """

    declared: dict[str, dict[str, set[str]]] = {}
    for (path, method), refusals in dependency_refusals(APP).items():
        for status, codes in refusals.items():
            declared.setdefault(f"{method.upper()} {path}", {}).setdefault(str(int(status)), set()).update(codes)
    # Every operation taking input can refuse it, read off its own `parameters` and `requestBody`, and
    # one taking a body can be sent one that is not JSON at all.
    for name, operation in published_operations():
        if operation.get("parameters") or "requestBody" in operation:
            declared.setdefault(name, {}).setdefault("422", set()).add(PAYLOAD_REFUSED)
        if "requestBody" in operation:
            declared.setdefault(name, {}).setdefault("400", set()).add(BODY_UNREADABLE)
    for rule in RULES:
        for token in rule.operation.split(OPERATION_SEPARATOR):
            method, route = token.split(" ", 1)
            declared.setdefault(f"{method} /api/v{API_VERSION}{route}", {}).setdefault(str(int(rule.status)), set()).add(rule.code)

    for route in api_routes(APP):
        for status, response in route.responses.items():
            for method in route.methods or ():
                declared.setdefault(f"{method} {route.path_format}", {}).setdefault(str(status), set()).update(
                    narrowed_codes(response["content"][JSON_MEDIA_TYPE]["schema"])
                )

    return declared


def published_schemas() -> dict[str, dict[str, dict[str, Any]]]:
    """Each operation's failure schemas by status, `default` aside, which narrows to no code."""

    return {
        name: {
            status: response["content"][JSON_MEDIA_TYPE]["schema"] for status, response in operation["responses"].items() if status[0] in "45"
        }
        for name, operation in published_operations()
    }


def published_refusals() -> dict[str, dict[str, set[str]]]:
    """Each operation's statuses publishing codes, and the codes each names; one publishing none is left out."""

    published: dict[str, dict[str, set[str]]] = {}
    for name, schemas in published_schemas().items():
        if narrowed := {status: codes for status, schema in schemas.items() if (codes := narrowed_codes(schema))}:
            published[name] = narrowed

    return published


def narrowed_codes(schema: dict[str, Any]) -> set[str]:
    """Empty for a response left as FastAPI wrote it, so the comparison names that operation rather than raising."""

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

    def test_every_operation_publishes_at_each_status_exactly_the_codes_it_refuses_with(self):
        """Both ways: a status neither a rule nor its route names publishes no code, and one either names publishes that code there."""

        published = published_refusals()

        assert published == refusal_codes_by_operation()
        assert len(published) >= REFUSING_OPERATIONS_FLOOR

    def test_a_422_narrows_the_refused_payload_and_every_other_status_the_failure_body(self):
        """The body is the status's own: `fields` travel on a 422 and on nothing else."""

        narrowed = {
            (status == "422", schema["allOf"][0]["$ref"])
            for schemas in published_schemas().values()
            for status, schema in schemas.items()
            if narrowed_codes(schema)
        }

        assert narrowed <= {(True, "#/components/schemas/FLRefusedPayloadBody"), (False, "#/components/schemas/FLFailureBody")}
        assert (False, "#/components/schemas/FLFailureBody") in narrowed

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
HIDDEN_PATH = "/hidden"
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
        """A second reason a route conflicts for, read off the published document.

        The pass over it is where a 409 FastAPI already placed could be taken for the duplicate key
        and relabelled `DB-COMMON-002`.
        """

        app = planted_app(refusal_response(HTTPStatus.CONFLICT, {A_SECOND_REASON}))
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

    def test_a_409_an_include_declares_naming_no_code_stops_the_build(self):
        """Declared at `include_router`, which the document publishes and a walk over the original routes never sees."""

        router = APIRouter()

        @router.post(PLANTED_PATH)
        def planted() -> None: ...

        app = FastAPI()
        app.include_router(router, responses={409: {"model": FLFailureBody}})

        with pytest.raises(ValueError, match=f"POST {PLANTED_PATH}"):
            publish_refusals(app)

    def test_the_operations_read_are_the_operations_the_document_publishes(self):
        """A hidden route beside a shown one: read as served, a rule naming it would pass the build and publish nothing."""

        app = planted_app(refusal_response(HTTPStatus.CONFLICT, {A_SECOND_REASON}))

        @app.get(HIDDEN_PATH, include_in_schema=False)
        def hidden() -> None: ...

        read = {(route.path_format, method.lower()) for route in document_routes(app) for method in route.methods}
        published = {(path, method) for path, operations in app.openapi()["paths"].items() for method in operations}

        assert read == published == {(PLANTED_PATH, "post")}


# Two builds in a process of their own, exiting non-zero where their documents differ.
TWO_BUILDS = (
    "import sys\n"
    "from app.main import create_app\n"
    "from tests.config import build_test_config\n"
    "sys.exit(create_app(build_test_config()).openapi() != create_app(build_test_config()).openapi())\n"
)


class TestEveryBuildPublishesOneDocument:
    def test_a_processs_first_build_publishes_what_its_second_does(self):
        """Never in this process, which has built the app already.

        A build inheriting an earlier one's edits to a shared route hides a defect of the first.
        """

        done = subprocess.run([sys.executable, "-c", TWO_BUILDS], cwd=BACKEND_ROOT, capture_output=True, text=True, check=False)

        assert done.returncode == 0, done.stderr


class TestErrorCodeLogging:
    def test_the_logged_code_is_the_exceptions_own(self, caplog):
        # A `getattr` fallback in the handler would log every `BaseAPIException` as one fixed string
        # (`docs/logging/error-codes.md`).
        with caplog.at_level(logging.WARNING, logger="frankfurtleague"):
            client().get("/api/v0/spiele")

        codes = [getattr(record, "error_code", None) for record in error_records(caplog)]
        assert MISSING_TOKEN in codes
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

# A validator's refusal inside a batch, carrying the `op` the driver adds: the whole document it
# tried to write. A duplicate-only batch never reaches this handler, `app/core/crud.py ::
# post_many_to_db` raising it as `DuplicateKeyError`.
REFUSED_BULK_INSERT_REPORT: dict[str, Any] = {
    "writeErrors": [
        {
            **REFUSED_DOCUMENT_REPORT,
            "op": {
                "_id": ObjectId(REFUSED_SPIELER_OID),
                "vorname": "Anna",
                "einwilligung": {"erteilt_von": REFUSED_CONSENT_SOURCE},
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


# Distinctive for the same reason `REJECTED_NAME` is: its absence from a whole log document has to be
# evidence rather than coincidence.
REFUSED_SHORTHAND = "ZRBX"

# The clause of `errmsg` that introduces the quoted value, sought on its own so no part of it travels.
DUP_KEY_CLAUSE = "dup key"

# The server's whole report for a single-document duplicate key: `errmsg` quotes the refused value a
# second time beside `keyValue`, which is why neither may travel to the line.
REFUSED_DUPLICATE_KEY_REPORT: dict[str, Any] = {
    "index": 0,
    "code": 11000,
    "errmsg": (
        f'E11000 duplicate key error collection: fl_test.teams index: uniq_shorthand {DUP_KEY_CLAUSE}: {{ shorthand: "{REFUSED_SHORTHAND}" }}'
    ),
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
        assert REJECTED_MARKUP not in document

    def test_a_refused_payload_still_names_the_field_the_kind_and_the_reason(self, caplog):
        with caplog.at_level(logging.WARNING, logger="frankfurtleague"):
            TestClient(VALIDATION_APP, raise_server_exceptions=False).post("/name", json={"vorname": REJECTED_NAME})

        document = logged_document(caplog)
        assert "body.vorname" in document
        assert "string_pattern_mismatch" in document
        assert "String should match pattern" in document
        assert PAYLOAD_REFUSED in document

    def test_a_refused_stored_document_never_reaches_the_line(self, caplog):
        with caplog.at_level(logging.ERROR, logger="frankfurtleague"):
            asyncio.run(pydantic_validation_exception_handler(None, rejected_name_error()))  # type: ignore[arg-type]

        document = logged_document(caplog)
        assert REJECTED_NAME not in document
        assert REJECTED_MARKUP not in document

    def test_a_refused_stored_document_still_names_the_field_the_kind_and_the_reason(self, caplog):
        with caplog.at_level(logging.ERROR, logger="frankfurtleague"):
            asyncio.run(pydantic_validation_exception_handler(None, rejected_name_error()))  # type: ignore[arg-type]

        document = logged_document(caplog)
        assert "vorname" in document
        assert "string_pattern_mismatch" in document
        assert "String should match pattern" in document
        assert STORED_DATA_INVALID in document

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
        assert DATABASE_FAILED in document

    def test_the_walk_never_descends_into_the_refused_value(self, caplog):
        """Catches widening the report keys walked to the ones a refused value sits under."""

        document = database_crash_document(caplog, WriteError("Document failed validation", 121, REFUSED_SUBDOCUMENT_REPORT))

        assert REFUSED_CONSENT_SOURCE not in document
        # The refusal is still reported, so this cannot pass by the walk having found nothing at all.
        assert "einwilligung" in document and "type did not match" in document

    def test_a_bulk_writes_refused_document_never_reaches_the_line(self, caplog):
        document = database_crash_document(caplog, BulkWriteError(REFUSED_BULK_INSERT_REPORT))

        # `op` holds the refused value a second time, beside the validator's `consideredValue`.
        assert REFUSED_SPIELER_OID not in document
        assert REFUSED_CONSENT_SOURCE not in document
        # Still named, so the case cannot pass on a line that dropped the report whole.
        assert "einwilligung.erteilt_von" in document
        assert DATABASE_FAILED in document

    def test_a_duplicate_keys_refused_value_never_reaches_the_line(self, caplog):
        document = duplicate_key_document(caplog, REFUSED_DUPLICATE_KEY_REPORT)

        # `errmsg` quotes the value once and `keyValue` carries it again, so both stay off the line.
        assert REFUSED_SHORTHAND not in document
        assert DUP_KEY_CLAUSE not in document

    def test_a_duplicate_key_still_names_the_index_that_refused(self, caplog):
        document = duplicate_key_document(caplog, REFUSED_DUPLICATE_KEY_REPORT)

        assert "uniq_shorthand" in document
        assert DUPLICATE_KEY in document

    @pytest.mark.parametrize("details", [None, {"code": 11000}, {"errmsg": "E11000 duplicate key error, malformed"}])
    def test_a_report_with_no_parsable_index_still_writes_a_line(self, caplog, details):
        """Total over whatever the driver hands it: only the server decides the report's shape, and a handler must not raise while handling."""

        document = duplicate_key_document(caplog, details)

        assert NO_DATA_TEXT in document
        assert DUPLICATE_KEY in document

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
