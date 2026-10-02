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


def _skipped_by_last_failed(collector: pytest.Collector) -> bool:
    """Whether `--lf` answered this module collected with nothing, never collecting it.

    Once a run under it has found a last failure, pytest registers its `LFPluginCollSkipfiles`, which
    answers each module outside the last-failed paths that way.
    """
    if collector.config.pluginmanager.get_plugin("lfplugin-collskip") is None:
        return False
    last_failed = collector.config.pluginmanager.get_plugin("lfplugin")
    return last_failed is not None and collector.path not in last_failed.get_last_failed_paths()


@pytest.hookimpl(wrapper=True)
def pytest_make_collect_report(collector: pytest.Collector) -> Generator[None, pytest.CollectReport, pytest.CollectReport]:
    report = yield
    # A module-level skip reports skipped rather than passed, so a module skipped on purpose stands.
    if isinstance(collector, pytest.Module) and report.passed and not report.result and not _skipped_by_last_failed(collector):
        report.outcome = "failed"
        report.longrepr = _COLLECTS_NOTHING.format(module=collector.nodeid)

    return report
