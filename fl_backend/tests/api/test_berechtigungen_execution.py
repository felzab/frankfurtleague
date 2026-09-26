"""
API · the grants: what a grant and a revoke store, the four refusals, the races the anchor closes, and the reconciliation

Against a replica set, every write here running in a transaction. The grant and the revoke are
called as handlers, the actor bound as `bind_actor` binds it; one case goes through the mounted
route, which is what reads a request's actor against the grants.
"""

from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.berechtigungen.admin_router import delete_berechtigung, get_berechtigungen, post_berechtigung
from app.api.berechtigungen.schemas import (
    FLBerechtigungAbgleichResponse,
    FLBerechtigungAngekuendigtPayload,
    FLBerechtigungAnkuendigung,
    FLBerechtigungEintragPayload,
    FLPostBerechtigungPayload,
)
from app.api.berechtigungen.services import BERECHTIGUNG_GESPERRT, BERECHTIGUNG_INHABER, BERECHTIGUNG_MINDESTZAHL, BERECHTIGUNG_VORHANDEN
from app.api.berechtigungen.sweep_router import post_berechtigungen_abgleich, post_berechtigungen_angekuendigt
from app.api.sperrliste.admin_router import delete_sperrliste_eintrag, post_sperrliste_eintrag
from app.api.sperrliste.schemas import FLPostSperrlistePayload
from app.api.sperrliste.services import SPERRLISTE_VERWALTUNG
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.exceptions import DocumentNotFoundException, WriteRefusalException
from app.core.recording import SYSTEM_ACTOR, Actor, actor_var
from app.core.security import ACTOR_HEADER, ACTOR_NOT_ADMIN
from tests.app_client import app_client
from tests.config import ADMIN_AUTH
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import rules_document, saison_document
from tests.isolation import COMMITTED, outcome_of
from tests.worker import worker_database

from .conftest import config_for

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_berechtigungen_test")

CONFIG = config_for(DATABASE_NAME)

NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
TODAY = "2026-04-01"

# The three grants every case starts from: an `owner`, and two administrators, so a revoke of one
# leaves the floor and a revoke of both does not.
OWNER_ID = ObjectId("6890a1b2c3d4e5f607910001")
ANNA_ID = ObjectId("6890a1b2c3d4e5f607910002")
BERND_ID = ObjectId("6890a1b2c3d4e5f607910003")
OWNER = "inhaberin@frankfurtleague.de"
ANNA = "anna.admin@frankfurtleague.de"
BERND = "bernd.admin@frankfurtleague.de"

# Who acts in every case: an administrator holding a grant, as the mounted route demands.
ACTOR = ANNA

# An address the league grants in the cases below, in a spelling the fold changes.
NEU_TYPED = "Nora.Neu@Beispielschule.de"
NEU = "nora.neu@beispielschule.de"

GRUND = "Wiederholt gemeldet"

RUNNING = "2026"

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def grant_document(grant_id: ObjectId, adresse: str, verwaltung: str) -> dict[str, Any]:
    """As the Playground paste writes one."""

    return {
        "_id": grant_id,
        "adresse": adresse,
        "verwaltung": verwaltung,
        "erteilt_von": "PLAYGROUND",
        "erteilt_am": datetime(2026, 1, 1, tzinfo=UTC),
    }


def the_three_grants() -> list[dict[str, Any]]:
    return [
        grant_document(OWNER_ID, OWNER, "owner"),
        grant_document(ANNA_ID, ANNA, "administration"),
        grant_document(BERND_ID, BERND, "administration"),
    ]


def on_a_league(url: str, body: Body, *, grants: list[dict[str, Any]] | None = None) -> Any:
    """The shipped validators and indexes, a season running, and the grants; the actor bound as `bind_actor` binds a request's."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(
                saison_document(RUNNING, "active", rules=rules_document(number_of_groups=2, erlaubte_stufen=["E1"]))
            )
            await database[Collection.BERECHTIGUNGEN].insert_many(the_three_grants() if grants is None else grants)

            token = actor_var.set(Actor(kind="admin_session", email=ACTOR))
            try:
                return await body(database, client)
            finally:
                actor_var.reset(token)

    return on_the_seed_loop(_run())


async def grant(database: AsyncDatabase, client: AsyncMongoClient, email: str = NEU_TYPED, *, berechtigungen: Any = None) -> ObjectId:
    created = await post_berechtigung(
        berechtigung_data=FLPostBerechtigungPayload(email=email),
        berechtigungen_collection=berechtigungen if berechtigungen is not None else database[Collection.BERECHTIGUNGEN],
        sperrliste_collection=database[Collection.SPERRLISTE],
        saisons_collection=database[Collection.SAISONS],
        db=client,
        config=CONFIG,
        erteilt_von=ACTOR,
        now=NOW,
    )

    return created.created_id


async def revoke(database: AsyncDatabase, client: AsyncMongoClient, grant_id: ObjectId, *, berechtigungen: Any = None) -> None:
    await delete_berechtigung(
        berechtigung_id=grant_id,
        berechtigungen_collection=berechtigungen if berechtigungen is not None else database[Collection.BERECHTIGUNGEN],
        db=client,
    )


async def ban(database: AsyncDatabase, client: AsyncMongoClient, email: str = NEU_TYPED, *, berechtigungen: Any = None) -> Any:
    return await post_sperrliste_eintrag(
        sperrliste_data=FLPostSperrlistePayload(email=email, grund=GRUND),
        sperrliste_collection=database[Collection.SPERRLISTE],
        saisons_collection=database[Collection.SAISONS],
        berechtigungen_collection=berechtigungen if berechtigungen is not None else database[Collection.BERECHTIGUNGEN],
        db=client,
        config=CONFIG,
        erstellt_von=ACTOR,
        today=TODAY,
    )


async def addresses(database: AsyncDatabase) -> list[str]:
    return sorted([str(row["adresse"]) async for row in database[Collection.BERECHTIGUNGEN].find()])


async def refusal_of(call: Awaitable[Any]) -> str:
    with pytest.raises(WriteRefusalException) as raised:
        await call

    return str(raised.value.error_code)


class TestWhatAGrantStores:
    def test_the_row_carries_the_folded_address_the_tier_the_actor_and_the_moment(self, mongo_replica_set_url: str):
        """Folded, or the header check's equality misses the administrator it was granted to."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Mapping[str, Any] | None:
            created = await grant(database, client)

            return await database[Collection.BERECHTIGUNGEN].find_one({"_id": created}, {"_id": 0, "bounded_writes": 0})

        stored = on_a_league(mongo_replica_set_url, body)

        assert stored == {
            "adresse": NEU,
            "verwaltung": "administration",
            "erteilt_von": ACTOR,
            "erteilt_am": NOW.astimezone(UTC).replace(tzinfo=None),
        }

    def test_the_grant_and_the_revoke_are_logged_under_the_administrator(self, mongo_replica_set_url: str):
        """The rows the reconciliation reads the actor off, the revoke's carrying the removed grant as its image."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[tuple[str, str, Any]]:
            created = await grant(database, client)
            await revoke(database, client, created)

            rows = database[Collection.AKTIONEN].find({"collection": str(Collection.BERECHTIGUNGEN), "document_id": created}).sort("_id", 1)

            return [(row["operation"], row["actor"]["email"], (row["before"] or [{}])[0].get("adresse")) async for row in rows]

        assert on_a_league(mongo_replica_set_url, body) == [("insert", ACTOR, None), ("delete_many", ACTOR, NEU)]

    def test_a_revoke_naming_no_grant_is_a_404_and_removes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[str]:
            with pytest.raises(DocumentNotFoundException):
                await revoke(database, client, ObjectId())

            return await addresses(database)

        assert on_a_league(mongo_replica_set_url, body) == sorted([OWNER, ANNA, BERND])

    def test_the_list_serves_every_grant_by_address(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[tuple[str, str]]:
            listed = await get_berechtigungen(berechtigungen_collection=database[Collection.BERECHTIGUNGEN])

            return [(row.adresse, row.verwaltung) for row in listed.berechtigungen]

        assert on_a_league(mongo_replica_set_url, body) == [(ANNA, "administration"), (BERND, "administration"), (OWNER, "owner")]


class TestASecondGrantOfOneAddress:
    """`REQ-BERECHTIGUNG-001`."""

    def test_an_address_granted_already_is_refused_in_another_spelling_and_nothing_is_added(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, list[str]]:
            await grant(database, client)
            refused = await refusal_of(grant(database, client, NEU.upper()))

            return refused, await addresses(database)

        refused, stored = on_a_league(mongo_replica_set_url, body)

        assert refused == BERECHTIGUNG_VORHANDEN
        assert stored == sorted([OWNER, ANNA, BERND, NEU])

    def test_the_owners_address_takes_no_administration_beside_it(self, mongo_replica_set_url: str):
        """The tier is no part of the rule: a second row would leave one address two answers."""

        assert on_a_league(mongo_replica_set_url, lambda database, client: refusal_of(grant(database, client, OWNER))) == BERECHTIGUNG_VORHANDEN


class TestTheOwnersRow:
    """`REQ-BERECHTIGUNG-002`."""

    def test_the_owners_grant_is_revoked_by_no_route_while_an_administrators_is(self, mongo_replica_set_url: str):
        """Beside a revoke that succeeds, so a check refusing every revoke fails here."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, list[str]]:
            refused = await refusal_of(revoke(database, client, OWNER_ID))
            await revoke(database, client, BERND_ID)

            return refused, await addresses(database)

        assert on_a_league(mongo_replica_set_url, body) == (BERECHTIGUNG_INHABER, sorted([OWNER, ANNA]))


class TestAGrantToABarredAddress:
    """`REQ-BERECHTIGUNG-003`, and the ban's `REQ-SPERRLISTE-003` from the other side."""

    def test_a_barred_address_is_granted_nothing_until_the_ban_is_lifted(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, list[str]]:
            banned = await ban(database, client)
            refused = await refusal_of(grant(database, client))
            await delete_sperrliste_eintrag(
                sperrliste_id=ObjectId(banned.created_id), sperrliste_collection=database[Collection.SPERRLISTE], db=client
            )
            await grant(database, client)

            return refused, await addresses(database)

        assert on_a_league(mongo_replica_set_url, body) == (BERECHTIGUNG_GESPERRT, sorted([OWNER, ANNA, BERND, NEU]))

    def test_a_granted_address_takes_no_ban_until_the_grant_is_revoked(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int]:
            refused = await refusal_of(ban(database, client, BERND.upper()))
            await revoke(database, client, BERND_ID)
            await ban(database, client, BERND)

            return refused, await database[Collection.SPERRLISTE].count_documents({})

        assert on_a_league(mongo_replica_set_url, body) == (SPERRLISTE_VERWALTUNG, 1)


class TestTheFloorOfTwo:
    """`REQ-BERECHTIGUNG-004`: two grants stand whatever is revoked, an `owner` grant counted."""

    def test_a_revoke_leaving_one_grant_is_refused_and_one_leaving_two_is_not(self, mongo_replica_set_url: str):
        """The second revoke is the refused one: the first leaves exactly the floor."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, list[str]]:
            await revoke(database, client, BERND_ID)
            refused = await refusal_of(revoke(database, client, ANNA_ID))

            return refused, await addresses(database)

        assert on_a_league(mongo_replica_set_url, body) == (BERECHTIGUNG_MINDESTZAHL, sorted([OWNER, ANNA]))

    def test_an_administrator_steps_down_on_the_same_terms(self, mongo_replica_set_url: str):
        """`ACTOR` revoking its own grant: nothing in the rule reads who asks."""

        assert on_a_league(mongo_replica_set_url, lambda database, client: _revoked_then_listed(database, client, ANNA_ID)) == sorted(
            [OWNER, BERND]
        )


async def _revoked_then_listed(database: AsyncDatabase, client: AsyncMongoClient, grant_id: ObjectId) -> list[str]:
    await revoke(database, client, grant_id)

    return await addresses(database)


class GrantsRunningARivalAfterTheFirstRead:
    """The grants a judging transaction reads, a rival write run once after that read and before its anchor.

    So only the anchor can make the two conflict. Not a subclass: the driver builds a collection off
    a database handle.
    """

    def __init__(self, inner: Any, rival: Callable[[], Awaitable[Any]]) -> None:
        self._inner = inner
        self._rival: Callable[[], Awaitable[Any]] | None = rival
        self.rival_outcome: str | None = None

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    async def aggregate(self, *args: Any, **kwargs: Any) -> Any:
        cursor = await self._inner.aggregate(*args, **kwargs)

        # ONE-SHOT: the retry has to meet what the rival left rather than run it again.
        if self._rival is not None:
            rival, self._rival = self._rival, None
            self.rival_outcome = await outcome_of(rival())

        return cursor


class TestTheAnchorClosesEachRace:
    """Each outcome equals a serial order of the pair; with the anchor gone, both commit and the list breaks its own rule."""

    def test_two_revokes_that_each_leave_the_floor_do_not_both_commit(self, mongo_replica_set_url: str):
        """Three grants, two revokes: either alone leaves two, both together leave the `owner` grant alone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str | None, str, list[str]]:
            racing = GrantsRunningARivalAfterTheFirstRead(database[Collection.BERECHTIGUNGEN], lambda: revoke(database, client, BERND_ID))
            outcome = await outcome_of(revoke(database, client, ANNA_ID, berechtigungen=racing))

            return racing.rival_outcome, outcome, await addresses(database)

        assert on_a_league(mongo_replica_set_url, body) == (COMMITTED, BERECHTIGUNG_MINDESTZAHL, sorted([OWNER, ANNA]))

    def test_a_ban_landing_beside_a_grant_of_its_address_refuses_the_grant(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str | None, str, list[str]]:
            racing = GrantsRunningARivalAfterTheFirstRead(database[Collection.BERECHTIGUNGEN], lambda: ban(database, client))
            outcome = await outcome_of(grant(database, client, berechtigungen=racing))

            return racing.rival_outcome, outcome, await addresses(database)

        assert on_a_league(mongo_replica_set_url, body) == (COMMITTED, BERECHTIGUNG_GESPERRT, sorted([OWNER, ANNA, BERND]))

    def test_a_grant_landing_beside_a_ban_of_its_address_refuses_the_ban(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str | None, str, int]:
            racing = GrantsRunningARivalAfterTheFirstRead(database[Collection.BERECHTIGUNGEN], lambda: grant(database, client))
            outcome = await outcome_of(ban(database, client, berechtigungen=racing))

            return racing.rival_outcome, outcome, await database[Collection.SPERRLISTE].count_documents({})

        assert on_a_league(mongo_replica_set_url, body) == (COMMITTED, SPERRLISTE_VERWALTUNG, 0)


async def reconciled(database: AsyncDatabase) -> FLBerechtigungAbgleichResponse:
    return await post_berechtigungen_abgleich(
        berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
        berechtigungen_angekuendigt_collection=database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT],
        aktionen_collection=database[Collection.AKTIONEN],
        sperrliste_collection=database[Collection.SPERRLISTE],
        saisons_collection=database[Collection.SAISONS],
        config=CONFIG,
    )


async def announce(database: AsyncDatabase, client: AsyncMongoClient, answer: FLBerechtigungAbgleichResponse) -> None:
    """What the frontend's pass hands back once it has mailed: each change as the state it announced.

    Under the system actor, as the router's `bind_system_actor` binds it: the cases around this one
    act as an administrator.
    """

    token = actor_var.set(SYSTEM_ACTOR)
    try:
        await _stamped(database, client, answer)
    finally:
        actor_var.reset(token)


async def _stamped(database: AsyncDatabase, client: AsyncMongoClient, answer: FLBerechtigungAbgleichResponse) -> None:
    await post_berechtigungen_angekuendigt(
        angekuendigt_data=FLBerechtigungAngekuendigtPayload(
            aenderungen=[
                FLBerechtigungAnkuendigung(
                    berechtigung_id=change.berechtigung_id,
                    jetzt=None if change.jetzt is None else FLBerechtigungEintragPayload(**change.jetzt.model_dump()),
                )
                for change in answer.aenderungen
            ]
        ),
        berechtigungen_angekuendigt_collection=database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT],
        db=client,
        now=NOW,
    )


def summary(answer: FLBerechtigungAbgleichResponse) -> list[tuple[str, str, str | None]]:
    """Each change's kind, the address it is about, and who made it; a change always carries one of its two states."""

    summarised: list[tuple[str, str, str | None]] = []
    for change in answer.aenderungen:
        state = change.jetzt or change.vorher
        assert state is not None
        summarised.append((change.art, state.adresse, change.geaendert_von))

    return summarised


class TestTheReconciliation:
    def test_grants_the_paste_made_are_each_a_change_made_outside_the_application(self, mongo_replica_set_url: str):
        """Nothing announced and no log row: every grant is new, and none has an administrator to name."""

        answer = on_a_league(mongo_replica_set_url, lambda database, client: reconciled(database))

        assert summary(answer) == [("erteilt", OWNER, None), ("erteilt", ANNA, None), ("erteilt", BERND, None)]
        assert answer.empfaenger == sorted([OWNER, ANNA, BERND])
        assert [change.geaendert_am for change in answer.aenderungen] == [None, None, None]

    def test_once_announced_nothing_is_left_to_tell(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Any]:
            await announce(database, client, await reconciled(database))

            return (await reconciled(database)).aenderungen

        assert on_a_league(mongo_replica_set_url, body) == []

    def test_a_grant_and_a_revoke_made_here_name_the_administrator_who_made_them(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[list[Any], list[bool]]:
            await announce(database, client, await reconciled(database))
            await grant(database, client)
            await revoke(database, client, BERND_ID)
            answer = await reconciled(database)

            return summary(answer), [change.geaendert_am is not None for change in answer.aenderungen]

        # Id order, the grant's id minted after the seeded ones.
        assert on_a_league(mongo_replica_set_url, body) == ([("entzogen", BERND, ACTOR), ("erteilt", NEU, ACTOR)], [True, True])

    def test_edits_made_in_the_database_directly_are_changes_nobody_made_here(self, mongo_replica_set_url: str):
        """A tier changed by hand and a row deleted by hand: the second leaves no trace in the grants at all."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Any]:
            await announce(database, client, await reconciled(database))
            await database[Collection.BERECHTIGUNGEN].update_one({"_id": ANNA_ID}, {"$set": {"verwaltung": "owner"}})
            await database[Collection.BERECHTIGUNGEN].delete_one({"_id": BERND_ID})

            return summary(await reconciled(database))

        assert on_a_league(mongo_replica_set_url, body) == [("geaendert", ANNA, None), ("entzogen", BERND, None)]

    def test_a_revoke_and_a_regrant_of_one_address_are_two_changes(self, mongo_replica_set_url: str):
        """Keyed on the address they would cancel out, and nobody would be told either happened."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Any]:
            await announce(database, client, await reconciled(database))
            await revoke(database, client, BERND_ID)
            await grant(database, client, BERND)

            return summary(await reconciled(database))

        assert on_a_league(mongo_replica_set_url, body) == [("entzogen", BERND, ACTOR), ("erteilt", BERND, ACTOR)]

    def test_the_stamp_records_what_was_announced_rather_than_what_stands_by_then(self, mongo_replica_set_url: str):
        """A grant revoked between the pass's read and its stamp is announced as granted, so the next pass tells of the revoke."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Any]:
            await announce(database, client, await reconciled(database))
            created = await grant(database, client)
            told = await reconciled(database)
            await revoke(database, client, created)
            await announce(database, client, told)

            return summary(await reconciled(database))

        assert on_a_league(mongo_replica_set_url, body) == [("entzogen", NEU, ACTOR)]

    def test_the_stamp_is_logged_under_the_system_actor(self, mongo_replica_set_url: str):
        """So an announcement of a change nobody made here still leaves a row saying when it was told."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[tuple[str, str]]:
            await announce(database, client, await reconciled(database))
            rows = database[Collection.AKTIONEN].find({"collection": str(Collection.BERECHTIGUNGEN_ANGEKUENDIGT)}).sort("_id", 1)

            return [(row["operation"], row["actor"]["kind"]) async for row in rows]

        assert on_a_league(mongo_replica_set_url, body) == [("delete_many", "system"), ("insert_many", "system")]

    def test_a_barred_address_the_paste_granted_is_flagged(self, mongo_replica_set_url: str):
        """The one route to a granted, barred address, since each write refuses the other."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[tuple[str, bool]]:
            await announce(database, client, await reconciled(database))
            await ban(database, client)
            await database[Collection.BERECHTIGUNGEN].insert_one(grant_document(ObjectId(), NEU, "administration"))

            return [(change.jetzt.adresse, change.gesperrt) for change in (await reconciled(database)).aenderungen if change.jetzt]

        assert on_a_league(mongo_replica_set_url, body) == [(NEU, True)]


class TestTheMountedRouteReadsTheGrants:
    """`app/core/security.py :: verify_actor_is_admin` against a real collection, where every other case calls the handler past it."""

    @pytest.mark.parametrize(
        ("actor", "status"),
        [
            pytest.param(ACTOR.upper(), 200, id="a grant, the header in capitals"),
            pytest.param(OWNER, 200, id="an owner"),
            pytest.param(NEU, 403, id="no grant"),
        ],
    )
    def test_an_actor_is_admitted_exactly_where_a_grant_names_it(self, mongo_replica_set_url: str, actor: str, status: int):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, str | None]:
            async with app_client(mongo_replica_set_url, config=CONFIG) as http:
                response = await http.get(f"/api/v{API_VERSION}/berechtigungen", headers={**ADMIN_AUTH, ACTOR_HEADER: actor})

            return response.status_code, response.json().get("error_code")

        assert on_a_league(mongo_replica_set_url, body) == (status, None if status == 200 else ACTOR_NOT_ADMIN)

    def test_a_revoked_administrator_is_refused_on_the_very_next_request(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[int]:
            async with app_client(mongo_replica_set_url, config=CONFIG) as http:
                headers = {**ADMIN_AUTH, ACTOR_HEADER: BERND}
                before = await http.get(f"/api/v{API_VERSION}/berechtigungen", headers=headers)
                revoked = await http.delete(f"/api/v{API_VERSION}/berechtigungen/{BERND_ID}", headers={**ADMIN_AUTH, ACTOR_HEADER: ANNA})
                after = await http.get(f"/api/v{API_VERSION}/berechtigungen", headers=headers)

            return [before.status_code, revoked.status_code, after.status_code]

        assert on_a_league(mongo_replica_set_url, body) == [200, 200, 403]
