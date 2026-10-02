from pathlib import Path
from typing import Final

import pytest

# The suite's own two guards, imported rather than copied: a hook or a fixture that stops being one, or
# stops running unasked, stops charging here as it stops in the real suite.
GUARDED_CONFTEST: Final = b"""from tests.conftest import _shared_app_left_as_built, pytest_make_collect_report
"""

EDITS_ON_IMPORT: Final = b"""from tests.core.app_source import application

application().state.planted = object()


def test_never_collected() -> None:
    pass
"""

EDITS_WHILE_RUNNING: Final = b"""from tests.core.app_source import application


def test_clears_the_handlers() -> None:
    application().exception_handlers.clear()
"""

# After both, so a guard that undid nothing charges this module instead.
READS_AFTER: Final = b"""from tests.core.app_source import application


def test_meets_the_app_as_built() -> None:
    app = application()

    assert app.exception_handlers, "the handlers another module cleared reached this one"
    assert not hasattr(app.state, "planted"), "the state another module bound reached this one"
"""


def test_an_edit_to_the_shared_app_fails_the_module_that_made_it(pytester: pytest.Pytester, monkeypatch: pytest.MonkeyPatch) -> None:
    """One edit at import and one while a test runs, each charged by its own guard to its own module, and neither to the one after."""

    suite = pytester.path / "suite"
    suite.mkdir()
    (suite / "conftest.py").write_bytes(GUARDED_CONFTEST)
    (suite / "test_a_edits_on_import.py").write_bytes(EDITS_ON_IMPORT)
    (suite / "test_b_edits_while_running.py").write_bytes(EDITS_WHILE_RUNNING)
    (suite / "test_c_reads_after.py").write_bytes(READS_AFTER)
    monkeypatch.setenv("PYTHONPATH", str(Path(__file__).resolve().parents[2]))
    result = pytester.runpytest_subprocess("-p", "no:cacheprovider", "-p", "no:xdist", "--continue-on-collection-errors", str(suite))
    output = result.stdout.str()

    result.assert_outcomes(passed=2, errors=2)
    assert "test_a_edits_on_import.py edited the app" in output and "on import: its state at ['planted']" in output, output
    assert "test_b_edits_while_running.py edited the app" in output and "while its tests ran: its exception handlers" in output, output
    assert "test_c_reads_after.py edited the app" not in output, output
