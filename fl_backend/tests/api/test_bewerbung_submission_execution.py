import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Awaitable, Callable, Mapping
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient
from httpx import Response
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import MongoClient
from pymongo.errors import OperationFailure

from app.api.bewerbungen.public_router import post_bewerbung
from app.api.bewerbungen.schemas import FLBewerbung, FLPostBewerbungPayload
from app.api.bewerbungen.services import (
    BEWERBUNG_FENSTER_GESCHLOSSEN,
    BEWERBUNG_PICKED_CLUB_ALREADY_ENTERED,
    BEWERBUNG_PICKED_CLUB_UNUSABLE,
    BEWERBUNG_SHORTHAND_TAKEN,
    BEWERBUNG_SUBMISSION_SUBJECT_UNRESOLVED,
    compose_kontakte,
)
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.dependencies import get_germany_now
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
from app.core.recording import PUBLIC_ACTOR_EMAIL
from app.core.security import ACTOR_HEADER
from app.main import create_app
from tests.config import build_test_config
from tests.database import a_clean_database, a_clean_database_sync

# Module level, as `tests/api/test_bewerbung_triage_execution.py` marks its suite: every test below
# reaches a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = "fl_bewerbung_submission_test"

SAISON_ID = "2026"
TODAY = "2026-04-01"
# Injected through `get_germany_now` for the cases driven over HTTP, so the day is not the wall clock.
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

# Fixed rather than generated, so a failure names the same row every run.
EXISTING_OID = ObjectId("6890a1b2c3d4e5f607940001")
RETIRED_OID = ObjectId("6890a1b2c3d4e5f607940002")
ENTERED_OID = ObjectId("6890a1b2c3d4e5f607940003")
# A club no `teams` document holds, which is what a client sending an id it was never given looks like.
UNKNOWN_OID = ObjectId("6890a1b2c3d4e5f60794ffff")

EXISTING_NAME, EXISTING_SHORTHAND = "Adler", "AD"
RETIRED_NAME, RETIRED_SHORTHAND = "Bieber", "BI"
ENTERED_NAME, ENTERED_SHORTHAND = "Cassiopeia", "CA"

# Free, unlike `EXISTING_SHORTHAND`, which `uniq_shorthand` already holds.
NEW_SCHOOL_SHORTHAND = "ZX"

OPEN_WINDOW: Mapping[str, Any] = {"offen": True, "von": "2026-03-01", "bis": "2026-04-30"}

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


def person(vorname: str, *, telefon: str, email: str | None = None) -> dict[str, Any]:
    """One contact person as the PUBLIC form submits them: a consent of two fields, and no stored scope or date."""

    return {
        "vorname": vorname,
        "nachname": f"{vorname}-Mustermann",
        "email": email or f"{vorname.lower()}@example.com",
        "telefon": telefon,
        "geburtsdatum": "1980-05-04",
        "einwilligung": {"text_version": "v3", "erteilt": True},
    }


# Distinct on every field a rule compares, so a case moving one of them is the only thing under test.
KONTAKTE: Mapping[str, Any] = {
    "trainer": person("Wraxlington", telefon="+49 170 1111111"),
    "ansprechperson": person("Quillhilde", telefon="+49 170 2222222"),
    "stellvertretung": person("Bramblewick", telefon="+49 170 3333333"),
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


def schule_block(**overrides: Any) -> dict[str, Any]:
    return {
        "team_name": "Zorbanax",
        "full_name": "Zorbanax-Gesamtschule",
        "shorthand": NEW_SCHOOL_SHORTHAND,
        "schulform": "gesamtschule",
        "address": dict(ADDRESS),
        "website_url": "https://zorbanax.example.de",
        **overrides,
    }


def payload(**overrides: Any) -> dict[str, Any]:
    """A whole submission, valid, that each case moves one field of."""

    return {
        "saison_id": SAISON_ID,
        "team_id": str(EXISTING_OID),
        "schule": None,
        "kontakte": {seat: dict(value) if isinstance(value, dict) else value for seat, value in KONTAKTE.items()},
        "trikot": {"vorhandener_satz": "16 rote Trikots, Größe M", "wunschfarbe": "rot"},
        "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
        **overrides,
    }


Body = Callable[[AsyncIOMotorDatabase], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, bewerbung: Any = OPEN_WINDOW) -> Any:
    """The SHIPPED validators and indexes, so a document production would refuse fails here too.

    One client and event loop per call: Motor binds to the loop it first ran on.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            saison: dict[str, Any] = {
                "_id": SAISON_ID,
                "start_date": "2026-01-01",
                "end_date": "2026-06-30",
                "status": "future",
                "rules": dict(RULES),
                "bewerbung": None if bewerbung is None else dict(bewerbung),
            }
            await database[Collection.SAISONS].insert_one(saison)
            await database[Collection.TEAMS].insert_many(
                [
                    club_document(EXISTING_OID, EXISTING_NAME, EXISTING_SHORTHAND),
                    club_document(RETIRED_OID, RETIRED_NAME, RETIRED_SHORTHAND, inactive_since="2026-03-01"),
                    club_document(ENTERED_OID, ENTERED_NAME, ENTERED_SHORTHAND),
                ]
            )
            await database[Collection.SAISON_TEAMS].insert_one(
                {
                    "saison_id": SAISON_ID,
                    "team_id": ENTERED_OID,
                    "gruppe": "A",
                    "austritt": None,
                    "name": ENTERED_NAME,
                    "shorthand": ENTERED_SHORTHAND,
                }
            )

            return await body(database)

    return asyncio.run(_run())


async def submit(database: AsyncIOMotorDatabase, **overrides: Any) -> Any:
    return await post_bewerbung(
        bewerbung_data=FLPostBewerbungPayload.model_validate(payload(**overrides)),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        today=TODAY,
    )


class TestWhatASubmissionStores:
    """The document the shipped `$jsonSchema` accepts, which is the only shape the triage can then read."""

    def test_a_picked_club_is_stored_as_an_undecided_application(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase) -> Mapping[str, Any]:
            response = await submit(database)
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert stored is not None
            return stored

        stored = on_a_league(mongo_replica_set_url, body)

        assert stored["status"] == "eingereicht"
        assert stored["eingereicht_am"] == TODAY
        assert stored["team_id"] == EXISTING_OID
        assert stored["schule"] is None
        # Present and null, never absent: `required` in the validator means the KEY is there, so an
        # omitted null is a rejection rather than a stored null.
        assert "entscheidung" in stored and stored["entscheidung"] is None

    def test_a_new_school_is_stored_with_no_club_named(self, mongo_replica_set_url: str):
        """The other branch, which the validator types differently: `schule` is the object and `team_id` the null."""

        async def body(database: AsyncIOMotorDatabase) -> Mapping[str, Any]:
            response = await submit(database, team_id=None, schule=schule_block())
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert stored is not None
            return stored

        stored = on_a_league(mongo_replica_set_url, body)

        assert "team_id" in stored and stored["team_id"] is None
        assert stored["schule"]["shorthand"] == NEW_SCHOOL_SHORTHAND

    def test_each_consent_is_the_one_the_server_composed(self, mongo_replica_set_url: str):
        """The applicant supplied a wording version and a tick; the scope, the source and the day are the league's."""

        async def body(database: AsyncIOMotorDatabase) -> Mapping[str, Any]:
            response = await submit(database)
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert stored is not None
            return stored

        stored = on_a_league(mongo_replica_set_url, body)

        for seat in ("trainer", "ansprechperson", "stellvertretung"):
            assert stored["kontakte"][seat]["einwilligung"] == {
                "umfang": "kontaktdaten",
                "erteilt_von": "person",
                "text_version": "v3",
                "datum": TODAY,
            }

    def test_the_named_opponent_is_stored_as_the_school_wrote_it(self, mongo_replica_set_url: str):
        """A free string and never a reference: nothing resolves it against a club, at the write or afterwards."""

        async def body(database: AsyncIOMotorDatabase) -> Mapping[str, Any]:
            response = await submit(database, wunschgegner="Zorbanax-Gesamtschule")
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert stored is not None
            return stored

        assert on_a_league(mongo_replica_set_url, body)["wunschgegner"] == "Zorbanax-Gesamtschule"

    def test_a_submission_naming_no_opponent_still_writes_the_key(self, mongo_replica_set_url: str):
        """The validator cannot require it, so only the write keeps every application this endpoint makes one shape."""

        async def body(database: AsyncIOMotorDatabase) -> Mapping[str, Any]:
            response = await submit(database)
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert stored is not None
            return stored

        stored = on_a_league(mongo_replica_set_url, body)

        assert "wunschgegner" in stored and stored["wunschgegner"] is None

    def test_the_response_echoes_nothing_of_the_submission(self, mongo_replica_set_url: str):
        """The three people's details went one way; a body repeating them is a copy in every proxy between."""

        response = on_a_league(mongo_replica_set_url, lambda database: submit(database))

        assert set(response.model_dump()) == {"acknowledged", "created_id", "saison_id", "eingereicht_am"}


class TestWhatTheLogRecords:
    """An insert carries no `before`, so the row says an application arrived and never what was in it."""

    def test_one_row_naming_the_application_and_holding_no_image(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase) -> Mapping[str, Any]:
            response = await submit(database)
            rows = await database[Collection.AKTIONEN].find({"collection": str(Collection.BEWERBUNGEN)}).to_list(length=None)

            assert len(rows) == 1
            assert rows[0]["document_id"] == response.created_id
            return rows[0]

        row = on_a_league(mongo_replica_set_url, body)

        assert row["operation"] == "insert"
        assert row["before"] is None

    def test_no_submitted_value_reaches_the_row(self, mongo_replica_set_url: str):
        """Searched as TEXT over the whole row: a field carried in under any key would show up here."""

        async def body(database: AsyncIOMotorDatabase) -> str:
            await submit(database)
            rows = await database[Collection.AKTIONEN].find({"collection": str(Collection.BEWERBUNGEN)}).to_list(length=None)

            return str(rows)

        rendered = on_a_league(mongo_replica_set_url, body)

        for submitted in ("Wraxlington", "quillhilde@example.com", "+49 170 1111111", "1980-05-04"):
            assert submitted not in rendered


def refused(url: str, *, bewerbung: Any = OPEN_WINDOW, **overrides: Any) -> DocumentConflictException:
    """One submission expected to be refused, with the exception it raised."""

    async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
        with pytest.raises(DocumentConflictException) as failure:
            await submit(database, **overrides)

        # Nothing was written: a refusal that stored the row anyway would be a 409 the applicant
        # could resend past, and a triage queue holding what the league said it would not take.
        assert await database[Collection.BEWERBUNGEN].count_documents({}) == 0

        return failure.value

    return on_a_league(url, body, bewerbung=bewerbung)


class TestTheRefusalsTheWritePathAnswers:
    """Each code, over a real database, so a refusal wired to no read is caught here rather than in production."""

    @pytest.mark.parametrize(
        "bewerbung",
        [
            pytest.param(None, id="no window recorded"),
            pytest.param({**OPEN_WINDOW, "offen": False}, id="the flag turned off"),
            pytest.param({"offen": True, "von": "2026-05-01", "bis": "2026-05-31"}, id="a span this day is outside"),
        ],
    )
    def test_a_season_taking_no_applications_refuses(self, mongo_replica_set_url: str, bewerbung: Any):
        assert refused(mongo_replica_set_url, bewerbung=bewerbung).error_code == BEWERBUNG_FENSTER_GESCHLOSSEN

    def test_a_season_no_document_names_is_a_404(self, mongo_replica_set_url: str):
        """A 404 rather than `REQ-BEWERBUNG-004`: nothing was refused, the season the body names does not exist."""

        async def body(database: AsyncIOMotorDatabase) -> None:
            with pytest.raises(DocumentNotFoundException):
                await submit(database, saison_id="1999")

        on_a_league(mongo_replica_set_url, body)

    @pytest.mark.parametrize(
        ("team_id", "schule"),
        [
            pytest.param(str(EXISTING_OID), schule_block(), id="both"),
            pytest.param(None, None, id="neither"),
        ],
    )
    def test_a_submission_naming_no_single_applicant_refuses(self, mongo_replica_set_url: str, team_id: Any, schule: Any):
        failure = refused(mongo_replica_set_url, team_id=team_id, schule=schule)

        assert failure.error_code == BEWERBUNG_SUBMISSION_SUBJECT_UNRESOLVED

    @pytest.mark.parametrize(
        "team_id",
        [
            pytest.param(str(RETIRED_OID), id="a club that left the league"),
            pytest.param(str(UNKNOWN_OID), id="an id no club holds"),
        ],
    )
    def test_a_club_the_list_does_not_offer_refuses(self, mongo_replica_set_url: str, team_id: str):
        """The same code for both, so a client sending an id it was never given learns nothing about which."""

        assert refused(mongo_replica_set_url, team_id=team_id).error_code == BEWERBUNG_PICKED_CLUB_UNUSABLE

    def test_a_club_already_playing_the_season_refuses(self, mongo_replica_set_url: str):
        assert refused(mongo_replica_set_url, team_id=str(ENTERED_OID)).error_code == BEWERBUNG_PICKED_CLUB_ALREADY_ENTERED

    def test_a_new_school_proposing_a_taken_kuerzel_refuses(self, mongo_replica_set_url: str):
        """Asked of a NEW school alone; `uniq_shorthand` is what would otherwise fail at acceptance."""

        failure = refused(mongo_replica_set_url, team_id=None, schule=schule_block(shorthand=EXISTING_SHORTHAND))

        assert failure.error_code == BEWERBUNG_SHORTHAND_TAKEN

    def test_a_picked_club_is_not_refused_for_holding_its_own_kuerzel(self, mongo_replica_set_url: str):
        """The control for the case above: a shorthand check reaching both branches would make applying impossible."""

        response = on_a_league(mongo_replica_set_url, lambda database: submit(database))

        assert response.created_id is not None


class TestTwoSchoolsMayApplyForOneSeason:
    """Explicitly NOT refused: a season takes many applications, and nothing here is a queue of one."""

    def test_a_second_new_school_is_stored_beside_the_first(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase) -> int:
            await submit(database, team_id=None, schule=schule_block())
            await submit(database, team_id=None, schule=schule_block(team_name="Yttrium", shorthand="YT"))

            return await database[Collection.BEWERBUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body) == 2


# The HTTP surface, on a SECOND database: `build_test_config`'s, the one an app under test resolves
# its collections from. Seeded with pymongo, as `tests/api/test_spiele_public_read.py` seeds its own.
@dataclass(frozen=True)
class Submitted:
    """Everything a case below reads, gathered before the client that read it is closed."""

    response: Response
    stored: int
    log_rows: list[Mapping[str, Any]]


def through_the_app(url: str, body: Mapping[str, Any], *, headers: Mapping[str, str] | None = None) -> Submitted:
    """One submission over the wire, so the guard, the actor binder and the response model all run."""

    database_name = build_test_config().db_base_name

    client = MongoClient(url)
    try:
        database = a_clean_database_sync(client, url, database_name)
        database[Collection.SAISONS].insert_one(
            {
                "_id": SAISON_ID,
                "start_date": "2026-01-01",
                "end_date": "2026-06-30",
                "status": "future",
                "rules": dict(RULES),
                "bewerbung": dict(OPEN_WINDOW),
            }
        )
        database[Collection.TEAMS].insert_one(club_document(EXISTING_OID, EXISTING_NAME, EXISTING_SHORTHAND))

        app = create_app(build_test_config())
        app.state.db_client = AsyncIOMotorClient(host=url, serverSelectionTimeoutMS=30_000)
        app.dependency_overrides[get_germany_now] = lambda: NOW

        try:
            response = TestClient(app, raise_server_exceptions=False).post(
                f"/api/v{API_VERSION}/bewerbungen",
                json=dict(body),
                headers={"Authorization": "Bearer test-key-base"} if headers is None else dict(headers),
            )
        finally:
            app.state.db_client.close()

        # Read HERE: the client below is closed on the way out, and a handle returned through it
        # would be dead by the time a case touched it.
        return Submitted(
            response=response,
            stored=database[Collection.BEWERBUNGEN].count_documents({}),
            log_rows=list(database[Collection.AKTIONEN].find({"collection": str(Collection.BEWERBUNGEN)})),
        )
    finally:
        client.close()


class TestASubmissionMadeOverTheWire:
    """What calling the endpoint function directly cannot prove: the guard, the binder and the log row a real request writes."""

    def test_the_base_key_reaches_the_write(self, mongo_replica_set_url: str):
        """Also the floor under the two refusals below: without it each would pass on a write nothing reaches."""

        submitted = through_the_app(mongo_replica_set_url, payload())

        assert submitted.response.status_code == 200
        assert submitted.response.json()["eingereicht_am"] == TODAY
        assert submitted.stored == 1

    def test_no_key_reaches_none_of_it(self, mongo_replica_set_url: str):
        """Public here means no SESSION, never no key: a bearer token is checked before the body is parsed."""

        submitted = through_the_app(mongo_replica_set_url, payload(), headers={})

        assert submitted.response.status_code == 401
        assert submitted.stored == 0

    def test_no_actor_header_is_demanded(self, mongo_replica_set_url: str):
        """The whole reason the router declares `bind_public_actor`: `bind_actor` would answer `REQ-AUTH-005` here."""

        assert through_the_app(mongo_replica_set_url, payload()).response.status_code != 401

    def test_the_row_is_attributed_to_the_public_rather_than_to_the_system(self, mongo_replica_set_url: str):
        """`system` means a write made outside a request; this one was made through one, by nobody."""

        rows = through_the_app(mongo_replica_set_url, payload()).log_rows

        assert len(rows) == 1
        assert rows[0]["actor"] == {"kind": "public", "email": PUBLIC_ACTOR_EMAIL}
        assert rows[0]["request"] == {"method": "POST", "path": f"/api/v{API_VERSION}/bewerbungen"}

    def test_a_forged_actor_header_does_not_reach_the_row(self, mongo_replica_set_url: str):
        """The header `bind_actor` reads is the one this route must ignore, and the row is where that shows.

        Over the wire rather than through the binder alone: what is asserted is the stored
        `aktionen.actor`, which is the record an erasure is audited against.
        """

        forged = {"Authorization": "Bearer test-key-base", ACTOR_HEADER: "attacker@example.com"}
        submitted = through_the_app(mongo_replica_set_url, payload(), headers=forged)

        assert submitted.response.status_code == 200
        assert len(submitted.log_rows) == 1
        assert submitted.log_rows[0]["actor"] == {"kind": "public", "email": PUBLIC_ACTOR_EMAIL}
        assert "attacker@example.com" not in str(submitted.log_rows[0])

    def test_a_body_breaking_a_shape_rule_is_a_422_rather_than_a_409(self, mongo_replica_set_url: str):
        """The distinctness rule is about the BODY, not a judgement against the database, so it reaches no refusal code."""

        shared = dict(KONTAKTE["ansprechperson"], telefon=KONTAKTE["trainer"]["telefon"])
        submitted = through_the_app(mongo_replica_set_url, payload(kontakte={**KONTAKTE, "ansprechperson": shared}))

        assert submitted.response.status_code == 422
        assert submitted.stored == 0

    def test_a_refusal_is_a_409_carrying_its_code(self, mongo_replica_set_url: str):
        """The contract a client maps to German: the code reaches the body, not just the status."""

        submitted = through_the_app(mongo_replica_set_url, payload(team_id=str(UNKNOWN_OID)))

        assert submitted.response.status_code == 409
        assert submitted.response.json()["error_code"] == BEWERBUNG_PICKED_CLUB_UNUSABLE


# The validator refuses what the models refuse: `gute_spieler` is non-nullable on every side, not
# the payload alone, so the stored shape is `bsonType: "int"` and no null.
DOCUMENT_VALIDATION_FAILED = 121


def _parsed_kontakte() -> dict[str, Any]:
    """The three people as the payload leaves them, so only the `kader` below is under test."""

    return FLPostBewerbungPayload.model_validate(payload()).kontakte.model_dump(mode="json")


def _application_without_a_wish() -> dict[str, Any]:
    """One application in the shape every one stored before `wunschgegner` existed carries: no such key."""

    return {
        "saison_id": SAISON_ID,
        "eingereicht_am": TODAY,
        "status": "eingereicht",
        "team_id": EXISTING_OID,
        "schule": None,
        "kontakte": compose_kontakte(kontakte=_parsed_kontakte(), today=TODAY),
        "trikot": {"vorhandener_satz": "16 rote Trikots", "wunschfarbe": "rot"},
        "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
        "entscheidung": None,
    }


def _stored_with(database: AsyncIOMotorDatabase, kader: Mapping[str, Any]) -> Awaitable[str]:
    """One application inserted straight past the models, so only the `$jsonSchema` can be refusing it."""

    async def _insert() -> str:
        document = {
            "saison_id": SAISON_ID,
            "eingereicht_am": TODAY,
            "status": "eingereicht",
            "team_id": EXISTING_OID,
            "schule": None,
            "kontakte": compose_kontakte(kontakte=_parsed_kontakte(), today=TODAY),
            "trikot": {"vorhandener_satz": "16 rote Trikots", "wunschfarbe": "rot"},
            "kader": dict(kader),
            "entscheidung": None,
        }
        try:
            await database[Collection.BEWERBUNGEN].insert_one(document)
        except OperationFailure as failure:
            assert failure.code == DOCUMENT_VALIDATION_FAILED, f"expected a validation failure, got {failure.code}"
            return "rejected"
        return "accepted"

    return _insert()


class TestTheDatabaseRefusesACountItCannotHold:
    """The half no model can prove: `gute_spieler` is non-nullable in the `$jsonSchema` too.

    Without it the validator could drift back to `int|null` with every Python test still green.
    """

    def test_a_null_count_is_refused_by_the_validator(self, mongo_replica_set_url: str):
        null_count = {"voraussichtliche_groesse": 14, "gute_spieler": None}

        assert on_a_league(mongo_replica_set_url, lambda database: _stored_with(database, null_count)) == "rejected"

    def test_an_omitted_count_is_refused_too(self, mongo_replica_set_url: str):
        """`required` names the key, so an absent one is a rejection rather than a stored null."""

        assert on_a_league(mongo_replica_set_url, lambda database: _stored_with(database, {"voraussichtliche_groesse": 14})) == "rejected"

    def test_a_real_count_is_stored(self, mongo_replica_set_url: str):
        """The control: without it both cases above would pass on a validator that refuses every kader."""

        real_count = {"voraussichtliche_groesse": 14, "gute_spieler": 0}

        assert on_a_league(mongo_replica_set_url, lambda database: _stored_with(database, real_count)) == "accepted"


class TestTheDatabaseHoldsAClubWithNoWebsite:
    """The half no model can prove: `website_url` is nullable in BOTH `$jsonSchema`s too.

    A model relaxed while a validator stayed `bsonType: "string"` refuses the write at the driver,
    which is the direction that ships silently.
    """

    def test_an_application_naming_no_website_is_stored(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase) -> Any:
            response = await submit(database, team_id=None, schule=schule_block(website_url=None))
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": response.created_id})

            assert stored is not None
            # Parsed through the read model too: storing it and being unable to read it back would
            # 500 the triage list over the one row an administrator has to decide.
            return FLBewerbung(**stored).schule

        schule_read = on_a_league(mongo_replica_set_url, body)

        assert schule_read is not None
        assert schule_read.website_url is None

    def test_a_club_naming_no_website_is_stored(self, mongo_replica_set_url: str):
        """`teams` carries its own validator, and acceptance is what writes a club from an application."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await database[Collection.TEAMS].insert_one(club_document(UNKNOWN_OID, "Ohnesite", "OS") | {"website_url": None})
            stored = await database[Collection.TEAMS].find_one({"_id": UNKNOWN_OID})

            assert stored is not None
            return stored["website_url"]

        assert on_a_league(mongo_replica_set_url, body) is None

    def test_the_key_is_still_required_even_when_null(self, mongo_replica_set_url: str):
        """Nullable, not optional: `required` names the key, so an omitted one is still a rejection."""

        async def body(database: AsyncIOMotorDatabase) -> str:
            document = club_document(UNKNOWN_OID, "Ohneschluessel", "OK")
            del document["website_url"]
            try:
                await database[Collection.TEAMS].insert_one(document)
            except OperationFailure as failure:
                assert failure.code == DOCUMENT_VALIDATION_FAILED, f"expected a validation failure, got {failure.code}"
                return "rejected"
            return "accepted"

        assert on_a_league(mongo_replica_set_url, body) == "rejected"


class TestTheDatabaseStillHoldsAnApplicationWithNoColour:
    """`wunschfarbe` narrowed on the PAYLOAD alone, so the stored shape did not move.

    A validator or read model narrowed with it would refuse a row the triage has to show.
    """

    def test_a_stored_null_colour_is_accepted_and_reads_back_through_the_model(self, mongo_replica_set_url: str):
        """Read back through `FLBewerbung`, not with a raw `find_one`: parsing is where a narrowed model would fail."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            document = {
                "saison_id": SAISON_ID,
                "eingereicht_am": TODAY,
                "status": "eingereicht",
                "team_id": EXISTING_OID,
                "schule": None,
                "kontakte": compose_kontakte(kontakte=_parsed_kontakte(), today=TODAY),
                # The colour an administrator has not assigned. The payload admits no null here, so
                # only a stored row reaches the read models carrying one.
                "trikot": {"vorhandener_satz": "16 rote Trikots", "wunschfarbe": None},
                "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
                "entscheidung": None,
            }
            created = await database[Collection.BEWERBUNGEN].insert_one(document)
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": created.inserted_id})

            assert stored is not None
            return FLBewerbung(**stored).trikot.wunschfarbe

        assert on_a_league(mongo_replica_set_url, body) is None

    def test_the_key_is_still_required_even_when_null(self, mongo_replica_set_url: str):
        """Nullable, not optional: `required` names the key on the stored shape."""

        async def body(database: AsyncIOMotorDatabase) -> str:
            document = {
                "saison_id": SAISON_ID,
                "eingereicht_am": TODAY,
                "status": "eingereicht",
                "team_id": EXISTING_OID,
                "schule": None,
                "kontakte": compose_kontakte(kontakte=_parsed_kontakte(), today=TODAY),
                "trikot": {"vorhandener_satz": "16 rote Trikots"},
                "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
                "entscheidung": None,
            }
            try:
                await database[Collection.BEWERBUNGEN].insert_one(document)
            except OperationFailure as failure:
                assert failure.code == DOCUMENT_VALIDATION_FAILED, f"expected a validation failure, got {failure.code}"
                return "rejected"
            return "accepted"

        assert on_a_league(mongo_replica_set_url, body) == "rejected"


class TestTheDatabaseStillHoldsAnApplicationStoredBeforeTheOpponentField:
    """`wunschgegner` is outside the validator's `required`, which every application predating it depends on.

    The triage's `$set` re-runs the validator over the WHOLE document, so requiring the key would
    refuse every decision on one of those.
    """

    def test_a_document_carrying_no_key_at_all_is_accepted(self, mongo_replica_set_url: str):
        """The shipped `$jsonSchema`, so a document production would refuse fails here too."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            created = await database[Collection.BEWERBUNGEN].insert_one(_application_without_a_wish())
            stored = await database[Collection.BEWERBUNGEN].find_one({"_id": created.inserted_id})

            assert stored is not None
            # Read back through `FLBewerbung`, not off the raw document: parsing is where a model
            # without the default would fail.
            return FLBewerbung(**stored).wunschgegner

        assert on_a_league(mongo_replica_set_url, body) is None

    def test_a_decision_on_one_is_still_accepted(self, mongo_replica_set_url: str):
        """The failure that would ship silently: nothing writes `wunschgegner`, and the whole document is re-validated."""

        async def body(database: AsyncIOMotorDatabase) -> str:
            created = await database[Collection.BEWERBUNGEN].insert_one(_application_without_a_wish())
            try:
                await database[Collection.BEWERBUNGEN].update_one(
                    {"_id": created.inserted_id},
                    {"$set": {"status": "abgelehnt", "entscheidung": {"getroffen_am": TODAY, "von": "admin", "grund": "kein Platz"}}},
                )
            except OperationFailure as failure:
                assert failure.code == DOCUMENT_VALIDATION_FAILED, f"expected a validation failure, got {failure.code}"
                return "rejected"
            return "accepted"

        assert on_a_league(mongo_replica_set_url, body) == "accepted"


class TestAKuerzelARetiredClubStillHolds:
    """The write path's lookup spans retired clubs, because `uniq_shorthand` does.

    Narrow it and a new school passes here, then fails at ACCEPTANCE on the duplicate key -- the
    dead end `REQ-BEWERBUNG-006`'s wording exists to close, reached through `schule`.
    """

    def test_a_new_school_proposing_a_retired_clubs_kuerzel_is_refused(self, mongo_replica_set_url: str):
        """Only a lookup spanning retired clubs can be refusing this.

        `RETIRED_SHORTHAND` is held by exactly one club, and that club has left the league.
        """

        failure = refused(mongo_replica_set_url, team_id=None, schule=schule_block(shorthand=RETIRED_SHORTHAND))

        assert failure.error_code == BEWERBUNG_SHORTHAND_TAKEN

    def test_a_kuerzel_no_club_holds_is_still_accepted(self, mongo_replica_set_url: str):
        """The control: a lookup matching everything would refuse this too, and applying would be impossible."""

        response = on_a_league(mongo_replica_set_url, lambda database: submit(database, team_id=None, schule=schule_block()))

        assert response.created_id is not None

    def test_the_availability_check_and_the_write_agree_about_a_retired_club(self, mongo_replica_set_url: str):
        """Two lookups, one rule. They drifted before: the read was pinned against narrowing and the write was not."""

        async def body(database: AsyncIOMotorDatabase) -> int:
            return await database[Collection.TEAMS].count_documents({"shorthand": RETIRED_SHORTHAND})

        assert on_a_league(mongo_replica_set_url, body) == 1
