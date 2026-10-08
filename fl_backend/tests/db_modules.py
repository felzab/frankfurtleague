"""TESTS · the db tier collects only the test modules whose source spells a db case.

`pytest -m db` deselects after collection, so every worker would import every module, and pay for the
sweeps and builds at their tops, before running one db case. Whether a module holds one is read off its
source, and every run collecting whole modules holds that reading to the markers pytest collects, so a
db case spelled another way fails its module by name rather than silently leaving the tier.
`fl_backend/tests/conftest.py` registers this as a plugin for every run, both tiers alike.
"""

import re
from pathlib import Path
from typing import Final

import pytest

# `@pytest.mark.db` over a case or a class, or a `pytestmark` line naming it. Anchored at a line's
# start, so prose naming the marker mid-sentence spells no case.
DB_CASE: Final = re.compile(rb"^[ \t]*(?:@pytest\.mark\.db\b|pytestmark[ \t]*=.*\bmark\.db\b)", re.MULTILINE)

_SPELLED_ELSEWHERE = (
    "{module} holds a `db` case its source spells neither as `@pytest.mark.db` nor in a `pytestmark` line,"
    " so `pytest -m db` never collects it: spell the marker one of those two ways."
)
_SPELLED_WITHOUT_A_CASE = (
    "{module} spells `@pytest.mark.db` or a `pytestmark` naming it at a line's start and collects no `db` case,"
    " so `pytest -m db` imports it for nothing: mark a case, or reword the line."
)


def spells_a_db_case(path: Path) -> bool:
    return DB_CASE.search(path.read_bytes()) is not None


def _db_tier(config: pytest.Config) -> bool:
    """The tier's own expression alone: any other selects by more than this marker, so it collects every module."""

    return config.option.markexpr.strip() == "db"


def pytest_ignore_collect(collection_path: Path, config: pytest.Config) -> bool | None:
    """pytest never asks this of a path the run names, so `pytest -m db <file>` collects that file whatever it spells."""

    if _db_tier(config) and collection_path.suffix == ".py" and collection_path.name.startswith("test_"):
        return None if spells_a_db_case(collection_path) else True
    return None


def _holds_whole_modules(config: pytest.Config) -> bool:
    """A node id, or `--lf` narrowing a module to its last failures, collects part of a module, whose `db` cases may lie in the rest."""

    return not any("::" in str(arg) for arg in config.args) and not config.getoption("lf", False)


@pytest.hookimpl(tryfirst=True)
def pytest_collection_modifyitems(session: pytest.Session, config: pytest.Config, items: list[pytest.Item]) -> None:
    """Ahead of the `-m` deselection, so the default tier still sees every `db` case it will not run."""

    if not _holds_whole_modules(config):
        return

    carrying: dict[str, tuple[Path, bool]] = {}
    for item in items:
        module = item.getparent(pytest.Module)
        if module is not None:
            held = carrying.get(module.nodeid, (module.path, False))[1]
            carrying[module.nodeid] = (module.path, held or item.get_closest_marker("db") is not None)

    for nodeid, (path, carries) in carrying.items():
        if carries != spells_a_db_case(path):
            message = (_SPELLED_ELSEWHERE if carries else _SPELLED_WITHOUT_A_CASE).format(module=nodeid)
            session.ihook.pytest_collectreport(report=pytest.CollectReport(nodeid, "failed", message, []))
