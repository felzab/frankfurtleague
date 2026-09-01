import asyncio
from collections.abc import Iterator, Mapping
from typing import Any

import pytest
from bson import ObjectId
from httpx import ASGITransport, AsyncClient, Response
from pydantic import BaseModel
from pymongo import AsyncMongoClient, MongoClient

from app.api.saisons.cache import invalidate_saison_cache
from app.api.spiele.schemas import (
    FLSpiel,
    FLSpielJoined,
    FLSpielJoinedAdmin,
    FLSpielJoinedInternal,
    FLSpielOrtField,
    FLSpielOrtFieldPublic,
    FLSpielSchiedsrichterField,
    FLSpielSchiedsrichterFieldPublic,
    FLSpielTeamFieldJoined,
    FLSpielTeamFieldJoinedInternal,
)
from app.api.teams.schemas import FLTeam
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.constraints import COLLECTION_VALIDATORS
from app.main import create_app
from tests.config import TEST_BASE_URL, build_test_config
from tests.database import a_clean_database_sync

ADMIN_AUTH = {"Authorization": "Bearer test-key-admin"}
BASE_AUTH = {"Authorization": "Bearer test-key-base"}

# The two figures `READ-MONEY-001` keeps off the base tier, spelled as a DOCUMENT spells them: the
# assertions below search decoded bodies by key, where a model's field name would not match.
MIETPREIS_KEY = "mietpreis"
PAYMENT_KEY = "payment"
MONEY_KEYS = frozenset({MIETPREIS_KEY, PAYMENT_KEY})

# What `docs/backend/spec.md :: I32` keeps off a served fixture side: the free text naming a school and the day it took
# effect. Spelled as a DOCUMENT spells them, for `MONEY_KEYS`' reason.
AUSTRITT_DETAIL_KEYS = frozenset({"grund", "datum"})
AUSTRITT_TYPE_KEY = "austritt_type"

# Searched per SIDE rather than over the whole body: a fixture's own `datum` shares its name with a
# withdrawal's, so a body-wide search for that key could never fail.
SIDES = ("team1", "team2")

SAISON_ID = "2026"

# Fixed rather than generated, so a failure names the same fixture every run.
SPIEL_ID = ObjectId("6890a1b2c3d4e5f607240001")
SPIELTAG_ID = ObjectId("6890a1b2c3d4e5f6072400a1")
HOME = ObjectId("6890a1b2c3d4e5f607240011")
AWAY = ObjectId("6890a1b2c3d4e5f607240012")
SPIELORT_ID = ObjectId("6890a1b2c3d4e5f607240021")
SCHIEDSRICHTER_ID = ObjectId("6890a1b2c3d4e5f607240022")

MIETPREIS = 80
PAYMENT = 30

SPIELORT_NAME = "Sportplatz Ost"
SCHIEDSRICHTER_NAME = "Ada Kern"

LIST_PATH = f"/api/v{API_VERSION}/spiele"
SINGLE_PATH = f"{LIST_PATH}/{SPIEL_ID}"
ADMIN_PATH = f"{SINGLE_PATH}/admin"

# Ample for a container already accepting connections. The short timeout belongs to the refusal
# paths in `fl_backend/tests/api/test_spiele_admin_read.py`, which never reach a database.
CONTAINER_SELECTION_MS = 10_000

AUSTRITT = {"type": "disqualifikation", "grund": "Nicht angetreten zum Spieltag", "datum": "2026-03-14"}


def stored_document() -> dict[str, Any]:
    """The fixture as `spiele` holds it: both figures present, and no `austritt`, which a read joins on."""

    return {
        "_id": SPIEL_ID,
        "spiel_nr": 1,
        "saison_id": SAISON_ID,
        "saison_phase": "gruppenphase",
        "spieltag_id": SPIELTAG_ID,
        "team1": {"team_id": HOME, "name": "Alpha", "shorthand": "AL", "tore": 2},
        "team2": {"team_id": AWAY, "name": "Beta", "shorthand": "BE", "tore": 1},
        "team1_quelle": None,
        "team2_quelle": None,
        "datum": "2026-03-15",
        "uhrzeit": "14:00:00",
        "ort": {"spielort_id": SPIELORT_ID, "name": SPIELORT_NAME, "maps_link": "Sportplatz Ost, Frankfurt", "mietpreis": MIETPREIS},
        "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER_ID, "name": SCHIEDSRICHTER_NAME, "payment": PAYMENT},
        "ergebnis": "2:1",
        "elfmeterschiessen": None,
        "sonderereignis": None,
        "notiz": None,
    }


def joined_document() -> dict[str, Any]:
    """The same fixture as `build_spiele_pipeline` hands it to a read model: each side merged with BOTH spellings of its withdrawal.

    Derived from `stored_document` rather than spelled a second time, so the money on this raw dict
    is the money a write stored.
    """

    document = stored_document()

    return {
        **document,
        "team1": {**document["team1"], "austritt": None, AUSTRITT_TYPE_KEY: None},
        "team2": {**document["team2"], "austritt": dict(AUSTRITT), AUSTRITT_TYPE_KEY: AUSTRITT["type"]},
    }


def team_document() -> dict[str, Any]:
    """The AWAY club as `build_team_pipeline` serves it to a club's own page: the junction's record joined on whole."""

    return {
        "_id": AWAY,
        "name": "Beta",
        "shorthand": "BE",
        "full_name": "Beta-Schule Frankfurt",
        "description": "",
        "website_url": "https://beta.example.org",
        "address": {"strasse": "Beispielweg", "hausnummer": "1", "plz": "60311", "stadtteil": "Innenstadt", "stadt": "Frankfurt"},
        "gruppe": "A",
        "statistik": {},
        "austritt": dict(AUSTRITT),
        "inactive_since": None,
    }


def junction_row() -> dict[str, Any]:
    """A dict rather than a model: `saison_teams` has no model of the row."""

    return {"saison_id": SAISON_ID, "team_id": AWAY, "gruppe": "A", "austritt": dict(AUSTRITT), "name": "Beta", "shorthand": "BE"}


def keys_anywhere(payload: Any) -> set[str]:
    """Every mapping key at every depth of a decoded body or a model dump.

    Recursive rather than a lookup at one path: what is asserted is that a figure reaches NO part of
    the answer, and a per-path check proves only the paths somebody thought of.
    """

    if isinstance(payload, Mapping):
        return set(payload) | {key for value in payload.values() for key in keys_anywhere(value)}

    if isinstance(payload, list):
        return {key for item in payload for key in keys_anywhere(item)}

    return set()


def keys_under(payload: Any, field: str) -> set[str]:
    """Every mapping key at every depth BENEATH any `field` key, wherever one is nested.

    Scoped where `keys_anywhere` is not: a fixture's own `datum` shares its name with a
    withdrawal's, so a body-wide search for that key could never fail.
    """

    if isinstance(payload, Mapping):
        nested = {key for value in payload.values() for key in keys_under(value, field)}
        return nested | keys_anywhere(payload.get(field))

    if isinstance(payload, list):
        return {key for item in payload for key in keys_under(item, field)}

    return set()


def answered(uri: str, path: str, headers: Mapping[str, str]) -> Response:
    """One request per client, the request and the close on ONE loop.

    Both halves for the reason `fl_backend/tests/api/test_malformed_ids.py :: answered` gives, no
    lifespan included.
    """

    async def _answered() -> Response:
        app = create_app(build_test_config())
        app.state.db_client = AsyncMongoClient(host=uri, serverSelectionTimeoutMS=CONTAINER_SELECTION_MS)

        try:
            transport = ASGITransport(app=app, raise_app_exceptions=False)
            async with AsyncClient(transport=transport, base_url=TEST_BASE_URL) as http:
                return await http.get(path, headers=dict(headers))
        finally:
            await app.state.db_client.close()

    return asyncio.run(_answered())


@pytest.fixture
def seeded_url(mongo_container: Any) -> Iterator[str]:
    """The fixture and its junction row, in the database `build_test_config` names -- the one the app resolves its collections from."""

    url = str(mongo_container.get_connection_url())
    database_name = build_test_config().db_base_name

    client = MongoClient(url)
    try:
        database = a_clean_database_sync(client, url, database_name)
        invalidate_saison_cache()
        database[Collection.SPIELE].insert_one(stored_document())
        database[Collection.SAISON_TEAMS].insert_one(junction_row())

        yield url
    finally:
        client.close()


# The whole membership of each base-tier embedded shape, so a field added to one is named here or
# fails. The admin twin inherits it, which is why a relation between the two cannot stand in.
PUBLIC_EMBEDDED_FIELDS = [
    pytest.param(FLSpielOrtFieldPublic, frozenset({"spielort_id", "name", "maps_link"}), id="the venue"),
    pytest.param(FLSpielSchiedsrichterFieldPublic, frozenset({"schiedsrichter_id", "name"}), id="the referee"),
]

# (the base-tier shape, the money-bearing shape it is narrowed from, the figure separating the two).
EMBEDDED_PAIRS = [
    pytest.param(FLSpielOrtFieldPublic, FLSpielOrtField, MIETPREIS_KEY, id="the venue"),
    pytest.param(FLSpielSchiedsrichterFieldPublic, FLSpielSchiedsrichterField, PAYMENT_KEY, id="the referee"),
]


class TestTheEmbeddedShapes:
    """Which of the two figures each embedded model declares, read off `model_fields` rather than off an instance."""

    @pytest.mark.parametrize(("public_model", "admin_model", "money"), EMBEDDED_PAIRS)
    def test_the_base_tier_shape_declares_no_figure(self, public_model: type[BaseModel], admin_model: type[BaseModel], money: str):
        """The claim in its narrowest form: the field is absent from the declaration, so no read through it can serve one."""

        assert money not in public_model.model_fields

    @pytest.mark.parametrize(("public_model", "admin_model", "money"), EMBEDDED_PAIRS)
    def test_the_money_bearing_shape_still_declares_it(self, public_model: type[BaseModel], admin_model: type[BaseModel], money: str):
        """The control for the assertion above, which a rename of either figure would otherwise satisfy on both models at once."""

        assert money in admin_model.model_fields

    @pytest.mark.parametrize(("public_model", "public_fields"), PUBLIC_EMBEDDED_FIELDS)
    def test_the_base_tier_shape_declares_exactly_these_fields(self, public_model: type[BaseModel], public_fields: frozenset[str]):
        """An allow-list is one only while its whole membership is pinned.

        A subset relation against the admin model cannot do it: that model inherits this one, so a
        field added here propagates there and the relation survives unchanged.
        """

        assert set(public_model.model_fields) == public_fields


class TestTheJoinedSideShapes:
    """Which spelling of a withdrawal each side model declares, read off `model_fields` rather than off an instance."""

    def test_the_served_side_declares_no_record(self):
        """The claim in its narrowest form: a free-text reason is absent from the declaration, so no read through it can serve one."""

        assert "austritt" not in FLSpielTeamFieldJoined.model_fields

    def test_the_served_side_still_names_the_route_out(self):
        """The control for the assertion above, which a side dropping the withdrawal entirely would satisfy.

        A withdrawal reported as a disqualification is the untruth the neutral record prevents, and
        the type tells them apart.
        """

        assert AUSTRITT_TYPE_KEY in FLSpielTeamFieldJoined.model_fields

    def test_the_internal_side_still_declares_the_record(self):
        """The other end of the split: one document, two models, and only the walk's own shape reads the record out of it."""

        assert "austritt" in FLSpielTeamFieldJoinedInternal.model_fields

    def test_the_served_side_declares_exactly_these_fields(self):
        """The served side's whole membership, since the internal shape inherits it.

        A subset relation would survive a field added here, because it would propagate to the shape
        it is being compared against.
        """

        assert set(FLSpielTeamFieldJoined.model_fields) == {"team_id", "name", "shorthand", "tore", "austritt_type"}


class TestTheFixtureShapes:
    """What survives validation of ONE raw document through each fixture model -- the step that drops the figures."""

    def test_the_raw_document_carries_both_figures(self):
        """The control for this whole class: without it, every absence below would pass on a document that never held them."""

        assert MONEY_KEYS <= keys_anywhere(joined_document())

    def test_the_base_tier_fixture_drops_both(self):
        """`FLSpielJoined` is what `GET /spiele` and `GET /spiele/{spiel_id}` answer with, and Pydantic ignores an undeclared key."""

        dumped = FLSpielJoined.model_validate(joined_document()).model_dump()

        assert MONEY_KEYS & keys_anywhere(dumped) == set()

    def test_the_base_tier_fixture_still_carries_what_a_card_renders(self):
        """Without it, a shape that dropped the venue and the referee entirely would satisfy the assertion above."""

        parsed = FLSpielJoined.model_validate(joined_document())

        assert parsed.ort is not None and parsed.ort.name == SPIELORT_NAME
        assert parsed.schiedsrichter is not None and parsed.schiedsrichter.name == SCHIEDSRICHTER_NAME

    def test_the_admin_fixture_keeps_both(self):
        """The other end of the split: one document, two models, and only `FLSpielJoinedAdmin` reads the figures out of it."""

        parsed = FLSpielJoinedAdmin.model_validate(joined_document())

        assert parsed.ort is not None and parsed.ort.mietpreis == MIETPREIS
        assert parsed.schiedsrichter is not None and parsed.schiedsrichter.payment == PAYMENT

    def test_the_raw_document_carries_the_whole_withdrawal(self):
        """The control for the cases below: without it, every absence would pass on a document that never held a reason."""

        assert AUSTRITT_DETAIL_KEYS <= keys_under(joined_document(), "team2")

    def test_the_base_tier_fixture_drops_the_reason_and_the_day(self):
        """`FLSpielJoined` is what `GET /spiele` and `GET /spiele/{spiel_id}` answer with, and Pydantic ignores an undeclared key."""

        dumped = FLSpielJoined.model_validate(joined_document()).model_dump()

        for side in SIDES:
            assert AUSTRITT_DETAIL_KEYS & keys_under(dumped, side) == set()

    def test_the_base_tier_fixture_still_says_which_way_the_club_left(self):
        """Without it, a shape that dropped the withdrawal entirely would satisfy the assertion above."""

        parsed = FLSpielJoined.model_validate(joined_document())

        assert parsed.team2 is not None and parsed.team2.austritt_type == AUSTRITT["type"]
        assert parsed.team1 is not None and parsed.team1.austritt_type is None

    def test_the_admin_fixture_drops_them_too(self):
        """No fixture response carries a reason: the money is withheld by TIER, and the withdrawal is narrowed on every tier at once."""

        dumped = FLSpielJoinedAdmin.model_validate(joined_document()).model_dump()

        for side in SIDES:
            assert AUSTRITT_DETAIL_KEYS & keys_under(dumped, side) == set()

    def test_the_walks_own_fixture_keeps_the_record(self):
        """`find_departed_occupants` orders a fault on the day a club left, so the shape it reads still carries the record whole."""

        parsed = FLSpielJoinedInternal.model_validate(joined_document())

        assert parsed.team2 is not None and parsed.team2.austritt is not None
        assert (parsed.team2.austritt.grund, parsed.team2.austritt.datum) == (AUSTRITT["grund"], AUSTRITT["datum"])


class TestThePageThatPublishesTheWithdrawal:
    """`FLTeam`, which a club's OWN page reads: the narrowing moves nothing, it only stops the copies travelling."""

    def test_the_club_page_read_still_carries_the_whole_record(self):
        """The other end of the whole change: the reason and the day are published, on the one surface that renders them."""

        parsed = FLTeam.model_validate(team_document())

        assert parsed.austritt is not None
        assert (parsed.austritt.type, parsed.austritt.grund, parsed.austritt.datum) == (
            AUSTRITT["type"],
            AUSTRITT["grund"],
            AUSTRITT["datum"],
        )


class TestTheStoredShape:
    """`FLSpiel`, which is on no endpoint and whose dump every write `$set`s wholesale."""

    @pytest.mark.parametrize(
        ("embedded", "money", "amount"),
        [("ort", MIETPREIS_KEY, MIETPREIS), ("schiedsrichter", PAYMENT_KEY, PAYMENT)],
        ids=["the venue", "the referee"],
    )
    def test_the_dump_a_save_writes_carries_every_key_the_validator_requires(self, embedded: str, money: str, amount: int):
        """Guards the re-declaration on `fl_backend/app/api/spiele/schemas.py :: FLSpiel`, whose docstring holds the reason.

        Required keys are read off `COLLECTION_VALIDATORS` rather than listed here, so the model and
        the database's own demand move together.
        """

        dumped = FLSpiel.model_validate(stored_document()).model_dump()[embedded]
        required = set(COLLECTION_VALIDATORS[Collection.SPIELE]["$jsonSchema"]["properties"][embedded]["required"])

        assert required <= set(dumped)
        assert dumped[money] == amount


BASE_TIER_CASES = [
    pytest.param(f"{LIST_PATH}?saison_id={SAISON_ID}", id="the list"),
    pytest.param(SINGLE_PATH, id="one fixture"),
]


@pytest.mark.db
@pytest.mark.parametrize("path", BASE_TIER_CASES)
def test_no_base_tier_body_carries_either_figure_at_any_depth(seeded_url: str, path: str):
    """The serialised answer to a real request, which is the only thing the wire is actually bound by.

    `saison_id` is passed rather than resolved, so the list does not depend on a seeded season.
    """

    response = answered(seeded_url, path, BASE_AUTH)

    assert response.status_code == 200
    keys = keys_anywhere(response.json())

    assert MONEY_KEYS & keys == set(), f"{path} served {sorted(MONEY_KEYS & keys)}"
    # Non-vacuous: both records ARE in the body, so what is asserted above is what they carry rather
    # than an empty result or a venue nothing served.
    assert {"spielort_id", "schiedsrichter_id"} <= keys


@pytest.mark.db
@pytest.mark.parametrize("path", BASE_TIER_CASES)
def test_no_base_tier_body_carries_a_withdrawal_reason_or_day_at_any_depth(seeded_url: str, path: str):
    """The serialised answer to a real request, which is the only thing the wire is actually bound by.

    Every public surface listing a fixture reads this, and the free text names a school -- so a
    side carries the route out and nothing else.
    """

    response = answered(seeded_url, path, BASE_AUTH)

    assert response.status_code == 200
    body = response.json()

    for side in SIDES:
        served = AUSTRITT_DETAIL_KEYS & keys_under(body, side)
        assert served == set(), f"{path} served {sorted(served)} under {side}"

    # Searched as VALUES over the undecoded body as well: a key RENAMED on the way out satisfies the
    # structural check above and publishes both all the same.
    assert AUSTRITT["grund"] not in response.text
    assert AUSTRITT["datum"] not in response.text

    # Non-vacuous, in both directions: the club that left is still marked, and by the route it took
    # rather than by a boolean -- so what is asserted above is a narrowing rather than an empty body.
    assert AUSTRITT_TYPE_KEY in keys_anywhere(body)
    assert AUSTRITT["type"] in response.text


@pytest.mark.db
def test_the_admin_body_carries_both_figures(seeded_url: str):
    """The control for the pair above, on the same seeded document: the figures are withheld by tier, never absent from the data."""

    response = answered(seeded_url, ADMIN_PATH, ADMIN_AUTH)

    assert response.status_code == 200
    assert MONEY_KEYS <= keys_anywhere(response.json())
