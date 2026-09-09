"""SCRIPTS · the case-name reader's floor, measured against this repository rather than a fixture.

`test_check_docs.py` proves the ambiguity arm reports and stays quiet, over a corpus of one module
per tier. What that cannot show is the reader going quiet because it stopped recognising a
declaration in the real tree, which leaves every citation resolving to a count of one.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Final

SCRIPTS: Final = Path(__file__).resolve().parent.parent

# Below either, the reader has stopped finding the population rather than the suites having shrunk.
# Both stood a fifth higher when they were taken, as the copy sweep's own floors do.
SCRIPT_CASE_FLOOR: Final = 2200
PYTHON_CASE_FLOOR: Final = 3000

# A subprocess, and not an import: `test_check_docs.py` drives a COPY of this package under the same
# name, so importing the real one here would decide which of the two either file measures.
MEASURE: Final = """
import json, sys
sys.path.insert(0, "checks")
sys.path.insert(0, "lib")
from docs_gate.kernel import declared_cases, scanned_files

scripts, python = 0, 0
for path in scanned_files():
    counted = sum(declared_cases(path).values())
    if path.suffix == ".py":
        python += counted
    else:
        scripts += counted
print(json.dumps({"scripts": scripts, "python": python}))
"""


def test_the_case_reader_still_reaches_both_suites() -> None:
    """Each tier counted on its own: one reader going quiet must not be covered by the other."""
    done = subprocess.run([sys.executable, "-c", MEASURE], cwd=SCRIPTS, capture_output=True, text=True, encoding="utf-8", check=False)
    assert done.returncode == 0, "the reader could not be measured:\n" + done.stderr
    measured = json.loads(done.stdout)

    assert measured["scripts"] >= SCRIPT_CASE_FLOOR, f"{measured['scripts']} script cases, below the floor of {SCRIPT_CASE_FLOOR}"
    assert measured["python"] >= PYTHON_CASE_FLOOR, f"{measured['python']} python cases, below the floor of {PYTHON_CASE_FLOOR}"
