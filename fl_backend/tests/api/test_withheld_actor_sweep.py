"""
API · no admin-tier read answers a barred administrator's address in plain, a logged image apart

Every admin-tier read is named here once: with the request showing it a row a barred administrator
wrote, or with why no answer of it names an administrator. The two listings agree with the mounted
routes, so a new read fails until someone says which it is (`docs/backend/spec.md :: I452`). The
image `GET /aktionen/{aktion_id}` serves is the document as the write replaced it, barred addresses
included, since a restore starts from it (`docs/backend/spec.md :: I514`): the seeded log row
carries none, and one holding the barred address would fail this sweep by design.
"""

import asyncio
import functools
import json
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import pytest
from bson import ObjectId
from fastapi import FastAPI
from fastapi.routing import APIRoute
from pymongo import MongoClient

from app.api.einladungen.services import compose_einladung
from app.api.sperrliste.services import compose_gesperrt_bis_saison_id
from app.core.collections import Collection
from app.core.exception_handlers import STORES_NOTHING_WHEN, stores_nothing
from app.core.recording import log_stamp
from app.core.security import verify_access_admin
from app.main import create_app
from tests.actor_tokens import SignedActor
from tests.app_client import app_client
from tests.config import ADMIN_KEY, grants_for_the_suite
from tests.core.app_source import api_routes, application
from tests.database import a_clean_database_sync
from tests.documents import ban_document, saison_document
from tests.worker import worker_database

from .conftest import config_for
from .test_bewerbungen_read import bewerbung_document
from .test_registrierung_read import registrierung_document

DATABASE_NAME = worker_database("fl_withheld_actor_test")

CONFIG = config_for(DATABASE_NAME)

# Distinctive, so a hit anywhere in an answer could not be coincidence.
BARRED = "zorbanax.verwalter@beispielschule.de"
# The address the barred administrator banned while they held a grant.
OTHER = "quillhilde@beispielschule.de"
OWNER = grants_for_the_suite()[0]["adresse"]

SAISON_ID = "2026"
TEAM_OID = ObjectId("6890a1b2c3d4e5f607510001")
AKTION_OID = ObjectId("6890a1b2c3d4e5f607510002")
REGISTRIERUNG_OID = ObjectId("6890a1b2c3d4e5f607510003")
BEWERBUNG_OID = ObjectId(bewerbung_document(1)["_id"])


def _serves_a_read(route: APIRoute) -> bool:
    """By what it serves rather than its method: a read over POST declares it stores nothing (`docs/backend/spec.md :: I327`)."""

    calls = {dependency.call for dependency in route.dependant.dependencies}

    return "GET" in (route.methods or ()) or stores_nothing in calls or bool(calls & STORES_NOTHING_WHEN.keys())


# The mounted spelling, convertors included, and never a list: a read added later is swept without an edit here.
ADMIN_READS = sorted(
    route.path
    for route in api_routes(application())
    if isinstance(route, APIRoute)
    and route.include_in_schema
    and _serves_a_read(route)
    and verify_access_admin in {dependency.call for dependency in route.dependant.dependencies}
)

# Each read an administrator's address can reach, and the request showing it the barred one's rows.
NAMES_AN_ADMINISTRATOR: dict[str, str] = {
    "/api/v0/aktionen": "/api/v0/aktionen",
    "/api/v0/aktionen/{aktion_id:objectid}": f"/api/v0/aktionen/{AKTION_OID}",
    "/api/v0/berechtigungen": "/api/v0/berechtigungen",
    "/api/v0/bewerbungen": "/api/v0/bewerbungen",
    "/api/v0/bewerbungen/{bewerbung_id:objectid}": f"/api/v0/bewerbungen/{BEWERBUNG_OID}",
    "/api/v0/registrierungen": "/api/v0/registrierungen",
    "/api/v0/sperrliste": "/api/v0/sperrliste",
    "/api/v0/teams/{team_id:objectid}/saisons/{saison_id}/einladung": f"/api/v0/teams/{TEAM_OID}/saisons/{SAISON_ID}/einladung",
}

_PERSON_RECORDS = "a person's own record, whose address a ban withholds nowhere: the administrator takes it away by hand"

# Each read no answer of which names an administrator, and what it serves instead.
NAMES_NO_ADMINISTRATOR: dict[str, str] = {
    "/api/v0/kontakte/erasure/ansicht": "the seats an erasure would clear, by name and season and with no address",
    "/api/v0/registrierungen/kader/{team_id:objectid}/{saison_id}": "a team's pending registrations, no decision among them",
    "/api/v0/saisons/list/admin": "seasons and their rules",
    "/api/v0/saisons/{saison_id}/einladungen/versand/vorschau": f"the teams a mailing would reach, their seats being {_PERSON_RECORDS}",
    "/api/v0/schiedsrichter": f"referees, {_PERSON_RECORDS}",
    "/api/v0/schiedsrichter/{schiedsrichter_id:objectid}": f"one referee, {_PERSON_RECORDS}",
    "/api/v0/spiele/action_required": "fixtures",
    "/api/v0/spiele/list/admin": "fixtures",
    "/api/v0/spiele/{spiel_id:objectid}": "a save's dry run, which reports the fixtures it would move",
    "/api/v0/spiele/{spiel_id:objectid}/admin": "one fixture",
    "/api/v0/spieler/kader/{team_id:objectid}/{saison_id}": "one team's squad as its seat holders read it, which carries nobody's address",
    "/api/v0/spieler/memberships": f"players and their squad rows, {_PERSON_RECORDS}",
    "/api/v0/spieler/selbst": "the signed-in pupil's own record, which carries no address",
    "/api/v0/schiedsrichter/selbst": "the signed-in referee's own records, served to that person alone",
    "/api/v0/konto/einwilligungen": "the signed-in person's own consent records, served to that person alone",
    "/api/v0/spieler/nachnominierung/{saison_id}": "a season's late-entry window",
    "/api/v0/spieltage/list/admin": "matchdays",
    "/api/v0/spieltage/{spieltag_id:objectid}/admin": "one matchday",
    "/api/v0/spielorte": "venues",
    "/api/v0/spielorte/{spielort_id:objectid}": "one venue",
    "/api/v0/teams/list/admin": f"clubs and their contact seats, {_PERSON_RECORDS}",
    "/api/v0/teams/memberships": "clubs and their seasons",
    "/api/v0/teams/{team_id:objectid}/saisons/{saison_id}/person/sitze": "one team's seat holders by name, as the seat holders read them",
}


# Composed by the production helper rather than spelled, so a drifted bound cannot leave these cases passing over a lapsed row.
STANDING = compose_gesperrt_bis_saison_id(massgebliche_saison_id=SAISON_ID)
# The season before the running one, so a ban naming it as its last has lapsed.
LAPSED = f"{int(SAISON_ID) - 1}"


def _seed(url: str, *, ban_until: str | None) -> None:
    """One row per read, each written by `BARRED` while they held a grant; `ban_until` bans them afterwards, through that season."""

    client: MongoClient = MongoClient(url)
    try:
        database = a_clean_database_sync(client, url, DATABASE_NAME)
        database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active"))
        database[Collection.BERECHTIGUNGEN].insert_many(
            [
                *grants_for_the_suite(),
                {
                    "adresse": "neu.verwalterin@beispielschule.de",
                    "verwaltung": "administration",
                    "erteilt_von": BARRED,
                    "erteilt_am": datetime(2026, 4, 1, tzinfo=UTC),
                },
            ]
        )
        database[Collection.SPERRLISTE].insert_many(
            [
                ban_document(OTHER, bis=STANDING, erstellt_von=BARRED),
                *([] if ban_until is None else [ban_document(BARRED, bis=ban_until, erstellt_von=OWNER)]),
            ]
        )
        database[Collection.EINLADUNGEN].insert_one(
            compose_einladung(saison_id=SAISON_ID, team_id=TEAM_OID, token_hash="a" * 64, erstellt_von=BARRED, today="2026-04-01")
        )
        database[Collection.BEWERBUNGEN].insert_one(
            {**bewerbung_document(1, status="abgelehnt"), "entscheidung": {"getroffen_am": "2026-04-02", "von": BARRED, "grund": "Kein Platz"}}
        )
        database[Collection.REGISTRIERUNGEN].insert_one(
            {
                **registrierung_document(REGISTRIERUNG_OID, vorname="Thessaly"),
                "status": "abgelehnt",
                "entscheidung": {"getroffen_am": "2026-04-03", "von": BARRED, "grund": None},
            }
        )
        # The real clock, never a date: the retention index removes a row a year past `at_date`, so a
        # fixed one would leave the `/aktionen` reads nothing to answer once that year had run.
        recorded = datetime.now(UTC)
        database[Collection.AKTIONEN].insert_one(
            {
                "_id": AKTION_OID,
                "at": log_stamp(recorded),
                "at_date": recorded,
                "actor": {"kind": "admin_session", "email": BARRED},
                "trace_id": "0123456789abcdef",
                "request": {"method": "POST", "path": "/api/v0/sperrliste"},
                "collection": "sperrliste",
                "operation": "insert",
                "document_id": ObjectId(),
                "db_filter": None,
                "before": None,
                "modified_count": None,
                "redacted_at": None,
            }
        )
    finally:
        client.close()


def _flags_set(value: Any) -> list[str]:
    """Every `…gesperrt` key holding `true`, at any depth: a withheld address is flagged rather than dropped."""

    if isinstance(value, list):
        return [key for item in value for key in _flags_set(item)]
    if not isinstance(value, dict):
        return []

    return [key for key, held in value.items() if key.endswith("gesperrt") and held is True] + [
        key for held in value.values() for key in _flags_set(held)
    ]


@functools.cache
def _served() -> FastAPI:
    """One app for every case serving through it: building one costs more than the request a case sends through it.

    Built on first use rather than at import, which every xdist worker pays at collection.
    """

    return create_app(CONFIG)


def _answers(url: str) -> dict[str, tuple[int, str]]:
    """Every read naming an administrator, asked by the owner through the mounted app."""

    async def _asked() -> dict[str, tuple[int, str]]:
        answered: dict[str, tuple[int, str]] = {}
        async with app_client(url, app=_served()) as http:
            for route, request in NAMES_AN_ADMINISTRATOR.items():
                response = await http.get(request, headers=SignedActor(OWNER, ADMIN_KEY))
                answered[route] = (response.status_code, response.text)

        return answered

    return asyncio.run(_asked())


@pytest.fixture(scope="module")
def unbarred(mongo_replica_set_url: str) -> Iterator[dict[str, tuple[int, str]]]:
    _seed(mongo_replica_set_url, ban_until=None)

    yield _answers(mongo_replica_set_url)


@pytest.fixture(scope="module")
def barred(mongo_replica_set_url: str, unbarred: dict[str, tuple[int, str]]) -> Iterator[dict[str, tuple[int, str]]]:
    """Seeded after `unbarred` has read, since both write the one database."""

    _seed(mongo_replica_set_url, ban_until=STANDING)

    yield _answers(mongo_replica_set_url)


@pytest.fixture(scope="module")
def lapsed(mongo_replica_set_url: str, barred: dict[str, tuple[int, str]]) -> Iterator[dict[str, tuple[int, str]]]:
    """Seeded after `barred` has read, for the same reason."""

    _seed(mongo_replica_set_url, ban_until=LAPSED)

    yield _answers(mongo_replica_set_url)


def test_every_admin_tier_read_is_named_once():
    """Two listings reached by different routes, this module's and the mounted app's, required to agree."""

    named = [*NAMES_AN_ADMINISTRATOR, *NAMES_NO_ADMINISTRATOR]

    assert sorted(named) == ADMIN_READS, "an admin-tier read neither listing names, or a listing naming a read nothing mounts"
    assert len(set(named)) == len(named), "a read named in both listings"


@pytest.mark.db
@pytest.mark.parametrize("route", sorted(NAMES_AN_ADMINISTRATOR))
def test_an_unbarred_administrator_is_served_by_address(unbarred: dict[str, tuple[int, str]], route: str):
    """The control: a read the seed never reached would pass the case below having served nothing."""

    status, text = unbarred[route]

    assert status == 200, text
    assert BARRED in text.lower()
    assert _flags_set(json.loads(text)) == []


@pytest.mark.db
@pytest.mark.parametrize("route", sorted(NAMES_AN_ADMINISTRATOR))
def test_a_barred_administrator_is_withheld_beside_a_flag(barred: dict[str, tuple[int, str]], route: str):
    status, text = barred[route]

    assert status == 200, text
    assert BARRED not in text.lower()
    assert _flags_set(json.loads(text)) != [], "the address is gone and nothing says it was withheld"


@pytest.mark.db
@pytest.mark.parametrize("route", sorted(NAMES_AN_ADMINISTRATOR))
def test_an_administrator_whose_ban_has_lapsed_is_served_by_address(lapsed: dict[str, tuple[int, str]], route: str):
    """The running season is what the bound is read against: asked without it, the lapsed row would still withhold."""

    status, text = lapsed[route]

    assert status == 200, text
    assert BARRED in text.lower()
    assert _flags_set(json.loads(text)) == []
