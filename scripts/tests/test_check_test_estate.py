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
from typing import Any

import pytest
from conftest import REPO_ROOT, copy_scripts, import_scripts, new_root, write

SCRIPTS = Path(__file__).resolve().parents[1]

[estate] = import_scripts("check_test_estate")

# No fixture at all: one a case never takes would be a second, unrelated finding.
PLAIN_CONFTEST = "import pytest\n"

LOUD_CONFIG = '[tool.pytest.ini_options]\nempty_parameter_set_mark = "fail_at_collect"\n'
SILENT_CONFIG = '[tool.pytest.ini_options]\naddopts = "--strict-markers"\n'


def corpus(body: str, shared: str) -> Any:
    """An estate holding that conftest and one test module with that body."""
    root = new_root("estate-")
    write(root, "conftest.py", shared)
    write(root, "api/test_case.py", body)
    return estate.Estate(root)


def fixtures(body: str) -> list[str]:
    """What the dead-fixture rule says about that module, which must be one the estate judges.

    A module it refuses defines no fixture, so it would answer no finding for any body at all.
    """
    built = corpus(body, PLAIN_CONFTEST)
    assert built.unfollowed == [], built.unfollowed
    return [finding.detail for finding in estate.check_dead_fixtures(built)]


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


ORPHAN = "import pytest\n\n\n@pytest.fixture\ndef league():\n    return 1\n\n\n"


def test_a_helper_parameter_sharing_the_fixture_s_name_excuses_nothing():
    """Neither a module function nor a method outside a `Test` class is collected, so pytest hands neither a fixture."""
    body = ORPHAN + "def build(league):\n    return league\n\n\nclass Helper:\n    def test_reads(self, league):\n        return league\n"
    found = fixtures(body)

    assert len(found) == 1 and "`league`" in found[0], found


def test_a_test_function_outside_a_test_file_excuses_nothing():
    """pytest collects `test_*.py` and `*_test.py` alone, so a `test` function in a helper module is no test."""
    root = new_root("estate-helper-")
    write(root, "conftest.py", PLAIN_CONFTEST)
    write(root, "api/test_case.py", ORPHAN + "def test_nothing():\n    assert True\n")
    write(root, "api/helpers.py", "def test_like(league):\n    return league\n")

    found = [finding.detail for finding in estate.check_dead_fixtures(estate.Estate(root))]

    assert len(found) == 1 and "`league`" in found[0], found


def test_every_consumer_pytest_hands_a_fixture_to_excuses_it():
    """A test, a test method at any `Test` class depth, another fixture, a `usefixtures`, and a `getfixturevalue` string.

    The string counts where a test or a fixture runs it, or a function or a lambda it calls by name.
    """
    for consumer in (
        "def test_reads(league):\n    assert league\n",
        "class TestOuter:\n    class TestInner:\n        def test_reads(self, league):\n            assert league\n",
        "class TestStatic:\n    @staticmethod\n    def test_reads(league):\n        assert league\n",
        "@pytest.fixture\ndef season(league):\n    return league\n\n\ndef test_reads(season):\n    assert season\n",
        '@pytest.mark.usefixtures("league")\ndef test_reads():\n    assert True\n',
        '@pytest.mark.usefixtures("league")\nclass TestMarked:\n    def test_reads(self):\n        assert True\n',
        'pytestmark = [pytest.mark.usefixtures("league")]\n\n\ndef test_reads():\n    assert True\n',
        'def test_reads(request):\n    assert request.getfixturevalue("league")\n',
        'def asked(request):\n    return request.getfixturevalue("league")\n\n\ndef test_reads(request):\n    assert asked(request)\n',
        'def test_reads(request):\n    def asked():\n        return request.getfixturevalue("league")\n\n    assert asked()\n',
        'def test_reads(request):\n    asked = lambda: request.getfixturevalue("league")\n    assert asked()\n',
        # A closure calling its sibling, which only the enclosing function binds.
        'def test_reads(request):\n    def asked():\n        return request.getfixturevalue("league")\n\n'
        "    def outer():\n        return asked()\n\n    assert outer()\n",
        "def test_reads(request):\n    def bound(name=request.getfixturevalue('league')):\n        return name\n\n    assert True\n",
    ):
        assert fixtures(ORPHAN + consumer) == [], consumer


@pytest.mark.parametrize(
    "recursive",
    [
        pytest.param(
            'def asked(request, depth):\n    return request.getfixturevalue("league") if depth == 0 else asked(request, depth - 1)\n\n\n'
            "def test_reads(request):\n    assert asked(request, 2)\n",
            id="calling-itself",
        ),
        pytest.param(
            'def even(request, depth):\n    return request.getfixturevalue("league") if depth == 0 else odd(request, depth - 1)\n\n\n'
            "def odd(request, depth):\n    return even(request, depth - 1)\n\n\n"
            "def test_reads(request):\n    assert even(request, 2)\n",
            id="calling-each-other",
        ),
    ],
)
def test_a_helper_reached_again_through_a_call_cycle_still_excuses_its_fixture(recursive: str):
    """The cycle is the case that ends the walk only through its record of what it reached."""
    assert fixtures(ORPHAN + recursive) == []


def test_a_helper_two_fixtures_reach_asks_from_each_of_them():
    """From `league`, the helper's request is `league` asking its own name, which excuses nothing; from `season` it consumes it."""
    body = (
        'import pytest\n\n\ndef asked(request):\n    return request.getfixturevalue("league")\n\n\n'
        "@pytest.fixture\ndef league(request):\n    return asked(request)\n\n\n"
        "@pytest.fixture\ndef season(request):\n    return asked(request)\n\n\n"
        "def test_reads(season):\n    assert season\n"
    )

    assert fixtures(body) == []


@pytest.mark.parametrize(
    "unreached",
    [
        pytest.param('def helper(request):\n    return request.getfixturevalue("league")\n', id="uncalled-helper"),
        pytest.param('MARK = pytest.mark.usefixtures("league")\n', id="mark-held-in-a-variable"),
        pytest.param('@pytest.mark.usefixtures("league")\ndef helper():\n    return 1\n', id="mark-on-a-helper"),
        pytest.param(
            'def test_closure(request):\n    def never():\n        return request.getfixturevalue("league")\n\n    assert True\n',
            id="uncalled-nested-function",
        ),
        pytest.param(
            'def test_lambda(request):\n    never = lambda: request.getfixturevalue("league")\n    assert True\n', id="uncalled-lambda"
        ),
        pytest.param(
            'def asked(request):\n    return request.getfixturevalue("league")\n\n\n'
            "def test_closure(request):\n    def never():\n        return asked(request)\n\n    assert True\n",
            id="helper-called-only-from-an-uncalled-nested-function",
        ),
    ],
)
def test_a_by_name_request_pytest_never_acts_on_excuses_nothing(unreached: str):
    """A string only counts where pytest reads it."""
    found = fixtures(ORPHAN + unreached + "\n\ndef test_nothing():\n    assert True\n")

    assert len(found) == 1 and "`league`" in found[0], found


@pytest.mark.parametrize(
    "importing",
    [
        pytest.param("from tests.support.helpers import asked\n\n\ndef test_reads(request):\n    assert asked(request)\n", id="name"),
        pytest.param("from tests.support import helpers\n\n\ndef test_reads(request):\n    assert helpers.asked(request)\n", id="module"),
        pytest.param("from ..support.helpers import asked\n\n\ndef test_reads(request):\n    assert asked(request)\n", id="relative"),
    ],
)
def test_a_helper_in_another_module_is_reached_through_its_import(importing: str):
    """pytest runs whatever a test calls, wherever it is defined, so the request there counts.

    Spelled through the test package's own name, as `fl_backend/tests/` imports its helpers.
    """
    root = new_root("estate-imported-") / "tests"
    write(root, "conftest.py", ORPHAN)
    write(root, "support/helpers.py", 'def asked(request):\n    return request.getfixturevalue("league")\n')
    write(root, "api/test_case.py", importing)

    assert estate.check_dead_fixtures(estate.Estate(root)) == []


def test_the_configuration_s_usefixtures_excuses_a_fixture_no_test_names():
    """pytest hands it every test (https://docs.pytest.org/en/stable/how-to/fixtures.html#use-fixtures-in-classes-and-modules-with-usefixtures)."""
    tree = corpus(ORPHAN + "def test_nothing():\n    assert True\n", PLAIN_CONFTEST)

    assert estate.check_dead_fixtures(tree, estate.configured_fixtures({"usefixtures": ["league"]})) == []


def dead_in(files: dict[str, str]) -> list[str]:
    """The fixtures an estate of these files leaves dead, by name."""
    root = new_root("estate-scoped-")
    for rel, text in files.items():
        write(root, rel, text)
    built = estate.Estate(root)
    assert built.unfollowed == [], built.unfollowed
    return sorted(finding.detail.split("`")[1] for finding in estate.check_dead_fixtures(built))


ASKS_LEAGUE = "def test_reads(league):\n    assert league\n"

# A fixture only `TestOwner`'s own tests, and those of the classes nested in it, are supplied with.
CLASS_FIXTURE = "import pytest\n\n\nclass TestOwner:\n    @pytest.fixture\n    def league(self):\n        return 1\n"


@pytest.mark.parametrize(
    ("files", "dead"),
    [
        pytest.param(
            {"api/test_owner.py": ORPHAN + "def test_nothing():\n    assert True\n", "core/test_other.py": ASKS_LEAGUE},
            ["league"],
            id="module-fixture-asked-elsewhere",
        ),
        pytest.param({"api/conftest.py": ORPHAN, "core/test_other.py": ASKS_LEAGUE}, ["league"], id="conftest-asked-outside-its-directory"),
        pytest.param({"api/conftest.py": ORPHAN, "api/deep/test_below.py": ASKS_LEAGUE}, [], id="conftest-asked-below-it"),
        pytest.param({"conftest.py": ORPHAN, "api/test_any.py": ASKS_LEAGUE}, [], id="root-conftest-asked-anywhere"),
        pytest.param(
            {"api/test_case.py": CLASS_FIXTURE + "\n\nclass TestOther:\n    def test_reads(self, league):\n        assert league\n"},
            ["league"],
            id="class-fixture-asked-from-another-class",
        ),
        pytest.param(
            {"api/test_case.py": CLASS_FIXTURE + "\n    class TestInner:\n        def test_reads(self, league):\n            assert league\n"},
            [],
            id="class-fixture-asked-from-a-nested-class",
        ),
        pytest.param(
            {
                "conftest.py": ORPHAN,
                "api/conftest.py": "import pytest\n\n\n@pytest.fixture\ndef league(league):\n    return league\n",
                "api/test_case.py": ASKS_LEAGUE,
            },
            [],
            id="override-asks-for-the-fixture-it-replaces",
        ),
        pytest.param(
            {"conftest.py": ORPHAN, "api/test_case.py": ORPHAN + ASKS_LEAGUE},
            ["league"],
            id="shadowed-by-a-module-override-asking-nothing",
        ),
        pytest.param(
            {"conftest.py": ORPHAN, "api/conftest.py": ORPHAN, "api/test_case.py": ASKS_LEAGUE},
            ["league"],
            id="shadowed-by-a-nearer-conftest-asking-nothing",
        ),
        pytest.param(
            {
                "conftest.py": ORPHAN,
                "api/conftest.py": ORPHAN,
                "api/test_case.py": "import pytest\n\n\n@pytest.fixture\ndef season(league):\n    return league\n\n\n"
                "def test_reads(season):\n    assert season\n",
            },
            ["league"],
            id="shadowed-where-a-fixture-asks-for-it",
        ),
        pytest.param(
            {"conftest.py": "import pytest\n\n\n@pytest.fixture\ndef league(league):\n    return league\n"},
            ["league"],
            id="a-fixture-asking-its-own-name-asks-no-one",
        ),
        pytest.param(
            {
                "api/test_owner.py": ORPHAN + "def test_nothing():\n    assert True\n",
                "api/test_user.py": "from .test_owner import league\n\n\n" + ASKS_LEAGUE,
            },
            [],
            id="imported-into-the-asking-module",
        ),
        pytest.param(
            {
                "api/test_owner.py": ORPHAN + "def test_nothing():\n    assert True\n",
                "api/test_user.py": "from .test_owner import league as season\n\n\ndef test_reads(season):\n    assert season\n",
            },
            [],
            id="asked-under-the-alias-it-is-imported-as",
        ),
        pytest.param(
            {
                "api/test_owner.py": ORPHAN + "def test_nothing():\n    assert True\n",
                "api/test_user.py": "from .test_owner import league as season\n\n\n" + ASKS_LEAGUE,
            },
            ["league"],
            id="asked-by-its-own-name-where-only-the-alias-is-bound",
        ),
        pytest.param(
            {
                "api/test_owner.py": 'import pytest\n\n\n@pytest.fixture(name="league")\ndef _league():\n    return 1\n',
                "api/test_user.py": "from .test_owner import _league as season\n\n\n" + ASKS_LEAGUE,
            },
            [],
            id="a-name-argument-wins-over-the-alias",
        ),
        pytest.param(
            {"api/test_case.py": ORPHAN + "season = league\n\n\ndef test_reads(season):\n    assert season\n"},
            [],
            id="bound-to-a-second-name-in-its-own-module",
        ),
    ],
)
def test_a_fixture_is_consumed_only_where_pytest_would_supply_it(files: dict[str, str], dead: list[str]):
    """A same-named parameter elsewhere is answered by another fixture, or by none."""
    assert dead_in(files) == dead


# One test in the class above it, asking for `league`.
ASKS_IN_A_CLASS = "    def test_reads(self, league):\n        assert league\n"


@pytest.mark.parametrize(
    ("asking", "dead"),
    [
        pytest.param("class TestBuilt:\n    def __init__(self):\n        pass\n\n" + ASKS_IN_A_CLASS, ["league"], id="its-own-init"),
        pytest.param(
            "class TestBuilt:\n    def __new__(cls):\n        return super().__new__(cls)\n\n" + ASKS_IN_A_CLASS, ["league"], id="its-own-new"
        ),
        pytest.param(
            "class Base:\n    def __init__(self):\n        pass\n\n\nclass TestBuilt(Base):\n" + ASKS_IN_A_CLASS,
            ["league"],
            id="an-inherited-init",
        ),
        pytest.param("class TestBuilt:\n    __test__ = False\n\n" + ASKS_IN_A_CLASS, ["league"], id="a-false-test-switch"),
        pytest.param(
            "class TestOuter:\n    def __init__(self):\n        pass\n\n    class TestInner:\n"
            "        def test_reads(self, league):\n            assert league\n",
            ["league"],
            id="nested-in-an-uncollected-class",
        ),
        pytest.param("__test__ = False\n\n\n" + ASKS_LEAGUE, ["league"], id="a-false-test-switch-on-the-module"),
        pytest.param("class TestBuilt:\n    __test__ = True\n\n" + ASKS_IN_A_CLASS, [], id="a-true-test-switch"),
        pytest.param("class TestBuilt(object):\n" + ASKS_IN_A_CLASS, [], id="based-on-object"),
        pytest.param("@pytest.mark.db\nclass TestMarked:\n" + ASKS_IN_A_CLASS, [], id="a-mark"),
        pytest.param(
            "class Base:\n    def helper(self):\n        return 1\n\n\nclass TestBuilt(Base):\n" + ASKS_IN_A_CLASS,
            [],
            id="based-on-a-class-with-no-constructor",
        ),
    ],
)
def test_a_test_class_pytest_never_collects_asks_for_nothing(asking: str, dead: list[str]):
    """pytest skips a class with a constructor of its own or inherited, and a class or module whose `__test__` is false."""
    assert dead_in({"api/test_case.py": ORPHAN + asking}) == dead


@pytest.mark.parametrize(
    ("asking", "said"),
    [
        pytest.param("from support import Base\n\n\nclass TestBuilt(Base):\n" + ASKS_IN_A_CLASS, "whose constructor", id="imported-base"),
        pytest.param("class TestBuilt:\n    __test__ = bool(1)\n\n" + ASKS_IN_A_CLASS, "`__test__`", id="computed-test-switch"),
        pytest.param("from dataclasses import dataclass\n\n\n@dataclass\nclass TestBuilt:\n" + ASKS_IN_A_CLASS, "decorates", id="a-dataclass"),
        pytest.param(
            "from dataclasses import dataclass\n\n\n@dataclass\nclass Base:\n    league: int = 1\n\n\nclass TestBuilt(Base):\n"
            + ASKS_IN_A_CLASS,
            "decorates",
            id="based-on-a-dataclass",
        ),
        pytest.param(
            "from abc import ABCMeta, abstractmethod\n\n\nclass TestBuilt(metaclass=ABCMeta):\n    @abstractmethod\n    def build(self):\n"
            "        return 1\n\n" + ASKS_IN_A_CLASS,
            "metaclass=ABCMeta",
            id="an-abstract-class",
        ),
    ],
)
def test_a_class_whose_collection_this_cannot_read_leaves_the_module_unjudged(asking: str, said: str):
    tree = corpus(ORPHAN + asking, PLAIN_CONFTEST)

    assert [path.name for path, _ in tree.unfollowed] == ["test_case.py"]
    assert said in tree.unfollowed[0][1]


def test_a_module_pytest_plugins_names_supplies_every_test():
    """Spelled as `fl_backend/tests/conftest.py` spells its own entry; without the entry the module supplies only itself."""
    root = new_root("estate-plugins-") / "tests"
    write(root, "support/plugin.py", ORPHAN)
    write(root, "api/test_case.py", ASKS_LEAGUE)
    write(root, "conftest.py", "import pytest\n")
    unnamed = estate.check_dead_fixtures(estate.Estate(root))
    write(root, "conftest.py", 'pytest_plugins = ("pytester", "tests.support.plugin")\n')

    assert len(unnamed) == 1 and "`league`" in unnamed[0].detail, unnamed
    assert estate.check_dead_fixtures(estate.Estate(root)) == []


@pytest.mark.parametrize(
    ("consumer", "dead"),
    [
        pytest.param('@pytest.mark.parametrize("league", [1])\n' + ASKS_LEAGUE, ["league"], id="parametrized-directly"),
        pytest.param(
            '@pytest.mark.parametrize("season, league", [(1, 2)])\n' + "def test_reads(season, league):\n    assert league\n",
            ["league"],
            id="among-several-names",
        ),
        pytest.param('@pytest.mark.parametrize(("league",), [(1,)])\n' + ASKS_LEAGUE, ["league"], id="names-as-a-tuple"),
        pytest.param('@pytest.mark.parametrize("league", [1], indirect=True)\n' + ASKS_LEAGUE, [], id="indirect-hands-it-to-the-fixture"),
        pytest.param('@pytest.mark.parametrize("league", [1], indirect=["league"])\n' + ASKS_LEAGUE, [], id="indirect-by-name"),
        pytest.param(
            '@pytest.mark.parametrize("league", [1])\nclass TestMarked:\n    def test_reads(self, league):\n        assert league\n',
            ["league"],
            id="parametrized-on-the-class",
        ),
        pytest.param('pytestmark = pytest.mark.parametrize("league", [1])\n\n\n' + ASKS_LEAGUE, ["league"], id="parametrized-by-pytestmark"),
        pytest.param("def test_reads(league=None):\n    assert league is None\n", ["league"], id="a-default-is-no-request"),
        pytest.param(
            "class TestBound:\n    def test_reads(league):\n        assert league\n", ["league"], id="a-method-s-first-is-its-instance"
        ),
    ],
)
def test_an_argument_pytest_fills_itself_asks_no_fixture(consumer: str, dead: list[str]):
    """The parametrize value or the default is what the test receives, so the fixture of that name is never called."""
    assert dead_in({"conftest.py": PLAIN_CONFTEST, "api/test_case.py": ORPHAN + consumer}) == dead


@pytest.mark.parametrize(
    ("body", "said"),
    [
        pytest.param("from pytest import fixture\n", "imports `fixture` by name", id="imported-by-name"),
        pytest.param(
            "import pytest\nfixture = pytest.fixture\n\n\n@fixture\ndef league():\n    return 1\n", "a bare `fixture`", id="bare-decorator"
        ),
        pytest.param(
            "import pytest\nNAME = 'league'\n\n\n@pytest.fixture(name=NAME)\ndef _league():\n    return 1\n",
            "by an expression",
            id="computed-name",
        ),
        pytest.param(
            "import pytest\nNAME = 'league'\n\n\n@pytest.mark.usefixtures(NAME)\ndef test_reads():\n    assert True\n",
            "no string literal",
            id="computed-request",
        ),
        pytest.param(
            "import pytest\nNAMES = 'league'\n\n\n@pytest.mark.parametrize(NAMES, [1])\ndef test_reads(league):\n    assert league\n",
            "parametrizes by names",
            id="computed-parametrize",
        ),
        pytest.param(
            "import pytest\n\n\ndef build():\n    @pytest.fixture\n    def league():\n        return 1\n",
            "inside a function",
            id="nested-fixture",
        ),
        pytest.param(
            'from unittest import mock\n\n\n@mock.patch("os.getcwd")\ndef test_reads(league):\n    assert league\n',
            "patches `test_reads`",
            id="mock-patch",
        ),
        pytest.param(
            'import os\nfrom unittest import mock\n\n\n@mock.patch.object(os, "getcwd")\ndef test_reads(league):\n    assert league\n',
            "patches `test_reads`",
            id="patch-object",
        ),
        pytest.param(
            "import os\nfrom unittest import mock\n\n\n@mock.patch.dict(os.environ, {})\ndef test_reads(league):\n    assert league\n",
            "patches `test_reads`",
            id="patch-dict",
        ),
        pytest.param(
            'from unittest import mock\n\n\n@mock.patch("os.getcwd")\nclass TestPatched:\n'
            "    def test_reads(self, league):\n        assert league\n",
            # Refused as a class decorator before its patch is read, either refusal leaving the module unjudged.
            "decorates `TestPatched`",
            id="patch-on-the-class",
        ),
        pytest.param(
            'from unittest.mock import patch as fake\n\n\n@fake("os.getcwd")\ndef test_reads(league):\n    assert league\n',
            "patches `test_reads`",
            id="patch-under-an-alias",
        ),
        pytest.param(
            "from unittest import mock\n\npatched = mock.patch('os.getcwd')\n\n\n@patched\ndef test_reads(league):\n    assert league\n",
            "patches `test_reads`",
            id="patch-bound-to-a-name",
        ),
        pytest.param(
            "from unittest import mock\n\npatched = mock.patch('os.getcwd')\nrepatched = patched\n\n\n"
            "@repatched\ndef test_reads(league):\n    assert league\n",
            "patches `test_reads`",
            id="patch-bound-through-a-second-name",
        ),
        pytest.param(
            'NAME = "league"\n\n\ndef asked(request):\n    return request.getfixturevalue(NAME)\n\n\n'
            "def test_reads(request):\n    assert asked(request)\n",
            # Asked in a helper the test reaches by calling it, where the refusal is raised on the way down.
            "no string literal",
            id="computed-request-in-a-reached-helper",
        ),
    ],
)
def test_a_spelling_this_cannot_follow_leaves_the_module_unjudged(body: str, said: str):
    """Judged, each would read a live fixture as dead or a dead one as live."""
    tree = corpus(body, PLAIN_CONFTEST)

    assert [path.name for path, _ in tree.unfollowed] == ["test_case.py"]
    assert said in tree.unfollowed[0][1]


@pytest.mark.parametrize("key", ["python_files", "python_classes", "python_functions"])
def test_a_collection_of_the_configuration_s_own_is_refused(key: str):
    with pytest.raises(estate.Unfollowed, match=key):
        estate.configured_fixtures({key: ["check_*"]})


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


def test_a_fixture_this_cannot_follow_is_refused_at_2_rather_than_judged():
    """The exit contract's refusal, never a finding: the tree may be correct, and this could not tell."""
    root = repository(LOUD_CONFIG)
    write(root, "fl_backend/tests/api/test_bare.py", "from pytest import fixture\n")
    done = run_main(root)

    assert done.returncode == 2
    assert "imports `fixture` by name" in done.stderr


def test_a_collection_of_the_configuration_s_own_exits_two():
    done = run_main(repository(LOUD_CONFIG + 'python_functions = ["check_*"]\n'))

    assert done.returncode == 2
    assert "python_functions" in done.stderr


def test_main_reads_the_configuration_s_usefixtures():
    """The configured fixture is named by no test, so only the settings `main` reads can excuse it."""
    root = repository(LOUD_CONFIG + 'usefixtures = ["league"]\n')
    write(root, "fl_backend/tests/conftest.py", ORPHAN)
    done = run_main(root)

    assert done.returncode == 0, done.stdout + done.stderr
