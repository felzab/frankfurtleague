"""SCRIPTS · the gate's wall-clock budget, and the median report beside it.

Three questions over `.github/gate-wall-clock.tsv`, one per mode. `--jobs` holds every job of the
run in hand to the budget its row gives it and refuses the run that breaks one, naming the job and
both figures. `--base` holds the file itself: a budget or a reference that rose against the base
carries a new measurement stamp, so a ceiling is never lifted by editing a number alone. `--window`
reports each job's median over the last main runs against its reference and floor, and decides no
outcome. `--reference` names the file every mode reads, so a copy is judged before it is committed.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import statistics
import sys
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Final

# Every caller runs this as a script, so sys.path opens with THIS directory and `lib/` is a
# sibling of it rather than in it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import (
    DEFAULT_BASE,
    EXIT_OK,
    EXIT_REFUSED,
    REPO_ROOT,
    UNREADABLE,
    Finding,
    git,
    report_findings,
    resolve_base,
    run,
)

REFERENCE: Final = Path(".github/gate-wall-clock.tsv")

# The aggregate job and the path mapping, measured by no mode: neither is the gate's work, and the
# budget and the `--window` report read one population.
UNMEASURED_JOBS: Final[frozenset[str]] = frozenset({"verify", "changes"})

# A column that does not apply to a row -- a total's budget, a budget nobody set, a stamp over a
# row with no figures of its own -- rather than a zero, which the report would divide by.
NONE: Final = "-"

COLUMNS: Final = ("job", "seconds", "floor", "budget", "measured")
TOTAL: Final = "total"

# `<runs>@<date>`: how many completed runs a row's figures were taken over, and the newest one's day.
STAMP: Final = re.compile(r"^([1-9][0-9]*)@([0-9]{4}-[0-9]{2}-[0-9]{2})$")


class Malformed(Exception):
    """The reference cannot be read as a table, so no verdict stands on it."""


# ASCII digits alone: `str.isdigit` admits a superscript, which `int` then refuses.
WHOLE: Final = re.compile(r"^[0-9]+$")

# What reading the jobs payload can raise -- `json` answers a ValueError. Flat, or pyright reads the
# nested tuple as no class.
UNREADABLE_PAYLOAD: Final = (*UNREADABLE, ValueError, Malformed)


@dataclass(frozen=True)
class Row:
    """One job's line in the reference: the report's pair, the budget, and what measured them."""

    job: str
    seconds: int | None
    floor: int | None
    budget: int | None
    measured: str | None

    @property
    def stamp_date(self) -> date | None:
        # Validated at parse, so a miss here is a row nothing parsed -- refused there, never read here.
        match = None if self.measured is None else STAMP.match(self.measured)
        return None if match is None else date.fromisoformat(match.group(2))


def _number(field: str, column: str, job: str) -> int | None:
    if field == NONE:
        return None
    if not WHOLE.match(field):
        raise Malformed(f"row `{job}`: {column} is `{field}`, and a figure here is a whole number of seconds or `{NONE}`")
    return int(field)


def _stamp(field: str, job: str) -> str | None:
    if field == NONE:
        return None
    match = STAMP.match(field)
    if match is None:
        raise Malformed(f"row `{job}`: the stamp `{field}` is not `<runs>@<YYYY-MM-DD>`")
    try:
        date.fromisoformat(match.group(2))
    except ValueError:
        raise Malformed(f"row `{job}`: the stamp `{field}` names no calendar day") from None
    return field


def parse_reference(text: str) -> dict[str, Row]:
    """The table out of the file, refused whole on the first thing that is not one."""
    rows: dict[str, Row] = {}
    for number, line in enumerate(text.splitlines(), start=1):
        if not line.strip() or line.startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) != len(COLUMNS):
            raise Malformed(
                f"line {number} has {len(fields)} tab-separated field(s), and every row carries {len(COLUMNS)}: {', '.join(COLUMNS)}"
            )
        job, seconds, floor, budget, measured = fields
        if job in rows:
            raise Malformed(f"row `{job}` appears twice")
        row = Row(job, _number(seconds, "seconds", job), _number(floor, "floor", job), _number(budget, "budget", job), _stamp(measured, job))
        if row.budget is not None and row.seconds is not None and row.budget < row.seconds:
            raise Malformed(f"row `{job}`: a budget of {row.budget} s sits under the {row.seconds} s reference it is a ceiling over")
        if row.budget is not None and row.measured is None:
            raise Malformed(f"row `{job}`: a budget with no measurement stamp -- the runs it was set over are what the header asks for")
        rows[job] = row
    if not rows:
        raise Malformed("no row at all")
    total = rows.get(TOTAL)
    summed = sum(row.seconds for job, row in rows.items() if job != TOTAL and row.seconds is not None)
    if total is None or total.seconds != summed:
        have = "no total row" if total is None else f"a total of {total.seconds} s"
        raise Malformed(f"the job rows sum to {summed} s and the file carries {have}; the header asks that the two move together")
    return rows


@dataclass(frozen=True)
class Span:
    """What one job of the run in hand did, as the jobs API tells it."""

    job: str
    state: str  # ok · skipped · dropped · unmeasured
    seconds: int


def _instant(stamp: str) -> float:
    return datetime.fromisoformat(stamp).timestamp()


def spans_of(payload: object) -> list[Span]:
    """Every job's span, first step to last, on the report's rules.

    `skipped`: the scope was mapped off. `dropped`: the job did not succeed, so its timing is no
    evidence. `unmeasured`: a success with no step timestamp, failed rather than passed.
    """
    if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
        raise Malformed("the jobs payload carries no `jobs` list")
    spans: list[Span] = []
    for job in payload["jobs"]:
        if not isinstance(job, dict) or not isinstance(job.get("name"), str):
            raise Malformed("a job in the payload has no name")
        name = job["name"]
        if name in UNMEASURED_JOBS:
            continue
        if job.get("conclusion") == "skipped":
            spans.append(Span(name, "skipped", 0))
            continue
        if job.get("conclusion") != "success":
            spans.append(Span(name, "dropped", 0))
            continue
        steps = job.get("steps") or []
        starts = [_instant(step["started_at"]) for step in steps if isinstance(step, dict) and step.get("started_at")]
        ends = [_instant(step["completed_at"]) for step in steps if isinstance(step, dict) and step.get("completed_at")]
        if not starts or not ends:
            spans.append(Span(name, "unmeasured", 0))
            continue
        spans.append(Span(name, "ok", int(round(max(ends) - min(starts)))))
    return spans


def check_run(rows: dict[str, Row], spans: list[Span], reference: str) -> tuple[list[Finding], list[str]]:
    """Each measured job against its budget: the findings, and one line per job for the log.

    The lines print on a green run too: a session about to add to a job needs its cost in view,
    and a check that speaks only to refuse hides the figure until then.
    """
    findings: list[Finding] = []
    lines: list[str] = []
    for span in sorted(spans, key=lambda s: s.job):
        row = rows.get(span.job)
        if span.state == "skipped":
            lines.append(f"{span.job}: skipped, its scope turned off by the path mapping")
            continue
        if span.state == "dropped":
            lines.append(f"{span.job}: did not succeed, so its length is no evidence and was not compared")
            continue
        if span.state == "unmeasured":
            findings.append(
                Finding(
                    "fail", f"`{span.job}` succeeded, but the jobs API carries no step timestamp for it, so its length could not be measured"
                )
            )
            continue
        if row is None:
            findings.append(
                Finding(
                    "fail",
                    f"`{span.job}` ran for {span.seconds} s and has no row in {reference}, so it has no budget: "
                    "add its row, measured, in the same change that adds the job",
                )
            )
            continue
        if row.budget is None:
            lines.append(f"{span.job}: {span.seconds} s, measured and not budgeted (the header says why)")
            continue
        if span.seconds > row.budget:
            findings.append(Finding("fail", f"`{span.job}` took {span.seconds} s against a budget of {row.budget} s"))
            continue
        lines.append(f"{span.job}: {span.seconds} s of {row.budget} s")
    return findings, lines


def check_raise(base: dict[str, Row] | None, head: dict[str, Row], today: date) -> list[Finding]:
    """The file against its base: what rose carries a fresh stamp, and a ceiling never vanishes.

    Lowering and deleting a row are free. What costs a measurement is what makes the gate slower
    on paper: a higher reference or budget, or a budget dropped to `-`.
    """
    findings: list[Finding] = []
    for job, row in head.items():
        if job == TOTAL:
            continue
        before = None if base is None else base.get(job)
        stamp_date = row.stamp_date
        if stamp_date is not None and stamp_date > today:
            findings.append(
                Finding("fail", f"`{job}`'s stamp {row.measured} is dated after today ({today.isoformat()}), and a measurement cannot be")
            )
            continue
        if before is None:
            # New to the file. A budget here is already held to carry a stamp at parse.
            continue
        if before.budget is not None and row.budget is None:
            findings.append(
                Finding(
                    "fail",
                    f"`{job}`'s budget of {before.budget} s was dropped to `{NONE}`, a ceiling raised without limit; no stamp justifies it",
                )
            )
            continue
        rose: list[str] = []
        if row.budget is not None and (before.budget is None or row.budget > before.budget):
            rose.append(f"budget {before.budget if before.budget is not None else NONE} -> {row.budget} s")
        if row.seconds is not None and (before.seconds is None or row.seconds > before.seconds):
            rose.append(f"reference {before.seconds if before.seconds is not None else NONE} -> {row.seconds} s")
        if not rose:
            continue
        moved = ", ".join(rose)
        if row.measured is None or row.measured == before.measured:
            findings.append(
                Finding(
                    "fail",
                    f"`{job}` rose ({moved}) on the unchanged stamp {before.measured or NONE}: a raise carries the runs that measured it",
                )
            )
            continue
        earlier = before.stamp_date
        if earlier is not None and stamp_date is not None and stamp_date < earlier:
            findings.append(Finding("fail", f"`{job}` rose ({moved}) on a stamp {row.measured} older than the {before.measured} it replaces"))
    return findings


class NoComparison(Exception):
    """The window could not be assembled, so the report says why and compares nothing."""


# What the workflow writes beside the listing, one file per run it names.
RUNS_FILE: Final = "runs.json"
JOBS_FILE: Final = "jobs-{}.json"


def window_of(directory: Path, size: int) -> list[Span]:
    """Every job of the newest `size` completed main runs, or NoComparison naming what was missing.

    One unreadable run ends the window rather than shrinking it: medians over the rest would print
    as a whole window's.
    """
    try:
        listing = json.loads((directory / RUNS_FILE).read_text(encoding="utf-8"))
        runs = listing["workflow_runs"]
        ids = [str(run["id"]) for run in runs[:size]]
    except (*UNREADABLE, ValueError, TypeError, KeyError):
        raise NoComparison("The list of completed main runs could not be read, so no window was assembled and no floor was tested.") from None
    if len(ids) < size:
        raise NoComparison(
            f"{len(ids)} completed main runs are on record and {size} are needed for a window, "
            "so no median was computed and no floor was tested."
        )
    spans: list[Span] = []
    unread: list[str] = []
    for run_id in ids:
        try:
            spans += spans_of(json.loads((directory / JOBS_FILE.format(run_id)).read_text(encoding="utf-8")))
        except UNREADABLE_PAYLOAD:
            unread.append(run_id)
    if unread:
        raise NoComparison(
            f"The jobs of main run(s) {', '.join(unread)} could not be read, so no window was assembled and no floor was tested."
        )
    return spans


def _median(values: list[int]) -> int:
    """A median, not a mean: one cold `images` run, tenfold a warm one, would carry a mean nobody could read past."""
    # Half up, never Python's own rounding, which takes a half to the even neighbour.
    return math.floor(statistics.median(values) + 0.5)


def report_window(rows: dict[str, Row], spans: list[Span], size: int, reference: str) -> tuple[str, str]:
    """The run summary's markdown, and which of `clean`, `partial` or `regressed` it reached."""
    # A `-` in the seconds column is a job budgeted with no reference cut from main runs, not a zero.
    referenced = {job: (row.seconds, row.floor or 0) for job, row in rows.items() if row.seconds is not None}
    seen: dict[str, list[int]] = {}
    unreferenced: list[str] = []
    skipped = dropped = 0
    for span in spans:
        if span.state == "skipped":
            # Counted apart, or a job skipped on every main push reads as a run that broke.
            skipped += 1
        elif span.state != "ok":
            dropped += 1
        elif span.job not in referenced:
            if span.job not in unreferenced:
                unreferenced.append(span.job)
        else:
            seen.setdefault(span.job, []).append(span.seconds)

    loud: list[tuple[int, str]] = []
    gone: list[str] = []
    total = 0
    for job, (seconds, floor) in referenced.items():
        if job == TOTAL:
            continue
        if job not in seen:
            gone.append(job)
            continue
        median = _median(seen[job])
        total += median
        # A reference of zero has no percentage to give; named in the trailer as the half-done hand
        # edit it is, rather than dropped.
        if seconds <= 0:
            unreferenced.append(job)
            continue
        delta = (median - seconds) * 100 / seconds
        # The quiet state: under its own floor a job says nothing, so a row printed is always a
        # figure somebody has to account for.
        if abs(delta) <= floor:
            continue
        loud.append((median, f"| `{job}` | {median}s | {seconds}s | {median - seconds:+d}s ({delta:+.1f}%) | {floor}% |"))
    lines = [line for _, line in sorted(loud, key=lambda entry: -entry[0])]

    whole = not gone
    summed, summed_floor = referenced.get(TOTAL, (0, 0))
    # Only where every referenced job was observed: a window missing one leaves a sum that is short
    # rather than one that is faster.
    if whole and summed > 0:
        delta = (total - summed) * 100 / summed
        if abs(delta) > summed_floor:
            lines.append(
                f"| **the whole gate** | **{total}s** | **{summed}s** | **{total - summed:+d}s ({delta:+.1f}%)** | **{summed_floor}%** |"
            )

    out: list[str] = []
    if not lines and whole:
        out.append(f"**Gate wall clock:** every job median over the last {size} main runs sits inside its own floor.")
    elif not lines:
        # Not the clean sentence: a job with no run in this window was compared against nothing.
        out.append(
            "**Gate wall clock:** nothing that could be measured has moved past its own floor, and a job named below was not "
            "measured at all, so this is not a clean comparison."
        )
    else:
        out += ["### Gate wall clock", "", f"Medians over the last {size} main runs that have moved past their own floor:", ""]
        out += ["| Job | median | reference | delta | floor |", "| --- | ---: | ---: | ---: | ---: |", *lines]
    out += [
        "",
        f"The reference is `{reference}`, a fixed table updated by hand and never recomputed from the recent past, which is what would "
        f"let a slowdown become the new normal one window at a time. Each floor is the p95 movement of that median when a {size}-run "
        "window is resampled from the reference population, so a delta under it is a reshuffle and not a change. A figure spans a job "
        "from its first step to its last, leaving the wait for a runner out.",
        "",
        f"{dropped} job run(s) in this window did not succeed and are outside the sample, so a scope slow enough to fail or to reach "
        "its timeout is invisible here.",
    ]
    if skipped:
        out += ["", f"{skipped} job run(s) never started, their scope turned off by the path mapping rather than by anything they did."]
    if gone:
        out += ["", f"No successful run in this window: {', '.join(gone)}."]
    if unreferenced:
        out += ["", f"Measured with no reference to compare against: {', '.join(unreferenced)}."]
    verdict = "regressed" if lines else "clean" if whole else "partial"
    return "\n".join(out) + "\n", verdict


# A clean report is the only state that annotates nothing, so silence on the checks list means the
# comparison ran and found nothing rather than that it never ran.
WINDOW_WARNINGS: Final = {
    "regressed": "A job median has moved past its own floor. The run summary holds the table.",
    "partial": "A job in the reference has no successful run in this window, so this is not a clean comparison. The run summary names it.",
}


def no_comparison(reason: str) -> str:
    """The summary block for a report that compared nothing, which must not read like a clean one."""
    return f"### Gate wall clock — no comparison\n\n{reason}\n\nNothing in this run says whether the gate has got slower.\n"


def warn(message: str) -> None:
    """An annotation as well as the summary: the checks list is where most readers look."""
    if os.environ.get("GITHUB_ACTIONS"):
        print(f"::warning title=Gate wall clock::{message}")


def append(summary: Path, text: str) -> None:
    # Appended, never truncated, as GitHub documents writing it: whatever the step wrote there first
    # stays in the summary.
    with summary.open("ab") as handle:
        handle.write(text.encode("utf-8"))


def base_text(base_ref: str) -> str | None:
    """The reference as the base commit holds it, or None where that commit has no such file."""
    return git("show", f"{base_ref}:{REFERENCE.as_posix()}")


def named(path: Path) -> str:
    """The reference as the reader can find it again: repo-relative where it sits under the root.

    What `--reference` opened, `REFERENCE` naming only the base's copy that `git show` reads.
    """
    try:
        # Resolved on both sides, or a path reached through a symlink or the other drive-letter
        # case reads as outside a root it is inside, and the whole absolute path prints instead.
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return str(path)


def annotate(findings: list[Finding]) -> None:
    """One workflow command per failure, so the checks list names the job and both figures."""
    if not os.environ.get("GITHUB_ACTIONS"):
        return
    for finding in findings:
        if finding.severity == "fail":
            print(f"::error title=Gate budget::{finding.detail}")


def main() -> int:
    parser = argparse.ArgumentParser(description="The gate's wall-clock budget (.github/gate-wall-clock.tsv).")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--jobs", metavar="PATH", help="the run's jobs as the Actions API returns them, or - for stdin")
    mode.add_argument(
        "--base", nargs="?", const=DEFAULT_BASE, metavar="REF", help=f"hold the reference file against this base (default: {DEFAULT_BASE})"
    )
    mode.add_argument(
        "--window",
        metavar="DIR",
        help=f"report medians over the main runs listed in DIR/{RUNS_FILE}, each run's jobs in DIR/{JOBS_FILE.format('<id>')}",
    )
    parser.add_argument("--runs", type=int, metavar="N", help="with --window: how many runs make a window, the page size they were listed with")
    parser.add_argument("--summary", metavar="PATH", help="with --window: the file the report is appended to (default: stdout)")
    parser.add_argument(
        "--reference",
        default=str(REPO_ROOT / REFERENCE),
        metavar="PATH",
        help=f"the reference file every mode reads (default: {REFERENCE.as_posix()}), so a copy can be judged before it is committed",
    )
    args = parser.parse_args()
    if args.window is not None and (args.runs is None or args.runs < 1):
        parser.error("--window needs --runs, a whole number of runs above zero")
    # Refused rather than ignored: beside `--jobs` or `--base` either flag would read as honoured.
    if args.window is None and any(flag is not None for flag in (args.runs, args.summary)):
        parser.error("--runs and --summary go with --window alone")

    def summarise(text: str) -> None:
        if args.summary is None:
            print(text, end="")
        else:
            append(Path(args.summary), text)

    opened = Path(args.reference)
    reference = named(opened)

    def unread(why: str) -> int:
        print(f"      {reference} {why}", file=sys.stderr)
        # The report still says so where it is read, or a run that compared nothing looks clean.
        if args.window is not None:
            reason = f"The reference table {reference} was not read, so there is nothing to compare against."
            summarise(no_comparison(reason))
            warn(reason)
            # 0, as every no-comparison state: the report is advisory. `--jobs` and `--base` still
            # refuse this with 2.
            return EXIT_OK
        return EXIT_REFUSED

    try:
        rows = parse_reference(opened.read_text(encoding="utf-8"))
    except UNREADABLE as exc:
        return unread(f"could not be read ({exc}), so nothing was compared.")
    except Malformed as exc:
        return unread(f"is not a table this check can read: {exc}. Nothing was compared.")

    if args.window is not None:
        try:
            spans = window_of(Path(args.window), args.runs)
        except NoComparison as exc:
            summarise(no_comparison(str(exc)))
            warn(str(exc))
            return EXIT_OK
        text, verdict = report_window(rows, spans, args.runs, reference)
        summarise(text)
        if verdict in WINDOW_WARNINGS:
            warn(WINDOW_WARNINGS[verdict])
        print(f"      the wall-clock report over the last {args.runs} main runs reached `{verdict}` ({reference})")
        return EXIT_OK

    if args.jobs is not None:
        source = "stdin" if args.jobs == "-" else named(Path(args.jobs))
        try:
            raw = sys.stdin.read() if args.jobs == "-" else Path(args.jobs).read_text(encoding="utf-8")
            spans = spans_of(json.loads(raw))
        except UNREADABLE_PAYLOAD as exc:
            print(f"      the jobs payload from {source} could not be read ({exc}), so no job was held to its budget.", file=sys.stderr)
            return EXIT_REFUSED
        findings, lines = check_run(rows, spans, reference)
        for line in lines:
            print(f"      {line}")
        annotate(findings)
        code = report_findings(findings)
        if code == EXIT_OK:
            print(f"      every measured job sits inside its budget ({reference})")
        return code

    base = resolve_base(args.base)
    if base is None:
        print(f"      nothing here is named {args.base} or origin/{args.base} -- the reference was not held against a base.", file=sys.stderr)
        return EXIT_REFUSED
    before_text = base_text(base)
    try:
        before = None if before_text is None else parse_reference(before_text)
    except Malformed as exc:
        # The base's copy is not this branch's to fix; the branch is held against what it can be.
        print(f"      the base's {REFERENCE} is not a table this check can read ({exc}), so the branch's figures are compared against nothing.")
        before = None
    findings = check_raise(before, rows, datetime.now(UTC).date())
    annotate(findings)
    code = report_findings(findings)
    if code == EXIT_OK:
        print(f"      no figure in {reference} rose against {base[:7]} without its measurement")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
