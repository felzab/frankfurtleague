"""
TESTS · the application under test, served in process to an HTTP client of the test's own

Entered and left inside one coroutine, so the driver's client, the request and the close share the
loop the client binds to. No lifespan: it would open a client of its own and apply the constraints.

Invariants:
- An app a caller hands in leaves as it came: no `db_client`, and the overrides it held, so the
  next case serving through it meets none of this one's.
- A request to an operation declaring `stores_nothing` sends no write, or the call raises: the
  frontend reads the declaration as a read, which it tells a person is safe to repeat.
"""

from collections.abc import AsyncIterator, Iterable
from contextlib import AsyncExitStack, asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, Request
from httpx2 import ASGITransport, AsyncClient, Response
from pymongo import AsyncMongoClient

from app.core.config import BackendConfig
from app.core.crud import WritesSent, writes_sent_var
from app.core.dependencies import get_germany_now
from app.core.exception_handlers import stores_nothing
from app.main import create_app
from tests.config import TEST_BASE_URL, build_test_config
from tests.grants import admit


class StoresNothingHeld:
    """Each request to a `stores_nothing` operation, with the app's own record of whether it sent a write."""

    def __init__(self) -> None:
        self.served: list[tuple[str, WritesSent | None]] = []

    async def declared(self, request: Request) -> None:
        """In the declaration's place, inside the request, where the record the middleware bound for it is the one read."""

        self.served.append((f"{request.method} {request.url.path}", writes_sent_var.get()))

    async def refuse_a_write(self, _: Response) -> None:
        """At every answer, every such request so far: the record is marked as a write is sent, and stays marked.

        Judged here rather than in the app, which would answer an assertion as a 500 the case may not read.
        """

        # An unbound record is a request nothing could judge, so it fails as a write would.
        written = [operation for operation, record in self.served if record is None or record.sent]
        assert not written, f"an operation declaring `stores_nothing` sent a write, or bound no record of one: {written}"


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

    def restore_the_overrides() -> None:
        served.dependency_overrides.clear()
        served.dependency_overrides.update(overrides)

    # Every undo is on the stack before anything after its edit can raise, so the app leaves as it
    # came: an override applied ahead of a client that failed to build would otherwise meet the next case.
    async with AsyncExitStack() as undo:
        undo.callback(restore_the_overrides)
        # For a case whose server never answers: the actor check is answered from these addresses instead.
        if admitting is not None:
            admit(served, admitting)
        if now is not None:
            served.dependency_overrides[get_germany_now] = lambda: now
        held = StoresNothingHeld()
        served.dependency_overrides[stores_nothing] = held.declared
        client = AsyncMongoClient(url)
        undo.push_async_callback(client.close)
        served.state.db_client = client
        undo.callback(delattr, served.state, "db_client")

        yield await undo.enter_async_context(
            AsyncClient(
                transport=ASGITransport(app=served, raise_app_exceptions=False),
                base_url=TEST_BASE_URL,
                event_hooks={"response": [held.refuse_a_write]},
            )
        )
