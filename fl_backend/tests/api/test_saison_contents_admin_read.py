from collections.abc import Callable
from typing import Any

import pytest
from bson import ObjectId
from fastapi.routing import APIRoute

from app.api.spiele.admin_router import get_spiel_verwaltung, get_spiele_verwaltung
from app.api.spieltage.admin_router import get_spieltag_verwaltung, get_spieltage_verwaltung
from app.api.teams.admin_router import get_teams_admin
from app.core.security import verify_access_admin, verify_access_base, verify_access_system
from tests.core.app_source import api_routes, application

PLANNED = "2026"


def an_id(kind: str, saison_id: str) -> ObjectId:
    """One id per document per season, so a failure names the same document every run."""

    return ObjectId(f"6890a1b2c3d4e5f6072{kind}{saison_id}")


SLICE_GUARDS: set[Callable[..., Any]] = {verify_access_base, verify_access_admin, verify_access_system}

# The three resources whose season-scoped base reads the gate closed. `/saisons` is not one: what it
# narrows is the season LIST, which is a read of the resource rather than of a season's contents.
GATED_PREFIXES = ("/api/v0/teams/", "/api/v0/spiele/", "/api/v0/spieltage/")


# In the order a request is matched against them: `api_routes` opens each included router's wrapper
# where it stands in `app.routes`, which is where matching descends into it.
ROUTES = list(api_routes(application()))

# Concrete ids, never `{spieltag_id}`: what is asked here is which route a REQUEST lands on, and a
# literal segment reaching an id route is the failure these paths are shaped to rule out.
ADMIN_TIER_ROUTES: list[tuple[str, Callable[..., Any]]] = [
    ("/api/v0/teams/list/admin", get_teams_admin),
    ("/api/v0/spiele/list/verwaltung", get_spiele_verwaltung),
    ("/api/v0/spieltage/list/verwaltung", get_spieltage_verwaltung),
    (f"/api/v0/spieltage/{an_id('3', PLANNED)}/verwaltung", get_spieltag_verwaltung),
    (f"/api/v0/spiele/{an_id('2', PLANNED)}/verwaltung", get_spiel_verwaltung),
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
    """A guard is the ROUTER's, so this fails the moment one is declared on the base router instead."""

    route = answering(path)

    assert route is not None, f"GET {path} reaches no route at all"
    assert guards_of(route) == {verify_access_admin}, f"GET {path} carries {guards_of(route)}"


def test_the_inventory_names_every_admin_tier_read_of_a_seasons_contents():
    """Derived from the app, so a read added to one of these routers is covered by the cases above rather than silently missed."""

    mounted = {
        route.path
        for route in ROUTES
        if "GET" in (route.methods or set()) and route.path.endswith(("/verwaltung", "/admin")) and route.path.startswith(GATED_PREFIXES)
    }
    covered = {route.path for route in (answering(path) for path, _ in ADMIN_TIER_ROUTES) if route is not None}

    # Not empty, so a suffix the routes no longer end in cannot pass by matching nothing on either side.
    assert mounted
    assert covered == mounted
