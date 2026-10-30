"""
API · an administrator's erasure on a mailed request, held against the person's own erasure's whole-database seed

The seed is `tests/api/test_funktionen_loeschung.py`'s, one address holding every kind of record, beside
the suite's grants an administrator signs in through. Every case asks what the database holds after
the request, so a step, a refusal or a reset missing from the route fails here.
"""

import functools
import logging
import time
from collections.abc import Awaitable, Callable, Iterator, Mapping
from datetime import timedelta
from typing import Any, cast

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import AsyncClient, Response
from pydantic import ValidationError
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase

from app.api.berechtigungen.antraege import compose_antrag
from app.api.identitaet.admin_router import get_loeschung_ansicht, post_loeschung
from app.api.identitaet.schemas import (
    FLLoeschung,
    FLLoeschungAdressePayload,
    FLLoeschungAnsichtResponse,
    FLLoeschungPayload,
    FLLoeschungResponse,
)
from app.api.schiedsrichter.services import build_ghost_schiedsrichter
from app.api.sperrliste.services import compose_gesperrt_bis_saison_id
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import ANCHOR_FIELD, patch_one_in_db
from app.core.db import collection_dependency
from app.core.journal import JOURNAL_TOKEN
from app.core.recording import Actor
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.main import create_app
from app.shared.schemas.bounds import LOESCHUNG_ANLASS_MAX_LENGTH
from tests.actor_tokens import FRESH_ADMIN_ACTOR, SignedActor
from tests.app_client import app_client
from tests.bans import ban_list
from tests.config import ADMIN_KEY, ADMINISTRATORS, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import ban_document, spiel_document
from tests.isolation import InterleavedCollection
from tests.loeschung import loeschung_collections
from tests.whole_database import where_held
from tests.worker import worker_database

from .conftest import config_for
from .test_funktionen_loeschung import (
    ANTRAG_BY_THEM_OID,
    ANTRAG_FOR_THEM_OID,
    BEWERBUNG_OID,
    BLOCKLESS_BEWERBUNG_OID,
    DECLINED_OID,
    GEBURTSDATUM,
    HOME_TEAM_OID,
    IDENTIFIER,
    MOVING_PUPIL_CHANGE_OID,
    NACHNAME,
    NOW,
    OTHER_OWNER,
    OTHER_OWNER_OID,
    OTHER_REFEREE_CHANGE_OID,
    OTHER_TEAM_OID,
    PAYMENT,
    PENDING_OID,
    PUPIL_OID,
    REFEREE_NAME,
    REFEREE_OID,
    SAISON_ID,
    SPIELTAG_OID,
    THEIR_CHANGE_OID,
    THEIR_GRANT_OID,
    THEIR_VALUES,
    TYPED,
    VORNAME,
    a_grant,
    a_person_holding_everything,
    acting,
    as_person,
    everything_in,
    pending_changes,
)
from .test_funktionen_loeschung import PATH as SELBST_PATH

DATABASE_NAME = worker_database("fl_loeschung_auf_anfrage_test")

CONFIG = config_for(DATABASE_NAME)

PATH = f"/api/v{API_VERSION}/identitaet/loeschung"
ANSICHT_PATH = f"{PATH}/ansicht"
ABMELDUNG_PATH = f"/api/v{API_VERSION}/identitaet/abmeldung"

# The suite's owner, and an administrator holding no owner's power, who presses unless a case says otherwise.
OWNER, OPERATOR = ADMINISTRATORS[0], ADMINISTRATORS[1]
ANOTHER_ADMINISTRATOR = ADMINISTRATORS[3]
GRANT_ID_OF = {row["adresse"]: row["_id"] for row in grants_for_the_suite()}

ANLASS = "Mail vom 30.03.2026, Betreff: Bitte löscht alle meine Daten"

# An address a hand edit gave the referees' sentinel, which no erasure may reach through it.
SENTINEL_ADDRESS = "von.hand@example.com"

# A grant typed in the person's capitals, which admits nobody and goes with their erasure.
# Another such row, of an address nobody erases: no request matches it, so it stands.

# What the erasure counts and its reveal names nothing of, as the reveal's description says: the fixtures moved onto the
# ghost.
COUNTED_AND_NOT_NAMED = ("spiele",)

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


@functools.cache
def _app() -> FastAPI:
    return create_app(CONFIG)


@pytest.fixture(scope="module", autouse=True)
def _built_before_any_case() -> None:
    """Never inside a case: a build re-runs the logging `dictConfig`, which strips the handler `caplog` reads that case's records from."""

    _app()


def on_a_league(url: str, body: Body) -> Any:
    """The person holding everything, beside the suite's grants, on the shipped indexes."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())
            await a_person_holding_everything(database)

            return await body(database, client)

    return on_the_seed_loop(_run())


def on_a_league_of_its_own(url: str, body: Body) -> Any:
    """The suite's grants alone, the body seeding what else it needs."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())

            return await body(database, client)

    return on_the_seed_loop(_run())


async def posted(url: str, path: str, body: Mapping[str, Any], *, by: str = OPERATOR) -> Response:
    async with app_client(url, app=_app(), now=NOW) as http:
        return await http.post(path, json=dict(body), headers=SignedActor(by, ADMIN_KEY))


def loeschung_of(email: str = TYPED, anlass: str = ANLASS) -> dict[str, str]:
    return {"email": email, "anlass": anlass}


def ansicht_of(email: str = TYPED) -> dict[str, str]:
    return {"email": email}


async def geloescht_by_the_handler(
    database: AsyncDatabase, client: AsyncMongoClient, *, email: str = TYPED, anlass: str = ANLASS, **replaced: Any
) -> FLLoeschungResponse:
    """The route's own function outside a request, as `OPERATOR` signed in a minute ago, for a case driving the driver itself."""

    return await post_loeschung(
        loeschung_data=FLLoeschungPayload(email=email, anlass=anlass),
        **loeschung_collections(database, **replaced),
        sperrliste=ban_list(database),
        # Refusing none: the window is held over HTTP, in `tests/api/test_step_up_execution.py`.
        actor=FRESH_ADMIN_ACTOR,
        db=client,
        config=CONFIG,
        operator=OPERATOR,
        auth_time=int(time.time()) - 60,
        germany_now=NOW,
    )


async def revealed(database: AsyncDatabase, client: AsyncMongoClient, email: str) -> FLLoeschungAnsichtResponse:
    """The reveal's own function outside a request, as `OPERATOR`, for a league holding no grant to sign in through."""

    return await get_loeschung_ansicht(
        ansicht_data=FLLoeschungAdressePayload(email=email),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spieler_collection=database[Collection.SPIELER],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        spiele_collection=database[Collection.SPIELE],
        berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
        berechtigungen_angekuendigt_collection=database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT],
        berechtigungen_antraege_collection=database[Collection.BERECHTIGUNGEN_ANTRAEGE],
        sperrliste=ban_list(database),
        db=client,
        config=CONFIG,
        operator=OPERATOR,
        auth_time=int(time.time()) - 60,
        germany_now=NOW,
    )


def journal_lines(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [record.getMessage() for record in caplog.records if record.getMessage().startswith(JOURNAL_TOKEN)]


async def filed_by(database: AsyncDatabase, path: str) -> list[Mapping[str, Any]]:
    """The log rows the request on `path` filed, which every other request's rows are told apart from by their own path."""

    return await database[Collection.AKTIONEN].find({"request.path": path}).to_list(length=None)


def _object_ids(value: Any) -> Iterator[ObjectId]:
    if isinstance(value, ObjectId):
        yield value
    elif isinstance(value, Mapping):
        for item in value.values():
            yield from _object_ids(item)
    elif isinstance(value, list):
        for item in value:
            yield from _object_ids(item)


def _ranked(value: Any, rank: Mapping[ObjectId, int]) -> Any:
    if isinstance(value, ObjectId):
        return rank[value]
    if isinstance(value, Mapping):
        return {key: _ranked(item, rank) for key, item in value.items()}
    if isinstance(value, list):
        return [_ranked(item, rank) for item in value]
    return value


def what_is_left(collections: Mapping[str, list[Any]]) -> Any:
    """The database by rank: two seeds mint ids in one order, so ranks compare where ids cannot.

    Log rows drop their clock, the request's own their filer and `anlass`; each grant drops its anchor's count.
    """

    left = {name: [dict(document) for document in documents] for name, documents in collections.items()}
    for row in left.get(Collection.AKTIONEN, []):
        filed = ("actor", "anlass", "request", "trace_id") if row.get("request") is not None else ()
        for key in ("at", "at_date", *filed):
            row.pop(key, None)
    for row in left.get(Collection.BERECHTIGUNGEN, []):
        row.pop(ANCHOR_FIELD, None)

    return _ranked(left, {object_id: index for index, object_id in enumerate(sorted(set(_object_ids(left))))})


def keys_anywhere(value: Any) -> set[str]:
    if isinstance(value, Mapping):
        return set(value).union(*(keys_anywhere(item) for item in value.values()))
    if isinstance(value, list):
        return set().union(*(keys_anywhere(item) for item in value))
    return set()


def registration(registrierung_id: ObjectId, status: str) -> dict[str, str]:
    return {
        "registrierung_id": str(registrierung_id),
        "saison_id": SAISON_ID,
        "team_id": str(HOME_TEAM_OID),
        "team_name": "Heim-Schule",
        "status": status,
        "vorname": VORNAME,
        "nachname": NACHNAME,
    }


async def their_requests_open(database: AsyncDatabase) -> None:
    """The seed's two requests, asked far off so no TTL pass removes them and so lapsed at the suite's clock, open again."""

    await database[Collection.BERECHTIGUNGEN_ANTRAEGE].update_many({}, {"$set": {"genehmigung.bis": NOW + timedelta(days=1)}})


# Every record the seed's person holds, as the page links each: compared whole, so every key at every depth is asserted.
# The seed's requests opened by `their_requests_open`.
EXPECTED_ANSICHT = {
    "spieler": [
        {
            "spieler_id": str(PUPIL_OID),
            "vorname": VORNAME,
            "nachname": NACHNAME,
            "kader": [{"saison_id": SAISON_ID, "team_id": str(HOME_TEAM_OID), "team_name": "Heim-Schule", "inactive_since": None}],
        }
    ],
    # Booked on a played fixture alone, which needs nobody afterwards.
    "schiedsrichter": [
        {"schiedsrichter_id": str(REFEREE_OID), "name": REFEREE_NAME, "inactive_since": None, "spiele_ohne_ergebnis_saison_ids": []}
    ],
    "sitze": [
        {
            "saison_id": SAISON_ID,
            "team_id": str(HOME_TEAM_OID),
            "team_name": "Heim-Schule",
            "rolle": "ansprechperson",
            "vorname": VORNAME,
            "nachname": NACHNAME,
        }
    ],
    "bewerbungen": [
        {"bewerbung_id": str(BEWERBUNG_OID), "saison_id": SAISON_ID, "rolle": "trainer", "vorname": VORNAME, "nachname": NACHNAME},
        {
            "bewerbung_id": str(BLOCKLESS_BEWERBUNG_OID),
            "saison_id": SAISON_ID,
            "rolle": "ansprechperson",
            "vorname": VORNAME,
            "nachname": NACHNAME,
        },
    ],
    "registrierungen": [registration(PENDING_OID, "eingereicht"), registration(DECLINED_OID, "abgelehnt")],
    # Another referee's and another pupil's change to the address: each change goes and its person's row stands.
    "adresswechsel": [
        {"adresswechsel_id": str(OTHER_REFEREE_CHANGE_OID), "einsehbar_verwehrt": None},
        {"adresswechsel_id": str(MOVING_PUPIL_CHANGE_OID), "einsehbar_verwehrt": None},
    ],
    "eigener_adresswechsel": None,
    # A grant asked for their address and one they asked for another's.
    "antraege": [
        {"antrag_id": str(ANTRAG_FOR_THEM_OID), "verwaltung": "administration", "rolle": "betroffen"},
        {"antrag_id": str(ANTRAG_BY_THEM_OID), "verwaltung": "administration", "rolle": "gestellt"},
    ],
    "verwaltung": "administration",
    "gesperrt": False,
}


@pytest.mark.db
class TestTheRegistryRunsWhole:
    """The person's whole data on one pass, with no precondition about their state."""

    def test_every_kind_goes_on_one_pass_a_pupil_in_a_live_squad_among_them(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            live = {"saison_id": SAISON_ID, "team_id": HOME_TEAM_OID, "inactive_since": None}
            pupil = await database[Collection.SPIELER].find_one({"_id": PUPIL_OID})
            before = (await where_held(database, *THEIR_VALUES), await database[Collection.SAISON_SPIELER].count_documents(live))
            response = await posted(mongo_replica_set_url, PATH, loeschung_of())
            after = (await where_held(database, *THEIR_VALUES), await database[Collection.SAISON_SPIELER].count_documents(live))

            return pupil, before, response, after

        pupil, (held, squad), response, (left, squad_left) = on_a_league(mongo_replica_set_url, body)

        # The premise first: a retired pupil would pass a precondition put back in front of the erasure.
        assert pupil is not None and pupil["inactive_since"] is None
        assert all(held[value] for value in THEIR_VALUES), held
        assert response.status_code == 200, response.json()
        assert response.json() == {
            "spieler": 1,
            "saison_spieler": 1,
            "schiedsrichter": 1,
            "spiele": 1,
            "kontakt_sitze": 3,
            "registrierungen": 2,
            "adresswechsel": 2,
            "berechtigungen": 0,
            # The request about their address and the one they asked.
            "berechtigungen_antraege": 2,
        }
        assert left == dict.fromkeys(THEIR_VALUES, [])
        assert (squad, squad_left) == (2, 1)

    def test_the_persons_own_route_leaves_the_same_database(self, mongo_replica_set_url: str):
        """Fails where the two routes ever run different scopes or steps; who filed the erasure's own rows, and why, is all that differs."""

        def after(request: Callable[[AsyncClient], Awaitable[Response]]) -> Any:
            async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
                async with app_client(mongo_replica_set_url, app=_app(), now=NOW) as http:
                    status = (await request(http)).status_code

                return status, what_is_left(await everything_in(database))

            return on_a_league(mongo_replica_set_url, body)

        by_the_administrator = after(lambda http: http.post(PATH, json=loeschung_of(), headers=SignedActor(OPERATOR, ADMIN_KEY)))
        by_the_person = after(lambda http: http.post(SELBST_PATH, headers=as_person(TYPED)))

        assert (by_the_administrator[0], by_the_person[0]) == (200, 200)
        assert by_the_administrator[1] == by_the_person[1]


@pytest.mark.db
class TestTheirOwnAddress:
    """`eigene_adresse`: an administrator's own address goes through their account page, or through another administrator."""

    @pytest.mark.parametrize(
        ("path", "body"),
        [(ANSICHT_PATH, ansicht_of), (PATH, loeschung_of), (ABMELDUNG_PATH, ansicht_of)],
        ids=["the reveal", "the erasure", "the sign-out"],
    )
    def test_it_is_refused_in_other_capitals_and_between_spaces_and_nothing_is_written(
        self, mongo_replica_set_url: str, path: str, body: Callable[[str], dict[str, str]]
    ):
        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await everything_in(database)
            response = await posted(mongo_replica_set_url, path, body(f"  {OPERATOR.upper()} "))

            return response, before == await everything_in(database)

        response, untouched = on_a_league(mongo_replica_set_url, run)

        assert (response.status_code, response.json()["error_code"], untouched) == (403, Code.EIGENE_ADRESSE, True)

    @pytest.mark.parametrize(
        ("path", "body"),
        [(ANSICHT_PATH, ansicht_of), (PATH, loeschung_of), (ABMELDUNG_PATH, ansicht_of)],
        ids=["the reveal", "the erasure", "the sign-out"],
    )
    def test_another_administrators_address_is_not_refused(self, mongo_replica_set_url: str, path: str, body: Callable[[str], dict[str, str]]):
        """Pressed by an owner, whom `verwaltung_adresse` refuses nothing, so the own address's refusal alone is asked."""

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await posted(mongo_replica_set_url, path, body(ANOTHER_ADMINISTRATOR), by=OWNER)

        assert on_a_league(mongo_replica_set_url, run).status_code == 200


@pytest.mark.db
class TestAGrantHoldersAddress:
    """`verwaltung_adresse`: judged inside the erasure's transaction, and in the reveal's snapshot."""

    @pytest.mark.parametrize(
        ("path", "body", "address"),
        [
            (ANSICHT_PATH, ansicht_of, OWNER),
            (PATH, loeschung_of, OWNER),
            (ABMELDUNG_PATH, ansicht_of, OWNER),
            (ANSICHT_PATH, ansicht_of, ANOTHER_ADMINISTRATOR),
            (PATH, loeschung_of, ANOTHER_ADMINISTRATOR),
        ],
        ids=[
            "the reveal of an owner",
            "the erasure of an owner",
            "the sign-out of an owner",
            "the reveal of an administrator",
            "the erasure of an administrator",
        ],
    )
    def test_an_administrator_holding_no_owners_power_is_refused_and_nothing_is_written(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture, path: str, body: Callable[[str], dict[str, str]], address: str
    ):
        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await everything_in(database)
            response = await posted(mongo_replica_set_url, path, body(address))

            return response, before == await everything_in(database)

        with caplog.at_level(logging.INFO):
            response, untouched = on_a_league(mongo_replica_set_url, run)

        assert (response.status_code, response.json()["error_code"], untouched) == (403, Code.VERWALTUNG_ADRESSE, True)
        assert journal_lines(caplog) == []

    def test_an_administrator_holding_no_owners_power_ends_another_administrators_sessions(self, mongo_replica_set_url: str):
        """The sign-out holds back an owner's address alone: signing in again repairs an ended session, as no erasure is."""

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await posted(mongo_replica_set_url, ABMELDUNG_PATH, ansicht_of(ANOTHER_ADMINISTRATOR))

            return response.status_code, len(await filed_by(database, ABMELDUNG_PATH))

        assert on_a_league(mongo_replica_set_url, run) == (200, 1)

    def test_an_owner_loescht_another_owners_address(self, mongo_replica_set_url: str):
        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, OTHER_OWNER_OID, OTHER_OWNER, "owner")
            ansicht = await posted(mongo_replica_set_url, ANSICHT_PATH, ansicht_of(OTHER_OWNER), by=OWNER)
            loeschung = await posted(mongo_replica_set_url, PATH, loeschung_of(OTHER_OWNER), by=OWNER)

            return (
                ansicht.json()["verwaltung"],
                loeschung.json(),
                await database[Collection.BERECHTIGUNGEN].count_documents({"adresse": OTHER_OWNER}),
            )

        verwaltung, geloescht, left = on_a_league(mongo_replica_set_url, run)

        assert (verwaltung, geloescht["berechtigungen"], left) == ("owner", 1, 0)

    def test_a_grant_landing_inside_the_loeschung_is_refused_by_its_retry(self, mongo_replica_set_url: str):
        """The rival grants the address access after the first attempt's judgement and before its first write, the anchor both write.

        Judged once ahead of the transaction instead, the retry ends a grant this administrator could not revoke.
        """

        granted: list[int] = []
        racing: list[PupilsReadMeetingARival] = []

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # Asked at the suite's clock, a century ahead of the real one, so no TTL pass removes it: the rival approves it.
            await database[Collection.BERECHTIGUNGEN_ANTRAEGE].delete_many({"adresse": IDENTIFIER})
            antrag = await database[Collection.BERECHTIGUNGEN_ANTRAEGE].insert_one(
                compose_antrag(adresse=IDENTIFIER, verwaltung="administration", berechtigung_id=None, gestartet_von=OWNER, now=NOW)
            )
            held = await where_held(database, *THEIR_VALUES)
            served = _app()
            async with app_client(mongo_replica_set_url, app=served, now=NOW) as http:

                async def grant() -> None:
                    approved = await http.post(
                        f"/api/v{API_VERSION}/berechtigungen/antraege/{antrag.inserted_id}/genehmigung",
                        headers=SignedActor(ANOTHER_ADMINISTRATOR, ADMIN_KEY),
                    )
                    granted.append(approved.status_code)

                async def pupils() -> AsyncCollection:
                    # The app's own client: the request's session belongs to it.
                    racing.append(PupilsReadMeetingARival(served.state.db_client[DATABASE_NAME][Collection.SPIELER], grant))
                    return cast(AsyncCollection, racing[-1])

                served.dependency_overrides[collection_dependency(Collection.SPIELER)] = pupils
                response = await http.post(PATH, json=loeschung_of(), headers=SignedActor(OPERATOR, ADMIN_KEY))

            return (
                response,
                held,
                await where_held(database, *THEIR_VALUES),
                await database[Collection.BERECHTIGUNGEN].find_one({"adresse": IDENTIFIER}),
            )

        response, held, left, row = on_a_league(mongo_replica_set_url, body)

        assert (response.status_code, response.json().get("error_code"), granted) == (403, Code.VERWALTUNG_ADRESSE, [200])
        assert row is not None and row["verwaltung"] == "administration"
        # The rows the grant wrote aside, every value stands where it stood.
        assert {value: [name for name in found if name not in THE_GRANTS_OWN_ROWS] for value, found in left.items()} == held
        # The premise last: the first attempt passed its judgement and read the pupils, which a grant landing first refuses.
        racing[0].assert_landed_inside(serially=0)


@pytest.mark.db
class TestTheReveal:
    """Every record of the person's the erasure removes or empties, by its own selections, stored nowhere."""

    def test_it_names_every_record_the_loeschung_removes_by_the_ids_its_links_need_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
            await their_requests_open(database)
            before = await everything_in(database)
            response = await posted(mongo_replica_set_url, ANSICHT_PATH, ansicht_of(), by=OWNER)

            return response, before == await everything_in(database)

        response, untouched = on_a_league(mongo_replica_set_url, body)
        answer = response.json()

        assert response.status_code == 200, answer
        assert answer == EXPECTED_ANSICHT
        assert keys_anywhere(answer) & {"email", "geburtsdatum"} == set()
        assert "@" not in response.text and GEBURTSDATUM not in response.text
        assert untouched

    def test_it_serves_each_rows_retirement_and_every_season_a_referee_holds_an_unplayed_fixture_in(self, mongo_replica_set_url: str):
        """Two unplayed fixtures share a season, named once.

        A cancelled one is no booking `schiedsrichter_still_assigned` judges, and its season stays unnamed.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_SPIELER].update_one({"spieler_id": PUPIL_OID}, {"$set": {"inactive_since": "2026-03-20"}})
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": REFEREE_OID}, {"$set": {"inactive_since": "2026-03-21"}})
            booking = {"schiedsrichter_id": REFEREE_OID, "name": REFEREE_NAME, "payment": PAYMENT}
            await database[Collection.SPIELE].insert_many(
                [
                    spiel_document(
                        spiel_id=ObjectId(), saison_id=saison_id, spiel_nr=spiel_nr, spieltag_id=SPIELTAG_OID, schiedsrichter=booking, **fields
                    )
                    for saison_id, spiel_nr, fields in (
                        ("2028", 1, {}),
                        ("2027", 1, {}),
                        ("2028", 2, {}),
                        ("2029", 1, {"sonderereignis": "ausgefallen"}),
                    )
                ]
            )

            return (await posted(mongo_replica_set_url, ANSICHT_PATH, ansicht_of())).json()

        answer = on_a_league(mongo_replica_set_url, body)

        assert [kader["inactive_since"] for kader in answer["spieler"][0]["kader"]] == ["2026-03-20"]
        assert [(row["inactive_since"], row["spiele_ohne_ergebnis_saison_ids"]) for row in answer["schiedsrichter"]] == [
            ("2026-03-21", ["2027", "2028"])
        ]

    def test_it_says_a_standing_ban_holds_the_address_typed_in_another_spelling(self, mongo_replica_set_url: str):
        """The ban keyed on the fold and read for the capitals the person typed; `EXPECTED_ANSICHT` is the address no ban holds."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPERRLISTE].insert_one(
                ban_document(IDENTIFIER, bis=compose_gesperrt_bis_saison_id(massgebliche_saison_id=SAISON_ID))
            )

            return (await posted(mongo_replica_set_url, ANSICHT_PATH, ansicht_of(TYPED))).json()

        assert on_a_league(mongo_replica_set_url, body)["gesperrt"] is True

    def test_it_names_as_many_of_each_kind_as_the_loeschung_then_removes(self, mongo_replica_set_url: str):
        """Read against the erasure's own answer rather than the seed, so a kind it names short is caught whatever the seed holds."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
            await their_requests_open(database)
            ansicht = (await posted(mongo_replica_set_url, ANSICHT_PATH, ansicht_of(), by=OWNER)).json()

            return ansicht, (await posted(mongo_replica_set_url, PATH, loeschung_of(), by=OWNER)).json()

        ansicht, geloescht = on_a_league(mongo_replica_set_url, body)
        named = {
            "spieler": len(ansicht["spieler"]),
            "saison_spieler": sum(len(spieler["kader"]) for spieler in ansicht["spieler"]),
            "schiedsrichter": len(ansicht["schiedsrichter"]),
            "kontakt_sitze": len(ansicht["sitze"]) + len(ansicht["bewerbungen"]),
            "registrierungen": len(ansicht["registrierungen"]),
            "adresswechsel": len(ansicht["adresswechsel"]) + (ansicht["eigener_adresswechsel"] is not None),
            "berechtigungen_antraege": len(ansicht["antraege"]),
        }

        assert named == {key: geloescht[key] for key in named}
        # The grant is named by its tier and removed.
        assert (ansicht["verwaltung"], geloescht["berechtigungen"]) == ("administration", 1)
        # Every count is compared above or one the reveal names nothing of: a count added to the answer fails here until placed.
        assert {*named, "berechtigungen", *COUNTED_AND_NOT_NAMED} == set(FLLoeschung.model_fields)
        # The premise: an address holding nothing would agree on zeros.
        assert all(geloescht[key] for key in FLLoeschung.model_fields)


# The address the seed's referee change moves away from, given a grant by the cases below.
CHANGING_HOLDER = "kraus.bernd@example.com"
CHANGING_HOLDER_GRANT_OID = ObjectId("6890a1b2c3d4e5f607e00003")


@pytest.mark.db
class TestAGrantHoldersPendingChange:
    """A grant holder's change naming the address is shown and ended only where the tool would open it."""

    @pytest.mark.parametrize("tier", ["administration", "owner"])
    def test_the_reveal_leaves_it_out_for_an_administrator_without_an_owners_power(self, mongo_replica_set_url: str, tier: str):
        """Named, it would answer whether a typed address is that change's new one, which the administrators page withholds."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, CHANGING_HOLDER_GRANT_OID, CHANGING_HOLDER, tier)
            return [
                (await posted(mongo_replica_set_url, ANSICHT_PATH, ansicht_of(), by=by)).json()["adresswechsel"] for by in (OPERATOR, OWNER)
            ]

        operators, owners = on_a_league(mongo_replica_set_url, body)

        assert operators == [{"adresswechsel_id": str(MOVING_PUPIL_CHANGE_OID), "einsehbar_verwehrt": None}]
        assert owners == [
            {"adresswechsel_id": str(OTHER_REFEREE_CHANGE_OID), "einsehbar_verwehrt": None},
            {"adresswechsel_id": str(MOVING_PUPIL_CHANGE_OID), "einsehbar_verwehrt": None},
        ]

    @pytest.mark.parametrize("tier", ["administration", "owner"])
    def test_the_loeschung_ending_it_is_the_owners_whatever_the_tier(self, mongo_replica_set_url: str, tier: str):
        """Ending it is a discard, which only an owner makes of an administrator's change."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, CHANGING_HOLDER_GRANT_OID, CHANGING_HOLDER, tier)
            before = await everything_in(database)
            by_operator = await posted(mongo_replica_set_url, PATH, loeschung_of())
            untouched = before == await everything_in(database)
            by_owner = by_operator if by_operator.status_code == 200 else await posted(mongo_replica_set_url, PATH, loeschung_of(), by=OWNER)
            ended = await database[Collection.ADRESSWECHSEL].find_one({"_id": OTHER_REFEREE_CHANGE_OID})
            return by_operator, untouched, by_owner.status_code, ended

        by_operator, untouched, owners_status, ended = on_a_league(mongo_replica_set_url, body)

        assert (by_operator.status_code, by_operator.json()["error_code"], untouched) == (403, Code.FREMDER_ADRESSWECHSEL, True)
        assert owners_status == 200
        assert ended is not None and ended["beendet"]["art"] == "verworfen"

    def test_the_reveal_names_their_own_change_and_open_requests_alone(self, mongo_replica_set_url: str):
        """A lapsed request is gone to every reader already, so it is left out though removed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await pending_changes(database, (THEIR_CHANGE_OID, IDENTIFIER, "neu.adresse@anderswo.org", "their-own-change", "2126-03-30"))
            await their_requests_open(database)
            lapsed = NOW - timedelta(days=8)
            await database[Collection.BERECHTIGUNGEN_ANTRAEGE].insert_one(
                compose_antrag(
                    adresse="verfallen@example.com",
                    verwaltung="owner",
                    berechtigung_id=None,
                    gestartet_von=IDENTIFIER,
                    now=lapsed,
                )
            )
            return (await posted(mongo_replica_set_url, ANSICHT_PATH, ansicht_of())).json()

        answer = on_a_league(mongo_replica_set_url, body)

        assert answer["eigener_adresswechsel"] == {"adresswechsel_id": str(THEIR_CHANGE_OID)}
        assert answer["antraege"] == EXPECTED_ANSICHT["antraege"]


@pytest.mark.db
class TestTheAnlass:
    """On every log row the administrator's erasure files, and on no other."""

    def test_every_row_the_loeschung_files_carries_it_stripped_and_no_other_row_does(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await posted(mongo_replica_set_url, PATH, loeschung_of(anlass=f"  {ANLASS}  "))

            return response.status_code, await database[Collection.AKTIONEN].find().to_list(length=None)

        status, rows = on_a_league(mongo_replica_set_url, body)
        filed = [row for row in rows if (row["request"] or {}).get("path") == PATH]

        assert status == 200
        assert filed, "the erasure filed no row, so the assertion below holds of nothing"
        assert {row["anlass"] for row in filed} == {ANLASS}
        assert {row.get("anlass") for row in rows if row not in filed} == {None}

    def test_a_write_its_context_records_afterwards_carries_none(self, mongo_replica_set_url: str):
        """Over HTTP each request runs in a context of its own, so a value left standing shows only in one context reused."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await geloescht_by_the_handler(database, client)
            await acting(
                Actor(kind="admin_session", email=OPERATOR),
                lambda: patch_one_in_db(
                    collection=database[Collection.TEAMS],
                    db_filter={"_id": OTHER_TEAM_OID},
                    update={"$set": {"name": "Gast-Schule am Main"}},
                    return_document=ReturnDocument.BEFORE,
                ),
            )
            rows = await database[Collection.AKTIONEN].find().sort("_id", -1).to_list(length=None)

            return rows[0], [row for row in rows if row.get("anlass") is not None]

        afterwards, carrying = on_a_league(mongo_replica_set_url, body)

        assert (afterwards["collection"], afterwards["document_id"], afterwards["anlass"]) == (str(Collection.TEAMS), OTHER_TEAM_OID, None)
        # The premise: the erasure in that context did set it.
        assert carrying, "no row carries the anlass, so its reset was never needed"

    def test_the_persons_own_loeschung_files_none(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async with app_client(mongo_replica_set_url, app=_app(), now=NOW) as http:
                status = (await http.post(SELBST_PATH, headers=as_person(TYPED))).status_code

            return status, await filed_by(database, SELBST_PATH)

        status, filed = on_a_league(mongo_replica_set_url, body)

        assert status == 200
        assert filed, "the erasure filed no row, so the assertion below holds of nothing"
        assert {row["anlass"] for row in filed} == {None}


class PupilsReadMeetingARival(InterleavedCollection):
    """The pupils the erasure reads ahead of its first write, a rival write committing first: inside the attempt."""

    async def aggregate(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.aggregate(*args, **kwargs)


# Where a grant's creation names its address besides the grant: its announced row and its notice.
THE_GRANTS_OWN_ROWS = frozenset({Collection.BERECHTIGUNGEN_ANGEKUENDIGT, Collection.POSTAUSGANG})


@pytest.mark.db
class TestAnotherAdministratorsAddress:
    def test_an_owner_ends_another_administrators_grant_and_its_notice_names_them(self, mongo_replica_set_url: str):
        """Only an owner presses here (`verwaltung_adresse`)."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await posted(mongo_replica_set_url, PATH, loeschung_of(ANOTHER_ADMINISTRATOR), by=OWNER)
            # One row per administrator a notice is owed to: the owner's copy, which every notice has.
            notices = [
                row["daten"]
                async for row in database[Collection.POSTAUSGANG].find(
                    {"schluessel": {"$regex": f"^berechtigung/{GRANT_ID_OF[ANOTHER_ADMINISTRATOR]}/"}, "an": OWNER}, sort=[("_id", 1)]
                )
            ]

            return response, await database[Collection.BERECHTIGUNGEN].count_documents({"adresse": ANOTHER_ADMINISTRATOR}), notices

        response, left, notices = on_a_league(mongo_replica_set_url, body)

        assert (response.status_code, response.json()["berechtigungen"], left) == (200, 1, 0)
        # The end's notice names who ended the grant: the pressing owner, on the person's request. A pasted grant nobody
        # announced is announced first, by the database.
        assert [(notice["aenderung"], notice["geaendert_von"]) for notice in notices] == [("erteilt", None), ("entzogen", OWNER)]


@pytest.mark.db
class TestRowsNoMailboxNames:
    """What no request may reach through this route: the referees' sentinel."""

    def test_the_referees_sentinel_given_an_address_by_hand_is_reached_by_neither_request(self, mongo_replica_set_url: str):
        """The referee step selects by id past the sentinel, the address notwithstanding: the route inherits the registry's exclusion."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            ghost = build_ghost_schiedsrichter()
            await database[Collection.SCHIEDSRICHTER].insert_one({**ghost, "kontakt": {**ghost["kontakt"], "email": SENTINEL_ADDRESS}})
            ansicht = await posted(mongo_replica_set_url, ANSICHT_PATH, ansicht_of(SENTINEL_ADDRESS))
            loeschung = await posted(mongo_replica_set_url, PATH, loeschung_of(SENTINEL_ADDRESS))

            return (
                ansicht.json(),
                loeschung.json(),
                await database[Collection.SCHIEDSRICHTER].count_documents({"_id": GHOST_SCHIEDSRICHTER_ID}),
            )

        ansicht, geloescht, referees = on_a_league_of_its_own(mongo_replica_set_url, body)

        assert ansicht["schiedsrichter"] == []
        assert (geloescht["schiedsrichter"], referees) == (0, 1)


@pytest.mark.db
class TestTheSignOut:
    """One row naming who ended an address's sessions and when, never the address."""

    def test_it_files_one_row_naming_the_operator_and_the_act_and_writes_nothing_else(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await everything_in(database)
            response = await posted(mongo_replica_set_url, ABMELDUNG_PATH, ansicht_of())
            after = await everything_in(database)
            async with app_client(mongo_replica_set_url, app=_app(), now=NOW) as http:
                served = await http.get(
                    f"/api/v{API_VERSION}/aktionen", params={"collection": "anmeldungen"}, headers=SignedActor(OPERATOR, ADMIN_KEY)
                )

            return response, before, after, served.json()

        response, before, after, served = on_a_league(mongo_replica_set_url, body)
        filed = [row for row in after[Collection.AKTIONEN] if row not in before[Collection.AKTIONEN]]

        assert (response.status_code, response.json()) == (200, {})
        assert {**after, Collection.AKTIONEN: None} == {**before, Collection.AKTIONEN: None}
        assert [{key: row[key] for key in ROW_KEYS} for row in filed] == [
            {
                "actor": {"kind": "admin_session", "email": OPERATOR},
                "request": {"method": "POST", "path": ABMELDUNG_PATH},
                "collection": "anmeldungen",
                "operation": "delete_many",
                "document_id": None,
                "db_filter": None,
                "before": None,
                "modified_count": None,
                "redacted_at": None,
                "anlass": None,
            }
        ]
        assert IDENTIFIER not in str(filed).lower()
        # The log's own read serves it under the act's name.
        assert [aktion["collection"] for aktion in served["aktionen"]] == ["anmeldungen"]


# What a sign-out's row holds besides its clock and trace.
ROW_KEYS = ("actor", "request", "collection", "operation", "document_id", "db_filter", "before", "modified_count", "redacted_at", "anlass")


# --- Refused by the payload, which the route validates before any read.


class TestTheAnlassIsRefusedAtTheBox:
    """A refusal alone tells nothing: one refused for another field is refused too, so the location is asserted."""

    @pytest.mark.parametrize(
        "body",
        [
            pytest.param({"email": TYPED}, id="none sent"),
            pytest.param(loeschung_of(anlass="   "), id="spaces alone"),
            pytest.param(loeschung_of(anlass="x" * (LOESCHUNG_ANLASS_MAX_LENGTH + 1)), id="one past the bound"),
            pytest.param(loeschung_of(anlass="Mail vom 30.03.\nBetreff: Löschung"), id="two lines"),
            pytest.param(loeschung_of(anlass="Mail von anna.mueller@schule.de"), id="holding an address"),
        ],
    )
    def test_the_loeschung_is_refused_naming_it(self, body: dict[str, str]):
        with pytest.raises(ValidationError) as raised:
            FLLoeschungPayload.model_validate(body)

        assert [error["loc"] for error in raised.value.errors()] == [("anlass",)]

    def test_the_bound_itself_is_taken(self):
        """The control: a payload refusing every anlass would pass the cases above."""

        anlass = "x" * LOESCHUNG_ANLASS_MAX_LENGTH

        assert FLLoeschungPayload.model_validate(loeschung_of(anlass=anlass)).anlass == anlass
