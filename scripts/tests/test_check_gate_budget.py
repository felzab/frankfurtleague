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


def restamped(measured: str, *, job: str = "backend", seconds: str = "37", floor: str = "14") -> dict[str, Any]:
    """BASE with one row re-stamped, its figures otherwise unmoved."""
    return budget.parse_reference(
        table(row(job, seconds, floor, "60", measured), row("total", seconds if seconds != "-" else "0", "5", "-", "-"))
    )


def test_a_new_stamp_under_ten_runs_is_a_finding_even_on_a_raise():
    """One run's stamp lifted a budget unrefused before; ten keeps the slow runner class in the population."""
    findings = budget.check_raise(
        BASE, budget.parse_reference(table(row("backend", "-", "-", "115", "1@2026-09-02"), row("total", "0", "5", "-", "-"))), TODAY
    )

    assert details(findings) == ["`backend`'s new stamp 1@2026-09-02 counts 1, and a stamp counts at least 10 runs"]


def test_a_stamp_of_ten_runs_carries_a_budget_and_no_reference():
    """Ten is the budget's minimum and not the reference's: two windows of twelve need twenty-four."""
    assert budget.check_raise(BASE, restamped("10@2026-09-02", seconds="-", floor="-"), TODAY) == []

    findings = budget.check_raise(BASE, restamped("23@2026-09-02"), TODAY)

    assert details(findings) == ["`backend`'s new stamp 23@2026-09-02 counts 23, and a reference and its floor are cut from at least 24 runs"]


def test_a_pull_request_stamp_on_a_job_whose_cache_is_keyed_on_the_tree_is_a_finding():
    """A re-run of one commit restores the exact cache its first attempt wrote, which no push to main does."""
    base = budget.parse_reference(table(row("format", "-", "-", "70", STAMP), row("total", "0", "5", "-", "-")))
    head = budget.parse_reference(table(row("format", "-", "-", "70", "30@2026-09-02/123"), row("total", "0", "5", "-", "-")))

    findings = budget.check_raise(base, head, TODAY)

    assert len(findings) == 1
    assert "names a pull-request run" in findings[0].detail and "`format`" in findings[0].detail
    assert budget.check_raise(BASE, restamped("30@2026-09-02/123"), TODAY) == []


def test_a_wider_floor_on_the_old_stamp_is_a_finding_and_a_narrower_one_is_free():
    """A wider floor silences the report on a move the narrower one names, which is a figure rising like any other."""
    findings = budget.check_raise(BASE, restamped(STAMP, floor="20"), TODAY)

    assert details(findings) == [f"`backend` rose (floor 14 -> 20%) on the unchanged stamp {STAMP}: a raise carries the runs that measured it"]
    assert budget.check_raise(BASE, restamped(STAMP, floor="9"), TODAY) == []


def test_a_stamp_the_base_already_carries_is_not_judged_again():
    """A row stamped before the minimum held keeps standing while nothing moves it, as `ops`' thirteen-run stamp does."""
    short = budget.parse_reference(table(row("ops", "17", "29", "45", "13@2026-09-01"), row("total", "17", "-", "-", "-")))

    assert budget.check_raise(short, short, TODAY) == []


def test_a_stamp_naming_a_run_parses_and_one_naming_nothing_is_refused():
    """`/<run id>` is the pull-request form; anything else after the date is a typo."""
    rows = budget.parse_reference(table(row("backend", "-", "-", "60", "30@2026-09-01/37552113173"), row("total", "0", "5", "-", "-")))

    assert (rows["backend"].stamp_runs, rows["backend"].stamp_pull_request) == (30, 37552113173)
    assert (budget.parse_reference(BASELINE)["backend"].stamp_runs, budget.parse_reference(BASELINE)["backend"].stamp_pull_request) == (
        24,
        None,
    )
    for bad in ("30@2026-09-01/", "30@2026-09-01/0", "30@2026-09-01/run"):
        with contextlib.suppress(budget.Malformed):
            budget.parse_reference(table(row("backend", "-", "-", "60", bad), row("total", "0", "5", "-", "-")))
            raise AssertionError(f"the stamp {bad} parsed")


def test_main_refuses_where_no_base_resolves(tmp_path: Path):
    """A single-branch clone has no base, and a file compared against nothing was not compared."""
    reference = written(tmp_path / "ref.tsv", BASELINE)

    with patch.object(budget, "resolve_base", return_value=None):
        code, _, err = run_main("--base", "--reference", str(reference))

    assert code == 2
    assert "not held against a base" in err


# --- the stamp -------------------------------------------------------------------------------------

DAY = date(2026, 9, 1)


def attempt(run: int, number: int, spans: dict[str, int], *, event: str = "push", day: date = DAY, retried: tuple[str, ...] = ()) -> Any:
    return budget.Attempt(run, number, event, day, tuple(ok(name, seconds) for name, seconds in spans.items()), frozenset(retried))


def test_a_budget_is_the_widest_span_and_the_greater_margin_rounded_up_to_five():
    """Every pair here is a budget the header's rule set: the stamped rows, the shard rows, and BUDGET-MEASURE's PR runs.

    56 + 14 lands on 70 itself, which a rounding to the next five above would have lifted to 75.
    """
    pairs = {56: 70, 45: 60, 108: 135, 30: 40, 115: 145, 151: 190, 89: 115, 159: 200, 84: 105, 71: 90, 1: 15}

    assert {widest: budget.budget_over(widest) for widest in pairs} == pairs


def test_a_floor_is_the_nearest_rank_p95_of_the_moves_rounded_up_to_a_whole_percent():
    """A move's size is what counts, so a downward move weighs what an upward one does."""
    moves = [(-1) ** n * n for n in range(100)]

    assert budget.floor_of(moves, 100) == 94
    assert budget.floor_of([1] * 100, 3) == 34


def test_the_draws_are_seeded_per_row():
    """The same spans give the same moves on every call, and a row's draws are its own rather than its neighbour's."""
    spans = list(range(40, 70))

    first = budget.window_moves(spans, "backend")

    assert len(first) == budget.RESAMPLES
    assert first == budget.window_moves(spans, "backend")
    assert first != budget.window_moves(spans, "db")


def test_a_population_named_in_another_order_gives_the_same_proposal():
    """The attempts' order is how they were typed, not a property of the runs; a re-cut by someone else names them in theirs.

    The draws are compared too: a floor rounded to a whole percent can survive a reorder by chance.
    """
    rows = budget.parse_reference(
        table(row("backend", "-", "-", "60", STAMP), row("db", "-", "-", "135", STAMP), row("total", "0", "-", "-", "-"))
    )
    attempts = [attempt(n, 1, {"backend": 40 + (n * 7) % 23, "db": 100 + (n * 11) % 31}) for n in range(1, 31)]
    shuffled = [*attempts[1::2], *attempts[0::2]][::-1]
    assert sorted(id(a) for a in shuffled) == sorted(id(a) for a in attempts)

    assert budget.stamp(rows, shuffled, None, None) == budget.stamp(rows, attempts, None, None)
    spans = [40 + (n * 7) % 23 for n in range(1, 31)]
    assert budget.window_moves(spans[::-1], "backend") == budget.window_moves(spans, "backend")


def test_a_row_under_ten_runs_is_not_stamped():
    attempts = [attempt(1, n, {"backend": 50}) for n in range(1, 10)]

    proposed, lines, missed = budget.stamp(budget.parse_reference(BASELINE), attempts, None, ["backend"])

    assert proposed["backend"] == budget.parse_reference(BASELINE)["backend"]
    assert missed == ["backend"]
    assert lines[0] == "backend: not stamped -- 9 counted, and a stamp counts at least 10"


def test_ten_runs_cut_a_budget_and_twenty_four_a_reference_and_floor():
    """Under twenty-four the reference and floor are `-`: the report cannot judge a median with no floor beside it."""
    rows = budget.parse_reference(BASELINE)
    ten = [attempt(n, 1, {"backend": 40 + n}) for n in range(1, 11)]
    many = [attempt(n, 1, {"backend": 40 + n % 5}) for n in range(1, 25)]

    assert budget.stamp(rows, ten, None, ["backend"])[0]["backend"] == budget.Row("backend", None, None, 65, "10@2026-09-01")
    reference = budget.stamp(rows, many, None, ["backend"])[0]["backend"]
    assert (reference.seconds, reference.budget, reference.measured) == (42, 55, "24@2026-09-01")
    assert reference.floor is not None


def test_a_failed_job_and_one_github_retried_are_left_out_of_its_row_alone():
    """F11's retry put 18 s of GitHub's own wait into one scripts span; the run's other jobs still count."""
    attempts = [attempt(n, 1, {"backend": 50, "scripts": 50}) for n in range(1, 11)]
    attempts.append(attempt(11, 1, {"backend": 60, "scripts": 84}, retried=("scripts",)))
    attempts.append(budget.Attempt(12, 1, "push", DAY, (ok("backend", 61), budget.Span("scripts", "dropped", 0)), frozenset()))
    rows = budget.parse_reference(
        table(row("scripts", "-", "-", "60", STAMP), row("backend", "-", "-", "60", STAMP), row("total", "0", "-", "-", "-"))
    )

    proposed, lines, _ = budget.stamp(rows, attempts, None, None)

    assert proposed["scripts"].budget == 65 and proposed["scripts"].measured == "10@2026-09-01"
    assert proposed["backend"].budget == 80 and proposed["backend"].measured == "12@2026-09-01"
    assert any(line.startswith("scripts: 10 counted, 1 did not succeed, 1 slowed by GitHub's own retry;") for line in lines), lines


def test_a_job_whose_cache_is_keyed_on_the_tree_counts_first_attempts_of_pushes_alone():
    """A re-run restores the exact key its first attempt wrote, which a fresh push to main never does."""
    rows = budget.parse_reference(
        table(row("frontend", "-", "-", "145", STAMP), row("backend", "-", "-", "60", STAMP), row("total", "0", "-", "-", "-"))
    )
    reruns = [attempt(1, n, {"frontend": 100, "backend": 50}) for n in range(1, 11)]
    pushes = [attempt(n, 1, {"frontend": 100, "backend": 50}) for n in range(1, 11)]

    proposed, lines, _ = budget.stamp(rows, reruns, None, None)
    assert proposed["frontend"] == rows["frontend"] and proposed["backend"].measured == "10@2026-09-01"
    assert "frontend: not stamped -- 1 counted, 9 a re-run of a tree it cached, and a stamp counts at least 10" in lines
    assert budget.stamp(rows, pushes, None, None)[0]["frontend"].measured == "10@2026-09-01"

    proposed, lines, _ = budget.stamp(
        rows, [attempt(7, n, {"frontend": 100, "backend": 50}, event="pull_request") for n in range(1, 11)], 7, None
    )
    assert proposed["frontend"] == rows["frontend"] and proposed["backend"].measured == "10@2026-09-01/7"
    assert lines[1].startswith("frontend: not stamped -- its cache is keyed on the tree")


def test_an_unbudgeted_row_stays_unbudgeted_and_the_cold_budget_never_falls():
    """`images`' budget is `-` by the header's decision, and `format`'s is the cold job's, which warm runs cannot lower."""
    rows = budget.parse_reference(
        table(row("format", "-", "-", "70", STAMP), row("images", "-", "-", "-", STAMP), row("total", "0", "-", "-", "-"))
    )
    attempts = [attempt(n, 1, {"format": 30, "images": 90}) for n in range(1, 11)]

    proposed, _, _ = budget.stamp(rows, attempts, None, None)

    assert (proposed["format"].budget, proposed["images"].budget) == (70, None)
    assert budget.stamp(rows, [attempt(n, 1, {"format": 80}) for n in range(1, 11)], None, ["format"])[0]["format"].budget == 100


def test_a_matrix_job_s_instances_take_the_widest_one_s_budget():
    """Which shard is heaviest moves as files are added, so a shard cut alone breaks the day another file lands in it."""
    rows = budget.parse_reference(
        table(*(row(f"frontend-units ({n})", "-", "-", "190", STAMP) for n in (1, 2, 3)), row("total", "0", "-", "-", "-"))
    )
    attempts = [attempt(n, 1, {"frontend-units (1)": 100, "frontend-units (2)": 150}) for n in range(1, 11)]

    proposed, lines, _ = budget.stamp(rows, attempts, None, None)

    assert [proposed[f"frontend-units ({n})"].budget for n in (1, 2, 3)] == [190, 190, 190]
    assert proposed["frontend-units (1)"].measured == "10@2026-09-01" and proposed["frontend-units (3)"] == rows["frontend-units (3)"]
    assert (
        "frontend-units: one budget of 190 s for frontend-units (1), frontend-units (2); "
        "not stamped here, so keeping their own: frontend-units (3)"
    ) in lines


def test_the_stamp_is_dated_by_the_newest_attempt_its_row_counts():
    """A row whose newest attempt was left out is dated by the newest it kept, so its stamp names runs it counted."""
    attempts = [attempt(n, 1, {"backend": 50}) for n in range(1, 11)]
    attempts.append(attempt(11, 1, {"backend": 50}, day=date(2026, 9, 2), retried=("backend",)))

    assert budget.stamp(budget.parse_reference(BASELINE), attempts, None, ["backend"])[0]["backend"].measured == "10@2026-09-01"


def test_the_total_takes_a_floor_only_where_every_reference_beside_it_was_cut_here():
    """The report sums the referenced rows' window medians, and a reference from another population has no draws to sum."""
    attempts = [attempt(n, 1, {"backend": 40 + n % 7, "db": 100 + n % 11}) for n in range(1, 25)]
    rows = budget.parse_reference(
        table(row("backend", "-", "-", "60", STAMP), row("db", "-", "-", "135", STAMP), row("total", "0", "-", "-", "-"))
    )

    proposed, lines, _ = budget.stamp(rows, attempts, None, None)
    total = proposed["total"]
    assert total.seconds == proposed["backend"].seconds + proposed["db"].seconds
    assert total.floor is not None and lines[-1].startswith(f"total: {total.seconds} s, floor {total.floor}% over backend, db")

    proposed, lines, _ = budget.stamp(rows, attempts, None, ["db"])
    assert proposed["total"].floor is not None

    proposed, lines, _ = budget.stamp(budget.parse_reference(BASELINE), attempts, None, ["backend"])
    assert proposed["total"].floor is None
    assert lines[-1] == f"total: {proposed['total'].seconds} s, floor - -- a reference cut from another population: images"


def test_one_pull_request_run_stamps_and_two_or_a_mix_are_refused():
    """One run's attempts merge one head onto one base; two runs, or a push beside a pull request, time two trees."""
    one = [attempt(5, n, {}, event="pull_request") for n in (1, 2)]

    assert budget.merged_run(one) == 5
    assert budget.merged_run([attempt(5, 1, {}), attempt(6, 1, {})]) is None
    for mixed in ([*one, attempt(6, 1, {}, event="pull_request")], [*one, attempt(6, 1, {})]):
        with contextlib.suppress(budget.Unstampable):
            budget.merged_run(mixed)
            raise AssertionError(f"{[(a.run, a.event) for a in mixed]} made one population")


LOG_LINE = "{job}\t{step}\t{mark}2026-09-01T10:00:0{n}.1234567Z {text}\n"


def saved(directory: Path, run: int, number: int, spans: dict[str, int], **overrides: Any) -> None:
    """One attempt as the coordinator saves it: the run object, the attempt's jobs and its `gh run view --log`."""
    directory.mkdir(exist_ok=True)
    meta = {"id": run, "run_attempt": number, "status": "completed", "event": "pull_request", "head_branch": "feature"}
    meta |= {"run_started_at": "2026-09-01T10:00:00Z", **overrides.get("meta", {})}
    jobs = [{**job(name, seconds), "run_id": run, "run_attempt": number} for name, seconds in spans.items()]
    jobs += overrides.get("jobs", [])
    written(directory / budget.RUN_FILE.format(run, number), json.dumps(meta))
    written(
        directory / budget.ATTEMPT_JOBS_FILE.format(run, number), json.dumps({"total_count": overrides.get("total", len(jobs)), "jobs": jobs})
    )
    logged = [name for name in spans if name != overrides.get("unlogged")]
    # Each job's log opens on a byte-order mark, which `gh run view --log` keeps after the two names it prefixes.
    log = "".join(LOG_LINE.format(job=name, step="Set up job", mark="\ufeff", n=1, text="Current runner version: '2.337.0'") for name in logged)
    log += "".join(
        LOG_LINE.format(job=name, step="Run ./.github/actions/backend-toolchain", mark="", n=2, text=text)
        for name, text in overrides.get("log", [])
    )
    written(directory / budget.LOG_FILE.format(run, number), log)


def test_an_attempt_reads_its_spans_and_both_forms_of_the_runner_retry(tmp_path: Path):
    """The runner's resolve retry, its download retry written as a warning, and a test's own line naming a retry, which is no runner's."""
    saved(
        tmp_path,
        7,
        2,
        {"backend": 50, "db": 90, "scripts": 40, "ops": 20},
        log=[
            ("backend", "Retrying in 18.261 seconds"),
            ("db", "##[warning]Back off 12.5 seconds before retry."),
            ("scripts", "pytest: Retrying in 3 seconds of the fixture"),
        ],
    )

    read = budget.read_attempt(tmp_path, 7, 2)

    assert (read.run, read.number, read.event, read.day) == (7, 2, "pull_request", DAY)
    assert read.retried == {"backend", "db"}
    assert [(span.job, span.seconds) for span in read.spans] == [("backend", 50), ("db", 90), ("scripts", 40), ("ops", 20)]


def test_an_attempt_that_cannot_stand_in_a_population_is_refused(tmp_path: Path):
    """Each is a span that would be counted wrongly or a retry that would be missed, so the whole stamp stops."""
    cases: dict[str, tuple[dict[str, Any], str]] = {
        "unfinished": ({"meta": {"status": "in_progress"}}, "only a completed attempt"),
        "branch": ({"meta": {"event": "push", "head_branch": "feature"}}, "a push stamps only from main"),
        "event": ({"meta": {"event": "workflow_dispatch"}}, "neither a push to main nor a pull request"),
        "paged": ({"total": 20}, "one page of a longer listing"),
        "carried": ({"jobs": [{**job("db", 90), "run_id": 7, "run_attempt": 1}]}, "re-run all jobs, never the failed ones alone"),
        "unlogged": ({"unlogged": "backend"}, "carries no line of backend"),
        "other run": ({"meta": {"id": 8}}, "is not the run object of attempt 7/2"),
    }
    for name, (overrides, expected) in cases.items():
        directory = tmp_path / name.replace(" ", "-")
        saved(directory, 7, 2, {"backend": 50}, **overrides)
        try:
            budget.read_attempt(directory, 7, 2)
        except budget.Unstampable as exc:
            assert expected in str(exc), (name, str(exc))
        else:
            raise AssertionError(f"the {name} attempt was read")
    try:
        budget.read_attempt(tmp_path / "absent", 7, 2)
    except budget.Unstampable as exc:
        assert "could not be read" in str(exc)
    else:
        raise AssertionError("an attempt with no files was read")


def test_main_writes_a_proposal_every_mode_reads_and_keeps_the_header(tmp_path: Path):
    """The exit contract end to end: the proposal parses, names the run it was cut from, and the header above it is untouched."""
    reference = written(tmp_path / "ref.tsv", "# the header\n" + BASELINE)
    data = tmp_path / "attempts"
    for number in range(1, 25):
        saved(data, 9, number, {"backend": 40 + number % 6, "images": 90})
    out = tmp_path / "proposal.tsv"

    code, stdout, _ = run_main(
        "--stamp", str(data), "--attempts", *(f"9/{n}" for n in range(1, 25)), "--out", str(out), "--reference", str(reference)
    )

    assert code == 0, stdout
    text = out.read_bytes().decode("utf-8")
    assert text.startswith("# the header\n# job\tseconds\tfloor\tbudget\tmeasured\n") and "\r" not in text
    rows = budget.parse_reference(text)
    assert rows["backend"].measured == "24@2026-09-01/9"
    assert rows["images"] == budget.parse_reference(BASELINE)["images"]
    assert "24 attempts of pull-request run 9, the merge commit it tests" in stdout


def test_main_writes_nothing_where_a_row_asked_for_cannot_be_stamped(tmp_path: Path):
    reference = written(tmp_path / "ref.tsv", BASELINE)
    data = tmp_path / "attempts"
    for number in range(1, 11):
        saved(data, 9, number, {"backend": 40, "images": 90})
    out = tmp_path / "proposal.tsv"

    code, _, err = run_main(
        "--stamp",
        str(data),
        "--attempts",
        *(f"9/{n}" for n in range(1, 11)),
        "--rows",
        "images",
        "--out",
        str(out),
        "--reference",
        str(reference),
    )

    assert code == 2
    assert "asked for and not stamped: images" in err
    assert not out.exists()


def test_main_refuses_an_attempt_named_twice_and_an_unreadable_one(tmp_path: Path):
    reference = written(tmp_path / "ref.tsv", BASELINE)
    data = tmp_path / "attempts"
    saved(data, 9, 1, {"backend": 40})

    for attempts, expected in ((("9/1", "9/1"), "named twice"), (("9/1", "9/2"), "attempt 9/2 could not be read")):
        code, _, err = run_main(
            "--stamp", str(data), "--attempts", *attempts, "--out", str(tmp_path / "out.tsv"), "--reference", str(reference)
        )
        assert code == 2 and expected in err, err


def test_main_reports_a_proposal_its_own_base_check_would_refuse(tmp_path: Path):
    """The proposal is held against the table it was cut from, so a stamp older than the one it replaces says so before any push."""
    reference = written(tmp_path / "ref.tsv", table(row("backend", "-", "-", "45", "30@2026-09-05"), row("total", "0", "-", "-", "-")))
    data = tmp_path / "attempts"
    for number in range(1, 11):
        saved(data, 9, number, {"backend": 50})

    code, stdout, _ = run_main(
        "--stamp", str(data), "--attempts", *(f"9/{n}" for n in range(1, 11)), "--out", str(tmp_path / "out.tsv"), "--reference", str(reference)
    )

    assert code == 1
    assert "older than the 30@2026-09-05 it replaces" in stdout


def test_the_stamp_flags_are_refused_apart_from_their_mode(tmp_path: Path):
    """Without `--attempts` or `--out` a stamp has nothing to count or nowhere to go; beside another mode either would read as honoured."""
    for flags in (
        ("--stamp", str(tmp_path)),
        ("--stamp", str(tmp_path), "--attempts", "1/1"),
        ("--base", "--attempts", "1/1"),
        ("--base", "--out", "x"),
        ("--stamp", str(tmp_path), "--attempts", "1-1", "--out", "x"),
    ):
        try:
            run_main(*flags)
        except SystemExit as exc:
            assert exc.code == 2, flags
        else:
            raise AssertionError(f"{flags} ran")


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


def test_the_floor_is_cut_for_the_window_the_report_takes():
    """A floor measured over windows of one size judges medians over another size at the wrong width."""
    workflow = (REPO_ROOT / ".github" / "workflows" / "verify.yml").read_text(encoding="utf-8")

    assert re.findall(r"^\s+window=([0-9]+)$", workflow, re.MULTILINE) == [str(budget.WINDOW)]


# A cache step of the job's own, or the image builds' layer cache in the Actions cache service. The
# toolchain actions' caches are keyed on the lockfiles, which a push to main restores as a re-run does.
OWN_CACHE_RE = re.compile(r"^      - uses: actions/cache@|^          VERIFY_IMAGES_CACHE: gha$", re.MULTILINE)


def test_every_job_with_a_cache_of_its_own_is_stamped_from_main_alone():
    """Read off the workflow rather than off the constant, so a cache added to a job joins the set or fails here."""
    workflow = (REPO_ROOT / ".github" / "workflows" / "verify.yml").read_text(encoding="utf-8")

    cached = {key for key, body in job_bodies(workflow).items() if OWN_CACHE_RE.search(body)}

    assert cached == budget.TREE_KEYED
