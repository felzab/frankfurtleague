from pathlib import Path

import pytest

PLUGIN = Path(__file__).resolve().parents[1] / "db_modules.py"

DB_MODULE = "import pytest\n\n\n@pytest.mark.db\ndef test_reads():\n    assert True\n"
PLAIN_MODULE = "def test_runs():\n    assert True\n"
WHOLE_MODULE_DB = "import pytest\n\npytestmark = pytest.mark.db\n\n\ndef test_reads():\n    assert True\n"
# Both spell a case the scan cannot read: the marker imported bare, and one carried by a parameter.
UNREAD_SPELLINGS = {
    "test_bare_mark": "from pytest import mark\n\n\n@mark.db\ndef test_reads():\n    assert True\n",
    "test_param_mark": (
        "import pytest\n\n\n@pytest.mark.parametrize('n', [pytest.param(1, marks=pytest.mark.db), 2])\ndef test_reads(n):\n    assert n\n"
    ),
}
# Spelled at a line's start inside a docstring, where no case carries it.
SPELLED_WITHOUT_A_CASE = '"""Names\n@pytest.mark.db\nin prose."""\n\n\ndef test_runs():\n    assert True\n'
# Named mid-sentence, as a docstring telling a reader to mark a case does.
NAMED_IN_PROSE = '"""Mark a case with `@pytest.mark.db`."""\n\n\ndef test_runs():\n    assert True\n'


def test_this_suite_runs_under_the_scan(request: pytest.FixtureRequest) -> None:
    """The cases below drive a copy of the plugin, so they pass with it unregistered, the db tier then quietly importing every module again."""

    assert request.config.pluginmanager.get_plugin("tests.db_modules") is not None


def _run(pytester: pytest.Pytester, suite: dict[str, str], *flags: str) -> pytest.RunResult:
    pytester.makeini("[pytest]\nmarkers =\n    db: a database case\n")
    pytester.makepyfile(**suite, db_modules=PLUGIN.read_text(encoding="utf-8"))
    pytester.makeconftest('pytest_plugins = ("db_modules",)\n')

    return pytester.runpytest_inprocess("-p", "no:cacheprovider", *flags)


@pytest.mark.parametrize("flags", [pytest.param(("-p", "no:xdist"), id="one-process"), pytest.param(("-n", "2"), id="workers")])
def test_the_db_tier_collects_only_the_modules_spelling_a_db_case(pytester: pytest.Pytester, flags: tuple[str, ...]) -> None:
    """Asked whole, so recursion meets every module; the plain one is never imported, the raise at its top never running."""

    suite = {"test_db": DB_MODULE, "test_whole": WHOLE_MODULE_DB, "test_plain": "raise RuntimeError('imported')\n" + PLAIN_MODULE}
    result = _run(pytester, suite, *flags, "-m", "db")
    output = result.stdout.str()

    assert result.ret == pytest.ExitCode.OK, output
    assert "2 passed" in output, output
    assert "imported" not in output, output


def test_a_module_the_run_names_is_collected_whatever_it_spells(pytester: pytest.Pytester) -> None:
    """`pytest -m db <file>` is how one db file is run; the file it names is the run's to judge."""

    result = _run(pytester, {"test_plain": PLAIN_MODULE}, "-p", "no:xdist", "-m", "db", "test_plain.py")
    output = result.stdout.str()

    assert result.ret == pytest.ExitCode.NO_TESTS_COLLECTED, output
    assert "1 deselected" in output, output


@pytest.mark.parametrize("flags", [pytest.param(("-p", "no:xdist"), id="one-process"), pytest.param(("-n", "2"), id="workers")])
def test_a_db_case_the_scan_cannot_read_fails_its_module_by_name(pytester: pytest.Pytester, flags: tuple[str, ...]) -> None:
    """In the default tier, which collects every db case before deselecting it; the plain and the spelled module stand."""

    result = _run(pytester, {**UNREAD_SPELLINGS, "test_db": DB_MODULE, "test_plain": PLAIN_MODULE}, *flags, "-m", "not db")
    output = result.stdout.str()

    # Not the exit code alone: a worker reports the error and runs on, so the run ends failed rather than interrupted.
    assert result.ret != pytest.ExitCode.OK, output
    for module in UNREAD_SPELLINGS:
        assert f"{module}.py holds a `db` case its source spells neither" in output, output
    assert "test_db.py holds" not in output, output
    assert "test_plain.py holds" not in output, output


def test_a_module_spelling_the_marker_with_no_db_case_fails_by_name(pytester: pytest.Pytester) -> None:
    """The harmless direction, imported for nothing, held anyway so the scan stays the set the tier needs; a mere mention stands."""

    suite = {"test_prose": SPELLED_WITHOUT_A_CASE, "test_mention": NAMED_IN_PROSE, "test_db": DB_MODULE}
    result = _run(pytester, suite, "-p", "no:xdist")
    output = result.stdout.str()

    assert result.ret == pytest.ExitCode.INTERRUPTED, output
    assert "test_prose.py spells `@pytest.mark.db`" in output, output
    assert "test_mention.py spells" not in output, output


def test_a_node_id_run_judges_no_module(pytester: pytest.Pytester) -> None:
    """A node id collects part of its module, whose db cases may lie in the part left out."""

    mixed = "import pytest\n\n\ndef test_runs():\n    assert True\n\n\n@pytest.mark.db\ndef test_reads():\n    assert True\n"
    result = _run(pytester, {"test_mixed": mixed}, "-p", "no:xdist", "test_mixed.py::test_runs")
    output = result.stdout.str()

    assert result.ret == pytest.ExitCode.OK, output
    assert "1 passed" in output, output
