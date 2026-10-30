"""
CORE · logging

One logger for the service, beside its child for the erasure journal. A message is a constant
`<slice>.<event>` and every value travels in `extra=`, as a field of its own; a field names what a
request got wrong and never the value submitted for it, which can be personal data.
"""

import json
import logging
import logging.config
import re
import sys
from collections.abc import Mapping
from contextvars import ContextVar
from datetime import UTC, datetime

FL_LOGGER_NAME = "frankfurtleague"
JOURNAL_LOGGER_SUFFIX = "loeschung"

# A sentinel rather than an absent field, so a reader can rely on the key on every line.
NO_REQUEST_SENTINEL = "SYSTEM"
trace_id_var: ContextVar[str] = ContextVar("trace_id", default=NO_REQUEST_SENTINEL)

# A stored or submitted address reaches a message or a stack through a library's own text, a
# duplicate key's report among them; the formatter takes it out of every line, whoever wrote it.
# `fl_frontend/src/core/logging.ts :: ADDRESS` spells the same classes in JavaScript's syntax, `\w` being
# `[\p{L}\p{N}_]` here, and `fl_backend/tests/shared/log_addresses.json` holds the two to one answer. The
# domain ends in a label opening with a letter, as every top-level domain does, so a package store's
# `name@1.2.3` in a stack frame's path is left standing.
ADDRESS = re.compile(r"[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)*\.[^\W\d_][\w-]*")
SCRUBBED = "[address]"

# What every record carries, so whatever else a call passes in `extra=` is a field of its line.
# uvicorn adds `color_message`, a copy of its message with terminal escapes in it.
_RECORD_ATTRIBUTES = frozenset(vars(logging.makeLogRecord({}))) | {"message", "asctime", "trace_id", "color_message"}


class TraceContextFilter(logging.Filter):
    """The request's trace id onto every record, a library's included, since the handler sees them all."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.trace_id = trace_id_var.get()
        return True


def _fields(record: logging.LogRecord) -> dict[str, object]:
    return {key: value for key, value in vars(record).items() if key not in _RECORD_ATTRIBUTES}


def _scrubbed(value: object) -> object:
    """Every string inside `value` without an address, scrubbed before it is serialised.

    Never over the serialised text, where a line break is the two characters `\\n` and the match
    would swallow the escape's `n`, leaving a line no JSON reader parses.
    """

    if isinstance(value, str):
        return ADDRESS.sub(SCRUBBED, value)
    if isinstance(value, Mapping):
        return {key: _scrubbed(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_scrubbed(item) for item in value]
    return value


class JSONFormatter(logging.Formatter):
    """The production line: one JSON document, in the envelope the frontend writes too."""

    def format(self, record: logging.LogRecord) -> str:
        line: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "level": record.levelname,
            "service": "fl_backend",
            "trace_id": getattr(record, "trace_id", trace_id_var.get()),
            "message": record.getMessage(),
            "module": record.module,
            "line": record.lineno,
            **_fields(record),
        }
        if record.exc_info and record.exc_info[1] is not None:
            failure = record.exc_info[1]
            line["error"] = {"name": type(failure).__name__, "message": str(failure), "stack": self.formatException(record.exc_info)}
        # A field holding an id or an instant is written as its text, scrubbed too, rather than failing the line.
        return json.dumps(_scrubbed(line), ensure_ascii=False, default=lambda value: _scrubbed(str(value)))


class PlainFormatter(logging.Formatter):
    """The line a developer reads in a terminal."""

    def format(self, record: logging.LogRecord) -> str:
        fields = " ".join(f"{key}={value}" for key, value in {"trace_id": getattr(record, "trace_id", None), **_fields(record)}.items())
        line = f"{record.levelname:<8} {self.formatTime(record)} {record.module}:{record.lineno} - {record.getMessage()} {fields}"
        if record.exc_info:
            line = f"{line}\n{self.formatException(record.exc_info)}"
        return ADDRESS.sub(SCRUBBED, line)


def setup_logging() -> None:
    """Every record to stdout, ours and the libraries' alike, as JSON unless a person is reading the terminal."""

    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "filters": {"trace": {"()": TraceContextFilter}},
            # A container has no terminal, so production writes JSON with no variable to set or forget.
            "formatters": {"line": {"()": PlainFormatter if sys.stdout.isatty() else JSONFormatter}},
            "handlers": {"stdout": {"class": "logging.StreamHandler", "stream": sys.stdout, "formatter": "line", "filters": ["trace"]}},
            "root": {"handlers": ["stdout"], "level": "INFO"},
            "loggers": {
                # Configured to take uvicorn's own plain-text handlers off, so its lines reach the root's.
                "uvicorn": {"propagate": True},
                # Off by name: configuring `uvicorn` sets every child of it to propagate, and
                # `TraceContextMiddleware` writes the request's one line.
                "uvicorn.access": {"propagate": False},
            },
        }
    )


fl_logger = logging.getLogger(FL_LOGGER_NAME)
journal_logger = fl_logger.getChild(JOURNAL_LOGGER_SUFFIX)
