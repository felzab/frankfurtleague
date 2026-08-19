"""
CORE · structured logging

One logger for the whole service, and nothing else in it writes to stdout: a stray `print` breaks
`docs/logging/spec.md :: L1`. Log the field NAME, never the submitted value -- payloads carry
personal data.
"""

import json
import logging
import logging.config
import sys
from contextvars import ContextVar
from datetime import datetime, timezone

from app.core.config import BackendConfig

FL_LOGGER_NAME = "frankfurtleague"

# A sentinel rather than an absent field, so a parser can rely on the key existing on every line.
NO_REQUEST_SENTINEL = "SYSTEM"

# Set by `fl_backend/app/core/middlewares.py :: CorrelationIdMiddleware`, read by every formatter below.
correlation_id_var: ContextVar[str] = ContextVar("correlation_id", default=NO_REQUEST_SENTINEL)

# Listed once, so both formatters and the frontend logger agree on what travels as a field rather
# than inside the message text (`docs/logging/spec.md :: L2`).
STRUCTURED_EXTRAS = ("error_code", "method", "path", "status", "duration_ms")


class CorrelationIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.correlation_id = correlation_id_var.get()
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


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_record = {
            "timestamp": format_timestamp(record.created),
            "level": record.levelname,
            "service": "fl_backend",
            "correlation_id": getattr(record, "correlation_id", NO_REQUEST_SENTINEL),
            "message": record.getMessage(),
            "module": record.module,
            "line": record.lineno,
        }
        for field in STRUCTURED_EXTRAS:
            value = getattr(record, field, None)
            if value is not None:
                log_record[field] = value
        # The same three-key object the frontend logger emits for an Error.
        if record.exc_info and record.exc_info[1] is not None:
            log_record["error"] = {
                "name": type(record.exc_info[1]).__name__,
                "message": str(record.exc_info[1]),
                "stack": self.formatException(record.exc_info),
            }

        return json.dumps(log_record)


class LevelAwareFormatter(logging.Formatter):
    BASE_LAYOUT = "%(asctime)s | [%(module)s:%(lineno)d] <%(correlation_id)s>"
    FORMATS = {
        logging.DEBUG: f"{LoggingColors.DEBUG_BG}%(levelname)-8s{LoggingColors.RESET} {BASE_LAYOUT} - %(message)s",
        logging.INFO: f"{LoggingColors.INFO_BG}%(levelname)-8s{LoggingColors.RESET} {BASE_LAYOUT} - %(message)s",
        logging.WARNING: f"{LoggingColors.WARNING_BG}%(levelname)-8s{LoggingColors.RESET} {BASE_LAYOUT} - %(message)s",
        logging.ERROR: f"{LoggingColors.ERROR_BG}%(levelname)-8s{LoggingColors.RESET} {BASE_LAYOUT}\n         ❌ %(message)s",
        logging.CRITICAL: f"{LoggingColors.CRITICAL_BG}%(levelname)-8s{LoggingColors.RESET} {BASE_LAYOUT}\n         🚨 %(message)s",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._formatters = {level: logging.Formatter(fmt, datefmt="%Y-%m-%d %H:%M:%S") for level, fmt in self.FORMATS.items()}

    def format(self, record: logging.LogRecord) -> str:
        formatter = self._formatters.get(record.levelno, self._formatters[logging.INFO])
        line = formatter.format(record)
        # The console format carries the code inline; the JSON format carries it as a field.
        error_code = getattr(record, "error_code", None)
        if error_code is not None:
            line = f"{line} [{error_code}]"
        return line


def setup_custom_logger(config: BackendConfig):
    selected_formatter = "level_aware" if config.log_format == "console" else "json_formatter"
    logging_config = {
        "version": 1,
        "disable_existing_loggers": False,
        "filters": {
            "correlation_id_filter": {
                "()": CorrelationIdFilter,
            }
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
                "filters": ["correlation_id_filter"],
            },
        },
        "root": {"handlers": ["console"], "level": config.log_level_app},
        "loggers": {
            FL_LOGGER_NAME: {
                "level": config.log_level_app,
                # No handler of its own: the root console handler prints each record exactly once.
                "propagate": True,
            },
            "motor": {"level": config.log_level_db, "propagate": True},
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
