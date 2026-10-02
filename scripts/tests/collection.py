"""SCRIPTS · a test module that collects no test fails its collection.

pytest reports such a module nowhere and the run stays green, so a module whose every test was
renamed out of pytest's prefixes takes its guarantees with it unseen. `scripts/tests/conftest.py`
registers this as a plugin; `fl_backend/tests/collection.py` holds the backend suite to the same.
"""

from collections.abc import Generator

import pytest

_COLLECTS_NOTHING = (
    "{module} collects no test. pytest would run it as green with nothing in it: name its tests with the `test` prefix, or"
    " skip the module at its top with a reason."
)

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
