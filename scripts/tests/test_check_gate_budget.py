"""SCRIPTS · the gate budget, driven red and green in each of its modes.

`--jobs` is driven over payloads shaped as the Actions jobs API returns them, `--base` over two
parsed tables with the clock injected, `--window` over directories laid out as the workflow leaves
them, and `main` over each so the exit contract is the thing proven rather than the rules alone.
The committed reference is driven too, against a payload cut from its own budgets: a table the
check cannot read, or cannot fail on, would otherwise ship green.
"""

from __future__ import annotations

import contextlib
import io
import itertools
import json
import re
from datetime import date
from pathlib import Path
from typing import Any
from unittest.mock import patch

from conftest import import_scripts

SCRIPTS = Path(__file__).resolve().parents[1]
REPO_ROOT = SCRIPTS.parent

[budget] = import_scripts("check_gate_budget")

TODAY = date(2026, 9, 2)
STAMP = "24@2026-09-01"
LATER = "24@2026-09-02"

HEADER = "# job\tseconds\tfloor\tbudget\tmeasured"

# What a direct `check_run` call says it read. Nothing on disk, so a finding carrying it can only
# have taken it from the argument rather than from the module's own default.
NAMED = "some/where/gate-wall-clock.tsv"


def table(*rows: str) -> str:
    """A reference file's text out of its rows, header comment included."""
    return "\n".join((HEADER, *rows)) + "\n"


def row(job: str, seconds: str, floor: str, budget: str, measured: str) -> str:
    return "\t".join((job, seconds, floor, budget, measured))


BASELINE = table(
    row("backend", "37", "14", "60", STAMP),
    row("commits", "-", "-", "25", "7@2026-09-01"),
    row("images", "97", "10", "-", STAMP),
    row("total", "134", "5", "-", "-"),
)


def job(name: str, seconds: int | None, conclusion: str = "success") -> dict[str, Any]:
    """One job as the API shapes it: a span of `seconds` between its first step and its last."""
    steps: list[dict[str, Any]] = []
    if seconds is not None:
        steps = [
            {"started_at": "2026-09-02T10:00:00Z", "completed_at": "2026-09-02T10:00:05Z"},
            {"started_at": "2026-09-02T10:00:05Z", "completed_at": f"2026-09-02T10:{seconds // 60:02d}:{seconds % 60:02d}Z"},
        ]
    return {"name": name, "conclusion": conclusion, "steps": steps}


def payload(*jobs: dict[str, Any]) -> dict[str, Any]:
    return {"jobs": list(jobs)}


def written(path: Path, text: str) -> Path:
    """`test_check_tracked_text.py :: written`'s argument, over text whose caller has already ended it."""
    path.write_bytes(text.encode("utf-8"))
    return path


def run_main(*argv: str) -> tuple[int, str, str]:
    """`main` over those arguments: its exit code and each stream it wrote."""
    out, err = io.StringIO(), io.StringIO()
    argv_before = budget.sys.argv
    budget.sys.argv = ["check_gate_budget.py", *argv]
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = budget.main()
    finally:
        budget.sys.argv = argv_before
    return code, out.getvalue(), err.getvalue()


def details(findings) -> list[str]:
    """`scripts/tests/conftest.py :: details`'s reader, apart because a case here asserts against one finding rather than the run."""
    return [finding.detail for finding in findings]


# --- the table -------------------------------------------------------------------------------------


def test_a_well_formed_table_parses_to_its_rows():
    """The ordinary read, with `-` landing as None rather than as a zero the report would divide by."""
    rows = budget.parse_reference(BASELINE)

    assert rows["backend"] == budget.Row("backend", 37, 14, 60, STAMP)
    assert rows["commits"] == budget.Row("commits", None, None, 25, "7@2026-09-01")
    assert rows["images"].budget is None
    assert rows["backend"].stamp_date == date(2026, 9, 1)


def test_a_total_that_is_not_the_sum_is_refused():
    """The header's own rule -- move a job's seconds and move the total -- held mechanically."""
    text = table(row("backend", "37", "14", "60", STAMP), row("total", "40", "5", "-", "-"))

    with contextlib.suppress(budget.Malformed):
        budget.parse_reference(text)
        raise AssertionError("a total short of its rows parsed")


def test_a_budget_under_its_reference_is_refused():
    """A ceiling below the median it is a ceiling over would redden every ordinary run."""
    text = table(row("backend", "37", "14", "30", STAMP), row("total", "37", "5", "-", "-"))

    with contextlib.suppress(budget.Malformed):
        budget.parse_reference(text)
        raise AssertionError("a budget under its reference parsed")


def test_a_budget_with_no_stamp_is_refused():
    """A budget's stamp is the measurement the header asks for, so a budget cannot exist without one."""
    text = table(row("backend", "37", "14", "60", "-"), row("total", "37", "5", "-", "-"))

    with contextlib.suppress(budget.Malformed):
        budget.parse_reference(text)
        raise AssertionError("an unstamped budget parsed")


def test_a_stamp_that_is_not_a_day_is_refused():
    """`<runs>@<date>` with a date the calendar does not hold is a typo, not a measurement."""
    text = table(row("backend", "37", "14", "60", "24@2026-13-40"), row("total", "37", "5", "-", "-"))

    with contextlib.suppress(budget.Malformed):
        budget.parse_reference(text)
        raise AssertionError("a stamp naming no day parsed")


def test_a_row_short_of_a_column_is_refused():
    """The old three-column shape, which the report still reads and this check must not."""
    text = table("backend\t37\t14", row("total", "37", "5", "-", "-"))

    with contextlib.suppress(budget.Malformed):
        budget.parse_reference(text)
        raise AssertionError("a three-column row parsed")


def test_main_refuses_a_table_it_cannot_read(tmp_path: Path):
    """Exit 2, never 0: a reference nothing parsed is a run nothing compared."""
    reference = written(tmp_path / "ref.tsv", table(row("backend", "x", "14", "60", STAMP), row("total", "0", "5", "-", "-")))
    jobs = written(tmp_path / "jobs.json", json.dumps(payload(job("backend", 30))))

    code, _, err = run_main("--jobs", str(jobs), "--reference", str(reference))

    assert code == 2
    assert "backend" in err
    assert str(reference) in err


def test_a_refusal_names_the_file_it_opened_rather_than_the_default(tmp_path: Path):
    """A reference that is not there at all, the arm no other case reaches.

    A refusal naming `REFERENCE` while `--reference` pointed elsewhere sends its reader to a file
    the run never opened, and that file parses.
    """
    missing = tmp_path / "absent.tsv"
    jobs = written(tmp_path / "jobs.json", json.dumps(payload(job("backend", 30))))

    code, _, err = run_main("--jobs", str(jobs), "--reference", str(missing))

    assert code == 2
    assert str(missing) in err
    assert str(budget.REFERENCE) not in err


# --- the run in hand -------------------------------------------------------------------------------


def test_a_job_over_its_budget_is_a_finding_naming_both_figures():
    """The check's reason to exist, and the sentence a red run has to carry."""
    rows = budget.parse_reference(BASELINE)

    findings, _ = budget.check_run(rows, budget.spans_of(payload(job("backend", 61))), NAMED)

    assert details(findings) == ["`backend` took 61 s against a budget of 60 s"]


def test_a_job_at_its_budget_passes_and_prints_its_cost():
    """The ceiling is inclusive, and a green run still shows each job's seconds against its budget."""
    rows = budget.parse_reference(BASELINE)

    findings, lines = budget.check_run(rows, budget.spans_of(payload(job("backend", 60))), NAMED)

    assert findings == []
    assert lines == ["backend: 60 s of 60 s"]


def test_a_job_with_no_row_is_a_finding():
    """The clause's first half, mechanically: a job added to the gate arrives with its row or goes red."""
    rows = budget.parse_reference(BASELINE)

    findings, _ = budget.check_run(rows, budget.spans_of(payload(job("newjob", 5))), NAMED)

    assert len(findings) == 1
    assert "`newjob`" in findings[0].detail and "no row" in findings[0].detail
    assert NAMED in findings[0].detail


def test_an_unbudgeted_row_is_measured_and_not_compared():
    """`images` at any length is a line in the log and never a finding."""
    rows = budget.parse_reference(BASELINE)

    findings, lines = budget.check_run(rows, budget.spans_of(payload(job("images", 900))), NAMED)

    assert findings == []
    assert lines == ["images: 900 s, measured and not budgeted (the header says why)"]


def test_the_aggregate_is_not_measured():
    """The report's own exclusion, so this check and the report describe one population."""
    spans = budget.spans_of(payload(job("verify", 3), job("backend", 30)))

    assert [span.job for span in spans] == ["backend"]


def test_a_skipped_job_and_a_failed_job_are_lines_rather_than_findings():
    """A job its condition skipped started at nothing; a failed job's length is no evidence."""
    rows = budget.parse_reference(BASELINE)
    spans = budget.spans_of(payload(job("backend", None, conclusion="skipped"), job("commits", None, conclusion="failure")))

    findings, lines = budget.check_run(rows, spans, NAMED)

    assert findings == []
    assert lines == [
        "backend: skipped by its own condition, so no length was taken",
        "commits: did not succeed, so its length is no evidence and was not compared",
    ]


def test_a_successful_job_with_no_timestamp_is_a_finding():
    """A job the API could not time was not held to anything, which is not the same as passing."""
    rows = budget.parse_reference(BASELINE)

    findings, _ = budget.check_run(rows, budget.spans_of(payload(job("backend", None))), NAMED)

    assert len(findings) == 1
    assert "could not be measured" in findings[0].detail


def test_main_grades_an_exceedance_as_a_finding(tmp_path: Path):
    """The exit contract's own case: exit 1, the job and both figures on stdout."""
    reference = written(tmp_path / "ref.tsv", BASELINE)
    jobs = written(tmp_path / "jobs.json", json.dumps(payload(job("backend", 61), job("commits", 9))))

    code, out, _ = run_main("--jobs", str(jobs), "--reference", str(reference))

    assert code == 1
    assert "`backend` took 61 s against a budget of 60 s" in out
    assert "commits: 9 s of 25 s" in out


def test_main_passes_a_run_inside_every_budget(tmp_path: Path):
    """The other side, so a finding-shaped answer cannot be what the checker always gives."""
    reference = written(tmp_path / "ref.tsv", BASELINE)
    jobs = written(tmp_path / "jobs.json", json.dumps(payload(job("backend", 59), job("images", 500))))

    code, out, _ = run_main("--jobs", str(jobs), "--reference", str(reference))

    assert code == 0
    assert f"every measured job sits inside its budget ({reference})" in out


def test_main_refuses_a_payload_it_cannot_read(tmp_path: Path):
    """A payload that is not the API's answer proves nothing about any job."""
    reference = written(tmp_path / "ref.tsv", BASELINE)
    jobs = written(tmp_path / "jobs.json", "not json")

    code, _, err = run_main("--jobs", str(jobs), "--reference", str(reference))

    assert code == 2
    assert "payload" in err
    assert str(jobs) in err


def test_main_annotates_under_actions(tmp_path: Path):
    """On a runner the finding is also a workflow command, so the checks list names it."""
    reference = written(tmp_path / "ref.tsv", BASELINE)
    jobs = written(tmp_path / "jobs.json", json.dumps(payload(job("backend", 61))))

    with patch.dict(budget.os.environ, {"GITHUB_ACTIONS": "true"}):
        _, out, _ = run_main("--jobs", str(jobs), "--reference", str(reference))

    assert "::error title=Gate budget::`backend` took 61 s against a budget of 60 s" in out


def test_an_annotation_carries_its_whole_message_as_one_command() -> None:
    """A raw line break ends a workflow command there, and the runner reads what follows as log text."""
    stdout = io.StringIO()
    with patch.dict(budget.os.environ, {"GITHUB_ACTIONS": "true"}), contextlib.redirect_stdout(stdout):
        budget.annotate([budget.Finding("fail", "100% over\r\nthe budget")])
        budget.warn("50% slower\nthan its floor")
    assert stdout.getvalue().splitlines() == [
        "::error title=Gate budget::100%25 over%0D%0Athe budget",
        "::warning title=Gate wall clock::50%25 slower%0Athan its floor",
    ], stdout.getvalue()


# --- the window of main runs -----------------------------------------------------------------------


def ok(name: str, seconds: int) -> Any:
    return budget.Span(name, "ok", seconds)


def fetched(directory: Path, runs: dict[int, dict[str, Any] | None]) -> Path:
    """A directory as the workflow leaves it: the listing, and a jobs payload for each run not None."""
    directory.mkdir()
    written(directory / budget.RUNS_FILE, json.dumps({"total_count": len(runs), "workflow_runs": [{"id": run_id} for run_id in runs]}))
    for run_id, jobs in runs.items():
        if jobs is not None:
            written(directory / budget.JOBS_FILE.format(run_id), json.dumps(jobs))
    return directory


def test_a_whole_window_is_every_job_of_every_listed_run(tmp_path: Path):
    directory = fetched(tmp_path / "w", {1: payload(job("backend", 30)), 2: payload(job("backend", 40), job("verify", 3))})

    assert budget.window_of(directory, 2) == [ok("backend", 30), ok("backend", 40)]


def test_a_listing_short_of_the_window_compares_nothing(tmp_path: Path):
    """Fewer runs than a window holds is a state a young or pruned history is in, and it says so."""
    directory = fetched(tmp_path / "w", {1: payload(job("backend", 30))})

    try:
        budget.window_of(directory, 2)
    except budget.NoComparison as exc:
        assert str(exc).startswith("1 completed main runs are on record and 2 are needed")
    else:
        raise AssertionError("a one-run listing made a two-run window")


def test_a_listing_gh_could_not_fetch_compares_nothing(tmp_path: Path):
    """The workflow leaves no listing where gh failed, and the error body gh prints is no listing either."""
    for listing in (None, '{"message": "Not Found"}'):
        directory = tmp_path / f"w{listing is None}"
        directory.mkdir()
        if listing is not None:
            written(directory / budget.RUNS_FILE, listing)
        try:
            budget.window_of(directory, 1)
        except budget.NoComparison as exc:
            assert "list of completed main runs could not be read" in str(exc)
        else:
            raise AssertionError(f"a window was assembled from the listing {listing!r}")


def test_a_listing_longer_than_the_window_is_cut_to_its_newest_runs(tmp_path: Path):
    """The listing's page size is the window, but a page holding more must not widen it: the run past it is never read."""
    directory = fetched(tmp_path / "w", {1: payload(job("backend", 30)), 2: payload(job("backend", 40)), 3: None})

    assert budget.window_of(directory, 2) == [ok("backend", 30), ok("backend", 40)]


def test_one_unread_run_ends_the_window_and_is_named(tmp_path: Path):
    """Medians over the runs that were read would print as a whole window's."""
    directory = fetched(tmp_path / "w", {7: payload(job("backend", 30)), 8: None, 9: payload(job("backend", 30))})
    written(directory / budget.JOBS_FILE.format(9), "not json")

    try:
        budget.window_of(directory, 3)
    except budget.NoComparison as exc:
        assert "main run(s) 8, 9 could not be read" in str(exc)
    else:
        raise AssertionError("a window with two unread runs was assembled")


def test_every_job_inside_its_floor_is_the_one_clean_sentence():
    rows = budget.parse_reference(BASELINE)

    text, verdict = budget.report_window(rows, [ok("backend", 40), ok("images", 100)], 12, NAMED)

    assert verdict == "clean"
    assert text.startswith("**Gate wall clock:** every job median over the last 12 main runs sits inside its own floor.\n")
    assert f"The reference is `{NAMED}`" in text


def test_a_median_past_its_floor_is_a_row_the_largest_first():
    """The report's reason to exist: each row the median, the reference, the delta and the floor."""
    rows = budget.parse_reference(BASELINE)
    spans = [ok("backend", 50), ok("backend", 52), ok("backend", 54), ok("images", 150)]

    text, verdict = budget.report_window(rows, spans, 12, NAMED)

    assert verdict == "regressed"
    table_rows = [line for line in text.splitlines() if line.startswith("| `")]
    assert table_rows == ["| `images` | 150s | 97s | +53s (+54.6%) | 10% |", "| `backend` | 52s | 37s | +15s (+40.5%) | 14% |"]
    assert "| **the whole gate** | **202s** | **134s** | **+68s (+50.7%)** | **5%** |" in text


def test_an_even_window_takes_the_median_half_up():
    """Two middle values a second apart land on the upper one, where Python's own rounding goes to the even one."""
    rows = budget.parse_reference(table(row("backend", "10", "0", "60", STAMP), row("total", "10", "100", "-", "-")))

    text, _ = budget.report_window(rows, [ok("backend", 10), ok("backend", 11)], 2, NAMED)

    assert "| `backend` | 11s | 10s | +1s (+10.0%) | 0% |" in text


def test_a_referenced_job_with_no_successful_run_makes_the_report_partial():
    """A job compared against nothing, and the whole gate left unsummed rather than read as faster."""
    rows = budget.parse_reference(BASELINE)
    spans = [ok("backend", 37), budget.Span("images", "dropped", 0), budget.Span("commits", "skipped", 0)]

    text, verdict = budget.report_window(rows, spans, 12, NAMED)

    assert verdict == "partial"
    assert "not a clean comparison" in text.splitlines()[0]
    assert "No successful run in this window: images." in text
    assert "1 job run(s) in this window did not succeed" in text
    assert "1 job run(s) never started" in text
    assert "the whole gate" not in text


def test_a_job_with_no_reference_is_named_rather_than_counted():
    """`commits`' `-` and a job new to the gate both land in the trailer, never in a median."""
    rows = budget.parse_reference(BASELINE)
    spans = [ok("backend", 37), ok("images", 97), ok("commits", 9), ok("newjob", 5)]

    text, verdict = budget.report_window(rows, spans, 12, NAMED)

    assert verdict == "clean"
    assert "Measured with no reference to compare against: commits, newjob." in text


def test_a_reference_beside_a_missing_floor_is_named_rather_than_judged():
    """Read as zero, the `-` floor would call a one-second move a regression; the whole gate sums the paired rows alone."""
    rows = budget.parse_reference(
        table(row("backend", "37", "14", "60", STAMP), row("format", "27", "-", "70", STAMP), row("total", "64", "5", "-", "-"))
    )

    text, verdict = budget.report_window(rows, [ok("backend", 37), ok("format", 28)], 12, NAMED)

    assert verdict == "clean"
    assert "| `format` |" not in text
    assert "the whole gate" not in text
    assert "Measured with no reference to compare against: format." in text


def test_a_reference_of_zero_is_named_rather_than_divided_by():
    """A zero in the seconds column is a hand edit left half done: named in the trailer, never a row."""
    rows = budget.parse_reference(
        table(row("backend", "0", "14", "60", STAMP), row("images", "97", "10", "-", STAMP), row("total", "97", "5", "-", "-"))
    )

    text, _ = budget.report_window(rows, [ok("backend", 40), ok("images", 97)], 12, NAMED)

    assert "Measured with no reference to compare against: backend." in text
    assert "| `backend` |" not in text


def test_the_window_flags_are_refused_beside_another_mode(tmp_path: Path):
    """Given with `--jobs` or `--base`, either would read as honoured while the mode it belongs to never ran."""
    jobs = written(tmp_path / "jobs.json", json.dumps(payload(job("backend", 30))))
    for flags in (("--jobs", str(jobs), "--runs", "12"), ("--base", "--summary", str(tmp_path / "summary.md"))):
        try:
            run_main(*flags)
        except SystemExit as exc:
            assert exc.code == 2, flags
        else:
            raise AssertionError(f"{flags} ran")


def test_main_appends_the_report_and_warns_only_off_the_clean_state(tmp_path: Path):
    """Silence on the checks list is the clean report's alone, so a regressed one annotates."""
    reference = written(tmp_path / "ref.tsv", BASELINE)
    summary = written(tmp_path / "summary.md", "written first\n")
    for name, seconds, warned in (("quiet", 37, False), ("loud", 90, True)):
        directory = fetched(tmp_path / name, {1: payload(job("backend", seconds), job("images", 97))})
        with patch.dict(budget.os.environ, {"GITHUB_ACTIONS": "true"}):
            code, out, _ = run_main("--window", str(directory), "--runs", "1", "--summary", str(summary), "--reference", str(reference))
        assert code == 0
        assert ("::warning title=Gate wall clock::A job median has moved past its own floor" in out) is warned
    text = summary.read_text(encoding="utf-8")
    assert text.startswith("written first\n**Gate wall clock:** every job median")
    assert "| `backend` | 90s | 37s |" in text


def test_main_says_in_the_summary_that_nothing_was_compared(tmp_path: Path):
    """A window that could not be assembled, and a reference that could not be read, each leave a block.

    Each exits 0 too: the report is advisory, and never the failure that refuses a publish.
    """
    reference = written(tmp_path / "ref.tsv", BASELINE)
    summary = tmp_path / "summary.md"
    directory = fetched(tmp_path / "w", {1: payload(job("backend", 30))})

    code, _, _ = run_main("--window", str(directory), "--runs", "2", "--summary", str(summary), "--reference", str(reference))
    assert code == 0
    code, _, err = run_main("--window", str(directory), "--runs", "1", "--summary", str(summary), "--reference", str(tmp_path / "absent.tsv"))
    assert code == 0
    assert "absent.tsv" in err

    text = summary.read_text(encoding="utf-8")
    assert text.count("### Gate wall clock — no comparison") == 2
    assert "1 completed main runs are on record and 2 are needed" in text
    assert "absent.tsv was not read" in text


# --- the file against its base ---------------------------------------------------------------------


def raised(budget_to: str, stamp: str) -> dict[str, Any]:
    return budget.parse_reference(table(row("backend", "37", "14", budget_to, stamp), row("total", "37", "5", "-", "-")))


BASE = budget.parse_reference(table(row("backend", "37", "14", "60", STAMP), row("total", "37", "5", "-", "-")))


def test_a_raised_budget_on_the_old_stamp_is_a_finding():
    """The clause's second half, mechanically: the number moved and nothing says what measured it."""
    findings = budget.check_raise(BASE, raised("80", STAMP), TODAY)

    assert len(findings) == 1
    assert "budget 60 -> 80 s" in findings[0].detail and STAMP in findings[0].detail


def test_a_raised_budget_on_a_new_stamp_passes():
    """The cost paid: a later stamp over the same job, and the ceiling may move."""
    assert budget.check_raise(BASE, raised("80", LATER), TODAY) == []


def test_a_stamp_dated_after_today_is_a_finding():
    """A measurement cannot postdate the run reading it, so a future date is a stamp typed rather than taken."""
    findings = budget.check_raise(BASE, raised("80", "24@2026-09-03"), TODAY)

    assert len(findings) == 1
    assert "after today" in findings[0].detail


def test_a_stamp_older_than_the_one_it_replaces_is_a_finding():
    """A raise resting on runs older than the figure it replaces measured nothing new."""
    findings = budget.check_raise(BASE, raised("80", "24@2026-08-01"), TODAY)

    assert len(findings) == 1
    assert "older than" in findings[0].detail


def test_a_lowered_budget_needs_no_stamp():
    """Tightening is free; only what makes the gate slower on paper costs a measurement."""
    assert budget.check_raise(BASE, raised("50", STAMP), TODAY) == []


def test_a_raised_reference_needs_a_stamp_too():
    """The report's own column is held the same way: a higher median is a claim about the runs."""
    head = budget.parse_reference(table(row("backend", "45", "14", "60", STAMP), row("total", "45", "5", "-", "-")))

    findings = budget.check_raise(BASE, head, TODAY)

    assert len(findings) == 1
    assert "reference 37 -> 45 s" in findings[0].detail


def test_a_budget_dropped_to_none_is_a_finding_whatever_the_stamp():
    """`-` is a ceiling raised without limit, which no stamp can justify."""
    findings = budget.check_raise(BASE, raised("-", LATER), TODAY)

    assert len(findings) == 1
    assert "dropped" in findings[0].detail


def test_an_unchanged_table_passes():
    assert budget.check_raise(BASE, BASE, TODAY) == []


def test_a_deleted_row_passes():
    """A job the gate no longer runs owes nothing; a job that still runs is caught by `--jobs` instead."""
    head = budget.parse_reference(table(row("total", "0", "5", "-", "-")))

    assert budget.check_raise(BASE, head, TODAY) == []


def test_a_new_row_passes_where_the_base_had_none():
    """A first commit of the columns, or a new job: the stamp is already held at parse."""
    assert budget.check_raise(None, BASE, TODAY) == []


def test_main_holds_the_working_file_against_the_base(tmp_path: Path):
    """The exit contract in `--base` mode, the base's text supplied in place of `git show`."""
    reference = written(tmp_path / "ref.tsv", table(row("backend", "37", "14", "80", STAMP), row("total", "37", "5", "-", "-")))
    base_text = table(row("backend", "37", "14", "60", STAMP), row("total", "37", "5", "-", "-"))

    with patch.object(budget, "resolve_base", return_value="0123456789abcdef"), patch.object(budget, "base_text", return_value=base_text):
        code, out, _ = run_main("--base", "--reference", str(reference))

    assert code == 1
    assert "budget 60 -> 80 s" in out


def test_main_passes_an_unmoved_file(tmp_path: Path):
    reference = written(tmp_path / "ref.tsv", BASELINE)

    with patch.object(budget, "resolve_base", return_value="0123456789abcdef"), patch.object(budget, "base_text", return_value=BASELINE):
        code, out, _ = run_main("--base", "--reference", str(reference))

    assert code == 0
    assert f"no figure in {reference} rose" in out


def test_main_refuses_where_no_base_resolves(tmp_path: Path):
    """A single-branch clone has no base, and a file compared against nothing was not compared."""
    reference = written(tmp_path / "ref.tsv", BASELINE)

    with patch.object(budget, "resolve_base", return_value=None):
        code, _, err = run_main("--base", "--reference", str(reference))

    assert code == 2
    assert "not held against a base" in err


# --- the committed reference and its call sites ------------------------------------------------------


def committed() -> dict[str, Any]:
    return budget.parse_reference((REPO_ROOT / budget.REFERENCE).read_text(encoding="utf-8"))


def test_the_committed_reference_parses():
    """The file at HEAD is a table this check can read, its total the sum of its rows."""
    rows = committed()

    assert "total" in rows
    assert any(r.budget is not None for r in rows.values())


def test_the_committed_reference_can_go_red_and_green():
    """Every budgeted row, driven one second over and then exactly at its ceiling.

    A reference the check reads but can never fail on is the false green this suite exists to
    keep out, so the file itself is the fixture here rather than a shape of one.
    """
    rows = committed()
    budgeted = {name: r.budget for name, r in rows.items() if r.budget is not None}

    over = budget.spans_of(payload(*(job(name, ceiling + 1) for name, ceiling in budgeted.items())))
    at = budget.spans_of(payload(*(job(name, ceiling) for name, ceiling in budgeted.items())))

    red, _ = budget.check_run(rows, over, NAMED)
    green, lines = budget.check_run(rows, at, NAMED)

    assert sorted(re.match(r"`([^`]+)`", d).group(1) for d in details(red)) == sorted(budgeted)  # type: ignore[union-attr]
    assert green == []
    assert len(lines) == len(budgeted)


def test_the_workflow_runs_every_mode():
    """A check the workflow never calls is a check that never refuses: each call site, read as text."""
    workflow = (REPO_ROOT / ".github" / "workflows" / "verify.yml").read_text(encoding="utf-8")

    assert re.search(r"scripts/checks/check_gate_budget\.py --jobs ", workflow), "the verify job does not hold the run to its budgets"
    assert re.search(r"scripts/checks/check_gate_budget\.py --base ", workflow), "the docs job does not hold the reference against its base"
    assert re.search(r"scripts/checks/check_gate_budget\.py --window ", workflow), "the verify job does not report the main runs' medians"
    for path in (".github/gate-wall-clock.tsv", "scripts/checks/check_gate_budget.py", "scripts/lib/checker_kernel.py"):
        assert path in workflow, f"the verify job's sparse checkout does not read {path}"


JOB_KEY_RE = re.compile(r"^  ([a-z][a-z0-9-]*):$", re.MULTILINE)
# At the indents a job's own keys and its matrix's keys take, so a step's `name:` is never read.
JOB_NAME_RE = re.compile(r"^    name: (.+)$", re.MULTILINE)
MATRIX_RE = re.compile(r"^      matrix:\n((?:        .*\n)+)", re.MULTILINE)
AXIS_RE = re.compile(r"^        ([a-z][a-z0-9_-]*): \[([^\]]*)\]$")
PLACEHOLDER_RE = re.compile(r"\$\{\{ matrix\.([a-z][a-z0-9_-]*) \}\}")
NEEDS_RE = re.compile(r"^    needs: \[([^\]]*)\]$", re.MULTILINE)


def job_bodies(workflow: str) -> dict[str, str]:
    """Each job's key against its block, the one reading of the `jobs:` map both listings below take."""
    jobs_block = workflow.split("\njobs:\n", 1)[1]
    bodies: dict[str, str] = {}
    bounds = [*JOB_KEY_RE.finditer(jobs_block), None]
    for here, after in itertools.pairwise(bounds):
        assert here is not None
        bodies[here[1]] = jobs_block[here.end() : after.start() if after is not None else len(jobs_block)]
    return bodies


def job_names(workflow: str) -> set[str]:
    """One name per job as the runs API reports it, a matrix job's once per instance.

    GitHub documents no default name for a matrix instance, so a matrix job with no `name:`
    template is refused rather than guessed at.
    """
    names: set[str] = set()
    for key, body in job_bodies(workflow).items():
        template = JOB_NAME_RE.search(body)
        matrix = MATRIX_RE.search(body)
        if matrix is None:
            names.add(template[1] if template is not None else key)
            continue
        axes: dict[str, list[str]] = {}
        for line in matrix[1].splitlines():
            axis = AXIS_RE.match(line)
            assert axis is not None, f"`{key}`'s matrix carries `{line.strip()}`, which is no axis this reader can expand"
            axes[axis[1]] = [value.strip() for value in axis[2].split(",")]
        assert template is not None, f"`{key}` is a matrix job with no `name:`, so no row can spell its instances"
        unknown = set(PLACEHOLDER_RE.findall(template[1])) - set(axes)
        assert not unknown, f"`{key}`'s name reads matrix keys {sorted(unknown)} its matrix does not define"
        for values in itertools.product(*axes.values()):
            name = template[1]
            for axis_key, value in zip(axes, values, strict=True):
                name = name.replace("${{ matrix." + axis_key + " }}", value)
            names.add(name)
    return names


def test_every_job_in_the_workflow_has_a_row_or_is_unmeasured():
    """The two listings: the names the workflow's jobs run under against the reference's rows, agreeing in both directions."""
    workflow = (REPO_ROOT / ".github" / "workflows" / "verify.yml").read_text(encoding="utf-8")
    names = job_names(workflow) - budget.UNMEASURED_JOBS
    rows = set(committed()) - {budget.TOTAL}

    assert names == rows, f"jobs with no row: {sorted(names - rows)}; rows with no job: {sorted(rows - names)}"


def aggregate_gaps(workflow: str) -> tuple[set[str], set[str]]:
    """The jobs `verify`'s `needs` leaves out, and the names it lists that are no job."""
    bodies = job_bodies(workflow)
    needs = NEEDS_RE.search(bodies["verify"])
    assert needs is not None, "`verify` carries no one-line `needs: [...]` list, so nothing here compares it"
    listed = {name.strip() for name in needs[1].split(",")}
    jobs = set(bodies) - {"verify"}
    return jobs - listed, listed - jobs


def test_a_job_the_aggregate_does_not_wait_on_is_named():
    """`aggregate_gaps`, over a job left out of the list: a reader that finds no gap anywhere would pass the tree."""
    workflow = "on: push\njobs:\n  commits:\n    runs-on: x\n  lint:\n    runs-on: x\n  verify:\n    needs: [commits]\n    runs-on: x\n"

    assert aggregate_gaps(workflow) == ({"lint"}, set())


def test_the_aggregate_waits_on_every_other_job():
    """A job `verify` does not wait on can fail under a green required check."""
    workflow = (REPO_ROOT / ".github" / "workflows" / "verify.yml").read_text(encoding="utf-8")
    missing, unknown = aggregate_gaps(workflow)

    assert not missing and not unknown, f"jobs `verify` does not wait on: {sorted(missing)}; `needs` names that are no job: {sorted(unknown)}"
