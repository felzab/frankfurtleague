import re
from collections import Counter
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.api.berechtigungen.guard import verify_actor_is_admin
from app.api.sperrliste.guard import PERSON_ACTOR_BINDERS
from app.api.spieler import schemas as spieler_schemas
from app.core.codes import Code
from app.core.security import bind_actor, verify_access_admin, verify_access_base, verify_access_system
from tests.core.app_source import api_routes, application

from .conftest import MINIMUM_EXPECTED_MUTATIONS

# Module level because pytest resolves parametrisation during collection, before a fixture could run.
APP = application()

MISSING_BEARER_TOKEN = Code.ACCESS_KEY_REFUSED

HTTP_METHODS = frozenset({"get", "post", "patch", "delete", "put", "head", "options", "trace"})

SLICE_GUARDS: set[Callable[..., Any]] = {verify_access_base, verify_access_admin, verify_access_system}


# The security scheme each guard publishes, spelled here rather than imported from
# `app/core/security.py`: a comparison taking them from the code it checks would let a rename
# through, and the frontend's generated client is what would fail instead.
EXPECTED_SCHEMES: dict[Callable[..., Any], str] = {
    verify_access_base: "BaseKey",
    verify_access_admin: "AdminKey",
    verify_access_system: "SystemKey",
}

# `/system/is_live` is the container healthcheck: one that needs a secret fails for the wrong reasons
# (`app/core/security.py`).
UNGUARDED_BY_DESIGN = frozenset({"/api/v0/system/is_live"})

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
    # A club's fixture confirmation link: its holder has no session, the token being the credential.
    ("/api/v0/spielbestaetigungen/view", "post"),
    ("/api/v0/spielbestaetigungen", "post"),
]

# The retention sweep's writes, made by the application to itself on the SYSTEM key: no session
# and no person, so the admin guard would have nothing to check and `bind_actor` would refuse.
SYSTEM_WRITES = [
    ("/api/v0/bewerbungen/sweep/{saison_id}", "post"),
    ("/api/v0/registrierungen/sweep/{saison_id}", "post"),
    ("/api/v0/spielbestaetigungen/sweep/{saison_id}", "post"),
    # A POST that stores nothing, listed for `ADMIN_READS`' erasure reveal's reason: the address
    # travels in a body, so `MUTATIONS` covers it, and this exemption leaves its one guard the
    # system tier's.
    ("/api/v0/identity/subject", "post"),
    ("/api/v0/identity/sign_in", "post"),
    ("/api/v0/identity/references", "post"),
    # The grants' comparison: the hourly pass holds no session, and a change made in the database directly has no
    # administrator to attribute it to.
    ("/api/v0/grants/reconciliation", "post"),
    # The season-after rule and the lapsed address's clock, whichever caller runs them: a timer holds
    # no session, and an activation's press deletes nobody in the administrator's name.
    ("/api/v0/identity/erasure/sweep", "post"),
    ("/api/v0/address_change/sweep", "post"),
    # The sign-in accounts the address changes still owe to carry, reported carried by the frontend, which holds the store.
    ("/api/v0/address_change/sweep/moves/done", "post"),
    # The Postausgang's drain, the sign-in library's mails and the provider's events: none holds a session.
    ("/api/v0/outbox/handout", "post"),
    ("/api/v0/outbox/result", "post"),
    ("/api/v0/outbox/sign_in", "post"),
    ("/api/v0/outbox/event", "post"),
    # A POST storing nothing, exempt for the identity reads' reason: the frontend's server asks a live change's new address.
    ("/api/v0/address_change/adresse", "post"),
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
    # Every confirmation row of a season, each reason a club typed or an administrator recorded among them: free text
    # that may name anyone, which no base-tier read serves.
    ("/api/v0/spielbestaetigungen", "get"),
    # A POST because the address travels in a body, so `MUTATIONS` covers it too -- and would
    # stop covering it the day somebody makes the reveal a GET.
    ("/api/v0/identity/erasure/view", "post"),
    # The ban list names the administrator who entered each row, so a revert to `verify_access_base`
    # here publishes a staff address beside the reason they banned somebody (`READ-CONTACT-001`).
    ("/api/v0/sperrliste", "get"),
    # Which contact seats of which team a mailing would reach is `READ-CONTACT-001`'s subject exactly
    # as the two `bewerbungen` reads are.
    ("/api/v0/saisons/{saison_id}/invitations/dispatch/preview", "get"),
    # How many pupils an activation deletes, which only the person able to press it may weigh.
    ("/api/v0/saisons/{saison_id}/erasure/preview", "get"),
    # The invitation's own read serves `created_by`, an administrator's address.
    ("/api/v0/teams/{team_id}/saisons/{saison_id}/invitation", "get"),
    # A registration holds a pupil's name, the address the league mailed and, once they confirm,
    # their date of birth -- `READ-CONTACT-001`'s subject, as the two `bewerbungen` reads are.
    ("/api/v0/registrierungen", "get"),
    # A team's squad with every surname whole, served to its own seat holders: a revert to
    # `verify_access_base` hands it to every visitor, past the initial `READ-PUPIL-001` keeps for them.
    ("/api/v0/spieler/kader/{team_id}/{saison_id}", "get"),
    # A team's pending registrations name the person each address resolves to, a pupil's record the
    # base tier never serves; the seat lines name three people who agreed to administrators alone.
    ("/api/v0/registrierungen/kader/{team_id}/{saison_id}", "get"),
    ("/api/v0/teams/{team_id}/saisons/{saison_id}/self/seats", "get"),
    # A person's own records: a birthdate and a consent record, and on a referee's the contact
    # details (`READ-CONTACT-001`), each served to that person alone.
    ("/api/v0/spieler/self", "get"),
    ("/api/v0/schiedsrichter/self", "get"),
    ("/api/v0/account/einwilligungen", "get"),
    # A report's remarks and card reasons, which only the administrator and the booked referee read; the squads
    # beside them carry every surname whole.
    ("/api/v0/spielberichte/{spiel_id}/verwaltung", "get"),
    ("/api/v0/spielberichte/{spiel_id}/bericht", "get"),
    # Every report's proposed result, which the public result never serves.
    ("/api/v0/spielberichte", "get"),
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
# is a person no grant names: the one exemption from the check below, by name.
PERSON_OPERATIONS: frozenset[tuple[str, str]] = frozenset(
    {
        ("/api/v0/spieler/kader/{team_id}/{saison_id}", "get"),
        ("/api/v0/spieler/kader/{team_id}/{saison_id}/{spieler_id}", "patch"),
        ("/api/v0/spieler/kader/{team_id}/{saison_id}/{spieler_id}", "delete"),
        ("/api/v0/registrierungen/kader/{team_id}/{saison_id}", "get"),
        ("/api/v0/registrierungen/{registrierung_id}/admit", "post"),
        ("/api/v0/registrierungen/{registrierung_id}/decline", "post"),
        ("/api/v0/teams/{team_id}/saisons/{saison_id}/self/seats", "get"),
        ("/api/v0/spieler/self", "get"),
        ("/api/v0/spieler/account/einwilligung", "patch"),
        ("/api/v0/schiedsrichter/self", "get"),
        ("/api/v0/schiedsrichter/account/{schiedsrichter_id}/einwilligung", "patch"),
        ("/api/v0/account/einwilligungen", "get"),
        ("/api/v0/teams/{team_id}/saisons/{saison_id}/account/einwilligung", "patch"),
        ("/api/v0/bewerbungen/{bewerbung_id}/account/einwilligung", "patch"),
        ("/api/v0/registrierungen/account/{registrierung_id}/einwilligung", "patch"),
        ("/api/v0/identity/account/erasure", "post"),
        ("/api/v0/identity/account/erasure/view", "get"),
        ("/api/v0/spielbestaetigungen/self", "get"),
        ("/api/v0/spielbestaetigungen/{spielbestaetigung_id}/antwort", "post"),
        ("/api/v0/spielberichte/self", "get"),
        ("/api/v0/spielberichte/{spiel_id}/bericht", "get"),
        ("/api/v0/spielberichte/{spiel_id}/bericht", "put"),
        ("/api/v0/account/address_change", "get"),
        ("/api/v0/account/address_change", "post"),
        ("/api/v0/account/address_change/release", "post"),
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


# The admin-tier reads served over POST, the address they ask about travelling in a body rather than an access
# line. Named, because nothing a route declares tells such a read from a write.
ADMIN_TIER_READS_OVER_POST = frozenset({("/api/v0/address_change/view", "post"), ("/api/v0/identity/erasure/view", "post")})


def test_the_person_exemption_names_only_published_operations():
    """A stale entry would exempt nothing while reading as a decision."""
    assert set(PERSON_OPERATIONS) <= set(PUBLISHED_OPERATIONS), f"{sorted(set(PERSON_OPERATIONS) - set(PUBLISHED_OPERATIONS))} is not published"


def test_every_person_operation_binds_a_person_after_the_key():
    """What earns an operation its exemption from the grants check.

    Not parametrised, so one failure names every unearned exemption at once.
    """
    unearned = []
    for operation in sorted(PERSON_OPERATIONS):
        route = ROUTES_BY_OPERATION.get(operation)
        calls = [dependency.call for dependency in route.dependant.dependencies] if route else []
        binders = [index for index, call in enumerate(calls) if any(call is binder for binder in PERSON_ACTOR_BINDERS.values())]
        if verify_access_admin not in calls or not binders or binders[0] < calls.index(verify_access_admin):
            unearned.append(operation)

    assert unearned == [], f"{unearned} is exempt from the grants check without binding a person after the admin key"


def test_every_guard_this_file_knows_names_a_scheme():
    """A guard in one set and not the other publishes no security for a route that is in fact guarded."""
    assert SLICE_GUARDS == set(EXPECTED_SCHEMES)


@pytest.mark.parametrize(("path", "method"), PUBLISHED_OPERATIONS, ids=lambda value: value)
def test_the_published_security_is_the_guard_the_route_carries(path: str, method: str):
    """The frontend sends the key this names, so a wrong one here is a 401 nobody meets until a page opens."""
    guards = guards_of(ROUTES_BY_OPERATION[(path, method)])
    expected = [{EXPECTED_SCHEMES[guard]: []} for guard in sorted(guards, key=lambda guard: EXPECTED_SCHEMES[guard])]

    assert APP.openapi()["paths"][path][method].get("security", []) == expected


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

    A request carrying no bearer token answers `access_key_refused` before the body is parsed.
    """

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
