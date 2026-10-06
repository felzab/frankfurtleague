"""
API · which writes count against a signed-in person's day, read off the mounted routes

A person's write route added later fails here until it counts or names why it does not, and a route
binding no person cannot count at all. What a count does once the database answers is
`tests/api/test_drosselung_execution.py`'s.
"""

import ast
from collections.abc import Mapping
from datetime import datetime
from typing import get_args
from zoneinfo import ZoneInfo

import pytest
from fastapi.routing import APIRoute

from app.core.drosselung import TAGESBUDGETS, gedrosselt, get_drossel, sekunden_bis_tagesende, tagesende
from app.core.recording import AktorFunktion
from app.core.security import PERSON_ACTOR_BINDERS
from app.main import RefusalDriver, _dependency_calls, dependency_refusals
from tests.core.app_source import application, declared

from .test_actor_binding import ROUTES_BY_OPERATION, SAFE_METHODS, binds_a_person
from .test_admin_guard import strip_convertors
from .test_drosselung_execution import CONSENTS, COUNTED_ON_EVERY_CALL, Consent

BERLIN = ZoneInfo("Europe/Berlin")

# Derived from the binder rather than from any list of writes, so a person's route mounted later is
# swept whatever else it forgot.
PERSON_LANE_WRITES = sorted(
    operation for operation, route in ROUTES_BY_OPERATION.items() if operation[1] not in SAFE_METHODS and binds_a_person(route)
)

# The person writes that count nothing, each with why: a withdrawal stays as easy as the grant was.
UNCOUNTED_PERSON_WRITES: Mapping[tuple[str, str], str] = {
    ("/api/v0/bewerbungen/{bewerbung_id:objectid}/person/einwilligung", "PATCH"): "withdraw-only, and a withdrawal is never counted",
    ("/api/v0/registrierungen/selbst/{registrierung_id:objectid}/einwilligung", "PATCH"): "withdraw-only, and a withdrawal is never counted",
}


def counts(route: APIRoute) -> bool:
    """Whether any dependency the route runs hands out the day's count, `gedrosselt`'s own included."""

    return get_drossel in set(_dependency_calls(route.dependant))


def declares_gedrosselt(route: APIRoute) -> bool:
    return any(dependency.call is gedrosselt for dependency in route.dependant.dependencies)


def drossel_parameters(route: APIRoute) -> list[str]:
    """The handler's own parameters taking the count, each called where the handler judges a write counts."""

    return [dependency.name for dependency in route.dependant.dependencies if dependency.call is get_drossel and dependency.name]


@pytest.mark.parametrize(("path", "method"), PERSON_LANE_WRITES, ids=lambda value: value)
def test_every_person_write_counts_or_is_named_uncounted(path: str, method: str):
    """The expandability: one declaration on the route, or one line here saying why none."""

    route = ROUTES_BY_OPERATION[(path, method)]

    if (path, method) in UNCOUNTED_PERSON_WRITES:
        assert not counts(route), f"{method} {path} counts, and is named uncounted: {UNCOUNTED_PERSON_WRITES[(path, method)]}"
    else:
        assert counts(route), (
            f"{method} {path} counts nothing against its person's day: declare `Depends(gedrosselt)`, take a `Drossel` "
            "its handler calls, or name it in `UNCOUNTED_PERSON_WRITES` with why"
        )


def test_the_population_and_the_exemption_are_real():
    """Both comparisons above hold of an empty population, and a stale exemption would excuse nothing while reading as a decision."""

    assert len(PERSON_LANE_WRITES) > len(UNCOUNTED_PERSON_WRITES)
    assert set(UNCOUNTED_PERSON_WRITES) <= set(PERSON_LANE_WRITES)


@pytest.mark.parametrize(("path", "method"), sorted(ROUTES_BY_OPERATION), ids=lambda value: value)
def test_only_a_person_s_write_counts(path: str, method: str):
    """An administrator's route, a public or a system one, and every read count nothing: the ceiling is a person's writes alone."""

    route = ROUTES_BY_OPERATION[(path, method)]

    if counts(route):
        assert binds_a_person(route), f"{method} {path} counts without binding a person, so it would count an administrator or nobody"
        assert method not in SAFE_METHODS, f"{method} {path} counts a read"


@pytest.mark.parametrize(("path", "method"), [operation for operation in PERSON_LANE_WRITES if counts(ROUTES_BY_OPERATION[operation])])
def test_a_route_counts_one_way_and_after_its_binder(path: str, method: str):
    """Both ways on one route count every call twice; `gedrosselt` ahead of the binder counts nobody it can name."""

    route = ROUTES_BY_OPERATION[(path, method)]
    calls = [dependency.call for dependency in route.dependant.dependencies]

    assert declares_gedrosselt(route) != bool(drossel_parameters(route)), f"{method} {path} counts by both declarations"

    if declares_gedrosselt(route):
        binders = [index for index, call in enumerate(calls) if any(call is binder for binder in PERSON_ACTOR_BINDERS.values())]
        assert binders and binders[0] < calls.index(gedrosselt), f"{method} {path} counts before its binder names the person"


@pytest.mark.parametrize(
    ("path", "method"), [operation for operation in PERSON_LANE_WRITES if drossel_parameters(ROUTES_BY_OPERATION[operation])]
)
def test_a_handler_taking_the_count_calls_it(path: str, method: str):
    """A count taken and never called publishes a 429 that cannot occur, and leaves the route uncounted."""

    route = ROUTES_BY_OPERATION[(path, method)]
    [parameter] = drossel_parameters(route)
    called = [
        node
        for node in ast.walk(declared(route.endpoint))
        if isinstance(node, ast.Call)
        and (
            (isinstance(node.func, ast.Name) and node.func.id == parameter)
            # Or handed on, as a consent press hands it to `app/api/konto/crud.py :: press_einwilligung`;
            # the case below drives each such grant to its one unit.
            or any(isinstance(keyword.value, ast.Name) and keyword.value.id == parameter for keyword in node.keywords)
        )
    ]

    assert called, f"{method} {path} takes `{parameter}` and neither calls it nor hands it on"


def test_the_execution_suite_drives_exactly_the_operations_the_count_is_published_on():
    """The holder of the table's `COUNT` entries; a call on a branch that never runs passes every case above.

    `CONSENTS` and `COUNTED_ON_EVERY_CALL` parametrise the database cases driving each operation to the count.
    """

    consents = [value for param in CONSENTS for value in param.values if isinstance(value, Consent)]
    sent = [("PATCH", consent.path) for consent in consents] + [(param.values[0], param.values[1]) for param in COUNTED_ON_EVERY_CALL]
    driven = {
        (strip_convertors(path), method.lower())
        for sent_method, url in sent
        for (path, method), route in ROUTES_BY_OPERATION.items()
        if method == sent_method and route.path_regex.fullmatch(str(url))
    }
    published = set(dependency_refusals(application(), {RefusalDriver.COUNT}))

    assert len(consents) == len(CONSENTS), "a `CONSENTS` entry carries no `Consent`, so the comparison below misses it"
    assert published, "no operation publishes the count's refusal, so the comparison below holds of nothing"
    assert driven == published, f"driven {sorted(driven)}, publishing the count {sorted(published)}"


def test_both_declarations_are_in_use():
    """Each case above is parametrised by one of the two, so one going unused would leave its cases unasked."""

    counting = [ROUTES_BY_OPERATION[operation] for operation in PERSON_LANE_WRITES if counts(ROUTES_BY_OPERATION[operation])]

    assert any(declares_gedrosselt(route) for route in counting)
    assert any(drossel_parameters(route) for route in counting)


def test_every_funktion_has_a_ceiling():
    """A Funktion with none would raise inside the count rather than refuse at a number."""

    assert set(TAGESBUDGETS) == set(get_args(AktorFunktion))
    assert all(ceiling > 0 for ceiling in TAGESBUDGETS.values())


@pytest.mark.parametrize(
    ("germany_now", "midnight", "seconds"),
    [
        pytest.param(datetime(2026, 4, 1, 12, tzinfo=BERLIN), datetime(2026, 4, 2, tzinfo=BERLIN), 12 * 3600, id="an ordinary day"),
        # 00:30 on the days the clocks change: a wall-clock subtraction is an hour off either way.
        pytest.param(datetime(2026, 3, 29, 0, 30, tzinfo=BERLIN), datetime(2026, 3, 30, tzinfo=BERLIN), 22 * 3600 + 1800, id="clocks forward"),
        pytest.param(datetime(2026, 10, 25, 0, 30, tzinfo=BERLIN), datetime(2026, 10, 26, tzinfo=BERLIN), 24 * 3600 + 1800, id="clocks back"),
        pytest.param(
            datetime(2026, 12, 31, 23, 59, 59, 500000, tzinfo=BERLIN), datetime(2027, 1, 1, tzinfo=BERLIN), 1, id="half a second to the year"
        ),
    ],
)
def test_retry_after_counts_real_seconds_to_the_german_midnight(germany_now: datetime, midnight: datetime, seconds: int):
    assert tagesende(germany_now) == midnight
    assert sekunden_bis_tagesende(germany_now) == seconds
