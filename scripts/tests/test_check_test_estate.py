"""SCRIPTS · the backend test estate check, both directions of every rule and every route it walks.

Each rule is driven twice — a corpus that must be refused and one that must not — because a rule
that cannot fire and a rule that always fires are both green here. The reach routes get the same
treatment one at a time: every case below is built so that exactly one route can answer it, or a
route switched off is still caught by a sibling and the mutation goes unnoticed.

The rules run against a corpus this file writes, so they pin the mechanism rather than whatever
`fl_backend/tests/` happens to hold. `main` is driven separately, as a process, the exit contract
being the half a rule test cannot reach.

Stdlib only, and `scripts/checks/` is put on the path here because the module under test is run
as a script everywhere else, which is what seeds that directory onto the path for it.
"""

from __future__ import annotations

import importlib
import subprocess
import sys
from pathlib import Path

from conftest import REPO_ROOT, copy_scripts, new_root, write

SCRIPTS = Path(__file__).resolve().parents[1]

# Withdrawn again, kernel dropped from the cache with it, matching `test_check_compose_mirror.py`:
# a `checker_kernel` left cached here would answer another suite's imports and root it at the wrong
# repository.
sys.path.insert(0, str(SCRIPTS / "checks"))
try:
    estate = importlib.import_module("check_test_estate")
finally:
    sys.path.remove(str(SCRIPTS / "checks"))
    sys.modules.pop("check_test_estate", None)
    sys.modules.pop("checker_kernel", None)

CONTAINER_CONFTEST = """\
import pytest
from pymongo import MongoClient


@pytest.fixture(scope="session")
def mongo_url():
    from testcontainers.community.mongodb import MongoDbContainer

    with MongoDbContainer("mongo:8") as container:
        yield str(container.get_connection_url())


@pytest.fixture(scope="session")
def mongo_database(mongo_url):
    yield MongoClient(mongo_url)["fl_test"]
"""

# No container fixture: one a case never takes would be a second, unrelated finding, and a case
# isolating one reach route needs the conftest chain to answer nothing.
PLAIN_CONFTEST = "import pytest\n"

# Reached three ways below — imported relatively, imported as a module, and called in place — so
# each case varies only the spelling that reaches it.
HELPER_MODULE = "from pymongo import MongoClient\n\n\ndef seed(uri):\n    return MongoClient(uri)\n"

LOUD_CONFIG = '[tool.pytest.ini_options]\nempty_parameter_set_mark = "fail_at_collect"\n'
SILENT_CONFIG = '[tool.pytest.ini_options]\naddopts = "--strict-markers"\n'


def corpus(body: str, shared: str, extra: dict[str, str] | None = None) -> object:
    """An estate holding that conftest, one test module with that body, and any extra modules."""
    root = new_root("estate-")
    write(root, "conftest.py", shared)
    write(root, "api/test_case.py", body)
    for relative, text in (extra or {}).items():
        write(root, relative, text)
    return estate.Estate(root)


def markers(body: str, shared: str = CONTAINER_CONFTEST, extra: dict[str, str] | None = None) -> list[str]:
    """What the database rule says about that module."""
    return [finding.detail for finding in estate.check_db_markers(corpus(body, shared, extra))]


def fixtures(body: str) -> list[str]:
    """What the dead-fixture rule says about that module."""
    return [finding.detail for finding in estate.check_dead_fixtures(corpus(body, PLAIN_CONFTEST))]


def test_a_marked_database_test_is_not_a_finding():
    """The rule reads the marker wherever it sits, or every db-tier module is a finding."""
    assert markers("import pytest\n\n\n@pytest.mark.db\ndef test_reads(mongo_database):\n    assert mongo_database\n") == []


def test_an_unmarked_test_taking_a_container_fixture_is_refused():
    """The whole subject: without the marker it runs in the tier that starts no container."""
    found = markers("def test_reads(mongo_database):\n    assert mongo_database\n")

    assert len(found) == 1
    assert "carries no `@pytest.mark.db`" in found[0]


def test_a_fixture_that_only_imports_a_container_is_a_reach():
    """`mongo_url` builds no client, so the testcontainers import is the only thing left to see."""
    assert len(markers("def test_reads(mongo_url):\n    assert mongo_url\n")) == 1


def test_the_reach_is_transitive_through_a_helper_the_test_calls():
    """No container fixture in this corpus, so nothing but the call into `seed` can answer it."""
    body = HELPER_MODULE + "\n\ndef test_reads(uri):\n    assert seed(uri)\n"

    assert len(markers(body, PLAIN_CONFTEST)) == 1


def test_the_reach_follows_a_relative_import_of_a_sibling():
    """`from .helpers import seed` names the sibling by a level rather than by a dotted path."""
    body = "from .helpers import seed\n\n\ndef test_reads(uri):\n    assert seed(uri)\n"

    assert len(markers(body, PLAIN_CONFTEST, {"api/helpers.py": HELPER_MODULE})) == 1


def test_the_reach_follows_a_helper_reached_through_an_imported_module():
    """`import tests.api.helpers` binds the module, so the helper never appears as a bare name."""
    body = "import tests.api.helpers\n\n\ndef test_reads(uri):\n    assert tests.api.helpers.seed(uri)\n"

    assert len(markers(body, PLAIN_CONFTEST, {"api/helpers.py": HELPER_MODULE})) == 1


def test_a_helper_reached_through_an_imported_module_keeps_the_exemption():
    """The route may not turn the exemption off on its way: same helper, source-written URI."""
    body = (
        'import tests.api.helpers\n\nUNANSWERED_URI = "mongodb://localhost:1"\n\n\n'
        "def test_refused():\n    assert tests.api.helpers.seed(UNANSWERED_URI)\n"
    )

    assert markers(body, PLAIN_CONFTEST, {"api/helpers.py": HELPER_MODULE}) == []


def test_a_fixture_named_by_string_reaches_the_rule():
    """`usefixtures` takes the name as text, so a parameter sweep alone never sees this one."""
    body = 'import pytest\n\n\n@pytest.mark.usefixtures("mongo_database")\ndef test_reads():\n    assert True\n'

    assert len(markers(body)) == 1


def test_a_module_level_pytestmark_asking_by_string_reaches_the_rule():
    """An assignment at module scope sits under no function, so the walk over one never meets it."""
    body = 'import pytest\n\npytestmark = pytest.mark.usefixtures("mongo_database")\n\n\ndef test_reads():\n    assert True\n'

    assert len(markers(body)) == 1


def test_a_class_level_pytestmark_asking_by_string_reaches_the_rule():
    body = (
        "import pytest\n\n\nclass TestReads:\n"
        '    pytestmark = pytest.mark.usefixtures("mongo_database")\n\n'
        "    def test_reads(self):\n        assert True\n"
    )

    assert len(markers(body)) == 1


def test_a_class_decorator_asking_by_string_reaches_the_rule():
    body = 'import pytest\n\n\n@pytest.mark.usefixtures("mongo_database")\nclass TestReads:\n    def test_reads(self):\n        assert True\n'

    assert len(markers(body)) == 1


def test_a_module_level_mark_list_carrying_the_marker_releases_the_string_route():
    """The list spelling is how a module carries both, and the marker still has to win."""
    body = 'import pytest\n\npytestmark = [pytest.mark.db, pytest.mark.usefixtures("mongo_database")]\n\n\ndef test_reads():\n    assert True\n'

    assert markers(body) == []


def test_a_client_aimed_at_a_source_written_uri_needs_no_marker():
    """The idiom that tells a guard refusing from a route that does not exist."""
    body = (
        'from pymongo import MongoClient\n\nUNANSWERED_URI = "mongodb://localhost:1"\n\n\n'
        "def test_refused():\n    assert MongoClient(host=UNANSWERED_URI)\n"
    )

    assert markers(body) == []


def test_the_same_uri_written_at_the_call_needs_no_marker_either():
    """Whether the URI passes through a name decides nothing, or the two spellings disagree."""
    body = 'from pymongo import MongoClient\n\n\ndef test_refused():\n    assert MongoClient("mongodb://localhost:1")\n'

    assert markers(body) == []


def test_a_constant_that_is_not_a_uri_is_no_exemption():
    """`MongoClient("localhost")` reaches the same mongod as the URI naming it."""
    body = 'from pymongo import MongoClient\n\n\ndef test_reads():\n    assert MongoClient("localhost")\n'

    assert len(markers(body, PLAIN_CONFTEST)) == 1


def test_a_uri_naming_the_port_this_repository_serves_is_no_exemption():
    """`docker-compose.local.yml` publishes it, so this passes locally and stalls in CI."""
    body = 'from pymongo import MongoClient\n\n\ndef test_reads():\n    assert MongoClient("mongodb://localhost:27017/frankfurtleague_test")\n'

    assert len(markers(body, PLAIN_CONFTEST)) == 1


def test_a_uri_carrying_no_port_at_all_is_no_exemption():
    """mongod's default puts it on the served port, which the written URI does not say."""
    body = 'from pymongo import MongoClient\n\n\ndef test_reads():\n    assert MongoClient("mongodb://localhost")\n'

    assert len(markers(body, PLAIN_CONFTEST)) == 1


def test_the_exemption_follows_the_constant_into_a_helper():
    """These suites pass that constant to a shared helper rather than building the client in place."""
    body = (
        'from pymongo import MongoClient\n\nUNANSWERED_URI = "mongodb://localhost:1"\n\n\n'
        "def answered(uri):\n    return MongoClient(host=uri)\n\n\n"
        "def test_refused():\n    assert answered(UNANSWERED_URI)\n"
    )

    assert markers(body) == []


def test_one_helper_answers_differently_for_its_two_call_sites():
    """The reaching call site is written first on purpose.

    The reach cache is keyed by the binding, and without that the exempt call site behind this one
    inherits the answer cached here and is refused.
    """
    body = (
        'from pymongo import MongoClient\n\nUNANSWERED_URI = "mongodb://localhost:1"\n\n\n'
        "def answered(uri):\n    return MongoClient(host=uri)\n\n\n"
        "def test_reads(mongo_url):\n    assert answered(mongo_url)\n\n\n"
        "def test_refused():\n    assert answered(UNANSWERED_URI)\n"
    )
    found = markers(body)

    assert len(found) == 1
    assert "test_reads" in found[0]


def test_the_exemption_stops_where_the_uri_stops_being_a_literal():
    """The direction that matters: released on the shape alone, the rule would never fire again."""
    body = "from pymongo import MongoClient\n\n\ndef test_reads(mongo_url):\n    assert MongoClient(host=mongo_url)\n"

    assert len(markers(body)) == 1


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
    write(root, "fl_backend/tests/conftest.py", CONTAINER_CONFTEST)
    marked = "import pytest\n\n\n@pytest.mark.db\ndef test_reads(mongo_database):\n    assert mongo_database\n"
    write(root, "fl_backend/tests/api/test_case.py", marked)
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

    An edit to the checker selects the scripts scope and never the backend one, so a change that
    starts refusing a correct tree fails the next backend branch instead.
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
