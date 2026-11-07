"""
API · the erasure's grants step: an erased person's grants, the notices naming them, and the records they made

Against a replica set, the step run in a transaction of its own as the registry runs it. Seeded through
the composers each route writes with, so a field a route stores in another shape is one these cases miss.
"""

from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase

from app.api.address_change.services import masked_address
from app.api.ban_list.services import compose_barred_until_saison_id
from app.api.grants.erasure import ErasedGrantsAndAuthorship, erase_grants_and_authorship_in_session
from app.api.grants.services import compose_notice
from app.api.invitations.services import compose_invitation
from app.api.outbox.schemas import FLGrantData
from app.api.outbox.services import DELIVERY_DEADLINE, RETENTION
from app.api.registrierungen.services import compose_ablehnung_update
from app.core.collections import Collection
from app.core.recording import ERASED_ACTOR_MARKER
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import ban_document, bewerbung_document, kontakte_document, registrierung_document, saison_document
from tests.whole_database import where_held
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_grants_erasure_test")

NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
# When the notices she finds still queued were, so none reads as one the erasure queued.
QUEUED = datetime(2026, 3, 31, 9, 0, tzinfo=UTC)
TODAY = "2026-04-01"
RUNNING = "2026"
STANDING = compose_barred_until_saison_id(running_saison_id=RUNNING)

# The person erased. Distinctive, so the whole-database scan finding it is no coincidence.
ERIKA = "erika.zwirbelmoos@frankfurtleague.de"
# Her mailbox as a paste, or an actor stored before the fold, typed it: the fold claims it.
ERIKA_TYPED = "Erika.Zwirbelmoos@FrankfurtLeague.de"
# Another mailbox, which a pattern leaving the dot unescaped takes as hers.
NAHE = "erikaxzwirbelmoos@frankfurtleague.de"
# Another mailbox, a long s where hers has an s: the pattern's `i` may read it as hers, the fold does not.
LANGES_S = ERIKA.replace("moos@", f"moo{chr(0x17F)}@")
# Her mailbox at a punycode domain, and as a hand-typed paste may spell it, in capitals and padded: the fold equates
# the two, and a read asking the stored spelling alone misses it.
ERIKA_PUNYCODE = "erika@xn--mller-kva.de"
ERIKA_PUNYCODE_PASTED = f"Erika@XN--MLLER-KVA.DE{chr(0xA0)}"
# The owner, erasing her as the administrator's own route will.
DORA = "dora.inhaberin@frankfurtleague.de"
BERND = "bernd.admin@frankfurtleague.de"
CLARA = "clara.admin@frankfurtleague.de"

ERIKA_ID = ObjectId("6890a1b2c3d4e5f607a10001")
# A second row of hers in a spelling no request matches: a dead grant still holds the address.
ERIKA_DEAD_ID = ObjectId("6890a1b2c3d4e5f607a10002")
DORA_ID = ObjectId("6890a1b2c3d4e5f607a10003")
BERND_ID = ObjectId("6890a1b2c3d4e5f607a10004")
CLARA_ID = ObjectId("6890a1b2c3d4e5f607a10005")
NAHE_ID = ObjectId("6890a1b2c3d4e5f607a10006")

# The notices still queued when she is erased, one per way a notice can name her or not.
NAMING_HER_GRANT = ObjectId("6890a1b2c3d4e5f607a20001")
MADE_BY_HER = ObjectId("6890a1b2c3d4e5f607a20002")
NOT_HERS = ObjectId("6890a1b2c3d4e5f607a20004")
# Made by another mailbox at her local part, which the queued notices' read reaches and the fold refuses.
BY_HER_LOCAL_PART_ELSEWHERE = ObjectId("6890a1b2c3d4e5f607a20005")
ERIKA_ELSEWHERE = ERIKA.replace("@frankfurtleague.de", "@anderswo.de")
ELSEWHERE_GRANTED_ID = ObjectId("6890a1b2c3d4e5f607a10008")

# The records she made, each in a store the step reaches, and a bystander's beside each.
BAN_BY_HER, BAN_BY_HER_TYPED, BAN_BY_DORA, BAN_BY_NAHE, BAN_BY_LANGES_S = (ObjectId(f"6890a1b2c3d4e5f607a3000{n}") for n in range(1, 6))
INVITE_BY_HER, INVITE_BY_DORA = ObjectId("6890a1b2c3d4e5f607a40001"), ObjectId("6890a1b2c3d4e5f607a40002")
DECIDED_BY_HER, DECIDED_BY_DORA = ObjectId("6890a1b2c3d4e5f607a50001"), ObjectId("6890a1b2c3d4e5f607a50002")
DECLINED_BY_HER, DECLINED_BY_DORA = ObjectId("6890a1b2c3d4e5f607a60001"), ObjectId("6890a1b2c3d4e5f607a60002")

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def grant_row(grant_id: ObjectId, address: str, admin_tier: str, granted_by: str) -> dict[str, Any]:
    return {
        "_id": grant_id,
        "address": address,
        "admin_tier": admin_tier,
        "granted_by": granted_by,
        "effective_from": datetime(2026, 1, 1, tzinfo=UTC),
    }


def notice(row_id: ObjectId, grant_id: ObjectId, change: Any, address: str | None, by: str) -> dict[str, Any]:
    composed = compose_notice(grant_id=grant_id, change=change, stage="started", address=address, changed_by=by, now=QUEUED)

    # Owed to Dora, as `app/api/outbox/services.py :: enqueue_mails` stores a row: her copy of the notice.
    return {
        "_id": row_id,
        "key": f"grant/{grant_id}/{change}/started/{QUEUED.isoformat()}/{DORA}",
        "kind": "grant",
        "to": DORA,
        "data": FLGrantData.model_validate(composed.data).model_dump(mode="json"),
        "secret": None,
        "reference": None,
        "link": None,
        "state": "open",
        "recorded_at": QUEUED,
        "deadline": QUEUED + DELIVERY_DEADLINE,
        "erase_at": QUEUED + DELIVERY_DEADLINE + RETENTION,
        "lease": None,
        "leased_until": None,
        "attempts": 0,
        "message_id": None,
        "delivery": None,
    }


def decided(bewerbung_id: ObjectId, by: str) -> dict[str, Any]:
    return bewerbung_document(
        bewerbung_id,
        RUNNING,
        "declined",
        kontakte=kontakte_document(),
        submitted_at="2026-03-01",
        decision={"made_at": "2026-03-10", "by": by, "reason": "Keine Halle"},
    )


def declined(registrierung_id: ObjectId, by: str) -> dict[str, Any]:
    stored = registrierung_document(
        registrierung_id,
        f"pupil-{registrierung_id}@beispiel.de",
        saison_id=RUNNING,
        team_id=ObjectId(),
        first_name="Rita",
        last_name="Registriert",
        token=str(registrierung_id),
        submitted_at="2026-03-20",
        deadline="2026-03-27",
    )

    return {**stored, **compose_ablehnung_update(by=by, reason="Nicht in der Stufe", today="2026-03-22")["$set"]}


async def a_league_she_administered(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_one(saison_document(RUNNING, "active"))
    await database[Collection.GRANTS].insert_many(
        [
            grant_row(ERIKA_ID, ERIKA, "administration", "PLAYGROUND"),
            grant_row(ERIKA_DEAD_ID, ERIKA_TYPED, "administration", "PLAYGROUND"),
            grant_row(DORA_ID, DORA, "owner", "PLAYGROUND"),
            grant_row(BERND_ID, BERND, "administration", ERIKA),
            grant_row(CLARA_ID, CLARA, "administration", ERIKA_TYPED),
            grant_row(NAHE_ID, NAHE, "administration", DORA),
        ]
    )
    await database[Collection.OUTBOX].insert_many(
        [
            notice(NAMING_HER_GRANT, ERIKA_ID, "handover", ERIKA, DORA),
            notice(MADE_BY_HER, BERND_ID, "granted", BERND, ERIKA_TYPED),
            notice(NOT_HERS, CLARA_ID, "granted", CLARA, DORA),
            notice(BY_HER_LOCAL_PART_ELSEWHERE, ELSEWHERE_GRANTED_ID, "granted", "dritte.admin@frankfurtleague.de", ERIKA_ELSEWHERE),
        ]
    )
    await database[Collection.BAN_LIST].insert_many(
        [
            ban_document(f"gebannt-{number}@beispiel.de", until=STANDING, _id=ban_id, created_by=by)
            for number, (ban_id, by) in enumerate(
                (
                    (BAN_BY_HER, ERIKA),
                    (BAN_BY_HER_TYPED, ERIKA_TYPED),
                    (BAN_BY_DORA, DORA),
                    (BAN_BY_NAHE, NAHE),
                    (BAN_BY_LANGES_S, LANGES_S),
                )
            )
        ]
    )
    await database[Collection.INVITATIONS].insert_many(
        [
            {
                "_id": invite_id,
                **compose_invitation(
                    saison_id=RUNNING, team_id=ObjectId(), token_hashes=[f"hash-{invite_id}"], created_by=by, today=TODAY, sent_at=None
                ),
            }
            for invite_id, by in ((INVITE_BY_HER, ERIKA), (INVITE_BY_DORA, DORA))
        ]
    )
    await database[Collection.BEWERBUNGEN].insert_many([decided(DECIDED_BY_HER, ERIKA), decided(DECIDED_BY_DORA, DORA)])
    await database[Collection.REGISTRIERUNGEN].insert_many([declined(DECLINED_BY_HER, ERIKA), declined(DECLINED_BY_DORA, DORA)])


def on_a_league(url: str, body: Body) -> Any:
    """The shipped indexes, so a write production would refuse as a duplicate fails here too."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await a_league_she_administered(database)

            return await body(database, client)

    return on_the_seed_loop(_run())


async def erase(
    database: AsyncDatabase, client: AsyncMongoClient, *, changed_by: str = DORA, identifier: str = ERIKA
) -> ErasedGrantsAndAuthorship:
    async def step(session: AsyncClientSession) -> ErasedGrantsAndAuthorship:
        return await erase_grants_and_authorship_in_session(
            grants_collection=database[Collection.GRANTS],
            address_changes_collection=database[Collection.ADDRESS_CHANGES],
            outbox_collection=database[Collection.OUTBOX],
            bewerbungen_collection=database[Collection.BEWERBUNGEN],
            registrierungen_collection=database[Collection.REGISTRIERUNGEN],
            invitations_collection=database[Collection.INVITATIONS],
            ban_list_collection=database[Collection.BAN_LIST],
            identifier=identifier,
            changed_by=changed_by,
            now=NOW,
            session=session,
        )

    async with client.start_session() as session:
        return await session.with_transaction(step)


async def ids_in(database: AsyncDatabase, collection: Collection) -> set[ObjectId]:
    return {row["_id"] async for row in database[collection].find({}, {"_id": 1})}


async def queued_for(database: AsyncDatabase, grant_id: ObjectId) -> list[Mapping[str, Any]]:
    """The notices about one grant this erasure owed, each once whoever it is owed to, in the order it owed them."""

    notices: dict[str, Mapping[str, Any]] = {}
    async for row in database[Collection.OUTBOX].find({"key": {"$regex": f"^grant/{grant_id}/"}, "recorded_at": NOW}).sort("_id", 1):
        data = row["data"]
        notices.setdefault(
            row["key"].rpartition("/")[0],
            {"change": data["change"], "stage": data["stage"], "address": data["address"], "changed_by": data["changed_by"]},
        )

    return list(notices.values())


class TestHerGrantsGo:
    def test_every_grant_her_address_holds_goes_a_dead_spelling_included(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[ErasedGrantsAndAuthorship, set[ObjectId]]:
            result = await erase(database, client)

            return result, await ids_in(database, Collection.GRANTS)

        result, grants = on_a_league(mongo_replica_set_url, body)

        assert grants == {DORA_ID, BERND_ID, CLARA_ID, NAHE_ID}
        assert result.removed_grants == 2

    def test_a_grant_pasted_unfolded_goes_and_her_pasted_authorship_with_it(self, mongo_replica_set_url: str):
        """Catches a read asking the stored spelling alone, which leaves this grant and its authorship standing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[bool, Any, dict[str, list[str]]]:
            pasted, granted = ObjectId(), ObjectId()
            await database[Collection.GRANTS].insert_many(
                [
                    grant_row(pasted, ERIKA_PUNYCODE_PASTED, "administration", "PLAYGROUND"),
                    grant_row(granted, "neu@frankfurtleague.de", "administration", ERIKA_PUNYCODE_PASTED),
                ]
            )
            await erase(database, client, identifier=ERIKA_PUNYCODE)
            stands = await database[Collection.GRANTS].find_one({"_id": pasted}) is not None
            row = await database[Collection.GRANTS].find_one({"_id": granted})
            assert row is not None

            return stands, row["granted_by"], await where_held(database, "MLLER-KVA", folded=True)

        assert on_a_league(mongo_replica_set_url, body) == (False, ERASED_ACTOR_MARKER, {"MLLER-KVA": []})


class TestTheNotices:
    """No notice still queued names her, and every administrator is told her grant ended."""

    def test_her_grants_end_is_queued_with_no_address_and_attributed_to_who_geloescht_her(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Mapping[str, Any]]:
            await erase(database, client)

            return await queued_for(database, ERIKA_ID)

        assert on_a_league(mongo_replica_set_url, body) == [{"change": "revoked", "stage": "completed", "address": None, "changed_by": DORA}]

    def test_geloescht_on_her_own_request_her_grants_end_names_its_maker_by_the_marker(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Any]:
            await erase(database, client, changed_by=ERIKA_TYPED)

            return [row["changed_by"] for row in await queued_for(database, ERIKA_ID)]

        assert on_a_league(mongo_replica_set_url, body) == [ERASED_ACTOR_MARKER]

    def test_every_notice_queued_before_her_erasure_names_her_nowhere_and_no_other_moves(self, mongo_replica_set_url: str):
        """Her address emptied, her as the actor given the marker."""

        async def stored(database: AsyncDatabase) -> dict[ObjectId, tuple[Any, ...]]:
            return {
                row["_id"]: (row["data"]["address"], row["data"]["changed_by"])
                async for row in database[Collection.OUTBOX].find(
                    {"_id": {"$in": [NAMING_HER_GRANT, MADE_BY_HER, NOT_HERS, BY_HER_LOCAL_PART_ELSEWHERE]}}
                )
            }

        async def body(
            database: AsyncDatabase, client: AsyncMongoClient
        ) -> tuple[dict[ObjectId, tuple[Any, ...]], dict[ObjectId, tuple[Any, ...]]]:
            before = await stored(database)
            await erase(database, client)

            return before, await stored(database)

        before, after = on_a_league(mongo_replica_set_url, body)

        assert after[NAMING_HER_GRANT] == (None, DORA)
        assert after[MADE_BY_HER] == (BERND, ERASED_ACTOR_MARKER)
        assert after[NOT_HERS] == before[NOT_HERS]
        assert after[BY_HER_LOCAL_PART_ELSEWHERE] == before[BY_HER_LOCAL_PART_ELSEWHERE]

    @pytest.mark.parametrize(
        ("stage", "left"),
        [
            pytest.param("completed", (None, None), id="a completed change's old address was hers"),
            pytest.param("withdrawn", (BERND, None), id="a change that never reached her keeps its own holder"),
        ],
    )
    def test_a_queued_address_notice_masking_her_keeps_neither_her_mask_nor_her_old_address(
        self, mongo_replica_set_url: str, stage: str, left: tuple[str | None, str | None]
    ):
        """A completion names the address before the move, which no fold of her erased address finds."""

        row_id = ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, Any]:
            row = notice(row_id, BERND_ID, "address", BERND, DORA)
            data = {**row["data"], "stage": stage, "changed_by": None, "new_address": masked_address(ERIKA)}
            await database[Collection.OUTBOX].insert_one({**row, "data": data})
            await erase(database, client)
            stored = await database[Collection.OUTBOX].find_one({"_id": row_id})
            assert stored is not None

            return stored["data"]["address"], stored["data"]["new_address"]

        assert on_a_league(mongo_replica_set_url, body) == left

    def test_a_handover_waiting_on_her_row_is_withdrawn_naming_nobody(self, mongo_replica_set_url: str):
        """The holders hold a date for it, and the grant it waited on is gone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Mapping[str, Any]]:
            await database[Collection.GRANTS].update_one({"_id": ERIKA_ID}, {"$set": {"owner_from": NOW}})
            await erase(database, client)

            return await queued_for(database, ERIKA_ID)

        assert on_a_league(mongo_replica_set_url, body) == [
            {"change": "revoked", "stage": "completed", "address": None, "changed_by": DORA},
            {"change": "handover", "stage": "withdrawn", "address": None, "changed_by": DORA},
        ]


class TestTheRecordsSheMade:
    """A grant, a ban, an invite or a decision she made names her by the marker alone."""

    AUTHORS = (
        (Collection.GRANTS, BERND_ID, ("granted_by",)),
        (Collection.GRANTS, CLARA_ID, ("granted_by",)),
        (Collection.BAN_LIST, BAN_BY_HER, ("created_by",)),
        (Collection.BAN_LIST, BAN_BY_HER_TYPED, ("created_by",)),
        (Collection.INVITATIONS, INVITE_BY_HER, ("created_by",)),
        (Collection.BEWERBUNGEN, DECIDED_BY_HER, ("decision", "by")),
        (Collection.REGISTRIERUNGEN, DECLINED_BY_HER, ("decision", "by")),
    )

    BYSTANDERS = (
        (Collection.GRANTS, NAHE_ID, ("granted_by",), DORA),
        (Collection.BAN_LIST, BAN_BY_DORA, ("created_by",), DORA),
        (Collection.BAN_LIST, BAN_BY_NAHE, ("created_by",), NAHE),
        (Collection.BAN_LIST, BAN_BY_LANGES_S, ("created_by",), LANGES_S),
        (Collection.INVITATIONS, INVITE_BY_DORA, ("created_by",), DORA),
        (Collection.BEWERBUNGEN, DECIDED_BY_DORA, ("decision", "by"), DORA),
        (Collection.REGISTRIERUNGEN, DECLINED_BY_DORA, ("decision", "by"), DORA),
    )

    @staticmethod
    async def author(database: AsyncDatabase, collection: Collection, row_id: ObjectId, path: tuple[str, ...]) -> Any:
        value: Any = await database[collection].find_one({"_id": row_id})
        for key in path:
            value = value[key]

        return value

    def test_every_record_she_made_reads_the_marker_whatever_spelling_stored_her(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Any]:
            await erase(database, client)

            return [await self.author(database, collection, row_id, path) for collection, row_id, path in self.AUTHORS]

        assert on_a_league(mongo_replica_set_url, body) == [ERASED_ACTOR_MARKER] * len(self.AUTHORS)

    def test_another_administrators_records_keep_their_author_a_similar_address_included(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Any]:
            await erase(database, client)

            return [await self.author(database, collection, row_id, path) for collection, row_id, path, _ in self.BYSTANDERS]

        assert on_a_league(mongo_replica_set_url, body) == [author for _, _, _, author in self.BYSTANDERS]


def test_her_address_is_held_nowhere_in_the_database_in_either_spelling(mongo_replica_set_url: str):
    """Rendered whole, the step's own log rows included: an image or a filter naming her would keep what the step destroys."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> dict[str, list[str]]:
        held = await where_held(database, ERIKA, ERIKA_TYPED)
        assert held[ERIKA] and held[ERIKA_TYPED], f"the control: the seed holds her nowhere, so the scan below proves nothing: {held}"
        await erase(database, client)

        return await where_held(database, ERIKA, ERIKA_TYPED)

    assert on_a_league(mongo_replica_set_url, body) == {ERIKA: [], ERIKA_TYPED: []}
