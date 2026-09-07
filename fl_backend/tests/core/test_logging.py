import ast
import json
import logging
import re
import sys

import pytest
from pydantic import SecretStr

from app.core.config import INTERNAL_API_KEY_LENGTH, BackendConfig
from app.core.logging import (
    FL_LOGGER_NAME,
    FORWARDED_FAILURE_CODE,
    ForwardedFailureFilter,
    JSONFormatter,
    LevelAwareFormatter,
    fl_logger,
    span_id_var,
    trace_id_var,
)
from app.core.middlewares import mint_span_id, resolve_trace_id
from tests.config import ConfigReadingNoDotenvFile
from tests.core.app_source import APP_ROOT, parsed

TIMESTAMP_SHAPE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\Z")

# The one console line shape both surfaces implement (`docs/logging/spec.md` §1.4), read after the
# level word's colour is stripped. The frontend suite holds the same expression.
CONSOLE_SHAPE = re.compile(r"^(DEBUG|INFO|WARNING|ERROR|CRITICAL) {1,5}\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \S+ - ")
ANSI_SGR = re.compile(r"\x1b\[[0-9;]*m")

TRACE = "a" * 32
SPAN = "b" * 16
WELL_FORMED = f"00-{TRACE}-{SPAN}-01"


def make_record(message: str = "hello", level: int = logging.INFO, logger_name: str = FL_LOGGER_NAME, **attrs) -> logging.LogRecord:
    record = logging.LogRecord(name=logger_name, level=level, pathname=__file__, lineno=1, msg=message, args=(), exc_info=None)
    for key, value in attrs.items():
        setattr(record, key, value)
    return record


def record_with_exception(level: int = logging.ERROR, **attrs) -> logging.LogRecord:
    try:
        raise ValueError("boom")
    except ValueError:
        record = make_record(level=level, **attrs)
        record.exc_info = sys.exc_info()
    return record


def plain(line: str) -> str:
    return ANSI_SGR.sub("", line)


class TestJSONFormatter:
    def test_emits_one_parseable_document_with_the_shared_field_set(self):
        line = JSONFormatter().format(make_record(trace_id=TRACE, span_id=SPAN))

        document = json.loads(line)
        assert "\n" not in line
        assert document["level"] == "INFO"
        assert document["service"] == "fl_backend"
        assert document["trace_id"] == TRACE
        assert document["span_id"] == SPAN
        assert document["message"] == "hello"
        assert TIMESTAMP_SHAPE.fullmatch(document["timestamp"]), document["timestamp"]

    def test_the_field_order_is_the_envelope_s(self):
        """The ORDER, not only the set: the frontend suite asserts the same list, which is what makes one parser read both (L2)."""
        document = json.loads(JSONFormatter().format(make_record(trace_id=TRACE, span_id=SPAN)))

        assert list(document) == ["timestamp", "level", "service", "trace_id", "span_id", "message", "module", "line"]

    def test_a_record_outside_any_request_carries_the_sentinel_on_both_ids(self):
        document = json.loads(JSONFormatter().format(make_record()))

        assert document["trace_id"] == "SYSTEM"
        assert document["span_id"] == "SYSTEM"

    def test_structured_extras_travel_as_fields_after_the_head_and_before_the_error(self):
        record = record_with_exception(error_code="REQ-AUTH-001", method="GET", path="/api/v0/spiele", status=401, duration_ms=1.2)

        document = json.loads(JSONFormatter().format(record))

        assert document["error_code"] == "REQ-AUTH-001"
        assert document["method"] == "GET"
        assert document["path"] == "/api/v0/spiele"
        assert document["status"] == 401
        assert document["duration_ms"] == 1.2
        assert list(document)[8:] == ["error_code", "method", "path", "status", "duration_ms", "error"]

    def test_an_exception_serialises_as_the_shared_error_object(self):
        document = json.loads(JSONFormatter().format(record_with_exception()))

        # The same three keys the frontend logger writes for an Error, so one parser reads both.
        assert document["error"]["name"] == "ValueError"
        assert document["error"]["message"] == "boom"
        assert "Traceback" in document["error"]["stack"]


class TestForwardedFailureFilter:
    @pytest.mark.parametrize("logger_name", ["uvicorn.error", "pymongo.topology", "watchfiles.main"])
    @pytest.mark.parametrize("level", [logging.WARNING, logging.ERROR, logging.CRITICAL])
    def test_a_failure_record_from_another_library_takes_the_forwarded_code(self, logger_name, level):
        """The lifespan refusal's `uvicorn.error` line is the one an operator meets; the others share its shape."""
        record = make_record(level=level, logger_name=logger_name)

        ForwardedFailureFilter().filter(record)

        assert getattr(record, "error_code", None) == FORWARDED_FAILURE_CODE

    @pytest.mark.parametrize("level", [logging.DEBUG, logging.INFO])
    def test_a_record_below_warning_takes_no_code(self, level):
        record = make_record(level=level, logger_name="uvicorn.error")

        ForwardedFailureFilter().filter(record)

        assert getattr(record, "error_code", None) is None

    @pytest.mark.parametrize("logger_name", [FL_LOGGER_NAME, f"{FL_LOGGER_NAME}.db"])
    def test_an_application_record_is_left_uncoded(self, logger_name):
        """The filter is not a default: a writer of ours that forgot a code stays visible as an uncoded line."""
        record = make_record(level=logging.ERROR, logger_name=logger_name)

        ForwardedFailureFilter().filter(record)

        assert getattr(record, "error_code", None) is None

    def test_a_code_a_record_already_carries_survives(self):
        record = make_record(level=logging.ERROR, logger_name="uvicorn.error", error_code="SRV-BOOT-004")

        ForwardedFailureFilter().filter(record)

        assert getattr(record, "error_code", None) == "SRV-BOOT-004"

    def test_the_record_still_reaches_the_handler(self):
        assert ForwardedFailureFilter().filter(make_record(level=logging.ERROR, logger_name="uvicorn.error")) is True


def _get_logger_call(node: ast.AST) -> ast.Call | None:
    """A `logging.getLogger(...)` or a bare `getLogger(...)`, whichever way the module imported it."""
    if not isinstance(node, ast.Call):
        return None
    named = (isinstance(node.func, ast.Attribute) and node.func.attr == "getLogger") or (
        isinstance(node.func, ast.Name) and node.func.id == "getLogger"
    )
    return node if named else None


class TestTheApplicationsOneLogger:
    def test_the_application_creates_exactly_one_logger(self):
        """`ForwardedFailureFilter` decides by a record's logger NAME, so a second logger under `app/` would be coded as a library's."""
        calls = [
            (path.relative_to(APP_ROOT.parent).as_posix(), call)
            for path in sorted(APP_ROOT.rglob("*.py"))
            for node in ast.walk(parsed(path))
            if (call := _get_logger_call(node)) is not None
        ]

        assert [where for where, _ in calls] == ["app/core/logging.py"]
        [(_, call)] = calls
        assert [ast.unparse(argument) for argument in call.args] == ["FL_LOGGER_NAME"]

    def test_that_logger_is_the_one_the_filter_treats_as_ours(self):
        assert fl_logger.name == FL_LOGGER_NAME


class TestConsoleFormatter:
    @pytest.mark.parametrize("level", [logging.DEBUG, logging.INFO, logging.WARNING, logging.ERROR, logging.CRITICAL])
    def test_every_level_opens_the_one_shape(self, level):
        line = plain(LevelAwareFormatter().format(make_record(level=level, trace_id=TRACE, span_id=SPAN)))

        assert CONSOLE_SHAPE.match(line), line

    def test_the_origin_is_module_and_line(self):
        line = plain(LevelAwareFormatter().format(make_record(trace_id=TRACE, span_id=SPAN)))

        assert " test_logging:1 - hello trace_id=" in line

    def test_the_colour_wraps_the_level_word_alone(self):
        line = LevelAwareFormatter().format(make_record(level=logging.WARNING, trace_id=TRACE, span_id=SPAN))

        assert re.match(r"\x1b\[[0-9;]+mWARNING\x1b\[0m {2}\d{4}-", line), line

    def test_the_ids_lead_the_tail_and_the_extras_follow_in_envelope_order(self):
        record = make_record(
            trace_id=TRACE, span_id=SPAN, error_code="DB-COMMON-002", method="GET", path="/api/v0/spiele", status=409, duration_ms=1.2
        )

        line = plain(LevelAwareFormatter().format(record))

        assert line.endswith(
            f" - hello trace_id={TRACE} span_id={SPAN} error_code=DB-COMMON-002 method=GET path=/api/v0/spiele status=409 duration_ms=1.2"
        )

    def test_the_sentinel_is_written_outside_a_request(self):
        line = plain(LevelAwareFormatter().format(make_record()))

        assert line.endswith(" - hello trace_id=SYSTEM span_id=SYSTEM")

    @pytest.mark.parametrize(
        "value,rendered",
        [
            ("/api/v0/spiele?limit=5", '"/api/v0/spiele?limit=5"'),  # `=`
            ("two words", '"two words"'),
            ('say "hi"', '"say \\"hi\\""'),
            ("it's", '"it\'s"'),
            ("", '""'),
            ("plain", "plain"),
            (True, "true"),
            (409, "409"),
            (1.5, "1.5"),
        ],
    )
    def test_a_value_is_bare_only_where_bare_is_unambiguous(self, value, rendered):
        """The frontend renders the same table: a value that could split into two pairs is quoted as JSON, and a non-string is its JSON."""
        line = plain(LevelAwareFormatter().format(make_record(path=value)))

        assert line.endswith(f" path={rendered}"), line

    @pytest.mark.parametrize("code_point", [0x1C, 0x1D, 0x1E, 0x1F, 0x85, 0xA0, 0x2028, 0x2029, 0x3000, 0xFEFF])
    def test_a_value_carrying_any_code_point_the_quoting_class_names_is_quoted(self, code_point):
        """Six of these `str.isspace()` and JS `\\s` disagree over; `fl_frontend/src/core/logFormat.test.ts` runs the same ten."""
        value = "a" + chr(code_point) + "b"
        inner = "a" + (f"\\u{code_point:04x}" if code_point < 0x20 else chr(code_point)) + "b"

        line = plain(LevelAwareFormatter().format(make_record(path=value)))

        assert line.endswith(f' path="{inner}"'), line

    def test_a_non_ascii_value_is_written_as_itself_rather_than_escaped(self):
        """`json.dumps` escapes it by default and `JSON.stringify` never does, which is the difference between one shape and one line."""
        line = plain(LevelAwareFormatter().format(make_record(path="/teams?name=S" + chr(0xFC) + "d")))

        assert line.endswith(' path="/teams?name=S' + chr(0xFC) + 'd"'), line

    def test_an_exception_s_stack_follows_on_indented_lines(self):
        line = plain(LevelAwareFormatter().format(record_with_exception(trace_id=TRACE, span_id=SPAN)))

        head, *stack = line.split("\n")
        assert CONSOLE_SHAPE.match(head)
        assert head.endswith(f"trace_id={TRACE} span_id={SPAN}")
        assert stack[0] == "    Traceback (most recent call last):"
        assert all(entry.startswith("    ") for entry in stack), stack
        assert stack[-1] == "    ValueError: boom"


class TestResolveTraceId:
    @pytest.mark.parametrize("flags", ["01", "00"])
    def test_a_well_formed_traceparent_yields_its_trace_id(self, flags):
        assert resolve_trace_id(f"00-{TRACE}-{SPAN}-{flags}") == TRACE

    @pytest.mark.parametrize(
        "hostile",
        [
            None,
            "",
            "PROBE-AAA",
            "c0ffee00" * 4,  # yesterday's bare 32-hex id is not a traceparent
            WELL_FORMED.upper(),
            f"01-{TRACE}-{SPAN}-01",  # a version this validator does not read
            f"00-{'0' * 32}-{SPAN}-01",  # all-zero trace id
            f"00-{TRACE}-{'0' * 16}-01",  # all-zero span id
            f"00-{TRACE[:31]}-{SPAN}-01",
            f"00-{TRACE}-{SPAN[:15]}-01",
            f"00-{TRACE}-{SPAN}-1",
            f"00-{TRACE}-{SPAN}",  # no flags segment
            f"00-{TRACE}-{SPAN}-01-extra",
            f"00-{'x' * 65}-{SPAN}-01",
            f" 00-{TRACE}-{SPAN}-01",
            f"00-{TRACE}-{SPAN}-01\n",
            f"00-{TRACE}-{SPAN}-01\ndef",
            f'00-{TRACE}-{SPAN}-01","injected":"line',  # log-injection attempt
            "abc\ndef",
        ],
    )
    def test_mints_instead_of_honouring_anything_malformed(self, hostile):
        """Mirrored entry for entry by `fl_frontend/src/core/trace.test.ts`: a hop admitting what the other refuses admits injected text."""
        resolved = resolve_trace_id(hostile)

        assert resolved != TRACE
        assert resolved != hostile
        assert re.fullmatch(r"[a-f0-9]{32}", resolved)


def test_a_span_is_sixteen_hex_and_fresh_each_time():
    assert re.fullmatch(r"[a-f0-9]{16}", mint_span_id())
    assert mint_span_id() != mint_span_id()


class TestLoggingSettings:
    def make(self, **overrides) -> BackendConfig:
        return ConfigReadingNoDotenvFile(
            api_trusted_hosts="testserver",
            api_cors_allowed_origins="http://localhost:3000",
            mongodb_uri=SecretStr("mongodb://localhost:27017/t"),
            db_base_name="t",
            internal_api_key_base=SecretStr("b" * INTERNAL_API_KEY_LENGTH),
            internal_api_key_system=SecretStr("s" * INTERNAL_API_KEY_LENGTH),
            internal_api_key_admin=SecretStr("a" * INTERNAL_API_KEY_LENGTH),
            **overrides,
        )

    def test_the_default_format_is_json(self):
        # Asserted on the field rather than an instance: constructing the settings reads the developer's
        # real `.env` for anything not passed.
        assert BackendConfig.model_fields["log_format"].default == "json"

    @pytest.mark.parametrize("value,expected", [("JSON", "json"), ("Console", "console")])
    def test_format_case_is_normalised(self, value, expected):
        assert self.make(log_format=value).log_format == expected

    @pytest.mark.parametrize("value,expected", [("critical", "CRITICAL"), ("Info", "INFO")])
    def test_level_case_is_normalised(self, value, expected):
        assert self.make(log_level_app=value).log_level_app == expected


def test_both_context_vars_default_to_the_sentinel():
    assert trace_id_var.get() == "SYSTEM"
    assert span_id_var.get() == "SYSTEM"
