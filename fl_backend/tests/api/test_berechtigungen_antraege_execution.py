"""
API · four eyes on a grant and a promotion: the request, its lone paths, who decides it, its races, its lapse and its journal

Against a replica set, every write in a transaction, each handler called directly with the actor its binder binds. A century
ahead of the real clock where a case allows: a request lapses at `bis`, and the TTL monitor
deletes a lapsed one at its next pass, under a case reading it back.
"""

import inspect
import logging
import time
from collections.abc import Awaitable, Callable, Iterator, Mapping
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.api.berechtigungen.admin_router import (
    delete_approval_request,
    delete_grant,
    get_grants,
    patch_grant,
    post_approval_request_approval,
    post_grant,
)
from app.api.berechtigungen.antraege import (
    antrag_line,
    compose_antrag,
    end_the_antraege_about_in_session,
    loeschen_antraege_in_session,
)
from app.api.berechtigungen.schemas import FLPatchGrantPayload, FLPostGrantPayload
from app.api.berechtigungen.system_router import post_grants_reconciliation
from app.api.identitaet.wiederherstellung import Window, plan_replay
from app.api.sperrliste.services import compose_gesperrt_bis_saison_id
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError, DocumentNotFoundError
from app.core.journal import JOURNAL_TOKEN, parse_line
from app.core.recording import SYSTEM_ACTOR, Actor, actor_var, log_stamp
from app.core.transactions import transaction_session
from app.shared.schemas.bounds import GENEHMIGUNG_TAGE
from tests.bans import ban_list
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import ban_document, rules_document, saison_document
from tests.isolation import COMMITTED, InterleavedCollection, Rival
from tests.worker import worker_database

from .adresswechsel_harness import EMAIL, NEW_EMAIL, SECOND_ADMIN, granted, on_a_person
from .adresswechsel_harness import answer as answer_the_change
from .adresswechsel_harness import approve as approve_the_change
from .adresswechsel_harness import start as start_the_change
from .conftest import config_for

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_berechtigungen_antraege_test")

CONFIG = config_for(DATABASE_NAME)

BERLIN = ZoneInfo("Europe/Berlin")
NOW = datetime(2126, 4, 1, 12, 30, tzinfo=BERLIN)
PASTED = datetime(2026, 1, 1, tzinfo=UTC)
RUNNING = "2026"
# Composed by the production helper, so a drifted bound cannot leave a case passing over a lapsed ban.
STANDING = compose_gesperrt_bis_saison_id(massgebliche_saison_id=RUNNING)

OWNER_ID = ObjectId("6890a1b2c3d4e5f607920001")
ANNA_ID = ObjectId("6890a1b2c3d4e5f607920002")
BERND_ID = ObjectId("6890a1b2c3d4e5f607920003")
CARLA_ID = ObjectId("6890a1b2c3d4e5f607920004")
OWNER = "inhaberin@frankfurtleague.de"
ANNA = "anna.admin@frankfurtleague.de"
BERND = "bernd.admin@frankfurtleague.de"
CARLA = "carla.admin@frankfurtleague.de"

NEU_TYPED = "Nora.Neu@Beispielschule.de"
NEU = "nora.neu@beispielschule.de"

NOT_FOUND = "404"

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def grant_document(grant_id: ObjectId, adresse: str, verwaltung: str, *, granted_at: datetime = PASTED) -> dict[str, Any]:
    """As the Playground paste writes one."""

    return {"_id": grant_id, "adresse": adresse, "verwaltung": verwaltung, "granted_by": "PLAYGROUND", "granted_at": granted_at}


def since(seconds_ago: int) -> datetime:
    """An instant on the real clock: a grant younger than a request is one a session signed in since it still admits."""

    return datetime.now(BERLIN) - timedelta(seconds=seconds_ago)


# An owner and two administrators: either administrator can approve the other's grant, and no second owner stands.
THREE = [
    grant_document(OWNER_ID, OWNER, "owner"),
    grant_document(ANNA_ID, ANNA, "administration"),
    grant_document(BERND_ID, BERND, "administration"),
]
# Two owners and an administrator: a promotion of the administrator waits on whichever owner did not ask for it.
TWO_OWNERS = [
    grant_document(OWNER_ID, OWNER, "owner"),
    grant_document(ANNA_ID, ANNA, "owner"),
    grant_document(BERND_ID, BERND, "administration"),
]
# Carla granted half an hour ago: after a request asked an hour ago, before one asked ten minutes ago.
ASKED_AN_HOUR_AGO = 3600
WITH_CARLA_SINCE_HALF_AN_HOUR = [*THREE, grant_document(CARLA_ID, CARLA, "administration", granted_at=since(1800).astimezone(UTC))]


def on_a_league(url: str, body: Body, *, grants: list[dict[str, Any]] = THREE) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(
                saison_document(RUNNING, "active", rules=rules_document(number_of_gruppen=2, allowed_stufen=["E1"]))
            )
            await database[Collection.BERECHTIGUNGEN].insert_many([dict(grant) for grant in grants])

            return await body(database, client)

    return on_the_seed_loop(_run())


_ACTOR_PARAMETERS = frozenset({"granted_by", "changed_by", "entzogen_von", "operator"})


async def call(handler: Callable[..., Awaitable[Any]], database: AsyncDatabase, client: AsyncMongoClient, *, als: str, **given: Any) -> Any:
    """The handler as one request of `als`: its actor bound, every collection taken off `database` by its parameter's spelling."""

    supplied: dict[str, Any] = {}
    for name in inspect.signature(handler).parameters:
        if name in given:
            supplied[name] = given[name]
        elif name.endswith("_collection"):
            supplied[name] = database[Collection(name.removesuffix("_collection"))]
        elif name == "sperrliste":
            supplied[name] = ban_list(database)
        elif name == "db":
            supplied[name] = client
        elif name == "config":
            supplied[name] = CONFIG
        elif name == "now":
            supplied[name] = NOW
        elif name == "auth_time":
            supplied[name] = int(time.time()) - 60
        elif name in _ACTOR_PARAMETERS:
            supplied[name] = als

    actor_token = actor_var.set(Actor(kind="admin_session", email=als))
    try:
        return await handler(**supplied)
    finally:
        actor_var.reset(actor_token)


def ask(database: AsyncDatabase, client: AsyncMongoClient, email: str = NEU_TYPED, *, als: str = ANNA, **given: Any) -> Awaitable[Any]:
    return call(post_grant, database, client, als=als, berechtigung_data=FLPostGrantPayload(email=email), **given)


def tier(
    database: AsyncDatabase, client: AsyncMongoClient, grant_id: ObjectId, verwaltung: str = "owner", *, als: str = OWNER, **given: Any
) -> Awaitable[Any]:
    payload = FLPatchGrantPayload.model_validate({"verwaltung": verwaltung})
    return call(patch_grant, database, client, als=als, grant_id=grant_id, berechtigung_data=payload, **given)


def approve(database: AsyncDatabase, client: AsyncMongoClient, approval_request_id: ObjectId, *, als: str, **given: Any) -> Awaitable[Any]:
    return call(post_approval_request_approval, database, client, als=als, approval_request_id=approval_request_id, **given)


def refuse(database: AsyncDatabase, client: AsyncMongoClient, approval_request_id: ObjectId, *, als: str, **given: Any) -> Awaitable[Any]:
    return call(delete_approval_request, database, client, als=als, approval_request_id=approval_request_id, **given)


def revoke(database: AsyncDatabase, client: AsyncMongoClient, grant_id: ObjectId, *, als: str = OWNER) -> Awaitable[Any]:
    return call(delete_grant, database, client, als=als, grant_id=grant_id)


def listed(database: AsyncDatabase, client: AsyncMongoClient, *, als: str = OWNER) -> Awaitable[Any]:
    return call(get_grants, database, client, als=als)


async def outcome(call: Awaitable[Any]) -> str:
    """A refusal's code, `NOT_FOUND` for a 404, or `COMMITTED`: a write conflict reaching here is a retry that never happened."""

    try:
        await call
    except DocumentNotFoundError:
        return NOT_FOUND
    except APIError as refusal:
        return str(refusal.error_code)

    return COMMITTED


async def antraege(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    return [row async for row in database[Collection.BERECHTIGUNGEN_ANTRAEGE].find({}, sort=[("_id", 1)])]


async def tiers(database: AsyncDatabase) -> dict[str, str]:
    return {str(row["adresse"]): str(row["verwaltung"]) async for row in database[Collection.BERECHTIGUNGEN].find()}


async def announced(database: AsyncDatabase) -> list[tuple[str, str | None, str | None]]:
    """Each grant notice still owed, once whoever it is owed to: its kind, the address it is about and who made it."""

    return [(daten["change"], (daten["now"] or daten["before"])["adresse"], daten["changed_by"]) for daten, _ in await owed(database)]


async def owed(database: AsyncDatabase) -> list[tuple[Mapping[str, Any], list[str]]]:
    """Each grant notice still owed, in the order owed: its facts and every address it is owed to."""

    notices: dict[str, tuple[Mapping[str, Any], list[str]]] = {}
    async for row in database[Collection.POSTAUSGANG].find({"stand": "open", "art": "grant"}, sort=[("recorded_at", 1), ("_id", 1)]):
        notices.setdefault(row["key"].rpartition("/")[0], (row["data"], []))[1].append(str(row["an"]))

    return [(daten, sorted(an)) for daten, an in notices.values()]


async def asked_for(database: AsyncDatabase, client: AsyncMongoClient, **given: Any) -> ObjectId:
    """A grant of `NEU` Anna asked for, waiting on another administrator."""

    answer = await ask(database, client, **given)
    assert answer.requested
    return answer.created_id


@contextmanager
def journal_of(caplog: pytest.LogCaptureFixture) -> Iterator[list[Any]]:
    """The journal lines its block alone writes, filled as it closes: `caplog` holds the whole case's records."""

    lines: list[Any] = []
    with caplog.at_level(logging.INFO):
        first = len(caplog.records)
        yield lines
        written = caplog.records[first:]
    lines.extend(parse_line(record.getMessage()) for record in written if record.getMessage().startswith(JOURNAL_TOKEN))


class RunningARivalAfterTheFirstRead(InterleavedCollection):
    """A collection a transaction reads first, a rival run once after that read and before the transaction writes anything."""

    def __init__(self, collection: Any, rival: Rival) -> None:
        async def reported() -> None:
            self.rival_outcome = await outcome(rival())

        super().__init__(collection, reported)
        self.rival_outcome: str | None = None

    async def aggregate(self, *args: Any, **kwargs: Any) -> Any:
        cursor = await self._collection.aggregate(*args, **kwargs)
        await self.run_the_rival()

        return cursor


class TestFourEyesOnAGrant:
    """A grant takes effect only on another administrator's approval, wherever one could give it."""

    def test_a_grant_another_administrator_could_approve_waits_as_a_request_and_announces_no_grant(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answer = await ask(database, client)
            return answer.requested, await tiers(database), await antraege(database), await announced(database)

        beantragt, granted_tiers, rows, queued = on_a_league(mongo_replica_set_url, body)

        assert (beantragt, NEU in granted_tiers, queued) == (True, False, [("requested", NEU, ANNA)])
        assert [{key: value for key, value in row.items() if key != "_id"} for row in rows] == [
            {
                "adresse": NEU,
                "grant_id": None,
                "approval": {
                    "verwaltung": "administration",
                    "asked_at": NOW.astimezone(UTC).replace(tzinfo=None),
                    "bis": (NOW + timedelta(days=GENEHMIGUNG_TAGE)).astimezone(UTC).replace(tzinfo=None),
                    "started_by": ANNA,
                },
            }
        ]

    def test_its_approval_makes_the_grant_under_the_approver_and_removes_the_request_in_one_write(self, mongo_replica_set_url: str):
        """Announced as a grant made directly is; the request's image stays on the log, naming who asked."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            antrag_id = await asked_for(database, client)
            answer = await approve(database, client, antrag_id, als=BERND)
            grant = await database[Collection.BERECHTIGUNGEN].find_one({"adresse": NEU})
            removal = await database[Collection.AKTIONEN].find_one(
                {"collection": str(Collection.BERECHTIGUNGEN_ANTRAEGE), "operation": "delete_many"}
            )
            assert grant is not None and removal is not None
            return (
                answer.grant_id == grant["_id"],
                grant["granted_by"],
                await antraege(database),
                await announced(database),
                removal["actor"]["email"],
                removal["before"][0]["approval"]["started_by"],
            )

        assert on_a_league(mongo_replica_set_url, body) == (
            True,
            BERND,
            [],
            # The request's notice went with the request: nobody is left to ask.
            [("granted", NEU, BERND)],
            BERND,
            ANNA,
        )

    def test_a_lone_administrator_grants_alone_and_announces_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answer = await ask(database, client, als=OWNER)
            return answer.requested, (await tiers(database)).get(NEU), await antraege(database), await announced(database)

        assert on_a_league(mongo_replica_set_url, body, grants=[THREE[0]]) == (False, "administration", [], [("granted", NEU, OWNER)])

    def test_a_colleague_the_ban_list_holds_leaves_the_administrator_alone(self, mongo_replica_set_url: str):
        """A barred colleague approves nothing, so a request would only lapse."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPERRLISTE].insert_one(ban_document(BERND, bis=STANDING))
            return (await ask(database, client, als=OWNER)).requested

        assert on_a_league(mongo_replica_set_url, body, grants=[THREE[0], THREE[2]]) is False


class TestFourEyesOnAPromotion:
    """A promotion waits on another owner where one exists; a lone owner promotes alone."""

    def test_a_promotion_another_owner_could_approve_waits_as_a_request(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answer = await tier(database, client, BERND_ID)
            rows = [(row["adresse"], row["grant_id"], row["approval"]["verwaltung"]) for row in await antraege(database)]
            return answer.requested, (await tiers(database))[BERND], rows

        assert on_a_league(mongo_replica_set_url, body, grants=TWO_OWNERS) == (True, "administration", [(BERND, BERND_ID, "owner")])

    def test_the_other_owners_approval_moves_the_tier_dated_from_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await tier(database, client, BERND_ID)
            (antrag,) = await antraege(database)
            await approve(database, client, antrag["_id"], als=ANNA)
            bernd = await database[Collection.BERECHTIGUNGEN].find_one({"_id": BERND_ID})
            assert bernd is not None
            return bernd["verwaltung"], bernd["appointed_at"], await antraege(database), await announced(database)

        assert on_a_league(mongo_replica_set_url, body, grants=TWO_OWNERS) == (
            "owner",
            NOW.astimezone(UTC).replace(tzinfo=None),
            [],
            # The paste nobody had been told of goes out first, as the tier change announces one.
            [("granted", BERND, None), ("changed", BERND, ANNA)],
        )

    def test_a_lone_owner_promotes_alone_though_administrators_could_approve(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answer = await tier(database, client, ANNA_ID)
            kinds = {art for art, _, _ in await announced(database)}
            return answer.requested, (await tiers(database))[ANNA], await antraege(database), "requested" in kinds

        assert on_a_league(mongo_replica_set_url, body) == (False, "owner", [], False)

    def test_a_demotion_takes_effect_at_once(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answer = await tier(database, client, ANNA_ID, "administration")
            return answer.requested, (await tiers(database))[ANNA], await antraege(database)

        assert on_a_league(mongo_replica_set_url, body, grants=TWO_OWNERS) == (False, "administration", [])


async def compared(database: AsyncDatabase, client: AsyncMongoClient, *, now: datetime = NOW) -> None:
    """The comparison pass, as the system actor makes it, which owes every change made in the database."""

    token = actor_var.set(SYSTEM_ACTOR)
    try:
        await post_grants_reconciliation(
            berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
            berechtigungen_angekuendigt_collection=database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT],
            postausgang_collection=database[Collection.POSTAUSGANG],
            sperrliste=ban_list(database),
            db=client,
            now=now,
        )
    finally:
        actor_var.reset(token)


async def asked(database: AsyncDatabase) -> list[tuple[str | None, str | None, list[str]]]:
    """Each request still owed: its subject, its requester and the approvers it is owed to."""

    return [
        (None if daten["now"] is None else daten["now"]["adresse"], daten["changed_by"], an)
        for daten, an in await owed(database)
        if daten["change"] == "requested"
    ]


class TestTheRequestAsksItsApprovers:
    """A request is owed to whoever could approve it as it is made, and to nobody else."""

    def test_a_grants_request_goes_to_its_other_administrators_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await asked_for(database, client)
            await compared(database, client)
            changes = [(daten["change"], an) for daten, an in await owed(database) if daten["change"] != "requested"]
            return await asked(database), changes

        # The paste's three grants go to every holder; the request to neither its requester nor its subject.
        assert on_a_league(mongo_replica_set_url, body) == (
            [(NEU, ANNA, [BERND, OWNER])],
            [("granted", sorted([ANNA, BERND, OWNER]))] * 3,
        )

    def test_a_promotions_request_goes_to_the_other_owners_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await tier(database, client, BERND_ID)
            return await asked(database)

        grants = [*TWO_OWNERS, grant_document(CARLA_ID, CARLA, "administration")]
        assert on_a_league(mongo_replica_set_url, body, grants=grants) == [(BERND, OWNER, [ANNA])]

    def test_an_administrator_granted_after_the_request_is_not_asked(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await asked_for(database, client, now=since(ASKED_AN_HOUR_AGO))
            return await asked(database)

        assert on_a_league(mongo_replica_set_url, body, grants=WITH_CARLA_SINCE_HALF_AN_HOUR) == [(NEU, ANNA, [BERND, OWNER])]

    @pytest.mark.parametrize(
        "decided",
        [
            pytest.param(lambda database, client, antrag_id: approve(database, client, antrag_id, als=BERND), id="approved"),
            pytest.param(lambda database, client, antrag_id: refuse(database, client, antrag_id, als=BERND), id="refused"),
            pytest.param(lambda database, client, antrag_id: refuse(database, client, antrag_id, als=ANNA), id="withdrawn"),
        ],
    )
    def test_a_decided_request_takes_its_notice_with_it(self, mongo_replica_set_url: str, decided: Racer):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            antrag_id = await asked_for(database, client)
            await decided(database, client, antrag_id)
            return [art for art, _, _ in await announced(database) if art == "requested"], await asked(database)

        assert on_a_league(mongo_replica_set_url, body) == ([], [])


class TestOneRequestPerAddress:
    """One request per address, and one lapsed is gone to every reader at once."""

    def test_a_second_request_about_an_address_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await asked_for(database, client)
            return await outcome(ask(database, client, als=BERND)), len(await antraege(database))

        assert on_a_league(mongo_replica_set_url, body) == (Code.GRANT_APPROVAL_REQUEST_OPEN, 1)

    def test_a_promotion_whose_request_waits_is_refused_even_alone(self, mongo_replica_set_url: str):
        """Asked while another owner stood, then that owner demoted: the lone owner decides the request first."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await tier(database, client, BERND_ID)
            await tier(database, client, ANNA_ID, "administration")
            return await outcome(tier(database, client, BERND_ID)), (await tiers(database))[BERND]

        assert on_a_league(mongo_replica_set_url, body, grants=TWO_OWNERS) == (Code.GRANT_APPROVAL_REQUEST_OPEN, "administration")

    def test_two_requests_crossing_leave_one(self, mongo_replica_set_url: str):
        """The rival commits between the first request's read of the grants and its first write; the first is judged again."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def rival() -> Any:
                return await ask(database, client, als=BERND)

            racing = RunningARivalAfterTheFirstRead(database[Collection.BERECHTIGUNGEN], rival)
            first = await outcome(ask(database, client, berechtigungen_collection=racing))
            racing.assert_landed_inside(serially=1)
            return racing.rival_outcome, first, [row["approval"]["started_by"] for row in await antraege(database)]

        assert on_a_league(mongo_replica_set_url, body) == (COMMITTED, Code.GRANT_APPROVAL_REQUEST_OPEN, [BERND])

    def test_the_index_holds_one_row_per_address_beneath_the_route(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> None:
            row = compose_antrag(adresse=NEU, verwaltung="administration", grant_id=None, started_by=ANNA, now=NOW)
            await database[Collection.BERECHTIGUNGEN_ANTRAEGE].insert_one(dict(row))
            with pytest.raises(DuplicateKeyError):
                await database[Collection.BERECHTIGUNGEN_ANTRAEGE].insert_one(dict(row))

        on_a_league(mongo_replica_set_url, body)

    def test_a_restored_lapsed_request_is_gone_to_every_reader(self, mongo_replica_set_url: str):
        """A restore puts back a row its TTL index had removed, and nothing journals a lapse: the reads' own `bis` term holds it.

        Listed by nobody, decided by nobody, and replaced by the next request about its address.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            lapsed = compose_antrag(adresse=NEU, verwaltung="administration", grant_id=None, started_by=ANNA, now=NOW - timedelta(days=8))
            restored = (await database[Collection.BERECHTIGUNGEN_ANTRAEGE].insert_one(lapsed)).inserted_id
            served = (await listed(database, client)).approval_requests
            decided = [
                await outcome(approve(database, client, restored, als=BERND)),
                await outcome(refuse(database, client, restored, als=BERND)),
            ]
            again = await ask(database, client, als=BERND)
            return served, decided, NEU in await tiers(database), [row["_id"] == again.created_id for row in await antraege(database)]

        assert on_a_league(mongo_replica_set_url, body) == ([], [NOT_FOUND, NOT_FOUND], False, [True])


class TestWhoMayDecide:
    """Neither the requester nor the subject approves; an owner's act takes an owner held since before it."""

    @pytest.mark.parametrize(
        ("als", "refused"),
        [
            pytest.param(ANNA, Code.GRANT_APPROVAL_DENIED, id="the requester"),
            pytest.param(CARLA, Code.GRANT_APPROVAL_YOUNGER, id="an administrator granted after the request"),
        ],
    )
    def test_a_grants_approval_is_refused_and_writes_nothing(self, mongo_replica_set_url: str, als: str, refused: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            antrag_id = await asked_for(database, client, now=since(ASKED_AN_HOUR_AGO))
            code = await outcome(approve(database, client, antrag_id, als=als, now=since(60)))
            return code, NEU in await tiers(database), len(await antraege(database))

        assert on_a_league(mongo_replica_set_url, body, grants=WITH_CARLA_SINCE_HALF_AN_HOUR) == (refused, False, 1)

    def test_an_administrator_granted_before_the_request_approves(self, mongo_replica_set_url: str):
        """The tenure rule's other side: the same approver, a request asked after her grant."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            antrag_id = await asked_for(database, client, now=since(600))
            return await outcome(approve(database, client, antrag_id, als=CARLA, now=since(60))), NEU in await tiers(database)

        assert on_a_league(mongo_replica_set_url, body, grants=WITH_CARLA_SINCE_HALF_AN_HOUR) == (COMMITTED, True)

    @pytest.mark.parametrize(
        ("als", "refused"),
        [
            pytest.param(BERND, Code.GRANT_APPROVAL_DENIED, id="the administrator it is about"),
            pytest.param(CARLA, Code.GRANT_APPROVAL_OWNER, id="an administrator who is no owner"),
            pytest.param(OWNER, Code.GRANT_APPROVAL_DENIED, id="an owner asking for it"),
        ],
    )
    def test_a_promotions_approval_is_refused_and_writes_nothing(self, mongo_replica_set_url: str, als: str, refused: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await tier(database, client, BERND_ID)
            (antrag,) = await antraege(database)
            return await outcome(approve(database, client, antrag["_id"], als=als)), (await tiers(database))[BERND]

        grants = [*TWO_OWNERS, grant_document(CARLA_ID, CARLA, "administration")]
        assert on_a_league(mongo_replica_set_url, body, grants=grants) == (refused, "administration")

    def test_the_list_says_who_asked_when_and_why_its_reader_may_not_approve(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            antrag_id = await asked_for(database, client)
            return antrag_id, {als: (await listed(database, client, als=als)).approval_requests for als in (ANNA, BERND)}

        antrag_id, readers = on_a_league(mongo_replica_set_url, body)

        (by_anna,), (by_bernd,) = readers[ANNA], readers[BERND]
        assert (by_anna.id, by_anna.adresse, by_anna.started_by, by_anna.verwaltung, by_anna.stands) == (
            antrag_id,
            NEU,
            ANNA,
            "administration",
            True,
        )
        assert (by_anna.asked_at, by_anna.bis) == (
            NOW.astimezone(UTC),
            (NOW + timedelta(days=GENEHMIGUNG_TAGE)).astimezone(UTC),
        )
        assert (by_anna.denied, by_bernd.denied) == ("started", None)

    def test_the_requester_withdraws_their_own_and_an_approver_refuses(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            withdrawn = await outcome(refuse(database, client, await asked_for(database, client), als=ANNA))
            refused = await outcome(refuse(database, client, await asked_for(database, client), als=BERND))
            return withdrawn, refused, await antraege(database), NEU in await tiers(database)

        assert on_a_league(mongo_replica_set_url, body) == (COMMITTED, COMMITTED, [], False)

    def test_neither_the_promoted_administrator_nor_one_who_is_no_owner_refuses_a_promotion(self, mongo_replica_set_url: str):
        """Refusing is deciding, held to the approval's own rule: only the requester's withdrawal stands outside it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await tier(database, client, BERND_ID)
            (antrag,) = await antraege(database)
            by_its_subject = await outcome(refuse(database, client, antrag["_id"], als=BERND))
            by_no_owner = await outcome(refuse(database, client, antrag["_id"], als=CARLA))
            return by_its_subject, by_no_owner, len(await antraege(database))

        grants = [*TWO_OWNERS, grant_document(CARLA_ID, CARLA, "administration")]
        assert on_a_league(mongo_replica_set_url, body, grants=grants) == (
            Code.GRANT_APPROVAL_DENIED,
            Code.GRANT_APPROVAL_OWNER,
            1,
        )

    def test_an_administrator_granted_after_the_request_refuses_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            antrag_id = await asked_for(database, client, now=since(ASKED_AN_HOUR_AGO))
            return await outcome(refuse(database, client, antrag_id, als=CARLA, now=since(60))), len(await antraege(database))

        assert on_a_league(mongo_replica_set_url, body, grants=WITH_CARLA_SINCE_HALF_AN_HOUR) == (Code.GRANT_APPROVAL_YOUNGER, 1)


class TestARequestOutlivesNoRequester:
    """A revoke, a demotion or a ban of the requester leaves their request approved by nobody, and a revoke or a demotion asks nobody."""

    def test_a_revoked_requesters_grant_is_approved_by_nobody(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            antrag_id = await asked_for(database, client)
            await revoke(database, client, ANNA_ID)
            (served,) = (await listed(database, client)).approval_requests
            return (
                served.stands,
                await asked(database),
                await outcome(approve(database, client, antrag_id, als=BERND)),
                NEU in await tiers(database),
            )

        grants = [*THREE, grant_document(CARLA_ID, CARLA, "administration")]
        assert on_a_league(mongo_replica_set_url, body, grants=grants) == (False, [], Code.GRANT_APPROVAL_REQUEST_LAPSED, False)

    def test_a_demoted_owners_promotion_is_approved_by_nobody(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await tier(database, client, BERND_ID)
            (antrag,) = await antraege(database)
            await tier(database, client, OWNER_ID, "administration", als=ANNA)
            return await asked(database), await outcome(approve(database, client, antrag["_id"], als=ANNA)), (await tiers(database))[BERND]

        assert on_a_league(mongo_replica_set_url, body, grants=TWO_OWNERS) == ([], Code.GRANT_APPROVAL_REQUEST_LAPSED, "administration")

    def test_a_barred_requesters_grant_is_approved_by_nobody(self, mongo_replica_set_url: str):
        """Barred in the database, the one way a grant holder's address reaches the list."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            antrag_id = await asked_for(database, client)
            await database[Collection.SPERRLISTE].insert_one(ban_document(ANNA, bis=STANDING))
            return await outcome(approve(database, client, antrag_id, als=BERND))

        assert on_a_league(mongo_replica_set_url, body) == Code.GRANT_APPROVAL_REQUEST_LAPSED


class TestTheApprovalJudgesTheAddressAgain:
    """What the direct act refuses, the approval refuses too, judged when it is pressed: a week is long enough for a ban or a paste."""

    def test_a_subject_barred_since_is_withheld_on_the_list_and_granted_nothing(self, mongo_replica_set_url: str):
        """Withheld beside its flag as a grant's address is, and the request left to be refused."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            antrag_id = await asked_for(database, client)
            await database[Collection.SPERRLISTE].insert_one(ban_document(NEU, bis=STANDING))
            (served,) = (await listed(database, client)).approval_requests
            approved = await outcome(approve(database, client, antrag_id, als=BERND))
            return (served.adresse, served.barred), approved, NEU in await tiers(database), len(await antraege(database))

        assert on_a_league(mongo_replica_set_url, body) == ((None, True), Code.GRANT_BARRED, False, 1)

    def test_an_administrator_barred_since_is_promoted_by_nobody(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await tier(database, client, BERND_ID)
            (antrag,) = await antraege(database)
            await database[Collection.SPERRLISTE].insert_one(ban_document(BERND, bis=STANDING))
            return await outcome(approve(database, client, antrag["_id"], als=ANNA)), (await tiers(database))[BERND]

        assert on_a_league(mongo_replica_set_url, body, grants=TWO_OWNERS) == (Code.GRANT_BARRED, "administration")

    def test_an_address_granted_since_in_the_database_is_granted_no_second_time(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            antrag_id = await asked_for(database, client)
            await database[Collection.BERECHTIGUNGEN].insert_one(grant_document(CARLA_ID, NEU, "administration"))
            approved = await outcome(approve(database, client, antrag_id, als=BERND))
            return approved, await database[Collection.BERECHTIGUNGEN].count_documents({"adresse": NEU})

        assert on_a_league(mongo_replica_set_url, body) == (Code.GRANT_EXISTS, 1)


Racer = Callable[[AsyncDatabase, AsyncMongoClient, ObjectId], Awaitable[Any]]


def raced(url: str, rival: Racer) -> Any:
    """`OWNER` approving, the rival landing after the first read: the rival's outcome, the approval's, the grants made, the requests left."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        antrag_id = await asked_for(database, client)

        async def running() -> Any:
            return await rival(database, client, antrag_id)

        racing = RunningARivalAfterTheFirstRead(database[Collection.BERECHTIGUNGEN_ANTRAEGE], running)
        approved = await outcome(approve(database, client, antrag_id, als=OWNER, berechtigungen_antraege_collection=racing))
        racing.assert_landed_inside(serially=1)
        grants = await database[Collection.BERECHTIGUNGEN].find({"adresse": NEU}).to_list()
        return racing.rival_outcome, approved, [grant["granted_by"] for grant in grants], len(await antraege(database))

    return on_a_league(url, body)


async def approved_by_bernd(database: AsyncDatabase, client: AsyncMongoClient, approval_request_id: ObjectId) -> Any:
    return await approve(database, client, approval_request_id, als=BERND)


async def refused_by_bernd(database: AsyncDatabase, client: AsyncMongoClient, approval_request_id: ObjectId) -> Any:
    return await refuse(database, client, approval_request_id, als=BERND)


async def annas_grant_revoked(database: AsyncDatabase, client: AsyncMongoClient, _: ObjectId) -> Any:
    return await revoke(database, client, ANNA_ID)


async def anna_geloescht(database: AsyncDatabase, client: AsyncMongoClient, _: ObjectId) -> Any:
    """The erasure's request step on its own transaction, as `loeschen_everything` runs it for Anna."""

    async def step(session: AsyncClientSession) -> int:
        return await loeschen_antraege_in_session(
            berechtigungen_antraege_collection=database[Collection.BERECHTIGUNGEN_ANTRAEGE],
            postausgang_collection=database[Collection.POSTAUSGANG],
            identifier=ANNA,
            now=NOW,
            session=session,
        )

    async with transaction_session(client) as session:
        return await session.with_transaction(step)


class TestTheRacesEndInOneState:
    """Each pair meets on the request the decision removes or on the grants it anchors, and the second is judged again."""

    def test_two_approvals_make_one_grant(self, mongo_replica_set_url: str):
        assert raced(mongo_replica_set_url, approved_by_bernd) == (COMMITTED, NOT_FOUND, [BERND], 0)

    def test_a_refusal_beside_an_approval_leaves_no_grant(self, mongo_replica_set_url: str):
        assert raced(mongo_replica_set_url, refused_by_bernd) == (COMMITTED, NOT_FOUND, [], 0)

    def test_the_requesters_loeschung_beside_an_approval_leaves_no_grant(self, mongo_replica_set_url: str):
        assert raced(mongo_replica_set_url, anna_geloescht) == (COMMITTED, NOT_FOUND, [], 0)

    def test_the_requesters_revoke_beside_an_approval_leaves_no_grant(self, mongo_replica_set_url: str):
        """Refused rather than removed: the request stands for an administrator to refuse, as one its requester left does."""

        assert raced(mongo_replica_set_url, annas_grant_revoked) == (COMMITTED, Code.GRANT_APPROVAL_REQUEST_LAPSED, [], 1)


class TestTheRefusalIsJournalled:
    """A restore from before a refusal or a withdrawal brings the request back only until its replay."""

    @pytest.mark.parametrize(
        ("als", "art"), [pytest.param(BERND, "antrag_abgelehnt", id="refused"), pytest.param(ANNA, "antrag_zurueckgezogen", id="withdrawn")]
    )
    def test_the_decision_writes_one_line_naming_the_request(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture, als: str, art: str
    ):
        """Its own art each: the replay tells the requester again of a refusal, and of a withdrawal nobody."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            antrag_id = await asked_for(database, client)
            with journal_of(caplog) as lines:
                await refuse(database, client, antrag_id, als=als)
            return antrag_id, [(line.art, line.collection, line.record_id) for line in lines]

        antrag_id, lines = on_a_league(mongo_replica_set_url, body)

        assert lines == [(art, Collection.BERECHTIGUNGEN_ANTRAEGE, antrag_id)]

    def test_a_refusal_refused_and_an_approval_write_none(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A refused press rolled back, and an approval leaves its grant, which a restore takes back with the request."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await tier(database, client, BERND_ID)
            (antrag,) = await antraege(database)
            with journal_of(caplog) as lines:
                refused = await outcome(refuse(database, client, antrag["_id"], als=BERND))
                await approve(database, client, antrag["_id"], als=ANNA)
            return refused, lines

        assert on_a_league(mongo_replica_set_url, body, grants=TWO_OWNERS) == (Code.GRANT_APPROVAL_DENIED, [])

    def test_the_replay_removes_the_request_a_restore_brought_back_and_leaves_a_lapsed_one(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            antrag_id = await asked_for(database, client)
            (snapshot,) = await antraege(database)
            with journal_of(caplog) as lines:
                await refuse(database, client, antrag_id, als=BERND)
            (line,) = lines
            window = Window(since=NOW - timedelta(hours=1), until=NOW + timedelta(hours=1))

            async def planned(now: datetime) -> Any:
                return await plan_replay(line, database, key=CONFIG.sperrliste_schluessel, session=None, now=now, window=window)

            standings = []
            await database[Collection.BERECHTIGUNGEN_ANTRAEGE].insert_one(dict(snapshot))
            for _ in range(2):
                plan = await planned(NOW)
                standings.append(plan.stand)
                if plan.rewrite is not None:
                    async with transaction_session(client) as session:
                        await session.with_transaction(plan.rewrite)
            await database[Collection.BERECHTIGUNGEN_ANTRAEGE].insert_one(dict(snapshot))
            standings.append((await planned(NOW + timedelta(days=GENEHMIGUNG_TAGE, hours=1))).stand)
            return standings

        assert on_a_league(mongo_replica_set_url, body) == ["to replay", "no such record", "already done"]


class TestTheReplayEndsTheRestoredRequest:
    """A restore brings back the request and its approvers' notice; the replay removes the one and settles the other."""

    @pytest.mark.parametrize(
        "end",
        [
            pytest.param("refused", id="a refusal"),
            pytest.param("withdrawn", id="a withdrawal"),
            pytest.param("ended", id="an address change's end"),
        ],
    )
    def test_from_a_snapshot_before_the_end(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture, end: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            antrag_id = await asked_for(database, client)
            # The snapshot: the request and its approvers' notice, still queued.
            snapshot = {
                collection: await database[collection].find({}).to_list()
                for collection in (Collection.BERECHTIGUNGEN_ANTRAEGE, Collection.POSTAUSGANG)
            }
            with journal_of(caplog) as lines:
                if end == "ended":
                    # The effect's own line for the request it ends, as `take_effect_in_session` notes it.
                    (antrag,) = await ended(database, client, NEU)
                    lines.append(antrag_line(antrag=antrag, art="antrag_beendet", am=log_stamp(NOW), key=CONFIG.sperrliste_schluessel))
                else:
                    await refuse(database, client, antrag_id, als=BERND if end == "refused" else ANNA)
            (line,) = lines
            for collection, rows in snapshot.items():
                await database[collection].delete_many({})
                await database[collection].insert_many(rows)
            window = Window(since=NOW - timedelta(hours=1), until=NOW + timedelta(hours=1))
            plan = await plan_replay(line, database, key=CONFIG.sperrliste_schluessel, session=None, now=NOW, window=window)
            assert plan.rewrite is not None
            async with transaction_session(client) as session:
                await session.with_transaction(plan.rewrite)
            return await antraege(database), await asked(database)

        assert on_a_league(mongo_replica_set_url, body) == ([], [])


class TestTheLoeschungTakesEveryRequestOfTheAddress:
    """A request outlives neither its subject nor its requester, lapsed or not."""

    def test_a_request_about_the_address_and_every_one_made_by_it_go_imageless(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await asked_for(database, client)
            await asked_for(database, client, email="zweite@beispielschule.de", als=BERND)
            await database[Collection.BERECHTIGUNGEN_ANTRAEGE].insert_one(
                compose_antrag(
                    adresse="dritte@beispielschule.de",
                    verwaltung="administration",
                    grant_id=None,
                    started_by=ANNA,
                    now=NOW - timedelta(days=GENEHMIGUNG_TAGE + 1),
                )
            )
            before = await database[Collection.AKTIONEN].count_documents({})

            async def step(session: AsyncClientSession) -> list[int]:
                collection = database[Collection.BERECHTIGUNGEN_ANTRAEGE]
                return [
                    await loeschen_antraege_in_session(
                        berechtigungen_antraege_collection=collection,
                        postausgang_collection=database[Collection.POSTAUSGANG],
                        identifier=identifier,
                        now=NOW,
                        session=session,
                    )
                    for identifier in (ANNA, "zweite@beispielschule.de")
                ]

            async with transaction_session(client) as session:
                geloescht = await session.with_transaction(step)
            logged = await database[Collection.AKTIONEN].find({}, sort=[("_id", 1)]).skip(before).to_list()
            return geloescht, await antraege(database), [(row["operation"], row.get("before")) for row in logged]

        # Anna's own request and the lapsed one she made, then the request about the second address: one log row per
        # removal, neither holding an image.
        assert on_a_league(mongo_replica_set_url, body) == ([2, 1], [], [("erase_many", None), ("erase_many", None)])


class TestTheAddressMoveIsNoNewGrant:
    """An administrator's address change moves their grant on its own approval, asking nobody again."""

    def test_the_moved_grant_writes_no_request(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start_the_change(database, client)
            await approve_the_change(database, client, minted.id, operator=SECOND_ADMIN)
            await answer_the_change(database, client, minted.token)
            return await tiers(database), await antraege(database)

        moved, rows = on_a_person(mongo_replica_set_url, DATABASE_NAME, body)

        assert (EMAIL in moved, moved.get(NEW_EMAIL), rows) == (False, "administration", [])


MOVER_ID = ObjectId("6890a1b2c3d4e5f607920005")
# On the real clock, as the tenure cases are: the actor's session, a minute old, postdates the grant the move makes.
MOVED_AGO = 1800


async def move(database: AsyncDatabase, client: AsyncMongoClient, *, at: datetime) -> None:
    minted = await start_the_change(database, client, germany_now=at)
    await approve_the_change(database, client, minted.id, germany_now=at)
    await answer_the_change(database, client, minted.token, germany_now=at)


class TestAMovedAdministratorKeepsTheirStanding:
    """The four-eyes rule dates the person, so their own address change keeps their since-when.

    `EMAIL`'s grant predates the request asked an hour ago; the move half an hour ago grants `NEW_EMAIL` afresh after it.
    """

    def test_they_are_asked_for_and_approve_a_request_made_before_their_move(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BERECHTIGUNGEN].insert_one(grant_document(MOVER_ID, EMAIL, "administration"))
            # Found by a pass before the request, or the request would date every pasted grant from its own find.
            await compared(database, client, now=since(2 * ASKED_AN_HOUR_AGO))
            antrag_id = await asked_for(database, client, als=SECOND_ADMIN, now=since(ASKED_AN_HOUR_AGO))
            await move(database, client, at=since(MOVED_AGO))
            ((_, _, an),) = await asked(database)
            approved = await outcome(approve(database, client, antrag_id, als=NEW_EMAIL, now=since(60)))
            return an, approved, NEU in await tiers(database)

        an, approved, granted_now = on_a_person(mongo_replica_set_url, DATABASE_NAME, body)

        assert (NEW_EMAIL in an, EMAIL in an, approved, granted_now) == (True, False, COMMITTED, True)

    def test_their_own_request_made_before_their_move_stays_approvable(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BERECHTIGUNGEN].insert_one(grant_document(MOVER_ID, EMAIL, "administration"))
            antrag_id = await asked_for(database, client, als=EMAIL, now=since(ASKED_AN_HOUR_AGO))
            await move(database, client, at=since(MOVED_AGO))
            return await outcome(approve(database, client, antrag_id, als=SECOND_ADMIN, now=since(60))), NEU in await tiers(database)

        assert on_a_person(mongo_replica_set_url, DATABASE_NAME, body) == (COMMITTED, True)


async def ended(database: AsyncDatabase, client: AsyncMongoClient, adresse: str) -> list[Mapping[str, Any]]:
    """The address change's step ending every request about `adresse`, on its own transaction as the effect runs it."""

    async def step(session: AsyncClientSession) -> list[Mapping[str, Any]]:
        return await end_the_antraege_about_in_session(
            berechtigungen_antraege_collection=database[Collection.BERECHTIGUNGEN_ANTRAEGE],
            postausgang_collection=database[Collection.POSTAUSGANG],
            adresse=adresse,
            now=NOW,
            session=session,
        )

    async with transaction_session(client) as session:
        return await session.with_transaction(step)
