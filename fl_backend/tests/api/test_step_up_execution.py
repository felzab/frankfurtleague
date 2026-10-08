"""
API · a write stepped up on some calls alone asks the step-up window on exactly those calls

Each of these handlers decides whether this call destroys what nothing restores, or mints or voids a
link to an address, and refuses `REQ-AUTH-009` there from a sign-in older than the step-up window
(`docs/backend/spec.md :: I524`). Served over HTTP against the shipped validators, so each refusal is
shown to leave the stored state as it was, and each call of the other kind to pass the same sign-in.
"""

import functools
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import AsyncClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.schiedsrichter.services import compose_bestaetigung, compose_einwilligung
from app.api.teams.schemas import kontakte_stand_of
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.security import CONFIRMATION_REQUIRED, STEP_UP_WINDOW_S
from app.main import create_app
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from tests.actor_tokens import SignedActor
from tests.app_client import app_client
from tests.config import ADMIN_KEY, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import rules_document, saison_document, saison_team_document
from tests.worker import worker_database

from .conftest import config_for

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_step_up_test")
CONFIG = config_for(DATABASE_NAME)

ADMIN = "admin@example.com"
# Past the step-up window by a minute, and inside the administrator's own.
OLDER = SignedActor(ADMIN, ADMIN_KEY, signed_in_before_s=STEP_UP_WINDOW_S + 60)
FRESH = SignedActor(ADMIN, ADMIN_KEY)

SAISON_ID = "2026"
TODAY = "2026-04-01"
TEAM_ID = ObjectId("6890a1b2c3d4e5f607950001")
SCHIEDSRICHTER_ID = ObjectId("6890a1b2c3d4e5f607950011")
REFEREE_EMAIL = "collina@example.com"
MOVED_EMAIL = "collina.pierluigi@example.com"

REGISTRIERUNG: dict[str, Any] = {"offen": True, "von": "2026-03-01", "bis": "2026-04-30"}

Body = Callable[[AsyncDatabase, AsyncClient], Awaitable[Any]]


@functools.cache
def _served() -> FastAPI:
    """One app for every case serving through it: building one costs more than the request a case sends through it.

    Built on first use rather than at import, which every xdist worker pays at collection.
    """

    return create_app(CONFIG)


def on_a_season(url: str, body: Body, *, seed: Callable[[AsyncDatabase], Awaitable[None]] | None = None) -> Any:
    """The shipped validators and indexes, a running season holding one club, and `seed`'s rows beside them."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await database[Collection.SAISONS].insert_one(
                saison_document(SAISON_ID, "active", rules=rules_document(number_of_groups=2), registrierung=dict(REGISTRIERUNG))
            )
            await database[Collection.SAISON_TEAMS].insert_one(saison_team_document(SAISON_ID, TEAM_ID, "Adler", "AD", kontakte=None))
            await database[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())
            if seed is not None:
                await seed(database)
            async with app_client(url, app=_served()) as http:
                return await body(database, http)

    return on_the_seed_loop(_run())


def refused(response: Any) -> bool:
    return (response.status_code, response.json().get("error_code")) == (401, CONFIRMATION_REQUIRED)


async def a_live_link(database: AsyncDatabase) -> None:
    await database[Collection.EINLADUNGEN].insert_one(
        {
            "saison_id": SAISON_ID,
            "team_id": TEAM_ID,
            "token_hash": hash_token("seeded"),
            "erstellt_am": "2026-03-15",
            "erstellt_von": ADMIN,
            "widerrufen_am": None,
            "versand": None,
        }
    )


class TestTheClubsLink:
    URL = f"/api/v{API_VERSION}/teams/{TEAM_ID}/saisons/{SAISON_ID}/einladung"

    def test_a_mint_voiding_a_live_link_from_an_older_sign_in_is_refused_and_voids_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, http: AsyncClient) -> tuple[bool, list[Any]]:
            response = await http.post(self.URL, headers=OLDER)
            live = await database[Collection.EINLADUNGEN].find({"widerrufen_am": None}, {"token_hash": 1, "_id": 0}).to_list()
            return refused(response), live

        assert on_a_season(mongo_replica_set_url, body, seed=a_live_link) == (True, [{"token_hash": hash_token("seeded")}])

    def test_a_club_s_first_link_takes_the_older_sign_in(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, http: AsyncClient) -> int:
            return (await http.post(self.URL, headers=OLDER)).status_code

        assert on_a_season(mongo_replica_set_url, body) == 201

    def test_a_mint_voiding_a_live_link_from_a_fresh_sign_in_is_made(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, http: AsyncClient) -> int:
            return (await http.post(self.URL, headers=FRESH)).status_code

        assert on_a_season(mongo_replica_set_url, body, seed=a_live_link) == 201


class TestTheClubsContacts:
    URL = f"/api/v{API_VERSION}/teams/{TEAM_ID}/saisons/{SAISON_ID}/kontakte"
    NOBODY: dict[str, Any] = {"trainer": None, "ansprechperson": None, "stellvertretung": None, "trainer_ist_zugleich": None}

    async def seed_the_block(self, database: AsyncDatabase) -> None:
        await database[Collection.SAISON_TEAMS].update_one({"team_id": TEAM_ID}, {"$set": {"kontakte": dict(self.NOBODY)}})

    def test_a_clearing_from_an_older_sign_in_is_refused_and_clears_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, http: AsyncClient) -> tuple[bool, Any]:
            payload = {"kontakte": None, "kontakte_stand": kontakte_stand_of(self.NOBODY)}
            response = await http.patch(self.URL, headers=OLDER, json=payload)
            stored = await database[Collection.SAISON_TEAMS].find_one({"team_id": TEAM_ID})
            return refused(response), stored and stored["kontakte"]

        assert on_a_season(mongo_replica_set_url, body, seed=self.seed_the_block) == (True, self.NOBODY)

    def test_a_rewrite_takes_the_older_sign_in(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, http: AsyncClient) -> int:
            payload = {"kontakte": dict(self.NOBODY), "kontakte_stand": kontakte_stand_of(self.NOBODY)}
            return (await http.patch(self.URL, headers=OLDER, json=payload)).status_code

        assert on_a_season(mongo_replica_set_url, body, seed=self.seed_the_block) == 200

    def test_a_rewrite_seating_a_new_person_from_an_older_sign_in_is_refused_and_seats_nobody(self, mongo_replica_set_url: str):
        """Seating somebody new mints them a link, which is a step-up write whatever else the save does."""

        newcomer = {
            "vorname": "Ida",
            "nachname": "Musterfrau",
            "email": "ida@example.com",
            "telefon": "+4917010000001",
            # The running label, so the label judgement admits the newcomer and the step-up alone refuses.
            "einwilligung": {"umfang": "kontaktdaten", "text_version": LAUFENDE_FASSUNGEN["bewerbung"], "datum": "2026-03-01"},
        }

        async def body(database: AsyncDatabase, http: AsyncClient) -> tuple[bool, Any]:
            payload = {"kontakte": {**self.NOBODY, "trainer": newcomer}, "kontakte_stand": kontakte_stand_of(self.NOBODY)}
            response = await http.patch(self.URL, headers=OLDER, json=payload)
            stored = await database[Collection.SAISON_TEAMS].find_one({"team_id": TEAM_ID})
            return refused(response), stored and (stored["kontakte"], stored.get("bestaetigungen"))

        assert on_a_season(mongo_replica_set_url, body, seed=self.seed_the_block) == (True, (self.NOBODY, None))


class TestTheDraw:
    URL = f"/api/v{API_VERSION}/saisons/{SAISON_ID}/spielplan"

    def test_a_replacing_draw_from_an_older_sign_in_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, http: AsyncClient) -> bool:
            return refused(await http.post(self.URL, headers=OLDER, json={"replace": True}))

        assert on_a_season(mongo_replica_set_url, body) is True

    def test_a_first_draw_takes_the_older_sign_in_to_the_draw_s_own_judgement(self, mongo_replica_set_url: str):
        """One club cannot fill two groups, so the draw's own rule answers, which only a request past the window reaches."""

        async def body(database: AsyncDatabase, http: AsyncClient) -> tuple[int, str]:
            response = await http.post(self.URL, headers=OLDER, json={})
            return response.status_code, str(response.json().get("error_code"))

        status, code = on_a_season(mongo_replica_set_url, body)

        assert (status, code.startswith("REQ-SPIELPLAN-")) == (409, True)


def a_referee(*, confirmed: bool = False, retired: bool = False) -> dict[str, Any]:
    return {
        "_id": SCHIEDSRICHTER_ID,
        "name": "Pierluigi Collina",
        "schule": "Carl-Schurz-Schule",
        "default_payment": 20,
        "kontakt": {"telefon": "+49 69 1234567", "email": REFEREE_EMAIL},
        "inactive_since": "2026-01-01" if retired else None,
        "bestaetigung": compose_bestaetigung(token_hash=hash_token("seeded-referee"), today="2026-03-20"),
        **(
            {
                "einwilligung": compose_einwilligung(umfang="intern", medien=False, text_version="v1", today="2026-03-21"),
                "geburtsdatum": "1984-05-09",
            }
            if confirmed
            else {}
        ),
    }


def seeding(referee: dict[str, Any]) -> Callable[[AsyncDatabase], Awaitable[None]]:
    async def seed(database: AsyncDatabase) -> None:
        await database[Collection.SCHIEDSRICHTER].insert_one(referee)

    return seed


def a_save(email: str) -> dict[str, Any]:
    return {
        "name": "Pierluigi Collina",
        "schule": "Carl-Schurz-Schule",
        "default_payment": 20,
        "kontakt": {"telefon": "+49 69 1234567", "email": email},
    }


class TestTheRefereesSave:
    URL = f"/api/v{API_VERSION}/schiedsrichter/{SCHIEDSRICHTER_ID}"

    @pytest.mark.parametrize("retired", [False, True], ids=("serving, minting a fresh link", "retired, voiding the link"))
    def test_an_unanswered_referee_s_moved_address_from_an_older_sign_in_is_refused_and_stored_nowhere(
        self, mongo_replica_set_url: str, retired: bool
    ):
        async def body(database: AsyncDatabase, http: AsyncClient) -> tuple[bool, Any]:
            response = await http.patch(self.URL, headers=OLDER, json=a_save(MOVED_EMAIL))
            stored = await database[Collection.SCHIEDSRICHTER].find_one({"_id": SCHIEDSRICHTER_ID})
            return refused(response), stored and (stored["kontakt"]["email"], stored["bestaetigung"]["token_hash"])

        seed = seeding(a_referee(retired=retired))

        assert on_a_season(mongo_replica_set_url, body, seed=seed) == (True, (REFEREE_EMAIL, hash_token("seeded-referee")))

    @pytest.mark.parametrize("retired", [False, True], ids=("serving", "retired"))
    def test_a_confirmed_referee_s_moved_address_from_an_older_sign_in_is_refused_and_asks_nobody(
        self, mongo_replica_set_url: str, retired: bool
    ):
        """The address link hands the referee's record to whoever holds the new mailbox, as a consent link hands the answer."""

        async def body(database: AsyncDatabase, http: AsyncClient) -> tuple[bool, Any]:
            response = await http.patch(self.URL, headers=OLDER, json=a_save(MOVED_EMAIL))
            stored = await database[Collection.SCHIEDSRICHTER].find_one({"_id": SCHIEDSRICHTER_ID})
            return refused(response), stored and (stored["kontakt"]["email"], "adresswechsel" in stored)

        seed = seeding(a_referee(confirmed=True, retired=retired))

        assert on_a_season(mongo_replica_set_url, body, seed=seed) == (True, (REFEREE_EMAIL, False))

    @pytest.mark.parametrize(
        ("referee", "email"),
        [
            pytest.param(a_referee(), "collina@EXAMPLE.com", id="the same mailbox, its domain spelled otherwise"),
            pytest.param(a_referee(confirmed=True), "collina@EXAMPLE.com", id="a confirmed referee's same mailbox"),
        ],
    )
    def test_a_save_touching_no_link_takes_the_older_sign_in(self, mongo_replica_set_url: str, referee: dict[str, Any], email: str):
        async def body(database: AsyncDatabase, http: AsyncClient) -> int:
            return (await http.patch(self.URL, headers=OLDER, json=a_save(email))).status_code

        assert on_a_season(mongo_replica_set_url, body, seed=seeding(referee)) == 200


class TestTheRefereesReturn:
    URL = f"/api/v{API_VERSION}/schiedsrichter/{SCHIEDSRICHTER_ID}/reactivate"

    def test_a_return_minting_a_link_from_an_older_sign_in_is_refused_and_leaves_the_referee_retired(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, http: AsyncClient) -> tuple[bool, Any]:
            response = await http.post(self.URL, headers=OLDER)
            stored = await database[Collection.SCHIEDSRICHTER].find_one({"_id": SCHIEDSRICHTER_ID})
            return refused(response), stored and stored["inactive_since"]

        assert on_a_season(mongo_replica_set_url, body, seed=seeding(a_referee(retired=True))) == (True, "2026-01-01")

    def test_a_confirmed_referee_s_return_takes_the_older_sign_in(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, http: AsyncClient) -> int:
            return (await http.post(self.URL, headers=OLDER)).status_code

        assert on_a_season(mongo_replica_set_url, body, seed=seeding(a_referee(confirmed=True, retired=True))) == 200
