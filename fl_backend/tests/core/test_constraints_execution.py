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

# Asserted on rather than caught broadly, so an unrelated failure cannot pass as a rejection.
DOCUMENT_VALIDATION_FAILED = 121

DATABASE_NAME = "fl_constraints_test"

SAISON_ID = "2026"
TEAM_OID = ObjectId("6890a1b2c3d4e5f607200001")
SPIELER_OID = ObjectId("6890a1b2c3d4e5f607200002")
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f607200003")
SPIELORT_OID = ObjectId("6890a1b2c3d4e5f607200004")
SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607200005")
AKTION_OID = ObjectId("6890a1b2c3d4e5f607200006")

ADDRESS = {"strasse": "Hanauer Landstraße", "hausnummer": "12a", "plz": "60314", "stadtteil": "Ostend", "stadt": "Frankfurt am Main"}


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
                "qualifiers_per_group": 2,
                "number_of_groups": 4,
                "teams_per_group": 4,
                "tiebreak_order": "tordifferenz",
                "max_kadergroesse": 18,
                "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
                # Which levels this season offers — a subset of the league's set.
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
        "saison_teams": {"saison_id": SAISON_ID, "team_id": TEAM_OID, "gruppe": "A", "austritt": None},
        "spieler": {
            "_id": SPIELER_OID,
            "vorname": "Max",
            "nachname": "Mustermann",
            "inactive_since": None,
            "einwilligung": {
                "umfang": "kader_oeffentlich",
                "erteilt_von": "erziehungsberechtigt",
                "datum": "2026-01-15",
                "bestaetigt_am": "2026-01-20",
            },
        },
        "saison_spieler": {
            "spieler_id": SPIELER_OID,
            "saison_id": SAISON_ID,
            "team_id": TEAM_OID,
            "is_nachgetragen": False,
            "is_captain": False,
            "stufe": "Q2",
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
            "elfmeterschiessen": None,
            "spieltag_id": SPIELTAG_OID,
            "spiel_nr": 1,
            "sonderereignis": None,
            "saison_phase": "gruppenphase",
            "saison_id": SAISON_ID,
        },
        "spieltage": {
            "_id": SPIELTAG_OID,
            # No `name` and no `anzahl_spiele`: one is composed by the reader, the other derived, and neither stored.
            "beginn": "2026-03-15",
            "ende": "2026-03-15",
            "position": 1,
            "saison_phase": "gruppenphase",
            "saison_id": SAISON_ID,
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
        "aktionen": {
            "_id": AKTION_OID,
            "at": "2026-03-15T09:30:00+00:00",
            "actor": {"kind": "admin_session", "email": "admin@example.invalid"},
            "correlation_id": secrets.token_hex(16),
            "request": {"method": "PATCH", "path": "/api/v0/teams/{team_id}"},
            # Any collection but its own: the log records every other one and never itself.
            "collection": "teams",
            "operation": "patch_one",
            "document_id": TEAM_OID,
            "db_filter": None,
            "before": {"name": "Lessing"},
            "modified_count": None,
            "redacted_at": None,
        },
    }


def valid_document(collection: str, **overrides: Any) -> dict[str, Any]:
    document = valid_documents()[collection]
    document.update(overrides)
    return document


Body = Callable[[AsyncIOMotorDatabase], Awaitable[Any]]


def on_a_database(container: Any, body: Body, *, constrained: bool = True) -> Any:
    """One client and event loop per call: Motor binds to the loop it first runs on. `constrained=False` is the production ordering."""

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
    """A validator that rejects everything enforces its rule perfectly and makes the collection unwritable."""
    assert insert_outcome(mongo_container, collection, valid_documents()[collection]) == "accepted"


@pytest.mark.parametrize(
    ("collection", "document", "why"),
    [
        # A team's `full_name` where a reference belongs: unique, well-formed and wrong.
        ("saison_spieler", valid_document("saison_spieler", team_id="Lessing-Gymnasium"), "a team name where a reference belongs"),
        # An integral double Pydantic accepts, so nothing looks wrong until something rounds.
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
        # The shoot-out has no variants, so the validator covers all of it: both counts required, both typed.
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
        # `beginn` rather than a count: a matchday's count is on no document, so nothing rejects it.
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
    """MongoDB applies `required` only when the value really is an object, so a nullable `ort` and its required keys do not fight."""
    assert insert_outcome(mongo_container, "spiele", valid_document("spiele", ort=None, schiedsrichter=None)) == "accepted"


@pytest.mark.parametrize(
    ("collection", "first", "second"),
    [
        ("saison_teams", valid_documents()["saison_teams"], valid_document("saison_teams", gruppe="B")),
        ("saison_spieler", valid_documents()["saison_spieler"], valid_document("saison_spieler", nummer="11")),
        ("spiele", valid_documents()["spiele"], valid_document("spiele", ergebnis="0:0")),
        ("teams", valid_documents()["teams"], valid_document("teams", _id=SPIELER_OID, name="Lessing II")),
        ("spieltage", valid_documents()["spieltage"], valid_document("spieltage", _id=SPIELORT_OID, ende="2026-03-22")),
    ],
    ids=[index.name for index in UNIQUE_INDEXES],
)
def test_each_unique_index_refuses_the_second_document(mongo_container: Any, collection: str, first: dict[str, Any], second: dict[str, Any]):
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
    """The index is compound for a reason: match 1 exists in every season."""

    async def body(database: AsyncIOMotorDatabase) -> int:
        await database.spiele.insert_one(valid_documents()["spiele"])
        await database.spiele.insert_one(valid_document("spiele", saison_id="2025"))
        return await database.spiele.count_documents({})

    assert on_a_database(mongo_container, body) == 2


def test_the_same_position_in_another_phase_is_fine(mongo_container: Any):
    """`saison_phase` is a key for this reason: the positions restart per phase, so every phase of a season has a 1."""

    async def body(database: AsyncIOMotorDatabase) -> int:
        await database.spieltage.insert_one(valid_documents()["spieltage"])
        await database.spieltage.insert_one(valid_document("spieltage", _id=SPIELORT_OID, saison_phase="finale"))
        return await database.spieltage.count_documents({})

    assert on_a_database(mongo_container, body) == 2


def test_every_validator_is_attached_strictly(mongo_container: Any):
    """Not `moderate`, which exempts the documents worth catching, and not `warn`, which lets the write land."""

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
    """A second `create_index` with the same name and options is a no-op; different options is an error, so the declared ones must match."""

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
    """The tempting fix — catch it, log it, carry on — leaves a database that looks constrained and is not."""

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
    """Both replies: an empty database answers `NamespaceNotFound`, a constrained one `IndexNotFound`, and the probe must leave no trace."""

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
    """A `readWrite` user holds `find` and lacks `collMod`: the mixed verdict an all-or-nothing answer would hide."""
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
    """`readWrite` grants `createIndex` but not `collMod`: such a user builds every index, attaches no validator, and the app will not start."""
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
    """The validator document is read back as a query — `$jsonSchema` is both — so no second implementation can disagree."""

    async def body(database: AsyncIOMotorDatabase) -> tuple[int, list[Any], int]:
        await database.saison_spieler.insert_many(
            [
                valid_documents()["saison_spieler"],
                valid_document("saison_spieler", spieler_id=SPIELTAG_OID, team_id="Lessing-Gymnasium"),
            ]
        )
        # Two junction rows for one team in one season, which is the rule the index enforces.
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
    """A correct role on the wrong credential refuses exactly like a broken role, which no privilege probe can see."""
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
