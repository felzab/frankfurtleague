from collections.abc import Iterator, Mapping
from typing import Any

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient
from httpx import Response
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient

from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.security import ACTOR_HEADER
from app.main import create_app
from tests.config import build_test_config
from tests.database import a_clean_database_sync

from .conftest import config_for, unwritten

ADMIN_AUTH = {"Authorization": "Bearer test-key-admin"}
BASE_AUTH = {"Authorization": "Bearer test-key-base"}

# The one write this file makes rides under an actor; the reads it covers carry none.
ACTOR = "admin@example.com"

# Which guard refused, and so which tier the route belongs to: no key satisfies both.
ADMIN_GUARD_REFUSED = "REQ-AUTH-004"

# Named rather than compared with `!=`: a control asserting only "not 401" passes on any failure.
UNREACHED_DATABASE = "DB-FAIL-001"

# Not the configured URI: a developer plausibly runs a real `mongod` on 27017, and a database that
# answers gives each control something other than the failure it asserts.
UNANSWERED_URI = "mongodb://localhost:1"

UNANSWERED_SELECTION_MS = 100
CONTAINER_SELECTION_MS = 10_000

# The database `build_test_config` names -- the one an app built from that config resolves its
# collections from, and the home of the corpus every reading case here shares.
CORPUS_DATABASE = build_test_config().db_base_name

# The one case that POSTs takes a database of its own: a venue created into the corpus above would
# stand in the venue list every other case reads.
CREATED_VENUE_DATABASE = "fl_reference_admin_write_test"

# Fixed rather than generated, so a failure names the same fixture every run.
SPIELORT_ID = ObjectId("6890a1b2c3d4e5f607240001")
FIRST_SCHIEDSRICHTER_ID = ObjectId("6890a1b2c3d4e5f607240002")
SECOND_SCHIEDSRICHTER_ID = ObjectId("6890a1b2c3d4e5f607240003")

MIETPREIS = 80
LOWER_PAYMENT = 30
HIGHER_PAYMENT = 45

STRASSE = "Hanauer Landstrasse"
MAPS_LINK = f"Sportplatz Ost, {STRASSE} 12a, 60314 Ostend Frankfurt am Main, Deutschland"
SCHULE = "Carl-Schurz-Schule"
TELEFON = "+49 69 1234567"

# A second venue, CREATED through the write path rather than seeded: a `maps_link` this file wrote
# would read back whatever `_maps_link` composed, the seeded one included.
POSTED_VENUE: dict[str, Any] = {
    "name": "Sportplatz West",
    "address": {
        "strasse": "Ludwig-Erhard-Anlage",
        "hausnummer": "1",
        "plz": "60327",
        "stadtteil": "Bockenheim",
        "stadt": "Frankfurt am Main",
    },
    "default_mietpreis": MIETPREIS,
}

# Spelled out, not built from the payload above: a helper composing it the same way would agree with
# `_maps_link` however either changed.
COMPOSED_MAPS_LINK = "Sportplatz West, Ludwig-Erhard-Anlage 1, 60327 Bockenheim Frankfurt am Main, Deutschland"

SPIELORTE = f"/api/v{API_VERSION}/spielorte"
SCHIEDSRICHTER = f"/api/v{API_VERSION}/schiedsrichter"

# Every route the two slices are read through. List and single both, because moving a slice off the
# base tier is a claim about the resource rather than about its list.
READ_PATHS = [
    pytest.param(SPIELORTE, id="the venue list"),
    pytest.param(f"{SPIELORTE}/{SPIELORT_ID}", id="one venue"),
    pytest.param(SCHIEDSRICHTER, id="the referee list"),
    pytest.param(f"{SCHIEDSRICHTER}/{FIRST_SCHIEDSRICHTER_ID}", id="one referee"),
]

# What no base credential may reach, and what these reads must therefore carry.
VENUE_PRIVILEGED = ("address", "default_mietpreis")
REFEREE_PRIVILEGED = ("kontakt", "schule", "default_payment")


def spielort_document() -> dict[str, Any]:
    """Every field `FLSpielort` requires, so a response that validates proves the whole shape."""

    return {
        "_id": SPIELORT_ID,
        "name": "Sportplatz Ost",
        "maps_link": MAPS_LINK,
        "address": {
            "strasse": STRASSE,
            "hausnummer": "12a",
            "plz": "60314",
            "stadtteil": "Ostend",
            "stadt": "Frankfurt am Main",
        },
        "default_mietpreis": MIETPREIS,
        "inactive_since": None,
    }


def schiedsrichter_documents() -> list[dict[str, Any]]:
    """Two, named so the default sort by name fixes their order: the fee cases need a pair that differs."""

    return [
        {
            "_id": FIRST_SCHIEDSRICHTER_ID,
            "name": "Ada Kern",
            "schule": SCHULE,
            "default_payment": LOWER_PAYMENT,
            "kontakt": {"telefon": TELEFON, "email": "ada@example.com"},
            "inactive_since": None,
        },
        {
            "_id": SECOND_SCHIEDSRICHTER_ID,
            "name": "Bea Lang",
            "schule": None,
            "default_payment": HIGHER_PAYMENT,
            "kontakt": {"telefon": None, "email": None},
            "inactive_since": None,
        },
    ]


def answered(uri: str, path: str, headers: Mapping[str, str], *, selection_timeout_ms: int, database_name: str = CORPUS_DATABASE) -> Response:
    """One request per client: Motor binds to the loop `TestClient` first ran on.

    No lifespan either, for the reason `fl_backend/tests/api/test_malformed_ids.py :: client` gives.
    """

    app = create_app(config_for(database_name))
    app.state.db_client = AsyncIOMotorClient(host=uri, serverSelectionTimeoutMS=selection_timeout_ms)

    try:
        return TestClient(app, raise_server_exceptions=False).get(path, headers=dict(headers))
    finally:
        app.state.db_client.close()


def created(uri: str, payload: Mapping[str, Any], *, selection_timeout_ms: int, database_name: str) -> Response:
    """POST one venue, on its own client for `answered`'s reason.

    `X-FL-Actor` rides along because the WRITE router binds an actor and refuses a write carrying
    none (`docs/backend/spec.md :: I41`).
    """

    app = create_app(config_for(database_name))
    app.state.db_client = AsyncIOMotorClient(host=uri, serverSelectionTimeoutMS=selection_timeout_ms)

    try:
        client = TestClient(app, raise_server_exceptions=False)
        return client.post(SPIELORTE, json=dict(payload), headers={**ADMIN_AUTH, ACTOR_HEADER: ACTOR})
    finally:
        app.state.db_client.close()


# Module-scoped: every case below reads this corpus and none writes it, which `unwritten` keeps
# from being left as a claim.
@pytest.fixture(scope="module")
def seeded_url(mongo_container: Any) -> Iterator[str]:
    """The venue and both referees, in `CORPUS_DATABASE`."""

    url = str(mongo_container.get_connection_url())

    client = MongoClient(url)
    try:
        database = a_clean_database_sync(client, url, CORPUS_DATABASE)
        database[Collection.SPIELORTE].insert_one(spielort_document())
        database[Collection.SCHIEDSRICHTER].insert_many(schiedsrichter_documents())

        with unwritten(url, CORPUS_DATABASE):
            yield url
    finally:
        client.close()


@pytest.fixture
def empty_url(mongo_container: Any) -> str:
    """`CREATED_VENUE_DATABASE`, holding nothing: the case that POSTs composes the venue it reads back."""

    url = str(mongo_container.get_connection_url())

    client = MongoClient(url)
    try:
        a_clean_database_sync(client, url, CREATED_VENUE_DATABASE)

        return url
    finally:
        client.close()


@pytest.mark.parametrize("path", READ_PATHS)
def test_the_base_key_no_longer_reaches_a_venue_or_a_referee(path: str):
    """The whole change.

    A base credential is the public one, so what it reads is public -- and that was a pupil's phone
    number, the school they attend, and what the league pays for a ground.
    """

    response = answered(UNANSWERED_URI, path, BASE_AUTH, selection_timeout_ms=UNANSWERED_SELECTION_MS)

    assert response.status_code == 401
    assert response.json()["error_code"] == ADMIN_GUARD_REFUSED


@pytest.mark.parametrize("path", READ_PATHS)
def test_the_admin_key_clears_the_guard_and_reaches_the_database(path: str):
    """The control: without it, a refusal from a route that stopped existing would read as the guard's."""

    response = answered(UNANSWERED_URI, path, ADMIN_AUTH, selection_timeout_ms=UNANSWERED_SELECTION_MS)

    assert response.status_code == 500
    assert response.json()["error_code"] == UNREACHED_DATABASE


LIST_CASES = [pytest.param(SPIELORTE, "spielorte", field, id=f"a venue's {field}") for field in VENUE_PRIVILEGED] + [
    pytest.param(SCHIEDSRICHTER, "schiedsrichter", field, id=f"a referee's {field}") for field in REFEREE_PRIVILEGED
]


@pytest.mark.db
@pytest.mark.parametrize(("path", "key", "field"), LIST_CASES)
def test_the_admin_list_still_serves_every_privileged_field(seeded_url: str, path: str, key: str, field: str):
    """Moving the tier may not narrow the shape: the admin tables, both editors and both pickers read these."""

    rows = answered(seeded_url, path, ADMIN_AUTH, selection_timeout_ms=CONTAINER_SELECTION_MS).json()[key]

    assert rows, "the seeded row did not come back, so a present key would prove nothing"
    assert field in rows[0]


SINGLE_CASES = [
    pytest.param(f"{SPIELORTE}/{SPIELORT_ID}", "spielort", str(SPIELORT_ID), field, id=f"a venue's {field}") for field in VENUE_PRIVILEGED
] + [
    pytest.param(
        f"{SCHIEDSRICHTER}/{FIRST_SCHIEDSRICHTER_ID}",
        "schiedsrichter",
        str(FIRST_SCHIEDSRICHTER_ID),
        field,
        id=f"a referee's {field}",
    )
    for field in REFEREE_PRIVILEGED
]


@pytest.mark.db
@pytest.mark.parametrize(("path", "key", "document_id", "field"), SINGLE_CASES)
def test_the_single_read_moved_with_its_list(seeded_url: str, path: str, key: str, document_id: str, field: str):
    """`GET /{id}` serves one row of what the list serves, so a tier decision reaching only the list would decide nothing."""

    document = answered(seeded_url, path, ADMIN_AUTH, selection_timeout_ms=CONTAINER_SELECTION_MS).json()[key]

    assert document["id"] == document_id
    assert field in document


@pytest.mark.db
def test_the_admin_read_carries_what_the_match_editor_prefills_a_fixture_from(seeded_url: str):
    """The values the venue and referee pickers copy onto a fixture; without them the editor offers what it cannot book."""

    venue = answered(seeded_url, SPIELORTE, ADMIN_AUTH, selection_timeout_ms=CONTAINER_SELECTION_MS).json()["spielorte"][0]
    referees = answered(seeded_url, SCHIEDSRICHTER, ADMIN_AUTH, selection_timeout_ms=CONTAINER_SELECTION_MS).json()["schiedsrichter"]

    assert (venue["default_mietpreis"], venue["maps_link"]) == (MIETPREIS, MAPS_LINK)
    assert (referees[0]["default_payment"], referees[0]["schule"]) == (LOWER_PAYMENT, SCHULE)
    assert referees[0]["kontakt"]["telefon"] == TELEFON


@pytest.mark.db
def test_the_street_address_is_still_public_through_the_maps_link(empty_url: str):
    """`READ-ADDRESS-001`: the parts are admin-tier because `maps_link` already carries them.

    COMPOSED here rather than seeded, so the equality holds
    `app/api/spielorte/admin_router.py :: _maps_link` and not a string this file wrote.
    """

    creation = created(empty_url, POSTED_VENUE, selection_timeout_ms=CONTAINER_SELECTION_MS, database_name=CREATED_VENUE_DATABASE)
    assert creation.status_code == 201, creation.json()

    path = f"{SPIELORTE}/{creation.json()['created_id']}"
    read_back = answered(empty_url, path, ADMIN_AUTH, selection_timeout_ms=CONTAINER_SELECTION_MS, database_name=CREATED_VENUE_DATABASE)

    assert read_back.json()["spielort"]["maps_link"] == COMPOSED_MAPS_LINK


@pytest.mark.db
def test_the_fee_still_filters_and_sorts(seeded_url: str):
    """Both query terms stay where the response carries the field they name, which is the whole of what makes them honest."""

    sorted_response = answered(
        seeded_url,
        f"{SCHIEDSRICHTER}?sort_by=default_payment&order=desc",
        ADMIN_AUTH,
        selection_timeout_ms=CONTAINER_SELECTION_MS,
    )
    filtered_response = answered(
        seeded_url,
        f"{SCHIEDSRICHTER}?default_payment={HIGHER_PAYMENT}",
        ADMIN_AUTH,
        selection_timeout_ms=CONTAINER_SELECTION_MS,
    )

    assert [row["default_payment"] for row in sorted_response.json()["schiedsrichter"]] == [HIGHER_PAYMENT, LOWER_PAYMENT]
    assert [row["name"] for row in filtered_response.json()["schiedsrichter"]] == ["Bea Lang"]
