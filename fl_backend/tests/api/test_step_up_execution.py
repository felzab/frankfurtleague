"""
API · a write stepped up on some calls alone asks the step-up window on exactly those calls

Each of these handlers decides whether this call destroys what nothing restores, or mints or voids a
link to an address, and refuses `REQ-AUTH-009` there from a sign-in older than the step-up window
(`docs/backend/spec.md :: I524`). Served over HTTP against the shipped validators, so each refusal is
shown to leave the stored state as it was, and each call of the other kind to pass the same sign-in.
"""

import functools
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import AsyncClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.adresswechsel.services import compose_record
from app.api.bewerbungen.services import hash_token
from app.api.schiedsrichter.services import compose_bestaetigung
from app.api.teams.schemas import kontakte_stand_of
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.security import ACTOR_HEADER, CONFIRMATION_REQUIRED, ENROLMENT_WINDOW_S, STEP_UP_WINDOW_S
from app.main import create_app
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from tests.actor_tokens import ACTOR_TOKEN_CONTRACT, SignedActor, actor_claims, sign
from tests.app_client import app_client
from tests.config import ADMIN_KEY, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import eigene_einwilligung_document, kontaktperson_document, rules_document, saison_document, saison_team_document
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

    def test_emptying_a_confirmed_seat_from_an_older_sign_in_is_refused_and_empties_nothing(self, mongo_replica_set_url: str):
        """Its own link is spent, but its links on the team's open match confirmations die with it, which no read here rules out."""

        confirmed = kontaktperson_document(
            "Ida",
            bestaetigt_am="2026-03-02",
            einwilligung={"text_version": LAUFENDE_FASSUNGEN["bewerbung"], "datum": "2026-03-01"},
            nachname="Musterfrau",
            email="ida@example.com",
            telefon="+4917010000001",
        )
        seated = {**self.NOBODY, "trainer": confirmed}

        async def seed(database: AsyncDatabase) -> None:
            await database[Collection.SAISON_TEAMS].update_one({"team_id": TEAM_ID}, {"$set": {"kontakte": seated}})

        async def body(database: AsyncDatabase, http: AsyncClient) -> tuple[bool, Any]:
            payload = {"kontakte": dict(self.NOBODY), "kontakte_stand": kontakte_stand_of(seated)}
            response = await http.patch(self.URL, headers=OLDER, json=payload)
            stored = await database[Collection.SAISON_TEAMS].find_one({"team_id": TEAM_ID})
            return refused(response), stored and stored["kontakte"]

        assert on_a_season(mongo_replica_set_url, body, seed=seed) == (True, seated)


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
                "einwilligung": eigene_einwilligung_document(text_version="v1", bestaetigt_am="2026-03-21", umfang="intern"),
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
    def test_a_confirmed_referee_s_address_change_from_an_older_sign_in_is_refused_and_asks_nobody(
        self, mongo_replica_set_url: str, retired: bool
    ):
        """The address link hands the referee's record to whoever holds the new mailbox, as a consent link hands the answer."""

        async def body(database: AsyncDatabase, http: AsyncClient) -> tuple[bool, Any]:
            response = await http.post(
                f"/api/v{API_VERSION}/adresswechsel", headers=OLDER, json={"adresse": REFEREE_EMAIL, "email": MOVED_EMAIL, "grund": None}
            )
            stored = await database[Collection.SCHIEDSRICHTER].find_one({"_id": SCHIEDSRICHTER_ID})
            return refused(response), stored and (stored["kontakt"]["email"], await database[Collection.ADRESSWECHSEL].count_documents({}))

        seed = seeding(a_referee(confirmed=True, retired=retired))

        assert on_a_season(mongo_replica_set_url, body, seed=seed) == (True, (REFEREE_EMAIL, 0))

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


# A grant holder, beside the suite's administrators, whose own erasure takes their grant with the rest.
GRANT_HOLDER = "gisela.zugang@example.com"


def by_passkey(email: str, *, signed_in_before_s: int) -> dict[str, str]:
    """A person's token after the page's passkey prompt, signed when called, so its `iat` is the request's."""

    claims = {**actor_claims(email, lane="person", signed_in_before_s=signed_in_before_s), "amr": [ACTOR_TOKEN_CONTRACT["admin_factor"]]}

    return {**ADMIN_KEY, ACTOR_HEADER: sign(claims)}


async def a_grant_holder(database: AsyncDatabase) -> None:
    await database[Collection.BERECHTIGUNGEN].insert_one(
        {"adresse": GRANT_HOLDER, "verwaltung": "administration", "erteilt_von": "PLAYGROUND", "erteilt_am": datetime(2026, 1, 1, tzinfo=UTC)}
    )


class TestAGrantHoldersOwnErasure:
    """A person's erasure asks the revoke's passkey window on the calls taking a live grant (`docs/backend/spec.md :: I489`)."""

    URL = f"/api/v{API_VERSION}/identitaet/selbst/erasure"

    def test_an_erasure_from_a_passkey_past_the_window_is_refused_and_erases_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, http: AsyncClient) -> tuple[bool, int]:
            # The person's own token, past the revoke's window by a minute: this suite's `OLDER` is an administrator's.
            OLDER = by_passkey(GRANT_HOLDER, signed_in_before_s=ENROLMENT_WINDOW_S + 60)
            response = await http.post(self.URL, headers=OLDER)
            return refused(response), await database[Collection.BERECHTIGUNGEN].count_documents({"adresse": GRANT_HOLDER})

        assert on_a_season(mongo_replica_set_url, body, seed=a_grant_holder) == (True, 1)

    def test_an_erasure_from_a_sign_in_by_code_is_refused_however_fresh(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, http: AsyncClient) -> tuple[bool, int]:
            by_code = SignedActor(GRANT_HOLDER, ADMIN_KEY, lane="person", signed_in_before_s=1)
            response = await http.post(self.URL, headers=by_code)
            return refused(response), await database[Collection.BERECHTIGUNGEN].count_documents({"adresse": GRANT_HOLDER})

        assert on_a_season(mongo_replica_set_url, body, seed=a_grant_holder) == (True, 1)

    def test_a_passkey_confirmed_a_second_before_its_token_erases_the_grant(self, mongo_replica_set_url: str):
        """The page's prompt reads the session before its insert, so `auth_time` precedes `iat`: the window is judged at `iat`."""

        async def body(database: AsyncDatabase, http: AsyncClient) -> tuple[int, int]:
            response = await http.post(self.URL, headers=by_passkey(GRANT_HOLDER, signed_in_before_s=1))
            return response.status_code, response.json()["berechtigungen"]

        assert on_a_season(mongo_replica_set_url, body, seed=a_grant_holder) == (200, 1)

    def test_an_address_holding_no_grant_erases_from_an_older_sign_in_by_code(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, http: AsyncClient) -> int:
            older = SignedActor("niemand@example.com", ADMIN_KEY, lane="person", signed_in_before_s=ENROLMENT_WINDOW_S + 60)
            return (await http.post(self.URL, headers=older)).status_code

        assert on_a_season(mongo_replica_set_url, body) == 200


class TestAGrantHoldersOwnAddressChange:
    """A start of a change handing a grant over asks the passkey the erasure asks (`docs/backend/spec.md :: I790`)."""

    URL = f"/api/v{API_VERSION}/konto/adresswechsel"

    def test_a_start_by_code_is_refused_however_fresh_and_starts_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, http: AsyncClient) -> tuple[bool, int]:
            # By code a second ago: the route's own window passes it, and the handler judges the factor.
            OLDER = SignedActor(GRANT_HOLDER, ADMIN_KEY, lane="person", signed_in_before_s=1)
            response = await http.post(self.URL, json={"email": "gisela.neu@example.com"}, headers=OLDER)
            return refused(response), await database[Collection.ADRESSWECHSEL].count_documents({})

        assert on_a_season(mongo_replica_set_url, body, seed=a_grant_holder) == (True, 0)


async def a_grant_holders_change_awaiting_approval(database: AsyncDatabase) -> None:
    await a_grant_holder(database)
    await database[Collection.ADRESSWECHSEL].insert_one(
        {
            "_id": AWAITING_CHANGE_ID,
            **compose_record(
                adresse=GRANT_HOLDER,
                email="gisela.neu@example.com",
                weg="freigabe",
                token_hash=None,
                stopp_hash=hash_token("stop-awaiting"),
                grund=None,
                genehmigung=None,
                # Started now, the request's own clock being the real one: a past start would lapse before the press.
                now=datetime.now(UTC),
            ),
        }
    )


AWAITING_CHANGE_ID = ObjectId("6890a1b2c3d4e5f607950021")


class TestAGrantHoldersApprovalOfAnAdministratorsChange:
    """The address on file's approval lets the link go that hands the grant over (`docs/backend/spec.md :: I790`)."""

    URL = f"/api/v{API_VERSION}/konto/adresswechsel/freigabe"

    def test_an_approval_by_code_is_refused_however_fresh_and_mints_no_link(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, http: AsyncClient) -> tuple[bool, Any]:
            # By code a second ago, as the start's case: the route's own window passes it.
            OLDER = SignedActor(GRANT_HOLDER, ADMIN_KEY, lane="person", signed_in_before_s=1)
            response = await http.post(self.URL, json={"id": str(AWAITING_CHANGE_ID)}, headers=OLDER)
            stored = await database[Collection.ADRESSWECHSEL].find_one({"_id": AWAITING_CHANGE_ID})
            return refused(response), (stored or {}).get("token_hash")

        assert on_a_season(mongo_replica_set_url, body, seed=a_grant_holders_change_awaiting_approval) == (True, None)


# An administrator's address beside the suite's, whose erasure on request takes that grant with the rest.
ERASED_ADMINISTRATOR = "zugang.anfrage@example.com"


async def an_administrators_grant(database: AsyncDatabase) -> None:
    await database[Collection.BERECHTIGUNGEN].insert_one(
        {
            "adresse": ERASED_ADMINISTRATOR,
            "verwaltung": "administration",
            "erteilt_von": "PLAYGROUND",
            "erteilt_am": datetime(2026, 1, 1, tzinfo=UTC),
        }
    )


def an_erasure_of(email: str) -> dict[str, str]:
    return {"email": email, "anlass": "Mail vom 30.03.2026"}


class TestAnErasureOnRequestEndingAGrant:
    """An administrator's erasure asks the revoke's window on the calls taking a live grant (`docs/backend/spec.md :: I489`)."""

    URL = f"/api/v{API_VERSION}/identitaet/erasure"

    def test_an_erasure_ending_a_grant_from_a_sign_in_past_that_window_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, http: AsyncClient) -> tuple[bool, int, int]:
            # Inside the step-up window, past the revoke's by a minute: this suite's `OLDER` is past both.
            OLDER = SignedActor(ADMIN, ADMIN_KEY, signed_in_before_s=ENROLMENT_WINDOW_S + 60)
            logged = await database[Collection.AKTIONEN].count_documents({})
            response = await http.post(self.URL, headers=OLDER, json=an_erasure_of(ERASED_ADMINISTRATOR))
            return (
                refused(response),
                await database[Collection.BERECHTIGUNGEN].count_documents({"adresse": ERASED_ADMINISTRATOR}),
                await database[Collection.AKTIONEN].count_documents({}) - logged,
            )

        assert on_a_season(mongo_replica_set_url, body, seed=an_administrators_grant) == (True, 1, 0)

    def test_an_erasure_ending_a_grant_from_a_fresh_sign_in_takes_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, http: AsyncClient) -> tuple[int, int]:
            response = await http.post(self.URL, headers=FRESH, json=an_erasure_of(ERASED_ADMINISTRATOR))
            return response.status_code, response.json()["berechtigungen"]

        assert on_a_season(mongo_replica_set_url, body, seed=an_administrators_grant) == (200, 1)

    def test_an_address_holding_no_grant_asks_the_step_up_window_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, http: AsyncClient) -> int:
            past_the_revokes = SignedActor(ADMIN, ADMIN_KEY, signed_in_before_s=ENROLMENT_WINDOW_S + 60)
            return (await http.post(self.URL, headers=past_the_revokes, json=an_erasure_of("niemand@example.com"))).status_code

        assert on_a_season(mongo_replica_set_url, body) == 200
