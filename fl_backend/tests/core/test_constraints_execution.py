from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any, Final
from uuid import UUID

import pytest
from bson import ObjectId
from fastapi import FastAPI
from pydantic import SecretStr
from pymongo import ASCENDING, AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.bewerbungen.public_router import post_bewerbung
from app.api.bewerbungen.schemas import FLPostBewerbungPayload
from app.api.registrierungen.crud import pull_open_registrierungen
from app.api.registrierungen.public_router import post_registrierung
from app.api.registrierungen.schemas import FLPostRegistrierungPayload
from app.core.collections import Collection
from app.core.constraints import (
    SUPPORT_INDEXES,
    TTL_INDEXES,
    UNIQUE_INDEXES,
    apply_constraints,
)
from app.core.db import lifespan
from app.shared.tokens import hash_token
from tests.config import build_test_config
from tests.database import a_clean_database
from tests.documents import (
    action_log_document,
    address_change_document,
    aufstellung_document,
    ban_document,
    bericht_document,
    bewerbung_document,
    grant_document,
    invitation_document,
    kontaktperson_document,
    new_schule_document,
    outbox_document,
    registrierung_confirmed,
    registrierung_document,
    saison_document,
    saison_spieler_document,
    saison_team_document,
    schiedsrichter_document,
    spiel_document,
    spielbericht_document,
    spielbestaetigung_document,
    spieler_document,
    spielort_document,
    spieltag_document,
    team_document,
)
from tests.outbox import MAIL_NOW
from tests.plans import Wanted, plans_of_sent_reads
from tests.worker import worker_database

pytestmark = pytest.mark.db


# The throwaway: every body under it breaks the schema it applies, so `on_a_database` rebuilds it per
# call.
DATABASE_NAME = worker_database("fl_constraints_test")
# A second database, so the throwaway above stays the one this suite is free to break.
SHIPPED_DATABASE_NAME = worker_database("fl_constraints_shipped_test")

SAISON_ID = "2026"
TEAM_OID = ObjectId("6890a1b2c3d4e5f607200001")
SPIELER_OID = ObjectId("6890a1b2c3d4e5f607200002")
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f607200003")
SPIELORT_OID = ObjectId("6890a1b2c3d4e5f607200004")
SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607200005")
ACTION_LOG_ENTRY_OID = ObjectId("6890a1b2c3d4e5f607200006")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607200007")
BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607200009")
BAN_LIST_OID = ObjectId("6890a1b2c3d4e5f60720000a")
INVITATION_OID = ObjectId("6890a1b2c3d4e5f60720000b")
REGISTRIERUNG_OID = ObjectId("6890a1b2c3d4e5f60720000c")
GRANT_OID = ObjectId("6890a1b2c3d4e5f60720000d")
SPIELBESTAETIGUNG_OID = ObjectId("6890a1b2c3d4e5f60720000e")
SPIEL_OID = ObjectId("6890a1b2c3d4e5f60720000f")
ADDRESS_CHANGE_OID = ObjectId("6890a1b2c3d4e5f6072000a1")
# A submission key as a public form mints it (`app/api/bewerbungen/public_router.py :: post_bewerbung`).
IDEMPOTENCY_KEY = "1b4e28ba-2fa1-4d2b-883f-0016d3cca427"

# One declared support index, planted under different keys so its build is the one that fails.
CONFLICTING_SUPPORT_INDEX = "address_change_token_hashes"
# The same planting for the TTL kind: the name is claimed and the keys disagree.
CONFLICTING_TTL_INDEX = "action_log_retention"


# The seat as its applicant named the person, and as that person then confirmed it.
SEATED: Final = {"date": "2026-01-15"}


def kontaktperson(first_name: str) -> dict[str, Any]:
    """A function rather than a constant: the nested consent has to be fresh per slot too, which a `dict()` of a shared one is not."""
    return kontaktperson_document(first_name, confirmed_at="2026-01-16", einwilligung=SEATED, phone="+49 69 90009123", birth_date="1980-05-04")


def valid_documents() -> dict[Collection, dict[str, Any]]:
    """Rebuilt on every call, so no test can mutate another's document."""
    spiel = spiel_document(
        spiel_id=SPIEL_OID,
        saison_id=SAISON_ID,
        spiel_nr=1,
        spieltag_id=SPIELTAG_OID,
        team1={"team_id": TEAM_OID, "tore": None},
        team2={"team_id": OTHER_TEAM_OID, "tore": None},
        date="2026-03-15",
        time="18:00:00",
        spielort={"spielort_id": SPIELORT_OID, "mietpreis": 80},
    )
    return {
        Collection.SAISONS: saison_document(SAISON_ID, "active"),
        Collection.TEAMS: team_document(TEAM_OID, "Lessing", "LEX"),
        Collection.SAISON_TEAMS: saison_team_document(SAISON_ID, TEAM_OID, "Lessing", "LEX"),
        Collection.SPIELER: spieler_document(SPIELER_OID, "Max", "Mustermann"),
        Collection.SAISON_SPIELER: saison_spieler_document(SPIELER_OID, SAISON_ID, TEAM_OID, nummer="10"),
        Collection.SPIELE: {
            **spiel,
            "team1": {"team_id": TEAM_OID, "tore": 2},
            "team2": {"team_id": OTHER_TEAM_OID, "tore": 1},
            "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER_OID, "payment": 20},
            "ergebnis": "2:1",
        },
        Collection.SPIELTAGE: spieltag_document(SPIELTAG_OID, SAISON_ID, 1, start="2026-03-15", end="2026-03-15"),
        Collection.SPIELORTE: spielort_document(SPIELORT_OID, "Sportplatz Ost"),
        Collection.SCHIEDSRICHTER: schiedsrichter_document(
            SCHIEDSRICHTER_OID, email="a.referee@example.com", name="A. Referee", default_payment=20, einwilligung=None
        ),
        # Undecided, proposing a school rather than picking a club: both are nullable and exactly
        # one carries a value, a write-path rule.
        Collection.BEWERBUNGEN: bewerbung_document(
            BEWERBUNG_OID,
            SAISON_ID,
            "submitted",
            schule=new_schule_document("Lessing"),
            # Distinct per slot, so a block copied across with two slots swapped fails rather than compares equal.
            kontakte={
                "trainer": kontaktperson("Wraxlington"),
                "ansprechperson": kontaktperson("Quillhilde"),
                "stellvertretung": kontaktperson("Bramblewick"),
                "trainer_is_also": None,
            },
            submitted_at="2026-02-01",
        ),
        Collection.ACTION_LOG: action_log_document(
            "team.changed", by="admin@example.invalid", at=datetime(2026, 3, 15, 9, 30, tzinfo=UTC), record_id=TEAM_OID, label="Lessing"
        ),
        Collection.BAN_LIST: ban_document("gesperrt@example.com", until="2031", _id=BAN_LIST_OID),
        Collection.INVITATIONS: invitation_document(INVITATION_OID, saison_id=SAISON_ID, team_id=TEAM_OID, token="the team's link"),
        Collection.REGISTRIERUNGEN: registrierung_document(
            REGISTRIERUNG_OID,
            "thessaly@example.invalid",
            saison_id=SAISON_ID,
            team_id=TEAM_OID,
            first_name="Thessaly",
            last_name="Okonkwo-Brandt",
            token="the pupil's link",
            submitted_at="2026-03-16",
            deadline="2026-03-23",
            position="Mittelfeld",
            nummer="17",
            stufe="Q1",
            invitation_id=INVITATION_OID,
            keyed=False,
        ),
        Collection.GRANTS: grant_document("inhaberin@example.com", "owner", effective_from=datetime(2026, 1, 1, tzinfo=UTC), _id=GRANT_OID),
        # An open team row as the pass mints it.
        Collection.SPIELBESTAETIGUNGEN: spielbestaetigung_document(
            spiel, party={"kind": "team", "team_id": TEAM_OID}, _id=SPIELBESTAETIGUNG_OID, deadline="2026-03-08"
        ),
        Collection.SPIELBERICHTE: spielbericht_document(spiel),
        Collection.AUFSTELLUNGEN: aufstellung_document(spiel, TEAM_OID, starters=[SPIELER_OID]),
        # A live change as the start stores it, its instants dates, which every read takes; and the carry an earlier
        # effect of the address left owed on it, which the record keeps beside its live fields as the model reads them.
        Collection.ADDRESS_CHANGES: {
            "_id": ADDRESS_CHANGE_OID,
            **address_change_document(address="alt@example.invalid", email="neu@example.invalid", token_hash="a" * 64, day="2026-03-16"),
            "move": {"old": "vorher@example.invalid", "new": "alt@example.invalid"},
        },
    }


def valid_document(collection: Collection, **overrides: Any) -> dict[str, Any]:
    document = valid_documents()[collection]
    document.update(overrides)
    return document


Body = Callable[[AsyncDatabase], Awaitable[Any]]


async def on_a_database(url: str, body: Body) -> Any:
    """A database dropped for this call, for a body that seeds what makes `apply_constraints` fail and then calls it.

    `mutates_schema=True` records nothing of what a refusal leaves, so every call rebuilds.
    """

    async with a_clean_database(url, DATABASE_NAME, constraints=False, mutates_schema=True) as (_, database):
        return await body(database)


async def on_the_shipped_schema(url: str, body: Body) -> Any:
    """A database the shipped constraints were built on ONCE, emptied for this test.

    For a body that only inserts and reads; one that breaks an index takes
    `on_a_database`'s throwaway.
    """

    async with a_clean_database(url, SHIPPED_DATABASE_NAME, constraints=True) as (_, database):
        return await body(database)


# Keyed by the index's name, so the pair proves the rule it is filed under rather than the rule that
# happens to be declared in its position; the collection comes off the declaration for the same reason.
DUPLICATE_PAIRS: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {
    "uniq_saison_id_team_id": (valid_documents()[Collection.SAISON_TEAMS], valid_document(Collection.SAISON_TEAMS, gruppe="B")),
    "uniq_spieler_id_saison_id": (valid_documents()[Collection.SAISON_SPIELER], valid_document(Collection.SAISON_SPIELER, nummer="11")),
    "uniq_saison_id_spiel_nr": (valid_documents()[Collection.SPIELE], valid_document(Collection.SPIELE, _id=TEAM_OID, ergebnis="0:0")),
    "uniq_shorthand": (valid_documents()[Collection.TEAMS], valid_document(Collection.TEAMS, _id=SPIELER_OID, name="Lessing II")),
    # The second row differs in its price and its fee: what the index refuses on is the name alone,
    # and a pair differing in nothing else would pass while keyed on anything.
    "uniq_spielort_name": (valid_documents()[Collection.SPIELORTE], valid_document(Collection.SPIELORTE, _id=TEAM_OID, default_mietpreis=90)),
    "uniq_schiedsrichter_name": (
        valid_documents()[Collection.SCHIEDSRICHTER],
        valid_document(Collection.SCHIEDSRICHTER, _id=TEAM_OID, default_payment=25),
    ),
    "uniq_saison_id_saison_phase_position": (
        valid_documents()[Collection.SPIELTAGE],
        valid_document(Collection.SPIELTAGE, _id=SPIELORT_OID, end="2026-03-22"),
    ),
    # The second row differs in its reason and its author: the index refuses on the address alone, and
    # a pair agreeing in everything would pass while keyed on anything at all.
    "uniq_ban_list_address": (
        valid_documents()[Collection.BAN_LIST],
        valid_document(Collection.BAN_LIST, _id=TEAM_OID, ban_reason="Zweiter Eintrag"),
    ),
    # Both rows live, which is the reach the `partialFilterExpression` narrows the rule to: a pair
    # whose second row carried a revocation date would pass while the filter matched anything.
    "uniq_invitation_live": (
        valid_documents()[Collection.INVITATIONS],
        valid_document(Collection.INVITATIONS, _id=TEAM_OID, token_hashes=["c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f80910000"]),
    ),
    # Both rows keyed alike: the index refuses on the key alone, and a pair carrying no key at all would pass while
    # the partial filter matched nothing.
    "uniq_bewerbung_idempotency_key": (
        valid_document(Collection.BEWERBUNGEN, idempotency_key=IDEMPOTENCY_KEY),
        valid_document(Collection.BEWERBUNGEN, _id=TEAM_OID, idempotency_key=IDEMPOTENCY_KEY),
    ),
    "uniq_registrierung_idempotency_key": (
        valid_document(Collection.REGISTRIERUNGEN, idempotency_key=IDEMPOTENCY_KEY),
        valid_document(Collection.REGISTRIERUNGEN, _id=TEAM_OID, idempotency_key=IDEMPOTENCY_KEY),
    ),
    # Two persons differing in their name and sharing an address: the index refuses on the address alone.
    "uniq_spieler_email": (
        valid_document(Collection.SPIELER, email="pupil@example.invalid"),
        valid_document(Collection.SPIELER, _id=TEAM_OID, first_name="Zweite", email="pupil@example.invalid"),
    ),
    # The second row differs in its tier and its author: the index refuses on the address alone, which
    # is what refuses a paste granting an address a route already granted.
    "uniq_grant_address": (
        valid_documents()[Collection.GRANTS],
        valid_document(Collection.GRANTS, _id=TEAM_OID, admin_tier="administration"),
    ),
    # Both rows open, one party, one digest, differing in when they were asked: the index refuses on its five keys
    # alone, and a pair the partial filter reached on neither side would pass.
    "uniq_spielbestaetigung_open": (
        valid_documents()[Collection.SPIELBESTAETIGUNGEN],
        valid_document(Collection.SPIELBESTAETIGUNGEN, _id=TEAM_OID, asked_at="2026-03-01"),
    ),
    # Two reports of one fixture differing in their whole block: the index refuses on the fixture alone.
    "uniq_spielbericht_spiel_id": (
        valid_documents()[Collection.SPIELBERICHTE],
        valid_document(Collection.SPIELBERICHTE, _id=TEAM_OID, bericht=bericht_document(remarks="Zweiter Bericht")),
    ),
    # Two line-ups of one club for one fixture, naming different pupils: the index refuses on the pair alone.
    "uniq_aufstellung_spiel_id_team_id": (
        valid_documents()[Collection.AUFSTELLUNGEN],
        valid_document(Collection.AUFSTELLUNGEN, _id=TEAM_OID, spieler=[]),
    ),
    # Two live changes of one address, to two mailboxes: the index refuses on the address alone, both rows in its filter.
    "uniq_address_change_address": (
        valid_documents()[Collection.ADDRESS_CHANGES],
        {
            "_id": TEAM_OID,
            **address_change_document(address="alt@example.invalid", email="zweite@example.invalid", token_hash="b" * 64, day="2026-03-16"),
        },
    ),
    # A second owner at another address: a grant written by hand is the one writer that could make one, and it would hold the
    # role beside the first with nothing in the application able to take it away again.
    "uniq_grant_owner": (
        valid_documents()[Collection.GRANTS],
        valid_document(Collection.GRANTS, _id=TEAM_OID, address="zweite@example.invalid"),
    ),
    "uniq_outbox_key": (
        outbox_document("ban/1", to="gesperrt@example.invalid", now=MAIL_NOW),
        outbox_document("ban/1", to="gesperrt@example.invalid", now=MAIL_NOW),
    ),
    # Two seasons, each `active`: a second row in any other status would pass while the filter matched nothing.
    "uniq_saison_active": (
        valid_documents()[Collection.SAISONS],
        valid_document(Collection.SAISONS, _id="2027", start_date="2027-01-01", end_date="2027-06-30"),
    ),
}

# At import, and set equality rather than the `KeyError` the walk below would raise: that names a
# declared index with no pair and nothing else, leaving a pair no declared index answers to as a
# case nothing runs.
assert DUPLICATE_PAIRS.keys() == {index.name for index in UNIQUE_INDEXES}


@pytest.mark.parametrize(
    ("collection", "first", "second"),
    [pytest.param(index.collection, *DUPLICATE_PAIRS[index.name], id=index.name) for index in UNIQUE_INDEXES],
)
async def test_each_unique_index_refuses_the_second_document(
    mongo_replica_set_url: str, collection: str, first: dict[str, Any], second: dict[str, Any]
):
    async def body(database: AsyncDatabase) -> str:
        await database[collection].insert_one(first)
        try:
            await database[collection].insert_one(second)
        except OperationFailure as failure:
            return f"rejected:{failure.code}"
        return "accepted"

    # 11000 is DuplicateKey: the index is what refuses the write.
    assert await on_the_shipped_schema(mongo_replica_set_url, body) == "rejected:11000"


async def test_two_ended_changes_of_one_address_are_both_kept(mongo_replica_set_url: str):
    """An ending nulls the address, so a filter on `ended` alone would hold every tombstone under one null key."""

    # A century ahead of the real clock: the TTL monitor deletes a tombstone whose retention has passed, under the count.
    ended = {"address": None, "email": None, "ended": {"kind": "declined", "at": datetime(2126, 3, 17, tzinfo=UTC)}}

    async def body(database: AsyncDatabase) -> int:
        await database[Collection.ADDRESS_CHANGES].insert_one(valid_document(Collection.ADDRESS_CHANGES, **ended))
        await database[Collection.ADDRESS_CHANGES].insert_one(
            valid_document(Collection.ADDRESS_CHANGES, _id=TEAM_OID, stop={"token_hashes": [hash_token("stop-c")]}, **ended)
        )
        return await database[Collection.ADDRESS_CHANGES].count_documents({})

    assert await on_the_shipped_schema(mongo_replica_set_url, body) == 2


async def test_only_an_open_confirmation_meets_the_rule(mongo_replica_set_url: str):
    """An answered row, a closed one and the other club's open one stand beside a party's open row on one stand.

    A dropped filter or a lost team key refuses one, and with it a reinstated fixture's fresh request.
    """

    answer = {"kind": "agreed", "at": "2026-03-01", "by": {"kind": "kontakt", "seat": "trainer"}, "vorschlag": None, "reason": None}

    async def body(database: AsyncDatabase) -> int:
        await database[Collection.SPIELBESTAETIGUNGEN].insert_one(valid_documents()[Collection.SPIELBESTAETIGUNGEN])
        await database[Collection.SPIELBESTAETIGUNGEN].insert_one(valid_document(Collection.SPIELBESTAETIGUNGEN, _id=TEAM_OID, answer=answer))
        await database[Collection.SPIELBESTAETIGUNGEN].insert_one(
            valid_document(Collection.SPIELBESTAETIGUNGEN, _id=SPIELER_OID, closed={"reason": "cancelled"})
        )
        await database[Collection.SPIELBESTAETIGUNGEN].insert_one(
            valid_document(Collection.SPIELBESTAETIGUNGEN, _id=SPIELTAG_OID, party={"kind": "team", "team_id": OTHER_TEAM_OID})
        )
        return await database[Collection.SPIELBESTAETIGUNGEN].count_documents({})

    assert await on_the_shipped_schema(mongo_replica_set_url, body) == 4


def _raised(failure: RuntimeError, named: str) -> str:
    """The refusal names what it was building and carries the driver's, as `app/core/constraints.py :: _apply_unique_index` raises it."""

    if named not in str(failure):
        return f"raised the wrong thing: {failure}"
    return "raised" if isinstance(failure.__cause__, OperationFailure) else f"raised without its cause: {failure}"


async def test_the_startup_apply_fails_rather_than_skipping_a_broken_index(mongo_replica_set_url: str):
    """The tempting fix — catch it, log it, carry on — leaves a database that looks constrained and is not."""

    async def body(database: AsyncDatabase) -> str:
        await database[Collection.TEAMS].insert_many(
            [valid_documents()[Collection.TEAMS], valid_document(Collection.TEAMS, _id=SPIELER_OID, name="Lessing II")]
        )
        try:
            await apply_constraints(database)
        except RuntimeError as failure:
            return _raised(failure, "uniq_shorthand")
        return "carried on"

    assert await on_a_database(mongo_replica_set_url, body) == "raised"


async def test_the_application_refuses_to_start_over_a_broken_index(mongo_replica_set_url: str):
    """The case above holds the apply; this one the start that calls it, which would otherwise serve with no unique guard."""

    async def body(database: AsyncDatabase) -> str:
        await database[Collection.TEAMS].insert_many(
            [valid_documents()[Collection.TEAMS], valid_document(Collection.TEAMS, _id=SPIELER_OID, name="Lessing II")]
        )
        app = FastAPI()
        app.state.config = build_test_config().model_copy(
            update={"mongodb_uri": SecretStr(mongo_replica_set_url), "db_base_name": database.name}
        )
        try:
            async with lifespan(app):
                return "started"
        except RuntimeError as failure:
            return _raised(failure, "uniq_shorthand")

    assert await on_a_database(mongo_replica_set_url, body) == "raised"


async def test_the_startup_apply_fails_rather_than_skipping_a_broken_support_index(mongo_replica_set_url: str):
    """A support index costs speed rather than correctness, which is exactly why a boot might be tempted to shrug one off."""

    async def body(database: AsyncDatabase) -> str:
        # The same name over different keys: `create_index` refuses rather than replacing, which is
        # the one way a declared support index fails on a database holding no documents.
        await database[Collection.ADDRESS_CHANGES].create_index([("email", ASCENDING)], name=CONFLICTING_SUPPORT_INDEX)
        try:
            await apply_constraints(database)
        except RuntimeError as failure:
            return _raised(failure, CONFLICTING_SUPPORT_INDEX)
        return "carried on"

    assert await on_a_database(mongo_replica_set_url, body) == "raised"


async def test_the_startup_apply_fails_rather_than_skipping_a_broken_ttl_index(mongo_replica_set_url: str):
    """The third kind, and the one whose absence shows in nothing: a log that keeps every row reads exactly like a log being expired."""

    async def body(database: AsyncDatabase) -> str:
        await database[Collection.ACTION_LOG].create_index([("by", ASCENDING)], name=CONFLICTING_TTL_INDEX)
        try:
            await apply_constraints(database)
        except RuntimeError as failure:
            return _raised(failure, CONFLICTING_TTL_INDEX)
        return "carried on"

    assert await on_a_database(mongo_replica_set_url, body) == "raised"


async def test_every_declared_support_index_is_built(mongo_replica_set_url: str):
    """`apply_constraints` creates each one, under the collation it is declared with."""

    async def body(database: AsyncDatabase) -> None:
        for index in SUPPORT_INDEXES:
            built = {existing["name"]: existing async for existing in await database[index.collection].list_indexes()}
            assert index.name in built, f"{index.name} missing from {index.collection}: {sorted(built)}"
            # Read back too: one built under another collation serves none of the reads it is declared for.
            locale = (built[index.name].get("collation") or {}).get("locale")
            assert locale == (index.collation or {}).get("locale"), f"{index.name} is built under {locale}, declared {index.collation}"

    await on_the_shipped_schema(mongo_replica_set_url, body)


async def test_every_declared_ttl_index_is_built_over_its_key_with_its_bound(mongo_replica_set_url: str):
    """`expireAfterSeconds` is what makes it a TTL index at all, and one built without it serves reads and expires nothing."""

    async def body(database: AsyncDatabase) -> list[tuple[str, Any, Any]]:
        read_back = []
        for ttl in TTL_INDEXES:
            built = {index["name"]: index async for index in await database[ttl.collection].list_indexes()}
            assert ttl.name in built, f"{ttl.name} missing from {ttl.collection}: {sorted(built)}"
            read_back.append((ttl.name, built[ttl.name].get("expireAfterSeconds"), dict(built[ttl.name]["key"])))
        return read_back

    # Read back rather than assumed: an index is only ever ADDED
    # (`app/core/constraints.py :: apply_constraints`), so a changed bound reaches the declaration
    # and never a database that already holds the name.
    assert await on_the_shipped_schema(mongo_replica_set_url, body) == [(ttl.name, ttl.seconds, {ttl.key: 1}) for ttl in TTL_INDEXES]


CONFIRMED_QUEUE_INDEX = "registrierungen_saison_id_team_id_confirmed_queue"

# Enough rows that the planner prefers an index: on a handful of documents a collection scan wins on merit.
ROWS_ENOUGH_TO_PREFER_AN_INDEX = 2000

# The pupils who confirmed, older than every row of the flood typed through the team's link after them.
CONFIRMED_BENEATH_A_FLOOD = 3


class _SentReads:
    """A collection keeping each pipeline a call site aggregates, so the read is explained as it was sent."""

    def __init__(self, collection: Any) -> None:
        self._collection = collection
        self.sent: list[list[Mapping[str, Any]]] = []

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def aggregate(self, pipeline: list[Mapping[str, Any]], **kwargs: Any) -> Any:
        self.sent.append(pipeline)
        return await self._collection.aggregate(pipeline, **kwargs)


def index_names(node: Any) -> list[str]:
    """Every index a plan walks, at any depth: an exploded `$in` nests its scans past `inputStage`."""

    if isinstance(node, Mapping):
        return [*([node["indexName"]] if "indexName" in node else []), *(name for value in node.values() for name in index_names(value))]
    if isinstance(node, list):
        return [name for value in node for name in index_names(value)]
    return []


async def test_a_teams_confirmed_registrations_are_read_past_a_flood_without_fetching_it(mongo_replica_set_url: str):
    """The confirmed read as `pull_open_registrierungen` sends it, explained with its run: it fetches the confirmed rows alone.

    Anybody holding the team's link writes an unconfirmed row with every press. On the queue index the read would fetch every
    one standing newer, the flood whole, on each look at the team's list: what it serves stays the same, so only the plan shows it.
    """

    def registration(position: int, *, confirmed: bool) -> dict[str, Any]:
        return registrierung_document(
            ObjectId(),
            f"schueler.{position}@example.invalid",
            saison_id=SAISON_ID,
            team_id=TEAM_OID,
            first_name="Flut",
            last_name=f"Nr{position}",
            token=f"link-{position}",
            submitted_at="2026-03-01" if confirmed else "2026-03-15",
            deadline="2026-03-29",
            confirmed=registrierung_confirmed(
                birth_date="2009-05-04", today="2026-03-02", at="2026-03-02T08:00:00+00:00", scope="internal", media=False
            )
            if confirmed
            else None,
        )

    async def body(database: AsyncDatabase) -> tuple[list[str], int, int]:
        await database[Collection.REGISTRIERUNGEN].insert_many(
            [
                *(registration(position, confirmed=True) for position in range(CONFIRMED_BENEATH_A_FLOOD)),
                *(registration(position, confirmed=False) for position in range(CONFIRMED_BENEATH_A_FLOOD, ROWS_ENOUGH_TO_PREFER_AN_INDEX)),
            ]
        )
        reads: Any = _SentReads(database[Collection.REGISTRIERUNGEN])
        async with database.client.start_session() as session:
            opened = await pull_open_registrierungen(registrierungen_collection=reads, saison_id=SAISON_ID, team_id=TEAM_OID, session=session)
        pipeline, *_ = reads.sent
        explained = await database.command(
            {"explain": {"aggregate": str(Collection.REGISTRIERUNGEN), "pipeline": pipeline, "cursor": {}}, "verbosity": "executionStats"}
        )
        # A pipeline pushed whole into the query layer answers at the top level, one left as stages under the cursor stage.
        stats: Any = explained.get("executionStats") or explained["stages"][0]["$cursor"]["executionStats"]
        planner: Any = explained.get("queryPlanner") or explained["stages"][0]["$cursor"]["queryPlanner"]
        served = sum(row.get("einwilligung") is not None for row in opened.rows)

        return index_names(planner["winningPlan"]), stats["totalDocsExamined"], served

    indexes, examined, served = await on_the_shipped_schema(mongo_replica_set_url, body)

    assert served == CONFIRMED_BENEATH_A_FLOOD
    assert indexes == [CONFIRMED_QUEUE_INDEX]
    assert examined == CONFIRMED_BENEATH_A_FLOOD


KEY_LOOKUP_SCAN = "IXSCAN { idempotency_key: 1 }"


def _contact(first_name: str, phone: str) -> dict[str, str]:
    return {"first_name": first_name, "last_name": "Mustermann", "email": f"{first_name.lower()}@example.com", "phone": phone}


async def _replayed_application(watched: AsyncDatabase, client: AsyncMongoClient) -> Any:
    """A press repeating a stored key: the lookup is its first read, and it answers the stored row with nothing else read."""

    return await post_bewerbung(
        bewerbung_data=FLPostBewerbungPayload.model_validate(
            {
                "saison_id": SAISON_ID,
                "team_id": str(TEAM_OID),
                "schule": None,
                "kontakte": {
                    "trainer": _contact("Wraxlington", "+49 171 3920011"),
                    "ansprechperson": _contact("Quillhilde", "+49 171 3920022"),
                    "stellvertretung": _contact("Bramblewick", "+49 171 3920033"),
                    "trainer_is_also": None,
                },
                "trikot": {"existing_set": "16 rote Trikots, Größe M", "wunschfarbe": "rot"},
                "kader": {"expected_size": 14, "good_spieler": 3},
                "stufengroesse": 90,
            }
        ),
        idempotency_key=UUID(IDEMPOTENCY_KEY),
        bewerbungen_collection=watched[Collection.BEWERBUNGEN],
        saisons_collection=watched[Collection.SAISONS],
        teams_collection=watched[Collection.TEAMS],
        saison_teams_collection=watched[Collection.SAISON_TEAMS],
        outbox_collection=watched[Collection.OUTBOX],
        mailbox_anchors_collection=watched[Collection.MAILBOX_ANCHORS],
        db=client,
        today="2026-03-16",
        germany_now=MAIL_NOW,
    )


async def _replayed_registration(watched: AsyncDatabase, client: AsyncMongoClient) -> Any:
    """The registration's twin of `_replayed_application`."""

    return await post_registrierung(
        registrierung_data=FLPostRegistrierungPayload.model_validate(
            {
                "token": "link",
                "first_name": "Thessaly",
                "last_name": "Okonkwo-Brandt",
                "email": "thessaly@example.com",
                "position": "Mittelfeld",
                "nummer": "17",
                "stufe": "Q1",
            }
        ),
        idempotency_key=UUID(IDEMPOTENCY_KEY),
        registrierungen_collection=watched[Collection.REGISTRIERUNGEN],
        invitations_collection=watched[Collection.INVITATIONS],
        saisons_collection=watched[Collection.SAISONS],
        saison_teams_collection=watched[Collection.SAISON_TEAMS],
        saison_spieler_collection=watched[Collection.SAISON_SPIELER],
        outbox_collection=watched[Collection.OUTBOX],
        mailbox_anchors_collection=watched[Collection.MAILBOX_ANCHORS],
        db=client,
        today="2026-03-16",
        germany_now=MAIL_NOW,
    )


def _key_lookup_on(collection: Collection) -> Wanted:
    return lambda sent_to, command: sent_to == collection and "idempotency_key" in (command.get("filter") or {})


@pytest.mark.parametrize(
    ("seeded", "read", "wanted", "planned"),
    [
        pytest.param(
            Collection.BEWERBUNGEN,
            _replayed_application,
            _key_lookup_on(Collection.BEWERBUNGEN),
            [(Collection.BEWERBUNGEN, KEY_LOOKUP_SCAN)],
            id="the application's key lookup",
        ),
        pytest.param(
            Collection.REGISTRIERUNGEN,
            _replayed_registration,
            _key_lookup_on(Collection.REGISTRIERUNGEN),
            [(Collection.REGISTRIERUNGEN, KEY_LOOKUP_SCAN)],
            id="the registration's key lookup",
        ),
    ],
)
async def test_a_read_over_rows_a_stranger_writes_walks_its_index(
    mongo_replica_set_url: str,
    seeded: Collection,
    read: Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]],
    wanted: Wanted,
    planned: Any,
):
    """Each read as its endpoint sends it, planned by the server: a public form grows these collections with every press.

    A read losing its index answers the same over a scan, a scan whose work grows with every row a flood adds, so only the
    plan shows it.
    """

    async def body(database: AsyncDatabase) -> list[tuple[str, str]]:
        await database[Collection.SAISONS].insert_one(valid_document(Collection.SAISONS))
        await database[seeded].insert_one(valid_document(seeded, idempotency_key=IDEMPOTENCY_KEY))
        _, plans = await plans_of_sent_reads(mongo_replica_set_url, database, read, wanted)

        return plans

    assert await on_the_shipped_schema(mongo_replica_set_url, body) == planned


OTHER_SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607200010")


class TestTwoRefereesOpenRowsOnOneAnsetzung:
    async def test_each_referee_holds_an_open_row_of_their_own(self, mongo_replica_set_url: str):
        """The mint inserts a new referee's row while the close's share still leaves the old one's open.

        Without the referee key that insert collides, passing the fixture over every pass until the close shuts the old row.
        """

        async def body(database: AsyncDatabase) -> int:
            for row_id, schiedsrichter_id in ((SPIELBESTAETIGUNG_OID, SCHIEDSRICHTER_OID), (SPIELER_OID, OTHER_SCHIEDSRICHTER_OID)):
                await database[Collection.SPIELBESTAETIGUNGEN].insert_one(
                    valid_document(
                        Collection.SPIELBESTAETIGUNGEN,
                        _id=row_id,
                        party={"kind": "schiedsrichter", "schiedsrichter_id": schiedsrichter_id},
                    )
                )
            return await database[Collection.SPIELBESTAETIGUNGEN].count_documents({"answer": None, "closed": None})

        assert await on_the_shipped_schema(mongo_replica_set_url, body) == 2
