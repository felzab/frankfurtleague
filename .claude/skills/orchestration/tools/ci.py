"""ORCHESTRATION · every finding a concluded CI run printed, matched against the register's expected-red list.

A failed job carrying an expected red was read three times as wholly expected while it held a second,
unlisted finding, so this lists every finding of every failed job and names each one expected or NEW.
A finding is an error annotation, which the gate prints for each, or a test runner's or tsc's own
line; an annotation following its unit's own lines is that unit's verdict, which those lines already
answer for. A job printing no finding stays NEW by its verdict lines, or by its name where it has none, so
an unread format is never a pass.

    uv run --project fl_backend --frozen python .claude/skills/orchestration/tools/ci.py <register> <run>

Exit 0 every finding expected, 1 a NEW finding or a row matching more lines than its `Lines` cell,
2 refused: a run not concluded, `gh` failing, an empty log, or no expected-red table to read.
"""

from __future__ import annotations

import io
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Final, NamedTuple

EXPECTED_HEADING: Final = "## Expected red"
# gh prints each line as `<job>\t<step>\t<timestamp> <text>`, the escape character spelled `^[`.
STAMP_RE: Final = re.compile(r"^\N{ZERO WIDTH NO-BREAK SPACE}?\d{4}-\d\d-\d\dT[\d:.]+Z ?")
COLOUR_RE: Final = re.compile(r"(?:\x1b|\^\[)\[[0-9;]*m")
ANNOTATION_RE: Final = re.compile(r"^##\[error\](?P<text>.+)$")
# A unit's own annotation, which the gate replays indented under its step, so the runner never read it.
NESTED_RE: Final = re.compile(r"^\s+::error(?:\s[^:]*)?::(?P<text>.+)$")
# Every failed job's last annotation, and the summary job's pointer to the scope jobs.
NOISE_RE: Final = re.compile(r"^(?:Process completed with exit code \d+\.|A scope job failed\b)")
# The step's duration, `_lib.sh :: fmt_ms`'s or the closing statement's, is no part of the verdict.
VERDICT_RE: Final = re.compile(r"^\s*✗\s+(?P<text>.+?)(?:\s+(?:\d+m\s*)?[\d.]+m?s)?$")
PYTEST_RE: Final = re.compile(r"^\s*(?P<text>(?:FAILED|ERROR) \S+::\S.*)$")
TSC_RE: Final = re.compile(r"^\s*(?P<text>\S+\(\d+,\d+\): error TS\d+: .+)$")
# node:test lists each failing test once more under `✖ failing tests:`, after `test at <path>:<line>:<column>`.
NODE_SECTION_RE: Final = re.compile(r"^\s*✖ failing tests:\s*$")
NODE_AT_RE: Final = re.compile(r"^\s*test at (?P<path>\S+?):\d+:\d+\s*$")
NODE_FAIL_RE: Final = re.compile(r"^\s*✖ (?P<name>.+?)(?: \([\d.]+m?s\))?\s*$")


class Line(NamedTuple):
    text: str
    # An annotation, as against a runner's own line: a unit's verdict where its own lines precede it.
    annotation: bool


class Row(NamedTuple):
    matches: str
    lines: int | None


def _text(line: str) -> tuple[str, str] | None:
    parts = line.split("\t", 2)
    if len(parts) != 3:
        return None
    return parts[0], COLOUR_RE.sub("", STAMP_RE.sub("", parts[2])).rstrip()


def read(log: str) -> dict[str, tuple[list[Line], list[str]]]:
    """Each failed job's findings in the order printed, and its verdict lines."""
    jobs: dict[str, tuple[list[Line], list[str]]] = {}
    node_at: dict[str, str] = {}
    for raw in log.splitlines():
        parsed = _text(raw)
        if parsed is None:
            continue
        job, text = parsed
        found, verdicts = jobs.setdefault(job, ([], []))
        if NODE_SECTION_RE.match(text):
            node_at[job] = ""
        elif (at := NODE_AT_RE.match(text)) and job in node_at:
            node_at[job] = at["path"]
        elif (failed := NODE_FAIL_RE.match(text)) and node_at.get(job):
            found.append(Line(f"{node_at[job]} :: {failed['name']}", annotation=False))
            node_at[job] = ""
        elif annotation := ANNOTATION_RE.match(text):
            if not NOISE_RE.match(annotation["text"]):
                found.append(Line(annotation["text"].strip(), annotation=True))
        elif shaped := NESTED_RE.match(text) or PYTEST_RE.match(text) or TSC_RE.match(text):
            found.append(Line(shaped["text"], annotation=False))
        elif verdict := VERDICT_RE.match(text):
            verdicts.append(verdict["text"])
    return jobs


def expected_rows(register: str) -> list[Row]:
    """The `Matches` literal and `Lines` bound of every expected-red row whose status is still RED."""
    lines = register.split("\n")
    heading = next((k for k, line in enumerate(lines) if line.startswith(EXPECTED_HEADING)), None)
    if heading is None:
        raise ValueError(f"no `{EXPECTED_HEADING}` heading in the register")
    section = lines[heading + 1 :]
    section = section[: next((k for k, line in enumerate(section) if line.startswith("## ")), len(section))]
    rows = [[cell.strip() for cell in re.split(r"(?<!\\)\|", line.strip())[1:-1]] for line in section if line.startswith("|")]
    header = rows[0] if rows else []
    if "Matches" not in header or "Status" not in header:
        raise ValueError("the expected-red table has no `Matches` and `Status` columns (`register-template.md`)")
    matches, status = header.index("Matches"), header.index("Status")
    bound = header.index("Lines") if "Lines" in header else None
    out: list[Row] = []
    for cells in rows[2:]:
        if len(cells) != len(header) or not cells[status].upper().startswith("RED"):
            continue
        limit = cells[bound] if bound is not None else ""
        out.append(Row(cells[matches].removeprefix("`").removesuffix("`"), int(limit) if limit.isdigit() else None))
    return out


def report(log: str, register: str) -> tuple[list[str], bool]:
    """The lines to print, and whether any finding is NEW."""
    rows = expected_rows(register)
    jobs = read(log)
    if not jobs:
        raise ValueError("the log holds no job line")
    said: list[str] = []
    new = False
    absorbed: dict[str, list[str]] = {row.matches: [] for row in rows}
    for job, (found, verdicts) in jobs.items():
        said.append(job)
        if not found:
            found = [Line(text, annotation=False) for text in verdicts] or [Line(f"{job}: no finding line recognised; read its log", False)]
        # Unit lines read since the last annotation; the annotation closing them is their verdict.
        unit = 0
        for line in dict.fromkeys(found):
            if line.annotation and unit:
                unit = 0
                continue
            unit = 0 if line.annotation else unit + 1
            row = next((row for row in rows if row.matches and row.matches in line.text), None)
            if row is None:
                new = True
                said.append(f"  NEW       {line.text}")
            else:
                absorbed[row.matches].append(f"{job}: {line.text}")
    for row in rows:
        took = absorbed[row.matches]
        if not took:
            said.append(f"RED row no line matched: {row.matches} -- cleared if its job passed, otherwise its job never reached it")
            continue
        over = row.lines is not None and len(took) > row.lines
        new = new or over
        said.append(
            f"{'NEW' if over else 'expected'}  {row.matches}  ({len(took)} line(s)" + (f", more than its {row.lines})" if over else ")")
        )
        said += [f"            {line}" for line in took]
    return said, new


def _gh(*args: str) -> str:
    program = shutil.which("gh")
    if program is None:
        raise ValueError("gh is not on PATH")
    done = subprocess.run((program, *args), capture_output=True, check=False)
    if done.returncode != 0:
        raise ValueError(f"gh {' '.join(args)} exited {done.returncode}: {done.stderr.decode('utf-8', 'replace').strip()}")
    return done.stdout.decode("utf-8", "replace")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        rows = expected_rows(Path(argv[0]).read_bytes().decode("utf-8"))
        run = json.loads(_gh("run", "view", argv[1], "--json", "status,conclusion"))
        if run.get("status") != "completed":
            raise ValueError(f"run {argv[1]} is {run.get('status')}, not concluded: read it once it has")
        if run.get("conclusion") == "success":
            print(f"run {argv[1]} succeeded: every RED row's check passed, so each is CLEARED by it" if rows else "run succeeded")
            return 0
        said, new = report(_gh("run", "view", argv[1], "--log-failed"), Path(argv[0]).read_bytes().decode("utf-8"))
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
