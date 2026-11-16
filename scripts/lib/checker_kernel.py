"""What every checker under `scripts/` is built on.

The repository root and the finding-to-exit-code tail, once each: a checker taking either from its
own copy drifts into its own behaviour. The exit contract is 0 pass · 1 findings · 2 could not judge
the input · 3 or more the environment is broken, spelled as a literal by no checker.
"""

from __future__ import annotations

import io
import runpy
import sys
import traceback
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Final

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


@dataclass(frozen=True)
class Finding:
    """One thing a checker found; any one fails the run."""

    detail: str


# The column `report_findings` leaves after its `FAIL` tag, so a finding's second line lands under
# its first.
CONTINUATION: Final = " " * 14


def report_findings(findings: Iterable[Finding]) -> int:
    """Print every finding and answer the run's exit code."""
    collected = list(findings)
    for finding in collected:
        print(f"      FAIL    {finding.detail}")
    return EXIT_FINDINGS if collected else EXIT_OK


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


def launch(script: str, arguments: list[str]) -> int:
    """`script` run as `__main__` with `arguments`, its own exit code answered, inside `run`.

    `run` in the script's own `__main__` line cannot reach the script's imports or its compile, which
    Python answers with 1, the code this contract gives findings. Every caller of a checker runs it
    through this file instead: `python scripts/lib/checker_kernel.py <script> [arguments]`.
    """

    def entry() -> int:
        sys.argv = [script, *arguments]
        try:
            runpy.run_path(script, run_name="__main__")
        except SystemExit as stop:
            # The script's own `sys.exit(run(main))`, its code an int; None is a script ending bare.
            if stop.code is None or isinstance(stop.code, int):
                return stop.code or EXIT_OK
            # A message, which Python prints and answers with 1.
            print(stop.code, file=sys.stderr)
            return EXIT_CRASH
        return EXIT_OK

    return run(entry)


if __name__ == "__main__":
    sys.exit(launch(sys.argv[1], sys.argv[2:]) if len(sys.argv) > 1 else EXIT_CRASH)
