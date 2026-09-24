"""SCRIPTS · the publish verdict, driven over payloads shaped as the Actions runs and jobs APIs return them.

Every refusal is a case, because a pass rule loosened by one comparison publishes over a failed
`verify` and turns nothing red: the cases name the run-, job- and step-level states the rule reads.
The names it matches on, and the budget step's condition, are held to `.github/workflows/verify.yml`,
and its call site to `.github/workflows/publish.yml`, each found there by what it does rather than
by the name it carries.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final
from unittest.mock import patch

from conftest import import_scripts
from test_check_gate_budget import JOB_NAME_RE, MATRIX_RE, job_bodies

REPO_ROOT: Final = Path(__file__).resolve().parents[2]
WORKFLOWS: Final = REPO_ROOT / ".github" / "workflows"

[publish] = import_scripts("check_publish_verdict")

COMMIT: Final = "0123456789abcdef0123456789abcdef01234567"
OTHER: Final = "fedcba9876543210fedcba9876543210fedcba98"


def run(
    run_id: int, conclusion: str | None, *, attempt: int = 1, sha: str = COMMIT, event: str = "push", branch: str = "main"
) -> dict[str, Any]:
    """One entry of the runs listing, with the fields the verdict reads."""
    return {"id": run_id, "run_attempt": attempt, "conclusion": conclusion, "head_sha": sha, "event": event, "head_branch": branch}


def step(name: str | None, conclusion: str | None) -> dict[str, Any]:
    return {"name": name, "conclusion": conclusion}


def aggregate(conclusion: str | None, budget_step: str = publish.BUDGET_STEP, **overrides: str | None) -> dict[str, Any]:
    """`verify.yml`'s aggregate job, every step passed or skipped as a green push run leaves it, `overrides` by step name.

    `budget_step` names the budget step, so a rename replaces it rather than standing beside it.
    """
    steps: dict[str, str | None] = {
        "Report each scope's result": "success",
        "Read the wall-clock reference and the budget check": "success",
        "Run actions/setup-python": "success",
        "Report the gate's wall clock": "success",
        "Fail if any scope job failed or was cancelled": "skipped",
        budget_step: "success",
    }
    steps.update(overrides)
    return {"name": publish.AGGREGATE_JOB, "conclusion": conclusion, "steps": [step(name, value) for name, value in steps.items()]}


def job(name: str | None, conclusion: str | None, *steps: dict[str, Any]) -> dict[str, Any]:
    return {"name": name, "conclusion": conclusion, "steps": list(steps)}


# The scope jobs of a push run on main: `commits` runs for pull requests alone.
SCOPES: Final = (job("changes", "success"), job("scripts", "success"), job("frontend", "success"), job("commits", "skipped"))


def jobs(*listed: dict[str, Any]) -> dict[str, Any]:
    return {"total_count": len(listed), "jobs": list(listed)}


BUDGET_ONLY: Final = jobs(*SCOPES, aggregate("failure", **{publish.BUDGET_STEP: "failure"}))
# The budget step runs whatever the scope jobs concluded, so a failed scope leaves it passed or failed.
A_SCOPE_FAILED: Final = jobs(
    job("changes", "success"),
    job("scripts", "failure"),
    aggregate("failure", **{"Fail if any scope job failed or was cancelled": "failure"}),
)


@dataclass(frozen=True)
class Case:
    """A `jobs` key is a run id, filed under its listed attempt, or an `(id, attempt)` pair.

    `listing` bytes replace the listing, and None leaves it unwritten.
    """

    name: str
    runs: list[dict[str, Any]]
    code: int
    jobs: dict[int | tuple[int, int], dict[str, Any]] = field(default_factory=dict)
    tip: str = COMMIT
    listing: bytes | None | bool = True


CASES: Final[tuple[Case, ...]] = (
    # The run level.
    Case("a run that succeeded", [run(11, "success")], 0),
    Case("a run failed by the budget step alone", [run(12, "failure")], 0, {12: BUDGET_ONLY}),
    Case("a run in which a scope job failed", [run(13, "failure")], 1, {13: A_SCOPE_FAILED}),
    Case(
        "a run in which a scope job and the budget both failed",
        [run(17, "failure")],
        1,
        {
            17: jobs(
                job("scripts", "failure"),
                aggregate("failure", **{"Fail if any scope job failed or was cancelled": "failure", publish.BUDGET_STEP: "failure"}),
            )
        },
    ),
    Case("no run at all", [], 1),
    Case("a run still in progress", [run(14, None)], 1),
    Case("a cancelled run", [run(15, "cancelled")], 1),
    *(
        Case(f"a run concluding {value}", [run(16, value)], 1)
        for value in ("timed_out", "action_required", "neutral", "stale", "startup_failure", "skipped")
    ),
    Case("a failed run, then a run that succeeded", [run(18, "failure"), run(19, "success")], 0, {18: A_SCOPE_FAILED}),
    Case("a failed run whose jobs name nothing", [run(20, "failure")], 1, {20: jobs(*SCOPES, aggregate("success"))}),
    # Runs the query should never return, each judged as absent.
    Case("a pull request's run for the commit", [run(21, "success", event="pull_request")], 1),
    Case("a run for another commit", [run(22, "success", sha=OTHER)], 1),
    Case("a run on another branch", [run(23, "success", branch="elsewhere")], 1),
    # The job level.
    Case("a job still running in a re-run attempt", [run(24, "failure")], 1, {24: jobs(job("scripts", None), *BUDGET_ONLY["jobs"])}),
    Case("a scope job that timed out beside the budget", [run(42, "failure")], 1, {42: jobs(job("db", "timed_out"), *BUDGET_ONLY["jobs"])}),
    Case(
        "a scope job's continue-on-error step failed, the job succeeding",
        [run(25, "failure")],
        0,
        {25: jobs(job("db", "success", step("Pull the database image", "failure")), *BUDGET_ONLY["jobs"])},
    ),
    Case(
        "a re-run's attempt failed in a scope where an earlier attempt failed by the budget alone",
        [run(38, "failure", attempt=2)],
        1,
        {(38, 1): BUDGET_ONLY, (38, 2): A_SCOPE_FAILED},
    ),
    # The step level, inside the aggregate job.
    Case(
        "the budget failed beside an advisory step",
        [run(26, "failure")],
        1,
        {26: jobs(*SCOPES, aggregate("failure", **{publish.BUDGET_STEP: "failure", "Report the gate's wall clock": "failure"}))},
    ),
    Case(
        "a budget step under another name",
        [run(27, "failure")],
        1,
        {27: jobs(*SCOPES, aggregate("failure", "Hold every job to its budget", **{"Hold every job to its budget": "failure"}))},
    ),
    Case(
        "the budget step cancelled by the job's timeout",
        [run(28, "failure")],
        0,
        {28: jobs(*SCOPES, aggregate("cancelled", **{publish.BUDGET_STEP: "cancelled"}))},
    ),
    # The budget step runs after either failure, and fails on the reference it cannot read.
    Case(
        "the aggregate job's checkout failed",
        [run(29, "failure")],
        1,
        {
            29: jobs(
                *SCOPES,
                aggregate(
                    "failure",
                    **{
                        "Read the wall-clock reference and the budget check": "failure",
                        "Run actions/setup-python": "skipped",
                        "Report the gate's wall clock": "skipped",
                        publish.BUDGET_STEP: "failure",
                    },
                ),
            )
        },
    ),
    Case(
        "the aggregate job's python setup failed",
        [run(30, "failure")],
        1,
        {
            30: jobs(
                *SCOPES,
                aggregate(
                    "failure",
                    **{"Run actions/setup-python": "failure", "Report the gate's wall clock": "skipped", publish.BUDGET_STEP: "failure"},
                ),
            )
        },
    ),
    Case("the aggregate job failed listing no step", [run(31, "failure")], 1, {31: jobs(*SCOPES, job(publish.AGGREGATE_JOB, "failure"))}),
    # main's tip.
    Case("a commit main has moved past", [run(32, "success")], 1, tip=OTHER),
    Case("a tip nobody could read", [run(33, "success")], 2, tip=""),
    # Payloads that cannot be judged.
    Case("a runs listing never fetched", [], 2, listing=None),
    Case("a runs listing that is not JSON", [], 2, listing=b"<html>"),
    Case("a runs listing with no list of runs", [], 2, listing=b'{"total_count": 0}'),
    Case("a run with no attempt", [{**run(43, "success"), "run_attempt": None}], 2),
    Case("a failed run whose jobs were not fetched", [run(34, "failure")], 2),
    Case("a failed run whose jobs are an earlier attempt's alone", [run(44, "failure", attempt=2)], 2, {(44, 1): BUDGET_ONLY}),
    Case("an unfetched failed run beside one that succeeded", [run(35, "failure"), run(36, "success")], 0),
    Case("an unfetched failed run before one failed by the budget alone", [run(45, "failure"), run(46, "failure")], 0, {46: BUDGET_ONLY}),
    Case("a jobs page holding fewer than the run's jobs", [run(37, "failure")], 2, {37: {**BUDGET_ONLY, "total_count": 40}}),
    Case("a job with no name", [run(47, "failure")], 2, {47: jobs(job(None, "failure"), *BUDGET_ONLY["jobs"])}),
    Case(
        "an aggregate step with no name",
        [run(48, "failure")],
        2,
        {48: jobs(*SCOPES, {**aggregate("failure"), "steps": [step(None, "failure")]})},
    ),
)


def filled(directory: Path, case: Case) -> Path:
    """The directory as the workflow leaves it: the listing, and one jobs file per run attempt it fetched."""
    directory.mkdir(parents=True)
    if case.listing is True:
        listing = json.dumps({"total_count": len(case.runs), "workflow_runs": case.runs}).encode("utf-8")
        (directory / publish.RUNS_FILE).write_bytes(listing)
    elif isinstance(case.listing, bytes):
        (directory / publish.RUNS_FILE).write_bytes(case.listing)
    attempts = {entry["id"]: entry["run_attempt"] for entry in case.runs}
    for key, payload in case.jobs.items():
        run_id, attempt = key if isinstance(key, tuple) else (key, attempts[key])
        (directory / publish.JOBS_FILE.format(run_id, attempt)).write_bytes(json.dumps(payload).encode("utf-8"))
    return directory


def test_every_case_reaches_its_exit_code(tmp_path: Path):
    """Each case, gathered into one list of misses so a loosened rule names every case it lets through."""
    misses: list[str] = []
    for index, case in enumerate(CASES):
        outcome = publish.verdict(COMMIT, case.tip, filled(tmp_path / str(index), case))
        if outcome.code != case.code:
            misses.append(f"{case.name}: exit {outcome.code}, owed {case.code}")

    assert not misses, "\n".join(misses)


def test_a_refusal_names_every_run_and_what_failed_in_it(tmp_path: Path):
    """What the operator reads to choose between a re-run and a fix."""
    case = Case("two failed runs", [run(40, "failure"), run(41, "cancelled")], 1, {40: A_SCOPE_FAILED})
    outcome = publish.verdict(COMMIT, COMMIT, filled(tmp_path / "d", case))

    [finding] = outcome.findings
    assert "run 40 failure (scripts, verify / Fail if any scope job failed or was cancelled)" in finding.detail
    assert "run 41 cancelled" in finding.detail


def test_the_tip_refusal_and_the_missing_run_each_carry_their_remedy(tmp_path: Path):
    """Neither is repaired by re-running `verify`, so each says what does repair it."""
    moved = publish.verdict(COMMIT, OTHER, filled(tmp_path / "moved", Case("", [run(50, "success")], 1)))
    absent = publish.verdict(COMMIT, COMMIT, filled(tmp_path / "absent", Case("", [], 1)))

    assert "gh workflow run publish.yml --ref main" in moved.findings[0].detail
    assert "Dispatch again once its run has appeared and finished" in absent.findings[0].detail


def run_main(*argv: str, actions: bool = False) -> tuple[int, str, str]:
    """`main` over those arguments, under GitHub Actions or not: its exit code and each stream."""
    out, err = io.StringIO(), io.StringIO()
    environment = {**os.environ, "GITHUB_ACTIONS": "true"} if actions else {k: v for k, v in os.environ.items() if k != "GITHUB_ACTIONS"}
    with (
        patch.object(publish.sys, "argv", ["check_publish_verdict.py", *argv]),
        patch.dict(publish.os.environ, environment, clear=True),
        contextlib.redirect_stdout(out),
        contextlib.redirect_stderr(err),
    ):
        try:
            code = publish.main()
        except SystemExit as stopped:
            # argparse's own refusal, which exits rather than returning.
            code = stopped.code if isinstance(stopped.code, int) else 2
    return code, out.getvalue(), err.getvalue()


def test_main_annotates_the_budget_exception_as_a_notice(tmp_path: Path):
    """A publish over a red `verify` is announced in the run's annotations, not only its log."""
    directory = filled(tmp_path / "d", Case("", [run(60, "failure")], 0, {60: BUDGET_ONLY}))

    code, out, _ = run_main("--commit", COMMIT, "--tip", COMMIT, "--payloads", str(directory), actions=True)

    assert code == 0
    assert "::notice title=Publish::" in out
    assert "wall-clock budget alone (run 60)" in out


def test_main_grades_a_refusal_of_the_tree_as_a_finding_and_an_unread_payload_as_a_refusal(tmp_path: Path):
    """1 names something to fix in `verify`'s run, 2 an input nothing judged: the exit contract's two failing arms."""
    failed = filled(tmp_path / "failed", Case("", [run(61, "failure")], 1, {61: A_SCOPE_FAILED}))
    unread = filled(tmp_path / "unread", Case("", [run(62, "failure")], 2))

    failed_code, failed_out, _ = run_main("--commit", COMMIT, "--tip", COMMIT, "--payloads", str(failed), actions=True)
    unread_code, _, unread_err = run_main("--commit", COMMIT, "--tip", COMMIT, "--payloads", str(unread))

    assert failed_code == 1
    assert "::error title=Publish::" in failed_out
    assert "FAIL" in failed_out
    assert unread_code == 2
    assert "run 62" in unread_err


def test_main_refuses_a_commit_that_is_no_full_sha(tmp_path: Path):
    """A short or empty commit would match no run and read as "no run", a finding about a tree nobody named."""
    directory = filled(tmp_path / "d", Case("", [run(63, "success")], 0))

    for commit in (COMMIT[:7], "", COMMIT.upper()):
        code, _, err = run_main("--commit", commit, "--tip", COMMIT, "--payloads", str(directory))

        assert code == 2, (commit, err)
        assert "--commit takes a full 40-character commit" in err


# --- the names, the condition and the call site, held to the two workflows ----------------------------

STEP_START_RE: Final = re.compile(r"^      - ")
STEP_NAME_RE: Final = re.compile(r"^      (?:- |  )name: (.+)$")
STEP_IF_RE: Final = re.compile(r"^      (?:- |  )if: (.+)$")
BUDGET_CALL: Final = "scripts/checks/check_gate_budget.py --jobs"


def budget_step_of(workflow: str) -> list[tuple[str, str | None, str | None]]:
    """Every step calling the budget check, found by the call: its job's name as the API reports it, the step's `name:` and its `if:`."""
    found: list[tuple[str, str | None, str | None]] = []
    for key, body in job_bodies(workflow).items():
        if BUDGET_CALL not in body:
            continue
        assert MATRIX_RE.search(body) is None, f"`{key}` runs the budget in a matrix, whose instance names no reader here expands"
        template = JOB_NAME_RE.search(body)
        job_name = template[1].strip() if template is not None else key
        name: str | None = None
        condition: str | None = None
        for line in body.splitlines():
            if STEP_START_RE.match(line):
                name = condition = None
            if (named := STEP_NAME_RE.match(line)) is not None:
                name = named[1].strip()
            if (guarded := STEP_IF_RE.match(line)) is not None:
                condition = guarded[1].strip()
            if BUDGET_CALL in line:
                found.append((job_name, name, condition))
    return found


def test_the_reader_finds_a_renamed_budget_step_under_its_jobs_api_name():
    """`budget_step_of` over a renamed step in a named job: a reader answering the constants back would pass the tree whatever it holds."""
    workflow = (
        "on: push\njobs:\n  verify:\n    name: verify (required)\n    runs-on: x\n    steps:\n      - name: Report\n        run: echo\n"
        "      - name: Hold every job to its budget\n        if: always()\n        run: |\n"
        "          python scripts/checks/check_gate_budget.py --jobs x\n"
    )

    assert budget_step_of(workflow) == [("verify (required)", "Hold every job to its budget", "always()")]


def test_the_budget_names_and_condition_are_the_ones_verify_runs_under():
    """A rename in `verify.yml` would refuse every budget-only run while no case here moved.

    Under the default `success()` a failed scope would hide an overrun until a re-run.
    """
    found = budget_step_of((WORKFLOWS / "verify.yml").read_text(encoding="utf-8"))

    assert found == [(publish.AGGREGATE_JOB, publish.BUDGET_STEP, "${{ !cancelled() }}")], (
        f"verify.yml's budget step is {found}; check_publish_verdict.py matches {publish.AGGREGATE_JOB!r} / {publish.BUDGET_STEP!r}"
    )


# The request main's tip is read from: a branch ref, which neither the commit being judged nor a tag
# named `main` can stand in for.
TIP_READ: Final = 'tip="$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/main" --jq .object.sha)"'


def test_the_publish_workflow_runs_the_verdict_over_the_files_it_names():
    """A verdict the workflow never calls refuses nothing, and one reading files the workflow never writes refuses everything."""
    workflow = (WORKFLOWS / "publish.yml").read_text(encoding="utf-8")

    assert re.search(r'scripts/checks/check_publish_verdict\.py --commit "\$GITHUB_SHA" --tip "\$tip" --payloads ', workflow), (
        "publish.yml does not run the verdict on the commit it builds"
    )
    assignments = [line.strip() for line in workflow.splitlines() if line.strip().startswith("tip=")]
    assert assignments == [f'{TIP_READ} || tip=""'], f"publish.yml assigns the tip as {assignments}, not from {TIP_READ}"
    assert f"/{publish.RUNS_FILE}" in workflow, f"publish.yml writes no {publish.RUNS_FILE}"
    assert "/" + publish.JOBS_FILE.format("${id}", "${attempt}") in workflow, (
        f"publish.yml writes no {publish.JOBS_FILE.format('<id>', '<attempt>')}"
    )
    assert "/actions/runs/${id}/attempts/${attempt}/jobs" in workflow, "publish.yml does not ask for the listed attempt's jobs"
