import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.logging import trace_id_var


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """
    Injects a Trace ID into every request context for distributed logging.
    """

    async def dispatch(self, request: Request, call_next):
        # 1. Extract from Next.js, or generate a fresh one
        trace_id = request.headers.get("X-Correlation-ID", str(uuid.uuid4())[:8])

        # 2. Bind it to the current async context
        token = trace_id_var.set(trace_id)

        try:
            # 3. Process the request
            response = await call_next(request)

            # 4. Return the Trace ID to Next.js in the response headers
            response.headers["X-Correlation-ID"] = trace_id
            return response
        finally:
            # 5. CRITICAL: Clean up the context var to prevent memory leaks
            trace_id_var.reset(token)
