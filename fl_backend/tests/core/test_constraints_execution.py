import traceback
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any, Final

import pytest
from bson import ObjectId
from fastapi import FastAPI
from pydantic import SecretStr
from pymongo import ASCENDING
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

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
CONFLICTING_SUPPORT_INDEX = "address_change_email"
# The same planting for the TTL kind: the name is claimed and the keys disagree.
CONFLICTING_TTL_INDEX = "action_log_retention"


# The seat as its applicant named the person, and as that person then confirmed it.
SEATED: Final = {"date": "2026-01-15"}


def kontaktperson(first_name: str) -> dict[str, Any]:
    """A function rather than a constant: the nested consent has to be fresh per seat too, which a `dict()` of a shared one is not."""
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
            # Distinct per seat, so a block copied across with two seats swapped fails rather than compares equal.
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
    # Both rows open, one party, one Ansetzung, differing in when they were asked: the index refuses on its nine keys
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
assert DUPLICATE_PAIRS.keys() == {index.document["name"] for _, index in UNIQUE_INDEXES}


@pytest.mark.parametrize(
    ("collection", "first", "second"),
    [pytest.param(collection, *DUPLICATE_PAIRS[index.document["name"]], id=index.document["name"]) for collection, index in UNIQUE_INDEXES],
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
    """An answered row, a closed one and the other club's open one stand beside a party's open row on one Ansetzung.

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
    """The refusal names the index it was building and answers the server's refusal, whose message its traceback leaves out.

    For a duplicate that message quotes the duplicated value, and uvicorn logs a failed start's traceback whole.
    """

    if named not in str(failure):
        return f"raised the wrong thing: {failure}"
    if not isinstance(failure.__context__, OperationFailure):
        return f"raised without the server's refusal: {failure}"
    return "raised" if str(failure.__context__) not in "".join(traceback.format_exception(failure)) else "printed the server's message"


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
        await database[Collection.ADDRESS_CHANGES].create_index([("token_hashes", ASCENDING)], name=CONFLICTING_SUPPORT_INDEX)
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
        for collection, index in SUPPORT_INDEXES:
            name, declared = index.document["name"], index.document.get("collation")
            built = {existing["name"]: existing async for existing in await database[collection].list_indexes()}
            assert name in built, f"{name} missing from {collection}: {sorted(built)}"
            # Read back too: one built under another collation serves none of the reads it is declared for.
            locale = (built[name].get("collation") or {}).get("locale")
            assert locale == (declared or {}).get("locale"), f"{name} is built under {locale}, declared {declared}"

    await on_the_shipped_schema(mongo_replica_set_url, body)


async def test_every_declared_ttl_index_is_built_over_its_key_with_its_bound(mongo_replica_set_url: str):
    """`expireAfterSeconds` is what makes it a TTL index at all, and one built without it serves reads and expires nothing."""

    async def body(database: AsyncDatabase) -> list[tuple[str, Any, Any]]:
        read_back = []
        for collection, ttl in TTL_INDEXES:
            name = ttl.document["name"]
            built = {index["name"]: index async for index in await database[collection].list_indexes()}
            assert name in built, f"{name} missing from {collection}: {sorted(built)}"
            read_back.append((name, built[name].get("expireAfterSeconds"), dict(built[name]["key"])))
        return read_back

    # Read back rather than assumed: an index is only ever ADDED
    # (`app/core/constraints.py :: apply_constraints`), so a changed bound reaches the declaration
    # and never a database that already holds the name.
    assert await on_the_shipped_schema(mongo_replica_set_url, body) == [
        (ttl.document["name"], ttl.document["expireAfterSeconds"], dict(ttl.document["key"])) for _, ttl in TTL_INDEXES
    ]


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
