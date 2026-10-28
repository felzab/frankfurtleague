"""ORCHESTRATION · every finding a concluded verify run printed, matched against the register's expected-red list.

A failed job carrying an expected red was read as wholly expected while it held a second, unlisted
finding, so every finding of every failed job is named expected or NEW, NEW lines last and a count
closing the output, which no tail hides. A finding is an error annotation, a test runner's or tsc's
own line; a job printing none stays NEW by its verdict lines or its name. Only the verify workflow's
run for the branch's upstream commit is read: three workflows start per push, and a landing during a
run moves HEAD past it.

    uv run --project fl_backend --frozen python .claude/skills/orchestration/tools/ci.py <command>

    <register> (<run> | --head [--wait [--timeout <s>]]) [--commit <sha>] [--verbose]
    expect <register> <run> --cleared-by <text>

A read sets CLEARED a RED row whose recorded job passed; `expect` writes a RED row per NEW line.
Exit 0 every finding expected, 1 a NEW finding or a row past its `Lines` cell, 2 refused.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final, NamedTuple

# Run as a script, python seeds this file's own directory on the path.
import ledger

WORKFLOW: Final = "verify"
EXPECTED_HEADING: Final = "## Expected red"
# How long `--wait` waits for a run to exist and conclude, and how often it asks: a verify run took
# about three minutes in the median, and a push cancels the run before it.
TIMEOUT_SECONDS: Final = 1800.0
POLL_SECONDS: Final = 15.0
# A wait outlasting one network blip asks again; a gh failing this many times running is no blip.
GH_FAILURES: Final = 3
# `expect` records a row's job at the head of its reason, which is how a later read knows its job passed.
JOB_RE: Final = re.compile(r"^`(?P<job>[^`]+)` job\b")
# gh prints each line as `<job>\t<step>\t<timestamp> <text>`, the escape character spelled `^[`.
STAMP_RE: Final = re.compile(r"^\N{ZERO WIDTH NO-BREAK SPACE}?\d{4}-\d\d-\d\dT[\d:.]+Z ?")
COLOUR_RE: Final = re.compile(r"(?:\x1b|\^\[)\[[0-9;]*m")
ANNOTATION_RE: Final = re.compile(r"^##\[error\](?P<text>.+)$")
# A unit's own annotation, which the gate replays indented under its step, so the runner never read it.
NESTED_RE: Final = re.compile(r"^\s+::error(?:\s[^:]*)?::(?P<text>.+)$")
# Every failed job's last annotation.
EXIT_RE: Final = re.compile(r"^Process completed with exit code \d+\.")
# The summary job's pointer to the scope jobs, whose own lines carry its findings.
RELAY_RE: Final = re.compile(r"^A scope job failed\b")
# The step's duration, `_lib.sh :: fmt_ms`'s or the closing statement's, is no part of the verdict.
VERDICT_RE: Final = re.compile(r"^\s*✗\s+(?P<text>.+?)(?:\s+(?:\d+m\s*)?[\d.]+m?s)?$")
PYTEST_RE: Final = re.compile(r"^\s*(?P<text>(?:FAILED|ERROR) \S+::\S.*)$")
TSC_RE: Final = re.compile(r"^\s*(?P<text>\S+\(\d+,\d+\): error TS\d+: .+)$")
# node:test lists each failing test once more under `✖ failing tests:`, after `test at <path>:<line>:<column>`.
NODE_SECTION_RE: Final = re.compile(r"^\s*✖ failing tests:\s*$")
NODE_AT_RE: Final = re.compile(r"^\s*test at (?P<path>\S+?):\d+:\d+\s*$")
NODE_FAIL_RE: Final = re.compile(r"^\s*✖ (?P<name>.+?)(?: \([\d.]+m?s\))?\s*$")
# Vitest's summary names each failing case, or a file that failed as a whole, once under `Failed
# Tests`/`Failed Suites`: ` FAIL `, the project as `|unit|` or, coloured, ` unit `, then the file and
# the case's ancestors joined by ` > `; a whole file's path follows in `[ ]`. The error's first line
# comes next, and Vitest's own annotation for the case repeats it.
VITEST_FAIL_RE: Final = re.compile(r"^\s*FAIL\s+(?:\|[^|]+\|\s+|\S+\s{2,}(?=\S))?(?P<name>\S.*?)(?:\s+\[ [^\]]+ \])?\s*$")
# A workflow command escapes a newline in its message as `%0A`, so its first line ends there.
ESCAPED_NEWLINE: Final = "%0A"


class Line(NamedTuple):
    text: str
    # An annotation, as against a runner's own line: a unit's verdict where its own lines precede it.
    annotation: bool
    # A job's verdict or its name standing in for a finding no line named.
    generic: bool = False


@dataclass
class Job:
    found: list[Line] = field(default_factory=list)
    verdicts: list[str] = field(default_factory=list)
    relay: bool = False


class Row(NamedTuple):
    matches: str
    lines: int | None
    job: str | None
    at: int


class Reading(NamedTuple):
    said: list[str]
    new: list[tuple[str, str]]
    flagged: bool
    cleared: list[Row]
    # The NEW lines that are a job's verdict or name rather than a finding.
    generic: frozenset[tuple[str, str]] = frozenset()


def _text(line: str) -> tuple[str, str] | None:
    parts = line.split("\t", 2)
    if len(parts) != 3:
        return None
    return parts[0], COLOUR_RE.sub("", STAMP_RE.sub("", parts[2])).rstrip()


def read(log: str) -> dict[str, Job]:
    """Each failed job's findings in the order printed, its verdict lines, and whether it pointed at the scope jobs."""
    jobs: dict[str, Job] = {}
    node_at: dict[str, str] = {}
    # Per job: whether a Vitest case waits for its error's first line, and every such line read, by
    # which that case's own annotation is known as no finding of its own.
    vitest_waits: dict[str, bool] = {}
    vitest_errors: dict[str, set[str]] = {}
    for raw in log.splitlines():
        parsed = _text(raw)
        if parsed is None:
            continue
        name, text = parsed
        job = jobs.setdefault(name, Job())
        if vitest := VITEST_FAIL_RE.match(text):
            job.found.append(Line(vitest["name"], annotation=False))
            vitest_waits[name] = True
            continue
        if vitest_waits.get(name) and text.strip() and not ANNOTATION_RE.match(text):
            vitest_errors.setdefault(name, set()).add(text.strip())
            vitest_waits[name] = False
            continue
        repeated = ANNOTATION_RE.match(text) or NESTED_RE.match(text)
        if repeated and repeated["text"].split(ESCAPED_NEWLINE, 1)[0].strip() in vitest_errors.get(name, ()):
            continue
        if NODE_SECTION_RE.match(text):
            node_at[name] = ""
        elif (at := NODE_AT_RE.match(text)) and name in node_at:
            node_at[name] = at["path"]
        elif (failed := NODE_FAIL_RE.match(text)) and node_at.get(name):
            job.found.append(Line(f"{node_at[name]} :: {failed['name']}", annotation=False))
            node_at[name] = ""
        elif annotation := ANNOTATION_RE.match(text):
            if RELAY_RE.match(annotation["text"]):
                job.relay = True
            elif not EXIT_RE.match(annotation["text"]):
                job.found.append(Line(annotation["text"].strip(), annotation=True))
        elif shaped := NESTED_RE.match(text) or PYTEST_RE.match(text) or TSC_RE.match(text):
            job.found.append(Line(shaped["text"], annotation=False))
        elif verdict := VERDICT_RE.match(text):
            job.verdicts.append(verdict["text"])
    return jobs


def _expected_table(lines: list[str]) -> tuple[list[str], int, int]:
    """The expected-red table's column names, and the indexes of its first and last line."""
    try:
        _, table, end = ledger.table_under(lines, EXPECTED_HEADING)
    except ValueError:
        raise ValueError(f"no expected-red table under `{EXPECTED_HEADING}` in the register") from None
    header = ledger.cells(lines[table])
    if "Matches" not in header or "Status" not in header:
        raise ValueError("the expected-red table has no `Matches` and `Status` columns (`register-template.md`)")
    return header, table, end


def _column(header: list[str], word: str) -> int | None:
    return next((k for k, name in enumerate(header) if name.startswith(word)), None)


def expected_rows(register: str) -> list[Row]:
    """The `Matches` literal, `Lines` bound and recorded job of every expected-red row whose status is still RED."""
    lines = register.split("\n")
    header, table, end = _expected_table(lines)
    matches, status, bound, why = header.index("Matches"), header.index("Status"), _column(header, "Lines"), _column(header, "Why")
    out: list[Row] = []
    for k in range(table + 2, end + 1):
        row = ledger.cells(lines[k])
        if len(row) != len(header) or not row[status].upper().startswith("RED"):
            continue
        limit = row[bound] if bound is not None else ""
        job = JOB_RE.match(row[why]) if why is not None else None
        literal = row[matches].removeprefix("`").removesuffix("`").replace("\\|", "|")
        out.append(Row(literal, int(limit) if limit.isdigit() else None, job["job"] if job else None, k))
    return out


def report(log: str, register: str, passed: frozenset[str] = frozenset(), verbose: bool = False) -> Reading:
    """The lines to print, NEW last; each NEW finding; whether any is NEW; and the RED rows a passing job cleared."""
    rows = expected_rows(register)
    jobs = read(log)
    if not jobs:
        raise ValueError("the log holds no job line")
    new: list[tuple[str, str]] = []
    generic: set[tuple[str, str]] = set()
    absorbed: dict[int, list[str]] = {row.at: [] for row in rows}
    said, last, cleared, expected = [], [], [], 0
    for name, job in jobs.items():
        found = job.found
        if not found and job.relay and len(jobs) > 1:
            said.append(f"relay     {name}: a scope job failed, and its lines here are that job's findings")
            continue
        if not found:
            found = [Line(text, False, generic=True) for text in job.verdicts] or [
                Line(f"{name}: no finding line recognised; read its log", False, generic=True)
            ]
        # Unit lines read since the last annotation; the annotation closing them is their verdict.
        unit = 0
        for line in dict.fromkeys(found):
            if line.annotation and unit:
                unit = 0
                continue
            unit = 0 if line.annotation else unit + 1
            row = next((row for row in rows if row.matches and row.matches in line.text), None)
            if row is None:
                new.append((name, line.text))
                if line.generic:
                    generic.add((name, line.text))
            else:
                absorbed[row.at].append(f"{name}: {line.text}")
    for row in rows:
        took = absorbed[row.at]
        if not took and row.job in passed:
            cleared.append(row)
            said.append(f"CLEARED   {row.matches}  (its job `{row.job}` passed)")
        elif not took:
            why = "its job is not recorded" if row.job is None else f"its job `{row.job}` did not pass"
            said.append(f"RED       {row.matches}  (no line matched, and {why}: it stays RED)")
        elif row.lines is not None and len(took) > row.lines:
            last += [f"NEW       {row.matches}  ({len(took)} line(s), more than its {row.lines})", *(f"            {line}" for line in took)]
        else:
            expected += len(took)
            said += [f"expected  {row.matches}  ({len(took)} line(s))", *(f"            {line}" for line in took if verbose)]
    last += [f"NEW       {job}: {text}" for job, text in new]
    count = sum(1 for line in last if not line.startswith(" "))
    return Reading([*said, *last, f"{count} NEW, {expected} expected"], new, count > 0, cleared, frozenset(generic))


def _gh(*args: str) -> str:
    program = shutil.which("gh")
    if program is None:
        raise ValueError("gh is not on PATH")
    done = subprocess.run((program, *args), capture_output=True, check=False)
    if done.returncode != 0:
        raise ValueError(f"gh {' '.join(args)} exited {done.returncode}: {done.stderr.decode('utf-8', 'replace').strip()}")
    return done.stdout.decode("utf-8", "replace")


def pushed() -> str:
    """The commit the branch was last pushed at, its upstream's: a landing made since moves HEAD alone."""
    done = subprocess.run(("git", "rev-parse", "@{upstream}"), capture_output=True, check=False)
    if done.returncode != 0:
        raise ValueError("HEAD's branch has no upstream, so no pushed commit is known: push it with `git push -u` first")
    return done.stdout.decode().strip()


def run_for(sha: str) -> dict[str, object] | None:
    """The newest verify run for the commit, or None where none started."""
    runs = json.loads(_gh("run", "list", "--workflow", WORKFLOW, "--commit", sha, "--limit", "1", "--json", "databaseId,status,conclusion"))
    return runs[0] if runs else None


def commit(name: str) -> str:
    """The full hash of a commit this checkout holds."""
    done = subprocess.run(("git", "rev-parse", "--verify", "--quiet", f"{name}^{{commit}}"), capture_output=True, check=False)
    if done.returncode != 0:
        raise ValueError(f"{name} is no commit this checkout holds: fetch it first")
    return done.stdout.decode().strip()


def view(run: str, sha: str) -> dict[str, object]:
    """The run's state and jobs, refused where it is another workflow's or another commit's, or never finished."""
    found = json.loads(_gh("run", "view", run, "--json", "status,conclusion,workflowName,headSha,jobs"))
    if found.get("workflowName") != WORKFLOW or found.get("headSha") != sha:
        raise ValueError(f"run {run} is {found.get('workflowName')}'s for {str(found.get('headSha'))[:9]}, not {WORKFLOW}'s for {sha[:9]}")
    if found.get("status") != "completed":
        raise ValueError(f"run {run} is {found.get('status')}, not concluded: read it once it has, or with --head --wait")
    # Read as failed, its log holds the jobs that ran before the cancel and no verdict on the rest.
    if found.get("conclusion") == "cancelled":
        raise ValueError(f"run {run} was cancelled, so some of its jobs never ran: read the run that replaced it, or rerun this one")
    return found


def await_run(sha: str, timeout: float) -> str:
    """The id of the commit's verify run once it exists and has concluded, refused past the timeout."""
    deadline = time.monotonic() + timeout
    failures = 0
    while True:
        try:
            run = run_for(sha)
        except ValueError as failed:
            failures += 1
            if failures >= GH_FAILURES or time.monotonic() >= deadline:
                raise ValueError(f"gh failed {failures} time(s) running while waiting for {sha[:9]}'s run: {failed}") from None
            print(f"gh failed while waiting ({failures} of {GH_FAILURES}), asking again: {failed}", file=sys.stderr)
            time.sleep(POLL_SECONDS)
            continue
        failures = 0
        if run is not None and run.get("status") == "completed":
            return str(run["databaseId"])
        if time.monotonic() >= deadline:
            state = f"run {run['databaseId']} is {run.get('status')}" if run else "no verify run started"
            raise ValueError(f"{state} for {sha[:9]} within {timeout:g} s")
        time.sleep(POLL_SECONDS)


def clear(register: Path, statuses: dict[tuple[str, str | None], str]) -> None:
    """Each RED row whose literal and recorded job the map names given its CLEARED status, read afresh: a wait outlasts other writes."""

    def edit(lines: list[str]) -> None:
        status = _expected_table(lines)[0].index("Status")
        for row in expected_rows("\n".join(lines)):
            # By job as well as literal: two jobs can hold one literal, and one passing clears its own row alone.
            if (key := (row.matches, row.job)) in statuses:
                held = ledger.cells(lines[row.at])
                held[status] = statuses[key]
                lines[row.at] = ledger.joined(held)

    ledger.update(register, edit)


def expect(register: Path, run: str, sha: str, new: list[tuple[str, str]], cleared_by: str) -> list[str]:
    """One RED row per NEW finding written under the expected-red table, its job at the head of its reason; the rows."""
    filled = {
        "Matches": "`{text}`",
        "Lines": "1",
        "Why": "`{job}` job: NEW in run {run}",
        "Cleared": "{cleared_by}",
        "Since": "{sha}",
        "Status": "RED",
    }

    def edit(lines: list[str]) -> list[str]:
        header, _, end = _expected_table(lines)
        rows = []
        for job, text in new:
            if "\n" in text or "\r" in text:
                raise ValueError(f"`{text[:60]}` spans lines, and a row's literal is one line")
            # Its spacing kept: the read matches the literal inside a line as printed.
            values = {"text": text.replace("|", "\\|"), "job": job, "run": run, "cleared_by": ledger.escaped(cleared_by), "sha": sha[:9]}
            rows.append(
                ledger.joined([next((form.format(**values) for word, form in filled.items() if name.startswith(word)), "") for name in header])
            )
        lines[end + 1 : end + 1] = rows
        return rows

    return ledger.update(register, edit)


def _parser(prog: str) -> argparse.ArgumentParser:
    return argparse.ArgumentParser(prog=prog, description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)


def read_parser() -> argparse.ArgumentParser:
    parser = _parser("ci.py")
    parser.add_argument("register", type=Path)
    parser.add_argument("run", nargs="?")
    parser.add_argument("--head", action="store_true", help=f"the {WORKFLOW} run for the commit the branch was last pushed at")
    parser.add_argument("--wait", action="store_true", help="wait for that run to exist and conclude")
    parser.add_argument("--timeout", type=float, help=f"seconds --wait waits, {TIMEOUT_SECONDS:g} unless given")
    parser.add_argument("--commit", help="read this commit's run rather than the pushed one's, and write no row")
    parser.add_argument("--verbose", action="store_true", help="each expected row's matched lines too")
    return parser


def expect_parser() -> argparse.ArgumentParser:
    parser = _parser("ci.py expect")
    parser.add_argument("register", type=Path)
    parser.add_argument("run")
    parser.add_argument("--cleared-by", required=True, help="the landing that clears these reds")
    return parser


def _read(argv: list[str]) -> int:
    parser = read_parser()
    args = parser.parse_args(argv)
    if (args.run is None) == (not args.head) or (args.wait and not args.head) or (args.timeout is not None and not args.wait):
        parser.error("give a run or --head, --wait only with --head and --timeout only with --wait")
    # Refused before any wait: a register with no table to match against reads no run.
    expected_rows(ledger.read(args.register).decode("utf-8"))
    # Another commit's run, main's among them, says nothing about the rows the pushed head holds.
    sha, writes = (commit(args.commit), False) if args.commit else (pushed(), True)
    run = args.run or (await_run(sha, TIMEOUT_SECONDS if args.timeout is None else args.timeout) if args.wait else None)
    if run is None:
        found = run_for(sha)
        if found is None:
            raise ValueError(f"no {WORKFLOW} run for {sha[:9]} yet: read it with --wait")
        run = str(found["databaseId"])
    state = view(run, sha)
    held = ledger.read(args.register).decode("utf-8")
    if state.get("conclusion") == "success":
        rows = expected_rows(held)
        cleared = f"{len(rows)} RED row(s) CLEARED" if writes else "--commit reads without writing, so no row was set CLEARED"
        print(f"run {run} for {sha[:9]} succeeded: {cleared}\n0 NEW, 0 expected")
        if rows and writes:
            clear(args.register, {(row.matches, row.job): f"CLEARED {sha[:9]} (run {run}: every job passed)" for row in rows})
        return 0
    jobs = state.get("jobs")
    passed = (
        frozenset(str(job.get("name")) for job in jobs if isinstance(job, dict) and job.get("conclusion") == "success")
        if isinstance(jobs, list)
        else frozenset()
    )
    reading = report(_gh("run", "view", run, "--log-failed"), held, passed, args.verbose)
    # Printed before the write, so a failed write loses no reading.
    print(f"run {run} for {sha[:9]}")
    print("\n".join(reading.said))
    if reading.cleared and not writes:
        print("--commit reads without writing: no row above was set CLEARED", file=sys.stderr)
    elif reading.cleared:
        clear(args.register, {(row.matches, row.job): f"CLEARED {sha[:9]} (run {run}: `{row.job}` passed)" for row in reading.cleared})
    return 1 if reading.flagged else 0


def _expect(argv: list[str]) -> int:
    args = expect_parser().parse_args(argv)
    held = ledger.read(args.register).decode("utf-8")
    expected_rows(held)
    sha = pushed()
    state = view(args.run, sha)
    if state.get("conclusion") == "success":
        print(f"run {args.run} succeeded: no NEW line to expect")
        return 0
    reading = report(_gh("run", "view", args.run, "--log-failed"), held)
    # A job's summary or name stands in for no finding: a row matching it would expect every later failure of the job.
    specific = [pair for pair in reading.new if pair not in reading.generic]
    if not reading.new:
        print(f"run {args.run} printed no NEW line: nothing to expect")
    for line in expect(args.register, args.run, sha, specific, args.cleared_by) if specific else []:
        print(line)
    for job, text in sorted(reading.generic):
        print(
            f"not written: `{text}` is `{job}`'s summary or name, no finding, and a row matching it would expect every later "
            f"failure of `{job}`: read its log, and judge it at each read until the job passes",
            file=sys.stderr,
        )
    for line in reading.said:
        # A row past its bound holds lines no new row of their own can absorb without matching twice.
        if line.startswith("NEW") and "more than its" in line:
            print(f"not written, its row's `Lines` cell is for you to judge: {line.removeprefix('NEW').strip()}", file=sys.stderr)
    return 0


def main(argv: list[str]) -> int:
    try:
        return _expect(argv[1:]) if argv[:1] == ["expect"] else _read(argv)
    except (ValueError, OSError) as refused:
        print(refused, file=sys.stderr)
        return 2


if __name__ == "__main__":
    # A Windows pipe takes the console's codepage, which cannot encode every character a log holds.
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
