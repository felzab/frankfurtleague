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


def _run(pytester: pytest.Pytester, *flags: str, suite: dict[str, str] = SUITE, cached: bool = False) -> pytest.RunResult:
    pytester.makeini("[pytest]\n")
    pytester.makepyfile(**suite, collection=PLUGIN.read_text(encoding="utf-8"))
    # Named by a conftest beside it, as this suite's conftest names it: a worker imports a conftest's
    # plugin from the conftest's directory, where an argument's is sought on the parent's startup path.
    pytester.makeconftest('pytest_plugins = ("collection",)\n')

    return pytester.runpytest_inprocess(*flags) if cached else pytester.runpytest_inprocess("-p", "no:cacheprovider", *flags)


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


# Each module's only class collects nothing, which pytest reports as a class passing.
CLASSES_COLLECTING_NOTHING = {
    "test_class_lost_its_tests": "class TestNothing:\n    def check_runs(self):\n        assert True\n",
    "test_class_with_a_constructor": (
        "class TestBuilt:\n    def __init__(self):\n        self.league = 1\n\n    def test_reads(self):\n        assert self.league\n"
    ),
    "test_class_made_a_dataclass": (
        "from dataclasses import dataclass\n\n\n@dataclass\nclass TestBuilt:\n    league: int = 1\n\n"
        "    def test_reads(self):\n        assert self.league\n"
    ),
}


@pytest.mark.parametrize("flags", [pytest.param(("-p", "no:xdist"), id="one-process"), pytest.param(("-n", "2"), id="workers")])
def test_a_module_whose_classes_collect_nothing_fails_the_run_by_name(pytester: pytest.Pytester, flags: tuple[str, ...]) -> None:
    """A class saying `__test__ = False` beside a test is left alone: the module still collects one."""
    helper = "class TestHelper:\n    __test__ = False\n\n    def test_never(self):\n        assert False\n\n\n" + SUITE["test_runs"]
    result = _run(pytester, *flags, suite={**CLASSES_COLLECTING_NOTHING, "test_runs": SUITE["test_runs"], "test_beside_a_helper": helper})
    output = result.stdout.str()

    assert result.ret != pytest.ExitCode.OK, output
    for module in CLASSES_COLLECTING_NOTHING:
        assert f"{module}.py collects no test" in output, output
    assert "test_runs.py collects no test" not in output, output
    assert "test_beside_a_helper.py collects no test" not in output, output


SELECTED = {"test_runs": SUITE["test_runs"], "test_in_a_class": "class TestIt:\n    def test_runs(self):\n        assert True\n"}


@pytest.mark.parametrize("flags", [pytest.param(("-p", "no:xdist"), id="one-process"), pytest.param(("-n", "2"), id="workers")])
@pytest.mark.parametrize(
    "node_id",
    ["test_runs.py::test_runs", "test_in_a_class.py::TestIt", "test_in_a_class.py::TestIt::test_runs"],
    ids=["a function", "a class", "a method"],
)
def test_a_test_selected_by_its_node_id_runs(pytester: pytest.Pytester, flags: tuple[str, ...], node_id: str) -> None:
    """The session's own report names the selected node, whose parent is its module, before the module's tests are collected."""
    result = _run(pytester, *flags, node_id, suite=SELECTED)
    output = result.stdout.str()

    assert result.ret == pytest.ExitCode.OK, output
    assert "1 passed" in output, output


def test_a_module_the_last_failed_run_skips_stands(pytester: pytest.Pytester) -> None:
    """`--lf` answers every module holding no last failure collected with nothing, never collecting it."""
    suite = {"test_fails": "def test_fails():\n    assert False\n", "test_runs": SUITE["test_runs"]}
    _run(pytester, "-p", "no:xdist", suite=suite, cached=True)

    result = _run(pytester, "-p", "no:xdist", "--lf", suite=suite, cached=True)
    output = result.stdout.str()

    assert result.ret == pytest.ExitCode.TESTS_FAILED, output
    assert "1 failed" in output, output
    assert "collects no test" not in output, output


def test_a_module_skipped_at_its_top_without_a_reason_fails_by_name(pytester: pytest.Pytester) -> None:
    """A reason left out, or left blank, is no reason; the frontend's reporter holds its suites to the same."""
    suite = {
        "test_skipped_on_purpose": SUITE["test_skipped_on_purpose"],
        "test_skipped_bare": "import pytest\n\npytest.skip(allow_module_level=True)\n",
        "test_skipped_blank": 'import pytest\n\npytest.skip("   ", allow_module_level=True)\n',
    }
    result = _run(pytester, "-p", "no:xdist", suite=suite)
    output = result.stdout.str()

    assert result.ret == pytest.ExitCode.INTERRUPTED, output
    assert "test_skipped_bare.py is skipped at its top with no reason given" in output, output
    assert "test_skipped_blank.py is skipped at its top with no reason given" in output, output
    assert "test_skipped_on_purpose.py is skipped" not in output, output
