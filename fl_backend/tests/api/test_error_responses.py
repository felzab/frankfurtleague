import logging
import re

from fastapi.testclient import TestClient

from app.main import create_app
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


class TestErrorCodeLogging:
    def test_the_logged_code_is_the_exceptions_own(self, caplog):
        # A `getattr` fallback in the handler would log every `BaseAPIException` as one fixed string
        # (`docs/logging/error-codes.md`).
        with caplog.at_level(logging.WARNING, logger="frankfurtleague"):
            client().get("/api/v0/spiele")

        codes = [getattr(record, "error_code", None) for record in error_records(caplog)]
        assert "REQ-AUTH-001" in codes
        assert "API_ERROR" not in codes


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
