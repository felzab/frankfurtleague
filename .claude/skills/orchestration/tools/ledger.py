"""ORCHESTRATION · one findings-ledger row per finding a banked report labels, and the rows still open.

A finding routed from memory was dropped while its report sat banked, so `bank` writes one OPEN row
per `F<n>` label into the register's findings ledger, and the ending runs `open` until it prints
nothing. A report carrying no label banks nothing and says so, naming any findings it numbers in
another shape, since a silent zero reads exactly like a report with nothing in it.

    python .claude/skills/orchestration/tools/ledger.py bank <register> <report> [--none]
    python .claude/skills/orchestration/tools/ledger.py open <register>

`--none` declares a report with no finding. Exit 0 done; `bank` 2 refused, 3 no label and no
`--none`; `open` 1 while any row is OPEN.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Final

LEDGER_HEADING: Final = "## Findings ledger"
# A finding opens a line with its label, behind at most a heading, list or table marker and bold.
LABEL_RE: Final = re.compile(r"^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|\|\s*)?(?:\*\*|__)?F(?P<n>\d+)\b(?P<rest>.*)$")
# The shapes findings were numbered in before the label was fixed, counted when no label is found.
OTHER_SHAPE_RE: Final = re.compile(r"^\s{0,3}(?:(?:#{1,6}\s+)?(?:\*\*|__)\d+[.)]|\|\s*\d+\s*\|)")
SUMMARY_CHARS: Final = 160


def findings(report: str) -> dict[int, str]:
    """Each labelled finding's first line, by number, the first occurrence of a number winning."""
    found: dict[int, str] = {}
    fenced = False
    for line in report.splitlines():
        if line.lstrip().startswith("```"):
            fenced = not fenced
            continue
        labelled = None if fenced else LABEL_RE.match(line)
        if labelled is None:
            continue
        summary = re.sub(r"[*_`]{2,}|^[\s.:|)\-–—]+", "", labelled["rest"]).strip(" |")
        found.setdefault(int(labelled["n"]), summary)
    return found


def other_shapes(report: str) -> int:
    return sum(1 for line in report.splitlines() if OTHER_SHAPE_RE.match(line))


def _cell(text: str) -> str:
    text = " ".join(text.split()).replace("|", "\\|")
    return text if len(text) <= SUMMARY_CHARS else text[: SUMMARY_CHARS - 1] + "…"


def _ledger_rows(lines: list[str]) -> tuple[int, int]:
    """The index of the ledger table's last line and the index of its heading."""
    heading = next((k for k, line in enumerate(lines) if line.strip() == LEDGER_HEADING), -1)
    if heading == -1:
        raise ValueError(f"no `{LEDGER_HEADING}` heading in the register")
    table = next((k for k in range(heading + 1, len(lines)) if lines[k].startswith("|")), -1)
    if table == -1 or any(lines[k].startswith("## ") for k in range(heading + 1, table)):
        raise ValueError(f"no table under `{LEDGER_HEADING}`")
    end = table
    while end + 1 < len(lines) and lines[end + 1].startswith("|"):
        end += 1
    return end, heading


def _write(path: Path, lines: list[str]) -> None:
    # Beside the register and renamed over it, so an interrupted write leaves the old register whole.
    spare = path.with_name(path.name + ".writing")
    spare.write_bytes("\n".join(lines).encode("utf-8"))
    os.replace(spare, path)


def bank(register: Path, report: Path, declared_none: bool = False) -> list[str]:
    """One OPEN row per labelled finding not already in the ledger, written; the rows added."""
    text = report.read_bytes().decode("utf-8")
    labelled = findings(text)
    if not labelled:
        if declared_none:
            return []
        shapes = other_shapes(text)
        raise LookupError(
            f"{report.name} labels no finding F<n>"
            + (f", and numbers {shapes} line(s) in another shape: bank those by hand or have them relabelled" if shapes else "")
            + "; pass --none for a report with no finding"
        )
    source = report.name.removesuffix(".md").removesuffix("-report")
    lines = register.read_bytes().decode("utf-8").split("\n")
    end, heading = _ledger_rows(lines)
    held = "\n".join(lines[heading : end + 1])
    added = [
        f"| {source}-F{n} | {report.name} | {_cell(summary)} | OPEN | |"
        for n, summary in sorted(labelled.items())
        if f"| {source}-F{n} |" not in held
    ]
    lines[end + 1 : end + 1] = added
    _write(register, lines)
    return added


def gaps(report: Path) -> list[int]:
    numbers = sorted(findings(report.read_bytes().decode("utf-8")))
    return [n for n in range(1, numbers[-1] + 1) if n not in numbers] if numbers else []


def open_rows(register: Path) -> list[str]:
    lines = register.read_bytes().decode("utf-8").split("\n")
    end, heading = _ledger_rows(lines)
    return [line for line in lines[heading + 1 : end + 1] if re.search(r"\|\s*OPEN\s*\|", line)]


def main(argv: list[str]) -> int:
    try:
        if len(argv) >= 3 and argv[0] == "bank" and set(argv[3:]) <= {"--none"}:
            report = Path(argv[2])
            for row in bank(Path(argv[1]), report, "--none" in argv[3:]):
                print(row)
            missing = gaps(report)
            if missing:
                print(f"{report.name} skips F{', F'.join(map(str, missing))}: a finding may be unlabelled", file=sys.stderr)
            return 0
        if len(argv) == 2 and argv[0] == "open":
            rows = open_rows(Path(argv[1]))
            for row in rows:
                print(row)
            return 1 if rows else 0
    except LookupError as unlabelled:
        print(unlabelled, file=sys.stderr)
        return 3
    except ValueError as refused:
        print(refused, file=sys.stderr)
        return 2
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
