import re
from collections import Counter
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.api.spieler import schemas as spieler_schemas
from app.core.security import MISSING_TOKEN, verify_access_admin, verify_access_base, verify_access_system, verify_actor_is_admin
from app.main import create_app
from tests.config import build_test_config
from tests.core.app_source import api_routes

from .conftest import MINIMUM_EXPECTED_MUTATIONS

# Module level because pytest resolves parametrisation during collection, before a fixture could run.
APP = create_app(build_test_config())

MISSING_BEARER_TOKEN = MISSING_TOKEN

HTTP_METHODS = frozenset({"get", "post", "patch", "delete", "put", "head", "options", "trace"})

SLICE_GUARDS: set[Callable[..., Any]] = {verify_access_base, verify_access_admin, verify_access_system}


# The extension and the tier names, spelled here rather than imported from `app/main.py`: a
# comparison taking them from the pass it checks would let a rename through, and the frontend's own
# comparison is what would fail instead.
TIER_EXTENSION = "x-fl-tier"
EXPECTED_TIERS: dict[Callable[..., Any], str] = {verify_access_base: "base", verify_access_admin: "admin", verify_access_system: "system"}
UNGUARDED_TIER = "none"

# `/` is FastAPI's own hello-world route and belongs to no slice. `/system/is_live` is the container
# healthcheck: one that needs a secret fails for the wrong reasons (`app/core/security.py`).
UNGUARDED_BY_DESIGN = frozenset({"/", "/api/v0/system/is_live"})

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
    ("/api/v0/bewerbungen/einwilligung/ansicht", "post"),
    ("/api/v0/bewerbungen/einwilligung", "post"),
    # A referee's own confirmation link, on a base-tier router under an otherwise admin-tier prefix:
    # the token is the whole credential, so the guard here would have no session to check.
    ("/api/v0/schiedsrichter/bestaetigung/ansicht", "post"),
    ("/api/v0/schiedsrichter/bestaetigung", "post"),
    # A pupil's own confirmation link, on a third base-tier router under the registration prefix:
    # the token is the whole credential, so the guard here would have no session to check.
    ("/api/v0/registrierungen/bestaetigung/ansicht", "post"),
    ("/api/v0/registrierungen/bestaetigung", "post"),
    # The invite's own read and the registration it leads to: a pupil holds a link and no session,
    # and the first is a POST because the link value travels in the body.
    ("/api/v0/registrierungen/einladung/ansicht", "post"),
    ("/api/v0/registrierungen", "post"),
]

# The retention sweep's writes, made by the application to itself on the SYSTEM key: no session
# and no person, so the admin guard would have nothing to check and `bind_actor` would refuse.
SYSTEM_WRITES = [
    ("/api/v0/bewerbungen/sweep/{saison_id}", "post"),
    ("/api/v0/bewerbungen/sweep/{saison_id}/angekuendigt", "post"),
    ("/api/v0/bewerbungen/sweep/{saison_id}/loeschen", "post"),
    ("/api/v0/registrierungen/sweep/{saison_id}", "post"),
    ("/api/v0/bewerbungen/zustellung", "post"),
    ("/api/v0/bewerbungen/zustellung/angenommen", "post"),
    ("/api/v0/zustellung", "post"),
    ("/api/v0/zustellung/angenommen", "post"),
    ("/api/v0/zustellung/abgewiesen", "post"),
    # A POST that stores nothing, listed for `ADMIN_READS`' Kontakte entry's reason: the address
    # travels in a body, so `MUTATIONS` covers it, and this exemption leaves its one guard the
    # system tier's.
    ("/api/v0/identitaet/subjekt", "post"),
]

MUTATIONS = [
    (path, method)
    for path, method in PUBLISHED_OPERATIONS
    if method != "get" and (path, method) not in PUBLIC_WRITES and (path, method) not in SYSTEM_WRITES
]

# Admin reads this inventory PINS, not every admin read the application serves -- nothing about a GET
# tells the inventory which tier it belongs to, so each is enumerated and parametrised below.

# What earns a place: a revert to `verify_access_base` here publishes something named -- a venue's
# rent, a referee's contact details (`READ-MONEY-001`, `READ-CONTACT-001`).

# The two `bewerbungen` reads serve three people's names, addresses, telephone numbers and dates of
# birth, and that prefix now carries a base-tier router too, so the guard is the only thing between.
ADMIN_READS = [
    ("/api/v0/spielorte", "get"),
    ("/api/v0/spielorte/{spielort_id}", "get"),
    ("/api/v0/schiedsrichter", "get"),
    ("/api/v0/schiedsrichter/{schiedsrichter_id}", "get"),
    ("/api/v0/bewerbungen", "get"),
    ("/api/v0/bewerbungen/{bewerbung_id}", "get"),
    # A POST because the address travels in a body, so `MUTATIONS` covers it too -- and would
    # stop covering it the day somebody makes the reveal a GET.
    ("/api/v0/kontakte/erasure/ansicht", "post"),
    # The ban list names the administrator who entered each row, so a revert to `verify_access_base`
    # here publishes a staff address beside the reason they banned somebody (`READ-CONTACT-001`).
    ("/api/v0/sperrliste", "get"),
    # Which contact seats of which team a mailing would reach is `READ-CONTACT-001`'s subject exactly
    # as the two `bewerbungen` reads are.
    ("/api/v0/saisons/{saison_id}/einladungen/versand/vorschau", "get"),
    # The invitation's own read serves `erstellt_von`, an administrator's address.
    ("/api/v0/teams/{team_id}/saisons/{saison_id}/einladung", "get"),
    # A registration holds a pupil's name, the address the league mailed and, once they confirm,
    # their date of birth -- `READ-CONTACT-001`'s subject, as the two `bewerbungen` reads are.
    ("/api/v0/registrierungen", "get"),
]


def guards_of(route: APIRoute) -> set[Callable[..., Any]]:
    """`set[Callable]` rather than `set[object]`: `set` is invariant, so the narrower element type is not assignable."""
    calls = {dependency.call for dependency in route.dependant.dependencies if dependency.call is not None}
    return calls & SLICE_GUARDS


def test_the_published_surface_and_the_mounted_routes_are_the_same_set():
    """A route mounted but unpublished is a live endpoint no case below sees; one published with no route is a 404 clients are told to call."""
    assert set(PUBLISHED_OPERATIONS) == set(ROUTES_BY_OPERATION)


@pytest.mark.parametrize(("path", "method"), MUTATIONS, ids=lambda value: value)
def test_every_mutation_is_admin_guarded(path: str, method: str):
    """Parametrised rather than looped, so a failure names the method and path it broke on."""
    assert verify_access_admin in guards_of(ROUTES_BY_OPERATION[(path, method)]), f"{method.upper()} {path} is not admin-guarded"


@pytest.mark.parametrize(("path", "method"), ADMIN_READS, ids=lambda value: value)
def test_the_pinned_reads_are_admin_guarded(path: str, method: str):
    """Money, contact details and three people's own data ride on these, so a guard reverted to `verify_access_base` publishes them."""
    assert (path, method) in ROUTES_BY_OPERATION, f"{method.upper()} {path} is not mounted -- this list names a route that moved"

    assert guards_of(ROUTES_BY_OPERATION[(path, method)]) == {verify_access_admin}, f"{method.upper()} {path} is not admin-guarded"


@pytest.mark.parametrize(("path", "method"), PUBLISHED_OPERATIONS, ids=lambda value: value)
def test_every_operation_carries_exactly_one_guard(path: str, method: str):
    """Two guards is not stricter than one: FastAPI runs both, and no single key satisfies two."""
    guards = guards_of(ROUTES_BY_OPERATION[(path, method)])

    if path in UNGUARDED_BY_DESIGN:
        assert guards == set(), f"{method.upper()} {path} is documented as unguarded and carries {guards}"
        return

    assert len(guards) == 1, f"{method.upper()} {path} carries {len(guards)} guards: {guards}"


# The operations a signed-in person reaches on the admin key through `PERSON_ACTOR_BINDERS`, whose actor
# is a person no allowlist holds: the one exemption from the check below, by name. Empty until the
# first router serving a person is mounted.
PERSON_OPERATIONS: frozenset[tuple[str, str]] = frozenset()

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

    assert verify_actor_is_admin in calls, f"{method.upper()} {path} judges no actor against the allowlist"
    assert calls.index(verify_access_admin) < calls.index(verify_actor_is_admin), f"{method.upper()} {path} judges its actor before its key"


def test_the_person_exemption_names_only_published_operations():
    """A stale entry would exempt nothing while reading as a decision."""
    assert set(PERSON_OPERATIONS) <= set(PUBLISHED_OPERATIONS), f"{sorted(set(PERSON_OPERATIONS) - set(PUBLISHED_OPERATIONS))} is not published"


def test_every_guard_this_file_knows_names_a_tier():
    """A guard in one set and not the other publishes `none` for a route that is in fact guarded."""
    assert SLICE_GUARDS == set(EXPECTED_TIERS)


@pytest.mark.parametrize(("path", "method"), PUBLISHED_OPERATIONS, ids=lambda value: value)
def test_the_published_tier_is_the_guard_the_route_carries(path: str, method: str):
    """The frontend sends the key this names, so a wrong one here is a 401 nobody meets until a page opens."""
    guards = guards_of(ROUTES_BY_OPERATION[(path, method)])
    expected = "+".join(sorted(EXPECTED_TIERS[guard] for guard in guards)) or UNGUARDED_TIER

    assert APP.openapi()["paths"][path][method].get(TIER_EXTENSION) == expected


def test_the_mutation_inventory_clears_its_floor():
    """The partial loss `pyproject.toml :: empty_parameter_set_mark` cannot reach.

    That setting refuses an inventory that found NOTHING; one that found a third of the writes
    parametrises, and every case it runs passes.
    """
    assert len(MUTATIONS) >= MINIMUM_EXPECTED_MUTATIONS, (
        f"discovered only {len(MUTATIONS)} mutations across {len(PUBLISHED_OPERATIONS)} published operations; "
        f"expected at least {MINIMUM_EXPECTED_MUTATIONS}. Did a router stop being included?"
    )


@pytest.mark.parametrize(("path", "method"), PUBLIC_WRITES, ids=lambda value: value)
def test_a_public_write_is_base_tier(path: str, method: str):
    """What stands in for the guard the exemption drops: the operation carries the BASE one and no other.

    An equality rather than a membership, so a route that lost its guard -- or gained the system
    one -- fails rather than passing as "not admin".
    """

    assert (path, method) in ROUTES_BY_OPERATION, f"{method.upper()} {path} is not mounted -- PUBLIC_WRITES names a route that moved"

    assert guards_of(ROUTES_BY_OPERATION[(path, method)]) == {verify_access_base}, f"{method.upper()} {path} is not base-tier"


@pytest.mark.parametrize(("path", "method"), PUBLIC_WRITES, ids=lambda value: value)
def test_a_public_write_is_unreachable_without_the_base_key(path: str, method: str):
    """Public here means no SESSION, never no key: the edge reaches this application through the frontend.

    A request carrying no bearer token answers `REQ-AUTH-001` before the body is parsed.
    """

    response = TestClient(APP, raise_server_exceptions=False).request(method, path, json={})

    assert response.status_code == 401
    assert response.json()["error_code"] == MISSING_BEARER_TOKEN


# The sweep's one read, listing every season for the caller: system tier because
# `docs/backend/spec.md :: I47` keeps a `future` season off the base one, and the seasons taking
# applications are exactly those.
SYSTEM_READS = [("/api/v0/bewerbungen/sweep", "get")]


@pytest.mark.parametrize(("path", "method"), [*SYSTEM_WRITES, *SYSTEM_READS], ids=lambda value: value)
def test_a_system_write_is_system_tier(path: str, method: str):
    """An equality, as the public exemption's is: a sweep endpoint that fell to the base key would erase applications for anyone."""

    assert (path, method) in ROUTES_BY_OPERATION, f"{method.upper()} {path} is not mounted -- SYSTEM_WRITES names a route that moved"

    assert guards_of(ROUTES_BY_OPERATION[(path, method)]) == {verify_access_system}, f"{method.upper()} {path} is not system-tier"


@pytest.mark.parametrize(("path", "method"), [*SYSTEM_WRITES, *SYSTEM_READS], ids=lambda value: value)
def test_a_system_write_is_unreachable_without_the_system_key(path: str, method: str):
    response = TestClient(APP, raise_server_exceptions=False).request(method, path.replace("{saison_id}", "2026"), json={})

    assert response.status_code == 401
    assert response.json()["error_code"] == MISSING_BEARER_TOKEN


def test_the_system_writes_are_published_and_exempt_from_nothing_else():
    """`test_the_public_writes_are_published_and_exempt_from_nothing_else`'s floor, for the second exemption."""

    assert SYSTEM_WRITES, "the exemption is empty, so the two comparisons below hold of nothing"

    assert set(SYSTEM_WRITES) <= set(PUBLISHED_OPERATIONS), f"{sorted(set(SYSTEM_WRITES) - set(PUBLISHED_OPERATIONS))} is not published"

    assert set(SYSTEM_WRITES) & set(MUTATIONS) == set()


def test_the_public_writes_are_published_and_exempt_from_nothing_else():
    """The anti-vacuity floor: a stale entry would shrink `MUTATIONS` while proving nothing.

    Both directions -- every exempt operation is published, and each really left the inventory
    above rather than naming a path never in it.
    """

    assert PUBLIC_WRITES, "the exemption is empty, so the two comparisons below hold of nothing"

    assert set(PUBLIC_WRITES) <= set(PUBLISHED_OPERATIONS), f"{sorted(set(PUBLIC_WRITES) - set(PUBLISHED_OPERATIONS))} is not published"

    assert set(PUBLIC_WRITES) & set(MUTATIONS) == set()


def test_no_route_creates_a_person():
    """An absence the inventory above cannot report, its floor being a `>=`.

    Read off the MOUNTED routes rather than the published document, which is regenerated by hand.
    """

    # Found rather than spelled: a version bump moves it, and a list read gone takes this case with
    # it instead of leaving it green over a path nothing serves.
    collection = next(path for path, method in ROUTES_BY_OPERATION if path.endswith("/spieler") and method == "get")

    assert (collection, "post") not in ROUTES_BY_OPERATION, f"{collection} answers POST, so an administrator can create a person again"
    assert not hasattr(spieler_schemas, "FLPostSpielerPayload"), "the create's payload is declared again, whatever is mounted"
