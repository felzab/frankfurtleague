import asyncio
from datetime import datetime
from typing import Any, Awaitable, Callable, Mapping, cast
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId, encode
from fastapi.testclient import TestClient
from pymongo import AsyncMongoClient, monitoring
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.bewerbungen.admin_router import ablehnen_bewerbung, annehmen_bewerbung
from app.api.bewerbungen.router import get_bewerbungen
from app.api.bewerbungen.schemas import FLAblehnenBewerbungPayload, FLAnnehmenBewerbungPayload, FLBewerbungenFilterParams
from app.api.bewerbungen.services import BEWERBUNG_ALREADY_DECIDED, BEWERBUNG_SCHULE_UNUSABLE, BEWERBUNG_SUBJECT_UNRESOLVED, compose_new_club
from app.api.teams.admin_router import post_team
from app.api.teams.schemas import FLPostTeamPayload
from app.api.teams.services import CLUB_RETIRED, ENTRY_GRUPPE_FULL, ENTRY_SAISON_NOT_FUTURE
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.db import get_database, get_db_client
from app.core.dependencies import get_germany_now
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
from app.core.recording import SYSTEM_ACTOR_EMAIL
from app.core.security import ACTOR_HEADER
from app.main import create_app
from app.shared.schemas.bounds import BEWERBUNG_GRUND_MAX_LENGTH
from tests.config import build_test_config
from tests.database import a_clean_database

# Module level, as `tests/api/test_spieler_erasure_execution.py` marks its suite: every test below
# reaches a real mongod, and a marker per test would be one a new test could be written without.
pytestmark = pytest.mark.db

DATABASE_NAME = "fl_bewerbung_triage_test"

# Asserted on rather than caught broadly, so an unrelated failure cannot pass as the rollback.
DOCUMENT_VALIDATION_FAILED = 121

# The unique index refused a write: `app/core/exception_handlers.py` answers 409 with this rather
# than letting a duplicate shorthand read as a crash.
DUPLICATE_KEY = "DB-COMMON-002"

SAISON_ID = "2026"

# Injected through `get_germany_now`, so the stamp the decision carries is not the wall clock.
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
TODAY = "2026-04-01"

# The administrator the request is attributed to. Distinctive, so a sweep for it cannot hit seed data.
ADMIN_EMAIL = "triage.quillhilde@example.com"

# Fixed rather than generated, so a failure names the same row every run.
EXISTING_OID = ObjectId("6890a1b2c3d4e5f607910001")
RETIRED_OID = ObjectId("6890a1b2c3d4e5f607910002")
FILLER_OIDS = (ObjectId("6890a1b2c3d4e5f607910003"), ObjectId("6890a1b2c3d4e5f607910004"))

PICKED_BEWERBUNG = ObjectId("6890a1b2c3d4e5f607920001")
NEW_SCHOOL_BEWERBUNG = ObjectId("6890a1b2c3d4e5f607920002")
RETIRED_BEWERBUNG = ObjectId("6890a1b2c3d4e5f607920003")
CLASHING_BEWERBUNG = ObjectId("6890a1b2c3d4e5f607920004")
# Seeded by the one class that needs them: no validator states the exactly-one rule, so these two
# shapes are storable and only the write path tells them apart.
BOTH_BEWERBUNG = ObjectId("6890a1b2c3d4e5f607920005")
NEITHER_BEWERBUNG = ObjectId("6890a1b2c3d4e5f607920006")
# Seeded by its own class for the same reason: `bewerbungen` types `website_url` as a bare string.
UNUSABLE_BEWERBUNG = ObjectId("6890a1b2c3d4e5f607920007")

# An XSS sink once React renders it into the club page's href, and a value `FLTeam` refuses on read.
UNUSABLE_URL = "javascript:alert(1)"

EXISTING_NAME, EXISTING_SHORTHAND = "Adler", "AD"
RETIRED_NAME, RETIRED_SHORTHAND = "Bieber", "BI"

# The club the new school proposes. Its two letters are free, unlike `CLASHING_BEWERBUNG`'s.
NEW_SCHOOL_NAME, NEW_SCHOOL_SHORTHAND = "Zorbanax", "ZX"

# Two groups of two, so one seeded pair fills `A` and `REQ-ENTER-003` is reachable without twenty rows.
RULES: Mapping[str, Any] = {
    "win_points": 3,
    "draw_points": 1,
    "qualifiers_per_group": 2,
    "number_of_groups": 2,
    "teams_per_group": 2,
    "tiebreak_order": "tordifferenz",
    "max_kadergroesse": 18,
    "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
    "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
}

ADDRESS: Mapping[str, Any] = {
    "strasse": "Hanauer Landstraße",
    "hausnummer": "12a",
    "plz": "60314",
    "stadtteil": "Ostend",
    "stadt": "Frankfurt am Main",
}


def kontaktperson(vorname: str) -> dict[str, Any]:
    """One of the three people an application is filled in by, in the shape the junction stores them."""

    return {
        "vorname": vorname,
        "nachname": f"{vorname}-Mustermann",
        "email": f"{vorname.lower()}@example.com",
        "telefon": "+49 69 1234567",
        "geburtsdatum": "1980-05-04",
        "einwilligung": {"umfang": "kontaktdaten", "erteilt_von": "person", "text_version": "v1", "datum": "2026-01-15"},
    }


# Distinct per slot, so a block copied across with two slots swapped fails rather than compares equal.
KONTAKTE: Mapping[str, Any] = {
    "trainer": kontaktperson("Wraxlington"),
    "ansprechperson": kontaktperson("Quillhilde"),
    "stellvertretung": kontaktperson("Bramblewick"),
    # False, not True: the two slots hold different people, and the flag is a claim of its own.
    "trainer_ist_zugleich": None,
}


def club_document(team_id: ObjectId, name: str, shorthand: str, *, inactive_since: str | None = None) -> dict[str, Any]:
    return {
        "_id": team_id,
        "name": name,
        "shorthand": shorthand,
        "description": "",
        "full_name": f"{name}-Schule",
        "website_url": f"https://{name.lower()}.example.de",
        "schulform": "gymnasium_g9",
        "address": dict(ADDRESS),
        "inactive_since": inactive_since,
    }


def schule_block(team_name: str, shorthand: str) -> dict[str, Any]:
    """What a school proposes when it picked no existing club, spelled as `teams` spells it."""

    return {
        "team_name": team_name,
        "full_name": f"{team_name}-Gesamtschule",
        "shorthand": shorthand,
        "schulform": "gesamtschule",
        "address": dict(ADDRESS),
        "website_url": f"https://{team_name.lower()}.example.de",
    }


def bewerbung_document(bewerbung_id: ObjectId, *, team_id: ObjectId | None = None, schule: dict[str, Any] | None = None) -> dict[str, Any]:
    """One submitted application, undecided. Every field the validator requires, and nothing the triage writes."""

    return {
        "_id": bewerbung_id,
        "saison_id": SAISON_ID,
        "eingereicht_am": "2026-02-01",
        "status": "eingereicht",
        "team_id": team_id,
        "schule": schule,
        "kontakte": {slot: dict(person) if isinstance(person, dict) else person for slot, person in KONTAKTE.items()},
        "trikot": {"vorhandener_satz": "16 rote Trikots, Größe M", "wunschfarbe": "rot"},
        "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
        "entscheidung": None,
    }


def junction_document(team_id: ObjectId, name: str, shorthand: str, gruppe: str) -> dict[str, Any]:
    """A club already standing in the season, which is how a group comes to be full."""

    return {"saison_id": SAISON_ID, "team_id": team_id, "gruppe": gruppe, "austritt": None, "name": name, "shorthand": shorthand}


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, saison_status: str = "future", occupied: int = 0, mutates_schema: bool = False) -> Any:
    """The SHIPPED validators and indexes, so a document production would refuse fails here too.

    One client and event loop per call: `AsyncMongoClient` binds to the loop it first ran on. `occupied` fills
    group `A`, the only route to `REQ-ENTER-003`.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
            await database[Collection.SAISONS].insert_one(
                {"_id": SAISON_ID, "start_date": "2026-01-01", "end_date": "2026-06-30", "status": saison_status, "rules": dict(RULES)}
            )
            await database[Collection.TEAMS].insert_many(
                [
                    club_document(EXISTING_OID, EXISTING_NAME, EXISTING_SHORTHAND),
                    club_document(RETIRED_OID, RETIRED_NAME, RETIRED_SHORTHAND, inactive_since="2026-03-01"),
                ]
            )
            if occupied:
                await database[Collection.SAISON_TEAMS].insert_many(
                    [junction_document(FILLER_OIDS[index], f"Fueller {index}", f"F{index}", "A") for index in range(occupied)]
                )
            await database[Collection.BEWERBUNGEN].insert_many(
                [
                    bewerbung_document(PICKED_BEWERBUNG, team_id=EXISTING_OID),
                    bewerbung_document(NEW_SCHOOL_BEWERBUNG, schule=schule_block(NEW_SCHOOL_NAME, NEW_SCHOOL_SHORTHAND)),
                    bewerbung_document(RETIRED_BEWERBUNG, team_id=RETIRED_OID),
                    # The two letters an existing club already holds, which `uniq_shorthand` refuses.
                    bewerbung_document(CLASHING_BEWERBUNG, schule=schule_block("Kollision", EXISTING_SHORTHAND)),
                ]
            )

            return await body(database, client)

    return asyncio.run(_run())


async def accept(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    bewerbung_id: ObjectId,
    *,
    gruppe: str = "A",
    trikot_farbe: str | None = "blau",
) -> Any:
    return await annehmen_bewerbung(
        bewerbung_id=bewerbung_id,
        annahme_data=FLAnnehmenBewerbungPayload.model_validate({"gruppe": gruppe, "trikot_farbe": trikot_farbe}),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        db=client,
        today=TODAY,
        von=ADMIN_EMAIL,
    )


GRUND = "Die Gruppen sind für diese Saison bereits besetzt."

_GRUND_SENTENCE = "Grün-weiß gestreifte Trikots gehören leider nicht in die Saisonordnung. "

# Exactly the bound, multibyte with it, and closed with a character no strip takes: a truncation
# counting BYTES cuts the last one off, and a bound the repetition happened to cut on a space would
# fail the same comparison over the trim instead.
GRUND_AT_THE_BOUND = (_GRUND_SENTENCE * (BEWERBUNG_GRUND_MAX_LENGTH // len(_GRUND_SENTENCE) + 1))[: BEWERBUNG_GRUND_MAX_LENGTH - 1] + "."


async def decline(database: AsyncDatabase, bewerbung_id: ObjectId, *, grund: str = GRUND) -> Any:
    return await ablehnen_bewerbung(
        bewerbung_id=bewerbung_id,
        ablehnung_data=FLAblehnenBewerbungPayload(grund=grund),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        today=TODAY,
        von=ADMIN_EMAIL,
    )


async def stored_bewerbung(database: AsyncDatabase, bewerbung_id: ObjectId) -> Mapping[str, Any]:
    stored = await database[Collection.BEWERBUNGEN].find_one({"_id": bewerbung_id})
    assert stored is not None, "the seeded application is gone, which no triage endpoint may do"

    return stored


async def junction_rows(database: AsyncDatabase, **narrow: Any) -> list[Mapping[str, Any]]:
    return await database[Collection.SAISON_TEAMS].find(narrow).to_list(length=None)


# The clubs `on_a_league` seeds. Named, because "no club was created" is asserted as this number.
SEEDED_CLUBS = 2

# Module level, as `tests/api/test_actor_binding.py` builds it: one app, and the overrides below are
# installed per call so no test inherits another's database handle.
APP = create_app(build_test_config())

ADMIN_AUTH = {"Authorization": "Bearer test-key-admin"}


async def through_the_app(
    url: str, bewerbung_id: ObjectId, endpoint: str, payload: Mapping[str, Any], *, actor: str | None = ADMIN_EMAIL
) -> Any:
    """One triage decision driven as a REAL request, exception handlers included.

    `endpoint` is positional and required: the two decisions write different blocks, so a default
    here would let a test claim to serve one while serving the other.
    """

    # Its own client, first used on the TestClient's own loop: `AsyncMongoClient` binds to the loop it first ran
    # on, and the seeding client belongs to this test's.
    app_db_client = AsyncMongoClient(url)

    async def _client() -> AsyncMongoClient:
        return app_db_client

    async def _database() -> AsyncDatabase:
        return app_db_client[DATABASE_NAME]

    # Popped rather than cleared afterwards: `create_app` installs its own `get_config` override, and
    # clearing would drop that one too and send the next request at the real environment.
    APP.dependency_overrides[get_db_client] = _client
    APP.dependency_overrides[get_database] = _database
    APP.dependency_overrides[get_germany_now] = lambda: NOW

    headers = {**ADMIN_AUTH} if actor is None else {**ADMIN_AUTH, ACTOR_HEADER: actor}
    path = f"/api/v{API_VERSION}/bewerbungen/{bewerbung_id}/{endpoint}"

    def _request() -> Any:
        return TestClient(APP).post(path, json=dict(payload), headers=headers)

    try:
        # In a thread of its own, so this test's loop keeps running while the app's loop serves the
        # request: `TestClient` is synchronous and would otherwise block the loop it was called from.
        return await asyncio.to_thread(_request)
    finally:
        for dependency in (get_db_client, get_database, get_germany_now):
            APP.dependency_overrides.pop(dependency, None)
        await app_db_client.close()


class TestAnAcceptanceEntersTheSchool:
    """The three writes, against a real mongod: a club where the school is new, the junction row, and the application."""

    def test_a_new_school_gets_a_club_that_the_application_then_names(self, mongo_replica_set_url: str):
        """Catches an acceptance that enters the school without writing the created id back: nothing would join the two."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await accept(database, client, NEW_SCHOOL_BEWERBUNG)
            created = await database[Collection.TEAMS].find_one({"shorthand": NEW_SCHOOL_SHORTHAND})

            return response, created, await junction_rows(database), await stored_bewerbung(database, NEW_SCHOOL_BEWERBUNG)

        response, created, rows, stored = on_a_league(mongo_replica_set_url, body)

        assert created is not None, "no club was created for a school that named none"
        assert (created["name"], created["full_name"]) == (NEW_SCHOOL_NAME, f"{NEW_SCHOOL_NAME}-Gesamtschule")
        # Empty rather than composed: a sentence the league wrote would stand on the team page as the school's own.
        assert (created["description"], created["inactive_since"]) == ("", None)

        assert len(rows) == 1
        assert (rows[0]["team_id"], rows[0]["gruppe"], rows[0]["austritt"]) == (created["_id"], "A", None)
        assert (rows[0]["name"], rows[0]["shorthand"]) == (NEW_SCHOOL_NAME, NEW_SCHOOL_SHORTHAND)

        # The write the acceptance owes the application: without it a new school's row names no club.
        assert (stored["status"], stored["team_id"]) == ("angenommen", created["_id"])
        assert stored["entscheidung"] == {"getroffen_am": TODAY, "von": ADMIN_EMAIL, "grund": None}
        assert (response.team_id, response.created_team, response.gruppe) == (created["_id"], True, "A")

    def test_an_application_naming_an_existing_club_creates_none(self, mongo_replica_set_url: str):
        """Catches a branch that creates a club whatever the application said, which would duplicate every returning school."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await database[Collection.TEAMS].count_documents({})
            response = await accept(database, client, PICKED_BEWERBUNG)

            return before, await database[Collection.TEAMS].count_documents({}), response, await junction_rows(database)

        before, after, response, rows = on_a_league(mongo_replica_set_url, body)

        assert (before, after) == (SEEDED_CLUBS, SEEDED_CLUBS)
        assert (response.team_id, response.created_team) == (EXISTING_OID, False)
        assert len(rows) == 1
        # The club's name as it stands TODAY, copied at entry rather than joined on read.
        assert (rows[0]["team_id"], rows[0]["name"], rows[0]["shorthand"]) == (EXISTING_OID, EXISTING_NAME, EXISTING_SHORTHAND)

    def test_the_three_people_reach_the_junction_row_as_the_application_held_them(self, mongo_replica_set_url: str):
        """They arrive WITH the season's row rather than being typed in after it, which is what `/admin/kontakte` then reads."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await accept(database, client, PICKED_BEWERBUNG)
            submitted = await stored_bewerbung(database, PICKED_BEWERBUNG)
            rows = await junction_rows(database)

            return submitted["kontakte"], rows[0]["kontakte"]

        submitted, entered = on_a_league(mongo_replica_set_url, body)

        # Against the seed as well as against the application, so a copy of an emptied block cannot pass.
        assert entered == submitted == KONTAKTE

    def test_the_assigned_kit_colour_is_the_administrators_and_not_the_wish(self, mongo_replica_set_url: str):
        """A wish is not an assignment: two schools may wish for one colour, and the junction records what was given."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await accept(database, client, PICKED_BEWERBUNG, trikot_farbe="gruen")
            rows = await junction_rows(database)

            return rows[0]["trikot_farbe"], (await stored_bewerbung(database, PICKED_BEWERBUNG))["trikot"]["wunschfarbe"]

        assigned, wished = on_a_league(mongo_replica_set_url, body)

        assert (assigned, wished) == ("gruen", "rot")


class TestTheSeasonsOwnEntryRulesReachTheAcceptance:
    """`find_entry_refusal` is REUSED rather than restated, so these prove the reuse arrives.

    Each asserts on the write as well as the code: a rule that refuses without stopping the writes
    would leave a club created for a school that never entered.
    """

    def test_a_full_group_is_refused_and_no_club_is_created_for_the_new_school(self, mongo_replica_set_url: str):
        """`REQ-ENTER-003` on the NEW-school application, and the ROLLBACK behind it.

        Not the ordering: an insert moved ahead of the count passes this too, being rolled back.
        `test_the_full_group_is_reported_before_the_club_is_written` pins that.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentConflictException) as conflict:
                await accept(database, client, NEW_SCHOOL_BEWERBUNG)

            return (
                conflict.value.error_code,
                await database[Collection.TEAMS].count_documents({}),
                len(await junction_rows(database)),
                (await stored_bewerbung(database, NEW_SCHOOL_BEWERBUNG))["status"],
            )

        code, clubs, rows, status = on_a_league(mongo_replica_set_url, body, occupied=RULES["teams_per_group"])

        assert code == ENTRY_GRUPPE_FULL
        assert (clubs, rows, status) == (SEEDED_CLUBS, RULES["teams_per_group"], "eingereicht")

    def test_the_group_beside_the_full_one_still_takes_the_school(self, mongo_replica_set_url: str):
        """The floor under the refusal above: without it a blanket failure would read as the capacity rule working."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await accept(database, client, NEW_SCHOOL_BEWERBUNG, gruppe="B")

            return response.gruppe, len(await junction_rows(database, gruppe="B"))

        assert on_a_league(mongo_replica_set_url, body, occupied=RULES["teams_per_group"]) == ("B", 1)

    def test_a_retired_club_is_refused_and_nothing_is_entered(self, mongo_replica_set_url: str):
        """`REQ-ENTER-005`: a club that left the league is reactivated first, and the season's row is not the route to it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentConflictException) as conflict:
                await accept(database, client, RETIRED_BEWERBUNG)

            return conflict.value.error_code, await junction_rows(database), (await stored_bewerbung(database, RETIRED_BEWERBUNG))["status"]

        code, rows, status = on_a_league(mongo_replica_set_url, body)

        assert code == CLUB_RETIRED
        assert (rows, status) == ([], "eingereicht")

    # A group the season does not run and a group already full: the two faults `find_entry_refusal`
    # would report over the club's own, one on each side of the count.
    @pytest.mark.parametrize(
        ("gruppe", "occupied"),
        [pytest.param("D", 0, id="a group the season does not run"), pytest.param("A", RULES["teams_per_group"], id="a group that is full")],
    )
    def test_the_clubs_standing_is_reported_before_the_group_it_asked_for(self, mongo_replica_set_url: str, gruppe: str, occupied: int):
        """A group fault refuses too, and naming it sends an administrator to fix the wrong thing: no group repairs a retirement."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentConflictException) as conflict:
                await accept(database, client, RETIRED_BEWERBUNG, gruppe=gruppe)

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body, occupied=occupied) == CLUB_RETIRED

    def test_the_full_group_is_reported_before_the_club_is_written(self, mongo_replica_set_url: str):
        """The order pinned on a WRITE that fails differently: the rollback hides an early insert.

        `CLASHING_BEWERBUNG` takes two letters `uniq_shorthand` refuses, so an insert before the
        count answers `DB-COMMON-002` rather than the rule to act on.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentConflictException) as conflict:
                await accept(database, client, CLASHING_BEWERBUNG)

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body, occupied=RULES["teams_per_group"]) == ENTRY_GRUPPE_FULL

    @pytest.mark.parametrize("saison_status", ["active", "past"])
    def test_a_season_that_is_not_future_is_refused(self, mongo_replica_set_url: str, saison_status: str):
        """`REQ-ENTER-001`, read in-session: `activate_saison` moves `status` in a transaction of its own."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentConflictException) as conflict:
                await accept(database, client, NEW_SCHOOL_BEWERBUNG)

            return (
                conflict.value.error_code,
                await database[Collection.TEAMS].count_documents({}),
                await junction_rows(database),
                (await stored_bewerbung(database, NEW_SCHOOL_BEWERBUNG))["status"],
            )

        code, clubs, rows, status = on_a_league(mongo_replica_set_url, body, saison_status=saison_status)

        assert code == ENTRY_SAISON_NOT_FUTURE
        assert (clubs, rows, status) == (SEEDED_CLUBS, [], "eingereicht")


# The two shapes `REQ-BEWERBUNG-002` refuses, each stored as a hand edit could leave it.
UNRESOLVED = [
    pytest.param(BOTH_BEWERBUNG, EXISTING_OID, schule_block("Doppelt", "DP"), id="both a club and a school"),
    pytest.param(NEITHER_BEWERBUNG, None, None, id="neither a club nor a school"),
]


class TestAnApplicationResolvingToNoOneClub:
    """`REQ-BEWERBUNG-002` reaching the acceptance.

    `docs/backend/spec.md :: I16` keeps the rule off the validator, so the write path is where it holds.
    """

    @pytest.mark.parametrize(("bewerbung_id", "team_id", "schule"), UNRESOLVED)
    def test_it_is_refused_before_anything_is_written(
        self, mongo_replica_set_url: str, bewerbung_id: ObjectId, team_id: ObjectId | None, schule: dict[str, Any] | None
    ):
        """A row carrying both would otherwise enter one club while a school nobody created stood in the other field."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].insert_one(bewerbung_document(bewerbung_id, team_id=team_id, schule=schule))

            with pytest.raises(DocumentConflictException) as conflict:
                await accept(database, client, bewerbung_id)

            return (
                conflict.value.error_code,
                await database[Collection.TEAMS].count_documents({}),
                await junction_rows(database),
                (await stored_bewerbung(database, bewerbung_id))["status"],
            )

        code, clubs, rows, status = on_a_league(mongo_replica_set_url, body)

        assert code == BEWERBUNG_SUBJECT_UNRESOLVED
        assert (clubs, rows, status) == (SEEDED_CLUBS, [], "eingereicht")


async def seed_the_unusable_school(database: AsyncDatabase) -> Mapping[str, Any]:
    """One application whose school makes no club, stored through the SHIPPED validator.

    Read back, because `docs/backend/spec.md :: I16` keeps the format off the validator: the value
    really does reach `teams` unless acceptance refuses it.
    """

    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(UNUSABLE_BEWERBUNG, schule={**schule_block("Skriptsam", "SK"), "website_url": UNUSABLE_URL})
    )

    return await stored_bewerbung(database, UNUSABLE_BEWERBUNG)


class TestASchoolNoClubCanBeCreatedFrom:
    """`REQ-BEWERBUNG-003` reaching the acceptance, which is the last point that can still answer 409.

    Past it the club is written, `FLTeamListAdapter` refuses it, and the clubs page an administrator
    would repair it from is the page that 500s.
    """

    def test_an_unusable_url_is_refused_before_anything_is_written(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            seeded = await seed_the_unusable_school(database)

            with pytest.raises(DocumentConflictException) as conflict:
                await accept(database, client, UNUSABLE_BEWERBUNG)

            return (
                conflict.value.error_code,
                seeded["schule"]["website_url"],
                await database[Collection.TEAMS].count_documents({}),
                await junction_rows(database),
                (await stored_bewerbung(database, UNUSABLE_BEWERBUNG))["status"],
            )

        code, stored_url, clubs, rows, status = on_a_league(mongo_replica_set_url, body)

        assert stored_url == UNUSABLE_URL, "the validator refused the value, so the refusal below proves nothing"
        assert code == BEWERBUNG_SCHULE_UNUSABLE
        assert (clubs, rows, status) == (SEEDED_CLUBS, [], "eingereicht")

    def test_the_school_is_judged_before_the_group_it_asked_for(self, mongo_replica_set_url: str):
        """Where the picked club's standing is judged, and for that reason: no other group makes these details a club."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed_the_unusable_school(database)

            with pytest.raises(DocumentConflictException) as conflict:
                await accept(database, client, UNUSABLE_BEWERBUNG)

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body, occupied=RULES["teams_per_group"]) == BEWERBUNG_SCHULE_UNUSABLE


class TestAPartialAcceptanceCommitsNothing:
    """One transaction over three writes: a club created without its junction row is a school in no season that nothing reports."""

    def test_a_refused_final_patch_takes_the_club_and_the_junction_row_back(self, mongo_replica_set_url: str):
        """A `$jsonSchema` refusing the moved `status` fails the LAST of the three, after the other two have landed.

        Catches running the three outside one transaction, and dropping the session from either write.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # Narrow enough to refuse the patch's `$set`, wide enough to admit the seeded application
            # this same body reads back afterwards.
            await database.command(
                "collMod",
                Collection.BEWERBUNGEN.value,
                validator={"$jsonSchema": {"bsonType": "object", "properties": {"status": {"enum": ["eingereicht"]}}}},
                validationLevel="strict",
            )

            with pytest.raises(OperationFailure) as failure:
                await accept(database, client, NEW_SCHOOL_BEWERBUNG)

            return (
                failure.value.code,
                await database[Collection.TEAMS].count_documents({}),
                await junction_rows(database),
                await stored_bewerbung(database, NEW_SCHOOL_BEWERBUNG),
            )

        code, clubs, rows, stored = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        # On the code, so this cannot pass because something else failed before any write.
        assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the patch, got code {code}"
        assert clubs == SEEDED_CLUBS, "the club survived a transaction that never committed"
        assert rows == [], "the junction row survived a transaction that never committed"
        assert (stored["status"], stored["team_id"], stored["entscheidung"]) == ("eingereicht", None, None)


class TestADuplicateShorthandIsAConflictAndNotHalfAClub:
    """`uniq_shorthand` refuses the created club, which is a 409 rather than a crash -- and no half-written season."""

    def test_the_second_club_to_claim_the_two_letters_is_refused_whole(self, mongo_replica_set_url: str):
        """Through a served request, because the code asserted on is the exception handler's rather than any refusal's."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await through_the_app(mongo_replica_set_url, CLASHING_BEWERBUNG, "annehmen", {"gruppe": "A", "trikot_farbe": "rot"})

            return (
                response.status_code,
                response.json(),
                await database[Collection.TEAMS].count_documents({}),
                await junction_rows(database),
                (await stored_bewerbung(database, CLASHING_BEWERBUNG))["status"],
            )

        status_code, payload, clubs, rows, status = on_a_league(mongo_replica_set_url, body)

        assert (status_code, payload["error_code"]) == (409, DUPLICATE_KEY)
        assert (clubs, rows, status) == (SEEDED_CLUBS, [], "eingereicht")


class TestWhoTheDecisionNames:
    """`entscheidung.von` is the request's bound actor, so it and the `aktionen` row cannot disagree.

    Served rather than called: calling the endpoint directly would resolve neither
    `bind_actor` nor `get_actor_email`, proving nothing about their order.
    """

    def test_the_stored_decision_carries_the_administrators_own_address(self, mongo_replica_set_url: str):
        """Catches `get_actor_email` resolving BEFORE the router-level binder, which would file every decision under SYSTEM."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await through_the_app(mongo_replica_set_url, PICKED_BEWERBUNG, "annehmen", {"gruppe": "A", "trikot_farbe": "rot"})
            stored = await stored_bewerbung(database, PICKED_BEWERBUNG)

            return response.status_code, stored["entscheidung"]

        status_code, entscheidung = on_a_league(mongo_replica_set_url, body)

        assert status_code == 200, "the served acceptance did not succeed, so what it stored proves nothing"
        assert entscheidung["von"] == ADMIN_EMAIL
        assert entscheidung["von"] != SYSTEM_ACTOR_EMAIL
        # The injected clock reached it too, so the date is the request's rather than the wall's.
        assert (entscheidung["getroffen_am"], entscheidung["grund"]) == (TODAY, None)

    def test_the_log_row_for_that_write_names_the_same_person(self, mongo_replica_set_url: str):
        """The pairing the field exists for: two sources for one name is two names waiting to disagree."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await through_the_app(mongo_replica_set_url, PICKED_BEWERBUNG, "annehmen", {"gruppe": "A", "trikot_farbe": "rot"})
            rows = await database[Collection.AKTIONEN].find({"collection": str(Collection.BEWERBUNGEN)}).to_list(length=None)

            return rows, (await stored_bewerbung(database, PICKED_BEWERBUNG))["entscheidung"]

        rows, entscheidung = on_a_league(mongo_replica_set_url, body)

        assert len(rows) == 1, f"the acceptance recorded {len(rows)} rows against the application, not one"
        assert rows[0]["actor"] == {"kind": "admin_session", "email": entscheidung["von"]}

    def test_a_served_decline_names_the_administrator_as_well(self, mongo_replica_set_url: str):
        """The decline is a second endpoint writing a block of its own, so the acceptance's proof says nothing about it.

        Its block also carries a `grund` the acceptance's does not, which is what makes the two
        different objects rather than one shape.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await through_the_app(mongo_replica_set_url, PICKED_BEWERBUNG, "ablehnen", {"grund": GRUND})

            return response.status_code, (await stored_bewerbung(database, PICKED_BEWERBUNG))["entscheidung"]

        status_code, entscheidung = on_a_league(mongo_replica_set_url, body)

        assert status_code == 200, "the served decline did not succeed, so what it stored proves nothing"
        assert entscheidung["von"] == ADMIN_EMAIL
        assert entscheidung["von"] != SYSTEM_ACTOR_EMAIL
        assert entscheidung["getroffen_am"] == TODAY


# The two fields a decline is allowed to move. Everything else on the document is the submission.
DECIDED_FIELDS = ("status", "entscheidung")


def submission_bytes(stored: Mapping[str, Any]) -> bytes:
    """The document minus what a decision writes, encoded as BSON.

    Bytes rather than a dict comparison: it holds the field ORDER and the stored types, so a value
    rewritten as an equal one of another type -- an int as a double -- fails here.
    """

    return encode({key: value for key, value in stored.items() if key not in DECIDED_FIELDS})


class TestADeclineTouchesNothingElse:
    """What the school wrote stays the record the decision was taken against."""

    def test_the_submission_is_byte_identical_afterwards(self, mongo_replica_set_url: str):
        """Catches a decline that rewrites the document rather than `$set`ting the two fields it owns."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await stored_bewerbung(database, PICKED_BEWERBUNG)
            response = await decline(database, PICKED_BEWERBUNG)

            return submission_bytes(before), submission_bytes(await stored_bewerbung(database, PICKED_BEWERBUNG)), response

        before, after, response = on_a_league(mongo_replica_set_url, body)

        assert after == before
        assert response.updated_document.status == "abgelehnt"

    def test_it_moves_the_status_and_the_decision_and_writes_no_season_row(self, mongo_replica_set_url: str):
        """The floor under the comparison above: a decline that did nothing at all would pass it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline(database, PICKED_BEWERBUNG)
            stored = await stored_bewerbung(database, PICKED_BEWERBUNG)

            return stored["status"], stored["entscheidung"], stored["team_id"], await junction_rows(database)

        status, entscheidung, team_id, rows = on_a_league(mongo_replica_set_url, body)

        assert status == "abgelehnt"
        assert entscheidung == {"getroffen_am": TODAY, "von": ADMIN_EMAIL, "grund": GRUND}
        # Left as the applicant picked it: a decline creates no reference and clears none.
        assert (team_id, rows) == (EXISTING_OID, [])

    def test_the_bounded_reason_is_the_case_it_claims_to_be(self):
        """A floor under the constant: one that drifted off the bound, or lost its umlauts, would test nothing in particular."""

        assert len(GRUND_AT_THE_BOUND) == BEWERBUNG_GRUND_MAX_LENGTH
        assert len(GRUND_AT_THE_BOUND.encode("utf-8")) > BEWERBUNG_GRUND_MAX_LENGTH
        # The strip runs before the length is compared, so a reason ending in a space comes back
        # shorter than it was sent and fails that comparison for no reason of its own.
        assert GRUND_AT_THE_BOUND.strip() == GRUND_AT_THE_BOUND

    @pytest.mark.parametrize("grund", [pytest.param(GRUND, id="an ordinary reason"), pytest.param(GRUND_AT_THE_BOUND, id="at the bound")])
    def test_the_served_reason_reaches_the_document_byte_identical(self, mongo_replica_set_url: str, grund: str):
        """The reason is stored AND emailed to the applicants: one lost on the way is a decline nobody can act on.

        Served rather than called, so the JSON decode is in the path: every other decline in this file
        hands the endpoint a model that was never encoded.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await through_the_app(mongo_replica_set_url, PICKED_BEWERBUNG, "ablehnen", {"grund": grund})

            return response.status_code, (await stored_bewerbung(database, PICKED_BEWERBUNG))["entscheidung"]["grund"]

        status_code, stored_grund = on_a_league(mongo_replica_set_url, body)

        assert status_code == 200, "the served decline did not succeed, so what it stored proves nothing"
        # Encoded on both sides, so a re-encoding fails here as a truncation does; the length is
        # asserted separately, which is what says WHICH of the two happened.
        assert stored_grund.encode("utf-8") == grund.encode("utf-8")
        assert len(stored_grund) == len(grund)

    @pytest.mark.parametrize("grund", [pytest.param("   ", id="spaces"), pytest.param("\t\n ", id="tab and newline")])
    def test_a_reason_of_whitespace_alone_is_refused(self, mongo_replica_set_url: str, grund: str):
        """Drop `strip_whitespace` and this passes as a 200: `min_length` counts CHARACTERS.

        A decline is irreversible, so a reason of spaces stands on the application for good and
        reaches the three people as a rejection giving none.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await through_the_app(mongo_replica_set_url, PICKED_BEWERBUNG, "ablehnen", {"grund": grund})

            return response.status_code, await stored_bewerbung(database, PICKED_BEWERBUNG)

        status_code, stored = on_a_league(mongo_replica_set_url, body)

        assert status_code == 422
        assert (stored["status"], stored["entscheidung"]) == ("eingereicht", None), "the refused decline still decided the application"

    def test_a_padded_reason_is_stored_as_a_trimming_client_would_have_sent_it(self, mongo_replica_set_url: str):
        """One composition, as the two club-create paths have: the browser trims before it posts.

        Without the strip one reason is stored two ways, and which an application carries says only
        which client the administrator declined it from.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await through_the_app(mongo_replica_set_url, PICKED_BEWERBUNG, "ablehnen", {"grund": f"  {GRUND}\n"})

            return response.status_code, (await stored_bewerbung(database, PICKED_BEWERBUNG))["entscheidung"]["grund"]

        status_code, stored_grund = on_a_league(mongo_replica_set_url, body)

        assert status_code == 200
        assert stored_grund == GRUND


async def take_decision(kind: str, database: AsyncDatabase, client: AsyncMongoClient, bewerbung_id: ObjectId) -> Any:
    """Either endpoint by name, so the pairs below read as the sequence an administrator would press."""

    if kind == "accept":
        return await accept(database, client, bewerbung_id)

    return await decline(database, bewerbung_id)


# Every ordered pair of the two endpoints. The acceptance ones are why the guard exists -- a second
# acceptance would enter the club again and fail on `uniq_saison_id_team_id`, which reads as unrelated.
DECISION_PAIRS = [
    pytest.param("accept", "accept", "angenommen", 1, id="accept then accept"),
    pytest.param("accept", "decline", "angenommen", 1, id="accept then decline"),
    pytest.param("decline", "accept", "abgelehnt", 0, id="decline then accept"),
    pytest.param("decline", "decline", "abgelehnt", 0, id="decline then decline"),
]


class TestADecisionIsNotTakenTwice:
    """`REQ-BEWERBUNG-001` against a real mongod: a refusal that exists is not a refusal that is reached."""

    @pytest.mark.parametrize(("first", "second", "expected_status", "expected_rows"), DECISION_PAIRS)
    def test_the_second_decision_is_refused_and_the_first_still_stands(
        self, mongo_replica_set_url: str, first: str, second: str, expected_status: str, expected_rows: int
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await take_decision(first, database, client, PICKED_BEWERBUNG)
            after_first = await stored_bewerbung(database, PICKED_BEWERBUNG)

            with pytest.raises(DocumentConflictException) as conflict:
                await take_decision(second, database, client, PICKED_BEWERBUNG)

            return conflict.value.error_code, after_first, await stored_bewerbung(database, PICKED_BEWERBUNG), await junction_rows(database)

        code, after_first, after_second, rows = on_a_league(mongo_replica_set_url, body)

        assert code == BEWERBUNG_ALREADY_DECIDED
        assert after_second == after_first, "the refused second decision still changed the application"
        assert (after_second["status"], len(rows)) == (expected_status, expected_rows)


class StaleFirstRead:
    """The `bewerbungen` collection with ONE stale `find_one` in it, and every other call delegated.

    A second administrator cannot be scheduled into the window between the guard's read and the
    write, so the window is reproduced instead of raced for.
    """

    def __init__(self, collection: Any, stale: Mapping[str, Any]) -> None:
        self._collection = collection
        self._stale: Mapping[str, Any] | None = stale

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        if self._stale is None:
            return await self._collection.find_one(*args, **kwargs)

        stale, self._stale = self._stale, None

        return stale

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)


def as_the_loser_read_it(collection: AsyncCollection, stale: Mapping[str, Any]) -> AsyncCollection:
    """The collection the second request holds, `cast` for `tests/api/test_saison_cache.py :: as_collection`'s reason."""

    return cast(AsyncCollection, StaleFirstRead(collection, stale))


# The second administrator: a different address and a different reason, so a decline that overwrote
# the first one's is visible in the stored block rather than only in a timestamp.
OTHER_ADMIN_EMAIL = "triage.bramblewick@example.com"
OTHER_GRUND = "Die Anmeldefrist für diese Saison ist verstrichen."


class TestTwoDeclinesAtOnce:
    """The write itself carries the guard, so the loser of the race mails the applicants nothing.

    Both administrators otherwise send the three people a rejection letter, and one `grund` and one
    name survive.
    """

    def test_the_second_decline_writes_nothing_and_is_refused(self, mongo_replica_set_url: str):
        """Catches the status left out of the write's own filter, which a read taken a moment earlier cannot cover."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline(database, PICKED_BEWERBUNG)
            after_first = await stored_bewerbung(database, PICKED_BEWERBUNG)

            with pytest.raises(DocumentConflictException) as conflict:
                await ablehnen_bewerbung(
                    bewerbung_id=PICKED_BEWERBUNG,
                    ablehnung_data=FLAblehnenBewerbungPayload(grund=OTHER_GRUND),
                    # The document as the loser's request read it, an instant before the first landed.
                    bewerbungen_collection=as_the_loser_read_it(database[Collection.BEWERBUNGEN], {**after_first, "status": "eingereicht"}),
                    today=TODAY,
                    von=OTHER_ADMIN_EMAIL,
                )

            return conflict.value.error_code, after_first, await stored_bewerbung(database, PICKED_BEWERBUNG)

        code, after_first, after_second = on_a_league(mongo_replica_set_url, body)

        assert code == BEWERBUNG_ALREADY_DECIDED
        assert after_second == after_first, "the losing decline overwrote the reason and the name the first one stored"

    def test_an_application_no_document_names_is_still_a_404(self, mongo_replica_set_url: str):
        """The filter matches nothing either way, and the two must not read alike: only one of them is a decision that stands."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].delete_one({"_id": PICKED_BEWERBUNG})

            with pytest.raises(DocumentNotFoundException) as missing:
                await ablehnen_bewerbung(
                    bewerbung_id=PICKED_BEWERBUNG,
                    ablehnung_data=FLAblehnenBewerbungPayload(grund=OTHER_GRUND),
                    bewerbungen_collection=as_the_loser_read_it(database[Collection.BEWERBUNGEN], bewerbung_document(PICKED_BEWERBUNG)),
                    today=TODAY,
                    von=OTHER_ADMIN_EMAIL,
                )

            return missing.value.status_code

        assert on_a_league(mongo_replica_set_url, body) == 404


# The four `on_a_league` seeds, oldest `_id` first, all carrying one `eingereicht_am`. Named so the
# expectation below is the reverse of a list rather than four constants retyped in an order.
SEEDED_IN_ORDER = (PICKED_BEWERBUNG, NEW_SCHOOL_BEWERBUNG, RETIRED_BEWERBUNG, CLASHING_BEWERBUNG)


class TestTheQueueTheTriageIsWorkedDown:
    """`GET /bewerbungen` is what an administrator works down, so what it does with a tie is a decision."""

    def test_applications_from_one_day_come_back_newest_first(self, mongo_replica_set_url: str):
        """Catches an ascending tie-break, which reads a day's applications backwards inside a newest-first list."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await get_bewerbungen(
                bewerbungen_collection=database[Collection.BEWERBUNGEN],
                filters=FLBewerbungenFilterParams(),
            )

            return [bewerbung.id for bewerbung in response.bewerbungen], {bewerbung.eingereicht_am for bewerbung in response.bewerbungen}

        listed, days = on_a_league(mongo_replica_set_url, body)

        assert len(days) == 1, "the seeds no longer share a day, so the order below is the sort key rather than the tie-break"
        assert listed == list(reversed(SEEDED_IN_ORDER))


# The four collections the acceptance JUDGES, which are the reads that have to sit in the
# transaction. `aktionen` is written rather than judged, so a read of it would not belong here.
JUDGED_COLLECTIONS = frozenset({Collection.BEWERBUNGEN, Collection.SAISONS, Collection.TEAMS, Collection.SAISON_TEAMS})


class _ReadSpy(monitoring.CommandListener):
    """Every read this client sends, and whether the server was told it belongs to a transaction.

    `autocommit` and not `txnNumber`: that flag IS the instruction, so a read carries it exactly
    when the claim holds; a number only stands in for it.
    """

    def __init__(self) -> None:
        self.reads: list[tuple[str, bool]] = []

    def started(self, event: monitoring.CommandStartedEvent) -> None:
        if event.command_name in ("find", "aggregate"):
            self.reads.append((str(event.command.get(event.command_name)), event.command.get("autocommit") is False))

    def succeeded(self, event: monitoring.CommandSucceededEvent) -> None:
        """Required by the listener interface; this spy judges the command as it is sent."""

    def failed(self, event: monitoring.CommandFailedEvent) -> None:
        """Required by the listener interface; a failed read is still one this spy has seen started."""


class TestTheAcceptanceJudgesWhatItReadsInsideTheTransaction:
    """That the session reaches the SERVER, which is what the callback's docstring claims.

    On the wire, not in the source: a sweep proves the keyword is spelled, and this proves the
    transaction it names is the one the read ran in.
    """

    def test_every_read_the_acceptance_judges_is_sent_inside_the_transaction(self, mongo_replica_set_url: str):
        """Strip `session=session` from any of the four judged reads and this fails.

        `PICKED_BEWERBUNG` rather than the new school's: the picked branch is the one that reads all
        four collections, a new school's reaching `teams` only to write it.
        """

        spy = _ReadSpy()

        async def body(database: AsyncDatabase, _client: AsyncMongoClient) -> Any:
            # A client of this test's own, so the spy sees the endpoint's commands rather than the
            # seeding `on_a_league` did through the fixture's.
            watched = AsyncMongoClient(mongo_replica_set_url, event_listeners=[spy])
            try:
                await accept(watched[DATABASE_NAME], watched, PICKED_BEWERBUNG)
            finally:
                await watched.close()

            return spy.reads

        reads = on_a_league(mongo_replica_set_url, body)
        judged = [(collection, in_transaction) for collection, in_transaction in reads if collection in JUDGED_COLLECTIONS]

        # The floor: a spy that saw nothing, or a branch that stopped reading one of the four, would
        # pass the clause below while proving nothing about it.
        assert {collection for collection, _ in judged} == JUDGED_COLLECTIONS

        assert [collection for collection, in_transaction in judged if not in_transaction] == []


# A school whose own URL carries the three characters `validate_external_url` strips. Storable as
# submitted: `bewerbungen` types `website_url` as a bare string (`docs/backend/spec.md :: I16`).
DIRTY_URL_BEWERBUNG = ObjectId("6890a1b2c3d4e5f607920008")
DIRTY_URL = "https://wirbelknoten\t.example.de/\rpfad"
DIRTY_URL_NAME, DIRTY_URL_SHORTHAND = "Wirbelknoten", "WK"


def without_the_id(document: Mapping[str, Any]) -> dict[str, Any]:
    """One stored club minus the key the driver assigns, which is all two inserts of one school may differ by."""

    return {field: value for field, value in document.items() if field != "_id"}


class TestOneSchoolMakesOneClubWhicheverPathCreatesIt:
    """`POST /teams` and an acceptance are two ways to the same collection, so they store one document for one school."""

    def test_the_created_club_holds_what_the_guard_parsed_rather_than_the_block_as_submitted(self, mongo_replica_set_url: str):
        """Store the COMPOSED block instead and this fails: its `website_url` keeps the tab and the carriage return.

        Against what `POST /teams` itself stored for this school, so the claim rests on that path
        rather than on a copy of its expression.
        """

        schule = {**schule_block(DIRTY_URL_NAME, DIRTY_URL_SHORTHAND), "website_url": DIRTY_URL}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            posted = await post_team(
                team_data=FLPostTeamPayload.model_validate(compose_new_club(schule=schule)),
                teams_collection=database[Collection.TEAMS],
            )
            through_post_teams = await database[Collection.TEAMS].find_one({"_id": posted.created_id})
            # Taken back out before the acceptance runs: `uniq_shorthand` spans every club, so one
            # school cannot hold two of them at once.
            await database[Collection.TEAMS].delete_one({"_id": posted.created_id})

            await database[Collection.BEWERBUNGEN].insert_one(bewerbung_document(DIRTY_URL_BEWERBUNG, schule=schule))
            await accept(database, client, DIRTY_URL_BEWERBUNG)

            return through_post_teams, await database[Collection.TEAMS].find_one({"shorthand": DIRTY_URL_SHORTHAND})

        through_post_teams, created = on_a_league(mongo_replica_set_url, body)

        assert through_post_teams is not None, "`POST /teams` stored nothing, so the comparison below stands on one document"
        assert created is not None, "no club was created for a school that named none"

        # Every key either insert wrote, `inactive_since` included: both paths owe it.
        assert without_the_id(created) == without_the_id(through_post_teams)
        # The floor: two paths that both stored the block as submitted would compare equal above.
        assert created["website_url"] == "https://wirbelknoten.example.de/pfad"


class TestAnAcceptanceTakenOnAStaleJudgement:
    """The final patch carries the status, so a stale judgement enters nobody.

    The transaction closes this window: one snapshot serves the judged reads and the write, so a
    decline between them costs a write conflict. The filter is the second lock.
    """

    def test_it_enters_no_school_and_leaves_the_decline_standing(self, mongo_replica_set_url: str):
        """Drop the status from the final patch's filter and this fails.

        Both halves land there: the three people hold a rejection letter, and the club they applied
        for stands in the season the letter turned them down for.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline(database, PICKED_BEWERBUNG)
            after_decline = await stored_bewerbung(database, PICKED_BEWERBUNG)

            with pytest.raises(DocumentNotFoundException) as refused:
                await annehmen_bewerbung(
                    bewerbung_id=PICKED_BEWERBUNG,
                    annahme_data=FLAnnehmenBewerbungPayload.model_validate({"gruppe": "A", "trikot_farbe": "blau"}),
                    # The application as the acceptance judged it, an instant before the decline landed.
                    bewerbungen_collection=as_the_loser_read_it(database[Collection.BEWERBUNGEN], {**after_decline, "status": "eingereicht"}),
                    teams_collection=database[Collection.TEAMS],
                    saison_teams_collection=database[Collection.SAISON_TEAMS],
                    saisons_collection=database[Collection.SAISONS],
                    db=client,
                    today=TODAY,
                    von=OTHER_ADMIN_EMAIL,
                )

            return refused.value.status_code, after_decline, await stored_bewerbung(database, PICKED_BEWERBUNG), await junction_rows(database)

        status_code, after_decline, after_acceptance, rows = on_a_league(mongo_replica_set_url, body)

        assert after_acceptance == after_decline, "the acceptance overwrote the decision the applicants were sent"
        assert rows == [], "the school was entered into the season its own application was declined for"
        # 404 rather than the decline's 409: that endpoint re-reads because its window is real and a
        # raced decision must not read as a missing application. Nothing reaches this one.
        assert status_code == 404
