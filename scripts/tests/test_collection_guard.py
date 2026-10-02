"""SCRIPTS · the refusal of a test module that collects nothing, driven through a run of its own."""

from __future__ import annotations

from pathlib import Path

import pytest

PLUGIN = Path(__file__).resolve().parent / "collection.py"

SUITE = {
    "test_runs": "def test_runs():\n    assert True\n",
    # Its one function lost the prefix, which is how a module goes quiet.
    "test_lost_its_tests": "def check_runs():\n    assert True\n",
    "test_skipped_on_purpose": 'import pytest\n\npytest.skip("no reader here", allow_module_level=True)\n',
}


def _run(pytester: pytest.Pytester, *flags: str) -> pytest.RunResult:
    pytester.makeini("[pytest]\n")
    pytester.makepyfile(**SUITE, collection=PLUGIN.read_text(encoding="utf-8"))
    # Named by a conftest beside it, as this suite's conftest names it: a worker imports a conftest's
    # plugin from the conftest's directory, where an argument's is sought on the parent's startup path.
    pytester.makeconftest('pytest_plugins = ("collection",)\n')

    return pytester.runpytest_inprocess("-p", "no:cacheprovider", *flags)


def test_this_suite_runs_under_the_refusal(request: pytest.FixtureRequest) -> None:
    """The cases below drive a copy of the plugin, so they pass whether or not this suite's conftest names it."""
    assert request.config.pluginmanager.get_plugin("collection") is not None


def test_a_module_collecting_no_test_fails_the_run_by_name(pytester: pytest.Pytester) -> None:
    """The module skipped at its top stands: skipping is a reason given, collecting nothing is none."""
    result = _run(pytester, "-p", "no:xdist")
    output = result.stdout.str()

    assert result.ret == pytest.ExitCode.INTERRUPTED, output
    assert "test_lost_its_tests.py collects no test" in output, output
    assert "test_skipped_on_purpose.py collects no test" not in output, output
    assert "test_runs.py collects no test" not in output, output


def test_the_refusal_holds_under_workers(pytester: pytest.Pytester) -> None:
    """The gate runs this suite under xdist, where each worker collects for itself."""
    result = _run(pytester, "-n", "2")
    output = result.stdout.str()

    assert result.ret != pytest.ExitCode.OK, output
    assert "test_lost_its_tests.py collects no test" in output, output
