"""SCRIPTS · every registered check driven against its plant, one test per case

`scripts/tests/test_check_docs.py` declares the fixture repository, the corpus it commits, the
plants and the `CASES` table; what stands here is each case driven through them. The gate's pytest
step hands a module whole to one worker, so the cases run beside that file's own tests only while
they are a file of their own: inside it, the two costs would add up on a single worker.

The table itself stays beside the plants, so `scripts/tests/test_check_docs.py ::
test_every_registered_check_and_verdict_has_a_plant` and the cases below read one `CASES`: a check
cannot be registered against a plant in one of them and unknown to the other.
"""

from __future__ import annotations

from collections import Counter

from test_check_docs import CASES, Case, _assert_corpus_restored, _reset, _run, _shape


def pytest_generate_tests(metafunc) -> None:
    # One test per case and never one loop over the table: xdist hands out a module under
    # `--dist loadfile` in order of how many tests it holds, so a module of one test starts last
    # however long it runs.
    if "case" in metafunc.fixturenames:
        metafunc.parametrize("case", CASES, ids=[case.check for case in CASES])


def teardown_module() -> None:
    """Once for the module rather than after every case.

    A leftover the reset cannot reach survives every reset after it, so one check at the end still
    finds it without four more git processes per case.
    """
    _reset()
    _assert_corpus_restored()


def test_every_check_reports_its_planted_violation(case: Case) -> None:
    """Each plant raises exactly the findings its case declares -- no fewer, and nothing beside them."""
    try:
        _reset()
        case.plant()
        code, reported = _run()
    finally:
        if case.undo is not None:
            case.undo()
    expected = Counter(case.expected)
    assert reported == expected, "missing " + _shape(expected - reported) + "; unexpected " + _shape(reported - expected)
    failing = int(any(severity == "fail" for severity, _, _ in case.expected))
    assert code == failing, "exit code " + str(code) + " does not match the severities reported"
