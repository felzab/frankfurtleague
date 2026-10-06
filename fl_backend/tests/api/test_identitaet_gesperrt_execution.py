import functools
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import Response
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.sperrliste.admin_router import delete_sperrliste_eintrag
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.exception_handlers import PAYLOAD_REFUSED
from app.main import create_app
from app.shared.schemas.bounds import KONTAKT_EMAIL_MAX_LENGTH
from tests.app_client import app_client
from tests.config import SYSTEM_AUTH
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import ban_document, rules_document, saison_document
from tests.worker import worker_database

from .conftest import config_for

DATABASE_NAME = worker_database("fl_identitaet_gesperrt_test")

PATH = f"/api/v{API_VERSION}/identitaet/gesperrt"

PAST_SAISON = "2425"
ACTIVE_SAISON = "2526"
FUTURE_SAISON = "2627"

# Distinctive, so a hit cannot be a coincidence of a seeded corpus: one ban standing, keyed from the
# spelling an administrator typed, and one whose last season has passed.
GESPERRT = "Gerda.Gesperrt@Schule.de"
ABGELAUFEN = "arno.abgelaufen@schule.de"
UNGESPERRT = "baldur.krautzberger@schule.de"

# One mailbox at an internationalised domain, banned as typed in Unicode: a record stores it in
# punycode (`docs/backend/spec.md :: I332`), which is the spelling the mailer then sends to.
IDN_GESPERRT = "anna@müller.de"
IDN_STORED = "anna@xn--mller-kva.de"

# A local part beyond ASCII, which today's address rule refuses and so no ban can be keyed under: a
# record stored under an older rule may still hold one.
UNKEYABLE = "jürgen@schule.de"

BAN_OID = ObjectId("6890a1b2c3d4e5f607830001")

SEEDED_BANS = 3

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_list(url: str, body: Body) -> Any:
    """Three seasons and three bans, the REAL validators admitting both, then `body` on the seed loop."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_many(
                [
                    saison_document(saison_id, status, rules=rules_document(erlaubte_stufen=["Q1"]))
                    for saison_id, status in ((PAST_SAISON, "past"), (ACTIVE_SAISON, "active"), (FUTURE_SAISON, "future"))
                ]
            )
            await database[Collection.SPERRLISTE].insert_many(
                [
                    ban_document(GESPERRT, bis=FUTURE_SAISON, _id=BAN_OID),
                    ban_document(ABGELAUFEN, bis=PAST_SAISON),
                    ban_document(IDN_GESPERRT, bis=FUTURE_SAISON),
                ]
            )

            return await body(database, client)

    return on_the_seed_loop(_run())


@functools.cache
def _served() -> FastAPI:
    """One app for every case serving through it: building one costs more than the request a case sends through it.

    Built on first use rather than at import, which every xdist worker pays at collection.
    """

    return create_app(config_for(DATABASE_NAME))


async def ask(url: str, email: str) -> Response:
    """One request through the MOUNTED route, so the payload is parsed as the frontend's body arrives."""

    async with app_client(url, app=_served()) as http:
        return await http.post(PATH, headers=SYSTEM_AUTH, json={"email": email})


def gesperrt(url: str, email: str, *, lift: bool = False) -> bool:
    """`lift` lifts the standing ban as an administrator does, through its own route, before asking."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Response:
        if lift:
            await delete_sperrliste_eintrag(sperrliste_id=BAN_OID, sperrliste_collection=database[Collection.SPERRLISTE], db=client)

        return await ask(url, email)

    response: Response = on_a_list(url, body)
    assert response.status_code == 200, response.text

    return response.json()["gesperrt"]


@pytest.mark.db
class TestWhichSpellingsABanHolds:
    @pytest.mark.parametrize(
        "email",
        [
            pytest.param(GESPERRT, id="as typed"),
            pytest.param("gerda.gesperrt@schule.de", id="lower-cased"),
            pytest.param("GERDA.GESPERRT@SCHULE.DE", id="upper-cased"),
            pytest.param(IDN_STORED, id="a Unicode ban asked in punycode"),
            pytest.param("Anna@MÜLLER.de", id="a Unicode ban asked in other capitals"),
        ],
    )
    def test_every_spelling_that_folds_alike_is_barred(self, mongo_replica_set_url: str, email: str):
        """The mailer sends to the spelling a record stores, which is rarely the one the ban was typed in."""

        assert gesperrt(mongo_replica_set_url, email) is True

    def test_an_address_the_list_does_not_hold_is_not_barred(self, mongo_replica_set_url: str):
        """The control: an endpoint answering `true` for everything passes the cases above and stops every message."""

        assert gesperrt(mongo_replica_set_url, UNGESPERRT) is False


@pytest.mark.db
class TestABanThatEndedHoldsNothing:
    def test_a_lifted_ban_holds_nothing(self, mongo_replica_set_url: str):
        """Asked in the spelling the ban was typed in, so the lift is the one thing that changed from the case barring it."""

        assert gesperrt(mongo_replica_set_url, GESPERRT, lift=True) is False

    def test_a_ban_whose_last_season_has_passed_holds_nothing(self, mongo_replica_set_url: str):
        """The row still stands, as it does until the rollover removes it; its bound is what lapses it."""

        assert gesperrt(mongo_replica_set_url, ABGELAUFEN) is False


@pytest.mark.db
class TestTheAnswer:
    def test_an_address_no_ban_can_key_is_answered_false_rather_than_refused(self, mongo_replica_set_url: str):
        """A refusal reads to the mailer as a failed read, which sends nothing: one stored under an older rule would never be mailed again."""

        assert gesperrt(mongo_replica_set_url, UNKEYABLE) is False

    def test_the_flag_is_the_whole_answer(self, mongo_replica_set_url: str):
        """Nothing of the ban -- its reason, its author, its bound -- reaches the mailer, which acts on the flag alone."""

        async def body(_database: AsyncDatabase, _client: AsyncMongoClient) -> Any:
            return (await ask(mongo_replica_set_url, GESPERRT)).json()

        assert on_a_list(mongo_replica_set_url, body) == {"acknowledged": 1, "gesperrt": True}

    def test_the_question_stores_nothing(self, mongo_replica_set_url: str):
        """Asked about a barred address, the case most likely to write something down: no log row and no ban row moves."""

        async def body(database: AsyncDatabase, _client: AsyncMongoClient) -> tuple[int, int, int]:
            response = await ask(mongo_replica_set_url, GESPERRT)

            return (
                response.status_code,
                await database[Collection.AKTIONEN].count_documents({}),
                await database[Collection.SPERRLISTE].count_documents({}),
            )

        assert on_a_list(mongo_replica_set_url, body) == (200, 0, SEEDED_BANS)


@pytest.mark.db
class TestWhatThePayloadRefuses:
    """Bounded where the address rule is not: the field is a lookup, but a value naming no mailbox asks nothing.

    Posted through the mounted route, where alone the answer's shape exists; without a database its dependency answers first.
    """

    @pytest.mark.parametrize(
        "email",
        [
            pytest.param("", id="empty"),
            pytest.param("gerda.gesperrt", id="no at sign"),
            pytest.param(f"{'a' * KONTAKT_EMAIL_MAX_LENGTH}@schule.de", id="past the ceiling"),
            pytest.param(None, id="null"),
        ],
    )
    def test_a_value_naming_no_mailbox_is_refused_naming_the_field_alone(self, mongo_replica_set_url: str, email: str | None):
        """The refusal reaches a log line and the frontend's gate alike, so it echoes nothing of the address it was asked about."""

        async def body(_database: AsyncDatabase, _client: AsyncMongoClient) -> Response:
            async with app_client(mongo_replica_set_url, app=_served()) as http:
                return await http.post(PATH, headers=SYSTEM_AUTH, json={"email": email})

        response: Response = on_a_list(mongo_replica_set_url, body)

        assert (response.status_code, response.json()["error_code"]) == (422, PAYLOAD_REFUSED)
        assert [field["path"] for field in response.json()["fields"]] == [["email"]]
        assert email is None or email == "" or email not in response.text
