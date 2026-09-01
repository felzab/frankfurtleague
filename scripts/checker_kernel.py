"""SCRIPTS · what every checker in this folder is built on.

git, the repository root, the branch's base and the finding-to-exit-code tail, once each: a checker
taking any from its own copy drifts into its own behaviour. The exit contract is 0 pass · 1 findings
· 2 could not judge the input · 3 or more the environment is broken, spelled as a literal by no
checker.
"""

from __future__ import annotations

import io
import subprocess
import sys
import traceback
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Literal, TextIO, TypeVar

REPO_ROOT: Final = Path(__file__).resolve().parent.parent

# Three failing states, because they ask for three different actions: fix the change, fix the input
# the check was given, fix the environment. Only the checker can tell which happened.
EXIT_OK: Final = 0
EXIT_FINDINGS: Final = 1
EXIT_REFUSED: Final = 2
EXIT_CRASH: Final = 3
EXIT_INTERRUPTED: Final = 130

PYTHON_FLOOR: Final = (3, 14)

# The oldest interpreter that REACHES these files, not one that runs them: `.githooks/commit-msg`
# falls back to a system `python3`. Below the floor they must still parse, or nothing can print.
PARSE_FLOOR: Final = (3, 9)

DEFAULT_BASE: Final = "main"

# What reading a file in this repository can raise. Named rather than spelled inline, for
# `scripts/docs_gate/kernel.py :: UNTOKENIZABLE`'s reason: the formatter folds a tuple into PEP
# 758's `except A, B:`, newer than `PARSE_FLOOR`.
UNREADABLE: Final = (OSError, UnicodeDecodeError)

# At import rather than inside `run`: a checker importing this is already compiled, so this is the
# first line of any of them an old interpreter reaches.

# NOTHING HERE MAY USE SYNTAX NEWER THAN `PARSE_FLOOR`. A message about the runtime floor cannot
# print from a file that will not compile, and the SyntaxError exits 1 -- a finding's code.
if sys.version_info < PYTHON_FLOOR:
    _have = ".".join(str(part) for part in sys.version_info[:3])
    _want = ".".join(str(part) for part in PYTHON_FLOOR)
    print(f"\n  This interpreter is python {_have}; the gate's checkers are written for {_want} or newer.", file=sys.stderr)
    print("  Run them from the backend virtualenv, which `cd fl_backend && uv sync --dev` creates.\n", file=sys.stderr)
    raise SystemExit(EXIT_CRASH)

# A codepage must never decide whether a finding prints. The emoji ban is the sharp case: its
# finding quotes the subject, so on a Windows cp1252 handle it cannot report at all.
for _stream in (sys.stdout, sys.stderr):
    if isinstance(_stream, io.TextIOWrapper):
        _stream.reconfigure(encoding="utf-8", errors="replace")


Severity = Literal["fail", "report"]


@dataclass(frozen=True)
class Finding:
    """One thing a checker found. `fail` decides the exit code; `report` is advisory."""

    severity: Severity
    detail: str


def _git_run(args: tuple[str, ...], stdin: str | None) -> subprocess.CompletedProcess[str] | None:
    """The one place a checker launches git. None where the process could not start at all.

    UTF-8 is forced: `git show` returns file CONTENT, which on a Windows codepage raises on the
    first em dash. `input=None` leaves the child's own stdin inherited.
    """
    try:
        return subprocess.run(
            ("git", *args),
            cwd=REPO_ROOT,
            input=stdin,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except OSError:
        return None


def git(*args: str) -> str | None:
    """Run git and return its stdout stripped, or None where the command failed. Never raises."""
    done = _git_run(args, None)
    # `strip` would eat a leading space, which in a `ls-files -z` listing is data, not layout.
    return done.stdout.rstrip() if done is not None and done.returncode == 0 else None


def git_status(*args: str) -> int | None:
    """Run git for its exit code alone, or None where it could not be launched. Never raises.

    None answers neither yes nor no, and each caller resolves it in the direction that keeps a
    finding rather than dropping one.
    """
    done = _git_run(args, None)
    return None if done is None else done.returncode


def git_input(*args: str, stdin: str) -> str | None:
    """Run git over a batch written to its standard input, and answer its stdout. Never raises.

    A launch per token is what gets a check dropped for costing too much, and a batch needs a
    writer that `git` cannot be.
    """
    done = _git_run(args, stdin)
    return done.stdout.rstrip() if done is not None and done.returncode == 0 else None


def base_ref(base: str = DEFAULT_BASE) -> str | None:
    """The ref this branch is measured against: `origin/<base>` where it resolves, else `<base>`.

    Origin first: a stale local `main` shares an older merge base, so every commit merged since
    reads as this branch's work.
    """
    for ref in (f"origin/{base}", base):
        if git("rev-parse", "--verify", "--quiet", ref) is not None:
            return ref
    return None


def resolve_base(base: str = DEFAULT_BASE) -> str | None:
    """The commit this branch forked from, or None where no ref named `base` is visible here."""
    ref = base_ref(base)
    if ref is None:
        return None
    # `or None`: an empty answer means unrelated histories, which is no base rather than the tree.
    return git("merge-base", ref, "HEAD") or None


# The old spelling on purpose: PEP 695's `def failures[F: Finding]` is a SyntaxError below 3.12,
# and a kernel that will not compile cannot name the interpreter it wanted.
F = TypeVar("F", bound=Finding)


def failures(findings: Iterable[F]) -> list[F]:
    """The findings that decide the exit code."""
    return [finding for finding in findings if finding.severity == "fail"]


def reports(findings: Iterable[F]) -> list[F]:
    """The advisory findings — printed, never fatal."""
    return [finding for finding in findings if finding.severity != "fail"]


def exit_code(findings: Iterable[Finding]) -> int:
    return EXIT_FINDINGS if any(finding.severity == "fail" for finding in findings) else EXIT_OK


def report_findings(findings: Iterable[Finding], *, indent: int = 6, stream: TextIO = sys.stdout) -> int:
    """Print the failures, then the advisories, into one stream, and answer the run's exit code.

    One stream: `scripts/verify.sh` prints output straight through, so splitting the severities
    would interleave them under the wrong heading.
    """
    collected = list(findings)
    pad = " " * indent
    for finding in failures(collected):
        print(f"{pad}FAIL    {finding.detail}", file=stream)
    for finding in reports(collected):
        print(f"{pad}report  {finding.detail}", file=stream)
    return exit_code(collected)


def run(entry: Callable[[], int]) -> int:
    """A checker's `__main__` line, so one exit code means one thing whichever checker answered.

    An unexpected exception is `EXIT_CRASH`, never `EXIT_FINDINGS`: that separates "not wide enough
    to merge on" from "the check itself failed".
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
