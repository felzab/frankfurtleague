"""SCRIPTS · what every checker under `scripts/` is built on.

The repository root and the finding-to-exit-code tail, once each: a checker taking either from its
own copy drifts into its own behaviour. The exit contract is 0 pass · 1 findings · 2 could not judge
the input · 3 or more the environment is broken, spelled as a literal by no checker.
"""

from __future__ import annotations

import io
import sys
import traceback
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Literal, TextIO

# Three levels: this file sits in `scripts/lib/`.
REPO_ROOT: Final = Path(__file__).resolve().parents[2]

# Three failing states, because they ask for three different actions: fix the change, fix the input
# the check was given, fix the environment. Only the checker can tell which happened.
EXIT_OK: Final = 0
EXIT_FINDINGS: Final = 1
EXIT_REFUSED: Final = 2
EXIT_CRASH: Final = 3
EXIT_INTERRUPTED: Final = 130

# What reading a file in this repository can raise, so no checker spells its own pair.
UNREADABLE: Final = (OSError, UnicodeDecodeError)

# A codepage must never decide whether a finding prints: on a Windows cp1252 handle a finding quoting
# a character outside it cannot report at all.
for _stream in (sys.stdout, sys.stderr):
    if isinstance(_stream, io.TextIOWrapper):
        _stream.reconfigure(encoding="utf-8", errors="replace")


Severity = Literal["fail", "report"]


@dataclass(frozen=True)
class Finding:
    """One thing a checker found. `fail` decides the exit code; `report` is advisory."""

    severity: Severity
    detail: str


def failures[F: Finding](findings: Iterable[F]) -> list[F]:
    """The findings that decide the exit code."""
    return [finding for finding in findings if finding.severity == "fail"]


def reports[F: Finding](findings: Iterable[F]) -> list[F]:
    """The advisory findings — printed, never fatal."""
    return [finding for finding in findings if finding.severity != "fail"]


def exit_code(findings: Iterable[Finding]) -> int:
    return EXIT_FINDINGS if any(finding.severity == "fail" for finding in findings) else EXIT_OK


# The column `report_findings` leaves after its `FAIL` tag, so a finding's second line lands under
# its first.
CONTINUATION: Final = " " * 14


def report_findings(findings: Iterable[Finding], *, indent: int = 6, stream: TextIO | None = None) -> int:
    """Print the failures, then the advisories, into one stream, and answer the run's exit code.

    One stream: `scripts/gate/verify.sh` prints a failing check's output whole, so splitting the
    severities would interleave them under the wrong heading.
    """
    collected = list(findings)
    # None rather than `sys.stdout` in the signature, which binds the object this module was
    # imported under: a caller redirecting the stream afterwards, which is what a test's capture
    # does, would be reading one nothing writes to.
    into = sys.stdout if stream is None else stream
    pad = " " * indent
    for finding in failures(collected):
        print(f"{pad}FAIL    {finding.detail}", file=into)
    for finding in reports(collected):
        print(f"{pad}report  {finding.detail}", file=into)
    return exit_code(collected)


def run(entry: Callable[[], int]) -> int:
    """A checker's `__main__` line, so one exit code means one thing whichever checker answered.

    An unexpected exception is `EXIT_CRASH`, never `EXIT_FINDINGS`: that separates "the change needs
    work" from "the check itself failed".
    """
    try:
        return entry()
    except KeyboardInterrupt:
        print("\n  interrupted -- nothing was checked", file=sys.stderr)
        return EXIT_INTERRUPTED
    except Exception:
        traceback.print_exc()
        print("\n  The check above did not finish, so it proved nothing. This is a crash, not a finding.", file=sys.stderr)
        return EXIT_CRASH
