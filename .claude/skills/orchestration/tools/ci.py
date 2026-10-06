"""ORCHESTRATION · every finding a failed CI run printed, matched against the register's expected-red list.

A failed job carrying an expected red was read three times as wholly expected while it held a second,
unlisted finding, so this lists every finding line of every failed job and names each one expected
or NEW. A job none of whose lines it recognises stays NEW by its verdict, or by its name where it has
none, so an unread format is never a pass.

    gh run view <run> --log-failed | uv run --project fl_backend --frozen python .claude/skills/orchestration/tools/ci.py <register>

Exit 0 every finding expected, 1 a NEW finding, 2 refused: an empty log or no expected-red table.
"""

from __future__ import annotations

import io
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Final

EXPECTED_HEADING: Final = "## Expected red"
# gh prints each line as `<job>\t<step>\t<timestamp> <text>`, the escape character spelled `^[`.
STAMP_RE: Final = re.compile(r"^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z ?")
COLOUR_RE: Final = re.compile(r"(?:\x1b|\^\[)\[[0-9;]*m")
ANNOTATION_RE: Final = re.compile(r"^##\[error\](?P<text>.+)$")
# Every failed job's last annotation, and the summary job's pointer to the scope jobs.
NOISE_RE: Final = re.compile(r"^(?:Process completed with exit code \d+\.|A scope job failed\b)")
VERDICT_RE: Final = re.compile(r"^\s*✗\s+(?P<text>.+?)(?:\s+\d+s)?$")
PYTEST_RE: Final = re.compile(r"^(?P<text>(?:FAILED|ERROR) \S+::\S.*)$")
TSC_RE: Final = re.compile(r"^(?P<text>\S+\(\d+,\d+\): error TS\d+: .+)$")
# node:test lists each failing test once more under `✖ failing tests:`, after `test at <path>:<line>:<column>`.
NODE_SECTION_RE: Final = re.compile(r"^\s*✖ failing tests:\s*$")
NODE_AT_RE: Final = re.compile(r"^\s*test at (?P<path>\S+?):\d+:\d+\s*$")
NODE_FAIL_RE: Final = re.compile(r"^\s*✖ (?P<name>.+?)(?: \([\d.]+m?s\))?\s*$")


def _text(line: str) -> tuple[str, str] | None:
    parts = line.split("\t", 2)
    if len(parts) != 3:
        return None
    return parts[0], COLOUR_RE.sub("", STAMP_RE.sub("", parts[2])).rstrip()


def findings(log: str) -> dict[str, list[str]]:
    """Each failed job's finding lines in the order printed, a job no line of which is recognised holding its verdicts."""
    details: dict[str, list[str]] = {}
    verdicts: dict[str, list[str]] = {}
    node_at: dict[str, str | None] = {}
    for raw in log.splitlines():
        read = _text(raw)
        if read is None:
            continue
        job, text = read
        details.setdefault(job, [])
        verdicts.setdefault(job, [])
        if NODE_SECTION_RE.match(text):
            node_at[job] = ""
            continue
        if (at := NODE_AT_RE.match(text)) and job in node_at:
            node_at[job] = at["path"]
            continue
        if (failed := NODE_FAIL_RE.match(text)) and node_at.get(job):
            details[job].append(f"{node_at[job]} :: {failed['name']}")
            node_at[job] = ""
            continue
        if annotation := ANNOTATION_RE.match(text):
            if not NOISE_RE.match(annotation["text"]):
                details[job].append(annotation["text"].strip())
        elif shaped := PYTEST_RE.match(text) or TSC_RE.match(text):
            details[job].append(shaped["text"])
        elif verdict := VERDICT_RE.match(text):
            verdicts[job].append(verdict["text"])
    return {job: details[job] or verdicts[job] or [f"{job}: no finding line recognised; read its log"] for job in details}


def expected_rows(register: str) -> list[str]:
    """The `Matches` literal of every expected-red row whose status is still RED."""
    lines = register.split("\n")
    heading = next((k for k, line in enumerate(lines) if line.startswith(EXPECTED_HEADING)), None)
    if heading is None:
        raise ValueError(f"no `{EXPECTED_HEADING}` heading in the register")
    rows: list[str] = []
    for line in lines[heading + 1 :]:
        if line.startswith("## "):
            break
        cells = [cell.strip() for cell in re.split(r"(?<!\\)\|", line.strip())[1:-1]]
        if len(cells) < 2 or set(cells[0]) <= set("-: ") or not cells[-1].upper().startswith("RED"):
            continue
        rows.append(cells[0].removeprefix("`").removesuffix("`"))
    return rows


def report(log: str, register: str) -> tuple[list[str], bool]:
    """The lines to print, and whether any finding is NEW."""
    rows = expected_rows(register)
    found = findings(log)
    if not found:
        raise ValueError("the log holds no job line: was it `gh run view <run> --log-failed`, and did gh succeed?")
    said: list[str] = []
    seen: set[str] = set()
    for job, lines in found.items():
        expected: Counter[str] = Counter()
        said.append(job)
        for text in dict.fromkeys(lines):
            row = next((row for row in rows if row and row in text), None)
            if row is None:
                said.append(f"  NEW       {text}")
            else:
                expected[row] += 1
        said += [f"  expected  {row}  ({count} line(s))" for row, count in expected.items()]
        seen |= set(expected)
    said += [
        f"RED row no line matched: {row} -- cleared if its job passed, otherwise its job never reached it" for row in rows if row not in seen
    ]
    return said, any(line.startswith("  NEW") for line in said)


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        said, new = report(sys.stdin.buffer.read().decode("utf-8", "replace"), Path(argv[0]).read_bytes().decode("utf-8"))
    except (ValueError, OSError) as refused:
        print(refused, file=sys.stderr)
        return 2
    print("\n".join(said))
    return 1 if new else 0


if __name__ == "__main__":
    # A Windows pipe takes the console's codepage, which cannot encode every character a log holds.
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
