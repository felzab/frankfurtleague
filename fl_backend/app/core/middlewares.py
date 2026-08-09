"""
CORE · request middleware

The correlation-id and access-log middleware registered by `app/main.py`.

Invariants:
- `X-Correlation-ID` is honoured only when well-formed — a malformed one is attacker-chosen log text.
- Every request gets exactly one access line, with the correlation id on it; uvicorn's own is off.
"""

import re
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.logging import correlation_id_var, fl_logger

# 32 lowercase hex is what nginx's $request_id and the frontend's minter produce; the bounds leave
# room for other well-formed hex ids without admitting arbitrary strings into the logs.
WELL_FORMED_ID = re.compile(r"[a-f0-9]{8,64}\Z")


def resolve_correlation_id(header_value: str | None) -> str:
    """The incoming id when it is well-formed hex, a freshly minted one otherwise."""
    if header_value is not None and WELL_FORMED_ID.fullmatch(header_value):
        return header_value
    return uuid.uuid4().hex


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """Binds a correlation id to every request context and writes the per-request access line."""

    async def dispatch(self, request: Request, call_next):
        correlation_id = resolve_correlation_id(request.headers.get("X-Correlation-ID"))

        # Bind it to the current async context
        token = correlation_id_var.set(correlation_id)
        started = time.perf_counter()

        try:
            response = await call_next(request)

            # Return the id to the caller in the response headers
            response.headers["X-Correlation-ID"] = correlation_id
            self._log_access(request, response.status_code, started, correlation_id)
            return response
        except Exception:
            # Reached only when no exception handler produced a response (the catch-all in
            # exception_handlers.py normally does). The request still gets its access line.
            self._log_access(request, 500, started, correlation_id)
            raise
        finally:
            # CRITICAL: Clean up the context var to prevent memory leaks
            correlation_id_var.reset(token)

    @staticmethod
    def _log_access(request: Request, status: int, started: float, correlation_id: str) -> None:
        # The query string is logged as well as the path: on this API it carries ids and filters,
        # never personal data -- payloads (which do) are bodies, and bodies are never logged.
        path = request.url.path + (f"?{request.url.query}" if request.url.query else "")
        fl_logger.info(
            f"{request.method} {path} -> {status}",
            extra={
                # Explicit as well as filter-injected: a handler without CorrelationIdFilter (a
                # test's capture handler, say) still sees the id on this record.
                "correlation_id": correlation_id,
                "method": request.method,
                "path": path,
                "status": status,
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
            },
        )
