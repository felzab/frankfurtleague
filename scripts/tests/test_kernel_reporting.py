"""SCRIPTS · a checker's findings, read out of the capture held by the test that ran it.

A finding's text is the contract with whoever reads a red gate, and in process the only route to it
is the stream the runner swapped in. A reporter resolving its stream anywhere but at the call writes
past that swap, and the assertion that then goes quiet is the green one: a case reading no finding
out of a capture which was always empty passes whatever the checker found.

Invariants:
  A marker this file names is built from a repeated character, never typed: `check_tracked_text.py` reads its own source like any other.
"""

from __future__ import annotations

import io
import sys
from pathlib import Path
from typing import Final

from conftest import import_scripts

SCRIPTS: Final = Path(__file__).resolve().parents[1]

kernel, markers = import_scripts("checker_kernel", "check_tracked_text", directories=("lib", "checks"))

OPENER: Final = "<" * 7

DETAIL: Final = "docs/note.md:1 is a planted subject"


def test_a_finding_reaches_a_stream_swapped_after_the_kernel_was_imported(capsys) -> None:
    """Named for the failing direction: an empty capture is silent, and the case reading it green."""
    code = kernel.report_findings([kernel.Finding("fail", DETAIL)])

    assert code == kernel.EXIT_FINDINGS
    assert DETAIL in capsys.readouterr().out


def test_a_checker_driven_in_process_has_its_findings_captured(tmp_path: Path, capsys) -> None:
    """Through a checker's own bare call rather than the kernel's, that being the form every one but two writes."""
    source = tmp_path / "note.md"
    # Bytes, so the plant is not turned into a carriage return pair the marker reader would miss.
    source.write_bytes(f"Intro.\n{OPENER} HEAD\n".encode())
    argv_before = sys.argv
    sys.argv = ["check_tracked_text.py", str(source)]
    try:
        code = markers.main()
    finally:
        sys.argv = argv_before

    assert code == kernel.EXIT_FINDINGS
    assert "is a conflict opener" in capsys.readouterr().out


def test_a_stream_named_at_the_call_is_written_instead_of_the_current_stdout(capsys) -> None:
    """The one caller that names one: `check_pr_body.py` sends every severity where a failed step is looked for."""
    named = io.StringIO()

    kernel.report_findings([kernel.Finding("fail", DETAIL)], stream=named)

    assert DETAIL in named.getvalue()
    assert capsys.readouterr().out == ""
