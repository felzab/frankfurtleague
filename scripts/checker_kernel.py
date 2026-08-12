"""
SCRIPTS · what every checker in this folder is built on

git, the branch's base and the finding-to-exit-code tail, once each: a checker taking any of them
from its own copy drifts into its own behaviour. The exit code below is the contract verify.sh
reads back.

Invariants:
- Python 3.14 is the floor, refused at import — a checker's own body may use syntax an older
  interpreter cannot parse, and nothing runs earlier than an import to say so.
- `git()` never raises, and a command that failed answers None rather than an empty string.
- `resolve_base` prefers `origin/<base>`, so a local main a merge left behind cannot make another
  branch's commits read as this one's.
- 0 pass · 1 findings · 2 the check could not judge its input · 3 or more the environment is broken.
  Nothing here answers 1 for either, and no checker spells any of them as a literal.

See:
- docs/ops/spec.md — the gate's scopes, and which checker runs where
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
# the check was given, fix the environment. Only the checker can tell a refusal from a broken
# interpreter, so only the checker can encode which happened.
EXIT_OK: Final = 0
EXIT_FINDINGS: Final = 1
EXIT_REFUSED: Final = 2
EXIT_CRASH: Final = 3
EXIT_INTERRUPTED: Final = 130

PYTHON_FLOOR: Final = (3, 14)

# The oldest interpreter that REACHES these files, not one that runs them: `.githooks/commit-msg`
# falls back to a system `python3`, and the oldest supported distribution ships 3.9. Below the
# floor they must still parse, or the message cannot print.
PARSE_FLOOR: Final = (3, 9)

DEFAULT_BASE: Final = "main"

# At import rather than inside `run`, because there is nowhere earlier: a checker importing this has
# already been compiled, so this is the first line of any of them that an old interpreter reaches.

# NOTHING HERE MAY USE SYNTAX NEWER THAN `PARSE_FLOOR`. A message about the runtime floor cannot
# print from a file that will not compile, and the SyntaxError exits 1 -- a finding's code.
# A comment is not a guard, so `scripts/tests` asserts it.
if sys.version_info < PYTHON_FLOOR:
    _have = ".".join(str(part) for part in sys.version_info[:3])
    _want = ".".join(str(part) for part in PYTHON_FLOOR)
    print(f"\n  This interpreter is python {_have}; the gate's checkers are written for {_want} or newer.", file=sys.stderr)
    print("  Run them from the backend virtualenv, which `cd fl_backend && uv sync --dev` creates.\n", file=sys.stderr)
    raise SystemExit(EXIT_CRASH)

# A codepage must never decide whether a finding prints. The emoji ban is the sharp case: its
# finding quotes the subject, so on a Windows cp1252 handle -- every capture `quietly` makes --
# the one message that rule exists for cannot report.
for _stream in (sys.stdout, sys.stderr):
    if isinstance(_stream, io.TextIOWrapper):
        _stream.reconfigure(encoding="utf-8", errors="replace")


Severity = Literal["fail", "report"]


@dataclass(frozen=True)
class Finding:
    """One thing a checker found. `fail` decides the exit code; `report` is advisory (CUR-5)."""

    severity: Severity
    detail: str


def git(*args: str) -> str | None:
    """Run git and return its stdout stripped, or None where the command failed. Never raises.

    UTF-8 is forced rather than left to the platform default: `git show` returns file CONTENT, and on
    a Windows codepage that decode raises on the first em dash. Reading a file through git is the only
    way to compare it against its state on another ref, so this has to be safe for prose. A git that
    will not launch answers None as well, because a checker that cannot read the branch has to say so
    rather than hand the caller a traceback the gate would word as a finding.
    """
    try:
        done = subprocess.run(
            ("git", *args),
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except OSError:
        return None
    # `strip` would also eat a leading space, and the first path of a `ls-files -z` listing is the one
    # place a leading space is data rather than layout.
    return done.stdout.rstrip() if done.returncode == 0 else None


def base_ref(base: str = DEFAULT_BASE) -> str | None:
    """The ref this branch is measured against: `origin/<base>` where it resolves, else `<base>`.

    Origin first is the whole point. A local `main` left behind by a merge made on GitHub shares an
    older merge base with the branch, so every commit merged since then reads as this branch's work:
    the scope check then demands scopes for other people's changes, and the commit-message gate
    refuses their messages while printing a rebase remedy that would rewrite the wrong branch.
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


# The old spelling of a bound type variable, on purpose: PEP 695's `def failures[F: Finding]` is
# a SyntaxError below 3.12, and a kernel that will not compile cannot name the interpreter it
# wanted. It still carries the caller's own subclass.
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

    One stream and one order on purpose: verify.sh prints a checker's output straight through instead
    of capturing it, so splitting the severities across stdout and stderr would interleave them on
    the terminal and land a finding under the wrong heading.
    """
    collected = list(findings)
    pad = " " * indent
    for finding in failures(collected):
        print(f"{pad}FAIL    {finding.detail}", file=stream)
    for finding in reports(collected):
        print(f"{pad}report  {finding.detail}", file=stream)
    return exit_code(collected)


def run(entry: Callable[[], int]) -> int:
    """A checker's `__main__` line, so one exit code means one thing whichever checker answered it.

    An unexpected exception is `EXIT_CRASH` and never `EXIT_FINDINGS`, which is what lets the gate
    word "this run is not wide enough to merge on" and "the check itself failed, so nothing was
    proved" as the different events they are. A checker that read its input and declined to judge it
    returns `EXIT_REFUSED` itself; nothing here can tell that apart from a broken environment.

    Two failures escape it by construction, both at import: syntax this module's own interpreter
    cannot parse, and a missing sibling module under `PYTHONSAFEPATH`. Nothing runs to catch either,
    so they exit 1. `PARSE_FLOOR` and the assertion that reads it are what keep the first away.
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
