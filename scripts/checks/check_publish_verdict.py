"""SCRIPTS · whether `.github/workflows/publish.yml` may build the commit it was dispatched on.

The publish's only proof that a build is sound is `verify`'s own push run on `main` for that commit,
so the rule reading that run lives here, driven red by `scripts/tests/test_check_publish_verdict.py`,
rather than in a workflow's `run:` text no gate executes. The workflow fetches the payloads; this
reads them and decides nothing else.

Invariants:
- The commit is `main`'s tip, or a re-run of an old publish would move `:latest` backward.
- A `verify` run failed by the budget step alone passes (`docs/ops/spec.md :: I353`).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final

# Every caller runs this as a script, so sys.path opens with THIS directory and `lib/` is a
# sibling of it rather than in it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import EXIT_FINDINGS, EXIT_OK, EXIT_REFUSED, UNREADABLE, Finding, report_findings, run

# `.github/workflows/verify.yml`'s aggregate job and its budget step, matched by exact name. A
# rename there refuses every budget-only run until these follow, and
# `scripts/tests/test_check_publish_verdict.py` holds both to that file.
AGGREGATE_JOB: Final = "verify"
BUDGET_STEP: Final = "Hold every job to its wall-clock budget"
# The aggregate job's `continue-on-error` steps, which the same tests find in that file by the key:
# each decides nothing, and one failing beside the budget would refuse a run the budget alone failed.
ADVISORY_STEPS: Final = frozenset({"Report each scope's result", "Report the gate's wall clock"})

# What the workflow writes: the listing, and one jobs file per run it names, keyed by the attempt
# the listing reports, so the jobs read are the ones that attempt's conclusion describes.
RUNS_FILE: Final = "runs.json"
JOBS_FILE: Final = "jobs-{}-{}.json"

# A skipped job or step passed: on a push to main `commits` never runs and `format` is skipped
# whenever `frontend` runs, exactly as `verify`'s own verdict step reads them.
PASSED: Final = frozenset({"success", "skipped"})

COMMIT_RE: Final = re.compile(r"^[0-9a-f]{40}$")


class Unjudged(Exception):
    """A payload could not be read, so no verdict stands on it."""


@dataclass(frozen=True)
class Run:
    """One `verify` run as the runs listing gives it."""

    id: int
    attempt: int
    # None while the run is queued or in progress.
    conclusion: str | None


def runs_for(listing: object, commit: str) -> list[Run]:
    """The push runs on main for `commit`, filtered here as well as in the query.

    A pull request's run for the same head tested the merge ref, a different tree, and a query
    losing a filter would pass it.
    """
    if not isinstance(listing, dict) or not isinstance(listing.get("workflow_runs"), list):
        raise Unjudged("the runs listing carries no `workflow_runs` list")
    found: list[Run] = []
    for entry in listing["workflow_runs"]:
        if not isinstance(entry, dict) or not isinstance(entry.get("id"), int) or not isinstance(entry.get("run_attempt"), int):
            raise Unjudged("a run in the listing has no numeric id or attempt")
        if (entry.get("head_sha"), entry.get("event"), entry.get("head_branch")) != (commit, "push", "main"):
            continue
        conclusion = entry.get("conclusion")
        found.append(Run(entry["id"], entry["run_attempt"], conclusion if isinstance(conclusion, str) else None))
    return found


def failed_in(payload: object) -> list[str]:
    """One attempt's jobs, each neither passed nor skipped named, the aggregate job by such steps instead, its advisory steps apart.

    A null conclusion is a job still running, and it is named.
    """
    if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
        raise Unjudged("the jobs payload carries no `jobs` list")
    jobs = payload["jobs"]
    # A job past the page could be the one that failed, and its absence would read as a pass.
    total = payload.get("total_count")
    if isinstance(total, int) and total > len(jobs):
        raise Unjudged(f"the jobs payload holds {len(jobs)} of the run's {total} jobs")
    named: list[str] = []
    for job in jobs:
        if not isinstance(job, dict) or not isinstance(job.get("name"), str):
            raise Unjudged("a job in the payload has no name")
        if job.get("conclusion") in PASSED:
            continue
        if job["name"] != AGGREGATE_JOB:
            named.append(job["name"])
            continue
        for step in job.get("steps") or []:
            if not isinstance(step, dict) or not isinstance(step.get("name"), str):
                raise Unjudged(f"a step of `{AGGREGATE_JOB}` has no name")
            if step.get("conclusion") not in PASSED and step["name"] not in ADVISORY_STEPS:
                named.append(f"{AGGREGATE_JOB} / {step['name']}")
    return named


@dataclass(frozen=True)
class Verdict:
    """What the publish is told: its exit code, the findings behind a refusal, and a line on a pass."""

    code: int
    findings: tuple[Finding, ...] = ()
    passed: str = ""
    # The budget-only pass, which the run's annotations name rather than its log alone.
    notice: bool = False


def _read(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def verdict(commit: str, tip: str, payloads: Path) -> Verdict:
    """The publish's verdict on `commit`, given `main`'s tip and the directory the workflow filled."""
    if not COMMIT_RE.match(tip):
        return Verdict(
            EXIT_REFUSED, (Finding("fail", "main's tip could not be read, so nothing says this commit is the newest one. Nothing was built."),)
        )
    if commit != tip:
        return Verdict(
            EXIT_FINDINGS,
            (
                Finding(
                    "fail",
                    f"{commit} is not main's tip ({tip}), and a publish builds the tip alone: main moved after this dispatch, "
                    "or an old publish run was re-run, which would move :latest backward. Nothing was built. "
                    "Dispatch again: gh workflow run publish.yml --ref main",
                ),
            ),
        )
    try:
        runs = runs_for(_read(payloads / RUNS_FILE), commit)
    except (*UNREADABLE, ValueError, Unjudged) as exc:
        return Verdict(EXIT_REFUSED, (Finding("fail", f"verify's runs for {commit} could not be read ({exc}). Nothing was built."),))
    if not runs:
        # A dispatch moments after the merge finds no run yet. A skip instruction in the merge's
        # message leaves none ever, and `verify` has no trigger that could start one afterwards.
        return Verdict(
            EXIT_FINDINGS,
            (
                Finding(
                    "fail",
                    f"verify has no push run on main for {commit}, so nothing proves this commit. Nothing was built. "
                    "Dispatch again once its run has appeared and finished; where none ever will, publish the next commit to reach main.",
                ),
            ),
        )

    for candidate in runs:
        if candidate.conclusion == "success":
            return Verdict(EXIT_OK, passed=f"verify passed on main for {commit} (run {candidate.id})")

    seen: list[str] = []
    unread: list[str] = []
    for candidate in runs:
        if candidate.conclusion != "failure":
            seen.append(f"run {candidate.id} {candidate.conclusion or 'unfinished'}")
            continue
        try:
            named = failed_in(_read(payloads / JOBS_FILE.format(candidate.id, candidate.attempt)))
        except (*UNREADABLE, ValueError, Unjudged) as exc:
            unread.append(f"run {candidate.id} ({exc})")
            continue
        # The budget judges how long the gate took, not the tree, so a run it alone failed passes.
        if named == [f"{AGGREGATE_JOB} / {BUDGET_STEP}"]:
            return Verdict(
                EXIT_OK,
                passed=f"verify on main for {commit} failed on its wall-clock budget alone (run {candidate.id}); "
                "every other job and step passed, so this publish goes ahead.",
                notice=True,
            )
        seen.append(f"run {candidate.id} failure ({', '.join(named) or 'no failed job or step listed'})")

    if unread:
        # Read after every other run, so a run that passes still decides; one nobody could read
        # never counts as a refusal of the tree.
        return Verdict(EXIT_REFUSED, (Finding("fail", f"the jobs of {'; '.join(unread)} could not be read. Nothing was built."),))
    return Verdict(
        EXIT_FINDINGS,
        (
            Finding(
                "fail",
                f"verify on main for {commit} did not pass: {'; '.join(seen)}. "
                "Re-run it, or wait for it to finish, then dispatch again. Nothing was built.",
            ),
        ),
    )


def annotate(outcome: Verdict) -> None:
    """One workflow command per outcome, so the run's summary names the refusal or the exception."""
    if not os.environ.get("GITHUB_ACTIONS"):
        return
    for finding in outcome.findings:
        print(f"::error title=Publish::{finding.detail}")
    if outcome.notice:
        print(f"::notice title=Publish::{outcome.passed}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Whether publish.yml may build the commit it was dispatched on.")
    parser.add_argument("--commit", required=True, metavar="SHA", help="the commit the publish would build")
    parser.add_argument("--tip", required=True, metavar="SHA", help="main's tip as the API reports it, empty where it could not be read")
    parser.add_argument(
        "--payloads",
        required=True,
        metavar="DIR",
        help=f"the directory holding verify's runs for the commit ({RUNS_FILE}) and each run's jobs ({JOBS_FILE.format('<id>', '<attempt>')})",
    )
    args = parser.parse_args()
    if not COMMIT_RE.match(args.commit):
        parser.error("--commit takes a full 40-character commit")

    outcome = verdict(args.commit, args.tip, Path(args.payloads))
    annotate(outcome)
    if outcome.code == EXIT_REFUSED:
        for finding in outcome.findings:
            print(f"      {finding.detail}", file=sys.stderr)
        return EXIT_REFUSED
    code = report_findings(outcome.findings)
    if outcome.passed:
        print(f"      {outcome.passed}")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
