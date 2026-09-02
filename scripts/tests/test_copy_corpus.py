"""SCRIPTS · the copy sweep's floor, measured against this repository rather than a fixture.

`test_check_docs.py` proves each copy check reports and stays quiet, over a corpus of two files.
What that cannot show is the sweep going quiet because the scanner stopped reading the real tree,
so the population it reaches is pinned here, as the frontend's own corpus sweeps pin theirs.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Final

SCRIPTS: Final = Path(__file__).resolve().parent.parent

# Below either, the scan has stopped finding the population rather than the population having
# shrunk. Both stood a fifth higher when they were taken.
FILE_FLOOR: Final = 380
GERMAN_FLOOR: Final = 900

# A subprocess, and not an import: `test_check_docs.py` drives a COPY of this package under the
# same name, so importing the real one here would decide which of the two either file measures.
MEASURE: Final = """
import json, sys
sys.path.insert(0, "checks")
from docs_gate.copy_rules import copy_spans, corpus_files, is_german

files = corpus_files()
german, unbalanced = 0, []
for path in files:
    spans, balanced = copy_spans(path)
    if not balanced:
        unbalanced.append(path.name)
    german += sum(1 for span in spans if is_german(span))
print(json.dumps({"files": len(files), "german": german, "unbalanced": unbalanced}))
"""


def test_the_copy_sweep_still_reaches_the_whole_frontend() -> None:
    """The corpus, the German inside it, and every file the scanner could read to the end."""
    done = subprocess.run([sys.executable, "-c", MEASURE], cwd=SCRIPTS, capture_output=True, text=True, encoding="utf-8", check=False)
    assert done.returncode == 0, "the sweep could not be measured:\n" + done.stderr
    measured = json.loads(done.stdout)

    assert measured["files"] >= FILE_FLOOR, f"the copy corpus holds {measured['files']} files, below the floor of {FILE_FLOOR}"
    assert measured["german"] >= GERMAN_FLOOR, f"{measured['german']} German spans, below the floor of {GERMAN_FLOOR}"
    assert not measured["unbalanced"], "the scanner could not read to the end of: " + ", ".join(measured["unbalanced"])
