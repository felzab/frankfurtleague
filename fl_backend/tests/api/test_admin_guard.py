import re
from collections import Counter
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.api.grants.guard import verify_actor_is_admin
from app.core.codes import Code
from app.core.security import bind_actor, get_person_identifier, verify_access_admin, verify_access_base, verify_access_system
from tests.core.app_source import api_routes, application

# Module level because pytest resolves parametrisation during collection, before a fixture could run.
APP = application()

MISSING_BEARER_TOKEN = Code.ACCESS_KEY_REFUSED

HTTP_METHODS = frozenset({"get", "post", "patch", "delete", "put", "head", "options", "trace"})

SLICE_GUARDS: set[Callable[..., Any]] = {verify_access_base, verify_access_admin, verify_access_system}


# `/system/is_live` is the container healthcheck and `/system/is_ready` a monitor's: a probe that needs
# a secret fails for the wrong reasons (`app/core/security.py`).
UNGUARDED_BY_DESIGN = frozenset({"/api/v0/system/is_live", "/api/v0/system/is_ready"})

# FastAPI drops the convertor when it builds the document (`app/core/routing.py`), so
# `{spiel_id:objectid}` publishes as `{spiel_id}` and the two spellings need bringing together.
CONVERTOR_IN_PATH = re.compile(r"\{([^}:]+):[^}]+\}")


def strip_convertors(path: str) -> str:
    return CONVERTOR_IN_PATH.sub(r"{\1}", path)


# `route.methods or ()` because Starlette types it optional: the fallback is unreachable, and
# writing it is cheaper than asserting a framework's internals.
MOUNTED_OPERATIONS = [
    ((strip_convertors(route.path), method.lower()), route)
    for route in api_routes(APP)
    for method in (route.methods or ())
    if method.lower() in HTTP_METHODS
]

ROUTES_BY_OPERATION = dict(MOUNTED_OPERATIONS)

OPERATION_COUNTS = Counter(operation for operation, _ in MOUNTED_OPERATIONS)

# A dict keeps the last route written, so a shared pair drops the route that lost from every sweep
# below while `test_the_published_surface_and_the_mounted_routes_are_the_same_set` still passes.
# Module level, so collection refuses every case built on it.
assert len(ROUTES_BY_OPERATION) == len(MOUNTED_OPERATIONS), (
    f"more than one mounted route serves {sorted(operation for operation, count in OPERATION_COUNTS.items() if count > 1)}"
)

PUBLISHED_OPERATIONS = sorted(
    (path, method) for path, operations in APP.openapi()["paths"].items() for method in operations if method in HTTP_METHODS
)

# The writes a member of the public makes, which are therefore NOT admin-guarded. Enumerated rather
# than predicated, so a second public write cannot appear by inheriting a property of the first.

# `POST /bewerbungen` is the public application form, base-tier because an anonymous visitor holds
# no other key. The two cases below assert what takes the guard's place.
PUBLIC_WRITES = [
    ("/api/v0/bewerbungen", "post"),
    ("/api/v0/bewerbungen/einwilligung/view", "post"),
    ("/api/v0/bewerbungen/einwilligung", "post"),
    # A referee's own confirmation link, on a base-tier router under an otherwise admin-tier prefix:
    # the token is the whole credential, so the guard here would have no session to check.
    ("/api/v0/schiedsrichter/confirmation/view", "post"),
    ("/api/v0/schiedsrichter/confirmation", "post"),
    ("/api/v0/schiedsrichter/confirmation/decline", "post"),
    # The address change's links, the new mailbox's and the stop link, on a base-tier router of their own for the same reason.
    ("/api/v0/address_change/confirmation/view", "post"),
    ("/api/v0/address_change/confirmation", "post"),
    ("/api/v0/address_change/confirmation/stop", "post"),
    # A pupil's own confirmation link, on a third base-tier router under the registration prefix:
    # the token is the whole credential, so the guard here would have no session to check.
    ("/api/v0/registrierungen/confirmation/view", "post"),
    ("/api/v0/registrierungen/confirmation", "post"),
    # The invite's own read and the registration it leads to: a pupil holds a link and no session,
    # and the first is a POST because the link value travels in the body.
    ("/api/v0/registrierungen/invitation/view", "post"),
    ("/api/v0/registrierungen", "post"),
]

# The retention sweep's writes, made by the application to itself on the SYSTEM key: no session
# and no person, so the admin guard would have nothing to check and `bind_actor` would refuse.
SYSTEM_WRITES = [
    ("/api/v0/bewerbungen/sweep/{saison_id}", "post"),
    ("/api/v0/registrierungen/sweep/{saison_id}", "post"),
    ("/api/v0/spielbestaetigungen/sweep/{saison_id}", "post"),
    # A POST that stores nothing: the address travels in a body, so `MUTATIONS` would cover it, and
    # this exemption leaves its one guard the system tier's.
    ("/api/v0/identity/subject", "post"),
    ("/api/v0/identity/sign_in", "post"),
    ("/api/v0/identity/references", "post"),
    # The grants' comparison: the hourly pass holds no session, and a change made in the database directly has no
    # administrator to attribute it to.
    ("/api/v0/grants/handover", "post"),
    # The season-after rule, the lapsed address's clock and the unconfirmed referee's, whichever caller runs them: a
    # timer holds no session, and an activation's press deletes nobody in the administrator's name.
    ("/api/v0/identity/erasure/sweep", "post"),
    ("/api/v0/address_change/sweep", "post"),
    ("/api/v0/schiedsrichter/sweep", "post"),
    # The sign-in accounts the address changes still owe to carry, reported carried by the frontend, which holds the store.
    ("/api/v0/address_change/sweep/moves/done", "post"),
    # The Postausgang's drain, the sign-in library's mails and the provider's events: none holds a session.
    ("/api/v0/outbox/handout", "post"),
    ("/api/v0/outbox/result", "post"),
    ("/api/v0/outbox/sign_in", "post"),
    ("/api/v0/outbox/event", "post"),
    # A POST storing nothing, exempt for the identity reads' reason: the frontend's server asks a live change's new address.
    ("/api/v0/address_change/address", "post"),
]

MUTATIONS = [
    (path, method)
    for path, method in PUBLISHED_OPERATIONS
    if method != "get" and (path, method) not in PUBLIC_WRITES and (path, method) not in SYSTEM_WRITES
]


def guards_of(route: APIRoute) -> set[Callable[..., Any]]:
    """`set[Callable]` rather than `set[object]`: `set` is invariant, so the narrower element type is not assignable."""
    calls = {dependency.call for dependency in route.dependant.dependencies if dependency.call is not None}
    return calls & SLICE_GUARDS


def test_the_published_surface_and_the_mounted_routes_are_the_same_set():
    """A route mounted but unpublished is a live endpoint no case below sees; one published with no route is a 404 clients are told to call."""
    assert set(PUBLISHED_OPERATIONS) == set(ROUTES_BY_OPERATION)


# Each path parameter as a request fills it: an id where the convertor asks one, a season's year elsewhere.
PATH_PARAMETER = re.compile(r"\{[^}:]+(:[^}]+)?\}")
AN_ID = "6890a1b2c3d4e5f607182930"


def requested(path: str) -> str:
    return PATH_PARAMETER.sub(lambda parameter: AN_ID if parameter[1] else "2026", path)


def test_every_operation_is_answered_by_its_own_route():
    """Matched as Starlette matches, the first route in mount order taking the path and the method.

    What every guard case here assumes: a literal segment such as `/spieler/self/saisons` reaching a
    route mounted earlier, `/spieler/self/{saison_id}`, would be served under that route's guard.
    Not parametrised, so one failure names every shadowed operation at once.
    """

    shadowed = []
    for (path, method), route in MOUNTED_OPERATIONS:
        answering = next(
            candidate
            for _, candidate in MOUNTED_OPERATIONS
            if method.upper() in (candidate.methods or ()) and candidate.path_regex.match(requested(route.path))
        )
        if answering is not route:
            shadowed.append(f"{method.upper()} {path} is answered by {answering.path}")

    assert shadowed == []


@pytest.mark.parametrize(("path", "method"), MUTATIONS, ids=lambda value: value)
def test_every_mutation_is_admin_guarded(path: str, method: str):
    """Parametrised rather than looped, so a failure names the method and path it broke on."""
    assert verify_access_admin in guards_of(ROUTES_BY_OPERATION[(path, method)]), f"{method.upper()} {path} is not admin-guarded"


@pytest.mark.parametrize(("path", "method"), PUBLISHED_OPERATIONS, ids=lambda value: value)
def test_every_operation_carries_exactly_one_guard(path: str, method: str):
    """Two guards is not stricter than one: FastAPI runs both, and no single key satisfies two."""
    guards = guards_of(ROUTES_BY_OPERATION[(path, method)])

    if path in UNGUARDED_BY_DESIGN:
        assert guards == set(), f"{method.upper()} {path} is documented as unguarded and carries {guards}"
        return

    assert len(guards) == 1, f"{method.upper()} {path} carries {len(guards)} guards: {guards}"


# The operations a signed-in person reaches on the admin key through `get_person_identifier`, whose session
# is a person no grant names: the one exemption from the check below, by name.
PERSON_OPERATIONS: frozenset[tuple[str, str]] = frozenset(
    {
        ("/api/v0/spieler/kader/{team_id}/{saison_id}", "get"),
        ("/api/v0/spieler/kader/{team_id}/{saison_id}/{spieler_id}", "patch"),
        ("/api/v0/spieler/kader/{team_id}/{saison_id}/{spieler_id}", "delete"),
        ("/api/v0/registrierungen/kader/{team_id}/{saison_id}", "get"),
        ("/api/v0/registrierungen/{registrierung_id}/admit", "post"),
        ("/api/v0/registrierungen/{registrierung_id}/decline", "post"),
        ("/api/v0/teams/{team_id}/saisons/{saison_id}/self/overview", "get"),
        ("/api/v0/teams/{team_id}/saisons/{saison_id}/self/spiele", "get"),
        ("/api/v0/aufstellungen/{spiel_id}/{team_id}/self", "get"),
        ("/api/v0/aufstellungen/{spiel_id}/{team_id}/self", "put"),
        ("/api/v0/spieler/self/saisons", "get"),
        ("/api/v0/spieler/self/{saison_id}", "get"),
        ("/api/v0/spieler/account/einwilligung", "patch"),
        ("/api/v0/schiedsrichter/self/saisons", "get"),
        ("/api/v0/schiedsrichter/self/spiele/{saison_id}", "get"),
        ("/api/v0/schiedsrichter/account/{schiedsrichter_id}/einwilligung", "patch"),
        ("/api/v0/account/einwilligungen", "get"),
        ("/api/v0/teams/{team_id}/saisons/{saison_id}/account/einwilligung", "patch"),
        ("/api/v0/bewerbungen/{bewerbung_id}/account/einwilligung", "patch"),
        ("/api/v0/registrierungen/account/{registrierung_id}/einwilligung", "patch"),
        ("/api/v0/identity/account/erasure", "post"),
        ("/api/v0/identity/account/erasure/view", "get"),
        ("/api/v0/spielbestaetigungen/{spielbestaetigung_id}/answer", "post"),
        ("/api/v0/spielbestaetigungen/{spielbestaetigung_id}/answer/team", "post"),
        ("/api/v0/spielberichte/{spiel_id}/bericht", "get"),
        ("/api/v0/spielberichte/{spiel_id}/bericht", "put"),
        ("/api/v0/account/address_change", "get"),
        ("/api/v0/account/address_change", "post"),
        ("/api/v0/account/address_change", "delete"),
    }
)

# Derived from the guard, as every tier here is, so a router added later is swept without being listed.
ADMIN_TIER_OPERATIONS = [
    operation
    for operation in PUBLISHED_OPERATIONS
    if guards_of(ROUTES_BY_OPERATION[operation]) == {verify_access_admin} and operation not in PERSON_OPERATIONS
]


@pytest.mark.parametrize(("path", "method"), ADMIN_TIER_OPERATIONS, ids=lambda value: value)
def test_every_admin_tier_operation_judges_its_actor_after_the_key(path: str, method: str):
    """Every method, a read among them: a person's session reaches an admin read as it reaches a write.

    After the key, or a caller holding none learns from a 403 which addresses are administrators.
    """
    calls = [dependency.call for dependency in ROUTES_BY_OPERATION[(path, method)].dependant.dependencies]

    assert verify_actor_is_admin in calls, f"{method.upper()} {path} judges no actor against the grants"
    assert calls.index(verify_access_admin) < calls.index(verify_actor_is_admin), f"{method.upper()} {path} judges its actor before its key"
    # The grants check passes a request naming nobody, so without the binder that one is served.
    assert bind_actor in calls, f"{method.upper()} {path} refuses no request naming nobody"
    assert calls.index(verify_access_admin) < calls.index(bind_actor), f"{method.upper()} {path} asks for its actor before its key"


def test_every_person_operation_binds_a_person_after_the_key():
    """What earns an operation its exemption from the grants check.

    Not parametrised, so one failure names every unearned exemption at once.
    """
    unearned = []
    for operation in sorted(PERSON_OPERATIONS):
        route = ROUTES_BY_OPERATION.get(operation)
        calls = [dependency.call for dependency in route.dependant.dependencies] if route else []
        if (
            verify_access_admin not in calls
            or get_person_identifier not in calls
            or calls.index(get_person_identifier) < calls.index(verify_access_admin)
        ):
            unearned.append(operation)

    assert unearned == [], f"{unearned} is exempt from the grants check without binding a person after the admin key"


@pytest.mark.parametrize(("path", "method"), PUBLIC_WRITES, ids=lambda value: value)
def test_a_public_write_is_base_tier(path: str, method: str):
    """What stands in for the guard the exemption drops: the operation carries the BASE one and no other.

    An equality rather than a membership, so a route that lost its guard -- or gained the system
    one -- fails rather than passing as "not admin".
    """

    assert (path, method) in ROUTES_BY_OPERATION, f"{method.upper()} {path} is not mounted -- PUBLIC_WRITES names a route that moved"

    assert guards_of(ROUTES_BY_OPERATION[(path, method)]) == {verify_access_base}, f"{method.upper()} {path} is not base-tier"


def test_a_public_write_is_unreachable_without_the_base_key():
    """Public here means no SESSION, never no key: the edge reaches this application through the frontend.

    A request carrying no bearer token answers `access_key_refused` before the body is parsed. One write
    stands for all: the case above holds each to the base guard alone, and that guard is one function.
    """

    path, method = PUBLIC_WRITES[0]
    response = TestClient(APP, raise_server_exceptions=False).request(method, path, json={})

    assert response.status_code == 401
    assert response.json()["error_code"] == MISSING_BEARER_TOKEN


# The sweep's one read, listing every season for the caller: system tier because
# the rule keeps a `future` season off the base one, and the seasons taking
# applications are exactly those.
SYSTEM_READS = [
    ("/api/v0/bewerbungen/sweep", "get"),
    # The confirmation pass's own bookkeeping, asked by the timer running it and by no page: the
    # seasons it lists are `active`, which the base tier serves, so the rule is not its reason.
    ("/api/v0/spielbestaetigungen/sweep", "get"),
    # Read by the frontend's server alone: each owed carry names two addresses.
    ("/api/v0/address_change/sweep/moves", "get"),
]


# The reads a visitor's page makes, which are therefore NOT admin-guarded: enumerated as the public
# writes are, since nothing about a GET tells which tier it belongs to.
BASE_READS = [
    ("/api/v0/bewerbungen/form/{saison_id}", "get"),
    ("/api/v0/saisons/frame", "get"),
    ("/api/v0/saisons/landing", "get"),
    ("/api/v0/saisons/{saison_id}", "get"),
    ("/api/v0/saisons/{saison_id}/ko_runde", "get"),
    ("/api/v0/saisons/{saison_id}/spiele/{spiel_id}", "get"),
    ("/api/v0/saisons/{saison_id}/spielplan", "get"),
    ("/api/v0/saisons/{saison_id}/tabelle", "get"),
    ("/api/v0/saisons/{saison_id}/teams", "get"),
    ("/api/v0/saisons/{saison_id}/teams/{team_id}", "get"),
    ("/api/v0/spiele/{spiel_id}", "get"),
    ("/api/v0/spieler/{spieler_id}", "get"),
    ("/api/v0/spieltage/{spieltag_id}", "get"),
    ("/api/v0/teams/{team_id}", "get"),
]


def test_every_read_is_admin_guarded_unless_the_inventory_names_it():
    """Derived fail-closed, as the writes are: a read moved to the base router publishes what its guard kept back.

    An equality either way, so a base read that gained the system guard fails too. Not parametrised, so
    one failure names every misplaced read at once.
    """

    misplaced = []
    for path, method in PUBLISHED_OPERATIONS:
        if method != "get" or path in UNGUARDED_BY_DESIGN or (path, method) in SYSTEM_READS:
            continue
        tier, expected = ("base", verify_access_base) if (path, method) in BASE_READS else ("admin", verify_access_admin)
        if guards_of(ROUTES_BY_OPERATION[(path, method)]) != {expected}:
            misplaced.append(f"GET {path} is not {tier}-tier")
    unmounted = [path for path, method in BASE_READS if (path, method) not in ROUTES_BY_OPERATION]

    assert (misplaced, unmounted) == ([], [])


@pytest.mark.parametrize(("path", "method"), [*SYSTEM_WRITES, *SYSTEM_READS], ids=lambda value: value)
def test_a_system_write_is_system_tier(path: str, method: str):
    """An equality, as the public exemption's is: a sweep endpoint that fell to the base key would erase applications for anyone."""

    assert (path, method) in ROUTES_BY_OPERATION, f"{method.upper()} {path} is not mounted -- SYSTEM_WRITES names a route that moved"

    assert guards_of(ROUTES_BY_OPERATION[(path, method)]) == {verify_access_system}, f"{method.upper()} {path} is not system-tier"
    # The pass holds no session: the binder would refuse it every hour, and the wrong keys would stay refused.
    calls = [dependency.call for dependency in ROUTES_BY_OPERATION[(path, method)].dependant.dependencies]
    assert bind_actor not in calls, f"{method.upper()} {path} refuses the pass it serves"
