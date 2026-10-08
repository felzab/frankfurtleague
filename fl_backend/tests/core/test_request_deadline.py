import ast
import asyncio
import enum
import functools
import json
import logging
import re
import time
from collections.abc import Awaitable, Callable, Mapping
from contextvars import ContextVar
from typing import Any, NamedTuple

import pytest
from bson import ObjectId
from fastapi import FastAPI, Request
from httpx2 import ASGITransport, AsyncClient, Response  # noqa: TID251
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import (
    ExecutionTimeout,
    NetworkTimeout,
    OperationFailure,
    PyMongoError,
    ServerSelectionTimeoutError,
    WaitQueueTimeoutError,
)

from app.api.bewerbungen.services import hash_token
from app.core import middlewares
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import (
    anchor_in_db,
    delete_many_from_db,
    erase_many_from_db,
    patch_many_in_db,
    patch_one_in_db,
    post_many_to_db,
    post_one_to_db,
)
from app.core.db import get_einladungen_collection
from app.core.exception_handlers import (
    DATABASE_FAILED,
    STORES_NOTHING_WHEN,
    UNHANDLED_CRASH,
    UNKNOWN_OUTCOME,
    db_exception_handler,
    stores_nothing,
)
from app.core.logging import fl_logger
from app.core.middlewares import REQUEST_DEADLINE_S
from app.core.transactions import ABORT_GRACE_S, transaction_session
from app.main import STORES_NOTHING_EXTENSION, create_app
from tests.actor_tokens import SignedActor
from tests.app_client import app_client
from tests.config import ADMIN_KEY, ADMINISTRATORS, TEST_BASE_URL, UNANSWERED_URI, build_test_config, grants_for_the_suite
from tests.core.app_source import APP_ROOT, BACKEND_ROOT, DRIVER_WRITES, api_routes, app_calls, callee, parsed
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import rules_document, saison_document, saison_team_document
from tests.openapi_document import build_document
from tests.worker import worker_database

FETCH_CEILING = re.compile(r"const BASE_FETCH_TIMEOUT_MS = (\d+);")
FRONTEND_API = BACKEND_ROOT.parent / "fl_frontend" / "src" / "core" / "api.ts"

# Short, so the default tier pays half a second where the shipped deadline would cost ten; what is
# asserted is that the route stops at whatever the deadline says.
SHORT_DEADLINE_S = 0.5

# Far under what the cases below would wait with no deadline -- the client's 30 s server selection,
# the stall's 60 s -- so an answer in time can only be the deadline's doing.
ANSWERED_WITHIN_S = SHORT_DEADLINE_S + 10

FAILED = DATABASE_FAILED

CRUD_MODULE = "app/core/crud.py"

ADMIN_HEADERS = SignedActor("admin@frankfurtleague.de", ADMIN_KEY)

DATABASE_NAME = worker_database("fl_request_deadline_test")

# A `pymongo.timeout(None)` or `(0)` anywhere else LIFTS this deadline rather than adding one, so the
# driver's deadline is spelled at the middleware and at the abort past it, which runs in a context
# the request's deadline does not reach.
DEADLINE_SPELLING = "pymongo.timeout("
DEADLINES = [
    ("app/core/middlewares.py", "with pymongo.timeout(REQUEST_DEADLINE_S):"),
    ("app/core/transactions.py", "with pymongo.timeout(budget):"),
]


class TestTheDeadlinesTheApplicationSets:
    def test_the_request_s_and_the_aborts_past_it_are_the_only_two(self):
        """`docs/backend/spec.md :: I320`. The whole list rather than a count, so finding nothing fails as a third spelling does."""

        spelled = [
            (path.relative_to(BACKEND_ROOT).as_posix(), line.strip())
            for path in sorted(APP_ROOT.rglob("*.py"))
            for line in path.read_text(encoding="utf-8").splitlines()
            if DEADLINE_SPELLING in line
        ]

        assert spelled == DEADLINES

    def test_it_is_positive_and_ends_before_the_page_stops_waiting(self):
        """The aborts' grace inside the margin the deadline leaves, since a request cut at its deadline answers only after them."""

        ceiling = FETCH_CEILING.search(FRONTEND_API.read_text(encoding="utf-8"))
        assert ceiling is not None, f"{FRONTEND_API} no longer declares `BASE_FETCH_TIMEOUT_MS` where `FETCH_CEILING` looks"

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
# wait starts (its `Server.shutdown`, read in uvicorn 0.54), so the engine's kill falls a whole second later.
UVICORN_STEPS_BEFORE_ITS_WAIT_S = 1


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
    """`docs/ops/spec.md :: I540`: three budgets nested, each inside the next, or the outer one cuts what the inner one allows."""

    def test_uvicorn_waits_out_a_request_s_whole_bound(self):
        assert _uvicorn_s_graceful_wait() >= REQUEST_DEADLINE_S + ABORT_GRACE_S

    def test_the_engine_kills_only_after_uvicorn_s_wait(self):
        assert _backend_stop_grace() >= _uvicorn_s_graceful_wait() + UVICORN_STEPS_BEFORE_ITS_WAIT_S

    def test_the_container_runs_the_cmd_the_wait_is_read_off(self):
        """Compose's `command:` replaces that CMD and its `entrypoint:` drops it; a merge key can bring in either unread."""

        assert COMMAND_OVERRIDES.findall(_backend_service()) == []


def _erasure_answered() -> tuple[Response, float]:
    """`POST /kontakte/erasure` against a server nothing answers, its first database call past the actor check inside its transaction."""

    async def _answered() -> tuple[Response, float]:
        async with app_client(UNANSWERED_URI, admitting=ADMINISTRATORS) as http:
            started = time.monotonic()
            response = await http.post(f"/api/v{API_VERSION}/kontakte/erasure", headers=ADMIN_HEADERS, json={"email": "anna.mueller@schule.de"})
            return response, time.monotonic() - started

    return asyncio.run(_answered())


def _grants_list_answered(method: str) -> tuple[Response, float]:
    """An admin-tier request against a server nothing answers, the actor check's grant read left real, and so its first."""

    async def _answered() -> tuple[Response, float]:
        async with app_client(UNANSWERED_URI) as http:
            started = time.monotonic()
            response = await http.request(method, f"/api/v{API_VERSION}/berechtigungen", headers=ADMIN_HEADERS)
            return response, time.monotonic() - started

    return asyncio.run(_answered())


class TestAnUnreachableServerIsAnsweredWithinTheDeadline:
    def test_the_route_answers_the_deadline_rather_than_retrying(self, monkeypatch: pytest.MonkeyPatch):
        """Failed rather than unknown: the erasure's transaction opens on a read, so the deadline cut it before any write was sent."""

        monkeypatch.setattr(middlewares, "REQUEST_DEADLINE_S", SHORT_DEADLINE_S)

        response, elapsed = _erasure_answered()

        assert (response.status_code, response.json()["error_code"]) == (500, FAILED)
        assert elapsed < ANSWERED_WITHIN_S

    @pytest.mark.parametrize("method", ["GET", "POST"])
    def test_the_actor_check_s_own_read_is_held_to_the_deadline(self, monkeypatch: pytest.MonkeyPatch, method: str):
        """The grant read runs as a dependency ahead of every handler, the case above answering it from a set.

        The `POST` is the load-bearing one: a grant's route, cut before its handler sent anything, has written nothing.
        """

        monkeypatch.setattr(middlewares, "REQUEST_DEADLINE_S", SHORT_DEADLINE_S)

        response, elapsed = _grants_list_answered(method)

        assert (response.status_code, response.json()["error_code"]) == (500, FAILED)
        assert elapsed < ANSWERED_WITHIN_S


class _Cut(enum.Enum):
    """Where the deadline falls on a transaction, each reaching the driver's commit or its abort."""

    NOWHERE = "nowhere"
    # The callback returns past the deadline, so the commit is what the deadline refuses.
    AT_THE_COMMIT = "at the commit"
    # The callback's own second write is refused, so the driver aborts rather than commits.
    INSIDE_THE_CALLBACK = "inside the callback"


class _Transacted(NamedTuple):
    status: int
    error_code: str | None
    standing: int
    # The server's own record of the route's session, read once the request is answered.
    transactions_held: list[Mapping[str, Any]]


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


def _transacted(url: str, cut: _Cut) -> _Transacted:
    """One transaction run by a route of the real app, so the deadline around it is the one the middleware sets."""

    async def body() -> _Transacted:
        fresh = a_clean_database(url, DATABASE_NAME, constraints=False, collections=(Collection.AKTIONEN,))
        async with fresh as (client, database):
            written = database[Collection.AKTIONEN]

            sessions: list[Mapping[str, Any]] = []

            async def write_then_wait(session: AsyncClientSession) -> None:
                sessions.append(session.session_id)
                # Through the helper every route writes through, which is what marks the request as having sent one.
                await post_one_to_db(collection=written, document={"_id": ObjectId()}, session=session)
                if cut is not _Cut.NOWHERE:
                    await asyncio.sleep(SHORT_DEADLINE_S * 2)
                if cut is _Cut.INSIDE_THE_CALLBACK:
                    await post_one_to_db(collection=written, document={"_id": ObjectId()}, session=session)

            async def transacting() -> None:
                async with transaction_session(client) as session:
                    await session.with_transaction(write_then_wait)

            served = create_app(build_test_config())
            served.add_api_route("/transacting", transacting, methods=["POST"])
            transport = ASGITransport(app=served, raise_app_exceptions=False)
            async with AsyncClient(transport=transport, base_url=TEST_BASE_URL) as http:
                response = await http.post("/transacting")

            # Read before anything else runs through `client`, whose next call would take the route's session.
            held = await _transactions_held(url, sessions)
            error_code = None if response.status_code == 200 else response.json()["error_code"]
            return _Transacted(response.status_code, error_code, await written.count_documents({}), held)

    return on_the_seed_loop(body())


@pytest.mark.db
class TestATransactionPastTheRequestDeadlineCommitsNothing:
    @pytest.mark.parametrize("cut", [_Cut.AT_THE_COMMIT, _Cut.INSIDE_THE_CALLBACK], ids=lambda cut: cut.value)
    def test_a_callback_outliving_the_deadline_leaves_no_write(self, mongo_replica_set_url: str, monkeypatch: pytest.MonkeyPatch, cut: _Cut):
        """Unknown though nothing stands: the answer errs toward unknown on a write the deadline cut, its commit sent or not."""

        monkeypatch.setattr(middlewares, "REQUEST_DEADLINE_S", SHORT_DEADLINE_S)

        transacted = _transacted(mongo_replica_set_url, cut)

        assert (transacted.status, transacted.error_code, transacted.standing) == (500, UNKNOWN_OUTCOME, 0)
        # Nothing standing is not nothing held: an open transaction keeps its write from every reader
        # and from every rival writer, until MongoDB's lifetime limit aborts it a minute on.
        assert transacted.transactions_held == []

    def test_the_same_write_inside_the_deadline_commits(self, mongo_replica_set_url: str):
        """The control, under the shipped deadline: without it, a write that never landed at all would pass the case above."""

        assert _transacted(mongo_replica_set_url, _Cut.NOWHERE) == (200, None, 1, [])


# Named in the order the send walks them, which is by name: the stall falls on the middle team, so
# one team is minted before it and one is reached only after the deadline has passed.
BEFORE_THE_STALL = ObjectId("6890a1b2c3d4e5f607320001")
STALLED = ObjectId("6890a1b2c3d4e5f607320002")
AFTER_THE_DEADLINE = ObjectId("6890a1b2c3d4e5f607320003")
TEAM_NAMES = {BEFORE_THE_STALL: "Adler", STALLED: "Bieber", AFTER_THE_DEADLINE: "Cronberg"}

SAISON_ID = "2026"

# Server-side, so the database itself stops answering and only the deadline's `maxTimeMS` stops it.
STALL = "sleep(60000) || true"

# Long enough that the team before the stall is minted inside it on a loaded machine.
SHORT_REQUEST_DEADLINE_S = 1.5

MINT_FAILED = "erzeugung_fehlgeschlagen"
MINT_OUTCOME_UNKNOWN = "erzeugung_ungewiss"


def _seeded_link(team_id: ObjectId) -> dict[str, Any]:
    """Live and never mailed, which the send replaces, revoking this one."""

    return {
        "_id": ObjectId(),
        "saison_id": SAISON_ID,
        "team_id": team_id,
        "token_hash": hash_token(f"seeded-{team_id}"),
        "erstellt_am": "2026-03-15",
        "erstellt_von": "admin@frankfurtleague.de",
        "widerrufen_am": None,
        "versand": {},
    }


def _junction_row(team_id: ObjectId) -> dict[str, Any]:
    trainer = {
        "vorname": TEAM_NAMES[team_id],
        "nachname": "Mustermann",
        "email": f"{TEAM_NAMES[team_id].lower()}@example.com",
        "telefon": "+49 69 1234567",
        "geburtsdatum": "1980-05-04",
        "einwilligung": {
            "umfang": "kontaktdaten",
            "erfasst_von": "person",
            "text_version": "v1",
            "datum": "2026-01-15",
            "bestaetigt_am": "2026-03-20",
        },
    }

    return saison_team_document(
        SAISON_ID,
        team_id,
        TEAM_NAMES[team_id],
        TEAM_NAMES[team_id][:2].upper(),
        _id=ObjectId(),
        kontakte={"trainer": trainer, "ansprechperson": None, "stellvertretung": None, "trainer_ist_zugleich": None},
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


class _MintFailsForOneTeam(_CommitOfUnknownOutcomeForOneTeam):
    """One team's mint refused outright after its link was read, which aborts the transaction and revokes nothing."""

    async def insert_one(self, document: Mapping[str, Any], **rest: Any) -> Any:
        if document.get("team_id") == STALLED:
            raise OperationFailure("refused", 2, {"ok": 0, "code": 2})

        return await self._collection.insert_one(document, **rest)


Pressed = tuple[
    int, float, dict[str, str | None], dict[ObjectId, list[ObjectId]], dict[ObjectId, ObjectId], dict[str, bool], dict[str, bool | None]
]


def _pressed(url: str, stand_in: Callable[[AsyncCollection], Any], *, seed_links: bool = True) -> Pressed:
    """One press over ASGI, the route handed `stand_in` for its `einladungen` collection.

    Answers the status, the time, each team's skip, its live links, its seeded link and whether its
    row says a link was replaced.
    """

    config = build_test_config().model_copy(update={"db_base_name": DATABASE_NAME})
    seeded = {team_id: _seeded_link(team_id) for team_id in TEAM_NAMES} if seed_links else {}

    async def body() -> Pressed:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(
                saison_document(
                    SAISON_ID,
                    "active",
                    rules=rules_document(number_of_groups=2, max_kadergroesse=50, erlaubte_stufen=["E1"]),
                    registrierung={"offen": True, "von": "2026-03-01", "bis": "2026-04-30"},
                )
            )
            await database[Collection.SAISON_TEAMS].insert_many([_junction_row(team_id) for team_id in TEAM_NAMES])
            await database[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())
            if seeded:
                await database[Collection.EINLADUNGEN].insert_many(list(seeded.values()))

            served = create_app(config)
            # The tier's shared client: closing it belongs to `tests/database.py :: _release`.
            served.state.db_client = client
            served.dependency_overrides[get_einladungen_collection] = lambda: stand_in(database[Collection.EINLADUNGEN])

            transport = ASGITransport(app=served, raise_app_exceptions=False)
            async with AsyncClient(transport=transport, base_url=TEST_BASE_URL) as http:
                started = time.monotonic()
                response = await http.post(
                    f"/api/v{API_VERSION}/saisons/{SAISON_ID}/einladungen/versand", headers=ADMIN_HEADERS, json={"erneut": False}
                )
                elapsed = time.monotonic() - started

            live = {
                team_id: [row["_id"] async for row in database[Collection.EINLADUNGEN].find({"team_id": team_id, "widerrufen_am": None})]
                for team_id in TEAM_NAMES
            }

            return (
                response.status_code,
                elapsed,
                {zeile["team_id"]: zeile["uebersprungen"] for zeile in response.json()["zeilen"]},
                live,
                {team_id: row["_id"] for team_id, row in seeded.items()},
                {zeile["team_id"]: zeile["ersetzt_link"] for zeile in response.json()["zeilen"]},
                {zeile["team_id"]: zeile["hatte_link"] for zeile in response.json()["zeilen"]},
            )

    return on_the_seed_loop(body())


@pytest.mark.db
class TestTheSendPastItsDeadline:
    def test_no_team_is_revoked_after_the_page_has_stopped_waiting(self, mongo_replica_set_url: str, monkeypatch: pytest.MonkeyPatch):
        """The press whose database stops answering mid-loop: a link revoked after the deadline is one whose replacement nobody receives."""

        monkeypatch.setattr(middlewares, "REQUEST_DEADLINE_S", SHORT_REQUEST_DEADLINE_S)

        status, elapsed, skipped, live, seeded, _, held = _pressed(mongo_replica_set_url, _StallsOneTeam)

        assert status == 200
        assert elapsed < ANSWERED_WITHIN_S
        assert skipped == {str(BEFORE_THE_STALL): None, str(STALLED): MINT_FAILED, str(AFTER_THE_DEADLINE): MINT_FAILED}
        # The stalled read never answered, so nothing says whether that team held a link.
        assert held[str(STALLED)] is None
        # The control: the team before the stall WAS reached, so the two below are the deadline's doing.
        assert len(live[BEFORE_THE_STALL]) == 1 and live[BEFORE_THE_STALL] != [seeded[BEFORE_THE_STALL]]
        assert live[STALLED] == [seeded[STALLED]]
        assert live[AFTER_THE_DEADLINE] == [seeded[AFTER_THE_DEADLINE]]

    def test_a_commit_of_unknown_outcome_is_answered_as_unknown(self, mongo_replica_set_url: str):
        """Never as failed: that row tells the admin the earlier link still opens, where the commit may have revoked it."""

        status, _, skipped, _, _, replaced, _ = _pressed(mongo_replica_set_url, _CommitOfUnknownOutcomeForOneTeam)

        assert status == 200
        assert skipped == {str(BEFORE_THE_STALL): None, str(STALLED): MINT_OUTCOME_UNKNOWN, str(AFTER_THE_DEADLINE): None}
        # The link the plan found, which the unanswered commit may have revoked: the page says so.
        assert replaced[str(STALLED)] is True

    def test_a_team_that_held_no_link_is_not_told_of_one(self, mongo_replica_set_url: str):
        """The other half of the pair above: the row reads about a previous link only where the plan found one."""

        status, _, skipped, _, _, replaced, _ = _pressed(mongo_replica_set_url, _CommitOfUnknownOutcomeForOneTeam, seed_links=False)

        assert (status, skipped[str(STALLED)]) == (200, MINT_OUTCOME_UNKNOWN)
        assert replaced[str(STALLED)] is False

    @pytest.mark.parametrize("seed_links", [True, False], ids=["a team holding a link", "a team holding none"])
    def test_a_failed_row_says_whether_the_team_holds_a_link_still(self, mongo_replica_set_url: str, seed_links: bool):
        """The page tells the admin the earlier link still opens only where there is one: a failure revokes nothing."""

        status, _, skipped, live, seeded, replaced, held = _pressed(mongo_replica_set_url, _MintFailsForOneTeam, seed_links=seed_links)

        assert (status, skipped[str(STALLED)], replaced[str(STALLED)]) == (200, MINT_FAILED, False)
        assert held[str(STALLED)] is seed_links
        assert live[STALLED] == ([seeded[STALLED]] if seed_links else [])


# Every error class the driver raises for a deadline, each in the shape its raising site builds.
DEADLINE_ERRORS = [
    pytest.param(ExecutionTimeout("operation would exceed time limit", 50, {"ok": 0, "code": 50}), id="ExecutionTimeout"),
    pytest.param(NetworkTimeout("timed out"), id="NetworkTimeout"),
    pytest.param(ServerSelectionTimeoutError("No servers found yet"), id="ServerSelectionTimeoutError"),
    pytest.param(WaitQueueTimeoutError("Timed out while checking out a connection"), id="WaitQueueTimeoutError"),
]


# What the one route `_served` adds runs, set by the request's own task, which the app's handlers inherit.
_FAULT: ContextVar[Callable[[], Awaitable[None]]] = ContextVar("fault")


@functools.cache
def _served() -> FastAPI:
    """One app for every case driving a fault through it, an app per case costing most of this file's run.

    Built on first use rather than at import, which every xdist worker pays at collection.
    """

    served = create_app(build_test_config())

    async def faulting() -> None:
        await _FAULT.get()()

    served.add_api_route("/faulting", faulting, methods=["GET", "POST", "PATCH", "DELETE"])

    return served


def _faulted_through_the_app(fault: Callable[[], Awaitable[None]], method: str) -> Response:
    async def _answered() -> Response:
        _FAULT.set(fault)
        transport = ASGITransport(app=_served(), raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url=TEST_BASE_URL) as http:
            return await http.request(method, "/faulting")

    return asyncio.run(_answered())


def _raised_through_the_app(error: Exception, method: str = "GET") -> Response:
    """The error raised from a route of the real app, so the handler Starlette picks is the one resolved from the class's own MRO."""

    async def raising() -> None:
        raise error

    return _faulted_through_the_app(raising, method)


def _handled_directly(caplog: pytest.LogCaptureFixture, error: PyMongoError) -> None:
    """The handler alone: building an app reconfigures logging and takes the capture's handler off the root."""

    with caplog.at_level(logging.ERROR, logger=fl_logger.name):
        asyncio.run(db_exception_handler(Request({"type": "http", "method": "GET", "headers": []}), error))


class TestADeadlineCuttingARequestThatStoresNothingIsAFailure:
    @pytest.mark.parametrize("error", DEADLINE_ERRORS)
    def test_a_read_answers_the_database_failure(self, error: PyMongoError):
        assert error.timeout
        response = _raised_through_the_app(error)

        assert (response.status_code, response.json()["error_code"]) == (500, FAILED)

    def test_an_error_from_outside_the_driver_stays_the_server_failure(self):
        """The control: without it, a handler answering every error `DB-FAIL-001` would pass the cases above."""

        response = _raised_through_the_app(ValueError("not a database failure"))

        assert (response.status_code, response.json()["error_code"]) == (500, UNHANDLED_CRASH)

    @pytest.mark.parametrize("method", ["POST", "PATCH", "DELETE"])
    @pytest.mark.parametrize("error", DEADLINE_ERRORS)
    def test_a_write_method_that_sent_nothing_is_a_failure_too(self, error: PyMongoError, method: str):
        """The method is not the judgement: a write route cut before its first write, in its actor check say, stored nothing."""

        response = _raised_through_the_app(error, method)

        assert (response.status_code, response.json()["error_code"]) == (500, FAILED)

    def test_the_line_names_the_deadline_rather_than_a_crash(self, caplog: pytest.LogCaptureFixture):
        _handled_directly(caplog, NetworkTimeout("timed out"))

        assert [record.getMessage().split(" (")[0] for record in caplog.records if getattr(record, "error_code", None)] == [
            "Database deadline passed"
        ]


def _declared() -> dict[str, bool | str]:
    """What each route declares, read off its dependencies rather than off the document it is compared to."""

    declared: dict[str, bool | str] = {}
    for route in api_routes(create_app(build_test_config())):
        calls = {guard.call for guard in route.dependant.dependencies if guard.call is not None}
        flags = [STORES_NOTHING_WHEN[call] for call in calls if call in STORES_NOTHING_WHEN]
        for method in route.methods or ():
            if stores_nothing in calls or flags:
                declared[f"{method} {route.path_format}"] = True if stores_nothing in calls else flags[0]
    return declared


def _published() -> dict[str, dict[str, Any]]:
    return {
        f"{method.upper()} {path}": operation
        for path, operations in build_document()["paths"].items()
        for method, operation in operations.items()
    }


class TestTheDeclarationIsPublished:
    """`docs/backend/spec.md :: I327`: the frontend marks its calls against the document, never against a copy."""

    def test_every_declaration_reaches_the_document_and_nothing_else_does(self):
        published = {
            name: operation[STORES_NOTHING_EXTENSION] for name, operation in _published().items() if STORES_NOTHING_EXTENSION in operation
        }

        assert published == _declared()
        # Both kinds, so the equality cannot hold over two empty listings or over one kind alone.
        assert True in published.values() and any(isinstance(value, str) for value in published.values())

    def test_a_conditional_declaration_names_a_boolean_query_flag_the_operation_takes(self):
        operations = _published()
        conditional = {name: value for name, value in _declared().items() if isinstance(value, str)}

        assert conditional
        for name, flag in conditional.items():
            assert [
                (parameter["in"], parameter["schema"]["type"]) for parameter in operations[name]["parameters"] if parameter["name"] == flag
            ] == [("query", "boolean")], name


# The shape `with_transaction` hands on when a commit went out and no answer came back within the deadline.
UNKNOWN_COMMIT_OUTCOME = ExecutionTimeout("timed out", 50, {"ok": 0, "code": 50, "errorLabels": ["UnknownTransactionCommitResult"]})


class TestACommitOfUnknownOutcomeIsNotCalledFailed:
    def test_it_answers_its_own_code(self):
        response = _raised_through_the_app(UNKNOWN_COMMIT_OUTCOME)

        assert (response.status_code, response.json()["error_code"]) == (500, UNKNOWN_OUTCOME)

    def test_its_line_carries_the_same_code(self, caplog: pytest.LogCaptureFixture):
        _handled_directly(caplog, UNKNOWN_COMMIT_OUTCOME)

        assert [getattr(record, "error_code", None) for record in caplog.records if getattr(record, "error_code", None)] == [UNKNOWN_OUTCOME]


class _NoDocuments:
    async def to_list(self, length: int | None = None) -> list[Any]:
        return []


class _EveryWriteRaises:
    """A collection whose every driver write raises `error` once handed to it; its one read, a removal's image, finds nothing."""

    name = Collection.TEAMS

    def __init__(self, error: Exception) -> None:
        self._error = error

    def find(self, *args: Any, **kwargs: Any) -> _NoDocuments:
        return _NoDocuments()

    def __getattr__(self, name: str) -> Any:
        if name not in DRIVER_WRITES:
            raise AttributeError(name)

        async def raising(*args: Any, **kwargs: Any) -> Any:
            raise self._error

        return raising


# Required by the removal helpers' signatures and read by nothing the collection above answers.
NO_SESSION: Any = None

# One call per `app/core/crud.py` helper reaching the driver's writes, each as a route makes it.
WRITE_CALLS: dict[str, Callable[[Any], Awaitable[Any]]] = {
    "anchor_in_db": lambda collection: anchor_in_db(collection=collection, db_filter={"_id": 1}, session=NO_SESSION),
    "patch_one_in_db": lambda collection: patch_one_in_db(
        collection=collection, db_filter={"_id": 1}, update={"$set": {"name": "Adler"}}, return_document=ReturnDocument.BEFORE
    ),
    "patch_many_in_db": lambda collection: patch_many_in_db(collection=collection, db_filter={"_id": 1}, update={"$set": {"name": "Adler"}}),
    "post_one_to_db": lambda collection: post_one_to_db(collection=collection, document={"name": "Adler"}),
    "post_many_to_db": lambda collection: post_many_to_db(collection=collection, documents=[{"name": "Adler"}]),
    "delete_many_from_db": lambda collection: delete_many_from_db(collection=collection, db_filter={"_id": 1}, session=NO_SESSION),
    "erase_many_from_db": lambda collection: erase_many_from_db(collection=collection, db_filter={"_id": 1}, session=NO_SESSION),
}


def _crud_functions_reaching_a_driver_write() -> set[str]:
    """Read off `app/core/crud.py` itself, so a helper added there is driven below or fails the listing's comparison."""

    return {
        node.name
        for node in parsed(BACKEND_ROOT / CRUD_MODULE).body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        if any(isinstance(call, ast.Call) and callee(call) in DRIVER_WRITES for call in ast.walk(node))
    }


def _written_through_the_app(helper: str, error: Exception, method: str = "POST") -> Response:
    """A route of the real app handing one helper a collection whose write raises `error`, as a write the deadline cut does."""

    async def writing() -> None:
        await WRITE_CALLS[helper](_EveryWriteRaises(error))

    return _faulted_through_the_app(writing, method)


class TestAWriteTheDeadlineCutIsNotCalledFailed:
    @pytest.mark.parametrize("helper", sorted(WRITE_CALLS))
    @pytest.mark.parametrize("error", DEADLINE_ERRORS)
    def test_its_outcome_is_unknown(self, error: PyMongoError, helper: str):
        """A write outside a transaction carries no label, and may have landed before its answer was lost."""

        response = _written_through_the_app(helper, error)

        assert (response.status_code, response.json()["error_code"]) == (500, UNKNOWN_OUTCOME)

    def test_every_helper_reaching_the_driver_s_writes_is_driven(self):
        assert _crud_functions_reaching_a_driver_write() == set(WRITE_CALLS)

    def test_no_write_reaches_the_driver_past_those_helpers(self):
        """A write sent past them is cut unmarked and called failed.

        Excused: the log's row, which follows a helper's write, and a day count, which precedes the
        write it counts, so a cut one leaves nothing standing.
        """

        outside = {f"{module} :: {scope}" for module, scope, call in app_calls() if callee(call) in DRIVER_WRITES}

        assert {site for site in outside if not site.startswith(f"{CRUD_MODULE} :: ")} == {
            "app/core/recording.py :: record_write",
            "app/core/drosselung.py :: drosseln",
        }

    def test_the_method_does_not_decide_it(self):
        """A `GET` that sent a write may have left it standing as surely as a `POST` does."""

        response = _written_through_the_app("patch_many_in_db", NetworkTimeout("timed out"), "GET")

        assert (response.status_code, response.json()["error_code"]) == (500, UNKNOWN_OUTCOME)

    def test_a_write_failing_without_the_deadline_stays_failed(self):
        """The control: without it, a handler answering every sent write's database error unknown would pass the cases above."""

        response = _written_through_the_app("post_one_to_db", OperationFailure("refused", 2, {"ok": 0, "code": 2}))

        assert (response.status_code, response.json()["error_code"]) == (500, FAILED)
