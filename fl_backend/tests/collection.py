"""TESTS · a test module that collects no test fails its collection.

pytest reports such a module nowhere and the run stays green, so a module whose every test was
renamed out of pytest's prefixes, or whose class lost its `Test` prefix, takes its guarantees with it
unseen. `fl_backend/tests/conftest.py` registers this as a plugin for every run, both tiers alike.
"""

from collections.abc import Generator

import pytest

_COLLECTS_NOTHING = (
    "{module} collects no test. pytest would run it as green with nothing in it: name its tests with the `test` prefix, or"
    " skip the module at its top with a reason."
)


@pytest.hookimpl(wrapper=True)
def pytest_make_collect_report(collector: pytest.Collector) -> Generator[None, pytest.CollectReport, pytest.CollectReport]:
    report = yield
    # A module-level skip reports skipped rather than passed, so a module skipped on purpose stands.
    if isinstance(collector, pytest.Module) and report.passed and not report.result:
        report.outcome = "failed"
        report.longrepr = _COLLECTS_NOTHING.format(module=collector.nodeid)

    return report
