import re
import secrets
import time
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Final

import pymongo
from fastapi import FastAPI
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import API_VERSION
from app.core.crud import WritesSent, writes_sent_var
from app.core.logging import fl_logger, trace_id_var

# W3C Trace Context, version 00 alone: a malformed header is attacker-chosen log text. Anchored
# as the frontend's mirror is, with `\A` and `\Z`: `$` admits a trailing newline onto a line.
TRACEPARENT = re.compile(r"\A00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}\Z")
# Each is invalid by the standard, and a validator admitting one hands every request the same id.
ZERO_TRACE_ID = "0" * 32
ZERO_PARENT_ID = "0" * 16

# Docker's healthcheck asks every 30 seconds; its answers would outnumber every other line, and the
# edge still logs the external monitor's checks of it.
IS_LIVE_PATH: Final = f"/api/v{API_VERSION}/system/is_live"

# Under `fl_frontend/src/core/api.ts :: FETCH_TIMEOUT_MS` by what the page's clock counts and
# this one cannot: the hop in, the queue before this runs, the answer's way back.
REQUEST_DEADLINE_S: Final = 10.0

# Where the request's deadline falls, which pymongo holds and publishes no getter for: every abort
# the request sends past it shares one grace after this instant.
request_deadline_var: ContextVar[float | None] = ContextVar("request_deadline", default=None)


@dataclass
class _Answer:
    error_code: str | None = None


# A mutable record set fresh per request rather than a value set per call: a handler run in a copy
# of the context still writes into the request's own.
answer_var: ContextVar[_Answer | None] = ContextVar("answer", default=None)


def record_error_code(code: str) -> None:
    """The code of the failure body this request answers, which its access line carries; outside a request it records nothing."""

    answer = answer_var.get()
    if answer is not None:
        answer.error_code = code


def resolve_trace_id(header_value: str | None) -> str:
    """The incoming `traceparent`'s trace id when the header is well-formed, a freshly minted one otherwise."""
    if header_value is not None:
        # `fullmatch` besides the pattern's own anchors, so neither alone is the guard.
        match = TRACEPARENT.fullmatch(header_value)
        if match and match.group(1) != ZERO_TRACE_ID and match.group(2) != ZERO_PARENT_ID:
            return match.group(1)
    return secrets.token_hex(16)


# Pure ASGI, never Starlette's `BaseHTTPMiddleware`: that runs the app in an anyio task group, where a
# request cancelled once is cancelled again at every await, its cleanup's included.
class TraceContextMiddleware:
    """Binds the trace id to every request context and writes the request's one access line."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        trace_token = trace_id_var.set(resolve_trace_id(request.headers.get("traceparent")))
        answer = _Answer()
        answer_token = answer_var.set(answer)
        # Fresh per request, as the answer is: a record inherited from the context this runs in would
        # answer another request's write as this one's.
        writes_token = writes_sent_var.set(WritesSent())
        started = time.perf_counter()
        deadline_token = request_deadline_var.set(time.monotonic() + REQUEST_DEADLINE_S)

        status: int | None = None

        # Nothing is echoed on the response: the failure body carries the trace id, and a response
        # header would put it where nothing reads it.
        async def send_noting_status(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            # A deadline, not the client's `timeoutMS`: `with_transaction` retries a transient failure,
            # an unreachable server's included, for 120 s, and a deadline is the one limit its loop
            # checks sooner.
            with pymongo.timeout(REQUEST_DEADLINE_S):
                await self.app(scope, receive, send_noting_status)
        except Exception:
            # Reached by every crash, which Starlette answers and raises again for the server to log;
            # the access line carries the status the client was sent, 500 where none had started.
            self._log_access(request, 500 if status is None else status, started, answer)
            raise
        else:
            # An app returning without a response is answered 500 by the server.
            self._log_access(request, 500 if status is None else status, started, answer)
        finally:
            # Reset, or the id bleeds onto the log lines of whichever request the loop runs next.
            request_deadline_var.reset(deadline_token)
            writes_sent_var.reset(writes_token)
            answer_var.reset(answer_token)
            trace_id_var.reset(trace_token)

    @staticmethod
    def _log_access(request: Request, status: int, started: float, answer: _Answer) -> None:
        if request.url.path == IS_LIVE_PATH and status < 400:
            return
        # The query string is logged too: on this API it carries ids and filters, never personal
        # data, which travels in bodies and is never logged.
        path = request.url.path + (f"?{request.url.query}" if request.url.query else "")
        # INFO for a refusal as for a success: a refused request is the API working, and only a
        # 5xx adds a line of its own.
        fl_logger.info(
            "http.answered",
            extra={
                # Explicit as well as filter-stamped, so a handler without `TraceContextFilter`
                # still reads the request's id on this record.
                "trace_id": trace_id_var.get(),
                "method": request.method,
                "path": path,
                "status": status,
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                **({"error_code": answer.error_code} if answer.error_code is not None else {}),
            },
        )


class TracedApp(FastAPI):
    """`add_middleware` places a layer inside `ServerErrorMiddleware`, which runs the catch-all handler once that layer returned.

    The handler's line and body would then read ids already reset.
    """

    def build_middleware_stack(self) -> ASGIApp:
        # The method FastAPI itself overrides to place a layer Starlette's builder has no slot for.
        return TraceContextMiddleware(super().build_middleware_stack())
