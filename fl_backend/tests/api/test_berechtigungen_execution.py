"""
API · the grants: what a grant and a revoke store and queue, the six refusals, the races the anchor closes, and the claim

Against a replica set, every write here running in a transaction. The handlers are called directly,
the actor bound as `bind_actor` binds it; the mounted route is what reads a request's actor, and one
class goes through it.
"""

from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase

from app.api.berechtigungen.admin_router import delete_berechtigung, get_berechtigungen, patch_berechtigung, post_berechtigung
from app.api.berechtigungen.schemas import (
    FLBerechtigungAbgleichResponse,
    FLBerechtigungAngekuendigtPayload,
    FLBerechtigungStand,
    FLPatchBerechtigungPayload,
    FLPostBerechtigungPayload,
)
from app.api.berechtigungen.services import (
    BEANSPRUCHUNG_DAUER,
    BERECHTIGUNG_GESPERRT,
    BERECHTIGUNG_INHABER,
    BERECHTIGUNG_LETZTER_INHABER,
    BERECHTIGUNG_MINDESTZAHL,
    BERECHTIGUNG_NUR_INHABER,
    BERECHTIGUNG_OHNE_ZUGANG,
    BERECHTIGUNG_VORHANDEN,
    compose_postausgang,
)
from app.api.berechtigungen.sweep_router import post_berechtigungen_abgleich, post_berechtigungen_angekuendigt
from app.api.sperrliste.admin_router import delete_sperrliste_eintrag, post_sperrliste_eintrag
from app.api.sperrliste.schemas import FLPostSperrlistePayload
from app.api.sperrliste.services import SPERRLISTE_SCHLUESSEL_VERSION, SPERRLISTE_VERWALTUNG, adresse_hash
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.exceptions import DocumentNotFoundException, WriteRefusalException
from app.core.recording import SYSTEM_ACTOR, Actor, actor_var
from app.core.security import ACTOR_NOT_ADMIN, get_grant_lookup
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from tests.actor_tokens import SignedActor
from tests.app_client import app_client
from tests.config import ADMIN_KEY, SYSTEM_AUTH
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
DEAD_ID = ObjectId("6890a1b2c3d4e5f607910004")
OWNER = "inhaberin@frankfurtleague.de"
ANNA = "anna.admin@frankfurtleague.de"
BERND = "bernd.admin@frankfurtleague.de"

# Folded and equal to itself, and refused by the address rule: a row no request can match.
DEAD_OWNER = "jürgen@frankfurtleague.de"

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


def a_ban_row(adresse: str) -> dict[str, Any]:
    """A standing ban as the ban write stores one, for an address no ban route would take today."""

    return {
        "adresse_hash": adresse_hash(adresse, schluessel=CONFIG.sperrliste_schluessel),
        "schluessel_version": SPERRLISTE_SCHLUESSEL_VERSION,
        "grund": GRUND,
        "erstellt_von": OWNER,
        "erstellt_am": TODAY,
        "gesperrt_bis_saison_id": "2031",
    }


def on_a_league(url: str, body: Body, *, grants: list[dict[str, Any]] | None = None) -> Any:
    """The shipped validators and indexes, a season running, and the grants."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(
                saison_document(RUNNING, "active", rules=rules_document(number_of_groups=2, erlaubte_stufen=["E1"]))
            )
            await database[Collection.BERECHTIGUNGEN].insert_many(the_three_grants() if grants is None else grants)

            return await body(database, client)

    return on_the_seed_loop(_run())


async def acting(actor: Any, call: Callable[[], Awaitable[Any]]) -> Any:
    """`call` with the actor bound as its binder binds it, and unbound afterwards."""

    token = actor_var.set(actor)
    try:
        return await call()
    finally:
        actor_var.reset(token)


async def grant(
    database: AsyncDatabase, client: AsyncMongoClient, email: str = NEU_TYPED, *, als: str = ANNA, berechtigungen: Any = None
) -> ObjectId:
    async def call() -> Any:
        return await post_berechtigung(
            berechtigung_data=FLPostBerechtigungPayload(email=email),
            berechtigungen_collection=berechtigungen if berechtigungen is not None else database[Collection.BERECHTIGUNGEN],
            berechtigungen_angekuendigt_collection=database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT],
            berechtigungen_postausgang_collection=database[Collection.BERECHTIGUNGEN_POSTAUSGANG],
            sperrliste_collection=database[Collection.SPERRLISTE],
            saisons_collection=database[Collection.SAISONS],
            db=client,
            config=CONFIG,
            erteilt_von=als,
            now=NOW,
        )

    return (await acting(Actor(kind="admin_session", email=als), call)).created_id


async def revoke(
    database: AsyncDatabase, client: AsyncMongoClient, grant_id: ObjectId, *, als: str = OWNER, berechtigungen: Any = None
) -> None:
    async def call() -> Any:
        return await delete_berechtigung(
            berechtigung_id=grant_id,
            berechtigungen_collection=berechtigungen if berechtigungen is not None else database[Collection.BERECHTIGUNGEN],
            berechtigungen_angekuendigt_collection=database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT],
            berechtigungen_postausgang_collection=database[Collection.BERECHTIGUNGEN_POSTAUSGANG],
            sperrliste_collection=database[Collection.SPERRLISTE],
            saisons_collection=database[Collection.SAISONS],
            db=client,
            config=CONFIG,
            entzogen_von=als,
            now=NOW,
        )

    await acting(Actor(kind="admin_session", email=als), call)


async def change(
    database: AsyncDatabase, client: AsyncMongoClient, grant_id: ObjectId, verwaltung: str, *, als: str = OWNER, berechtigungen: Any = None
) -> None:
    """The tier change, as the route runs it past its guards."""

    async def call() -> Any:
        return await patch_berechtigung(
            berechtigung_id=grant_id,
            berechtigung_data=FLPatchBerechtigungPayload.model_validate({"verwaltung": verwaltung}),
            berechtigungen_collection=berechtigungen if berechtigungen is not None else database[Collection.BERECHTIGUNGEN],
            berechtigungen_angekuendigt_collection=database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT],
            berechtigungen_postausgang_collection=database[Collection.BERECHTIGUNGEN_POSTAUSGANG],
            sperrliste_collection=database[Collection.SPERRLISTE],
            saisons_collection=database[Collection.SAISONS],
            db=client,
            config=CONFIG,
            geaendert_von=als,
            now=NOW,
        )

    await acting(Actor(kind="admin_session", email=als), call)


async def tiers(database: AsyncDatabase) -> dict[str, str]:
    return {str(row["adresse"]): str(row["verwaltung"]) async for row in database[Collection.BERECHTIGUNGEN].find()}


async def a_second_owner(database: AsyncDatabase) -> None:
    """Anna an owner too, as a paste makes one, so a case starts from two."""

    await database[Collection.BERECHTIGUNGEN].update_one({"_id": ANNA_ID}, {"$set": {"verwaltung": "owner"}})


async def ban(database: AsyncDatabase, client: AsyncMongoClient, email: str = NEU_TYPED, *, als: str = ANNA, berechtigungen: Any = None) -> Any:
    async def call() -> Any:
        return await post_sperrliste_eintrag(
            sperrliste_data=FLPostSperrlistePayload(email=email, grund=GRUND),
            sperrliste_collection=database[Collection.SPERRLISTE],
            saisons_collection=database[Collection.SAISONS],
            berechtigungen_collection=berechtigungen if berechtigungen is not None else database[Collection.BERECHTIGUNGEN],
            berechtigungen_postausgang_collection=database[Collection.BERECHTIGUNGEN_POSTAUSGANG],
            db=client,
            config=CONFIG,
            erstellt_von=als,
            today=TODAY,
        )

    return await acting(Actor(kind="admin_session", email=als), call)


async def queued(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    """The outbox as stored, which is what a later stamp copies into the log."""

    return [row async for row in database[Collection.BERECHTIGUNGEN_POSTAUSGANG].find({}, {"_id": 0}).sort("erfasst_am", 1)]


class Aborting:
    """A collection whose named method runs, then raises: the transaction around it aborts after that write.

    Not a subclass: the driver builds a collection off a database handle, so every other call delegates.
    """

    def __init__(self, inner: Any, method: str) -> None:
        self._inner = inner
        self._method = method

    def __getattr__(self, name: str) -> Any:
        attribute = getattr(self._inner, name)
        if name != self._method:
            return attribute

        async def wrapped(*args: Any, **kwargs: Any) -> Any:
            await attribute(*args, **kwargs)
            raise RuntimeError("aborted after the write")

        return wrapped


async def addresses(database: AsyncDatabase) -> list[str]:
    return sorted([str(row["adresse"]) async for row in database[Collection.BERECHTIGUNGEN].find()])


async def refusal_of(call: Awaitable[Any]) -> str:
    with pytest.raises(WriteRefusalException) as raised:
        await call

    return str(raised.value.error_code)


async def claimed(
    database: AsyncDatabase, client: AsyncMongoClient, *, now: datetime = NOW, berechtigungen: Any = None
) -> FLBerechtigungAbgleichResponse:
    async def call() -> FLBerechtigungAbgleichResponse:
        return await post_berechtigungen_abgleich(
            berechtigungen_collection=berechtigungen if berechtigungen is not None else database[Collection.BERECHTIGUNGEN],
            berechtigungen_angekuendigt_collection=database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT],
            berechtigungen_postausgang_collection=database[Collection.BERECHTIGUNGEN_POSTAUSGANG],
            sperrliste_collection=database[Collection.SPERRLISTE],
            saisons_collection=database[Collection.SAISONS],
            db=client,
            config=CONFIG,
            now=now,
        )

    return await acting(SYSTEM_ACTOR, call)


async def stamped(database: AsyncDatabase, client: AsyncMongoClient, beanspruchung: str, ids: list[ObjectId]) -> tuple[int, int]:
    async def call() -> Any:
        return await post_berechtigungen_angekuendigt(
            angekuendigt_data=FLBerechtigungAngekuendigtPayload(beanspruchung=beanspruchung, ids=ids),
            berechtigungen_postausgang_collection=database[Collection.BERECHTIGUNGEN_POSTAUSGANG],
            db=client,
        )

    answer = await acting(SYSTEM_ACTOR, call)

    return answer.angekuendigt, answer.ignoriert


async def told(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    """One whole pass: claim, then stamp everything claimed."""

    answer = await claimed(database, client)
    if answer.beanspruchung is not None:
        await stamped(database, client, answer.beanspruchung, [change.id for change in answer.aenderungen])


def summary(answer: FLBerechtigungAbgleichResponse) -> list[tuple[str, str | None, str | None]]:
    """Each change's kind, the address it is about, and who made it."""

    summarised: list[tuple[str, str | None, str | None]] = []
    for change in answer.aenderungen:
        state = change.jetzt or change.vorher
        assert state is not None
        summarised.append((change.art, state.adresse, change.geaendert_von))

    return summarised


class TestWhatAGrantStoresAndQueues:
    def test_the_row_carries_the_folded_address_the_tier_the_actor_and_the_moment(self, mongo_replica_set_url: str):
        """Folded, or the header check's equality misses the administrator it was granted to."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Mapping[str, Any] | None:
            created = await grant(database, client)

            return await database[Collection.BERECHTIGUNGEN].find_one({"_id": created}, {"_id": 0, "bounded_writes": 0})

        stored = on_a_league(mongo_replica_set_url, body)

        assert stored == {
            "adresse": NEU,
            "verwaltung": "administration",
            "erteilt_von": ANNA,
            "erteilt_am": NOW.astimezone(UTC).replace(tzinfo=None),
        }

    def test_a_grant_and_a_revoke_made_here_each_queue_their_notice_as_they_happened(self, mongo_replica_set_url: str):
        """Revoked before any pass ran, the grant is announced all the same, its outbox row written with it (`docs/backend/spec.md :: I451`)."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Any]:
            await told(database, client)
            created = await grant(database, client)
            await revoke(database, client, created)

            return summary(await claimed(database, client))

        assert on_a_league(mongo_replica_set_url, body) == [("erteilt", NEU, ANNA), ("entzogen", NEU, OWNER)]

    def test_the_grant_and_the_revoke_are_logged_under_the_administrator_who_made_them(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[tuple[str, str]]:
            created = await grant(database, client)
            await revoke(database, client, created)
            rows = database[Collection.AKTIONEN].find({"collection": str(Collection.BERECHTIGUNGEN), "document_id": created}).sort("_id", 1)

            return [(row["operation"], row["actor"]["email"]) async for row in rows]

        assert on_a_league(mongo_replica_set_url, body) == [("insert", ANNA), ("delete_many", OWNER)]

    def test_a_revoke_naming_no_grant_is_a_404_and_removes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[str]:
            with pytest.raises(DocumentNotFoundException):
                await revoke(database, client, ObjectId())

            return await addresses(database)

        assert on_a_league(mongo_replica_set_url, body) == sorted([OWNER, ANNA, BERND])


class TestTheOutboxMovesWithItsChange:
    """`docs/backend/spec.md :: I451`: a notice written outside its change's transaction survives the change's abort."""

    def test_a_grant_that_aborts_after_its_notice_leaves_neither(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, int]:
            async def call() -> Any:
                return await post_berechtigung(
                    berechtigung_data=FLPostBerechtigungPayload(email=NEU_TYPED),
                    berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
                    berechtigungen_angekuendigt_collection=database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT],
                    berechtigungen_postausgang_collection=cast(
                        AsyncCollection, Aborting(database[Collection.BERECHTIGUNGEN_POSTAUSGANG], "insert_one")
                    ),
                    sperrliste_collection=database[Collection.SPERRLISTE],
                    saisons_collection=database[Collection.SAISONS],
                    db=client,
                    config=CONFIG,
                    erteilt_von=ANNA,
                    now=NOW,
                )

            with pytest.raises(RuntimeError):
                await acting(Actor(kind="admin_session", email=ANNA), call)

            return (
                await database[Collection.BERECHTIGUNGEN].count_documents({"adresse": NEU}),
                await database[Collection.BERECHTIGUNGEN_POSTAUSGANG].count_documents({}),
            )

        assert on_a_league(mongo_replica_set_url, body) == (0, 0)

    def test_a_revoke_that_aborts_at_its_last_write_leaves_the_grant_and_no_notice(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, int]:
            await told(database, client)

            async def call() -> Any:
                return await delete_berechtigung(
                    berechtigung_id=BERND_ID,
                    berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
                    berechtigungen_angekuendigt_collection=cast(
                        AsyncCollection, Aborting(database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT], "delete_many")
                    ),
                    berechtigungen_postausgang_collection=database[Collection.BERECHTIGUNGEN_POSTAUSGANG],
                    sperrliste_collection=database[Collection.SPERRLISTE],
                    saisons_collection=database[Collection.SAISONS],
                    db=client,
                    config=CONFIG,
                    entzogen_von=OWNER,
                    now=NOW,
                )

            with pytest.raises(RuntimeError):
                await acting(Actor(kind="admin_session", email=OWNER), call)

            return (
                await database[Collection.BERECHTIGUNGEN].count_documents({"_id": BERND_ID}),
                await database[Collection.BERECHTIGUNGEN_POSTAUSGANG].count_documents({}),
            )

        assert on_a_league(mongo_replica_set_url, body) == (1, 0)


class TestTheListServesLiveGrantsAlone:
    def test_a_dead_row_is_counted_and_a_barred_address_is_withheld(self, mongo_replica_set_url: str):
        """Both on one list: the three live rows, one of them barred by a ban the Playground grant predates."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[list[tuple[str | None, bool, str]], int]:
            await database[Collection.SPERRLISTE].insert_one(a_ban_row(BERND))
            listed = await get_berechtigungen(
                berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
                sperrliste_collection=database[Collection.SPERRLISTE],
                saisons_collection=database[Collection.SAISONS],
                config=CONFIG,
            )

            return [(row.adresse, row.gesperrt, row.verwaltung) for row in listed.berechtigungen], listed.uebersprungen

        grants = [*the_three_grants(), grant_document(DEAD_ID, "Dora.Tot@Frankfurtleague.de", "administration")]

        assert on_a_league(mongo_replica_set_url, body, grants=grants) == (
            [(ANNA, False, "administration"), (None, True, "administration"), (OWNER, False, "owner")],
            1,
        )

    def test_a_live_grant_with_an_empty_erteilt_von_is_served(self, mongo_replica_set_url: str):
        """A field no reader decides anything from hides no grant, whatever a paste left in it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[tuple[str | None, str | None]]:
            listed = await get_berechtigungen(
                berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
                sperrliste_collection=database[Collection.SPERRLISTE],
                saisons_collection=database[Collection.SAISONS],
                config=CONFIG,
            )

            return [(row.adresse, row.erteilt_von) for row in listed.berechtigungen]

        grants = [*the_three_grants(), {**grant_document(DEAD_ID, NEU, "administration"), "erteilt_von": ""}]

        assert on_a_league(mongo_replica_set_url, body, grants=grants) == [
            (ANNA, "PLAYGROUND"),
            (BERND, "PLAYGROUND"),
            (OWNER, "PLAYGROUND"),
            (NEU, ""),
        ]

    def test_a_barred_granting_administrator_is_withheld_as_erteilt_von(self, mongo_replica_set_url: str):
        """The actor field takes the same withholding as the address, flagged as the address is (`docs/backend/spec.md :: I452`)."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[tuple[str | None, str | None, bool]]:
            await grant(database, client, als=ANNA)
            await revoke(database, client, ANNA_ID)
            await database[Collection.SPERRLISTE].insert_one(a_ban_row(ANNA))
            listed = await get_berechtigungen(
                berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
                sperrliste_collection=database[Collection.SPERRLISTE],
                saisons_collection=database[Collection.SAISONS],
                config=CONFIG,
            )

            return [(row.adresse, row.erteilt_von, row.erteilt_von_gesperrt) for row in listed.berechtigungen]

        assert on_a_league(mongo_replica_set_url, body) == [
            (BERND, "PLAYGROUND", False),
            (OWNER, "PLAYGROUND", False),
            (NEU, None, True),
        ]


class TestASecondGrantOfOneAddress:
    """`REQ-BERECHTIGUNG-001`."""

    def test_an_address_granted_already_is_refused_in_another_spelling_and_nothing_is_added(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, list[str]]:
            await grant(database, client)
            refused = await refusal_of(grant(database, client, NEU.upper()))

            return refused, await addresses(database)

        assert on_a_league(mongo_replica_set_url, body) == (BERECHTIGUNG_VORHANDEN, sorted([OWNER, ANNA, BERND, NEU]))

    def test_the_owners_address_takes_no_administration_beside_it(self, mongo_replica_set_url: str):
        """The tier is no part of the rule: a second row would leave one address two answers."""

        assert on_a_league(mongo_replica_set_url, lambda database, client: refusal_of(grant(database, client, OWNER))) == BERECHTIGUNG_VORHANDEN

    def test_a_dead_spelling_of_the_address_blocks_nothing(self, mongo_replica_set_url: str):
        """The unfolded row admits nobody, so the grant is made beside it rather than refused over it (`docs/backend/spec.md :: I453`)."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[str]:
            await grant(database, client)

            return await addresses(database)

        grants = [*the_three_grants(), grant_document(DEAD_ID, NEU_TYPED, "administration")]

        assert on_a_league(mongo_replica_set_url, body, grants=grants) == sorted([OWNER, ANNA, BERND, NEU, NEU_TYPED])


class TestOnlyAnOwnerRevokes:
    """`REQ-BERECHTIGUNG-005`: judged on the actor's own live grant, read inside the transaction, before anything about the target."""

    def test_an_administrator_revokes_nobody_while_an_owner_revokes_the_same_grant(self, mongo_replica_set_url: str):
        """Beside the owner's revoke that succeeds, so a check refusing every revoke fails here."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, str, list[str]]:
            refused = await refusal_of(revoke(database, client, BERND_ID, als=ANNA))
            unknown = await refusal_of(revoke(database, client, ObjectId(), als=ANNA))
            await revoke(database, client, BERND_ID, als=OWNER)

            return refused, unknown, await addresses(database)

        # The unknown id is refused as the administrator's, never answered 404: who asks is judged first.
        assert on_a_league(mongo_replica_set_url, body) == (BERECHTIGUNG_NUR_INHABER, BERECHTIGUNG_NUR_INHABER, sorted([OWNER, ANNA]))

    def test_an_owner_row_that_is_dead_revokes_nothing(self, mongo_replica_set_url: str):
        """Folded and equal to its own actor, and refused by the address rule: an owner in name that the one reading reads as none."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            return await refusal_of(revoke(database, client, BERND_ID, als=DEAD_OWNER))

        grants = [grant_document(OWNER_ID, DEAD_OWNER, "owner"), *the_three_grants()[1:]]

        assert on_a_league(mongo_replica_set_url, body, grants=grants) == BERECHTIGUNG_NUR_INHABER

    def test_an_owner_demoted_after_the_first_read_revokes_nothing(self, mongo_replica_set_url: str):
        """The owner's own grant is judged on the read the retry makes inside the transaction, not on the one before it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, list[str]]:
            async def demote() -> None:
                await database[Collection.BERECHTIGUNGEN].update_one({"_id": OWNER_ID}, {"$set": {"verwaltung": "administration"}})

            racing = GrantsRunningARivalAfterTheFirstRead(database[Collection.BERECHTIGUNGEN], demote)

            return await outcome_of(revoke(database, client, BERND_ID, berechtigungen=racing)), await addresses(database)

        assert on_a_league(mongo_replica_set_url, body) == (BERECHTIGUNG_NUR_INHABER, sorted([OWNER, ANNA, BERND]))


class TestAnActorRevokedMidRequest:
    """`REQ-BERECHTIGUNG-006`: the actor check ran before the transaction, so the grant re-judges the actor inside it."""

    def test_a_grant_whose_actor_is_revoked_after_the_check_is_refused_and_stores_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str | None, str, list[str]]:
            racing = GrantsRunningARivalAfterTheFirstRead(database[Collection.BERECHTIGUNGEN], lambda: revoke(database, client, ANNA_ID))
            outcome = await outcome_of(grant(database, client, als=ANNA, berechtigungen=racing))

            return racing.rival_outcome, outcome, await addresses(database)

        assert on_a_league(mongo_replica_set_url, body) == (COMMITTED, BERECHTIGUNG_OHNE_ZUGANG, sorted([OWNER, BERND]))

    def test_a_ban_whose_actor_is_revoked_after_the_check_is_refused_and_stores_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str | None, str, int]:
            racing = GrantsRunningARivalAfterTheFirstRead(database[Collection.BERECHTIGUNGEN], lambda: revoke(database, client, ANNA_ID))
            outcome = await outcome_of(ban(database, client, als=ANNA, berechtigungen=racing))

            return racing.rival_outcome, outcome, await database[Collection.SPERRLISTE].count_documents({})

        assert on_a_league(mongo_replica_set_url, body) == (COMMITTED, BERECHTIGUNG_OHNE_ZUGANG, 0)


class TestTheOwnersRow:
    """`REQ-BERECHTIGUNG-002`: reached only by an owner now, revoking an owner's grant, its own included."""

    def test_an_owners_grant_is_revoked_by_no_route_while_an_administrators_is(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, list[str]]:
            refused = await refusal_of(revoke(database, client, OWNER_ID))
            await revoke(database, client, BERND_ID)

            return refused, await addresses(database)

        assert on_a_league(mongo_replica_set_url, body) == (BERECHTIGUNG_INHABER, sorted([OWNER, ANNA]))


class TestAnOwnerChangesATier:
    """`PATCH /berechtigungen/{berechtigung_id}`: an owner promotes, demotes and steps down, each announced and logged."""

    def test_a_promotion_moves_the_tier_queues_its_notice_moves_the_record_and_is_logged(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, ...]:
            await told(database, client)
            await change(database, client, ANNA_ID, "owner")
            announced = await database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT].find_one({"_id": ANNA_ID})
            logged = await database[Collection.AKTIONEN].count_documents(
                {"collection": str(Collection.BERECHTIGUNGEN), "operation": "patch_one", "document_id": ANNA_ID}
            )

            return (
                await tiers(database),
                [(row["art"], row["jetzt"], row["vorher"], row["urheber"], row["geaendert_von"]) for row in await queued(database)],
                announced and announced["verwaltung"],
                logged,
            )

        assert on_a_league(mongo_replica_set_url, body) == (
            {OWNER: "owner", ANNA: "owner", BERND: "administration"},
            [
                (
                    "geaendert",
                    {"adresse": ANNA, "verwaltung": "owner"},
                    {"adresse": ANNA, "verwaltung": "administration"},
                    "anwendung",
                    OWNER,
                )
            ],
            "owner",
            1,
        )

    def test_an_owner_steps_down_once_another_owner_stands(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> dict[str, str]:
            await change(database, client, ANNA_ID, "owner")
            await change(database, client, OWNER_ID, "administration")

            return await tiers(database)

        assert on_a_league(mongo_replica_set_url, body) == {OWNER: "administration", ANNA: "owner", BERND: "administration"}

    def test_the_tier_already_held_changes_and_queues_nothing(self, mongo_replica_set_url: str):
        """A second press of the same control is harmless: no write, no notice."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[dict[str, str], list[Mapping[str, Any]]]:
            await told(database, client)
            await change(database, client, BERND_ID, "administration")
            await change(database, client, OWNER_ID, "owner")

            return await tiers(database), await queued(database)

        assert on_a_league(mongo_replica_set_url, body) == ({OWNER: "owner", ANNA: "administration", BERND: "administration"}, [])

    def test_an_administrator_changes_no_tier_and_is_told_so_before_the_target_is_looked_up(self, mongo_replica_set_url: str):
        """`REQ-BERECHTIGUNG-005`: making oneself an owner included, and an unknown id refused as the administrator's."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, str, dict[str, str]]:
            itself = await refusal_of(change(database, client, ANNA_ID, "owner", als=ANNA))
            unknown = await refusal_of(change(database, client, ObjectId(), "owner", als=ANNA))

            return itself, unknown, await tiers(database)

        assert on_a_league(mongo_replica_set_url, body) == (
            BERECHTIGUNG_NUR_INHABER,
            BERECHTIGUNG_NUR_INHABER,
            {OWNER: "owner", ANNA: "administration", BERND: "administration"},
        )

    @pytest.mark.parametrize("target", [ObjectId(), DEAD_ID], ids=["no row", "a dead row"])
    def test_a_grant_the_list_does_not_serve_is_not_found(self, mongo_replica_set_url: str, target: ObjectId):
        """A dead row made an owner would be an owner nobody can sign in as."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> None:
            with pytest.raises(DocumentNotFoundException):
                await change(database, client, target, "owner")

        on_a_league(mongo_replica_set_url, body, grants=[*the_three_grants(), grant_document(DEAD_ID, DEAD_OWNER, "administration")])

    def test_a_barred_address_is_made_an_owner_by_nobody(self, mongo_replica_set_url: str):
        """`REQ-BERECHTIGUNG-003`, the grant's own refusal: a barred holder is no administrator, so never an owner."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, dict[str, str]]:
            await database[Collection.SPERRLISTE].insert_one(a_ban_row(BERND))

            return await refusal_of(change(database, client, BERND_ID, "owner")), await tiers(database)

        assert on_a_league(mongo_replica_set_url, body) == (
            BERECHTIGUNG_GESPERRT,
            {OWNER: "owner", ANNA: "administration", BERND: "administration"},
        )


class TestTheLastOwner:
    """`REQ-BERECHTIGUNG-007`: a demotion leaves one live, unbarred owner (`docs/backend/spec.md :: I471`)."""

    def test_the_only_owner_neither_steps_down_nor_is_demoted(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, dict[str, str]]:
            return await refusal_of(change(database, client, OWNER_ID, "administration")), await tiers(database)

        assert on_a_league(mongo_replica_set_url, body) == (
            BERECHTIGUNG_LETZTER_INHABER,
            {OWNER: "owner", ANNA: "administration", BERND: "administration"},
        )

    def test_a_barred_second_owner_holds_no_floor(self, mongo_replica_set_url: str):
        """Counted as the floor of two is: a barred owner admits nobody, so it could demote nobody back."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, dict[str, str]]:
            await a_second_owner(database)
            await database[Collection.SPERRLISTE].insert_one(a_ban_row(ANNA))

            return await refusal_of(change(database, client, OWNER_ID, "administration")), await tiers(database)

        assert on_a_league(mongo_replica_set_url, body) == (
            BERECHTIGUNG_LETZTER_INHABER,
            {OWNER: "owner", ANNA: "owner", BERND: "administration"},
        )


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

    def test_a_dead_row_of_the_address_blocks_no_ban(self, mongo_replica_set_url: str):
        """The same reading as the grant's own refusal: a row that admits nobody holds nothing a ban would take away."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await ban(database, client, NEU)

            return await database[Collection.SPERRLISTE].count_documents({})

        grants = [*the_three_grants(), grant_document(DEAD_ID, NEU_TYPED, "administration")]

        assert on_a_league(mongo_replica_set_url, body, grants=grants) == 1


class TestTheFloorOfTwo:
    """`REQ-BERECHTIGUNG-004`: two live, unbarred grants stand whatever is revoked, an `owner` grant counted."""

    def test_a_revoke_leaving_one_grant_is_refused_and_one_leaving_two_is_not(self, mongo_replica_set_url: str):
        """The second revoke is the refused one: the first leaves exactly the floor."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, list[str]]:
            await revoke(database, client, BERND_ID)
            refused = await refusal_of(revoke(database, client, ANNA_ID))

            return refused, await addresses(database)

        assert on_a_league(mongo_replica_set_url, body) == (BERECHTIGUNG_MINDESTZAHL, sorted([OWNER, ANNA]))

    @pytest.mark.parametrize("third", ["dead", "barred"])
    def test_a_third_grant_that_admits_nobody_does_not_hold_the_floor(self, mongo_replica_set_url: str, third: str):
        """Counted, a dead or barred row would let the revoke leave one person able to act."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            if third == "barred":
                await database[Collection.SPERRLISTE].insert_one(a_ban_row(BERND))

            return await refusal_of(revoke(database, client, ANNA_ID))

        grants = the_three_grants()
        if third == "dead":
            grants[2] = grant_document(BERND_ID, "Bernd.Admin@Frankfurtleague.de", "administration")

        assert on_a_league(mongo_replica_set_url, body, grants=grants) == BERECHTIGUNG_MINDESTZAHL


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

    def test_a_ban_landing_beside_a_claim_leaves_no_queued_row_holding_its_address(self, mongo_replica_set_url: str):
        """The claim queues a removal the database made; a ban of that address commits between its read and its write."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str | None, str, list[Mapping[str, Any]]]:
            await database[Collection.BERECHTIGUNGEN].insert_one(grant_document(DEAD_ID, NEU, "administration"))
            await told(database, client)
            await database[Collection.BERECHTIGUNGEN].delete_one({"_id": DEAD_ID})
            racing = GrantsRunningARivalAfterTheFirstRead(database[Collection.BERECHTIGUNGEN], lambda: ban(database, client, NEU))
            outcome = await outcome_of(claimed(database, client, berechtigungen=racing))

            return racing.rival_outcome, outcome, await queued(database)

        rival, outcome, rows = on_a_league(mongo_replica_set_url, body)

        assert (rival, outcome) == (COMMITTED, COMMITTED)
        assert rows and all(NEU not in str(row) for row in rows)

    def test_a_revoke_landing_beside_a_claim_of_the_same_unannounced_grant_is_announced_once(self, mongo_replica_set_url: str):
        """A pasted grant the pass is queueing is revoked between the pass's read and its write; its record ends on nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str | None, list[Any], int, int]:
            await told(database, client)
            await database[Collection.BERECHTIGUNGEN].insert_one(grant_document(DEAD_ID, NEU, "administration"))
            racing = GrantsRunningARivalAfterTheFirstRead(database[Collection.BERECHTIGUNGEN], lambda: revoke(database, client, DEAD_ID))
            answer = await claimed(database, client, berechtigungen=racing)

            return (
                racing.rival_outcome,
                summary(answer),
                await database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT].count_documents({"_id": DEAD_ID}),
                await database[Collection.BERECHTIGUNGEN_POSTAUSGANG].count_documents({}),
            )

        assert on_a_league(mongo_replica_set_url, body) == (COMMITTED, [("erteilt", NEU, None), ("entzogen", NEU, OWNER)], 0, 2)

    def test_two_owners_demoting_each_other_leave_one_owner(self, mongo_replica_set_url: str):
        """Either alone leaves one owner, both together none: the second is judged again and finds its actor demoted."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str | None, str, dict[str, str]]:
            await a_second_owner(database)
            racing = GrantsRunningARivalAfterTheFirstRead(
                database[Collection.BERECHTIGUNGEN], lambda: change(database, client, OWNER_ID, "administration", als=ANNA)
            )
            outcome = await outcome_of(change(database, client, ANNA_ID, "administration", berechtigungen=racing))

            return racing.rival_outcome, outcome, await tiers(database)

        assert on_a_league(mongo_replica_set_url, body) == (
            COMMITTED,
            BERECHTIGUNG_NUR_INHABER,
            {OWNER: "administration", ANNA: "owner", BERND: "administration"},
        )

    def test_a_demotion_landing_beside_a_revoke_refuses_the_revoke(self, mongo_replica_set_url: str):
        """The revoking owner is demoted between its first read and its write, so it revokes nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str | None, str, list[str]]:
            await a_second_owner(database)
            racing = GrantsRunningARivalAfterTheFirstRead(
                database[Collection.BERECHTIGUNGEN], lambda: change(database, client, OWNER_ID, "administration", als=ANNA)
            )
            outcome = await outcome_of(revoke(database, client, BERND_ID, berechtigungen=racing))

            return racing.rival_outcome, outcome, await addresses(database)

        assert on_a_league(mongo_replica_set_url, body) == (COMMITTED, BERECHTIGUNG_NUR_INHABER, sorted([OWNER, ANNA, BERND]))


class TestTheClaim:
    def test_a_pass_with_nothing_to_queue_writes_no_anchor(self, mongo_replica_set_url: str):
        """A pass runs every few minutes, and an anchor each time would fill the log with rows about nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, int]:
            await told(database, client)
            logged = {"collection": str(Collection.BERECHTIGUNGEN), "operation": "patch_many"}
            before = await database[Collection.AKTIONEN].count_documents(logged)
            await claimed(database, client)

            return before, await database[Collection.AKTIONEN].count_documents(logged)

        before, after = on_a_league(mongo_replica_set_url, body)

        assert before == after

    def test_grants_the_paste_made_are_each_a_change_nobody_made_here(self, mongo_replica_set_url: str):
        """Nothing accounted for and no outbox row: every grant is found by the comparison, and none names an administrator."""

        answer = on_a_league(mongo_replica_set_url, claimed)

        assert summary(answer) == [("erteilt", OWNER, None), ("erteilt", ANNA, None), ("erteilt", BERND, None)]
        assert answer.empfaenger == sorted([OWNER, ANNA, BERND])
        assert [change.geaendert_am for change in answer.aenderungen] == [None, None, None]
        assert answer.beanspruchung is not None and answer.beansprucht_bis == NOW + BEANSPRUCHUNG_DAUER

    def test_once_stamped_nothing_is_left_and_the_claim_is_null(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> FLBerechtigungAbgleichResponse:
            await told(database, client)

            return await claimed(database, client)

        answer = on_a_league(mongo_replica_set_url, body)

        assert (answer.aenderungen, answer.beanspruchung, answer.beansprucht_bis) == ([], None, None)

    def test_edits_made_in_the_database_directly_are_changes_nobody_made_here(self, mongo_replica_set_url: str):
        """A tier changed by hand and a row deleted by hand: the second leaves no trace in the grants at all."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Any]:
            await told(database, client)
            await database[Collection.BERECHTIGUNGEN].update_one({"_id": ANNA_ID}, {"$set": {"verwaltung": "owner"}})
            await database[Collection.BERECHTIGUNGEN].delete_one({"_id": BERND_ID})

            return summary(await claimed(database, client))

        assert on_a_league(mongo_replica_set_url, body) == [("geaendert", ANNA, None), ("entzogen", BERND, None)]

    def test_a_revoke_of_a_grant_nobody_was_told_of_queues_that_grant_first(self, mongo_replica_set_url: str):
        """The database's grant and the application's revoke, in the order they happened, each with its own author."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Any]:
            await told(database, client)
            await database[Collection.BERECHTIGUNGEN].insert_one(grant_document(DEAD_ID, NEU, "administration"))
            await revoke(database, client, DEAD_ID)

            return summary(await claimed(database, client))

        assert on_a_league(mongo_replica_set_url, body) == [("erteilt", NEU, None), ("entzogen", NEU, OWNER)]

    def test_a_second_claim_inside_the_lease_gets_nothing_and_one_after_it_gets_the_rows_again(self, mongo_replica_set_url: str):
        """Two overlapping passes never hold one row; a pass that died leaves its rows to the pass after its lease."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, int, int, bool]:
            first = await claimed(database, client)
            overlapping = await claimed(database, client, now=NOW + BEANSPRUCHUNG_DAUER - timedelta(seconds=1))
            after = await claimed(database, client, now=NOW + BEANSPRUCHUNG_DAUER)

            return len(first.aenderungen), len(overlapping.aenderungen), len(after.aenderungen), after.beanspruchung != first.beanspruchung

        assert on_a_league(mongo_replica_set_url, body) == (3, 0, 3, True)

    def test_the_stamp_removes_only_what_its_own_claim_holds_and_counts_a_repeat_once(self, mongo_replica_set_url: str):
        """A stale claim's stamp, an unknown id and a repeated id are each left alone and counted, never refused."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[tuple[int, int]]:
            first = await claimed(database, client)
            ids = [change.id for change in first.aenderungen]
            second = await claimed(database, client, now=NOW + BEANSPRUCHUNG_DAUER)
            assert second.beanspruchung is not None and first.beanspruchung is not None

            return [
                await stamped(database, client, first.beanspruchung, ids),
                await stamped(database, client, second.beanspruchung, [ids[0], ids[0], ObjectId()]),
                await stamped(database, client, second.beanspruchung, ids),
            ]

        assert on_a_league(mongo_replica_set_url, body) == [(0, 3), (1, 1), (2, 1)]

    def test_the_bookkeeping_leaves_the_log_no_address(self, mongo_replica_set_url: str):
        """Granted and revoked here, removed in the database, then claimed and stamped: the bookkeeping's log rows name ids alone.

        Each removal of it is reached: the revoke's and the claim's of an announced row, and the stamp's (`docs/backend/spec.md :: I465`).
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[list[str], list[str]]:
            await told(database, client)
            created = await grant(database, client)
            await revoke(database, client, created)
            await database[Collection.BERECHTIGUNGEN].delete_one({"_id": BERND_ID})
            await told(database, client)
            bookkeeping = [str(Collection.BERECHTIGUNGEN_ANGEKUENDIGT), str(Collection.BERECHTIGUNGEN_POSTAUSGANG)]
            rows = database[Collection.AKTIONEN].find({"collection": {"$in": bookkeeping}})

            return [str(row) async for row in rows], await database[Collection.BERECHTIGUNGEN_POSTAUSGANG].distinct("_id")

        logged, left = on_a_league(mongo_replica_set_url, body)

        assert logged and all(NEU not in row and BERND not in row for row in logged)
        assert left == []

    def test_the_claim_and_the_stamp_are_logged_under_the_system_actor(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> set[str]:
            await told(database, client)
            rows = database[Collection.AKTIONEN].find(
                {"collection": {"$in": [str(Collection.BERECHTIGUNGEN_ANGEKUENDIGT), str(Collection.BERECHTIGUNGEN_POSTAUSGANG)]}}
            )

            return {row["actor"]["kind"] async for row in rows}

        assert on_a_league(mongo_replica_set_url, body) == {"system"}

    def test_a_barred_address_the_paste_granted_is_answered_nowhere(self, mongo_replica_set_url: str):
        """The one route to a granted, barred address, since each write refuses the other (`docs/backend/spec.md :: I452`)."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[list[tuple[str | None, bool]], list[str]]:
            await told(database, client)
            await database[Collection.SPERRLISTE].insert_one(a_ban_row(NEU))
            await database[Collection.BERECHTIGUNGEN].insert_one(grant_document(DEAD_ID, NEU, "administration"))
            answer = await claimed(database, client)

            return [(change.jetzt.adresse if change.jetzt else None, change.gesperrt) for change in answer.aenderungen], answer.empfaenger

        assert on_a_league(mongo_replica_set_url, body) == ([(None, True)], sorted([OWNER, ANNA, BERND]))

    def test_a_dead_row_is_queued_as_no_grant_counted_and_mailed_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[list[Any], int, list[str]]:
            answer = await claimed(database, client)

            return summary(answer), answer.uebersprungen, answer.empfaenger

        grants = [*the_three_grants(), grant_document(DEAD_ID, "", "administration")]

        assert on_a_league(mongo_replica_set_url, body, grants=grants) == (
            [("erteilt", OWNER, None), ("erteilt", ANNA, None), ("erteilt", BERND, None)],
            1,
            sorted([OWNER, ANNA, BERND]),
        )

    def test_an_address_banned_in_the_database_after_it_was_queued_is_withheld_at_the_claim(self, mongo_replica_set_url: str):
        """A ban no route entered withholds nothing when it lands, so the claim's own ban read is the one guard."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[tuple[str | None, str | None, bool, str]]:
            await told(database, client)
            created = await grant(database, client)
            await revoke(database, client, created)
            await database[Collection.SPERRLISTE].insert_one(a_ban_row(NEU))

            return [
                (
                    change.jetzt.adresse if change.jetzt else None,
                    change.vorher.adresse if change.vorher else None,
                    change.gesperrt,
                    change.urheber,
                )
                for change in (await claimed(database, client)).aenderungen
            ]

        assert on_a_league(mongo_replica_set_url, body) == [(None, None, True, "anwendung"), (None, None, True, "anwendung")]

    def test_a_ban_entered_here_withholds_the_address_in_every_queued_notice(self, mongo_replica_set_url: str):
        """Granted, revoked, banned through the route, then claimed: the stored rows, which a stamp copies into the log, hold no address."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[list[Mapping[str, Any]], FLBerechtigungAbgleichResponse]:
            await told(database, client)
            created = await grant(database, client)
            await revoke(database, client, created)
            await ban(database, client, NEU)
            answer = await claimed(database, client)

            return await queued(database), answer

        rows, answer = on_a_league(mongo_replica_set_url, body)

        assert [row["vorenthalten"] for row in rows] == ["gesperrt", "gesperrt"]
        assert all(NEU not in str(row) for row in rows)
        assert [(change.art, change.gesperrt) for change in answer.aenderungen] == [("erteilt", True), ("entzogen", True)]
        assert NEU not in answer.model_dump_json()

    def test_a_ban_withholds_the_address_past_one_page_of_queued_notices(self, mongo_replica_set_url: str):
        """More notices name the address than one read returns, and none keeps it (`docs/backend/spec.md :: I462`)."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Mapping[str, Any]]:
            await told(database, client)
            await database[Collection.BERECHTIGUNGEN_POSTAUSGANG].insert_many(
                [
                    compose_postausgang(
                        berechtigung_id=ObjectId(),
                        art="erteilt",
                        jetzt=FLBerechtigungStand(adresse=NEU, verwaltung="administration"),
                        vorher=None,
                        geaendert_von=ANNA,
                        now=NOW,
                        gesperrt=(),
                    )
                    for _ in range(LIST_LIMIT_DEFAULT + 1)
                ]
            )
            await ban(database, client, NEU)

            return await queued(database)

        rows = on_a_league(mongo_replica_set_url, body)

        assert len(rows) == LIST_LIMIT_DEFAULT + 1
        assert all(NEU not in str(row) for row in rows)

    def test_a_barred_grant_revoked_here_is_queued_with_no_address(self, mongo_replica_set_url: str):
        """The revoke withholds as it queues, before any claim reads the row."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Mapping[str, Any]]:
            await database[Collection.SPERRLISTE].insert_one(a_ban_row(NEU))
            await database[Collection.BERECHTIGUNGEN].insert_one(grant_document(DEAD_ID, NEU, "administration"))
            await told(database, client)
            await revoke(database, client, DEAD_ID)

            return await queued(database)

        rows = on_a_league(mongo_replica_set_url, body)

        assert rows and all(NEU not in str(row) for row in rows)

    def test_a_barred_acting_administrator_is_withheld_while_the_change_stays_the_applications(self, mongo_replica_set_url: str):
        """Withheld and flagged, `urheber` still `anwendung`: a barred actor never reads as a database edit."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[tuple[str, str | None, bool, str, bool]]:
            await told(database, client)
            await grant(database, client, als=ANNA)
            await revoke(database, client, ANNA_ID)
            await database[Collection.SPERRLISTE].insert_one(a_ban_row(ANNA))

            return [
                (change.art, change.geaendert_von, change.geaendert_von_gesperrt, change.urheber, change.gesperrt)
                for change in (await claimed(database, client)).aenderungen
            ]

        assert on_a_league(mongo_replica_set_url, body) == [
            ("erteilt", None, True, "anwendung", True),
            ("entzogen", OWNER, False, "anwendung", True),
        ]

    def test_an_address_repointed_in_the_database_is_announced_as_one_removal_and_one_grant(self, mongo_replica_set_url: str):
        """One id, a new address: every notice names whose access ended as well as whose began, and a second claim finds nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[list[tuple[Any, ...]], list[Any]]:
            await told(database, client)
            await database[Collection.BERECHTIGUNGEN].update_one({"_id": BERND_ID}, {"$set": {"adresse": NEU}})
            answer = await claimed(database, client)
            await stamped(database, client, str(answer.beanspruchung), [change.id for change in answer.aenderungen])

            return [
                (
                    change.berechtigung_id,
                    change.art,
                    change.urheber,
                    change.geaendert_von,
                    change.geaendert_von_gesperrt,
                    change.jetzt.adresse if change.jetzt else None,
                    change.vorher.adresse if change.vorher else None,
                )
                for change in answer.aenderungen
            ], (await claimed(database, client)).aenderungen

        changes, later = on_a_league(mongo_replica_set_url, body)

        assert changes == [
            (BERND_ID, "entzogen", "datenbank", None, False, None, BERND),
            (BERND_ID, "erteilt", "datenbank", None, False, NEU, None),
        ]
        assert later == []


class TestTheMountedRouteReadsTheGrants:
    """`app/core/security.py :: verify_actor_is_admin` against a real collection, where every other case calls the handler past it."""

    @pytest.mark.parametrize(
        ("actor", "status"),
        [
            pytest.param(ANNA.upper(), 200, id="a grant, the header in capitals"),
            pytest.param(OWNER, 200, id="an owner"),
            pytest.param(NEU, 403, id="no grant"),
        ],
    )
    def test_an_actor_is_admitted_exactly_where_a_grant_names_it(self, mongo_replica_set_url: str, actor: str, status: int):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, str | None]:
            async with app_client(mongo_replica_set_url, config=CONFIG) as http:
                response = await http.get(f"/api/v{API_VERSION}/berechtigungen", headers=SignedActor(actor, ADMIN_KEY))

            return response.status_code, response.json().get("error_code")

        assert on_a_league(mongo_replica_set_url, body) == (status, None if status == 200 else ACTOR_NOT_ADMIN)

    def test_a_revoked_administrator_is_refused_on_the_very_next_request(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[int]:
            async with app_client(mongo_replica_set_url, config=CONFIG) as http:
                headers = SignedActor(BERND, ADMIN_KEY)
                before = await http.get(f"/api/v{API_VERSION}/berechtigungen", headers=headers)
                revoked = await http.delete(f"/api/v{API_VERSION}/berechtigungen/{BERND_ID}", headers=SignedActor(OWNER, ADMIN_KEY))
                after = await http.get(f"/api/v{API_VERSION}/berechtigungen", headers=headers)

            return [before.status_code, revoked.status_code, after.status_code]

        assert on_a_league(mongo_replica_set_url, body) == [200, 200, 403]

    def test_a_grant_made_over_http_is_attributed_to_the_token_s_administrator_everywhere(self, mongo_replica_set_url: str):
        """The only grant case reaching `get_actor_email`: every other hands the handler its actor.

        A token naming a mixed-case identity is stored folded in the grant, the notice and the log alike.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, Any, Any, Any]:
            await told(database, client)
            async with app_client(mongo_replica_set_url, config=CONFIG) as http:
                response = await http.post(
                    f"/api/v{API_VERSION}/berechtigungen", headers=SignedActor(ANNA.upper(), ADMIN_KEY), json={"email": NEU_TYPED}
                )

            stored = await database[Collection.BERECHTIGUNGEN].find_one({"adresse": NEU})
            [queued_row] = await queued(database)
            logged = await database[Collection.AKTIONEN].find_one({"collection": str(Collection.BERECHTIGUNGEN), "operation": "insert"})

            return (
                response.status_code,
                stored and stored["erteilt_von"],
                queued_row["geaendert_von"],
                logged and logged["actor"].get("email"),
            )

        assert on_a_league(mongo_replica_set_url, body) == (201, ANNA, ANNA, ANNA)

    def test_a_tier_change_over_http_reaches_the_grant(self, mongo_replica_set_url: str):
        """The one tier-change case through the body parser and `get_actor_email`; every other hands the handler both."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, dict[str, str], Any]:
            await told(database, client)
            async with app_client(mongo_replica_set_url, config=CONFIG) as http:
                response = await http.patch(
                    f"/api/v{API_VERSION}/berechtigungen/{ANNA_ID}", headers={**ADMIN_AUTH, ACTOR_HEADER: OWNER}, json={"verwaltung": "owner"}
                )
            [queued_row] = await queued(database)

            return response.status_code, await tiers(database), queued_row["geaendert_von"]

        assert on_a_league(mongo_replica_set_url, body) == (200, {OWNER: "owner", ANNA: "owner", BERND: "administration"}, OWNER)

    def test_every_served_instant_carries_its_offset(self, mongo_replica_set_url: str):
        """The driver reads a stored instant back with no offset, which a reader would take for local time."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, str, str]:
            await told(database, client)
            await grant(database, client)
            async with app_client(mongo_replica_set_url, config=CONFIG) as http:
                listed = await http.get(f"/api/v{API_VERSION}/berechtigungen", headers=SignedActor(ANNA, ADMIN_KEY))
                answered = await http.post(f"/api/v{API_VERSION}/berechtigungen/abgleich", headers=SYSTEM_AUTH)

            [erteilt_am] = [row["erteilt_am"] for row in listed.json()["berechtigungen"] if row["adresse"] == NEU]
            [change] = answered.json()["aenderungen"]

            return erteilt_am, change["geaendert_am"], answered.json()["beansprucht_bis"]

        erteilt_am, geaendert_am, beansprucht_bis = on_a_league(mongo_replica_set_url, body)

        # `NOW` is half past noon in Berlin's summer time, so half past ten in UTC.
        assert (erteilt_am, geaendert_am) == ("2026-04-01T10:30:00Z", "2026-04-01T10:30:00Z")
        # The lease runs off the real clock; its spelling is what is pinned.
        assert beansprucht_bis.endswith("Z")

    def test_a_barred_grant_holder_is_no_administrator(self, mongo_replica_set_url: str):
        """A barred holder holds no floor, so it acts on nothing either (`docs/backend/spec.md :: I463`)."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[int]:
            async with app_client(mongo_replica_set_url, config=CONFIG) as http:
                before = await http.get(f"/api/v{API_VERSION}/berechtigungen", headers=SignedActor(BERND, ADMIN_KEY))
                await database[Collection.SPERRLISTE].insert_one(a_ban_row(BERND))
                after = await http.get(f"/api/v{API_VERSION}/berechtigungen", headers=SignedActor(BERND, ADMIN_KEY))

            return [before.status_code, after.status_code]

        assert on_a_league(mongo_replica_set_url, body) == [200, 403]

    def test_the_lookup_admits_a_live_row_and_no_dead_one_of_the_same_equality(self, mongo_replica_set_url: str):
        """A folded row the address rule refuses equals its own header and still admits nobody (`docs/backend/spec.md :: I453`)."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[bool]:
            holds_a_live_grant = get_grant_lookup(
                database[Collection.BERECHTIGUNGEN], database[Collection.SPERRLISTE], database[Collection.SAISONS], CONFIG
            )

            return [await holds_a_live_grant(ANNA), await holds_a_live_grant("jürgen@frankfurtleague.de")]

        grants = [*the_three_grants(), grant_document(DEAD_ID, "jürgen@frankfurtleague.de", "administration")]

        assert on_a_league(mongo_replica_set_url, body, grants=grants) == [True, False]
