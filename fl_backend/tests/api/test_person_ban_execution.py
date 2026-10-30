"""
API · `person_barred` over the real ban read, on a route declaring a person's binder

`tests/api/test_actor_binding.py :: TestThePersonsSession` proves what the binder binds and what is
refused before the read; this proves the read itself, against a stored ban.
"""

from typing import Any

import pytest
from fastapi import Depends
from httpx2 import ASGITransport, AsyncClient

from app.api.sperrliste.guard import PERSON_ACTOR_BINDERS
from app.core.codes import Code
from app.core.collections import Collection
from app.main import create_app
from tests.actor_tokens import actor_headers
from tests.config import TEST_BASE_URL
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import ban_document, rules_document, saison_document
from tests.worker import worker_database

from .conftest import config_for

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_person_ban_test")

CONFIG = config_for(DATABASE_NAME)

PROBE = "/api/v0/person-probe"
RUNNING = "2026"
BARRED = "gesperrt@beispielschule.de"
UNBARRED = "frei@beispielschule.de"


def _probe() -> dict[str, bool]:
    return {"erreicht": True}


def answered(url: str, email: str, *, bis: str, barred: str = BARRED) -> tuple[int, Any]:
    """One request naming `email` as a person, a season running and a ban on `barred` standing to `bis`."""

    async def _run() -> tuple[int, Any]:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(saison_document(RUNNING, "active", rules=rules_document()))
            await database[Collection.SPERRLISTE].insert_one(ban_document(barred, bis=bis))

            app = create_app(CONFIG)
            app.add_api_route(PROBE, _probe, methods=["GET"], dependencies=[Depends(PERSON_ACTOR_BINDERS["spieler"])])
            app.state.db_client = client
            async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url=TEST_BASE_URL) as http:
                response = await http.get(PROBE, headers=actor_headers(email, lane="person"))

            return response.status_code, response.json()

    return on_the_seed_loop(_run())


@pytest.mark.parametrize("email", [BARRED, BARRED.upper()], ids=("as stored", "in another case"))
def test_a_person_a_standing_ban_holds_is_refused(mongo_url: str, email: str):
    status, body = answered(mongo_url, email, bis="2031")

    assert (status, body["error_code"]) == (403, Code.PERSON_BARRED)
    assert BARRED not in str(body).lower()


def test_an_address_beyond_ascii_reaches_the_ban_read_decoded_and_folded(mongo_url: str):
    """Percent-encoded as the frontend sends it, and asked in the punycode spelling every record stores."""

    status, body = answered(mongo_url, "anna@müller.de", bis="2031", barred="anna@xn--mller-kva.de")

    assert (status, body["error_code"]) == (403, Code.PERSON_BARRED)


def test_a_person_no_ban_holds_is_served(mongo_url: str):
    """The control, beside a ban on another address."""

    assert answered(mongo_url, UNBARRED, bis="2031") == (200, {"erreicht": True})


def test_a_ban_whose_last_season_has_passed_bars_nobody(mongo_url: str):
    """Compared against the running season, as every other reader of the list compares it."""

    assert answered(mongo_url, BARRED, bis="2025") == (200, {"erreicht": True})
