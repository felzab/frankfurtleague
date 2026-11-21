import re
import secrets
import time
from collections.abc import Sequence
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, Final

import pymongo
from fastapi import FastAPI
from fastapi.routing import APIRoute, RouteContext, iter_route_contexts
from starlette.requests import Request
from starlette.routing import BaseRoute, Match
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.logging import fl_logger, trace_id_var

# W3C Trace Context, version 00 alone: a malformed header is attacker-chosen log text.
TRACEPARENT = re.compile(r"00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}")
# Each is invalid by the standard, and a validator admitting one hands every request the same id.
ZERO_TRACE_ID = "0" * 32
ZERO_PARENT_ID = "0" * 16

# The two probes, whose answers would outnumber every other line: Docker's healthcheck asks the first
# every 30 seconds, a monitor outside asks the second on a schedule of its own, and the edge logs
# every request from outside. A failed answer is still logged: it marks when the probe began failing.
PROBE_PATHS: Final = frozenset({"/api/system/is_live", "/api/system/is_ready"})

# Under the frontend's fetch timeout by what the page's clock counts and this one cannot: the hop
# in, the queue before this runs, the answer's way back.
REQUEST_DEADLINE_S: Final = 10.0

# An hourly pass's operation, which takes its rows one at a time, or a clock's rows in one write, until it has none
# left or `PASS_DEADLINE_S` cuts it.
# Stated as an OpenAPI specification extension, as `SAFE` is, so the frontend's generated client sends such a call
# under the bound that outlasts this deadline. A pass outrunning it finishes in the hours after.
PASS: Final[dict[str, Any]] = {"x-pass": True}
(_PASS_KEY,) = PASS

# The longest a deploy should wait on a pass the stop met, which uvicorn's graceful wait and the backend's stop grace
# outlast; not a measured count. The code admits thousands of pupils due together, well over an hour of one erasure
# after another, so no wait a deploy can take covers the largest pass.
PASS_DEADLINE_S: Final = 60.0


def pass_routes(routes: Sequence[BaseRoute]) -> list[RouteContext]:
    """Each operation marked `x-pass`, as the router serves it: under the prefix it was included with, with its own pattern.

    Kept only where the published document lists the operation, whose `x-pass` FastAPI copies from this same
    `openapi_extra`: the frontend's client is generated from that document, so the two halves of the bound cannot name
    different operations.
    """

    return [
        context
        for context in iter_route_contexts(routes)
        if isinstance(context.original_route, APIRoute) and context.include_in_schema and (context.openapi_extra or {}).get(_PASS_KEY) is True
    ]


@dataclass
class RequestDeadline:
    """Where the request's deadline falls, which pymongo holds and publishes no getter for, and what its aborts spent past it."""

    at: float
    aborting_s: float = 0.0


# A mutable record set fresh per request, as `answer_var` is: an abort run in a copy of the context
# still counts against the request's own grace.
request_deadline_var: ContextVar[RequestDeadline | None] = ContextVar("request_deadline", default=None)


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
        match = TRACEPARENT.fullmatch(header_value)
        if match and match.group(1) != ZERO_TRACE_ID and match.group(2) != ZERO_PARENT_ID:
            return match.group(1)
    return secrets.token_hex(16)


# Pure ASGI, never Starlette's `BaseHTTPMiddleware`: that runs the app in an anyio task group, where a
# request cancelled once is cancelled again at every await, its cleanup's included.
class TraceContextMiddleware:
    """Binds the trace id to every request context and writes the request's one access line."""

    def __init__(self, app: ASGIApp, *, passes: Sequence[RouteContext] = ()) -> None:
        self.app = app
        self.passes = passes

    def deadline_s(self, scope: Scope) -> float:
        """The request's deadline: a pass's own, or every other request's.

        Chosen here, before the routing: `pymongo.timeout` entered inside this one only narrows it.
        """

        # Matched as the router matches: the route's own convertors, its methods, and the path past any `root_path`.
        if any(context.matches(scope)[0] is Match.FULL for context in self.passes):
            return PASS_DEADLINE_S

        return REQUEST_DEADLINE_S

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        trace_token = trace_id_var.set(resolve_trace_id(request.headers.get("traceparent")))
        answer = _Answer()
        answer_token = answer_var.set(answer)
        started = time.perf_counter()
        deadline_s = self.deadline_s(scope)
        deadline_token = request_deadline_var.set(RequestDeadline(time.monotonic() + deadline_s))

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
            with pymongo.timeout(deadline_s):
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
            answer_var.reset(answer_token)
            trace_id_var.reset(trace_token)

    @staticmethod
    def _log_access(request: Request, status: int, started: float, answer: _Answer) -> None:
        if request.url.path in PROBE_PATHS and status < 400:
            return
        # The query string is logged too: on this API it carries ids and filters, never personal
        # data, which travels in bodies and is never logged.
        path = request.url.path + (f"?{request.url.query}" if request.url.query else "")
        # INFO for a refusal as for a success: a refused request is the API working, and only a
        # 5xx adds a line of its own.
        fl_logger.info(
            "http.answered",
            extra={
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
        # The method FastAPI itself overrides to place a layer Starlette's builder has no slot for. Built at the first
        # call, the lifespan's included, once every route is mounted, so the walk meets every pass.
        return TraceContextMiddleware(super().build_middleware_stack(), passes=pass_routes(self.routes))
