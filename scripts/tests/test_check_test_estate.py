"""SCRIPTS · the backend test estate check, both directions of every rule.

Each rule is driven twice — a corpus that must be refused and one that must not — because a rule
that cannot fire and a rule that always fires are both green here.

The rules run against a corpus this file writes, so they pin the mechanism rather than whatever
`fl_backend/tests/` happens to hold. `main` is driven separately, as a process, the exit contract
being the half a rule test cannot reach.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from conftest import REPO_ROOT, copy_scripts, import_scripts, new_root, write

SCRIPTS = Path(__file__).resolve().parents[1]

[estate] = import_scripts("check_test_estate")

# No fixture at all: one a case never takes would be a second, unrelated finding.
PLAIN_CONFTEST = "import pytest\n"

LOUD_CONFIG = '[tool.pytest.ini_options]\nempty_parameter_set_mark = "fail_at_collect"\n'
SILENT_CONFIG = '[tool.pytest.ini_options]\naddopts = "--strict-markers"\n'


def corpus(body: str, shared: str) -> object:
    """An estate holding that conftest and one test module with that body."""
    root = new_root("estate-")
    write(root, "conftest.py", shared)
    write(root, "api/test_case.py", body)
    return estate.Estate(root)


def fixtures(body: str) -> list[str]:
    """What the dead-fixture rule says about that module."""
    return [finding.detail for finding in estate.check_dead_fixtures(corpus(body, PLAIN_CONFTEST))]


def test_a_fixture_no_test_consumes_is_refused():
    """A guarantee deleted from one end only, which every other tool here reads as live code."""
    body = "import pytest\n\n\n@pytest.fixture\ndef orphan():\n    return 1\n\n\ndef test_nothing():\n    assert True\n"
    found = fixtures(body)

    assert len(found) == 1
    assert "`orphan`" in found[0]


def test_an_autouse_fixture_is_consumed_by_nobody_and_still_live():
    """Named by no test by definition, so without this exemption every one of them is a finding."""
    body = "import pytest\n\n\n@pytest.fixture(autouse=True)\ndef _seeded():\n    yield\n\n\ndef test_nothing():\n    assert True\n"

    assert fixtures(body) == []


def test_a_renamed_fixture_is_read_under_the_name_pytest_registers():
    """`name=` is what a test may ask for, so the function's own name proves nothing either way."""
    live = 'import pytest\n\n\n@pytest.fixture(name="league")\ndef _league():\n    return 1\n\n\ndef test_reads(league):\n    assert league\n'
    dead = 'import pytest\n\n\n@pytest.fixture(name="league")\ndef _league():\n    return 1\n\n\ndef test_nothing():\n    assert True\n'

    assert fixtures(live) == []
    assert "`league`" in fixtures(dead)[0]


def repository(config: str) -> Path:
    """A throwaway repository holding a copy of scripts/ and a backend the checker can read.

    Its one test is clean by every rule at once, so the configuration is the only thing a case
    varies.
    """
    root = new_root("estate-repo-")
    copy_scripts(root / "scripts")
    write(root, "fl_backend/pyproject.toml", config)
    write(root, "fl_backend/tests/conftest.py", PLAIN_CONFTEST)
    write(root, "fl_backend/tests/api/test_case.py", "def test_nothing():\n    assert True\n")
    return root


def run_main(root: Path) -> subprocess.CompletedProcess[str]:
    """The checker as its own process, so the status read is the one it exited with."""
    return subprocess.run(
        [sys.executable, str(root / "scripts" / "checks" / "check_test_estate.py")],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def test_a_clean_estate_exits_zero():
    """A checker that cannot pass is as useless as one that cannot fail."""
    assert run_main(repository(LOUD_CONFIG)).returncode == 0


def test_a_configuration_leaving_the_default_in_place_exits_one():
    """pytest's default turns a sweep whose discovery broke into one silent skip."""
    done = run_main(repository(SILENT_CONFIG))

    assert done.returncode == 1
    assert "empty_parameter_set_mark" in done.stdout


def test_a_missing_test_tree_is_refused_rather_than_passed():
    """Nothing read is not nothing found, and the exit contract spells that 2."""
    root = new_root("estate-bare-")
    copy_scripts(root / "scripts")
    write(root, "fl_backend/pyproject.toml", LOUD_CONFIG)

    assert run_main(root).returncode == 2


def test_the_real_backend_estate_is_judged_and_passes():
    """The corpora above are planted; this one is the real tree.

    The scripts scope run alone never reaches the backend scope's estate step, so a change to the
    checker that starts refusing a correct tree fails here first.
    """
    done = run_main(REPO_ROOT)

    assert done.returncode == 0, done.stdout + done.stderr


def test_a_module_that_will_not_parse_is_refused_rather_than_crashing():
    """The same contract as an absent tree: an input this could not judge, and 3 is the machine."""
    root = repository(LOUD_CONFIG)
    write(root, "fl_backend/tests/api/test_broken.py", "def test_reads(:\n")
    done = run_main(root)

    assert done.returncode == 2
    assert "could not be parsed" in done.stderr
