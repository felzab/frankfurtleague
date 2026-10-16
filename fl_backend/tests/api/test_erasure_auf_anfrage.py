"""
API · an administrator's erasure on a mailed request, held against the person's own erasure's whole-database seed

The seed is `tests/api/test_funktionen_erasure.py`'s, one address holding every kind of record, beside
the suite's grants an administrator signs in through. Every case asks what the database holds after
the request, so a step, a refusal or a reset missing from the route fails here.
"""

import asyncio
import functools
import logging
import time
from collections.abc import Awaitable, Callable, Iterator, Mapping
from typing import Any, cast

import pymongo
import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import AsyncClient, Response
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identitaet.admin_router import erase_auf_anfrage, get_erasure_ansicht_auf_anfrage
from app.api.identitaet.schemas import FLErasure, FLErasureAnsichtPayload, FLErasureAnsichtResponse, FLErasurePayload, FLErasureResponse
from app.api.identitaet.services import (
    EIGENE_ADRESSE,
    NAME_IM_ANLASS,
    NAME_IM_GRUND,
    VERWALTUNG_ADRESSE,
    eigene_namen,
    find_name_im_anlass_refusal,
    find_name_im_grund_refusal,
)
from app.api.schiedsrichter.services import build_ghost_schiedsrichter
from app.api.sperrliste.services import compose_gesperrt_bis_saison_id
from app.api.spieler.services import build_ghost_spieler
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import ANCHOR_FIELD, ANCHOR_WRITTEN_AT, patch_one_in_db
from app.core.db import DEAD_GRANT, get_aktionen_collection, get_spieler_collection
from app.core.exception_handlers import DATABASE_FAILED, PAYLOAD_REFUSED, UNKNOWN_OUTCOME
from app.core.journal import JOURNAL_TOKEN
from app.core.recording import Actor
from app.core.security import ACTOR_NOT_ADMIN, get_recent_confirmation_check
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID, GHOST_SPIELER_ID
from app.main import create_app
from app.shared.schemas.bounds import ERASURE_ANLASS_MAX_LENGTH
from tests.actor_tokens import FRESH_ADMIN_ACTOR, SignedActor
from tests.app_client import app_client
from tests.bans import ban_list
from tests.config import ADMIN_KEY, ADMINISTRATORS, UNANSWERED_DEADLINE_S, UNANSWERED_URI, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import ban_document, schiedsrichter_document, spiel_document
from tests.erasure import erasure_collections
from tests.isolation import InterleavedCollection
from tests.whole_database import where_held
from tests.worker import worker_database

from .conftest import config_for
from .test_funktionen_erasure import (
    BEWERBUNG_OID,
    BLOCKLESS_BEWERBUNG_OID,
    DECLINED_OID,
    GEBURTSDATUM,
    GRANTED_BY_THEM_OID,
    HOME_TEAM_OID,
    IDENTIFIER,
    MOVING_PUPIL_OID,
    NACHNAME,
    NOW,
    OTHER_OWNER,
    OTHER_OWNER_OID,
    OTHER_REFEREE_OID,
    OTHER_TEAM_OID,
    PAYMENT,
    PENDING_OID,
    PUPIL_OID,
    REFEREE_NAME,
    REFEREE_OID,
    SAISON_ID,
    SPIELTAG_OID,
    THEIR_GRANT_OID,
    THEIR_VALUES,
    TYPED,
    VORNAME,
    a_grant,
    a_person_holding_everything,
    acting,
    as_person,
    everything_in,
)
from .test_funktionen_erasure import PATH as SELBST_PATH

DATABASE_NAME = worker_database("fl_erasure_auf_anfrage_test")

CONFIG = config_for(DATABASE_NAME)

PATH = f"/api/v{API_VERSION}/identitaet/erasure"
ANSICHT_PATH = f"{PATH}/ansicht"
ABMELDUNG_PATH = f"/api/v{API_VERSION}/identitaet/abmeldung"

# The suite's owner, and an administrator holding no owner's power, who presses unless a case says otherwise.
OWNER, OPERATOR = ADMINISTRATORS[0], ADMINISTRATORS[1]
ANOTHER_ADMINISTRATOR = ADMINISTRATORS[3]
GRANT_ID_OF = {row["adresse"]: row["_id"] for row in grants_for_the_suite()}

ANLASS = "Mail vom 30.03.2026, Betreff: Bitte löscht alle meine Daten"

# What every address-less referee row holds, under RFC 6761's reserved `invalid`: one value, shared by every such row.
PLACEHOLDER = "adresse-fehlt@frankfurtleague.invalid"
PLACEHOLDER_REFEREE_OIDS = (ObjectId("6890a1b2c3d4e5f607d00001"), ObjectId("6890a1b2c3d4e5f607d00002"))

# An address a hand edit gave both sentinels, which no erasure may reach through them.
SENTINEL_ADDRESS = "von.hand@example.com"

# A grant typed in the person's capitals, which admits nobody and goes with their erasure.
DEAD_GRANT_OID = ObjectId("6890a1b2c3d4e5f607e00001")
# Another such row, of an address nobody erases: no request matches it, so it stands.
HAND_TYPED_GRANT_OID = ObjectId("6890a1b2c3d4e5f607e00002")

# What the erasure counts and its reveal names nothing of, as the reveal's description says: the fixtures moved onto the
# ghost, and the day counts.
COUNTED_AND_NOT_NAMED = ("spiele", "drosselung")

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


@functools.cache
def _app() -> FastAPI:
    return create_app(CONFIG)


@pytest.fixture(scope="module", autouse=True)
def _built_before_any_case() -> None:
    """Never inside a case: a build re-runs the logging `dictConfig`, which strips the handler `caplog` reads that case's records from."""

    _app()


def on_a_league(url: str, body: Body) -> Any:
    """The person holding everything, beside the suite's grants, on the shipped validators and indexes."""

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


def erasure_of(email: str = TYPED, anlass: str = ANLASS) -> dict[str, str]:
    return {"email": email, "anlass": anlass}


def ansicht_of(email: str = TYPED) -> dict[str, str]:
    return {"email": email}


async def erased_by_the_handler(
    database: AsyncDatabase, client: AsyncMongoClient, *, email: str = TYPED, anlass: str = ANLASS, **replaced: Any
) -> FLErasureResponse:
    """The route's own function outside a request, as `OPERATOR` signed in a minute ago, for a case driving the driver itself."""

    return await erase_auf_anfrage(
        erasure_data=FLErasurePayload(email=email, anlass=anlass),
        **erasure_collections(database, **replaced),
        sperrliste=ban_list(database),
        # Refusing none: the window is held over HTTP, in `tests/api/test_step_up_execution.py`.
        refuse_unconfirmed=get_recent_confirmation_check(FRESH_ADMIN_ACTOR),
        db=client,
        config=CONFIG,
        operator=OPERATOR,
        auth_time=int(time.time()) - 60,
        germany_now=NOW,
    )


async def revealed(database: AsyncDatabase, client: AsyncMongoClient, email: str) -> FLErasureAnsichtResponse:
    """The reveal's own function outside a request, as `OPERATOR`, for a league holding no grant to sign in through."""

    return await get_erasure_ansicht_auf_anfrage(
        ansicht_data=FLErasureAnsichtPayload(email=email),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spieler_collection=database[Collection.SPIELER],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        spiele_collection=database[Collection.SPIELE],
        berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
        berechtigungen_angekuendigt_collection=database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT],
        sperrliste=ban_list(database),
        db=client,
        config=CONFIG,
        operator=OPERATOR,
        auth_time=int(time.time()) - 60,
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

    Log rows drop their clock, the request's own their filer and `anlass`; each anchor drops its count, the address's
    its clock too.
    """

    left = {name: [dict(document) for document in documents] for name, documents in collections.items()}
    for row in left.get(Collection.AKTIONEN, []):
        filed = ("actor", "anlass", "request", "trace_id") if row.get("request") is not None else ()
        for key in ("at", "at_date", *filed):
            row.pop(key, None)
    for row in left.get(Collection.BERECHTIGUNGEN, []):
        row.pop(ANCHOR_FIELD, None)
    for row in left.get(Collection.ADRESSANKER, []):
        row.pop(ANCHOR_FIELD, None)
        row.pop(ANCHOR_WRITTEN_AT, None)

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


# Every record the seed's person holds, as the page links each: compared whole, so every key at every depth is asserted.
EXPECTED_ANSICHT = {
    "acknowledged": 1,
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
    "adresswechsel": [{"schiedsrichter_id": str(OTHER_REFEREE_OID)}],
    # Another pupil moving to the address: the change goes and their row stands.
    "spieler_adresswechsel": [{"spieler_id": str(MOVING_PUPIL_OID)}],
    "verwaltung": "administration",
    "gesperrt": False,
}


@pytest.mark.db
class TestTheRegistryRunsWhole:
    """`docs/backend/spec.md :: I682`: the person's whole data on one pass, with no precondition about their state."""

    def test_every_kind_goes_on_one_pass_a_pupil_in_a_live_squad_among_them(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            live = {"saison_id": SAISON_ID, "team_id": HOME_TEAM_OID, "inactive_since": None}
            pupil = await database[Collection.SPIELER].find_one({"_id": PUPIL_OID})
            before = (await where_held(database, *THEIR_VALUES), await database[Collection.SAISON_SPIELER].count_documents(live))
            response = await posted(mongo_replica_set_url, PATH, erasure_of())
            after = (await where_held(database, *THEIR_VALUES), await database[Collection.SAISON_SPIELER].count_documents(live))

            return pupil, before, response, after

        pupil, (held, squad), response, (left, squad_left) = on_a_league(mongo_replica_set_url, body)

        # The premise first: a retired pupil would pass a precondition put back in front of the erasure.
        assert pupil is not None and pupil["inactive_since"] is None
        assert all(held[value] for value in THEIR_VALUES), held
        assert response.status_code == 200, response.json()
        assert {key: value for key, value in response.json().items() if key != "acknowledged"} == {
            "spieler": 1,
            "saison_spieler": 1,
            "schiedsrichter": 1,
            "spiele": 1,
            "kontakt_sitze": 3,
            "registrierungen": 2,
            "adresswechsel": 2,
            "berechtigungen": 0,
            "drosselung": 3,
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

        by_the_administrator = after(lambda http: http.post(PATH, json=erasure_of(), headers=SignedActor(OPERATOR, ADMIN_KEY)))
        by_the_person = after(lambda http: http.post(SELBST_PATH, headers=as_person(TYPED)))

        assert (by_the_administrator[0], by_the_person[0]) == (200, 200)
        assert by_the_administrator[1] == by_the_person[1]


@pytest.mark.db
class TestTheirOwnAddress:
    """`REQ-PURGE-003`: an administrator's own address goes through their account page, or through another administrator."""

    @pytest.mark.parametrize(
        ("path", "body"),
        [(ANSICHT_PATH, ansicht_of), (PATH, erasure_of), (ABMELDUNG_PATH, ansicht_of)],
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

        assert (response.status_code, response.json()["error_code"], untouched) == (403, EIGENE_ADRESSE, True)

    @pytest.mark.parametrize(
        ("path", "body"),
        [(ANSICHT_PATH, ansicht_of), (PATH, erasure_of), (ABMELDUNG_PATH, ansicht_of)],
        ids=["the reveal", "the erasure", "the sign-out"],
    )
    def test_another_administrators_address_is_not_refused(self, mongo_replica_set_url: str, path: str, body: Callable[[str], dict[str, str]]):
        """Pressed by an owner, whom `REQ-PURGE-005` refuses nothing, so the own address's refusal alone is asked."""

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await posted(mongo_replica_set_url, path, body(ANOTHER_ADMINISTRATOR), by=OWNER)

        assert on_a_league(mongo_replica_set_url, run).status_code == 200


@pytest.mark.db
class TestAGrantHoldersAddress:
    """`REQ-PURGE-005`: judged inside the erasure's transaction, and in the reveal's snapshot."""

    @pytest.mark.parametrize(
        ("path", "body", "address"),
        [
            (ANSICHT_PATH, ansicht_of, OWNER),
            (PATH, erasure_of, OWNER),
            (ABMELDUNG_PATH, ansicht_of, OWNER),
            (ANSICHT_PATH, ansicht_of, ANOTHER_ADMINISTRATOR),
            (PATH, erasure_of, ANOTHER_ADMINISTRATOR),
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

        assert (response.status_code, response.json()["error_code"], untouched) == (403, VERWALTUNG_ADRESSE, True)
        assert journal_lines(caplog) == []

    def test_an_administrator_holding_no_owners_power_ends_another_administrators_sessions(self, mongo_replica_set_url: str):
        """The sign-out holds back an owner's address alone: signing in again repairs an ended session, as no erasure is."""

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await posted(mongo_replica_set_url, ABMELDUNG_PATH, ansicht_of(ANOTHER_ADMINISTRATOR))

            return response.status_code, len(await filed_by(database, ABMELDUNG_PATH))

        assert on_a_league(mongo_replica_set_url, run) == (200, 1)

    def test_an_owner_erases_another_owners_address(self, mongo_replica_set_url: str):
        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, OTHER_OWNER_OID, OTHER_OWNER, "owner")
            ansicht = await posted(mongo_replica_set_url, ANSICHT_PATH, ansicht_of(OTHER_OWNER), by=OWNER)
            erasure = await posted(mongo_replica_set_url, PATH, erasure_of(OTHER_OWNER), by=OWNER)

            return (
                ansicht.json()["verwaltung"],
                erasure.json(),
                await database[Collection.BERECHTIGUNGEN].count_documents({"adresse": OTHER_OWNER}),
            )

        verwaltung, erased, left = on_a_league(mongo_replica_set_url, run)

        assert (verwaltung, erased["berechtigungen"], left) == ("owner", 1, 0)

    def test_a_grant_landing_inside_the_erasure_is_refused_by_its_retry(self, mongo_replica_set_url: str):
        """The rival grants the address access after the first attempt's judgement and before its first write, the anchor both write.

        Judged once ahead of the transaction instead, the retry ends a grant this administrator could not revoke.
        """

        granted: list[int] = []
        racing: list[PupilsReadMeetingARival] = []

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            held = await where_held(database, *THEIR_VALUES)
            served = _app()
            async with app_client(mongo_replica_set_url, app=served, now=NOW) as http:

                async def grant() -> None:
                    answered = await http.post(
                        f"/api/v{API_VERSION}/berechtigungen", json={"email": IDENTIFIER}, headers=SignedActor(OWNER, ADMIN_KEY)
                    )
                    granted.append(answered.status_code)

                async def pupils() -> AsyncCollection:
                    # The app's own client: the request's session belongs to it.
                    racing.append(PupilsReadMeetingARival(served.state.db_client[DATABASE_NAME][Collection.SPIELER], grant))
                    return cast(AsyncCollection, racing[-1])

                served.dependency_overrides[get_spieler_collection] = pupils
                response = await http.post(PATH, json=erasure_of(), headers=SignedActor(OPERATOR, ADMIN_KEY))

            return (
                response,
                held,
                await where_held(database, *THEIR_VALUES),
                await database[Collection.BERECHTIGUNGEN].find_one({"adresse": IDENTIFIER}),
            )

        response, held, left, row = on_a_league(mongo_replica_set_url, body)

        assert (response.status_code, response.json().get("error_code"), granted) == (403, VERWALTUNG_ADRESSE, [201])
        assert row is not None and row["verwaltung"] == "administration"
        # The rows the grant wrote aside, every value stands where it stood.
        assert {value: [name for name in found if name not in THE_GRANTS_OWN_ROWS] for value, found in left.items()} == held
        # The premise last: the first attempt passed its judgement and read the pupils, which a grant landing first refuses.
        racing[0].assert_landed_inside(serially=0)


@pytest.mark.db
class TestTheReveal:
    """`docs/backend/spec.md :: I684`: every record of the person's the erasure removes or empties, by its own selections, stored nowhere."""

    def test_it_names_every_record_the_erasure_removes_by_the_ids_its_links_need_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
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

        A cancelled one is no booking `REQ-RETIRE-004` judges, and its season stays unnamed.
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

    def test_it_names_as_many_of_each_kind_as_the_erasure_then_removes(self, mongo_replica_set_url: str):
        """Read against the erasure's own answer rather than the seed, so a kind it names short is caught whatever the seed holds."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
            await a_grant(database, DEAD_GRANT_OID, TYPED, "administration")
            ansicht = (await posted(mongo_replica_set_url, ANSICHT_PATH, ansicht_of(), by=OWNER)).json()

            return ansicht, (await posted(mongo_replica_set_url, PATH, erasure_of(), by=OWNER)).json()

        ansicht, erased = on_a_league(mongo_replica_set_url, body)
        named = {
            "spieler": len(ansicht["spieler"]),
            "saison_spieler": sum(len(spieler["kader"]) for spieler in ansicht["spieler"]),
            "schiedsrichter": len(ansicht["schiedsrichter"]),
            "kontakt_sitze": len(ansicht["sitze"]) + len(ansicht["bewerbungen"]),
            "registrierungen": len(ansicht["registrierungen"]),
            "adresswechsel": len(ansicht["adresswechsel"]) + len(ansicht["spieler_adresswechsel"]),
        }

        assert named == {key: erased[key] for key in named}
        # The live grant is named by its tier, and a dead spelling beside it goes unnamed: two removed, one named.
        assert (ansicht["verwaltung"], erased["berechtigungen"]) == ("administration", 2)
        # Every count is compared above or one the reveal names nothing of: a count added to the answer fails here until placed.
        assert {*named, "berechtigungen", *COUNTED_AND_NOT_NAMED} == set(FLErasure.model_fields)
        # The premise: an address holding nothing would agree on zeros.
        assert all(erased[key] for key in FLErasure.model_fields)


@pytest.mark.db
class TestTheAnlass:
    """`docs/backend/spec.md :: I683`: on every log row the administrator's erasure files, and on no other."""

    def test_every_row_the_erasure_files_carries_it_stripped_and_no_other_row_does(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await posted(mongo_replica_set_url, PATH, erasure_of(anlass=f"  {ANLASS}  "))

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
            await erased_by_the_handler(database, client)
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

    def test_the_persons_own_erasure_files_none(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async with app_client(mongo_replica_set_url, app=_app(), now=NOW) as http:
                status = (await http.post(SELBST_PATH, headers=as_person(TYPED))).status_code

            return status, await filed_by(database, SELBST_PATH)

        status, filed = on_a_league(mongo_replica_set_url, body)

        assert status == 200
        assert filed, "the erasure filed no row, so the assertion below holds of nothing"
        assert {row["anlass"] for row in filed} == {None}


# A surname no record of the seed holds, given to one kind of the person's records at a time.
ANOTHER_SURNAME = "Sturmvogel"

# Where each kind of the person's records keeps a surname, as the seed stores it.
SURNAME_OF: Mapping[str, tuple[Collection, Mapping[str, Any], str]] = {
    "a pupil": (Collection.SPIELER, {"_id": PUPIL_OID}, "nachname"),
    "a referee": (Collection.SCHIEDSRICHTER, {"_id": REFEREE_OID}, "name"),
    "a team's seat": (Collection.SAISON_TEAMS, {"saison_id": SAISON_ID, "team_id": HOME_TEAM_OID}, "kontakte.ansprechperson.nachname"),
    "an application's seat": (Collection.BEWERBUNGEN, {"_id": BEWERBUNG_OID}, "kontakte.trainer.nachname"),
    "a registration": (Collection.REGISTRIERUNGEN, {"_id": PENDING_OID}, "nachname"),
}


@pytest.mark.db
class TestANameInTheAnlass:
    """`REQ-PURGE-006`, judged on the names the erasure's own subject read holds (`docs/backend/spec.md :: I721`)."""

    def test_it_is_refused_inside_the_write_which_writes_nothing_and_names_nobody(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await everything_in(database)
            response = await posted(mongo_replica_set_url, PATH, erasure_of(anlass=f"Mail {NACHNAME} vom 30.03.2026"))

            return response, before == await everything_in(database)

        with caplog.at_level(logging.INFO):
            response, untouched = on_a_league(mongo_replica_set_url, run)

        assert refused_at(response) == (422, NAME_IM_ANLASS, [["anlass"]])
        assert untouched
        assert journal_lines(caplog) == []
        # The premise of the line below: the refusal's own log line is among those read.
        assert [getattr(record, "error_code", None) for record in caplog.records].count(NAME_IM_ANLASS) == 1
        said = [response.text, *(record.getMessage() for record in caplog.records)]
        naming = [line for line in said if VORNAME.lower() in line.lower() or NACHNAME.lower() in line.lower()]
        assert naming == []

    @pytest.mark.parametrize("kind", SURNAME_OF)
    def test_every_kind_of_the_persons_records_lends_its_names(self, mongo_replica_set_url: str, kind: str):
        """The seed's other records keep the person's surname, so only the kind renamed holds the one the request names."""

        collection, row, field = SURNAME_OF[kind]

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            renamed = f"{VORNAME} {ANOTHER_SURNAME}" if field == "name" else ANOTHER_SURNAME
            assert (await database[collection].update_one(row, {"$set": {field: renamed}})).modified_count == 1

            return await posted(mongo_replica_set_url, PATH, erasure_of(anlass=f"Mail {ANOTHER_SURNAME} vom 30.03.2026"))

        assert refused_at(on_a_league(mongo_replica_set_url, run)) == (422, NAME_IM_ANLASS, [["anlass"]])

    def test_a_name_only_other_peoples_records_hold_is_erased_under(self, mongo_replica_set_url: str):
        """Each stands in a record the subject read reaches: a seat beside the person's, and a referee and a pupil moving to the address."""

        anlass = "Mail von Quillhilde, Kraus und Gwendolyn vom 30.03.2026"

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await posted(mongo_replica_set_url, PATH, erasure_of(anlass=anlass))

            return response.status_code, await filed_by(database, PATH)

        status, filed = on_a_league(mongo_replica_set_url, run)

        assert status == 200
        assert filed, "the erasure filed no row, so the assertion below holds of nothing"
        assert {row["anlass"] for row in filed} == {anlass}


class PupilsReadMeetingARival(InterleavedCollection):
    """The pupils the erasure's request check reads, a rival write committing first: inside the attempt, before its first write."""

    async def aggregate(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.aggregate(*args, **kwargs)


# Where a grant's creation names its address besides the grant: its announced row and its notice.
THE_GRANTS_OWN_ROWS = frozenset({Collection.BERECHTIGUNGEN_ANGEKUENDIGT, Collection.BERECHTIGUNGEN_POSTAUSGANG})


class PupilsMeetingARival(InterleavedCollection):
    """The pupils the erasure removes, a rival write committing first: inside the attempt, once per attempt."""

    async def delete_many(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.delete_many(*args, **kwargs)


class TheSignOutsRowMeetingARival(InterleavedCollection):
    """The sign-out's one log row, a rival write to the grants committing first: inside the attempt, once per attempt."""

    async def insert_one(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.insert_one(*args, **kwargs)


@pytest.mark.db
class TestAnAdministratorRevokedMidRequest:
    """`docs/backend/spec.md :: I575` on this route: the transaction's judge, never the check before the handler, meets the revoke."""

    @pytest.mark.parametrize("revoked", [True, False], ids=["revoked inside the erasure", "the control, revoked by nobody"])
    def test_the_erasure_erases_nobody_and_answers_that_they_administer_no_more(self, mongo_replica_set_url: str, revoked: bool):
        """Remove the anchor in `app/core/security.py :: admin_judge` and the erasure commits: the attempt's read never sees the revoke."""

        revokes: list[int] = []
        racing: list[PupilsMeetingARival] = []

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # The grant the person granted, which the erasure marks and every revoke anchors: without it the actor's
            # own anchor is the one write meeting the revoke.
            for granted in (Collection.BERECHTIGUNGEN, Collection.BERECHTIGUNGEN_ANGEKUENDIGT):
                await database[granted].delete_one({"_id": GRANTED_BY_THEM_OID})
            held = await where_held(database, *THEIR_VALUES)
            served = _app()
            async with app_client(mongo_replica_set_url, app=served, now=NOW) as http:

                async def revoke() -> None:
                    answered = await http.delete(
                        f"/api/v{API_VERSION}/berechtigungen/{GRANT_ID_OF[OPERATOR]}", headers=SignedActor(OWNER, ADMIN_KEY)
                    )
                    revokes.append(answered.status_code)

                async def nobody() -> None:
                    return None

                async def pupils() -> AsyncCollection:
                    # The app's own client: the request's session belongs to it.
                    racing.append(PupilsMeetingARival(served.state.db_client[DATABASE_NAME][Collection.SPIELER], revoke if revoked else nobody))
                    return cast(AsyncCollection, racing[-1])

                served.dependency_overrides[get_spieler_collection] = pupils
                response = await http.post(PATH, json=erasure_of(), headers=SignedActor(OPERATOR, ADMIN_KEY))

            return response, held, await where_held(database, *THEIR_VALUES)

        response, held, left = on_a_league(mongo_replica_set_url, body)

        if revoked:
            assert (response.status_code, response.json()["error_code"], revokes) == (403, ACTOR_NOT_ADMIN, [200])
            assert left == held
            assert sum(collection.passes for collection in racing) == 1, (
                "the retry reached the erasure again, so its judge admitted a revoked actor"
            )
        else:
            assert (response.status_code, revokes, left) == (200, [], dict.fromkeys(THEIR_VALUES, []))


@pytest.mark.db
class TestANameARivalWritesMidRequest:
    """`docs/backend/spec.md :: I721` on a retry: a rename committing inside the erasure meets its delete, and the retry reads it."""

    def test_the_retry_refuses_the_name_and_erases_nobody(self, mongo_replica_set_url: str):
        """Judged once outside the transaction instead, the first attempt's pass stands: the erasure commits and the log keeps the name."""

        racing: list[PupilsMeetingARival] = []
        # Every value but the surname the rival replaces on the pupil row, which the other records keep.
        kept = [value for value in THEIR_VALUES if value != NACHNAME]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            held = await where_held(database, *kept)
            served = _app()
            async with app_client(mongo_replica_set_url, app=served, now=NOW) as http:

                async def rename() -> None:
                    renamed = await database[Collection.SPIELER].update_one({"_id": PUPIL_OID}, {"$set": {"nachname": ANOTHER_SURNAME}})
                    assert renamed.modified_count == 1

                async def pupils() -> AsyncCollection:
                    # The app's own client: the request's session belongs to it.
                    racing.append(PupilsMeetingARival(served.state.db_client[DATABASE_NAME][Collection.SPIELER], rename))
                    return cast(AsyncCollection, racing[-1])

                served.dependency_overrides[get_spieler_collection] = pupils
                response = await http.post(
                    PATH, json=erasure_of(anlass=f"Mail {ANOTHER_SURNAME} vom 30.03.2026"), headers=SignedActor(OPERATOR, ADMIN_KEY)
                )

            return response, held, await where_held(database, *kept), await where_held(database, ANOTHER_SURNAME)

        response, held, left, renamed = on_a_league(mongo_replica_set_url, body)

        # The status first: an erasure that committed answers no code to compare.
        assert response.status_code == 422, response.json()
        assert refused_at(response) == (422, NAME_IM_ANLASS, [["anlass"]])
        assert left == held
        # The rename stands on the pupil row, and no log row took the request naming it.
        assert renamed == {ANOTHER_SURNAME: [str(Collection.SPIELER)]}
        # The premise last: the first attempt passed its judgement and reached the delete, and the retry was refused before it.
        assert sum(collection.passes for collection in racing) == 1


@pytest.mark.db
class TestAnotherAdministratorsAddress:
    def test_an_owner_ends_their_grant_and_the_list_left_is_named_once_it_commits(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """No route keeps the list sound against an erasure, so the boot's warning names what is left: here a row typed by hand.

        Only an owner presses here (`REQ-PURGE-005`), so the list this route leaves still holds one.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, HAND_TYPED_GRANT_OID, "Von.Hand@Example.com", "administration")
            response = await posted(mongo_replica_set_url, PATH, erasure_of(ANOTHER_ADMINISTRATOR), by=OWNER)
            notices = (
                await database[Collection.BERECHTIGUNGEN_POSTAUSGANG]
                .find({"berechtigung_id": GRANT_ID_OF[ANOTHER_ADMINISTRATOR]})
                .to_list(None)
            )

            return response, await database[Collection.BERECHTIGUNGEN].count_documents({"adresse": ANOTHER_ADMINISTRATOR}), notices

        with caplog.at_level(logging.WARNING):
            response, left, notices = on_a_league(mongo_replica_set_url, body)

        assert (response.status_code, response.json()["berechtigungen"], left) == (200, 1, 0)
        # The end's notice names who ended the grant: the pressing owner, on the person's request. A pasted grant nobody
        # announced is announced first, by the database.
        assert [(notice["art"], notice["geaendert_von"]) for notice in notices] == [("erteilt", None), ("entzogen", OWNER)]
        assert [getattr(record, "error_code", None) for record in caplog.records].count(DEAD_GRANT.error_code) == 1


@pytest.mark.db
class TestRowsNoMailboxNames:
    """What no request may reach through this route: the placeholder every address-less referee row shares, and the two sentinels."""

    def test_a_look_alike_of_the_placeholder_matches_none_of_the_rows_holding_it(self, mongo_replica_set_url: str):
        """A spelling the box admits, its stop full-width: the fold leaves a special-use domain unconverted, so it equals no stored address."""

        look_alike = PLACEHOLDER.replace(".invalid", f"{chr(0xFF0E)}invalid")

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SCHIEDSRICHTER].insert_many(
                [
                    schiedsrichter_document(referee_id, email=PLACEHOLDER, name=f"Ohne Adresse {index}", default_payment=20, einwilligung=None)
                    for index, referee_id in enumerate(PLACEHOLDER_REFEREE_OIDS)
                ]
            )
            ansicht = await posted(mongo_replica_set_url, ANSICHT_PATH, ansicht_of(look_alike))
            erasure = await posted(mongo_replica_set_url, PATH, erasure_of(look_alike))

            return ansicht.json(), erasure.json(), await database[Collection.SCHIEDSRICHTER].count_documents({"kontakt.email": PLACEHOLDER})

        ansicht, erased, left = on_a_league_of_its_own(mongo_replica_set_url, body)

        assert (ansicht["schiedsrichter"], erased["schiedsrichter"], left) == ([], 0, len(PLACEHOLDER_REFEREE_OIDS))

    def test_the_sentinels_given_an_address_by_hand_are_reached_by_neither_request(self, mongo_replica_set_url: str):
        """Each step selects by id past the sentinel, the address notwithstanding: the route inherits the registry's exclusion."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one({**build_ghost_spieler(), "email": SENTINEL_ADDRESS})
            ghost = build_ghost_schiedsrichter()
            await database[Collection.SCHIEDSRICHTER].insert_one({**ghost, "kontakt": {**ghost["kontakt"], "email": SENTINEL_ADDRESS}})
            ansicht = await posted(mongo_replica_set_url, ANSICHT_PATH, ansicht_of(SENTINEL_ADDRESS))
            erasure = await posted(mongo_replica_set_url, PATH, erasure_of(SENTINEL_ADDRESS))

            return (
                ansicht.json(),
                erasure.json(),
                await database[Collection.SPIELER].count_documents({"_id": GHOST_SPIELER_ID}),
                await database[Collection.SCHIEDSRICHTER].count_documents({"_id": GHOST_SCHIEDSRICHTER_ID}),
            )

        ansicht, erased, pupils, referees = on_a_league_of_its_own(mongo_replica_set_url, body)

        assert (ansicht["spieler"], ansicht["schiedsrichter"]) == ([], [])
        assert (erased["spieler"], erased["schiedsrichter"], pupils, referees) == (0, 0, 1, 1)


@pytest.mark.db
class TestTheSignOut:
    """`docs/backend/spec.md :: I689`: one row naming who ended an address's sessions and when, never the address."""

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

        assert (response.status_code, response.json()) == (200, {"acknowledged": 1})
        # The actor's grant takes its anchor's count, which any judged write adds and nobody reads.
        assert unanchored(after, besides=Collection.AKTIONEN) == unanchored(before, besides=Collection.AKTIONEN)
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

    def test_a_promotion_landing_inside_it_is_refused_by_its_retry(self, mongo_replica_set_url: str):
        """The promotion anchors every grant, the actor's among them, which the sign-out's judge anchors last: the retry judges again.

        Judged once ahead of the transaction instead, the row is filed and the caller ends an owner's sessions.
        """

        promotions: list[int] = []
        racing: list[TheSignOutsRowMeetingARival] = []

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
            served = _app()
            async with app_client(mongo_replica_set_url, app=served, now=NOW) as http:

                async def promote() -> None:
                    answered = await http.patch(
                        f"/api/v{API_VERSION}/berechtigungen/{THEIR_GRANT_OID}",
                        json={"verwaltung": "owner"},
                        headers=SignedActor(OWNER, ADMIN_KEY),
                    )
                    promotions.append(answered.status_code)

                async def log() -> AsyncCollection:
                    racing.append(TheSignOutsRowMeetingARival(served.state.db_client[DATABASE_NAME][Collection.AKTIONEN], promote))
                    return cast(AsyncCollection, racing[-1])

                served.dependency_overrides[get_aktionen_collection] = log
                response = await http.post(ABMELDUNG_PATH, json=ansicht_of(), headers=SignedActor(OPERATOR, ADMIN_KEY))

            return response, await filed_by(database, ABMELDUNG_PATH)

        response, filed = on_a_league(mongo_replica_set_url, body)

        assert (response.status_code, response.json().get("error_code"), promotions, filed) == (403, VERWALTUNG_ADRESSE, [200], [])
        # The premise last: the first attempt passed its judgement and reached the row, and the retry was refused before it.
        assert sum(collection.passes for collection in racing) == 1


def unanchored(collections: Mapping[str, list[Any]], *, besides: str) -> dict[str, list[Any]]:
    """Every collection but `besides`, each grant without its anchor's count."""

    return {
        name: [{key: value for key, value in row.items() if key != ANCHOR_FIELD} for row in rows]
        for name, rows in collections.items()
        if name != besides
    }


# What a sign-out's row holds besides its clock and trace.
ROW_KEYS = ("actor", "request", "collection", "operation", "document_id", "db_filter", "before", "modified_count", "redacted_at", "anlass")


# --- Refused at the box, before any read: the default tier's, the server answering nothing.

# The control's answer: a body past validation, whose first database call meets the unanswered server.
UNREACHED_DATABASE = {DATABASE_FAILED, UNKNOWN_OUTCOME}


def answered_unanswered(path: str, body: Mapping[str, Any]) -> Response:
    """The actor check answered from the suite's administrators, so a refused body touches no driver."""

    async def _answered() -> Response:
        async with app_client(UNANSWERED_URI, admitting=ADMINISTRATORS) as http:
            # Nested inside the app's own deadline, which it cannot extend, so each control is held to this one.
            with pymongo.timeout(UNANSWERED_DEADLINE_S):
                return await http.post(path, json=dict(body), headers=SignedActor(OPERATOR, ADMIN_KEY))

    return asyncio.run(_answered())


def refused_at(response: Response) -> tuple[int, str, list[list[Any]]]:
    answer = response.json()

    return response.status_code, answer["error_code"], [field["path"] for field in answer.get("fields", [])]


class TestTheAnlassIsRefusedAtTheBox:
    """A 422 alone tells nothing: one refused for another field answers it too, so the location is asserted."""

    @pytest.mark.parametrize(
        "body",
        [
            pytest.param({"email": TYPED}, id="none sent"),
            pytest.param(erasure_of(anlass="   "), id="spaces alone"),
            pytest.param(erasure_of(anlass="x" * (ERASURE_ANLASS_MAX_LENGTH + 1)), id="one past the bound"),
            pytest.param(erasure_of(anlass="Mail vom 30.03.\nBetreff: Löschung"), id="two lines"),
            pytest.param(erasure_of(anlass="Mail von anna.mueller@schule.de"), id="holding an address"),
        ],
    )
    def test_the_erasure_is_refused_naming_it(self, body: dict[str, str]):
        assert refused_at(answered_unanswered(PATH, body)) == (422, PAYLOAD_REFUSED, [["anlass"]])

    def test_the_bound_itself_reaches_the_database(self):
        """The control: a route refusing every body would pass the cases above."""

        response = answered_unanswered(PATH, erasure_of(anlass="x" * ERASURE_ANLASS_MAX_LENGTH))

        assert response.status_code == 500, response.json()
        assert response.json()["error_code"] in UNREACHED_DATABASE


class TestThePlaceholderIsRefusedAtTheBox:
    """Every referee row stored without an address shares one placeholder, so a lookup of it would reach them all at once."""

    @pytest.mark.parametrize("path", [ANSICHT_PATH, PATH, ABMELDUNG_PATH], ids=["the reveal", "the erasure", "the sign-out"])
    @pytest.mark.parametrize(
        "email",
        [PLACEHOLDER, f"  {PLACEHOLDER.upper()} ", "jemand@schule.INVALID", "jemand@invalid"],
        ids=["as stored", "folding to it", "any mailbox under it", "the reserved name itself"],
    )
    def test_it_is_refused_on_its_fold(self, path: str, email: str):
        assert refused_at(answered_unanswered(path, erasure_of(email) if path == PATH else ansicht_of(email))) == (
            422,
            PAYLOAD_REFUSED,
            [["email"]],
        )

    @pytest.mark.parametrize("path", [ANSICHT_PATH, PATH, ABMELDUNG_PATH], ids=["the reveal", "the erasure", "the sign-out"])
    def test_an_address_merely_naming_the_word_reaches_the_database(self, path: str):
        """The control, and the boundary: the domain is refused, never a mailbox spelling `invalid` elsewhere."""

        email = "invalid@invalid-schule.de"
        response = answered_unanswered(path, erasure_of(email) if path == PATH else ansicht_of(email))

        assert response.status_code == 500, response.json()
        assert response.json()["error_code"] in UNREACHED_DATABASE


# --- The names `REQ-PURGE-006` and `REQ-SPERRLISTE-004` refuse, judged from the subject's rows alone: the default tier's.


def a_seat(email: str, vorname: str, nachname: str) -> dict[str, str]:
    return {"email": email, "vorname": vorname, "nachname": nachname}


# One record of each shape a name is stored in, and a seat beside the person's that another person holds.
NAMES = eigene_namen(
    IDENTIFIER,
    saison_team_rows=[
        {
            "kontakte": {
                "trainer": a_seat(TYPED, "Quirin", "Müller-Lüdenscheidt"),
                "ansprechperson": a_seat("quillhilde@example.com", "Quillhilde", "Quillhilde-Mustermann"),
            }
        }
    ],
    bewerbung_rows=[],
    referee_rows=[{"name": "Anna von der Heide"}, {"name": "Thi Mai Le"}, {"name": "Seán O'Brien"}],
    pupil_rows=[{"vorname": "Max", "nachname": "Müller"}],
    registrierung_rows=[{"vorname": "Anna Lena", "nachname": "Schmidt"}],
)

# Each refusal the one matcher answers, with the box it names.
REFUSALS = {
    "the erasure's request": (lambda text: find_name_im_anlass_refusal(anlass=text, names=NAMES), NAME_IM_ANLASS, "anlass"),
    "the ban's reason": (lambda text: find_name_im_grund_refusal(grund=text, names=NAMES), NAME_IM_GRUND, "grund"),
}


class TestWhichWordsAFreeTextMayNotHold:
    def test_each_name_stands_whole_and_each_of_its_words_but_a_particle_before_a_name_and_a_single_letter(self):
        assert NAMES == {
            *("max", "müller"),
            *("anna von der heide", "anna", "heide"),
            *("thi mai le", "thi", "mai", "le"),
            *("seán o'brien", "seán", "brien"),
            *("anna lena", "lena", "schmidt"),
            *("quirin", "müller-lüdenscheidt", "lüdenscheidt"),
        }

    @pytest.mark.parametrize("refusal", REFUSALS)
    @pytest.mark.parametrize(
        "text",
        [
            "Anfrage von max  MÜLLER per Mail vom 3.10.",
            "Mail Müller 3.10.",
            "Max hat am 3.10. gefragt",
            "Mail Heide 3.10.",
            "Lena hat am 3.10. gefragt",
            "Betreff Löschung_Müller",
            "Annas Mail vom 3.10.",
            "Löschwunsch der Müllers",
            "Mail von Frau Le",
            "Löschung Müller03.10.",
            "Mül\u00adler hat am 3.10. gefragt",
            "Mail Mül\u200bler 3.10.",
            # A common word equal to a name, „Thi Mai Le“'s „Mai“, refused with it.
            "Anfrage vom 3. Mai",
        ],
    )
    def test_a_name_standing_as_a_whole_word_or_before_a_genitive_s_is_refused_on_the_box(self, refusal: str, text: str):
        find, code, box = REFUSALS[refusal]
        refused = find(text)

        assert refused is not None
        assert (refused.error_code, refused.status, refused.fields) == (code, 422, ((box,),))

    @pytest.mark.parametrize("refusal", REFUSALS)
    @pytest.mark.parametrize(
        "text",
        [
            "Anfrage per Mail vom 3.10.",
            "Brief aus der Müllerstraße",
            "Bitte um Löschung der Daten von heute",
            "o. g. Anfrage vom 3.5. i. A. weitergeleitet",
        ],
        ids=["no name", "a name inside a longer word", "a particle alone", "a single letter"],
    )
    def test_no_name_standing_as_a_whole_word_passes(self, refusal: str, text: str):
        find, _, _ = REFUSALS[refusal]

        assert find(text) is None
