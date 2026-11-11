import secrets
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any, Final

import pytest
from bson import ObjectId
from pymongo import ASCENDING
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.registrierungen.crud import pull_open_registrierungen
from app.core.collections import Collection
from app.core.constraints import (
    SUPPORT_INDEXES,
    TTL_INDEXES,
    UNIQUE_INDEXES,
    apply_constraints,
)
from app.shared.tokens import hash_token
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import (
    address_change_document,
    aufstellung_document,
    bericht_document,
    kontaktperson_document,
    minted_confirmations,
    outbox_document,
    registrierung_confirmed,
    registrierung_document,
    spiel_document,
    spielbericht_document,
    spielbestaetigung_document,
    spieler_document,
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
CONFLICTING_SUPPORT_INDEX = "address_change_token_hashes"
# The same planting for the TTL kind: the name is claimed and the keys disagree.
CONFLICTING_TTL_INDEX = "action_log_retention"
ADDRESS = {"street": "Hanauer Landstraße", "house_number": "12a", "postcode": "60314", "district": "Ostend", "city": "Frankfurt am Main"}


# The seat as its applicant named the person, and as that person then confirmed it.
SEATED: Final = {"date": "2026-01-15"}


def kontaktperson(first_name: str) -> dict[str, Any]:
    """A function rather than a constant: the nested consent has to be fresh per slot too, which a `dict()` of a shared one is not."""
    return kontaktperson_document(first_name, confirmed_at="2026-01-16", einwilligung=SEATED, phone="+49 69 1234567", birth_date="1980-05-04")


def valid_documents() -> dict[str, dict[str, Any]]:
    """Rebuilt on every call, so no test can mutate another's document."""
    return {
        "saisons": {
            "_id": SAISON_ID,
            "start_date": "2026-01-01",
            "end_date": "2026-06-30",
            "status": "active",
            "rules": {
                "win_points": 3,
                "draw_points": 1,
                "loss_points": 0,
                "qualifiers_per_gruppe": 2,
                "number_of_gruppen": 4,
                "teams_per_gruppe": 4,
                "tiebreak_order": "tordifferenz",
                "max_kader_size": 18,
                "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
                # Which levels this season offers — a subset of the league's set.
                "allowed_stufen": ["E1", "E2", "Q1", "Q2", "Q3", "Q4"],
            },
            "bewerbung": None,
            "registrierung": None,
            "version": 0,
        },
        "teams": {
            "_id": TEAM_OID,
            "name": "Lessing",
            "shorthand": "LEX",
            "description": "",
            "full_name": "Lessing-Gymnasium",
            "website_url": "https://lessing-gymnasium.example.de",
            "address": dict(ADDRESS),
            "schulform": None,
            "inactive_since": None,
            "version": 0,
        },
        # `name` and `shorthand` are the season's own copy of the club's identity, required since the
        # junction became their home; a row without them is unreadable rather than merely stale.
        "saison_teams": {
            "saison_id": SAISON_ID,
            "team_id": TEAM_OID,
            "gruppe": "A",
            "austritt": None,
            "trikot_farbe": None,
            "kontakte": None,
            "name": "Lessing",
            "shorthand": "LEX",
            "version": 0,
        },
        "spieler": spieler_document(SPIELER_OID, "Max", "Mustermann"),
        "saison_spieler": {
            "spieler_id": SPIELER_OID,
            "saison_id": SAISON_ID,
            "team_id": TEAM_OID,
            "is_nachnominiert": False,
            "rolle": None,
            "stufe": "Q2",
            "position": "Angriff",
            "nummer": "10",
            "inactive_since": None,
            "version": 0,
        },
        "spiele": {
            "team1": {"team_id": TEAM_OID, "tore": 2},
            "team2": {"team_id": SPIELER_OID, "tore": 1},
            "team1_quelle": None,
            "team2_quelle": None,
            "date": "2026-03-15",
            "time": "18:00:00",
            "spielort": {"spielort_id": SPIELORT_OID, "mietpreis": 80},
            "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER_OID, "payment": 20},
            "ergebnis": "2:1",
            "elfmeterschiessen": None,
            "spieltag_id": SPIELTAG_OID,
            "spiel_nr": 1,
            "sonderereignis": None,
            "saison_phase": "gruppenphase",
            "saison_id": SAISON_ID,
            "version": 0,
        },
        "spieltage": {
            "_id": SPIELTAG_OID,
            # No `name` and no `count_spiele`: one is composed by the reader, the other derived, and neither stored.
            "start": "2026-03-15",
            "end": "2026-03-15",
            "position": 1,
            "saison_phase": "gruppenphase",
            "saison_id": SAISON_ID,
            "version": 0,
        },
        "spielorte": {
            "_id": SPIELORT_OID,
            "name": "Sportplatz Ost",
            "address": dict(ADDRESS),
            "maps_link": "Sportplatz Ost, Frankfurt",
            "default_mietpreis": 80,
            "inactive_since": None,
            "version": 0,
        },
        "schiedsrichter": {
            "_id": SCHIEDSRICHTER_OID,
            "name": "A. Referee",
            "schule": None,
            "default_payment": 20,
            "kontakt": {"phone": None, "email": None},
            "inactive_since": None,
            "version": 0,
        },
        # Undecided, proposing a school rather than picking a club: both are nullable and exactly
        # one carries a value, a write-path rule.
        "bewerbungen": {
            "_id": BEWERBUNG_OID,
            "saison_id": SAISON_ID,
            "submitted_at": "2026-02-01",
            "status": "submitted",
            "team_id": None,
            "schule": {
                "team_name": "Lessing",
                "full_name": "Lessing-Gymnasium",
                "schulform": "gymnasium_g9",
                "address": dict(ADDRESS),
                "website_url": "https://lessing-gymnasium.example.de",
            },
            # Distinct per slot, so a block copied across with two slots swapped fails rather than compares equal.
            "kontakte": {
                "trainer": kontaktperson("Wraxlington"),
                "ansprechperson": kontaktperson("Quillhilde"),
                "stellvertretung": kontaktperson("Bramblewick"),
                "trainer_is_also": None,
            },
            "trikot": {"existing_set": "16 rote Trikots, Größe M", "wunschfarbe": "rot"},
            "kader": {"expected_size": 14, "good_spieler": 3},
            "stufengroesse": 96,
            "wunschgegner": None,
            "decision": None,
            "confirmations": minted_confirmations(
                hashes={seat: hash_token(seat) for seat in ("trainer", "ansprechperson", "stellvertretung")}, today="2026-02-01"
            ),
            "version": 0,
        },
        "action_log": {
            "_id": ACTION_LOG_ENTRY_OID,
            "at": datetime(2026, 3, 15, 9, 30, 0, tzinfo=UTC),
            "by": "admin@example.invalid",
            "team": None,
            "action": "team.changed",
            "record_id": TEAM_OID,
            "label": "Lessing",
            "count": None,
            "trace_id": secrets.token_hex(16),
        },
        "ban_list": {
            "_id": BAN_LIST_OID,
            "address": "gesperrt@example.invalid",
            "ban_reason": "Falsches Geburtsdatum bei der Anmeldung",
            "created_at": "2026-03-15",
            "barred_until_saison_id": "2031",
        },
        # `revoked_at` is null rather than absent because `uniq_invitation_live` reaches the rows
        # holding null.
        "invitations": {
            "_id": INVITATION_OID,
            "saison_id": SAISON_ID,
            "team_id": TEAM_OID,
            "token_hashes": ["b3c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70819200"],
            "revoked_at": None,
            "sent_at": None,
        },
        # Every key the submission writes, `birth_date`, `einwilligung` and `decision`
        # included: each is a stored null rather than an absent key, which is what `required` means.
        "registrierungen": {
            "_id": REGISTRIERUNG_OID,
            "saison_id": SAISON_ID,
            "team_id": TEAM_OID,
            "invitation_id": INVITATION_OID,
            "submitted_at": "2026-03-16",
            "status": "submitted",
            "first_name": "Thessaly",
            "last_name": "Okonkwo-Brandt",
            "email": "thessaly@example.invalid",
            "position": "Mittelfeld",
            "nummer": "17",
            "stufe": "Q1",
            "birth_date": None,
            "einwilligung": None,
            "confirmation": {
                "token_hashes": ["c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f80919200"],
                "sent_at": "2026-03-16",
                "deadline": "2026-03-23",
            },
            "decision": None,
        },
        # As the Playground paste writes one: a BSON date, and the sentinel where no administrator granted it.
        "grants": {
            "_id": GRANT_OID,
            "address": "inhaberin@example.invalid",
            "admin_tier": "owner",
            "effective_from": datetime(2026, 1, 1, tzinfo=UTC),
        },
        # An open team row as the pass mints it.
        "spielbestaetigungen": spielbestaetigung_document(
            spiel_document(
                spiel_id=SPIEL_OID,
                saison_id=SAISON_ID,
                spiel_nr=1,
                spieltag_id=SPIELTAG_OID,
                team1={"team_id": TEAM_OID, "tore": None},
                team2={"team_id": OTHER_TEAM_OID, "tore": None},
                date="2026-03-15",
                time="18:00:00",
                spielort={"spielort_id": SPIELORT_OID, "mietpreis": 80},
            ),
            party={"kind": "team", "team_id": TEAM_OID},
            _id=SPIELBESTAETIGUNG_OID,
            deadline="2026-03-08",
        ),
        "spielberichte": spielbericht_document({"_id": SPIEL_OID, "saison_id": SAISON_ID}),
        "aufstellungen": aufstellung_document({"_id": SPIEL_OID, "saison_id": SAISON_ID}, TEAM_OID, starters=[SPIELER_OID]),
        # A live change as the start stores it, its instants dates, which every read takes; and the carry an earlier
        # effect of the address left owed on it, which the record keeps beside its live fields as the model reads them.
        "address_changes": {
            "_id": ADDRESS_CHANGE_OID,
            **address_change_document(address="alt@example.invalid", email="neu@example.invalid", token_hash="a" * 64, day="2026-03-16"),
            "move": {"old": "vorher@example.invalid", "new": "alt@example.invalid"},
        },
    }


def valid_document(collection: str, **overrides: Any) -> dict[str, Any]:
    document = valid_documents()[collection]
    document.update(overrides)
    return document


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_database(url: str, body: Body) -> Any:
    """A database dropped for this call, for a body that seeds what makes `apply_constraints` fail and then calls it.

    `mutates_schema=True` records nothing of what a refusal leaves, so every call rebuilds.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=False, mutates_schema=True) as (_, database):
            return await body(database)

    return on_the_seed_loop(_run())


def on_the_shipped_schema(url: str, body: Body) -> Any:
    """A database the shipped constraints were built on ONCE, emptied for this test.

    For a body that only inserts and reads; one that breaks an index takes
    `on_a_database`'s throwaway.
    """

    async def _run() -> Any:
        async with a_clean_database(url, SHIPPED_DATABASE_NAME, constraints=True) as (_, database):
            return await body(database)

    return on_the_seed_loop(_run())


# Keyed by the index's name, so the pair proves the rule it is filed under rather than the rule that
# happens to be declared in its position; the collection comes off the declaration for the same reason.
DUPLICATE_PAIRS: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {
    "uniq_saison_id_team_id": (valid_documents()["saison_teams"], valid_document("saison_teams", gruppe="B")),
    "uniq_spieler_id_saison_id": (valid_documents()["saison_spieler"], valid_document("saison_spieler", nummer="11")),
    "uniq_saison_id_spiel_nr": (valid_documents()["spiele"], valid_document("spiele", ergebnis="0:0")),
    "uniq_shorthand": (valid_documents()["teams"], valid_document("teams", _id=SPIELER_OID, name="Lessing II")),
    # The second row differs in its price and its fee: what the index refuses on is the name alone,
    # and a pair differing in nothing else would pass while keyed on anything.
    "uniq_spielort_name": (valid_documents()["spielorte"], valid_document("spielorte", _id=TEAM_OID, default_mietpreis=90)),
    "uniq_schiedsrichter_name": (valid_documents()["schiedsrichter"], valid_document("schiedsrichter", _id=TEAM_OID, default_payment=25)),
    "uniq_saison_id_saison_phase_position": (
        valid_documents()["spieltage"],
        valid_document("spieltage", _id=SPIELORT_OID, end="2026-03-22"),
    ),
    # The second row differs in its reason and its author: the index refuses on the address alone, and
    # a pair agreeing in everything would pass while keyed on anything at all.
    "uniq_ban_list_address": (
        valid_documents()["ban_list"],
        valid_document("ban_list", _id=TEAM_OID, ban_reason="Zweiter Eintrag"),
    ),
    # Both rows live, which is the reach the `partialFilterExpression` narrows the rule to: a pair
    # whose second row carried a revocation date would pass while the filter matched anything.
    "uniq_invitation_live": (
        valid_documents()["invitations"],
        valid_document("invitations", _id=TEAM_OID, token_hashes=["c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f80910000"]),
    ),
    # Both rows keyed alike: the index refuses on the key alone, and a pair carrying no key at all would pass while
    # the partial filter matched nothing.
    "uniq_bewerbung_idempotency_key": (
        valid_document("bewerbungen", idempotency_key=IDEMPOTENCY_KEY),
        valid_document("bewerbungen", _id=TEAM_OID, idempotency_key=IDEMPOTENCY_KEY),
    ),
    "uniq_registrierung_idempotency_key": (
        valid_document("registrierungen", idempotency_key=IDEMPOTENCY_KEY),
        valid_document("registrierungen", _id=TEAM_OID, idempotency_key=IDEMPOTENCY_KEY),
    ),
    # Two persons differing in their name and sharing an address: the index refuses on the address alone.
    "uniq_spieler_email": (
        valid_document("spieler", email="pupil@example.invalid"),
        valid_document("spieler", _id=TEAM_OID, first_name="Zweite", email="pupil@example.invalid"),
    ),
    # The second row differs in its tier and its author: the index refuses on the address alone, which
    # is what refuses a paste granting an address a route already granted.
    "uniq_grant_address": (
        valid_documents()["grants"],
        valid_document("grants", _id=TEAM_OID, admin_tier="administration"),
    ),
    # Both rows open, one party, one digest, differing in when they were asked: the index refuses on its five keys
    # alone, and a pair the partial filter reached on neither side would pass.
    "uniq_spielbestaetigung_open": (
        valid_documents()["spielbestaetigungen"],
        valid_document("spielbestaetigungen", _id=TEAM_OID, asked_at="2026-03-01"),
    ),
    # Two reports of one fixture differing in their whole block: the index refuses on the fixture alone.
    "uniq_spielbericht_spiel_id": (
        valid_documents()["spielberichte"],
        valid_document("spielberichte", _id=TEAM_OID, bericht=bericht_document(remarks="Zweiter Bericht")),
    ),
    # Two line-ups of one club for one fixture, naming different pupils: the index refuses on the pair alone.
    "uniq_aufstellung_spiel_id_team_id": (
        valid_documents()["aufstellungen"],
        valid_document("aufstellungen", _id=TEAM_OID, spieler=[]),
    ),
    # Two live changes of one address, to two mailboxes: the index refuses on the address alone, both rows in its filter.
    "uniq_address_change_address": (
        valid_documents()["address_changes"],
        {
            "_id": TEAM_OID,
            **address_change_document(address="alt@example.invalid", email="zweite@example.invalid", token_hash="b" * 64, day="2026-03-16"),
        },
    ),
    # A second owner at another address: a Playground paste is the one writer that could make one, and it would hold the
    # role beside the first with nothing in the application able to take it away again.
    "uniq_grant_owner": (valid_documents()["grants"], valid_document("grants", _id=TEAM_OID, address="zweite@example.invalid")),
    "uniq_outbox_key": (
        outbox_document("ban/1", to="gesperrt@example.invalid", now=MAIL_NOW),
        outbox_document("ban/1", to="gesperrt@example.invalid", now=MAIL_NOW),
    ),
    # Two seasons, each `active`: a second row in any other status would pass while the filter matched nothing.
    "uniq_saison_active": (valid_documents()["saisons"], valid_document("saisons", _id="2027", start_date="2027-01-01", end_date="2027-06-30")),
}

# At import, and set equality rather than the `KeyError` the walk below would raise: that names a
# declared index with no pair and nothing else, leaving a pair no declared index answers to as a
# case nothing runs.
assert DUPLICATE_PAIRS.keys() == {index.name for index in UNIQUE_INDEXES}


@pytest.mark.parametrize(
    ("collection", "first", "second"),
    [pytest.param(index.collection, *DUPLICATE_PAIRS[index.name], id=index.name) for index in UNIQUE_INDEXES],
)
def test_each_unique_index_refuses_the_second_document(
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
    assert on_the_shipped_schema(mongo_replica_set_url, body) == "rejected:11000"


def test_two_ended_changes_of_one_address_are_both_kept(mongo_replica_set_url: str):
    """An ending nulls the address, so a filter on `ended` alone would hold every tombstone under one null key."""

    # A century ahead of the real clock: the TTL monitor deletes a tombstone whose retention has passed, under the count.
    ended = {"address": None, "email": None, "ended": {"kind": "declined", "at": datetime(2126, 3, 17, tzinfo=UTC)}}

    async def body(database: AsyncDatabase) -> int:
        await database.address_changes.insert_one(valid_document("address_changes", **ended))
        await database.address_changes.insert_one(
            valid_document("address_changes", _id=TEAM_OID, stop={"token_hashes": [hash_token("stop-c")]}, **ended)
        )
        return await database.address_changes.count_documents({})

    assert on_the_shipped_schema(mongo_replica_set_url, body) == 2


def test_a_second_nameless_referee_is_refused(mongo_replica_set_url: str):
    """The rule reaches every row, so the one nameless row it can ever meet is the ghost.

    A second would split the fixtures of everybody erased across two sentinels nobody can tell apart
    (`app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`).
    """

    async def body(database: AsyncDatabase) -> str:
        nameless = {**valid_documents()["schiedsrichter"], "name": None}
        await database.schiedsrichter.insert_one(nameless)
        try:
            await database.schiedsrichter.insert_one({**nameless, "_id": TEAM_OID})
        except OperationFailure as failure:
            return f"rejected:{failure.code}"
        return "accepted"

    assert on_the_shipped_schema(mongo_replica_set_url, body) == "rejected:11000"


def test_only_an_open_confirmation_meets_the_rule(mongo_replica_set_url: str):
    """An answered row, a closed one and the other club's open one stand beside a party's open row on one stand.

    A dropped filter or a lost team key refuses one, and with it a reinstated fixture's fresh request.
    """

    answer = {"kind": "agreed", "at": "2026-03-01", "by": {"kind": "kontakt", "rolle": "trainer"}, "vorschlag": None, "reason": None}

    async def body(database: AsyncDatabase) -> int:
        await database.spielbestaetigungen.insert_one(valid_documents()["spielbestaetigungen"])
        await database.spielbestaetigungen.insert_one(valid_document("spielbestaetigungen", _id=TEAM_OID, answer=answer))
        await database.spielbestaetigungen.insert_one(
            valid_document("spielbestaetigungen", _id=SPIELER_OID, closed={"at": "2026-03-02", "reason": "cancelled"})
        )
        await database.spielbestaetigungen.insert_one(
            valid_document("spielbestaetigungen", _id=SPIELTAG_OID, party={"kind": "team", "team_id": OTHER_TEAM_OID})
        )
        return await database.spielbestaetigungen.count_documents({})

    assert on_the_shipped_schema(mongo_replica_set_url, body) == 4


def _raised(failure: RuntimeError, named: str) -> str:
    """The refusal names what it was building and carries the driver's, as `app/core/constraints.py :: _apply_unique_index` raises it."""

    if named not in str(failure):
        return f"raised the wrong thing: {failure}"
    return "raised" if isinstance(failure.__cause__, OperationFailure) else f"raised without its cause: {failure}"


def test_the_startup_apply_fails_rather_than_skipping_a_broken_index(mongo_replica_set_url: str):
    """The tempting fix — catch it, log it, carry on — leaves a database that looks constrained and is not."""

    async def body(database: AsyncDatabase) -> str:
        await database.teams.insert_many([valid_documents()["teams"], valid_document("teams", _id=SPIELER_OID, name="Lessing II")])
        try:
            await apply_constraints(database)
        except RuntimeError as failure:
            return _raised(failure, "uniq_shorthand")
        return "carried on"

    assert on_a_database(mongo_replica_set_url, body) == "raised"


def test_the_startup_apply_fails_rather_than_skipping_a_broken_support_index(mongo_replica_set_url: str):
    """A support index costs speed rather than correctness, which is exactly why a boot might be tempted to shrug one off."""

    async def body(database: AsyncDatabase) -> str:
        # The same name over different keys: `create_index` refuses rather than replacing, which is
        # the one way a declared support index fails on a database holding no documents.
        await database.address_changes.create_index([("email", ASCENDING)], name=CONFLICTING_SUPPORT_INDEX)
        try:
            await apply_constraints(database)
        except RuntimeError as failure:
            return _raised(failure, CONFLICTING_SUPPORT_INDEX)
        return "carried on"

    assert on_a_database(mongo_replica_set_url, body) == "raised"


def test_the_startup_apply_fails_rather_than_skipping_a_broken_ttl_index(mongo_replica_set_url: str):
    """The third kind, and the one whose absence shows in nothing: a log that keeps every row reads exactly like a log being expired."""

    async def body(database: AsyncDatabase) -> str:
        await database.action_log.create_index([("by", ASCENDING)], name=CONFLICTING_TTL_INDEX)
        try:
            await apply_constraints(database)
        except RuntimeError as failure:
            return _raised(failure, CONFLICTING_TTL_INDEX)
        return "carried on"

    assert on_a_database(mongo_replica_set_url, body) == "raised"


def test_every_declared_support_index_is_built(mongo_replica_set_url: str):
    """`apply_constraints` creates each one, under the collation it is declared with."""

    async def body(database: AsyncDatabase) -> None:
        for index in SUPPORT_INDEXES:
            built = {existing["name"]: existing async for existing in await database[index.collection].list_indexes()}
            assert index.name in built, f"{index.name} missing from {index.collection}: {sorted(built)}"
            # Read back too: one built under another collation serves none of the reads it is declared for.
            locale = (built[index.name].get("collation") or {}).get("locale")
            assert locale == (index.collation or {}).get("locale"), f"{index.name} is built under {locale}, declared {index.collation}"

    on_the_shipped_schema(mongo_replica_set_url, body)


def test_every_declared_ttl_index_is_built_over_its_key_with_its_bound(mongo_replica_set_url: str):
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
    assert on_the_shipped_schema(mongo_replica_set_url, body) == [(ttl.name, ttl.seconds, {ttl.key: 1}) for ttl in TTL_INDEXES]


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


def test_a_teams_confirmed_registrations_are_read_past_a_flood_without_fetching_it(mongo_replica_set_url: str):
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

    indexes, examined, served = on_the_shipped_schema(mongo_replica_set_url, body)

    assert served == CONFIRMED_BENEATH_A_FLOOD
    assert indexes == [CONFIRMED_QUEUE_INDEX]
    assert examined == CONFIRMED_BENEATH_A_FLOOD


OTHER_SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607200010")


class TestTwoRefereesOpenRowsOnOneStand:
    def test_each_referee_holds_an_open_row_of_their_own(self, mongo_replica_set_url: str):
        """The mint inserts a new referee's row while the close's share still leaves the old one's open.

        Without the referee key that insert collides, passing the fixture over every pass until the close shuts the old row.
        """

        async def body(database: AsyncDatabase) -> int:
            for row_id, schiedsrichter_id in ((SPIELBESTAETIGUNG_OID, SCHIEDSRICHTER_OID), (SPIELER_OID, OTHER_SCHIEDSRICHTER_OID)):
                await database.spielbestaetigungen.insert_one(
                    valid_document(
                        "spielbestaetigungen",
                        _id=row_id,
                        party={"kind": "schiedsrichter", "schiedsrichter_id": schiedsrichter_id},
                    )
                )
            return await database.spielbestaetigungen.count_documents({"answer": None, "closed": None})

        assert on_the_shipped_schema(mongo_replica_set_url, body) == 2
