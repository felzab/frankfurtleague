"""
TESTS · the application under test, served in process to an HTTP client of the test's own

Entered and left inside one coroutine, so the driver's client, the request and the close share the
loop the client binds to. No lifespan: it would open a client of its own and apply the constraints.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime

from httpx2 import ASGITransport, AsyncClient
from pymongo import AsyncMongoClient

from app.core.config import BackendConfig
from app.core.dependencies import get_germany_now
from app.main import create_app
from tests.config import TEST_BASE_URL, build_test_config


@asynccontextmanager
async def app_client(url: str, *, config: BackendConfig | None = None, now: datetime | None = None) -> AsyncIterator[AsyncClient]:
    """No `serverSelectionTimeoutMS`: inside a request the app's own deadline replaces it.

    So a server that never answers is bounded by the caller's `pymongo.timeout` alone.
    """

    app = create_app(config or build_test_config())
    app.state.db_client = AsyncMongoClient(url)
    if now is not None:
        app.dependency_overrides[get_germany_now] = lambda: now

    try:
        async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url=TEST_BASE_URL) as http:
            yield http
    finally:
        await app.state.db_client.close()
