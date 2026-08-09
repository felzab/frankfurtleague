"""
CORE · the logging contract, from the backend side

`docs/logging.md` promises one JSON document per line whose field set matches the frontend
logger's, a correlation id on every record, and an error code surviving as a structured field.
Nothing in the toolchain sees a log line, so these tests are the only net under those claims —
they were false once: seven of the eight documented codes logged as a fallback string.
"""

import json
import logging
import re

import pytest
from pydantic import SecretStr

from app.core.config import BackendConfig
from app.core.logging import JSONFormatter, LevelAwareFormatter, correlation_id_var
from app.core.middlewares import resolve_correlation_id

TIMESTAMP_SHAPE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\Z")


def make_record(message: str = "hello", level: int = logging.INFO, **attrs) -> logging.LogRecord:
    record = logging.LogRecord(name="frankfurtleague", level=level, pathname=__file__, lineno=1, msg=message, args=(), exc_info=None)
    for key, value in attrs.items():
        setattr(record, key, value)
    return record


class TestJSONFormatter:
    def test_emits_one_parseable_document_with_the_shared_field_set(self):
        line = JSONFormatter().format(make_record(correlation_id="a" * 32))

        document = json.loads(line)
        assert "\n" not in line
        assert document["level"] == "INFO"
        assert document["service"] == "fl_backend"
        assert document["correlation_id"] == "a" * 32
        assert document["message"] == "hello"
        assert TIMESTAMP_SHAPE.fullmatch(document["timestamp"]), document["timestamp"]

    def test_a_record_outside_any_request_carries_the_sentinel(self):
        document = json.loads(JSONFormatter().format(make_record()))

        assert document["correlation_id"] == "SYSTEM"

    def test_structured_extras_travel_as_fields(self):
        record = make_record(error_code="REQ-AUTH-001", method="GET", path="/api/v0/spiele", status=401, duration_ms=1.2)

        document = json.loads(JSONFormatter().format(record))

        assert document["error_code"] == "REQ-AUTH-001"
        assert document["method"] == "GET"
        assert document["path"] == "/api/v0/spiele"
        assert document["status"] == 401
        assert document["duration_ms"] == 1.2

    def test_an_exception_serialises_as_the_shared_error_object(self):
        try:
            raise ValueError("boom")
        except ValueError:
            import sys

            record = make_record(level=logging.ERROR)
            record.exc_info = sys.exc_info()

        document = json.loads(JSONFormatter().format(record))

        # The same three keys the frontend logger writes for an Error, so one parser reads both.
        assert document["error"]["name"] == "ValueError"
        assert document["error"]["message"] == "boom"
        assert "Traceback" in document["error"]["stack"]


class TestConsoleFormatter:
    def test_appends_the_error_code_inline(self):
        line = LevelAwareFormatter().format(make_record(correlation_id="SYSTEM", error_code="DB-COMMON-002"))

        assert line.endswith("[DB-COMMON-002]")


class TestResolveCorrelationId:
    def test_honours_a_well_formed_incoming_id(self):
        assert resolve_correlation_id("ab12" * 8) == "ab12" * 8

    @pytest.mark.parametrize(
        "hostile",
        [
            None,
            "",
            "PROBE-AAA",  # uppercase and dash: the stage-1 probe format is deliberately no longer honoured
            "x" * 65,  # too long
            'a1b2","injected":"line',  # log-injection attempt
            "abc\ndef",
        ],
    )
    def test_mints_instead_of_honouring_anything_malformed(self, hostile):
        resolved = resolve_correlation_id(hostile)

        assert resolved != hostile
        assert re.fullmatch(r"[a-f0-9]{32}", resolved)


class TestLoggingSettings:
    def make(self, **overrides) -> BackendConfig:
        return BackendConfig(
            api_trusted_hosts="testserver",
            api_cors_allowed_origins="http://localhost:3000",
            mongodb_uri=SecretStr("mongodb://localhost:27017/t"),
            db_base_name="t",
            internal_api_key_base=SecretStr("b"),
            internal_api_key_system=SecretStr("s"),
            internal_api_key_admin=SecretStr("a"),
            **overrides,
        )

    def test_the_default_format_is_json(self):
        # A production .env that omits LOG_FORMAT must not colourise the container stream. Asserted
        # on the FIELD, not an instance: constructing the settings reads the developer's real .env
        # for anything not passed, so an instance test would measure this machine.
        assert BackendConfig.model_fields["log_format"].default == "json"

    @pytest.mark.parametrize("value,expected", [("JSON", "json"), ("Console", "console")])
    def test_format_case_is_normalised(self, value, expected):
        assert self.make(log_format=value).log_format == expected

    @pytest.mark.parametrize("value,expected", [("critical", "CRITICAL"), ("Info", "INFO")])
    def test_level_case_is_normalised(self, value, expected):
        assert self.make(log_level_app=value).log_level_app == expected


def test_the_context_var_defaults_to_the_sentinel():
    assert correlation_id_var.get() == "SYSTEM"
