"""
CORE · structured logging

One logger for the whole service, and nothing else in it writes to stdout: a stray `print` breaks
`docs/logging/spec.md :: L1`. Log the field NAME, never the submitted value -- payloads carry
personal data.
"""

import json
import logging
import logging.config
import re
import sys
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any

from app.core.config import BackendConfig

FL_LOGGER_NAME = "frankfurtleague"

# A sentinel rather than an absent field, so a parser can rely on the key existing on every line.
NO_REQUEST_SENTINEL = "SYSTEM"

# Both set by `fl_backend/app/core/middlewares.py :: TraceContextMiddleware`, and copied onto the
# record by `TraceContextFilter` below -- which is what a formatter reads. Drop the filter and the
# json one defaults every line to the sentinel.
trace_id_var: ContextVar[str] = ContextVar("trace_id", default=NO_REQUEST_SENTINEL)
span_id_var: ContextVar[str] = ContextVar("span_id", default=NO_REQUEST_SENTINEL)

# Listed once, so both formatters put the same set beside the message rather than inside it
# (`docs/logging/spec.md :: L9`).
STRUCTURED_EXTRAS = ("error_code", "method", "path", "status", "duration_ms")

# The code on a failure line no call site of ours wrote -- uvicorn's, pymongo's, the reloader's.
FORWARDED_FAILURE_CODE = "SRV-LOG-001"


class TraceContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.trace_id = trace_id_var.get()
        record.span_id = span_id_var.get()
        return True


class ForwardedFailureFilter(logging.Filter):
    """A code on a failure line a library's own logger wrote, which has no call site of ours to take one from."""

    def filter(self, record: logging.LogRecord) -> bool:
        # Scoped to the OTHER loggers rather than to a missing code: a default for whichever caller
        # forgot one would hide exactly the omission `docs/logging/spec.md` §1.2 exists to refuse.
        own = record.name == FL_LOGGER_NAME or record.name.startswith(f"{FL_LOGGER_NAME}.")
        if not own and record.levelno >= logging.WARNING and getattr(record, "error_code", None) is None:
            record.error_code = FORWARDED_FAILURE_CODE
        return True


class LoggingColors:
    # \x1b[{BACKGROUND};{FOREGROUND}m
    DEBUG_BG = "\x1b[106;30m"  # Bright Cyan bg, Black text
    INFO_BG = "\x1b[102;30m"  # Bright Green bg, Black text
    WARNING_BG = "\x1b[103;30m"  # Bright Yellow bg, Black text
    ERROR_BG = "\x1b[101;97m"  # Bright Red bg, Bright White text
    CRITICAL_BG = "\x1b[105;97m"  # Bright Magenta bg, Bright White text
    RESET = "\x1b[0m"


def format_timestamp(created: float) -> str:
    """UTC, ISO 8601, millisecond precision, `Z` suffix -- identical to the frontend's timestamps."""
    return datetime.fromtimestamp(created, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _structured_extras(record: logging.LogRecord) -> dict[str, Any]:
    return {field: getattr(record, field) for field in STRUCTURED_EXTRAS if getattr(record, field, None) is not None}


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        # The key ORDER is the envelope's (`docs/logging/spec.md` §1.2): the frontend writes the
        # same order, and both suites assert it.
        log_record: dict[str, Any] = {
            "timestamp": format_timestamp(record.created),
            "level": record.levelname,
            "service": "fl_backend",
            "trace_id": getattr(record, "trace_id", NO_REQUEST_SENTINEL),
            "span_id": getattr(record, "span_id", NO_REQUEST_SENTINEL),
            "message": record.getMessage(),
            "module": record.module,
            "line": record.lineno,
            **_structured_extras(record),
        }
        # The same three-key object the frontend logger emits for an Error.
        if record.exc_info and record.exc_info[1] is not None:
            log_record["error"] = {
                "name": type(record.exc_info[1]).__name__,
                "message": str(record.exc_info[1]),
                "stack": self.formatException(record.exc_info),
            }

        return json.dumps(log_record)


# Spelled out rather than str.isspace(), character for character
# `fl_frontend/src/core/logFormat.ts :: NEEDS_QUOTING`'s: the two languages disagree about
# U+001C-U+001F, U+0085 and U+FEFF, so either shorthand renders a value one surface quotes and the
# other writes bare.
NEEDS_QUOTING = re.compile(r"[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff='\"]")


def _console_value(value: Any) -> str:
    """A string bare unless it could split into two pairs; anything else as its JSON, which the frontend renders alike."""
    if isinstance(value, str) and value and not NEEDS_QUOTING.search(value):
        return value
    # `JSON.stringify`'s two defaults, which `json.dumps` does not share: a non-ASCII character
    # raw rather than escaped, and no space after a separator.
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class LevelAwareFormatter(logging.Formatter):
    """The development console line, in the one shape `docs/logging/spec.md` §1.4 fixes for both surfaces."""

    COLORS = {
        logging.DEBUG: LoggingColors.DEBUG_BG,
        logging.INFO: LoggingColors.INFO_BG,
        logging.WARNING: LoggingColors.WARNING_BG,
        logging.ERROR: LoggingColors.ERROR_BG,
        logging.CRITICAL: LoggingColors.CRITICAL_BG,
    }

    def format(self, record: logging.LogRecord) -> str:
        # The colour wraps the level WORD alone, so the padding and everything after it are the
        # plain shape the suites read once the escape is stripped.
        color = self.COLORS.get(record.levelno, LoggingColors.INFO_BG)
        level = f"{color}{record.levelname}{LoggingColors.RESET}{' ' * (8 - len(record.levelname))}"
        moment = datetime.fromtimestamp(record.created)
        timestamp = f"{moment:%Y-%m-%d %H:%M:%S}.{moment.microsecond // 1000:03d}"
        tail = {
            "trace_id": getattr(record, "trace_id", NO_REQUEST_SENTINEL),
            "span_id": getattr(record, "span_id", NO_REQUEST_SENTINEL),
            **_structured_extras(record),
        }
        line = f"{level} {timestamp} {record.module}:{record.lineno} - {record.getMessage()}"
        for key, value in tail.items():
            line = f"{line} {key}={_console_value(value)}"
        if record.exc_info and record.exc_info[1] is not None:
            stack = self.formatException(record.exc_info)
            line = "\n".join([line, *(f"    {entry}" for entry in stack.split("\n"))])
        return line


def setup_custom_logger(config: BackendConfig):
    selected_formatter = "level_aware" if config.log_format == "console" else "json_formatter"
    logging_config = {
        "version": 1,
        "disable_existing_loggers": False,
        "filters": {
            "trace_context_filter": {
                "()": TraceContextFilter,
            },
            "forwarded_failure_filter": {
                "()": ForwardedFailureFilter,
            },
        },
        "formatters": {
            "level_aware": {
                "()": LevelAwareFormatter,
            },
            "json_formatter": {
                "()": JSONFormatter,
            },
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "stream": sys.stdout,
                "formatter": selected_formatter,
                # On the HANDLER rather than on a logger: a library's records reach the stream by
                # propagating to the root, so a filter on ours would never see one.
                "filters": ["trace_context_filter", "forwarded_failure_filter"],
            },
        },
        "root": {"handlers": ["console"], "level": config.log_level_app},
        "loggers": {
            FL_LOGGER_NAME: {
                "level": config.log_level_app,
                # No handler of its own: the root console handler prints each record exactly once.
                "propagate": True,
            },
            "pymongo": {"level": config.log_level_db, "propagate": True},
            "uvicorn": {"level": "INFO", "propagate": True},
            "uvicorn.error": {"level": "INFO", "propagate": True},  # Startup/Shutdown
            # Explicitly OFF, not merely omitted: dictConfig resets every existing CHILD of a
            # configured logger to propagate=True, so an unlisted one logs every request twice.
            "uvicorn.access": {"level": "INFO", "propagate": False},
            "watchfiles": {"level": "WARNING", "propagate": True},  # File reloader
        },
    }
    logging.config.dictConfig(logging_config)


fl_logger = logging.getLogger(FL_LOGGER_NAME)
