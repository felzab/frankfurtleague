import json
import logging
import re
import sys
from pathlib import Path
from typing import Final

import pytest
import uvicorn.config
from starlette.applications import Starlette
from starlette.responses import Response
from starlette.routing import Route
from starlette.testclient import TestClient

from app.core.logging import JSONFormatter, fl_logger, setup_logging
from app.core.middlewares import TraceContextMiddleware, record_error_code, resolve_trace_id

TRACE = "a" * 32
PARENT = "b" * 16
WELL_FORMED = f"00-{TRACE}-{PARENT}-01"


# One table both formatters run, `fl_frontend/src/core/logging.test.ts` holding the other half.
LOG_ADDRESSES: Final = json.loads((Path(__file__).resolve().parents[1] / "shared" / "log_addresses.json").read_bytes().decode("utf-8"))

# One table both trace readers refuse, `fl_frontend/src/core/trace.test.ts` holding the other half.
TRACEPARENTS: Final = json.loads((Path(__file__).resolve().parents[1] / "shared" / "traceparents.json").read_bytes().decode("utf-8"))


def a_failure_record(message: str, *, failure: str = "refused anna.beispiel@example.org", **fields: object) -> logging.LogRecord:
    try:
        raise ValueError(failure)
    except ValueError:
        record = fl_logger.makeRecord(fl_logger.name, logging.ERROR, __file__, 1, message, (), sys.exc_info(), extra=fields)
    return record


class TestTheProductionLine:
    def test_is_one_json_document_carrying_each_field_and_the_error(self):
        line = JSONFormatter().format(a_failure_record("mail.send_failed", saison_id="2027", status=502))

        document = json.loads(line)
        assert "\n" not in line
        assert (document["message"], document["saison_id"], document["status"]) == ("mail.send_failed", "2027", 502)
        assert document["error"]["name"] == "ValueError"
        assert "Traceback" in document["error"]["stack"]

    @pytest.mark.parametrize("row", LOG_ADDRESSES, ids=lambda row: row["case"])
    def test_scrubs_the_shared_table_in_its_message_its_fields_and_its_error_and_stays_one_document(self, row: dict[str, str]):
        document = json.loads(JSONFormatter().format(a_failure_record(row["text"], failure=row["text"], quoted=[{"text": row["text"]}])))

        assert (document["message"], document["quoted"], document["error"]["message"]) == (
            row["scrubbed"],
            [{"text": row["scrubbed"]}],
            row["scrubbed"],
        )
        assert document["error"]["stack"].endswith(f"ValueError: {row['scrubbed']}")


class TestResolveTraceId:
    @pytest.mark.parametrize("flags", ["01", "00"])
    def test_a_well_formed_traceparent_yields_its_trace_id(self, flags):
        assert resolve_trace_id(f"00-{TRACE}-{PARENT}-{flags}") == TRACE

    @pytest.mark.parametrize("hostile", [None, *(row["header"] for row in TRACEPARENTS)])
    def test_mints_instead_of_honouring_anything_malformed(self, hostile):
        """One table both hops read, so a row either hop admits fails that hop's own suite."""
        resolved = resolve_trace_id(hostile)

        # Nothing the header carried, an all-zero id included: a fresh mint shares no 32 characters with it.
        assert resolved not in (hostile or "")
        assert re.fullmatch(r"[a-f0-9]{32}", resolved)


async def refused(request):
    record_error_code("probe")
    return Response(status_code=409)


def test_the_access_line_carries_the_code_the_request_was_refused_with(caplog):
    """The refusal's one line: no handler writes another, so a code missing here is a refusal no log records."""
    app = TraceContextMiddleware(Starlette(routes=[Route("/refused", refused)]))

    with caplog.at_level(logging.INFO, logger=fl_logger.name):
        TestClient(app).get("/refused", headers={"traceparent": WELL_FORMED})

    assert [
        (record.getMessage(), record.status, record.error_code, record.trace_id) for record in caplog.records if record.name == fl_logger.name
    ] == [("http.answered", 409, "probe", TRACE)]


def test_uvicorn_s_own_handlers_are_taken_off_so_its_lines_reach_the_service_s():
    """What lets the image run uvicorn on its default configuration: a handler of its own left on would print plain text beside the JSON."""
    # Its configuration as the image runs it: the default, with the access log off.
    uvicorn.config.Config("app.asgi:app", access_log=False)

    setup_logging()

    assert [logging.getLogger(name).handlers for name in ("uvicorn", "uvicorn.error", "uvicorn.access")] == [[], [], []]
    assert logging.getLogger("uvicorn.error").propagate and logging.getLogger("uvicorn").propagate
    assert not logging.getLogger("uvicorn.access").propagate
