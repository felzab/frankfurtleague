import ast
import asyncio
import contextlib
import dataclasses
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import Any, cast, get_args, get_type_hints

import anyio
import pytest
from bson import ObjectId
from fastapi import FastAPI
from pymongo import AsyncMongoClient, monitoring
from pymongo.asynchronous.client_session import AsyncClientSession
from starlette.requests import Request
from starlette.types import Message, Scope

from app.core import security
from app.core.collections import Collection
from app.core.exception_handlers import DATABASE_FAILED
from app.core.logging import fl_logger
from app.core.middlewares import request_deadline_var
from app.core.recording import PUBLIC_ACTOR, SYSTEM_ACTOR, Actor, PersonActor, actor_var
from app.core.security import admin_judge, bind_actor, person_judge
from app.core.transactions import ABORT_GRACE_S, UNJUDGED_KINDS, actor_judge_var, drain, transaction_session
from app.main import create_app
from tests.actor_tokens import verified_actor
from tests.config import TEST_BASE_URL, UNANSWERED_URI, build_test_config, grants_for_the_suite
from tests.core.app_source import APP_ROOT, BACKEND_ROOT, app_calls, callee, parsed
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

PAGE = 3

TRANSACTION_SESSION = "transaction_session"


class _Session:
    # No transaction number, as on a session no transaction reached a server through: a failure inside
    # it is sent no abort.
    _server_session = object()
    _transaction_id = 0

    def __init__(self, attempts: int = 1) -> None:
        self.open = False
        self.attempts = attempts

    async def __aenter__(self) -> _Session:
        self.open = True
        return self

    async def __aexit__(self, *_: Any) -> None:
        self.open = False

    async def with_transaction(self, callback: Callable[[Any], Awaitable[Any]]) -> Any:
        """As the driver runs one: the callback handed the session itself, once per attempt, the last attempt's answer returned."""

        answer = None
        for _ in range(self.attempts):
            answer = await callback(self)

        return answer


class _Client:
    def __init__(self, attempts: int = 1) -> None:
        self.sessions: list[_Session] = []
        self.attempts = attempts

    def start_session(self) -> _Session:
        self.sessions.append(_Session(self.attempts))
        return self.sessions[-1]


class TestAFullPageIsRunAgain:
    @pytest.mark.parametrize(
        "pages",
        [
            pytest.param([(PAGE, 2, 1)], id="a page at the bound is the last"),
            pytest.param([(PAGE + 1, 4, 2), (PAGE - 1, 2, 0)], id="a page past the bound, then a short one"),
            pytest.param([(PAGE + 1, 4, 2), (PAGE + 1, 4, 3), (0, 0, 0)], id="two past the bound, then an empty one"),
        ],
    )
    def test_the_pages_run_until_one_is_no_longer_than_the_bound(self, pages: list[tuple[int, int, int]]):
        """The first case is the load-bearing one.

        A page of exactly the bound is whole, and one its clock leaves standing would be read for ever.
        """

        client = _Client()
        handed: list[_Session] = []

        async def erase_a_page(session: Any) -> tuple[int, int, int]:
            assert session.open, "a page ran outside the session it was handed"
            handed.append(session)
            return pages[len(handed) - 1]

        erased, redacted = asyncio.run(
            drain(db=cast(AsyncMongoClient, client), page_of=lambda session: session.with_transaction(erase_a_page), page=PAGE)
        )

        assert handed == client.sessions
        assert len(handed) == len(pages)
        assert (erased, redacted) == (sum(page[1] for page in pages), sum(page[2] for page in pages))


class _Judged:
    """A judge recording when the hook enters and leaves it, refusing on entry where `refuses` is set.

    What a production judge does on leaving is its own: `TestTheAdministratorsJudgeOverARealGrant` holds it.
    """

    def __init__(self, events: list[str], *, refuses: bool = False) -> None:
        self.events = events
        self.refuses = refuses

    @asynccontextmanager
    async def __call__(self, session: Any) -> AsyncIterator[None]:
        assert session.open, "the judge ran outside the attempt's session"
        self.events.append("entered")
        if self.refuses:
            raise _RefusedByTheJudge

        yield

        self.events.append("left")


class _RefusedByTheJudge(Exception):
    """The judge's refusal, raised before its callback."""


class _FailedInTheCallback(Exception):
    """The callback's own failure."""


def _run_judged(actor: Actor | PersonActor, judge: Any, *, attempts: int = 1, fails: bool = False, client: _Client | None = None) -> list[str]:
    """One transaction run under `actor` and `judge` bound as a binder binds them, and what ran in it, in order."""

    client = _Client(attempts) if client is None else client
    events: list[str] = [] if judge is None else judge.events

    async def callback(session: Any) -> None:
        events.append("callback")
        if fails:
            raise _FailedInTheCallback

    async def run() -> None:
        actor_token, judge_token = actor_var.set(actor), actor_judge_var.set(judge)
        try:
            async with transaction_session(cast(AsyncMongoClient, client)) as session:
                await session.with_transaction(callback)
        finally:
            actor_var.reset(actor_token)
            actor_judge_var.reset(judge_token)

    asyncio.run(run())

    return events


ADMINISTRATOR = Actor(kind="admin_session", email="admin@example.com")
PERSON = PersonActor(pseudonym="0" * 64, funktion="spieler")


class TestEveryAttemptJudgesItsActorFirst:
    """`docs/backend/spec.md :: I575`: the judge a binder bound is entered inside every attempt the driver makes, around its callback."""

    def test_the_judge_is_entered_before_the_callback_and_left_after_it_on_every_attempt(self):
        """Two attempts, as a write conflict makes: a judge entered once per session would let the retry run on the first attempt's read."""

        events = _run_judged(ADMINISTRATOR, _Judged([]), attempts=2)

        assert events == ["entered", "callback", "left", "entered", "callback", "left"]

    def test_a_refusing_judge_runs_no_callback(self):
        events: list[str] = []
        with pytest.raises(_RefusedByTheJudge):
            _run_judged(ADMINISTRATOR, _Judged(events, refuses=True))

        assert events == ["entered"]

    def test_a_failing_callback_reaches_the_judge_as_its_failure(self):
        """Never as a callback that returned: a judge's last step runs only after one that did."""

        events: list[str] = []
        with pytest.raises(_FailedInTheCallback):
            _run_judged(ADMINISTRATOR, _Judged(events), fails=True)

        assert events == ["entered", "callback"]


class TestTheSystemAndThePublicAreJudgedByNothing:
    @pytest.mark.parametrize("actor", [SYSTEM_ACTOR, PUBLIC_ACTOR], ids=["the system", "the public"])
    def test_their_callback_runs_with_no_judge_bound(self, actor: Actor):
        events = _run_judged(actor, None)

        assert events == ["callback"]


def _actor_kinds() -> frozenset[str]:
    """Every `kind` an actor can carry, read off the two actor types rather than listed, so a kind added there is found here."""

    return frozenset(kind for actor_type in (Actor, PersonActor) for kind in get_args(get_type_hints(actor_type)["kind"]))


# The kinds a binder binds a judge beside, each with the binder: the half of the partition the hook does not name.
JUDGED_BY: Mapping[str, str] = {
    "admin_session": "app/core/security.py :: bind_actor",
    "person_session": "app/core/security.py :: person_actor_binder",
}


def _an_actor_of(kind: str) -> Actor | PersonActor:
    """An actor carrying `kind`, built off a sample of the type declaring it.

    The dataclasses check no `Literal`, so a kind no binder places yet is built all the same.
    """

    sample = next(actor for actor in (ADMINISTRATOR, PERSON) if kind in get_args(get_type_hints(type(actor))["kind"]))

    return dataclasses.replace(sample, kind=kind)


class TestAnUnjudgedActorIsRefused:
    @pytest.mark.parametrize("kind", sorted(_actor_kinds() - UNJUDGED_KINDS))
    def test_a_judged_kind_with_no_judge_bound_opens_no_session(self, kind: str):
        """Every kind the hook does not name, read off the actor types: a kind added there is driven here unlisted.

        Load-bearing for the administrator: a binder that bound the actor and forgot the judge would otherwise write past a revoke.
        """

        client = _Client()
        with pytest.raises(LookupError):
            _run_judged(_an_actor_of(kind), None, client=client)

        assert client.sessions == []

    def test_every_actor_kind_is_unjudged_by_name_or_judged_by_its_binder(self):
        """A kind added to either actor type fails here until it is placed: refused by the hook meanwhile, never let through."""

        assert UNJUDGED_KINDS.isdisjoint(JUDGED_BY)
        assert UNJUDGED_KINDS | JUDGED_BY.keys() == _actor_kinds()


class _TransactedSession(_Session):
    """A session whose transaction number says a transaction ran on it, recording every command its client is sent."""

    # Anything but pymongo's placeholder, as on a session a command has carried to a server.
    _server_session = object()
    _transaction_id = 3

    def __init__(self) -> None:
        super().__init__()
        self.sent: list[dict[str, Any]] = []
        self.client = SimpleNamespace(admin=SimpleNamespace(command=self._command))

    async def _command(self, command: dict[str, Any], **_: Any) -> None:
        self.sent.append(command)


class _TransactingClient:
    def __init__(self) -> None:
        self.session = _TransactedSession()

    def start_session(self) -> _TransactedSession:
        return self.session


def _aborts_sent(*, fails: bool, deadline: float | None) -> list[dict[str, Any]]:
    """What one session's client is sent once the work inside it fails or finishes, under a request deadline at `deadline`."""

    client = _TransactingClient()

    async def run() -> None:
        token = request_deadline_var.set(deadline)
        try:
            async with transaction_session(cast(AsyncMongoClient, client)):
                if fails:
                    raise RuntimeError("the work inside the session failed")
        except RuntimeError:
            pass
        finally:
            request_deadline_var.reset(token)

    asyncio.run(run())

    return client.session.sent


class TestAFailedSessionAbortsInsideItsGrace:
    def test_a_failure_inside_the_grace_sends_the_abort(self):
        """The control: without it, a helper sending nothing at all would pass the case below."""

        assert _aborts_sent(fails=True, deadline=time.monotonic() - ABORT_GRACE_S / 2) == [
            {"abortTransaction": 1, "txnNumber": 3, "autocommit": False}
        ]

    def test_a_failure_past_the_grace_sends_nothing_and_says_so(self, caplog: pytest.LogCaptureFixture):
        """Load-bearing: pymongo reads a deadline of zero as none, so a spent grace handed on would wait without bound."""

        with caplog.at_level(logging.ERROR, logger=fl_logger.name):
            sent = _aborts_sent(fails=True, deadline=time.monotonic() - ABORT_GRACE_S - 1)

        assert sent == []
        assert [getattr(record, "error_code", None) for record in caplog.records] == [DATABASE_FAILED]

    def test_a_session_whose_work_finished_is_sent_no_abort(self):
        """A committed transaction answers an abort harmlessly, so only this case keeps one round trip off every write."""

        assert _aborts_sent(fails=False, deadline=time.monotonic()) == []


class _RefusedFirst(Exception):
    """A route's own refusal, raised inside its callback before it sends anything."""


class TestASessionNoCommandCarriedIsSentNoAbort:
    def test_a_failure_before_any_command_waits_on_no_server(self, caplog: pytest.LogCaptureFixture):
        """Against a server that never answers, where an abort sent waits out the grace and logs its failure.

        Every route cut before its first command takes this path, a deadline spent on server selection among them.
        """

        async def run() -> None:
            client = AsyncMongoClient(UNANSWERED_URI)
            try:

                async def refuse(_session: AsyncClientSession) -> None:
                    raise _RefusedFirst

                with pytest.raises(_RefusedFirst):
                    async with transaction_session(client) as session:
                        await session.with_transaction(refuse)
            finally:
                await client.close()

        with caplog.at_level(logging.ERROR, logger=fl_logger.name):
            asyncio.run(run())

        assert [record for record in caplog.records if getattr(record, "error_code", None) == DATABASE_FAILED] == []


class _AnsweringSession(_TransactedSession):
    """A session whose client answers a command one round trip after it is sent, where a cancellation delivered again takes it."""

    async def _command(self, command: dict[str, Any], **_: Any) -> None:
        await asyncio.sleep(0)
        self.sent.append(command)


class _AnsweringClient:
    def __init__(self) -> None:
        self.session = _AnsweringSession()

    def start_session(self) -> _AnsweringSession:
        return self.session


_HELD = "/held"

_SCOPE: Scope = {
    "type": "http",
    "asgi": {"version": "3.0"},
    "http_version": "1.1",
    "method": "GET",
    "scheme": "http",
    "path": _HELD,
    "raw_path": _HELD.encode(),
    "query_string": b"",
    "headers": [(b"host", TEST_BASE_URL.removeprefix("http://").encode())],
    "client": ("127.0.0.1", 1),
    "server": ("testserver", 80),
}


async def _never_disconnects() -> Message:
    await anyio.sleep_forever()
    raise AssertionError("unreachable")


async def _discarded(_message: Message) -> None:
    return None


async def _cancelled_by_the_server(served: FastAPI, inside: asyncio.Event) -> None:
    """What uvicorn does to a request still running when its shutdown grace runs out: one cancel of the task serving it."""

    serving = asyncio.create_task(served(_SCOPE, _never_disconnects, _discarded))
    await inside.wait()
    serving.cancel()
    with pytest.raises(asyncio.CancelledError):
        await serving


async def _cancelled_by_a_scope(served: FastAPI, inside: asyncio.Event) -> None:
    """An anyio cancel scope around the request, which cancels it again at every await until it leaves the scope."""

    async with anyio.create_task_group() as group:
        group.start_soon(served, _SCOPE, _never_disconnects, _discarded)
        await inside.wait()
        group.cancel_scope.cancel()


class TestACancelledRequestStillAbortsItsTransaction:
    @pytest.mark.parametrize(
        "cancel",
        [
            pytest.param(_cancelled_by_the_server, id="the server cancelling the request's task"),
            pytest.param(_cancelled_by_a_scope, id="an anyio cancel scope around the request"),
        ],
    )
    def test_the_abort_is_answered(self, cancel: Callable[[FastAPI, asyncio.Event], Awaitable[None]]):
        """Through the app's own middleware stack, which decides whether a cancellation arrives once or at every await.

        The scope's case holds the abort's shield; the server's holds `transaction_session` catching a cancellation at all.
        """

        client = _AnsweringClient()
        inside = asyncio.Event()

        async def held_inside_a_session() -> None:
            async with transaction_session(cast(AsyncMongoClient, client)):
                inside.set()
                await anyio.sleep_forever()

        served = create_app(build_test_config())
        served.add_api_route(_HELD, held_inside_a_session)

        asyncio.run(cancel(served, inside))

        assert client.session.sent == [{"abortTransaction": 1, "txnNumber": 3, "autocommit": False}]


class TestTheRouteRunsInTheServersTask:
    def test_no_layer_moves_it_into_a_task_of_its_own(self):
        """`app/core/middlewares.py :: TraceContextMiddleware`'s reason: a task group around the app cancels it at every await.

        The shield holds the helper's abort there, so only this case fails for pymongo's own cleanup awaits.
        """

        ran_in: list[asyncio.Task[Any] | None] = []

        async def records_its_task() -> None:
            ran_in.append(asyncio.current_task())

        served = create_app(build_test_config())
        served.add_api_route(_HELD, records_its_task)

        async def serve() -> asyncio.Task[Any] | None:
            await served(_SCOPE, _never_disconnects, _discarded)
            return asyncio.current_task()

        assert ran_in == [asyncio.run(serve())]


DATABASE_NAME = worker_database("fl_transactions_test")

NO_SUCH_TRANSACTION = 251
TRANSACTION_COMMITTED = 256


class _Aborts(monitoring.CommandListener):
    """The code each `abortTransaction` the client sends is answered with, `None` for one that succeeded."""

    def __init__(self) -> None:
        self.answered: list[int | None] = []

    def started(self, event: monitoring.CommandStartedEvent) -> None:
        """Required by the listener interface; an abort is judged by its answer."""

    def succeeded(self, event: monitoring.CommandSucceededEvent) -> None:
        if event.command_name == "abortTransaction":
            self.answered.append(None)

    def failed(self, event: monitoring.CommandFailedEvent) -> None:
        if event.command_name == "abortTransaction":
            self.answered.append(event.failure.get("code"))


class _Refused(Exception):
    """A route's own refusal, raised inside its callback once a write has gone."""


@pytest.mark.db
class TestARefusedTransactionalWriteRaisesNoAlarm:
    def test_the_abort_the_driver_already_sent_is_not_logged(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """`with_transaction` aborts first, so the server answers this helper's abort NoSuchTransaction.

        Every refusal a route raises inside its transaction takes this path, so an alarm here would sound on each.
        """

        aborts = _Aborts()

        async def body() -> None:
            async with a_clean_database(mongo_replica_set_url, DATABASE_NAME, constraints=False, collections=(Collection.AKTIONEN,)):
                # A client of this case's own, so the listener sees this transaction's commands and none of the seeding.
                watched = AsyncMongoClient(mongo_replica_set_url, event_listeners=[aborts])
                try:
                    written = watched[DATABASE_NAME][Collection.AKTIONEN]

                    async def write_then_refuse(session: AsyncClientSession) -> None:
                        await written.insert_one({"_id": ObjectId()}, session=session)
                        raise _Refused

                    with pytest.raises(_Refused):
                        async with transaction_session(watched) as session:
                            await session.with_transaction(write_then_refuse)
                finally:
                    await watched.close()

        with caplog.at_level(logging.ERROR, logger=fl_logger.name):
            on_the_seed_loop(body())

        # The control: the driver's abort, then this helper's; a helper sending nothing would also log nothing.
        assert aborts.answered == [None, NO_SUCH_TRANSACTION]
        assert [record for record in caplog.records if getattr(record, "error_code", None) == DATABASE_FAILED] == []


class _FailedAfterTheCommit(Exception):
    """Work inside the session failing once its transaction has committed, as a response built from the result can."""


@pytest.mark.db
class TestAFailureAfterTheCommitRaisesNoAlarm:
    def test_the_abort_the_commit_answers_is_not_logged(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """The server answers this helper's abort TransactionCommitted: the write stands and nothing is left open."""

        aborts = _Aborts()

        async def body() -> int:
            async with a_clean_database(mongo_replica_set_url, DATABASE_NAME, constraints=False, collections=(Collection.AKTIONEN,)):
                # A client of this case's own, so the listener sees this transaction's commands and none of the seeding.
                watched = AsyncMongoClient(mongo_replica_set_url, event_listeners=[aborts])
                try:
                    written = watched[DATABASE_NAME][Collection.AKTIONEN]

                    async def write(session: AsyncClientSession) -> None:
                        await written.insert_one({"_id": ObjectId()}, session=session)

                    with pytest.raises(_FailedAfterTheCommit):
                        async with transaction_session(watched) as session:
                            await session.with_transaction(write)
                            raise _FailedAfterTheCommit
                    return await written.count_documents({})
                finally:
                    await watched.close()

        with caplog.at_level(logging.ERROR, logger=fl_logger.name):
            stored = on_the_seed_loop(body())

        # The control: this helper's abort, answered; a helper sending nothing would also log nothing.
        assert (aborts.answered, stored) == ([TRANSACTION_COMMITTED], 1)
        assert [record for record in caplog.records if getattr(record, "error_code", None) == DATABASE_FAILED] == []


JUDGE_DATABASE_NAME = worker_database("fl_transactions_judge_test")

ACTING, OTHER = grants_for_the_suite()[1], grants_for_the_suite()[2]


class _GrantUpdates(monitoring.CommandListener):
    """The `_id` each update the client sends to the grants filters on, in the order sent: a write aborted after it still shows here."""

    def __init__(self) -> None:
        self.filtered_on: list[Any] = []

    def started(self, event: monitoring.CommandStartedEvent) -> None:
        if event.command_name == "update" and event.command.get("update") == Collection.BERECHTIGUNGEN:
            self.filtered_on.extend(update["q"].get("_id") for update in event.command["updates"])

    def succeeded(self, event: monitoring.CommandSucceededEvent) -> None:
        """Required by the listener interface; a write is judged by what was sent."""

    def failed(self, event: monitoring.CommandFailedEvent) -> None:
        """Required by the listener interface; a write is judged by what was sent."""


def _judged_by_the_administrators_judge(url: str, *, fails: bool) -> tuple[list[Any], int]:
    """One transaction under `app/core/security.py :: admin_judge`, its callback writing another grant row.

    Answers the rows each grant update named, as sent, and the actor's row's `bounded_writes` once it ends.
    """

    updates = _GrantUpdates()

    async def body() -> int:
        async with a_clean_database(url, JUDGE_DATABASE_NAME) as (_, database):
            await database[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())
            # A client of this case's own, so the listener sees this transaction's commands and none of the seeding.
            watched = AsyncMongoClient(url, event_listeners=[updates])
            grants = watched[JUDGE_DATABASE_NAME][Collection.BERECHTIGUNGEN]

            async def write(session: AsyncClientSession) -> None:
                await grants.update_one({"_id": OTHER["_id"]}, {"$set": {"erteilt_von": "PROBE"}}, session=session)
                if fails:
                    raise _FailedInTheCallback

            judge = admin_judge(verified_actor(ACTING["adresse"]), build_test_config().model_copy(update={"db_base_name": JUDGE_DATABASE_NAME}))
            actor_token, judge_token = actor_var.set(Actor(kind="admin_session", email=ACTING["adresse"])), actor_judge_var.set(judge)
            try:
                async with transaction_session(watched) as session:
                    await session.with_transaction(write)
            except _FailedInTheCallback:
                pass
            finally:
                actor_var.reset(actor_token)
                actor_judge_var.reset(judge_token)
                await watched.close()

            stored = await database[Collection.BERECHTIGUNGEN].find_one({"_id": ACTING["_id"]})
            assert stored is not None
            return int(stored.get("bounded_writes", 0))

    return updates.filtered_on, on_the_seed_loop(body())


@pytest.mark.db
class TestTheAdministratorsJudgeOverARealGrant:
    """`app/core/security.py :: admin_judge` itself, against the grants a database holds rather than a stub."""

    def test_a_transaction_that_wrote_anchors_the_actors_own_grant_after_its_write(self, mongo_replica_set_url: str):
        """The control for the case below: the anchor is sent, last, on the actor's row and no other, and commits with the write."""

        assert _judged_by_the_administrators_judge(mongo_replica_set_url, fails=False) == ([OTHER["_id"], ACTING["_id"]], 1)

    def test_a_failing_callback_sends_no_anchor(self, mongo_replica_set_url: str):
        """Sent and aborted would leave the grant as it was, so only what reached the server shows an anchor written regardless."""

        assert _judged_by_the_administrators_judge(mongo_replica_set_url, fails=True) == ([OTHER["_id"]], 0)


class _RecordedJudge:
    """What `bind_actor` is handed in place of `app/core/security.py :: admin_judge`, and the judge it answers with."""

    def __init__(self) -> None:
        self.called_with: list[tuple[Any, Any]] = []
        self.judge = object()

    def __call__(self, actor: Any, config: Any) -> object:
        self.called_with.append((actor, config))
        return self.judge


class _RecordedCursor:
    """Every read's cursor: no row, whichever of the driver's chained calls a helper makes."""

    def __init__(self, rows: list[Mapping[str, Any]]) -> None:
        self.rows = rows

    def sort(self, *_: Any, **__: Any) -> _RecordedCursor:
        return self

    def limit(self, *_: Any, **__: Any) -> _RecordedCursor:
        return self

    async def to_list(self, *_: Any, **__: Any) -> list[Mapping[str, Any]]:
        return self.rows


class _RecordedCollection:
    """A collection recording, for every call a judge makes on it, the session that call carried."""

    def __init__(self, database: _RecordedDatabase, name: str) -> None:
        self.database = database
        self.name = name

    def _carried(self, method: str, kwargs: Mapping[str, Any]) -> None:
        self.database.carried.append((self.name, method, kwargs.get("session")))

    async def aggregate(self, *_: Any, **kwargs: Any) -> _RecordedCursor:
        self._carried("aggregate", kwargs)
        return _RecordedCursor(self.database.grants if self.name == Collection.BERECHTIGUNGEN else [])

    def find(self, *_: Any, **kwargs: Any) -> _RecordedCursor:
        self._carried("find", kwargs)
        return _RecordedCursor([])

    async def find_one(self, *_: Any, **kwargs: Any) -> None:
        self._carried("find_one", kwargs)

    async def update_many(self, *_: Any, **kwargs: Any) -> SimpleNamespace:
        self._carried("update_many", kwargs)
        return SimpleNamespace(modified_count=1)

    async def insert_one(self, *_: Any, **kwargs: Any) -> SimpleNamespace:
        self._carried("insert_one", kwargs)
        return SimpleNamespace(inserted_id=ObjectId())


class _RecordedDatabase:
    def __init__(self, grants: list[Mapping[str, Any]]) -> None:
        self.grants = grants
        self.carried: list[tuple[str, str, Any]] = []

    def __getitem__(self, name: str) -> _RecordedCollection:
        return _RecordedCollection(self, name)


def _sessions_a_judge_carried(judge: Any, grants: list[Mapping[str, Any]]) -> tuple[Any, list[tuple[str, str, Any]]]:
    """One attempt through `judge` on a session whose client records every call: the session, and each call with the session it carried."""

    database = _RecordedDatabase(grants)
    session = SimpleNamespace(client={build_test_config().db_base_name: database})

    async def attempt() -> None:
        async with judge(session):
            pass

    asyncio.run(attempt())

    return session, database.carried


class TestEveryJudgeReadsInTheAttemptsSession:
    """`docs/backend/spec.md :: I575`, `:: I576`: a judge's read left off the session judges what committed last, not the attempt's snapshot.

    Entered through `JudgedSession`, which no in-session sweep over a callback's source reaches.
    """

    def test_the_administrators_reads_and_anchor_carry_it(self):
        claims = verified_actor(ACTING["adresse"])
        grant = {**ACTING, "angekuendigt": []}
        session, carried = _sessions_a_judge_carried(admin_judge(claims, build_test_config()), [grant])

        assert {(collection, method) for collection, method, _ in carried} >= {
            (Collection.BERECHTIGUNGEN, "aggregate"),
            (Collection.SPERRLISTE, "find"),
            (Collection.BERECHTIGUNGEN, "update_many"),
        }
        assert [call for call in carried if call[2] is not session] == []

    def test_the_persons_ban_read_carries_it(self):
        session, carried = _sessions_a_judge_carried(person_judge(verified_actor(ACTING["adresse"]), build_test_config()), [])

        assert (Collection.SPERRLISTE, "find") in {(collection, method) for collection, method, _ in carried}
        assert [call for call in carried if call[2] is not session] == []


class TestTheAdministratorsBinderBindsTheirJudge:
    def test_the_judge_built_off_the_verified_actor_is_bound_for_the_request_alone(self, monkeypatch: pytest.MonkeyPatch):
        """Read off the variable the hook reads: an end-to-end refusal could be any judge's, or the check before the handler."""

        recorded = _RecordedJudge()
        monkeypatch.setattr(security, "admin_judge", recorded)
        claims, config = verified_actor(ACTING["adresse"]), build_test_config()
        request = Request({"type": "http", "method": "PATCH", "path": "/api/v0/spielorte", "headers": [], "query_string": b""})

        async def bound() -> tuple[object, object]:
            binder = bind_actor(request, claims, config)
            await anext(binder)
            during = actor_judge_var.get()
            with contextlib.suppress(StopAsyncIteration):
                await anext(binder)

            return during, actor_judge_var.get()

        assert asyncio.run(bound()) == (recorded.judge, None)
        assert recorded.called_with == [(claims, config)]


def _is_a_snapshot(call: ast.Call) -> bool:
    snapshot = [keyword.value for keyword in call.keywords if keyword.arg == "snapshot"]
    return any(isinstance(value, ast.Constant) and value.value is True for value in snapshot)


def _sessions_opened_past_the_helper() -> set[str]:
    """Every site opening a session that can hold a transaction: a snapshot session cannot."""

    return {f"{module} :: {scope}" for module, scope, call in app_calls() if callee(call) == "start_session" and not _is_a_snapshot(call)}


def _transaction_blocks(tree: ast.AST) -> list[ast.AsyncWith]:
    return [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncWith)
        and any(isinstance(item.context_expr, ast.Call) and callee(item.context_expr) == TRANSACTION_SESSION for item in node.items)
    ]


def _session_running_it(node: ast.AST, session: str | None, forwarded: str | None = None) -> ast.Name | None:
    """The session `node` runs a transaction on: `<session>.with_transaction(...)`, or `<forwarded>(<session>)`."""

    if not isinstance(node, ast.Call):
        return None
    if isinstance(node.func, ast.Attribute) and node.func.attr == "with_transaction":
        named = node.func.value
    elif isinstance(node.func, ast.Name) and node.func.id == forwarded and len(node.args) == 1 and not node.keywords:
        named = node.args[0]
    else:
        return None

    return named if isinstance(named, ast.Name) and named.id == session else None


# `drain` awaits the transaction each caller hands it as `page_of`, which every caller is then held to.
_FORWARDING = ("drain", "page_of")


def _able_to_swallow(block: ast.AsyncWith, forwarded: str | None = None) -> list[ast.expr | ast.stmt]:
    """Every node of `block` past the one shape allowed: its session's transaction, awaited where it is called."""

    # A second manager entered beside the helper wraps the body inside it.
    if len(block.items) != 1:
        return [block]
    session = block.items[0].optional_vars.id if isinstance(block.items[0].optional_vars, ast.Name) else None
    inside = [node for statement in block.body for node in ast.walk(statement) if isinstance(node, (ast.expr, ast.stmt))]
    awaited = {id(node.value) for node in inside if isinstance(node, ast.Await)}
    receivers = {id(named) for node in inside if (named := _session_running_it(node, session, forwarded)) is not None}

    # An allow-list, and never a list of swallowing calls: what a call does with a failure is decided
    # at run time, `asyncio.gather(return_exceptions=True)` and an unawaited task among them.
    return [
        node
        for node in inside
        if isinstance(node, (ast.Try, ast.TryStar, ast.With, ast.AsyncWith, ast.AsyncFor))
        or (isinstance(node, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)) and any(loop.is_async for loop in node.generators))
        or (isinstance(node, ast.Await) and _session_running_it(node.value, session, forwarded) is None)
        or (_session_running_it(node, session, forwarded) is not None and id(node) not in awaited)
        # A helper handed the session can run a transaction this sweep never reads.
        or (isinstance(node, ast.Name) and node.id == session and id(node) not in receivers)
    ]


_OPENED = "async with transaction_session(db) as session:\n"

# Each block that could keep a failure from the helper, and the kinds of node the sweep must name in it:
# a refusal another one also reaches would pass with its own arm gone.
_SWALLOWING_BLOCKS = {
    "a try": (_OPENED + "    try:\n        await session.with_transaction(write)\n    except Exception:\n        pass", ["Try"]),
    "a context manager": (_OPENED + "    with contextlib.suppress(Exception):\n        await session.with_transaction(write)", ["With"]),
    "a gather returning its exceptions": (
        _OPENED + "    await asyncio.gather(session.with_transaction(write), return_exceptions=True)",
        ["Await", "Call"],
    ),
    "a task never awaited": (_OPENED + "    asyncio.create_task(session.with_transaction(write))", ["Call"]),
    "an awaited helper": (_OPENED + "    await run_swallowing(write)", ["Await"]),
    "the session handed to a helper": (_OPENED + "    result = await session.with_transaction(write)\n    keep(session)", ["Name"]),
    "an async for": (_OPENED + "    async for _ in rows():\n        result = await session.with_transaction(write)", ["AsyncFor"]),
    "an async comprehension": (_OPENED + "    [row async for row in rows()]\n    await session.with_transaction(write)", ["ListComp"]),
    "a second manager on the line": (
        "async with transaction_session(db) as session, contextlib.suppress(Exception):\n    await session.with_transaction(write)",
        ["AsyncWith"],
    ),
}

# The shapes the tree's blocks take.
_PLAIN_BLOCKS = {
    "assigned": _OPENED + "    drawn = await session.with_transaction(write)",
    "returned": _OPENED + "    return await session.with_transaction(write)",
    "built into a response": _OPENED + "    return Response(angewendet=await session.with_transaction(write))",
}


def _the_block(source: str) -> ast.AsyncWith:
    [block] = _transaction_blocks(ast.parse("async def handler(db, write):\n" + "".join(f"    {line}\n" for line in source.splitlines())))

    return block


class TestEveryTransactionRunsOnTheHelpersSession:
    """`docs/backend/spec.md :: I539`: a session opened past `transaction_session`, or a failure kept inside one, ends with no abort sent."""

    def test_no_session_able_to_transact_is_opened_past_it(self):
        assert _sessions_opened_past_the_helper() == {f"app/core/transactions.py :: {TRANSACTION_SESSION}"}

    def test_nothing_inside_one_can_keep_a_failure_from_it(self):
        blocks = [
            (path.relative_to(BACKEND_ROOT).as_posix(), block)
            for path in sorted(APP_ROOT.rglob("*.py"))
            for block in _transaction_blocks(parsed(path))
        ]
        # Non-empty, so a helper renamed past this sweep's spelling fails rather than finding nothing to judge.
        assert blocks
        function, parameter = _FORWARDING
        forwarding = {
            id(block)
            for node in ast.walk(parsed(APP_ROOT / "core" / "transactions.py"))
            if isinstance(node, ast.AsyncFunctionDef) and node.name == function
            for block in _transaction_blocks(node)
        }
        assert forwarding, f"no `{function}` opens a session where this sweep looks"

        assert [
            f"{module}:{node.lineno}"
            for module, block in blocks
            for node in _able_to_swallow(block, parameter if id(block) in forwarding else None)
        ] == []

    def test_every_page_drain_is_handed_runs_its_transaction_where_it_is_called(self):
        """`drain` awaits what `page_of` returns, so a `page_of` returning anything but the transaction escapes the sweep above."""

        function, parameter = _FORWARDING
        handed = [
            (f"{module} :: {scope}", keyword.value)
            for module, scope, call in app_calls()
            if callee(call) == function
            for keyword in call.keywords
            if keyword.arg == parameter
        ]
        assert handed, f"no call hands `{function}` a `{parameter}`, so the clause below is vacuous"

        assert [
            site
            for site, page_of in handed
            if not (
                isinstance(page_of, ast.Lambda)
                and len(page_of.args.args) == 1
                and _session_running_it(page_of.body, page_of.args.args[0].arg) is not None
            )
        ] == []

    @pytest.mark.parametrize(("source", "named"), [pytest.param(*sample, id=name) for name, sample in _SWALLOWING_BLOCKS.items()])
    def test_the_sweep_names_each_shape_that_can(self, source: str, named: list[str]):
        """The tree's blocks are uniform, so only these samples show each of the sweep's refusals can fire."""

        assert sorted(type(node).__name__ for node in _able_to_swallow(_the_block(source))) == named

    @pytest.mark.parametrize("source", [pytest.param(source, id=name) for name, source in _PLAIN_BLOCKS.items()])
    def test_the_sweep_passes_each_shape_the_tree_takes(self, source: str):
        assert _able_to_swallow(_the_block(source)) == []
