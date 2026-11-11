import asyncio
import enum
import functools
import json
import logging
import re
import time
from collections.abc import Awaitable, Callable, Mapping
from contextvars import ContextVar
from pathlib import Path
from typing import Any, NamedTuple

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import ASGITransport, AsyncClient, Response
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import ExecutionTimeout

from app.core import middlewares
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import post_one_to_db
from app.core.db import CLOSE_TIMEOUT_S, collection_dependency
from app.core.logging import fl_logger
from app.core.middlewares import REQUEST_DEADLINE_S
from app.core.transactions import ABORT_GRACE_S, transaction_session
from app.main import create_app
from app.shared.tokens import hash_token
from tests.config import ADMIN_KEY, TEST_BASE_URL, build_test_config, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import kontaktperson_document, rules_document, saison_document, saison_team_document
from tests.session_headers import StampedHeaders
from tests.worker import worker_database

BACKEND_ROOT = Path(__file__).resolve().parents[2]

FETCH_CEILING = re.compile(r"const FETCH_TIMEOUT_MS = (\d+);")
FRONTEND_API = BACKEND_ROOT.parent / "fl_frontend" / "src" / "core" / "api.ts"

# For a case whose route must work inside the deadline before its cut: the first request into an app
# builds every router branch ahead of its route inside that deadline, a quarter second on a developer's
# machine and more on CI's runner, where half a second leaves a transaction's first write no time. Long
# enough that the work lands inside it on a loaded machine: the team before the stall minted, a
# transaction's first write returned.
SHORT_REQUEST_DEADLINE_S = 1.5

# Far under the stall's 60 s, what the case below would wait with no deadline, so an answer in time can
# only be the deadline's doing.
ANSWERED_WITHIN_S = SHORT_REQUEST_DEADLINE_S + 10

ADMIN_HEADERS = StampedHeaders("admin@frankfurtleague.de", ADMIN_KEY)

DATABASE_NAME = worker_database("fl_request_deadline_test")


class TestTheDeadlinesTheApplicationSets:
    def test_it_is_positive_and_ends_before_the_page_stops_waiting(self):
        """The aborts' grace inside the margin the deadline leaves, since a request cut at its deadline answers only after its aborts.

        Those run one grace between them, as `app/core/middlewares.py :: RequestDeadline` counts it.
        """

        ceiling = FETCH_CEILING.search(FRONTEND_API.read_text(encoding="utf-8"))
        assert ceiling is not None, f"{FRONTEND_API} no longer declares `FETCH_TIMEOUT_MS` where `FETCH_CEILING` looks"

        # Positive, because pymongo reads a zero deadline as none at all.
        assert 0 < REQUEST_DEADLINE_S < int(ceiling[1]) / 1000
        assert 0 < ABORT_GRACE_S < int(ceiling[1]) / 1000 - REQUEST_DEADLINE_S


DOCKERFILE = BACKEND_ROOT / "Dockerfile"
COMPOSE_FILE = BACKEND_ROOT.parent / "docker-compose.yml"
GRACEFUL_WAIT = "--timeout-graceful-shutdown"
STOP_GRACE = re.compile(r"^    stop_grace_period: (\d+)s$", re.MULTILINE)
SERVICE = re.compile(r"^  (\w+):$", re.MULTILINE)
COMMAND_OVERRIDES = re.compile(r"""^    ["']?(command|entrypoint|<<)["']?\s*:""", re.MULTILINE)

# uvicorn notices the signal on a 0.1 s tick and pauses 0.1 s after closing its connections before its
# wait starts (its `Server.shutdown`, read in uvicorn 0.54).
UVICORN_STEPS_BEFORE_ITS_WAIT_S = 0.2


def _uvicorn_s_graceful_wait() -> int:
    command = [line for line in DOCKERFILE.read_text(encoding="utf-8").splitlines() if line.startswith("CMD [")]
    assert len(command) == 1, f"{DOCKERFILE} holds {len(command)} exec-form CMD lines, where this reads exactly one"
    arguments = json.loads(command[0].removeprefix("CMD "))
    assert GRACEFUL_WAIT in arguments, f"the backend's CMD sets no {GRACEFUL_WAIT}, so uvicorn waits on a stopping request without limit"

    return int(arguments[arguments.index(GRACEFUL_WAIT) + 1])


def _backend_service() -> str:
    text = COMPOSE_FILE.read_text(encoding="utf-8")
    starts = [(match.group(1), match.start()) for match in SERVICE.finditer(text)]
    blocks = {name: text[start:next_start] for (name, start), (_, next_start) in zip(starts, [*starts[1:], ("", len(text))], strict=True)}
    assert "backend" in blocks, f"{COMPOSE_FILE} declares no `backend` service where this reader looks"

    return blocks["backend"]


def _backend_stop_grace() -> int:
    grace = STOP_GRACE.findall(_backend_service())
    assert len(grace) == 1, f"the backend service in {COMPOSE_FILE} sets {len(grace)} whole-second stop_grace_period lines, not one"

    return int(grace[0])


class TestAStoppedContainerOutlastsEveryRequest:
    """Four budgets nested, each inside the next, or the outer one cuts what the inner one allows."""

    def test_uvicorn_waits_out_a_request_s_whole_bound(self):
        """A request cut at its deadline: the deadline, then the one grace its aborts share."""

        assert _uvicorn_s_graceful_wait() >= REQUEST_DEADLINE_S + ABORT_GRACE_S

    def test_the_engine_kills_only_after_uvicorn_s_wait_and_the_client_s_close(self):
        """The lifespan closes the client once uvicorn's wait ends, and the process exits in what the close leaves: hence strictly."""

        assert _backend_stop_grace() > _uvicorn_s_graceful_wait() + UVICORN_STEPS_BEFORE_ITS_WAIT_S + CLOSE_TIMEOUT_S

    def test_the_container_runs_the_cmd_the_wait_is_read_off(self):
        """Compose's `command:` replaces that CMD and its `entrypoint:` drops it; a merge key can bring in either unread."""

        assert COMMAND_OVERRIDES.findall(_backend_service()) == []


class _Cut(enum.Enum):
    """Where the deadline falls on a transaction, each reaching the driver's commit or its abort."""

    # The callback returns past the deadline, so the commit is what the deadline refuses.
    AT_THE_COMMIT = "at the commit"
    # The callback's own second write is refused, so the driver aborts rather than commits.
    INSIDE_THE_CALLBACK = "inside the callback"
    # The same, the second write reached only once the deadline and a whole grace after it have passed:
    # where a slow start before the route puts the case above.
    PAST_THE_GRACE = "past the grace"


# Over the event loop's timer resolution, about 16 ms on Windows, by which a sleep may end early.
PAST_BY_S = 0.1


def _until_past_the_deadline(and_s: float) -> float:
    """The wait, read off the request's own deadline, after which `and_s` more have passed it.

    Never a wait counted from the callback's start, which falls wherever the route's start does.
    """

    deadline = middlewares.request_deadline_var.get()
    assert deadline is not None, "the callback runs outside a request, so no deadline cuts it"

    return deadline.at + and_s + PAST_BY_S - time.monotonic()


class _Transacted(NamedTuple):
    status: int
    error_code: str | None
    standing: int
    # The server's own record of the route's session, read once the request is answered.
    transactions_held: list[Mapping[str, Any]]
    # Whether the callback's first write returned: a route starting late enough has that write cut instead, which
    # answers as every cut does and reaches none of the cuts a case is named for.
    first_write_returned: bool


async def _transactions_held(url: str, session_ids: list[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """Through a client of its own: the route's would hand this read the session it asks about, then listed as this read rather than idle."""

    async with AsyncMongoClient(url) as probe:
        listed = await probe.admin.aggregate(
            [
                {"$currentOp": {"allUsers": True, "idleSessions": True}},
                {"$match": {"lsid.id": {"$in": [session_id["id"] for session_id in session_ids]}, "transaction": {"$exists": True}}},
                {"$project": {"type": 1, "transaction.parameters": 1}},
            ]
        )
        return await listed.to_list()


# What the one route `_served` adds runs, set by the request's own task, which the app's handlers inherit.
_FAULT: ContextVar[Callable[[], Awaitable[None]]] = ContextVar("fault")


@functools.cache
def _served() -> FastAPI:
    """One app for every case driving a fault or a transaction through it, an app per case costing most of this file's run.

    Built on first use rather than at import, which every xdist worker pays at collection. Its route stands after every
    router, so the first request into it builds them all, inside that case's deadline.
    """

    served = create_app(build_test_config())

    async def faulting() -> None:
        await _FAULT.get()()

    served.add_api_route("/faulting", faulting, methods=["GET", "POST"])

    return served


def _transacted(url: str, cut: _Cut) -> _Transacted:
    """One transaction run by a route of the real app, so the deadline around it is the one the middleware sets."""

    async def body() -> _Transacted:
        fresh = a_clean_database(url, DATABASE_NAME, constraints=False)
        async with fresh as (client, database):
            written = database[Collection.ACTION_LOG]

            sessions: list[Mapping[str, Any]] = []
            first_writes: list[Mapping[str, Any]] = []

            async def write_then_wait(session: AsyncClientSession) -> None:
                sessions.append(session.session_id)
                await post_one_to_db(collection=written, document={"_id": ObjectId()}, session=session)
                first_writes.append(session.session_id)
                if cut is _Cut.PAST_THE_GRACE:
                    await asyncio.sleep(_until_past_the_deadline(ABORT_GRACE_S))
                else:
                    await asyncio.sleep(_until_past_the_deadline(0))
                if cut in {_Cut.INSIDE_THE_CALLBACK, _Cut.PAST_THE_GRACE}:
                    await post_one_to_db(collection=written, document={"_id": ObjectId()}, session=session)

            async def transacting() -> None:
                async with transaction_session(client) as session:
                    await session.with_transaction(write_then_wait)

            _FAULT.set(transacting)
            transport = ASGITransport(app=_served(), raise_app_exceptions=False)
            async with AsyncClient(transport=transport, base_url=TEST_BASE_URL) as http:
                response = await http.post("/faulting")

            # Read before anything else runs through `client`, whose next call would take the route's session.
            held = await _transactions_held(url, sessions)
            error_code = None if response.status_code == 200 else response.json()["error_code"]
            return _Transacted(response.status_code, error_code, await written.count_documents({}), held, bool(first_writes))

    return on_the_seed_loop(body())


@pytest.mark.db
class TestATransactionPastTheRequestDeadlineCommitsNothing:
    @pytest.mark.parametrize("cut", [_Cut.AT_THE_COMMIT, _Cut.INSIDE_THE_CALLBACK, _Cut.PAST_THE_GRACE], ids=lambda cut: cut.value)
    def test_a_callback_outliving_the_deadline_leaves_no_write(self, mongo_replica_set_url: str, monkeypatch: pytest.MonkeyPatch, cut: _Cut):
        """Unknown though nothing stands: the answer errs toward unknown on a write the deadline cut, its commit sent or not."""

        monkeypatch.setattr(middlewares, "REQUEST_DEADLINE_S", SHORT_REQUEST_DEADLINE_S)

        transacted = _transacted(mongo_replica_set_url, cut)

        # First, so a start slow enough that the deadline cut the first write reads red rather than passing on its answer.
        assert transacted.first_write_returned, "the deadline cut the first write, so the case reached none of its cuts"
        assert (transacted.status, transacted.error_code, transacted.standing) == (500, Code.UNKNOWN_OUTCOME, 0)
        # Nothing standing is not nothing held: an open transaction keeps its write from every reader
        # and from every rival writer, until MongoDB's lifetime limit aborts it a minute on.
        assert transacted.transactions_held == []


# Named in the order the send walks them, which is by name: the stall falls on the middle team, so
# one team is minted before it and one is reached only after the deadline has passed.
BEFORE_THE_STALL = ObjectId("6890a1b2c3d4e5f607320001")
STALLED = ObjectId("6890a1b2c3d4e5f607320002")
AFTER_THE_DEADLINE = ObjectId("6890a1b2c3d4e5f607320003")
TEAM_NAMES = {BEFORE_THE_STALL: "Adler", STALLED: "Bieber", AFTER_THE_DEADLINE: "Cronberg"}

SAISON_ID = "2026"

# Server-side, so the database itself stops answering and only the deadline's `maxTimeMS` stops it.
STALL = "sleep(60000) || true"


def _seeded_link(team_id: ObjectId) -> dict[str, Any]:
    """Live and never mailed, which the send replaces, revoking this one."""

    return {
        "_id": ObjectId(),
        "saison_id": SAISON_ID,
        "team_id": team_id,
        "token_hashes": [hash_token(f"seeded-{team_id}")],
        "revoked_at": None,
        "sent_at": None,
    }


def _junction_row(team_id: ObjectId) -> dict[str, Any]:
    trainer = kontaktperson_document(TEAM_NAMES[team_id], confirmed_at="2026-03-20", last_name="Mustermann", phone="+49 69 1234567")

    return saison_team_document(
        SAISON_ID,
        team_id,
        TEAM_NAMES[team_id],
        TEAM_NAMES[team_id][:3].upper(),
        _id=ObjectId(),
        kontakte={"trainer": trainer, "ansprechperson": None, "stellvertretung": None, "trainer_is_also": None},
    )


class _StallsOneTeam:
    """The real collection, with one team's read made to sleep on the server; handed to the dependency the route declares."""

    def __init__(self, collection: AsyncCollection) -> None:
        self._collection = collection

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    def find(self, filter: Mapping[str, Any], *args: Any, **kwargs: Any) -> Any:
        if filter.get("team_id") == STALLED:
            filter = {**filter, "$where": STALL}

        return self._collection.find(filter, *args, **kwargs)


# The shape `with_transaction` hands on when a commit went out and no answer came back within the deadline.
UNKNOWN_COMMIT_OUTCOME = ExecutionTimeout("timed out", 50, {"ok": 0, "code": 50, "errorLabels": ["UnknownTransactionCommitResult"]})


class _CommitOfUnknownOutcomeForOneTeam:
    """The real collection, with one team's mint raising what `with_transaction` raises for a commit sent and never answered."""

    def __init__(self, collection: AsyncCollection) -> None:
        self._collection = collection

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def insert_one(self, document: Mapping[str, Any], **rest: Any) -> Any:
        if document.get("team_id") == STALLED:
            raise UNKNOWN_COMMIT_OUTCOME

        return await self._collection.insert_one(document, **rest)


Pressed = tuple[int, float, tuple[int, int, int], dict[ObjectId, list[ObjectId]], dict[ObjectId, ObjectId]]


DISPATCH_PATH = f"/api/v{API_VERSION}/saisons/{SAISON_ID}/invitations/dispatch"


@pytest.fixture(scope="module")
def pressing_app() -> FastAPI:
    """One app for every press.

    The first request into a router branch builds it, and an app per press would pay that build inside every case. The
    case that reaches the branch first pays it once, inside its deadline.
    """

    return create_app(build_test_config().model_copy(update={"db_base_name": DATABASE_NAME}))


def _pressed(served: FastAPI, url: str, stand_in: Callable[[AsyncCollection], Any]) -> Pressed:
    """One press over ASGI, the route handed `stand_in` for its `invitations` collection.

    Answers the status, the time, the press's three counts, each team's live links and its seeded link.
    """

    seeded = {team_id: _seeded_link(team_id) for team_id in TEAM_NAMES}

    async def body() -> Pressed:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(
                saison_document(
                    SAISON_ID,
                    "active",
                    rules=rules_document(number_of_gruppen=2, max_kader_size=50, allowed_stufen=["E1"]),
                    registrierung={"open": True, "end": "2026-04-30"},
                )
            )
            await database[Collection.SAISON_TEAMS].insert_many([_junction_row(team_id) for team_id in TEAM_NAMES])
            await database[Collection.GRANTS].insert_many(grants_for_the_suite())
            await database[Collection.INVITATIONS].insert_many(list(seeded.values()))

            # The tier's shared client: closing it belongs to `tests/database.py :: _release`.
            served.state.db_client = client
            invitations = collection_dependency(Collection.INVITATIONS)
            served.dependency_overrides[invitations] = lambda: stand_in(database[Collection.INVITATIONS])

            try:
                transport = ASGITransport(app=served, raise_app_exceptions=False)
                async with AsyncClient(transport=transport, base_url=TEST_BASE_URL) as http:
                    started = time.monotonic()
                    response = await http.post(DISPATCH_PATH, headers=ADMIN_HEADERS)
                    elapsed = time.monotonic() - started
            finally:
                # The app outlives the case, so the stand-in goes with it.
                del served.dependency_overrides[invitations]

            answer = response.json()
            live = {
                team_id: [row["_id"] async for row in database[Collection.INVITATIONS].find({"team_id": team_id, "revoked_at": None})]
                for team_id in TEAM_NAMES
            }

            return (
                response.status_code,
                elapsed,
                (answer["mailed"], answer["skipped"], answer["failed"]),
                live,
                {team_id: row["_id"] for team_id, row in seeded.items()},
            )

    return on_the_seed_loop(body())


@pytest.mark.db
class TestTheSendPastItsDeadline:
    def test_no_team_is_revoked_after_the_page_has_stopped_waiting(
        self, pressing_app: FastAPI, mongo_replica_set_url: str, monkeypatch: pytest.MonkeyPatch
    ):
        """The press whose database stops answering mid-loop: a link revoked after the deadline is one whose replacement nobody receives."""

        monkeypatch.setattr(middlewares, "REQUEST_DEADLINE_S", SHORT_REQUEST_DEADLINE_S)

        status, elapsed, counts, live, seeded = _pressed(pressing_app, mongo_replica_set_url, _StallsOneTeam)

        assert status == 200
        assert elapsed < ANSWERED_WITHIN_S
        assert counts == (1, 0, 2)
        # The control: the team before the stall WAS reached, so the two below are the deadline's doing.
        assert len(live[BEFORE_THE_STALL]) == 1 and live[BEFORE_THE_STALL] != [seeded[BEFORE_THE_STALL]]
        assert live[STALLED] == [seeded[STALLED]]
        assert live[AFTER_THE_DEADLINE] == [seeded[AFTER_THE_DEADLINE]]

    def test_a_commit_of_unknown_outcome_is_logged_as_unknown(
        self, pressing_app: FastAPI, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """Never as failed: that line tells the operator the earlier link still opens, where the commit may have revoked it."""

        with caplog.at_level(logging.ERROR, logger=fl_logger.name):
            status, _, counts, _, _ = _pressed(pressing_app, mongo_replica_set_url, _CommitOfUnknownOutcomeForOneTeam)

        assert status == 200
        assert counts == (2, 0, 1)
        assert [getattr(record, "error_code", None) for record in caplog.records if record.message == "saisons.invitation_unminted"] == [
            Code.UNKNOWN_OUTCOME
        ]


def _raised_through_the_app(error: Exception) -> Response:
    """The error raised from a safe route of the real app, so the handler Starlette picks is the one resolved from the class's own MRO."""

    async def raising() -> None:
        raise error

    async def _answered() -> Response:
        _FAULT.set(raising)
        transport = ASGITransport(app=_served(), raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url=TEST_BASE_URL) as http:
            return await http.get("/faulting")

    return asyncio.run(_answered())


class TestACommitOfUnknownOutcomeIsNotCalledFailed:
    def test_it_answers_its_own_code(self):
        """Over a safe method, so the label alone can answer: a commit lost to anything but a timeout carries nothing else saying so."""

        response = _raised_through_the_app(UNKNOWN_COMMIT_OUTCOME)

        assert (response.status_code, response.json()["error_code"]) == (500, Code.UNKNOWN_OUTCOME)
