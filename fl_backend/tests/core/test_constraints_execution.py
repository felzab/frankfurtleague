"""
The constraints applied by a real MongoDB (ADR-0027, ADR-0030).

The sibling `test_constraints.py` asserts what the declarations SAY; this asserts what the engine DOES
with them. Both are needed for the usual reason — a structural test fails when a rule is deleted, an
executing one when a rule is present but does not bite — and for one specific to `$jsonSchema`: its
semantics are quietly non-obvious. `required` inside a nullable sub-schema applies only when the value
is an object, `bsonType: "int"` refuses a double that prints as `80.0`, and a missing key is indexed as
null. Every one of those is asserted below rather than assumed.

The rejection cases are the defects that motivated the ADR, not invented ones: a `team_id` holding a
team's name, and a rent stored as a double. Both are in the live database today.

Every test here is marked `db` and therefore deselected by default. Run them with:

    cd fl_backend && uv run pytest -m db
"""

import asyncio
import secrets
from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import OperationFailure

from app.core.constraints import (
    ABSENT_COLLECTION_NAME,
    COLLECTION_VALIDATORS,
    UNIQUE_INDEXES,
    apply_constraints,
    probe_collmod_privilege,
    probe_privileges,
    report_duplicates,
    report_identity,
    report_violations,
)

pytestmark = pytest.mark.db

# The server's code for "this write failed the collection's validator", as opposed to any other
# OperationFailure. Asserted on rather than caught broadly, so a test cannot pass because the insert
# failed for an unrelated reason.
DOCUMENT_VALIDATION_FAILED = 121

DATABASE_NAME = "fl_constraints_test"

SAISON_ID = "2026"
TEAM_OID = ObjectId("6890a1b2c3d4e5f607200001")
SPIELER_OID = ObjectId("6890a1b2c3d4e5f607200002")
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f607200003")
SPIELORT_OID = ObjectId("6890a1b2c3d4e5f607200004")
SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607200005")

ADDRESS = {"strasse": "Hanauer Landstraße", "hausnummer": "12a", "plz": "60314", "stadtteil": "Ostend", "stadt": "Frankfurt am Main"}


def valid_documents() -> dict[str, dict[str, Any]]:
    """One conforming document per collection, rebuilt on every call so no test can mutate another's."""
    return {
        "saisons": {
            "_id": SAISON_ID,
            "start_date": "2026-01-01",
            "end_date": "2026-06-30",
            "status": "active",
            "rules": {
                "win_points": 3,
                "draw_points": 1,
                "qualifiers_per_group": 2,
                "number_of_groups": 4,
                "teams_per_group": 4,
                # Which levels this season offers -- a subset of the league's set (ADR-0061).
                "erlaubte_stufen": ["E1", "E2", "Q1", "Q2", "Q3", "Q4"],
            },
        },
        "teams": {
            "_id": TEAM_OID,
            "name": "Lessing",
            "shorthand": "LE",
            "description": "",
            "full_name": "Lessing-Gymnasium",
            "website_url": "https://lessing-gymnasium.example.de",
            "address": dict(ADDRESS),
            "inactive_since": None,
        },
        "saison_teams": {"saison_id": SAISON_ID, "team_id": TEAM_OID, "gruppe": "A", "disqualifikation": None},
        "spieler": {"_id": SPIELER_OID, "vorname": "Max", "nachname": "Mustermann", "inactive_since": None},
        "saison_spieler": {
            "spieler_id": SPIELER_OID,
            "saison_id": SAISON_ID,
            "team_id": TEAM_OID,
            "is_nachgetragen": False,
            "is_captain": False,
            "stufe": "Q2",
            # `Angriff`, not `Sturm`: the two named the same position and the set closed on this one
            # (ADR-0061). A "valid document" spelling it the other way is one the validator refuses.
            "position": "Angriff",
            "nummer": "10",
            "inactive_since": None,
        },
        "spiele": {
            "team1": {"team_id": TEAM_OID, "name": "Lessing", "tore": 2, "shorthand": "LE"},
            "team2": {"team_id": SPIELER_OID, "name": "Helmholtz", "tore": 1, "shorthand": "HE"},
            "team1_quelle": None,
            "team2_quelle": None,
            "datum": "2026-03-15",
            "uhrzeit": "18:00:00",
            "ort": {"spielort_id": SPIELORT_OID, "name": "Sportplatz Ost", "maps_link": "Sportplatz Ost, Frankfurt", "mietpreis": 80},
            "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER_OID, "name": "A. Referee", "payment": 20},
            "ergebnis": "2:1",
            # Null on every fixture that did not finish level, which is almost all of them (ADR-0044).
            "elfmeterschiessen": None,
            "spieltag_id": SPIELTAG_OID,
            "spiel_nr": 1,
            "is_canceled": False,
            "saison_phase": "gruppenphase",
            "saison_id": SAISON_ID,
        },
        "spieltage": {
            "_id": SPIELTAG_OID,
            # No `name` and no `anzahl_spiele`: the first is composed by the reader (ADR-0064) and the
            # second is derived from the season's rules (ADR-0065). Neither is on a document, so neither
            # belongs in one the validator is asked to accept.
            "beginn": "2026-03-15",
            "ende": "2026-03-15",
            "saison_phase": "gruppenphase",
            "saison_id": SAISON_ID,
            "inactive_since": None,
        },
        "spielorte": {
            "_id": SPIELORT_OID,
            "name": "Sportplatz Ost",
            "address": dict(ADDRESS),
            "maps_link": "Sportplatz Ost, Frankfurt",
            "default_mietpreis": 80,
            "inactive_since": None,
        },
        "schiedsrichter": {
            "_id": SCHIEDSRICHTER_OID,
            "name": "A. Referee",
            "schule": None,
            "default_payment": 20,
            "kontakt": {"telefon": None, "email": None},
            "inactive_since": None,
        },
    }


def valid_document(collection: str, **overrides: Any) -> dict[str, Any]:
    """A conforming document with the one field under test replaced."""
    document = valid_documents()[collection]
    document.update(overrides)
    return document


Body = Callable[[AsyncIOMotorDatabase], Awaitable[Any]]


def on_a_database(container: Any, body: Body, *, constrained: bool = True) -> Any:
    """
    Run `body` against an empty database, optionally with the constraints already applied, then drop it.

    One client and one event loop per call, deliberately. Motor binds to the loop it first runs on, so
    a client shared across `asyncio.run` calls works right up until it does not, and the symptom reads
    as a flake rather than as the fixture design it is. Applying to an empty database costs
    milliseconds, so the isolation is close to free — and it is what lets a unique-index test insert
    two colliding documents without any other test seeing them.

    `constrained=False` is the production ordering in miniature: documents already in place, then the
    constraints arriving on top of them.
    """

    async def _run() -> Any:
        client = AsyncIOMotorClient(container.get_connection_url())
        try:
            await client.drop_database(DATABASE_NAME)
            database = client[DATABASE_NAME]
            if constrained:
                await apply_constraints(database)
            return await body(database)
        finally:
            await client.drop_database(DATABASE_NAME)
            client.close()

    return asyncio.run(_run())


def insert_outcome(container: Any, collection: str, document: dict[str, Any]) -> str:
    """`"accepted"`, or `"rejected"` when the collection's validator refused the write."""

    async def body(database: AsyncIOMotorDatabase) -> str:
        try:
            await database[collection].insert_one(document)
        except OperationFailure as failure:
            assert failure.code == DOCUMENT_VALIDATION_FAILED, f"expected a validation failure, got {failure.code}: {failure}"
            return "rejected"
        return "accepted"

    return on_a_database(container, body)


@pytest.mark.parametrize("collection", sorted(COLLECTION_VALIDATORS))
def test_a_conforming_document_is_accepted(mongo_container: Any, collection: str):
    """
    The half that is easy to forget, and the half that takes the site down when it is wrong.

    A validator that rejects everything enforces its rule perfectly and makes the collection
    unwritable. These nine documents are the shapes production actually stores.
    """
    assert insert_outcome(mongo_container, collection, valid_documents()[collection]) == "accepted"


@pytest.mark.parametrize(
    ("collection", "document", "why"),
    [
        # The incident that motivated ADR-0027. Two live rows hold the team's full_name here: unique,
        # well-formed as a string, and wrong — which is why type enforcement was the half that mattered.
        ("saison_spieler", valid_document("saison_spieler", team_id="Lessing-Gymnasium"), "a team name where a reference belongs"),
        # The second finding. Every double in the live data is integral (80.0, 0.0), so Pydantic accepts
        # them all and nothing looks wrong until something rounds.
        (
            "spiele",
            valid_document("spiele", ort={**valid_documents()["spiele"]["ort"], "mietpreis": 80.0}),
            "a rent stored as a double",
        ),
        ("saison_teams", valid_document("saison_teams", gruppe="E"), "a fifth group"),
        ("saisons", valid_document("saisons", status="current"), "a status outside the Literal"),
        # "playoffs" is a query-only alias for "not gruppenphase" and is never a stored value.
        ("spiele", valid_document("spiele", saison_phase="playoffs"), "a query alias stored as a phase"),
        (
            "spiele",
            valid_document("spiele", team1={"team_id": TEAM_OID, "name": "Lessing", "tore": "2", "shorthand": "LE"}),
            "goals as a string",
        ),
        # The shoot-out object has no variants, so unlike `teamN_quelle` the validator covers all of it
        # (ADR-0044) -- both counts required, both typed.
        (
            "spiele",
            valid_document("spiele", ergebnis="2:2", elfmeterschiessen={"team1": "4", "team2": 3}),
            "a shoot-out count stored as a string",
        ),
        (
            "spiele",
            valid_document("spiele", ergebnis="2:2", elfmeterschiessen={"team1": 4}),
            "a shoot-out with only one side",
        ),
        # `beginn` rather than a count: `anzahl_spiele` left this validator with ADR-0065, so nothing
        # rejects it any more -- a matchday's expected count is derived on read and is on no document.
        # A date stored as a number is the same class of defect on a field the validator does constrain.
        ("spieltage", valid_document("spieltage", beginn=20260315), "a date stored as a number"),
        ("spieler", valid_document("spieler", vorname=None), "a player with no first name"),
        ("teams", {k: v for k, v in valid_documents()["teams"].items() if k != "full_name"}, "a missing required field"),
        ("schiedsrichter", valid_document("schiedsrichter", kontakt={"telefon": "030 123"}), "a kontakt missing half its shape"),
    ],
    ids=lambda value: value if isinstance(value, str) else "",
)
def test_a_malformed_document_is_rejected(mongo_container: Any, collection: str, document: dict[str, Any], why: str):
    assert insert_outcome(mongo_container, collection, document) == "rejected", f"the validator let through {why}"


def test_an_absent_embedded_object_is_still_accepted(mongo_container: Any):
    """
    A match with no venue and no referee, which is an ordinary fixture before it is scheduled.

    `ort` names four required keys inside a schema that also permits null, and this is the assertion
    that the two do not fight: MongoDB applies `required` only when the value really is an object.
    """
    assert insert_outcome(mongo_container, "spiele", valid_document("spiele", ort=None, schiedsrichter=None)) == "accepted"


@pytest.mark.parametrize(
    ("collection", "first", "second"),
    [
        ("saison_teams", valid_documents()["saison_teams"], valid_document("saison_teams", gruppe="B")),
        ("saison_spieler", valid_documents()["saison_spieler"], valid_document("saison_spieler", nummer="11")),
        ("spiele", valid_documents()["spiele"], valid_document("spiele", ergebnis="0:0")),
        ("teams", valid_documents()["teams"], valid_document("teams", _id=SPIELER_OID, name="Lessing II")),
    ],
    ids=[index.name for index in UNIQUE_INDEXES],
)
def test_each_unique_index_refuses_the_second_document(mongo_container: Any, collection: str, first: dict[str, Any], second: dict[str, Any]):
    """Each of the four rules that was true in the data and enforced by nobody."""

    async def body(database: AsyncIOMotorDatabase) -> str:
        await database[collection].insert_one(first)
        try:
            await database[collection].insert_one(second)
        except OperationFailure as failure:
            return f"rejected:{failure.code}"
        return "accepted"

    # 11000 is DuplicateKey, not 121 — an index refuses the write before any validator sees it.
    assert on_a_database(mongo_container, body) == "rejected:11000"


def test_the_same_spiel_nr_in_another_season_is_fine(mongo_container: Any):
    """The index is compound for a reason: match 1 exists in every season the league has ever run."""

    async def body(database: AsyncIOMotorDatabase) -> int:
        await database.spiele.insert_one(valid_documents()["spiele"])
        await database.spiele.insert_one(valid_document("spiele", saison_id="2025"))
        return await database.spiele.count_documents({})

    assert on_a_database(mongo_container, body) == 2


def test_every_validator_is_attached_strictly(mongo_container: Any):
    """
    `strict` and `error`, read back off the server rather than off the constant that set them.

    `moderate` would exempt documents that do not currently validate — precisely the set worth
    catching — and `warn` writes to a server log nobody reads and lets the write land anyway.
    """

    async def body(database: AsyncIOMotorDatabase) -> dict[str, tuple[bool, str, str]]:
        found = {}
        async for collection in await database.list_collections():
            options = collection.get("options", {})
            found[collection["name"]] = (
                "validator" in options,
                options.get("validationLevel", ""),
                options.get("validationAction", ""),
            )
        return found

    attached = on_a_database(mongo_container, body)
    assert set(attached) == set(COLLECTION_VALIDATORS)
    assert all(value == (True, "strict", "error") for value in attached.values()), attached


def test_applying_twice_changes_nothing(mongo_container: Any):
    """
    Idempotency is not a nicety here: this runs on every boot, and a redeploy is a restart.

    A second `create_index` with the same name and options is a no-op; one with different options is an
    error. This is the assertion that the declared options match what the first run actually built.
    """

    async def body(database: AsyncIOMotorDatabase) -> tuple[int, int]:
        second = await apply_constraints(database)
        built = 0
        for index in UNIQUE_INDEXES:
            names = [existing["name"] async for existing in database[index.collection].list_indexes()]
            assert index.name in names, f"{index.name} missing from {index.collection}: {names}"
            built += 1
        return second.validators, built

    assert on_a_database(mongo_container, body) == (len(COLLECTION_VALIDATORS), len(UNIQUE_INDEXES))


def test_the_startup_apply_fails_rather_than_skipping_a_broken_index(mongo_container: Any):
    """
    The failure mode ADR-0027 accepted, asserted so it stays a failure.

    A unique index cannot be built over data that already violates it. The tempting fix — catch it,
    log it, carry on — would leave a database that looks constrained and is not, which is the one
    outcome worse than having no index at all.
    """

    async def body(database: AsyncIOMotorDatabase) -> str:
        await database.teams.insert_many([valid_documents()["teams"], valid_document("teams", _id=SPIELER_OID, name="Lessing II")])
        try:
            await apply_constraints(database)
        except RuntimeError as failure:
            return "raised" if "uniq_shorthand" in str(failure) else f"raised the wrong thing: {failure}"
        return "carried on"

    assert on_a_database(mongo_container, body, constrained=False) == "raised"


@pytest.mark.parametrize("constrained", [False, True], ids=["target absent", "target present"])
def test_the_privilege_probe_answers_granted_and_writes_nothing(mongo_container: Any, constrained: bool):
    """
    The container authenticates as root, so the answer is "granted" — what is asserted is the cost.

    Both server replies are exercised: an empty database answers `NamespaceNotFound` and a constrained
    one answers `IndexNotFound`, and the probe must read either as "the action is held". The second is
    the case that matters, because a populated database is what it meets in production.

    Nothing may change either way — no collection created, and no index left hidden on a real one.
    """

    async def body(database: AsyncIOMotorDatabase) -> tuple[str, list[str], list[str]]:
        answer = await probe_collmod_privilege(database)
        target = next(iter(COLLECTION_VALIDATORS))
        hidden = [index["name"] async for index in database[target].list_indexes() if index.get("hidden")]
        return answer, await database.list_collection_names(), hidden

    answer, collections, hidden = on_a_database(mongo_container, body, constrained=constrained)
    assert answer == "granted"
    assert ABSENT_COLLECTION_NAME not in collections
    assert hidden == []


def test_every_needed_privilege_is_reported_independently(mongo_container: Any):
    """
    One report names every gap, rather than one gap per run.

    A readWrite-only user holds `find` and lacks `collMod`, so this is the mixed verdict the table
    exists for — an all-or-nothing answer would have hidden one of the two.
    """
    username = f"limited_{secrets.token_hex(4)}"
    password = secrets.token_hex(16)

    async def body(database: AsyncIOMotorDatabase) -> list[tuple[str, str]]:
        await database.command("createUser", username, pwd=password, roles=[{"role": "readWrite", "db": DATABASE_NAME}])
        limited = AsyncIOMotorClient(
            host=mongo_container.get_container_host_ip(),
            port=int(mongo_container.get_exposed_port(27017)),
            username=username,
            password=password,
            authSource=DATABASE_NAME,
        )
        try:
            return await probe_privileges(limited[DATABASE_NAME])
        finally:
            limited.close()
            await database.command("dropUser", username)

    verdicts = dict(on_a_database(mongo_container, body, constrained=False))
    assert verdicts["find"] == "granted"
    assert verdicts["collMod"].startswith("DENIED")


def test_the_privilege_probe_says_denied_for_a_readwrite_user(mongo_container: Any):
    """
    The load-bearing claim of ADR-0027's rollout, executed rather than read off a documentation page.

    `readWrite` grants `createIndex` but not `collMod`, so a user holding it builds all four indexes
    and attaches no validators — and the application then refuses to start. Everything about the Atlas
    role setup rests on that being true of a real server, so a real server is asked.
    """
    username = f"limited_{secrets.token_hex(4)}"
    password = secrets.token_hex(16)

    async def body(database: AsyncIOMotorDatabase) -> str:
        await database.command("createUser", username, pwd=password, roles=[{"role": "readWrite", "db": DATABASE_NAME}])
        limited = AsyncIOMotorClient(
            host=mongo_container.get_container_host_ip(),
            port=int(mongo_container.get_exposed_port(27017)),
            username=username,
            password=password,
            authSource=DATABASE_NAME,
        )
        try:
            return await probe_collmod_privilege(limited[DATABASE_NAME])
        finally:
            limited.close()
            await database.command("dropUser", username)

    assert on_a_database(mongo_container, body, constrained=False).startswith("DENIED")


def test_the_check_mode_finds_what_the_validators_would_reject(mongo_container: Any):
    """
    `--check` previews the apply, and this is the proof that the preview is exact.

    It reads the same validator document back as a QUERY — `$jsonSchema` is both — so there is no
    second implementation of the rule to disagree with the first. Run against documents inserted
    before the constraints existed, which is exactly the live situation it was written for.
    """

    async def body(database: AsyncIOMotorDatabase) -> tuple[int, list[Any], int]:
        await database.saison_spieler.insert_many(
            [
                valid_documents()["saison_spieler"],
                valid_document("saison_spieler", spieler_id=SPIELTAG_OID, team_id="Lessing-Gymnasium"),
            ]
        )
        # Two junction rows for one player in one season, which is the rule the index enforces.
        await database.saison_teams.insert_many([valid_documents()["saison_teams"], valid_document("saison_teams", gruppe="B")])

        violations = {report.collection: report for report in await report_violations(database)}
        duplicates = {report.index.name: report for report in await report_duplicates(database)}

        return (
            violations["saison_spieler"].failing,
            violations["saison_spieler"].examples,
            duplicates["uniq_saison_id_team_id"].groups,
        )

    failing, examples, duplicate_groups = on_a_database(mongo_container, body, constrained=False)
    assert failing == 1
    assert len(examples) == 1
    assert duplicate_groups == 1


def test_the_identity_report_names_the_user_and_its_roles(mongo_container: Any):
    """
    The instrument for "the role is right and on the wrong user", which no privilege probe can see.

    A correct role attached to the wrong credential refuses exactly like a broken role, so the report
    has to name who the server thinks it is talking to. Asserted against a user built for the purpose,
    since the container's root user carries roles the test would have to hardcode.
    """
    username = f"named_{secrets.token_hex(4)}"
    password = secrets.token_hex(16)

    async def body(database: AsyncIOMotorDatabase) -> tuple[str, list[str]]:
        await database.command("createUser", username, pwd=password, roles=[{"role": "readWrite", "db": DATABASE_NAME}])
        named = AsyncIOMotorClient(
            host=mongo_container.get_container_host_ip(),
            port=int(mongo_container.get_exposed_port(27017)),
            username=username,
            password=password,
            authSource=DATABASE_NAME,
        )
        try:
            return await report_identity(named[DATABASE_NAME])
        finally:
            named.close()
            await database.command("dropUser", username)

    identity, roles = on_a_database(mongo_container, body, constrained=False)
    assert identity == username
    assert f"readWrite@{DATABASE_NAME}" in roles
