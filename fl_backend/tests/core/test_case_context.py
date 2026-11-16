"""
TESTS · the context an async case runs in

Each case of `tests/core/context_canary_cases.py` holds only after the one before it, so they run here whole, in a pytest
of their own over the suite's own configuration: under `-k`, a rerun of the last failure, or a distribution splitting
the file, the last of them would pass on a context nothing set.
"""

import re
import subprocess
import sys
from pathlib import Path

from tests.database import CASE_BOUND_S

BACKEND_ROOT = Path(__file__).resolve().parents[2]
CANARIES = Path(__file__).with_name("context_canary_cases.py")

# A pytest of its own: an interpreter's start, the suite's imports and three cases, about 3 s on a developer machine. Above
# a case's own bound, so a canary that hangs is cut and reported by that pytest rather than by this timeout.
CANARIES_BOUND_S = 60.0

assert CASE_BOUND_S < CANARIES_BOUND_S, "the canaries' run must outlast a case its own bound cuts"


def test_each_case_runs_in_a_context_of_its_own():
    # The environment passes through as it is and is never held in a local: `--showlocals` prints a failing case's.
    ran = subprocess.run(
        [sys.executable, "-m", "pytest", str(CANARIES), "-p", "no:cacheprovider", "--no-header", "-q"],
        cwd=BACKEND_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=CANARIES_BOUND_S,
        check=False,
    )

    assert ran.returncode == 0, ran.stdout
    assert re.fullmatch(r"3 passed in [\d.]+s", ran.stdout.splitlines()[-1]), ran.stdout
