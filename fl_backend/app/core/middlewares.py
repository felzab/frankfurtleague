import re
import secrets
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.logging import fl_logger, span_id_var, trace_id_var

# W3C Trace Context, version 00 alone: a malformed header is attacker-chosen log text. Anchored
# as the frontend's mirror is, with `\A` and `\Z`: `$` admits a trailing newline onto a line.
TRACEPARENT = re.compile(r"\A00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}\Z")
# Each is invalid by the standard, and a validator admitting one hands every request the same id.
ZERO_TRACE_ID = "0" * 32
ZERO_SPAN_ID = "0" * 16


def resolve_trace_id(header_value: str | None) -> str:
    """The incoming `traceparent`'s trace id when the header is well-formed, a freshly minted one otherwise."""
    if header_value is not None:
        # `fullmatch` besides the pattern's own anchors, so neither alone is the guard.
        match = TRACEPARENT.fullmatch(header_value)
        if match and match.group(1) != ZERO_TRACE_ID and match.group(2) != ZERO_SPAN_ID:
            return match.group(1)
    return secrets.token_hex(16)


def mint_span_id() -> str:
    return secrets.token_hex(8)


class TraceContextMiddleware(BaseHTTPMiddleware):
    """Binds a trace id and this hop's own span id to every request context and writes the per-request access line."""

    async def dispatch(self, request: Request, call_next):
        # The incoming span is read for validity and discarded: this hop's lines carry its OWN span,
        # the trace id being what joins them to the edge's and the frontend's (L12).
        trace_id = resolve_trace_id(request.headers.get("traceparent"))
        span_id = mint_span_id()

        trace_token = trace_id_var.set(trace_id)
        span_token = span_id_var.set(span_id)
        started = time.perf_counter()

        try:
            # Nothing is echoed on the response: the failure body carries the trace id, and a
            # response header would put it where nothing reads it.
            response = await call_next(request)

            self._log_access(request, response.status_code, started, trace_id, span_id)
            return response
        except Exception:
            # Reached only when no exception handler produced a response; the access line is still
            # written.
            self._log_access(request, 500, started, trace_id, span_id)
            raise
        finally:
            # Reset, or the ids bleed onto the log lines of whichever request the loop runs next.
            span_id_var.reset(span_token)
            trace_id_var.reset(trace_token)

    @staticmethod
    def _log_access(request: Request, status: int, started: float, trace_id: str, span_id: str) -> None:
        # The query string is logged too: on this API it carries ids and filters, never personal
        # data, which travels in bodies and is never logged.
        path = request.url.path + (f"?{request.url.query}" if request.url.query else "")
        fl_logger.info(
            f"{request.method} {path} -> {status}",
            extra={
                # Explicit as well as filter-injected, so a handler without `TraceContextFilter`
                # still sees both ids on this record.
                "trace_id": trace_id,
                "span_id": span_id,
                "method": request.method,
                "path": path,
                "status": status,
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
            },
        )
