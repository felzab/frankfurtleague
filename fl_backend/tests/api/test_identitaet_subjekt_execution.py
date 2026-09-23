import asyncio
from collections.abc import Awaitable, Callable
from typing import Any, get_args

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient
from httpx2 import ASGITransport, AsyncClient, Response
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.schemas import FLKontaktRolle
from app.api.identitaet.router import get_subjekt
from app.api.identitaet.schemas import FLSubjektPayload, FLSubjektResponse
from app.api.kontakte.services import KONTAKT_SLOTS
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.main import create_app
from tests.config import BASE_AUTH, SYSTEM_AUTH, TEST_BASE_URL, build_test_config
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

from .conftest import config_for

DATABASE_NAME = worker_database("fl_identitaet_subjekt_test")

PATH = f"/api/v{API_VERSION}/identitaet/subjekt"

# The container is started for this tier and a laptop's own `mongod` is not what answers here, so the
# driver's default would give up before the first handshake on a cold start.
CONTAINER_SELECTION_MS = 30_000

APP = create_app(build_test_config())

# The code a request carrying no bearer draws, and the one `verify_access_system` itself raises: each
# guard is built with its OWN (`app/core/security.py :: verify_api_key`), so the base key answers the
# system guard's code rather than `verify_access_base`'s.
MISSING_BEARER_TOKEN = "REQ-AUTH-001"
WRONG_KEY_FOR_THIS_GUARD = "REQ-AUTH-003"

# The folded form a caller sends, and the spellings the league stores it under. Deliberately
# unusual, so a hit in a seeded corpus cannot be a coincidence.
IDENTIFIER = "anna.müller@schule.de"
SEAT_STORED = "Anna.Müller@Schule.de"
SEAT_STORED_UPPER = "ANNA.MÜLLER@schule.de"
SEAT_STORED_DOMAIN = "anna.müller@SCHULE.de"
PUPIL_STORED = "anna.müller@schule.de"
REFEREE_STORED = "ANNA.MÜLLER@schule.de"
REFEREE_STORED_MIXED = "Anna.Müller@schule.de"

# The one stored spelling MongoDB's `i` accepts and the fold refuses: caseless matching holds U+0345
# equal to an iota, and NFKC leaves them apart. It is what makes the post-read fold a judgement.
IOTA_ASKED = "aι.muller@schule.de"
YPOGEGRAMMENI_STORED = "aͅ.muller@schule.de"

# The „ß“ decision, pinned rather than left to whichever folding a later reader reaches for: the
# address is `lower`-ed and never `casefold`-ed, so these are two mailboxes and each holds a seat.
SHARP_S_ASKED = "Poststraße@schule.de"
SHARP_S_STORED = "Poststraße@schule.de"
DOUBLE_S_ASKED = "poststrasse@schule.de"
DOUBLE_S_STORED = "Poststrasse@schule.de"

# Nobody this identifier may reach, in each of the three collections.
BYSTANDER = "baldur.krautzberger@example.com"

PAST_SAISON = "2425"
ACTIVE_SAISON = "2526"
FUTURE_SAISON = "2627"

# Fixed rather than generated, so a failure names the same row every run. Ordered so the answer's
# own sort is asserted rather than reproduced: A before B before C.
TEAM_A_OID = ObjectId("6890a1b2c3d4e5f607820001")
TEAM_B_OID = ObjectId("6890a1b2c3d4e5f607820002")
TEAM_C_OID = ObjectId("6890a1b2c3d4e5f607820003")
SEAT_ROW_A_OID = ObjectId("6890a1b2c3d4e5f607820011")
SEAT_ROW_B_OID = ObjectId("6890a1b2c3d4e5f607820012")
BYSTANDER_ROW_OID = ObjectId("6890a1b2c3d4e5f607820013")
SHARP_S_ROW_OID = ObjectId("6890a1b2c3d4e5f607820014")
DOUBLE_S_ROW_OID = ObjectId("6890a1b2c3d4e5f607820015")
YPOGEGRAMMENI_ROW_OID = ObjectId("6890a1b2c3d4e5f607820016")
PUPIL_ONE_OID = ObjectId("6890a1b2c3d4e5f607820021")
PUPIL_TWO_OID = ObjectId("6890a1b2c3d4e5f607820022")
BYSTANDER_PUPIL_OID = ObjectId("6890a1b2c3d4e5f607820029")
REFEREE_ONE_OID = ObjectId("6890a1b2c3d4e5f607820031")
REFEREE_TWO_OID = ObjectId("6890a1b2c3d4e5f607820032")
YPOGEGRAMMENI_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607820033")
BYSTANDER_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607820039")

# The name the junction row was entered under, and the one the club has taken since. They differ so
# that serving the club's own would be observable (`docs/backend/spec.md :: I13`).
ROW_NAME_A = "Helmholtz"
CLUB_NAME_A_NOW = "Helmholtz-Gymnasium"
ROW_NAME_B = "Lessing"

ADDRESS: dict[str, Any] = {
    "strasse": "Hanauer Landstraße",
    "hausnummer": "12a",
    "plz": "60314",
    "stadtteil": "Ostend",
    "stadt": "Frankfurt am Main",
}

KENNTNISNAHME: dict[str, Any] = {"umfang": "kontaktdaten", "erfasst_von": "administrativ", "text_version": "v1", "datum": "2026-01-05"}

EINWILLIGUNG: dict[str, Any] = {
    "umfang": "kader_oeffentlich",
    "erteilt_von": "erziehungsberechtigt",
    "datum": "2026-01-15",
    "bestaetigt_am": "2026-01-20",
}


def _person(email: str) -> dict[str, Any]:
    """Every field `app/core/constraints.py :: _KONTAKTPERSON` requires, the address the only one a case reads."""

    return {"vorname": "Anna", "nachname": "Müller", "email": email, "telefon": "+49 69 5550101", "einwilligung": dict(KENNTNISNAHME)}


def _junction(row_id: ObjectId, saison_id: str, team_id: ObjectId, *, name: str, **slots: str) -> dict[str, Any]:
    """A `saison_teams` row seating whoever the caller names, the slots it does not name left empty."""

    return {
        "_id": row_id,
        "saison_id": saison_id,
        "team_id": team_id,
        "gruppe": "A",
        "austritt": None,
        "kontakte": {
            **{slot: None for slot in KONTAKT_SLOTS},
            **{slot: _person(email) for slot, email in slots.items()},
            # A declaration about two slots rather than a slot of its own, so it names nobody and
            # no case here turns on it (`app/api/kontakte/services.py :: KONTAKT_SLOTS`).
            "trainer_ist_zugleich": None,
        },
        "name": name,
        "shorthand": name[:2].upper(),
    }


def _saison(saison_id: str, status: str) -> dict[str, Any]:
    return {
        "_id": saison_id,
        "start_date": f"20{saison_id[:2]}-08-01",
        "end_date": f"20{saison_id[2:]}-06-30",
        "status": status,
        "rules": {
            "win_points": 3,
            "draw_points": 1,
            "qualifiers_per_group": 2,
            "number_of_groups": 4,
            "teams_per_group": 4,
            "tiebreak_order": "tordifferenz",
            "max_kadergroesse": 18,
            "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
            "erlaubte_stufen": ["Q1", "Q2"],
        },
    }


def _club(team_id: ObjectId, name: str, shorthand: str) -> dict[str, Any]:
    # `shorthand` per club rather than one for all: `app/core/constraints.py :: uniq_shorthand`
    # indexes it, so a seed sharing one refuses its second club and fails every case here.
    return {
        "_id": team_id,
        "name": name,
        "shorthand": shorthand,
        "description": "",
        "full_name": f"{name}-Schule",
        "website_url": None,
        "address": dict(ADDRESS),
        "inactive_since": None,
    }


def _pupil(pupil_id: ObjectId, email: str) -> dict[str, Any]:
    """`email` stored in the folded form, which is what S6's admission writes and what the join compares."""

    return {
        "_id": pupil_id,
        "vorname": "Anna",
        "nachname": "Müller",
        "einwilligung": dict(EINWILLIGUNG),
        "inactive_since": None,
        "email": email,
    }


def _referee(referee_id: ObjectId, email: str, name: str) -> dict[str, Any]:
    # A name per referee for `_club`'s reason: `app/core/constraints.py :: uniq_schiedsrichter_name`
    # indexes it.
    return {
        "_id": referee_id,
        "name": name,
        "schule": None,
        "default_payment": 20,
        "kontakt": {"telefon": "+49 69 5550202", "email": email},
        "inactive_since": None,
    }


Body = Callable[[AsyncDatabase], Awaitable[Any]]


async def _seed(database: AsyncDatabase) -> None:
    """One corpus for every case: the mailbox in all three collections twice over, a bystander beside each, and the refused spellings."""

    await database[Collection.SAISONS].insert_many(
        [_saison(PAST_SAISON, "past"), _saison(ACTIVE_SAISON, "active"), _saison(FUTURE_SAISON, "future")]
    )
    await database[Collection.TEAMS].insert_many(
        [_club(TEAM_A_OID, CLUB_NAME_A_NOW, "HE"), _club(TEAM_B_OID, ROW_NAME_B, "LE"), _club(TEAM_C_OID, "Krautzberg", "KR")]
    )
    await database[Collection.SAISON_TEAMS].insert_many(
        [
            _junction(SEAT_ROW_A_OID, PAST_SAISON, TEAM_A_OID, name=ROW_NAME_A, trainer=SEAT_STORED),
            # One address in TWO person slots of one row, which is what a person entered twice is.
            _junction(
                SEAT_ROW_B_OID,
                ACTIVE_SAISON,
                TEAM_B_OID,
                name=ROW_NAME_B,
                trainer=SEAT_STORED_UPPER,
                ansprechperson=SEAT_STORED_DOMAIN,
            ),
            _junction(BYSTANDER_ROW_OID, ACTIVE_SAISON, TEAM_C_OID, name="Krautzberg", trainer=BYSTANDER),
            _junction(SHARP_S_ROW_OID, FUTURE_SAISON, TEAM_A_OID, name=ROW_NAME_A, trainer=SHARP_S_STORED),
            _junction(DOUBLE_S_ROW_OID, FUTURE_SAISON, TEAM_B_OID, name=ROW_NAME_B, trainer=DOUBLE_S_STORED),
            _junction(YPOGEGRAMMENI_ROW_OID, FUTURE_SAISON, TEAM_C_OID, name="Krautzberg", trainer=YPOGEGRAMMENI_STORED),
        ]
    )
    await database[Collection.SPIELER].insert_many(
        [
            _pupil(PUPIL_ONE_OID, PUPIL_STORED),
            _pupil(PUPIL_TWO_OID, PUPIL_STORED),
            _pupil(BYSTANDER_PUPIL_OID, BYSTANDER),
        ]
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            _referee(REFEREE_ONE_OID, REFEREE_STORED, "A. Referee"),
            _referee(REFEREE_TWO_OID, REFEREE_STORED_MIXED, "C. Zweitpfeife"),
            _referee(YPOGEGRAMMENI_REFEREE_OID, YPOGEGRAMMENI_STORED, "D. Ypsilon"),
            _referee(BYSTANDER_REFEREE_OID, BYSTANDER, "B. Krautzberger"),
        ]
    )


def on_a_league(url: str, body: Body) -> Any:
    """The REAL validators, so a seeded row this read has to answer is one the shipped schema admits."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await _seed(database)

            return await body(database)

    return on_the_seed_loop(_run())


async def _no_body(_: AsyncDatabase) -> None:
    """For a caller that wants the corpus and nothing else: the request below runs on a loop of its own."""

    return None


async def call_subjekt(database: AsyncDatabase, email: str) -> FLSubjektResponse:
    return await get_subjekt(
        subjekt_data=FLSubjektPayload(email=email),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spieler_collection=database[Collection.SPIELER],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
    )


def answered(url: str, email: str = IDENTIFIER) -> FLSubjektResponse:
    return on_a_league(url, lambda database: call_subjekt(database, email))


@pytest.mark.db
def test_one_mailbox_answers_all_three_kinds_at_once(mongo_url: str):
    """The three-kind join in one case: each stored in a different spelling, none of them the identifier's own.

    Split in three, a lookup answering only the collection a case names would pass all three.
    """

    answer = answered(mongo_url)

    assert (bool(answer.sitze), bool(answer.spieler), bool(answer.schiedsrichter)) == (True, True, True)


@pytest.mark.db
def test_every_seat_the_mailbox_holds_is_answered_once_each(mongo_url: str):
    """Two clubs and two slots of one row, in the read's own order.

    Kills a first-match lookup, a de-duplication that folds one person's two seats into one, and a
    slot loop that stops at the Trainer.
    """

    seats = [(seat.saison_id, seat.team_id, seat.rolle) for seat in answered(mongo_url).sitze]

    assert seats == [
        (PAST_SAISON, TEAM_A_OID, "trainer"),
        (ACTIVE_SAISON, TEAM_B_OID, "trainer"),
        (ACTIVE_SAISON, TEAM_B_OID, "ansprechperson"),
    ]


@pytest.mark.db
def test_two_pupils_sharing_an_address_are_both_answered(mongo_url: str):
    """Siblings on one inbox. Kills a lookup that answers the first `spieler` row and stops."""

    assert [row.spieler_id for row in answered(mongo_url).spieler] == [PUPIL_ONE_OID, PUPIL_TWO_OID]


@pytest.mark.db
def test_two_referees_sharing_an_address_are_both_answered(mongo_url: str):
    """The same for referees, whose two rows are stored in two spellings so neither is reached by equality."""

    assert [row.schiedsrichter_id for row in answered(mongo_url).schiedsrichter] == [REFEREE_ONE_OID, REFEREE_TWO_OID]


@pytest.mark.db
def test_a_spelling_the_database_match_accepts_and_the_fold_refuses_is_no_seat(mongo_url: str):
    """The case that makes the post-read fold a judgement: `i` holds U+0345 equal to an iota and the fold does not.

    Kills a presence test in its place, which the rest of this corpus would let through.
    """

    assert answered(mongo_url, IOTA_ASKED).sitze == []


@pytest.mark.db
def test_a_spelling_the_database_match_accepts_and_the_fold_refuses_is_no_referee(mongo_url: str):
    """The referee half of the same judgement, whose comprehension carries its own fold clause."""

    assert answered(mongo_url, IOTA_ASKED).schiedsrichter == []


@pytest.mark.db
def test_the_refused_spelling_is_reachable_when_it_is_the_one_asked_for(mongo_url: str):
    """The control under the two cases above: without it both would pass on a lookup that reaches those rows never."""

    answer = answered(mongo_url, YPOGEGRAMMENI_STORED)

    assert [seat.team_id for seat in answer.sitze] == [TEAM_C_OID]
    assert [row.schiedsrichter_id for row in answer.schiedsrichter] == [YPOGEGRAMMENI_REFEREE_OID]


@pytest.mark.db
def test_the_sharp_s_address_and_the_double_s_one_are_two_mailboxes(mongo_url: str):
    """Kills `casefold` in the fold, which maps „ß“ to „ss“ and would hand one person the other's seat.

    Each address holds a seat at a club of its own, so collapsing the two answers the wrong club
    rather than nothing.
    """

    assert [seat.team_id for seat in answered(mongo_url, SHARP_S_ASKED).sitze] == [TEAM_A_OID]
    assert [seat.team_id for seat in answered(mongo_url, DOUBLE_S_ASKED).sitze] == [TEAM_B_OID]


@pytest.mark.db
def test_an_address_arriving_unfolded_answers_the_same_seats(mongo_url: str):
    """Kills trusting the caller to have folded: `EmailStr` lower-cases the domain alone, so a half-folded value would miss every seat."""

    assert [seat.team_id for seat in answered(mongo_url, SEAT_STORED).sitze] == [TEAM_A_OID, TEAM_B_OID, TEAM_B_OID]


@pytest.mark.db
def test_an_address_the_league_holds_nothing_for_answers_three_empty_lists(mongo_url: str):
    """The control: without it every case above would pass on a lookup that answers everything it is asked."""

    answer = answered(mongo_url, "niemand.hierverzeichnet@example.com")

    assert (answer.sitze, answer.spieler, answer.schiedsrichter) == ([], [], [])


@pytest.mark.db
def test_a_seat_carries_the_name_the_club_was_played_under(mongo_url: str):
    """Kills a join onto `teams`: the first club has been renamed since, so its own document holds the other name."""

    assert [seat.team_name for seat in answered(mongo_url).sitze] == [ROW_NAME_A, ROW_NAME_B, ROW_NAME_B]


@pytest.mark.db
def test_a_seat_carries_its_own_season_s_status(mongo_url: str):
    """The one read of `saisons` a seat costs. Two seasons of differing status, so a status taken from whichever sorted first is wrong here."""

    assert [seat.saison_status for seat in answered(mongo_url).sitze] == ["past", "active", "active"]


def test_every_person_slot_the_block_declares_is_a_published_role():
    """Kills a fourth person slot reaching this answer: `FLSubjektSitz.rolle` would refuse it at run time, as a 500 in a person's own lane."""

    assert set(KONTAKT_SLOTS) == set(get_args(FLKontaktRolle))


def test_the_operation_is_unreachable_without_a_bearer_token():
    """The guard runs ahead of the payload's own validation, so a malformed body still answers the guard's code rather than a 422."""

    response = TestClient(APP, raise_server_exceptions=False).post(PATH, json={"erfundenes_feld": 1})

    assert response.status_code == 401
    assert response.json()["error_code"] == MISSING_BEARER_TOKEN


def test_the_base_key_draws_the_system_guard_s_own_code():
    """`REQ-AUTH-002` here would mean `verify_access_base` is on this route; the code names the guard, never the key presented."""

    response = TestClient(APP, raise_server_exceptions=False).post(PATH, headers=BASE_AUTH, json={"email": IDENTIFIER})

    assert response.status_code == 401
    assert response.json()["error_code"] == WRONG_KEY_FOR_THIS_GUARD


def served_over_http(url: str, email: str = IDENTIFIER) -> Response:
    """The corpus seeded, then one request through the MOUNTED route.

    No lifespan: it would open its own client at the settings' URI and apply the constraints there
    (`fl_backend/tests/api/test_malformed_ids.py :: answered`).
    """

    on_a_league(url, _no_body)

    async def _answered() -> Response:
        app = create_app(config_for(DATABASE_NAME))
        app.state.db_client = AsyncMongoClient(host=url, serverSelectionTimeoutMS=CONTAINER_SELECTION_MS)

        try:
            transport = ASGITransport(app=app, raise_app_exceptions=False)
            async with AsyncClient(transport=transport, base_url=TEST_BASE_URL) as http:
                return await http.post(PATH, headers=SYSTEM_AUTH, json={"email": email})
        finally:
            await app.state.db_client.close()

    return asyncio.run(_answered())


@pytest.mark.db
def test_the_mounted_route_serves_the_three_kinds_the_corpus_holds(mongo_url: str):
    """The whole body, so `response_model`'s own serialisation is compared rather than the objects behind it.

    A collection bound to the wrong parameter answers an empty list, and no case calling the
    function by keyword can tell.
    """

    response = served_over_http(mongo_url)

    assert response.status_code == 200
    assert response.json() == {
        "acknowledged": 1,
        "sitze": [
            {
                "saison_id": PAST_SAISON,
                "team_id": str(TEAM_A_OID),
                "rolle": "trainer",
                "team_name": ROW_NAME_A,
                "saison_status": "past",
            },
            {
                "saison_id": ACTIVE_SAISON,
                "team_id": str(TEAM_B_OID),
                "rolle": "trainer",
                "team_name": ROW_NAME_B,
                "saison_status": "active",
            },
            {
                "saison_id": ACTIVE_SAISON,
                "team_id": str(TEAM_B_OID),
                "rolle": "ansprechperson",
                "team_name": ROW_NAME_B,
                "saison_status": "active",
            },
        ],
        "spieler": [{"spieler_id": str(PUPIL_ONE_OID)}, {"spieler_id": str(PUPIL_TWO_OID)}],
        "schiedsrichter": [{"schiedsrichter_id": str(REFEREE_ONE_OID)}, {"schiedsrichter_id": str(REFEREE_TWO_OID)}],
    }
