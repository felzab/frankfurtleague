"""TESTS · a test module that collects no test fails its collection.

pytest reports such a module nowhere and the run stays green, so a module whose every test was
renamed out of pytest's prefixes, or whose class lost its `Test` prefix or gained a constructor,
takes its guarantees with it unseen. `fl_backend/tests/conftest.py` registers this as a plugin for every run, both tiers alike.
"""

from collections.abc import Generator
from typing import Final

import pytest

_COLLECTS_NOTHING = (
    "{module} collects no test. pytest would run it as green with nothing in it: name its tests and their classes with"
    " pytest's prefixes and give no test class a constructor, or skip the module at its top with a reason."
)

# Each module an item was collected under, which a class collecting nothing never adds.
_YIELDING: Final = pytest.StashKey[set[str]]()

_SKIPPED_WITHOUT_REASON = (
    "{module} is skipped at its top with no reason given: name why in its skip, as a module collecting nothing gives none."
)


def _skipped_by_last_failed(collector: pytest.Collector) -> bool:
    """Whether `--lf` answered this module collected with nothing, never collecting it.

    Once a run under it has found a last failure, pytest registers its `LFPluginCollSkipfiles`, which
    answers each module outside the last-failed paths that way.
    """
    if collector.config.pluginmanager.get_plugin("lfplugin-collskip") is None:
        return False
    last_failed = collector.config.pluginmanager.get_plugin("lfplugin")
    return last_failed is not None and collector.path not in last_failed.get_last_failed_paths()


def _skip_reason(report: pytest.CollectReport) -> str:
    """The reason a module-level skip gave, read off the line pytest records for it.

    pytest writes the skip as its exception's own line, `Skipped: <reason>`, and as `Skipped` alone
    where the reason is empty or blank.
    """
    if not isinstance(report.longrepr, tuple):
        return ""
    return report.longrepr[2].partition(": ")[2].strip()


@pytest.hookimpl(wrapper=True)
def pytest_make_collect_report(collector: pytest.Collector) -> Generator[None, pytest.CollectReport, pytest.CollectReport]:
    report = yield
    # A module-level skip reports skipped rather than passed, so a module skipped on purpose stands.
    if isinstance(collector, pytest.Module) and report.passed and not report.result and not _skipped_by_last_failed(collector):
        report.outcome = "failed"
        report.longrepr = _COLLECTS_NOTHING.format(module=collector.nodeid)
    # Where it says why: a bare skip is the same silence as a module collecting nothing.
    elif isinstance(collector, pytest.Module) and report.skipped and not _skip_reason(report):
        report.outcome = "failed"
        report.longrepr = _SKIPPED_WITHOUT_REASON.format(module=collector.nodeid)

    return report


def pytest_itemcollected(item: pytest.Item) -> None:
    module = item.getparent(pytest.Module)
    if module is not None:
        item.config.stash.setdefault(_YIELDING, set()).add(module.nodeid)


@pytest.hookimpl(wrapper=True)
def pytest_collectreport(report: pytest.CollectReport) -> Generator[None]:
    """A module whose classes yield no test fails as an empty one does.

    pytest reports a module only after every node under it is collected, and reports a class it skips,
    or one holding no test, as passing.
    """
    module = report.result[0].parent if report.passed and report.result else None
    # The module's own report alone: a node-id run's session report holds the selected node, whose
    # parent is its module, and arrives before any of that module's tests are collected.
    if isinstance(module, pytest.Module) and report.nodeid == module.nodeid and module.nodeid not in module.config.stash.get(_YIELDING, set()):
        report.outcome = "failed"
        report.longrepr = _COLLECTS_NOTHING.format(module=module.nodeid)

    return (yield)
