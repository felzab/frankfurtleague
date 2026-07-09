import json
import logging
import logging.config
import sys
from contextvars import ContextVar

from app.core.config import backend_config

FL_LOGGER_NAME = "frankfurtleague"

# The Context Variable to hold our Next.js Trace ID
trace_id_var: ContextVar[str] = ContextVar("trace_id", default="SYSTEM")


# Injects the Trace ID into the log record
class TraceIDFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.trace_id = trace_id_var.get()
        return True


# ANSI Color Codes
class LoggingColors:
    # \x1b[{BACKGROUND};{FOREGROUND}m
    DEBUG_BG = "\x1b[106;30m"  # Bright Cyan bg, Black text
    INFO_BG = "\x1b[102;30m"  # Bright Green bg, Black text
    WARNING_BG = "\x1b[103;30m"  # Bright Yellow bg, Black text
    ERROR_BG = "\x1b[101;97m"  # Bright Red bg, Bright White text
    CRITICAL_BG = "\x1b[105;97m"  # Bright Magenta bg, Bright White text
    RESET = "\x1b[0m"


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_record = {
            "level": record.levelname,
            "timestamp": self.formatTime(record, self.datefmt),
            "module": record.module,
            "line": record.lineno,
            "trace_id": getattr(record, "trace_id", "SYSTEM"),
            "message": record.getMessage(),
        }
        # Automatically append the traceback if the log is an exception!
        if record.exc_info:
            log_record["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_record)


class LevelAwareFormatter(logging.Formatter):
    BASE_LAYOUT = "%(asctime)s | [%(module)s:%(lineno)d] <%(trace_id)s>"
    FORMATS = {
        # Standard levels: 1-line, perfectly aligned
        logging.DEBUG: f"{LoggingColors.DEBUG_BG}%(levelname)-8s{LoggingColors.RESET} {BASE_LAYOUT} - %(message)s",
        logging.INFO: f"{LoggingColors.INFO_BG}%(levelname)-8s{LoggingColors.RESET} {BASE_LAYOUT} - %(message)s",
        logging.WARNING: f"{LoggingColors.WARNING_BG}%(levelname)-8s{LoggingColors.RESET} {BASE_LAYOUT} - %(message)s",
        # Error levels: Adds a line break, an icon, and aligns the message underneath the timestamp
        logging.ERROR: f"{LoggingColors.ERROR_BG}%(levelname)-8s{LoggingColors.RESET} {BASE_LAYOUT}\n         ❌ %(message)s",
        logging.CRITICAL: f"{LoggingColors.CRITICAL_BG}%(levelname)-8s{LoggingColors.RESET} {BASE_LAYOUT}\n         🚨 %(message)s",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Pre-compile the formatters once in memory
        self._formatters = {
            level: logging.Formatter(fmt, datefmt="%Y-%m-%d %H:%M:%S")
            for level, fmt in self.FORMATS.items()
        }

    def format(self, record: logging.LogRecord) -> str:
        formatter = self._formatters.get(record.levelno, self._formatters[logging.INFO])
        return formatter.format(record)


def setup_custom_logger():
    selected_formatter = (
        "level_aware" if backend_config.log_format == "console" else "json_formatter"
    )
    logging_config = {
        "version": 1,
        "disable_existing_loggers": False,
        "filters": {
            "trace_id_filter": {
                "()": TraceIDFilter,
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
                "filters": ["trace_id_filter"],
            },
        },
        "root": {"handlers": ["console"], "level": backend_config.log_level_app},
        "loggers": {
            FL_LOGGER_NAME: {
                "level": backend_config.log_level_app,
                "propagate": True,  # This stops the double-printing!
            },
            "motor": {"level": backend_config.log_level_db, "propagate": True},
            "pymongo": {"level": backend_config.log_level_db, "propagate": True},
            "uvicorn": {"level": "INFO", "propagate": True},
            "uvicorn.access": {"level": "INFO", "propagate": True},  # Incoming requests
            "uvicorn.error": {"level": "INFO", "propagate": True},  # Startup/Shutdown
            "watchfiles": {"level": "WARNING", "propagate": True},  # File reloader
        },
    }
    logging.config.dictConfig(logging_config)


fl_logger = logging.getLogger(FL_LOGGER_NAME)
