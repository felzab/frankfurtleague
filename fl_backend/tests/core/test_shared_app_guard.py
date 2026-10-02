import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Final

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[2]

# The suite's own two guards, imported rather than copied: a hook or a fixture that stops being one, or
# stops running unasked, stops charging here as it stops in the real suite.
GUARDED_CONFTEST: Final = b"""from tests.conftest import _shared_app_left_as_built, pytest_make_collect_report
"""

# Per surface a module can edit on the shared app: the edit, and the words the guard charges it in.
SURFACES: Final = {
    "overrides": ("app.dependency_overrides[get_germany_now] = lambda: None", "dependency overrides for ['get_germany_now']"),
    "state": ("app.state.planted = object()", "its state at ['planted']"),
    "handlers": ("app.exception_handlers.clear()", "its exception handlers for"),
    "middleware": ("app.user_middleware.append(app.user_middleware[0])", "its middleware"),
    "routes": ("app.router.routes.pop()", "its route table"),
    "document": ('app.openapi()["info"]["title"] = "edited"', "its published document"),
    # One route edited in place, which leaves every entry of the table its own object.
    "route_dependencies": ("route.dependencies.append(object())", "its routes at GET /api/v0/spiele ['dependencies']"),
    "route_path": ('route.path = "/edited"', "its routes at GET /api/v0/spiele ['path']"),
    "route_methods": ('route.methods.add("PUT")', "its routes at GET /api/v0/spiele ['methods']"),
    "route_response_model": ("route.response_model = object", "its routes at GET /api/v0/spiele ['response_model']"),
    # What a request is actually checked against: cleared, the route serves without its key.
    "route_dependant": ("route.dependant.dependencies.clear()", "its routes at GET /api/v0/spiele dependant ['dependencies']"),
}

PRELUDE: Final = """from fastapi.testclient import TestClient

from app.core.dependencies import get_germany_now
from tests.core.app_source import api_routes, application

app = application()
# By its operation id, which no edit below touches, so one left standing cannot hide the route from the next module.
route = next(found for found in api_routes(app) if found.unique_id == "get_spiele_api_v0_spiele_get")
"""


def served(app: str) -> str:
    """A request the app answers without a database: a missing key, refused by the app's own handlers."""

    return f'TestClient({app}, raise_server_exceptions=False).get("/api/v0/spiele")'


def on_import(edit: str) -> bytes:
    return f"{PRELUDE}\n{edit}\n\n\ndef test_never_collected() -> None:\n    pass\n".encode()


def while_running(edit: str) -> bytes:
    """Served after the edit, which is what builds Starlette's stack over it."""

    return f"{PRELUDE}\n\ndef test_edits_and_serves() -> None:\n    {edit}\n    {served('app')}\n".encode()


# Taken back by its own module after a request built the stack over it: the guard finds nothing to name.
EDITS_SERVES_AND_RESTORES: Final = f"""{PRELUDE}

def test_clears_serves_and_restores() -> None:
    held = dict(app.exception_handlers)
    app.exception_handlers.clear()
    {served("app")}
    app.exception_handlers.update(held)
""".encode()

# Last, and straight after the taken-back edit, so a surface the guard left edited, or a stack it left
# built, reaches the module reading it.
READS_AFTER: Final = f"""{PRELUDE}
from app.core.security import MISSING_TOKEN
from tests.core.app_source import undo_edits_to_application


def test_meets_the_app_as_built() -> None:
    assert undo_edits_to_application() == []

    response = {served("app")}
    assert (response.status_code, response.json().get("error_code")) == (401, MISSING_TOKEN)
""".encode()


@pytest.fixture(scope="module")
def guarded_run(tmp_path_factory: pytest.TempPathFactory) -> Iterator[str]:
    """One run for every surface: each run builds the application, which a run per surface would pay six times."""

    suite = tmp_path_factory.mktemp("guarded") / "suite"
    suite.mkdir()
    (suite / "conftest.py").write_bytes(GUARDED_CONFTEST)
    for surface, (edit, _) in SURFACES.items():
        (suite / f"test_b_{surface}_on_import.py").write_bytes(on_import(edit))
        (suite / f"test_c_{surface}_while_running.py").write_bytes(while_running(edit))
    # First, so its request builds the process's stack, and read straight after, before a charged edit's
    # undo drops that stack.
    (suite / "test_a1_restored.py").write_bytes(EDITS_SERVES_AND_RESTORES)
    (suite / "test_a2_reads_after_restored.py").write_bytes(READS_AFTER)
    (suite / "test_d_reads_after.py").write_bytes(READS_AFTER)

    # Set rather than handed over as a copy of the environment, which this tree reads through its config alone.
    with pytest.MonkeyPatch.context() as patched:
        patched.setenv("PYTHONPATH", str(BACKEND_ROOT))
        run = subprocess.run(
            [sys.executable, "-m", "pytest", "-p", "no:cacheprovider", "-p", "no:xdist", "--continue-on-collection-errors", "-rA", str(suite)],
            cwd=suite.parent,
            capture_output=True,
            timeout=300,
            check=False,
        )

    yield run.stdout.decode(errors="replace")


def passed(output: str, module: str) -> bool:
    return any(line.startswith("PASSED ") and f"{module}::" in line for line in output.splitlines())


def charged(output: str, module: str) -> list[str]:
    return [line for line in output.splitlines() if f"{module} edited the app" in line]


@pytest.mark.parametrize("surface", SURFACES)
def test_an_edit_at_import_fails_the_module_that_made_it(guarded_run: str, surface: str) -> None:
    lines = charged(guarded_run, f"test_b_{surface}_on_import.py")

    assert lines, guarded_run
    assert all(f"on import: {SURFACES[surface][1]}" in line for line in lines), lines


@pytest.mark.parametrize("surface", SURFACES)
def test_an_edit_while_running_fails_the_module_that_made_it(guarded_run: str, surface: str) -> None:
    lines = charged(guarded_run, f"test_c_{surface}_while_running.py")

    assert lines, guarded_run
    assert all(f"while its tests ran: {SURFACES[surface][1]}" in line for line in lines), lines


def test_an_edit_its_module_took_back_is_charged_to_nobody_and_reaches_nobody(guarded_run: str) -> None:
    assert not charged(guarded_run, "test_a1_restored.py"), guarded_run
    assert passed(guarded_run, "test_a1_restored.py"), guarded_run
    assert passed(guarded_run, "test_a2_reads_after_restored.py"), guarded_run


def test_the_module_after_every_edit_meets_and_is_served_the_app_as_built(guarded_run: str) -> None:
    assert not charged(guarded_run, "test_d_reads_after.py"), guarded_run
    assert passed(guarded_run, "test_d_reads_after.py"), guarded_run
