"""SCRIPTS · the gate's wall-clock budget.

Two questions over `.github/gate-wall-clock.tsv`, one per mode. `--jobs` holds every job of the
run in hand to the budget its row gives it and refuses the run that breaks one, naming the job and
both figures. `--base` holds the file itself: a budget or a reference that rose against the base
carries a new measurement stamp, so a ceiling is never lifted by editing a number alone.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Final

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

# The aggregate job and the path mapping, left out under the wall-clock report's own rule: neither
# is the gate's work, and the report and this check read one population.
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

# What reading the jobs payload can raise -- `json` answers a ValueError -- named for
# `checker_kernel.py :: UNREADABLE`'s reason. Flat, or pyright reads the nested tuple as no class.
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
    evidence. `unmeasured`: a success with no step timestamp, refused rather than passed.
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


def check_run(rows: dict[str, Row], spans: list[Span]) -> tuple[list[Finding], list[str]]:
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
                    f"`{span.job}` ran for {span.seconds} s and has no row in {REFERENCE}, so it has no budget: "
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


def base_text(base_ref: str) -> str | None:
    """The reference as the base commit holds it, or None where that commit has no such file."""
    return git("show", f"{base_ref}:{REFERENCE.as_posix()}")


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
    parser.add_argument("--reference", default=str(REPO_ROOT / REFERENCE), help=argparse.SUPPRESS)
    args = parser.parse_args()

    try:
        rows = parse_reference(Path(args.reference).read_text(encoding="utf-8"))
    except UNREADABLE as exc:
        print(f"      {REFERENCE} could not be read ({exc}), so nothing was compared.", file=sys.stderr)
        return EXIT_REFUSED
    except Malformed as exc:
        print(f"      {REFERENCE} is not a table this check can read: {exc}. Nothing was compared.", file=sys.stderr)
        return EXIT_REFUSED

    if args.jobs is not None:
        try:
            raw = sys.stdin.read() if args.jobs == "-" else Path(args.jobs).read_text(encoding="utf-8")
            spans = spans_of(json.loads(raw))
        except UNREADABLE_PAYLOAD as exc:
            print(f"      the jobs payload could not be read ({exc}), so no job was held to its budget.", file=sys.stderr)
            return EXIT_REFUSED
        findings, lines = check_run(rows, spans)
        for line in lines:
            print(f"      {line}")
        annotate(findings)
        # The stream named at the call: the kernel binds its default at import, ahead of any redirect.
        code = report_findings(findings, stream=sys.stdout)
        if code == EXIT_OK:
            print(f"      every measured job sits inside its budget ({REFERENCE})")
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
    findings = check_raise(before, rows, datetime.now(timezone.utc).date())
    annotate(findings)
    code = report_findings(findings, stream=sys.stdout)
    if code == EXIT_OK:
        print(f"      no figure in {REFERENCE} rose against {base[:7]} without its measurement")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
