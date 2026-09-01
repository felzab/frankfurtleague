import asyncio
from typing import Any, Awaitable, Callable, Iterator

import pytest
from bson import ObjectId
from fastapi.routing import APIRoute
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.api.saisons.cache import invalidate_saison_cache
from app.api.spiele.admin_router import get_spiel_for_admin, get_spiele_for_admin
from app.api.spiele.router import get_spiele
from app.api.spiele.schemas import FLSpieleFilterParams
from app.api.spieltage.admin_router import get_spieltag_for_admin, get_spieltage_for_admin
from app.api.spieltage.router import get_spieltage
from app.api.spieltage.schemas import FLSpieltageFilterParams
from app.api.teams.admin_router import get_teams_for_admin
from app.api.teams.router import get_teams
from app.api.teams.schemas import FLTeamsFilterParams
from app.core.collections import Collection
from app.core.exceptions import DocumentNotFoundException
from app.core.security import verify_access_admin, verify_access_base, verify_access_system
from app.main import create_app
from tests.config import build_test_config
from tests.database import a_clean_database

from .conftest import unwritten

DATABASE_NAME = "fl_saison_contents_admin_read_test"

ARCHIVED = "2024"
RUNNING = "2025"
PLANNED = "2026"

STATUS_OF = {ARCHIVED: "past", RUNNING: "active", PLANNED: "future"}

# One group per season, so a club read back NAMES the season the read resolved: the club document is
# season-independent and the junction row is not.
GRUPPE_OF = {ARCHIVED: "A", RUNNING: "B", PLANNED: "C"}
SAISON_OF_GRUPPE = {gruppe: saison_id for saison_id, gruppe in GRUPPE_OF.items()}

# `get_spiele` takes the day as an argument; only `spiel_status` reads it, and no test here sets one.
TODAY = "2026-03-20"

TEAM_OID = ObjectId("6890a1b2c3d4e5f607260001")


def an_id(kind: str, saison_id: str) -> ObjectId:
    """One id per document per season, so a failure names the same document every run."""

    return ObjectId(f"6890a1b2c3d4e5f6072{kind}{saison_id}")


def saison_document(saison_id: str) -> dict[str, Any]:
    """Complete, because a season read anywhere below is validated on the way back out."""

    return {
        "_id": saison_id,
        "start_date": f"{saison_id}-01-01",
        "end_date": f"{saison_id}-06-30",
        "status": STATUS_OF[saison_id],
        "rules": {
            "win_points": 3,
            "draw_points": 1,
            "qualifiers_per_group": 2,
            "number_of_groups": 4,
            "teams_per_group": 4,
            "tiebreak_order": "tordifferenz",
            "max_kadergroesse": 18,
            "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
            "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
        },
    }


def team_document() -> dict[str, Any]:
    """One club, entered in all three seasons: the same id has to read differently per season."""

    return {
        "_id": TEAM_OID,
        "name": "Helmholtz",
        "shorthand": "HG",
        "description": "",
        "full_name": "Helmholtz-Gymnasium",
        "website_url": "https://helmholtz.example.de",
        "address": {
            "strasse": "Hanauer Landstraße",
            "hausnummer": "12a",
            "plz": "60314",
            "stadtteil": "Ostend",
            "stadt": "Frankfurt am Main",
        },
        "inactive_since": None,
    }


def junction_row(saison_id: str) -> dict[str, Any]:
    """A dict rather than a model: `saison_teams` has no model of the row."""

    return {
        "saison_id": saison_id,
        "team_id": TEAM_OID,
        "gruppe": GRUPPE_OF[saison_id],
        "austritt": None,
        "name": "Helmholtz",
        "shorthand": "HG",
    }


def spiel_document(saison_id: str) -> dict[str, Any]:
    return {
        "_id": an_id("2", saison_id),
        "spiel_nr": 1,
        "saison_id": saison_id,
        "saison_phase": "gruppenphase",
        "spieltag_id": an_id("3", saison_id),
        "team1": {"team_id": TEAM_OID, "name": "Helmholtz", "shorthand": "HG", "tore": None},
        "team2": None,
        "team1_quelle": None,
        "team2_quelle": None,
        "datum": f"{saison_id}-03-15",
        "uhrzeit": "14:00:00",
        "ort": None,
        "schiedsrichter": None,
        "ergebnis": None,
        "elfmeterschiessen": None,
        "sonderereignis": None,
        "notiz": None,
    }


def spieltag_document(saison_id: str) -> dict[str, Any]:
    """Undated, which is how the draw writes one: dating it is what the admin editor opens it for."""

    return {
        "_id": an_id("3", saison_id),
        "beginn": None,
        "ende": None,
        "position": 1,
        "saison_phase": "gruppenphase",
        "saison_id": saison_id,
    }


Body = Callable[[AsyncIOMotorDatabase], Awaitable[Any]]


# Module-scoped: every case below reads this corpus and none writes it, which `unwritten` keeps
# from being left as a claim.
@pytest.fixture(scope="module")
def seeded_league(mongo_replica_set_url: str) -> Iterator[str]:
    """Three seasons, one club entered in each under a group of its own, and a fixture and a matchday per season."""

    async def _seed() -> None:
        async with a_clean_database(mongo_replica_set_url, DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_many([saison_document(saison_id) for saison_id in STATUS_OF])
            await database[Collection.TEAMS].insert_one(team_document())
            await database[Collection.SAISON_TEAMS].insert_many([junction_row(saison_id) for saison_id in STATUS_OF])
            await database[Collection.SPIELE].insert_many([spiel_document(saison_id) for saison_id in STATUS_OF])
            await database[Collection.SPIELTAGE].insert_many([spieltag_document(saison_id) for saison_id in STATUS_OF])

    asyncio.run(_seed())

    with unwritten(mongo_replica_set_url, DATABASE_NAME):
        yield mongo_replica_set_url


def on_a_league(url: str, body: Body) -> Any:
    """One client and event loop per call: Motor binds to the loop it first ran on."""

    async def _run() -> Any:
        client = AsyncIOMotorClient(url)
        try:
            # Process-global and keyed by season id, so an entry another test left would answer here.
            invalidate_saison_cache()

            return await body(client[DATABASE_NAME])
        finally:
            client.close()

    return asyncio.run(_run())


def raised_by(url: str, body: Body) -> DocumentNotFoundException:
    """The refusal a read answered with, so a test asserts on its status rather than only that it refused."""

    async def _catching(database: AsyncIOMotorDatabase) -> DocumentNotFoundException:
        with pytest.raises(DocumentNotFoundException) as refusal:
            await body(database)

        return refusal.value

    return on_a_league(url, _catching)


async def admin_teams(database: AsyncIOMotorDatabase, saison_id: str) -> Any:
    return await get_teams_for_admin(
        teams_collection=database[Collection.TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        filters=FLTeamsFilterParams(saison_id=saison_id),
    )


async def admin_spiele(database: AsyncIOMotorDatabase, saison_id: str) -> Any:
    return await get_spiele_for_admin(
        spiele_collection=database[Collection.SPIELE],
        saisons_collection=database[Collection.SAISONS],
        filters=FLSpieleFilterParams(saison_id=saison_id),
        today=TODAY,
    )


async def admin_spieltage(database: AsyncIOMotorDatabase, saison_id: str) -> Any:
    return await get_spieltage_for_admin(
        spieltage_collection=database[Collection.SPIELTAGE],
        saisons_collection=database[Collection.SAISONS],
        filters=FLSpieltageFilterParams(saison_id=saison_id),
    )


async def admin_spieltag(database: AsyncIOMotorDatabase, saison_id: str) -> Any:
    return await get_spieltag_for_admin(
        spieltag_id=an_id("3", saison_id),
        spieltage_collection=database[Collection.SPIELTAGE],
        saisons_collection=database[Collection.SAISONS],
    )


async def base_teams(database: AsyncIOMotorDatabase, saison_id: str) -> Any:
    return await get_teams(
        teams_collection=database[Collection.TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        filters=FLTeamsFilterParams(saison_id=saison_id),
    )


async def base_spiele(database: AsyncIOMotorDatabase, saison_id: str) -> Any:
    return await get_spiele(
        spiele_collection=database[Collection.SPIELE],
        saisons_collection=database[Collection.SAISONS],
        filters=FLSpieleFilterParams(saison_id=saison_id),
        today=TODAY,
    )


async def base_spieltage(database: AsyncIOMotorDatabase, saison_id: str) -> Any:
    return await get_spieltage(
        spieltage_collection=database[Collection.SPIELTAGE],
        saisons_collection=database[Collection.SAISONS],
        filters=FLSpieltageFilterParams(saison_id=saison_id),
    )


Read = Callable[[AsyncIOMotorDatabase, str], Awaitable[Any]]
Served = Callable[[Any], list[str]]

# Each read paired with the season ids its answer proves it resolved. Parametrised rather than rolled
# into one case, so a read that goes missing or resolves the wrong season names itself.
ADMIN_READS_OF_A_SEASON: list[tuple[str, Read, Served]] = [
    ("its squads", admin_teams, lambda response: [SAISON_OF_GRUPPE[team.gruppe] for team in response.teams]),
    ("its fixtures", admin_spiele, lambda response: [spiel.saison_id for spiel in response.spiele]),
    ("its matchdays", admin_spieltage, lambda response: [spieltag.saison_id for spieltag in response.spieltage]),
    ("one of its matchdays by id", admin_spieltag, lambda response: [response.spieltag.saison_id]),
]

ADMIN_READ_IDS = [label for label, _, _ in ADMIN_READS_OF_A_SEASON]

PAIRED_TIERS: list[tuple[str, Read, Read]] = [
    ("squad list", admin_teams, base_teams),
    ("fixture list", admin_spiele, base_spiele),
    ("matchday list", admin_spieltage, base_spieltage),
]

PAIRED_IDS = [label for label, _, _ in PAIRED_TIERS]


@pytest.mark.db
@pytest.mark.parametrize("label,read,served", ADMIN_READS_OF_A_SEASON, ids=ADMIN_READ_IDS)
def test_the_admin_tier_reads_a_planned_seasons_contents_in_full(label: str, read: Read, served: Served, seeded_league: str):
    """What these endpoints exist for: a season is drawn and staffed while it is still `future`."""

    assert served(on_a_league(seeded_league, lambda database: read(database, PLANNED))) == [PLANNED]


@pytest.mark.db
@pytest.mark.parametrize("saison_id", [ARCHIVED, RUNNING])
@pytest.mark.parametrize("label,read,served", ADMIN_READS_OF_A_SEASON, ids=ADMIN_READ_IDS)
def test_the_admin_tier_reads_a_readable_season_as_the_season_it_named(
    label: str, read: Read, served: Served, saison_id: str, seeded_league: str
):
    """Non-vacuity: without it a read hardwired to one season would pass the case above."""

    assert served(on_a_league(seeded_league, lambda database: read(database, saison_id))) == [saison_id]


@pytest.mark.db
@pytest.mark.parametrize("saison_id", [ARCHIVED, RUNNING])
@pytest.mark.parametrize("label,admin_read,base_read", PAIRED_TIERS, ids=PAIRED_IDS)
def test_the_admin_read_answers_exactly_what_the_base_read_answers(
    label: str, admin_read: Read, base_read: Read, saison_id: str, seeded_league: str
):
    """The gate is meant to be the ONLY difference, so on a season the base tier may read the two agree field for field."""

    async def body(database: AsyncIOMotorDatabase) -> tuple[Any, Any]:
        return (await admin_read(database, saison_id)).model_dump(), (await base_read(database, saison_id)).model_dump()

    admin_answer, base_answer = on_a_league(seeded_league, body)

    assert admin_answer == base_answer


@pytest.mark.db
class TestTheBaseTierStillSeesNoneOfThePlannedSeason:
    """The contrast these admin reads exist to make possible: adding them must not have reopened the gate."""

    def test_its_squads_are_still_refused(self, seeded_league: str):
        assert raised_by(seeded_league, lambda database: base_teams(database, PLANNED)).status_code == 404

    def test_its_matchdays_are_still_refused(self, seeded_league: str):
        assert raised_by(seeded_league, lambda database: base_spieltage(database, PLANNED)).status_code == 404

    def test_its_fixtures_still_list_as_nothing(self, seeded_league: str):
        """Empty rather than a refusal: an id naming no season already lists nothing there."""

        assert on_a_league(seeded_league, lambda database: base_spiele(database, PLANNED)).spiele == []


APP = create_app(build_test_config())

SLICE_GUARDS: set[Callable[..., Any]] = {verify_access_base, verify_access_admin, verify_access_system}

# The three resources whose season-scoped base reads the gate closed. `/saisons` is not one: what it
# narrows is the season LIST, which is a read of the resource rather than of a season's contents.
GATED_PREFIXES = ("/api/v0/teams/", "/api/v0/spiele/", "/api/v0/spieltage/")


def routes_in_matching_order(router: Any) -> Iterator[APIRoute]:
    """Depth-first: FastAPI wraps an included router rather than splicing it in, and matching descends into that wrapper in place."""

    for route in router.routes:
        included = getattr(route, "original_router", None)
        if included is not None:
            yield from routes_in_matching_order(included)
        elif isinstance(route, APIRoute):
            yield route


ROUTES = list(routes_in_matching_order(APP.router))

# Concrete ids, never `{spieltag_id}`: what is asked here is which route a REQUEST lands on, and a
# literal segment reaching an id route is the failure these paths are shaped to rule out.
ADMIN_TIER_ROUTES: list[tuple[str, Callable[..., Any]]] = [
    ("/api/v0/teams/list/admin", get_teams_for_admin),
    ("/api/v0/spiele/list/admin", get_spiele_for_admin),
    ("/api/v0/spieltage/list/admin", get_spieltage_for_admin),
    (f"/api/v0/spieltage/{an_id('3', PLANNED)}/admin", get_spieltag_for_admin),
    (f"/api/v0/spiele/{an_id('2', PLANNED)}/admin", get_spiel_for_admin),
]

ADMIN_TIER_ROUTE_IDS = [endpoint.__name__ for _, endpoint in ADMIN_TIER_ROUTES]


def answering(path: str) -> APIRoute | None:
    """The route a `GET path` reaches, found as Starlette finds it: the first whose pattern takes the whole path."""

    for route in ROUTES:
        if "GET" in (route.methods or set()) and route.path_regex.match(path):
            return route

    return None


def guards_of(route: APIRoute) -> set[Callable[..., Any]]:
    """`set[Callable]` rather than `set[object]`: `set` is invariant, so the narrower element type is not assignable."""

    return {dependency.call for dependency in route.dependant.dependencies if dependency.call is not None} & SLICE_GUARDS


@pytest.mark.parametrize("path,endpoint", ADMIN_TIER_ROUTES, ids=ADMIN_TIER_ROUTE_IDS)
def test_each_admin_tier_read_is_the_route_that_answers_its_path(path: str, endpoint: Callable[..., Any]):
    route = answering(path)

    assert route is not None, f"GET {path} reaches no route at all -- the admin surface asking for it gets a 404"
    assert route.endpoint is endpoint, (
        f"GET {path} is answered by {route.endpoint.__name__}, not {endpoint.__name__} -- another route takes it first"
    )


@pytest.mark.parametrize("path,endpoint", ADMIN_TIER_ROUTES, ids=ADMIN_TIER_ROUTE_IDS)
def test_each_admin_tier_read_carries_the_admin_guard_and_only_that(path: str, endpoint: Callable[..., Any]):
    """A guard is the ROUTER's (`docs/backend/spec.md :: I7`), so this fails the moment one is declared on the base router instead."""

    route = answering(path)

    assert route is not None, f"GET {path} reaches no route at all"
    assert guards_of(route) == {verify_access_admin}, f"GET {path} carries {guards_of(route)}"


def test_the_inventory_names_every_admin_tier_read_of_a_seasons_contents():
    """Derived from the app, so a read added to one of these routers is covered by the cases above rather than silently missed."""

    mounted = {
        route.path
        for route in ROUTES
        if "GET" in (route.methods or set()) and route.path.endswith("/admin") and route.path.startswith(GATED_PREFIXES)
    }
    covered = {route.path for route in (answering(path) for path, _ in ADMIN_TIER_ROUTES) if route is not None}

    assert covered == mounted
