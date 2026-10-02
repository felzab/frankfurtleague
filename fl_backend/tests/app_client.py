"""
TESTS · the application under test, served in process to an HTTP client of the test's own

Entered and left inside one coroutine, so the driver's client, the request and the close share the
loop the client binds to. No lifespan: it would open a client of its own and apply the constraints.

Invariants:
- An app a caller hands in leaves as it came: no `db_client`, and the overrides it held, so the
  next case serving through it meets none of this one's.
"""

from collections.abc import AsyncIterator, Iterable
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI
from httpx2 import ASGITransport, AsyncClient  # noqa: TID251
from pymongo import AsyncMongoClient

from app.core.config import BackendConfig
from app.core.dependencies import get_germany_now
from app.main import create_app
from tests.config import TEST_BASE_URL, build_test_config
from tests.grants import admit


@asynccontextmanager
async def app_client(
    url: str,
    *,
    config: BackendConfig | None = None,
    now: datetime | None = None,
    admitting: Iterable[str] | None = None,
    app: FastAPI | None = None,
) -> AsyncIterator[AsyncClient]:
    """No `serverSelectionTimeoutMS`: inside a request the app's own deadline replaces it.

    So a server that never answers is bounded by that deadline, or by a shorter `pymongo.timeout` the caller holds around the request.
    """

    if app is not None and config is not None:
        raise ValueError("an app handed in was built with its own config, so a second one here would be ignored")
    served = app or create_app(config or build_test_config())
    # A client still bound is a case still serving, or one that never unbound: either would hand this
    # case another's client, closed or on another loop.
    if hasattr(served.state, "db_client"):
        raise RuntimeError("this app is already serving a case: hand each concurrent case an app of its own")
    overrides = dict(served.dependency_overrides)
    # For a case whose server never answers: the actor check is answered from these addresses instead.
    if admitting is not None:
        admit(served, admitting)
    served.state.db_client = AsyncMongoClient(url)
    if now is not None:
        served.dependency_overrides[get_germany_now] = lambda: now

    try:
        async with AsyncClient(transport=ASGITransport(app=served, raise_app_exceptions=False), base_url=TEST_BASE_URL) as http:
            yield http
    finally:
        await served.state.db_client.close()
        del served.state.db_client
        served.dependency_overrides.clear()
        served.dependency_overrides.update(overrides)
