"""SCRIPTS · the orchestration skill's tools, driven over fixture repositories and registers.

Each tool replaces a step a coordinator can get wrong in silence: a merge taking in work nobody
committed, a clock time typed ahead of the clock, a finding banked with no ledger row, a CI red read
as expected. Every
refusal arm is driven as well as the pass, since a tool failing open reads exactly like one with
nothing to refuse.
"""

from __future__ import annotations

import datetime
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Final

import pytest
from conftest import BASH, REPO_ROOT, base_env, configure, git, import_scripts, run_shell, write, write_shell

TOOLS: Final = REPO_ROOT / ".claude" / "skills" / "orchestration" / "tools"

merge_rows, reg, ledger, land, ci = import_scripts(
    "merge_rows", "reg", "ledger", "land", "ci", directories=("../.claude/skills/orchestration/tools",)
)


def _run(
    tool: str, *args: str, cwd: Path | None = None, stdin: bytes | None = None, env: dict[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
    """One tool run as the coordinator runs it, by this interpreter, its streams decoded as utf-8; `env` adds to the child's environment."""
    env = {**os.environ, **env} if env else None
    done = subprocess.run((sys.executable, str(TOOLS / f"{tool}.py"), *args), cwd=cwd, input=stdin, capture_output=True, check=False, env=env)
    return subprocess.CompletedProcess(done.args, done.returncode, done.stdout.decode("utf-8"), done.stderr.decode("utf-8"))


# --- merge_rows -----------------------------------------------------------------------------------

TABLE_HEAD: Final = "| # | Invariant |\n| --- | --- |\n"


def _conflict(ours: str, theirs: str, above: str = "| I1 | one |\n") -> str:
    return f"{TABLE_HEAD}{above}<<<<<<< HEAD\n{ours}=======\n{theirs}>>>>>>> agent\n"


def test_rows_two_sides_added_are_both_kept() -> None:
    """The case the tool exists for: two agents' new rows conflict on adjacent lines and share no row."""
    base = TABLE_HEAD + "| I1 | one |\n"
    commit = base + "| I3 | three |\n"
    merge = merge_rows.merge_text(_conflict("| I2 | two |\n", "| I3 | three |\n"), base, commit)
    assert merge.text is not None, merge.conflicts
    assert "<<<<<<<" not in merge.text and "| I2 | two |" in merge.text and "| I3 | three |" in merge.text
    assert merge.done == ["ADD I3 after I2"]


def test_a_row_the_commit_changed_and_the_session_branch_kept_takes_the_change() -> None:
    base = TABLE_HEAD + "| I1 | one |\n| I2 | two |\n"
    commit = TABLE_HEAD + "| I1 | one |\n| I2 | TWO |\n| I3 | three |\n"
    merge = merge_rows.merge_text(_conflict("| I2 | two |\n| I4 | four |\n", "| I2 | TWO |\n| I3 | three |\n"), base, commit)
    assert merge.text is not None, merge.conflicts
    assert "| I2 | TWO |" in merge.text and "| I2 | two |" not in merge.text
    assert "| I4 | four |" in merge.text and "| I3 | three |" in merge.text


@pytest.mark.parametrize(
    ("ours", "theirs", "commit_rows", "said"),
    [
        ("| I2 | ours |\n", "| I2 | theirs |\n", "| I2 | theirs |\n", "both sides changed the row"),
        ("| I4 | four |\n", "| I2 | theirs |\n", "| I2 | theirs |\n", "the agent's branch changes a row the session branch removed"),
        ("prose, not a row\n", "| I3 | three |\n", "| I2 | two |\n| I3 | three |\n", "not table rows"),
    ],
    ids=["both changed", "changed where removed", "not a table"],
)
def test_a_true_conflict_writes_nothing(ours: str, theirs: str, commit_rows: str, said: str) -> None:
    base = TABLE_HEAD + "| I1 | one |\n| I2 | two |\n"
    merge = merge_rows.merge_text(_conflict(ours, theirs), base, TABLE_HEAD + "| I1 | one |\n" + commit_rows)
    assert merge.text is None
    assert any(said in conflict for conflict in merge.conflicts), merge.conflicts


# The backend spec's endpoint tables, whose first cell is a method: keyed by it, an agent's added
# `POST` row matched the session's and was dropped while the landing reported nothing.
ENDPOINTS: Final = "| Method | Path |\n| --- | --- |\n| GET | `/spiele` |\n| POST | `/bewerbungen` |\n"


@pytest.mark.parametrize(
    ("ours", "theirs"),
    [("| POST | `/teams` |\n", "| POST | `/spieler` |\n"), ("| GET | `/teams` |\n", "| GET | `/spieler` |\n")],
    ids=["both add a POST row", "both add a GET row the table already holds"],
)
def test_a_table_whose_first_cell_repeats_is_keyed_by_the_column_naming_one_row(ours: str, theirs: str) -> None:
    conflicted = f"{ENDPOINTS}<<<<<<< HEAD\n{ours}=======\n{theirs}>>>>>>> agent\n"
    merge = merge_rows.merge_text(conflicted, ENDPOINTS, ENDPOINTS + theirs)
    assert merge.text is not None, merge.conflicts
    assert ours.strip() in merge.text and theirs.strip() in merge.text
    assert merge.done == [f"ADD {theirs.split('|')[2].strip()} after {ours.split('|')[2].strip()}"]


# The backend spec's two refusal tables both open on `Code`; the agent's longer placeholder re-pads
# the second whole, header and separator included, so the conflict spans every row of it.
TWO_CODE_TABLES: Final = (
    "| Code | Refuses |\n| ---- | ------- |\n| `REQ-A` | a |\n\nprose\n\n| Code | Not served |\n| ---- | ---------- |\n| `READ-A` | a |\n"
)


def test_a_re_padded_table_beside_another_with_the_same_first_header_merges() -> None:
    padded = "| Code           | Not served |\n| -------------- | ---------- |\n"
    padded += "| `READ-A`       | a          |\n| `I_NEW_LONG_1` | b          |\n"
    session = "| Code | Not served |\n| ---- | ---------- |\n| `READ-A` | a |\n| `READ-B` | c |\n"
    above = TWO_CODE_TABLES.split("| Code | Not served |")[0]
    conflicted = f"{above}<<<<<<< HEAD\n{session}=======\n{padded}>>>>>>> agent\n"
    merge = merge_rows.merge_text(conflicted, TWO_CODE_TABLES, above + padded)
    assert merge.text is not None, merge.conflicts
    assert merge.done == ["ADD `I_NEW_LONG_1` after `READ-A`"]
    assert merge.text.endswith("| `READ-A` | a |\n| `I_NEW_LONG_1` | b          |\n| `READ-B` | c |\n")


@pytest.mark.parametrize(
    ("base", "ours", "theirs", "said"),
    [
        ("| K | V |\n| - | - |\n| a | 1 |\n| a | 1 |\n", "| b | 2 |\n", "| c | 3 |\n", "no column of the table"),
        ("| K | V |\n| - | - |\n| a | 1 |\n\n| K | V |\n| - | - |\n| z | 9 |\n", "| b | 2 |\n", "| c | 3 |\n", "2 tables in"),
    ],
    ids=["no column names one row", "two tables open with one header"],
)
def test_a_table_no_column_keys_stops_the_merge(base: str, ours: str, theirs: str, said: str) -> None:
    merge = merge_rows.merge_text(f"{base}<<<<<<< HEAD\n{ours}=======\n{theirs}>>>>>>> agent\n", base, base + theirs)
    assert merge.text is None
    assert any(said in conflict for conflict in merge.conflicts), merge.conflicts


# The admin-write table's continuation rows, whose empty first cell names nothing to place them by.
CONTINUED: Final = "| Method | Path |\n| --- | --- |\n| POST | `/spiele` |\n|        | `/spiele/paarungen` |\n"


@pytest.mark.parametrize(
    ("ours", "theirs", "base_extra", "said"),
    [
        ("|        | `/spiele/a` |\n", "|        | `/spiele/b` |\n", "", "is on the agent's branch alone"),
        (
            "|        | `/spiele/old` |\n| PUT | `/teams` |\n",
            "| PUT | `/teams` |\n",
            "|        | `/spiele/old` |\n",
            "is gone from the agent's branch",
        ),
    ],
    ids=["both add a continuation row", "the agent deletes one"],
)
def test_a_continuation_row_held_by_one_side_stops_the_merge(ours: str, theirs: str, base_extra: str, said: str) -> None:
    base = CONTINUED + base_extra
    conflicted = f"{CONTINUED}<<<<<<< HEAD\n{ours}=======\n{theirs}>>>>>>> agent\n"
    merge = merge_rows.merge_text(conflicted, base, CONTINUED + theirs)
    assert merge.text is None
    assert any(said in conflict for conflict in merge.conflicts), merge.conflicts


def test_a_continuation_row_both_sides_hold_does_not_stop_the_merge() -> None:
    ours, theirs = "|        | `/spiele/paarungen/x` |\n| PUT | `/teams` |\n", "|        | `/spiele/paarungen/x` |\n| DELETE | `/teams` |\n"
    base = CONTINUED + "|        | `/spiele/paarungen/x` |\n"
    merge = merge_rows.merge_text(f"{CONTINUED}<<<<<<< HEAD\n{ours}=======\n{theirs}>>>>>>> agent\n", base, CONTINUED + theirs)
    assert merge.text is not None, merge.conflicts
    assert "| PUT | `/teams` |" in merge.text and "| DELETE | `/teams` |" in merge.text


# --- reg ------------------------------------------------------------------------------------------

REGISTER: Final = (
    "# Agent register\n\n## Resume point\n\nNext action: land.\n\n{marker}\n\n## Findings ledger\n\n"
    "| # | Source report | Finding (file :: anchor) | Status | Owner, or the evidence that closed it |\n"
    "|---|---|---|---|---|\n\n## Findings banked\n"
)


def _register(tmp_path: Path, markers: int = 1) -> Path:
    path = tmp_path / "REGISTER-s.md"
    path.write_bytes(REGISTER.format(marker="\n".join([reg.MARKER] * markers)).encode("utf-8"))
    return path


def test_an_update_lands_above_the_marker_stamped_from_the_clock(tmp_path: Path) -> None:
    register = _register(tmp_path)
    now = datetime.datetime(2026, 10, 4, 16, 7, tzinfo=datetime.UTC)
    line = reg.append(register, "LANDED  X\nas  y", now)
    assert line == "UPDATE 2026-10-04 16:07: LANDED X as y"
    text = register.read_bytes().decode("utf-8")
    assert f"Next action: land.\n\n{line}\n{reg.MARKER}\n" in text
    assert b"\r" not in register.read_bytes()


@pytest.mark.parametrize(("markers", "text"), [(0, "x"), (2, "x"), (1, "  \n ")], ids=["no marker", "two markers", "no text"])
def test_an_append_with_nowhere_or_nothing_to_write_changes_nothing(tmp_path: Path, markers: int, text: str) -> None:
    register = _register(tmp_path, markers)
    before = register.read_bytes()
    with pytest.raises(ValueError):
        reg.append(register, text)
    assert register.read_bytes() == before


def test_the_command_line_takes_its_text_from_stdin_and_stamps_the_minute_it_runs(tmp_path: Path) -> None:
    register = _register(tmp_path)
    earliest = datetime.datetime.now().astimezone().replace(second=0, microsecond=0)
    done = _run("reg", "append", str(register), stdin=b"BANKED L6\n")
    assert done.returncode == 0, done.stderr
    stamped = datetime.datetime.strptime(done.stdout.split("UPDATE ", 1)[1][:16], "%Y-%m-%d %H:%M").astimezone()
    assert earliest <= stamped <= datetime.datetime.now().astimezone(), done.stdout
    assert done.stdout.strip() in register.read_bytes().decode("utf-8")


# --- ledger ---------------------------------------------------------------------------------------

LABELLED: Final = """Three findings, each opening its line a different way.

## (c) Findings

**F1. The switch the label names is not rendered.**
- **Where:** `EinwilligungForm.tsx`.

### F2 | A withdrawal drops focus

| F3 | A stale comment | `globals.css` |

```text
F9 inside a fence is an example, never a finding
```

- F1 again, later in the report, adds no row.
"""

# The two shapes reports numbered findings in before the label: the round-1b L6 report's bold
# numbers, whose eight findings no label caught, and a numbered table row.
BOLD_NUMBERED: Final = (
    "## (c) Findings\n\n**1. The stamped words describe a switch.**\n- **Where:** x\n\n**2. Focus drops.**\n\n"
    "| # | Finding |\n| - | ------- |\n| 3 | A third, in a table |\n"
)


def test_bank_writes_one_open_row_per_label_and_never_twice(tmp_path: Path) -> None:
    register = _register(tmp_path)
    report = tmp_path / "LENS-L6-report.md"
    report.write_bytes(LABELLED.encode("utf-8"))
    added = ledger.bank(register, report)
    assert [row.split(" | ")[0] for row in added] == ["| LENS-L6-F1", "| LENS-L6-F2", "| LENS-L6-F3"]
    assert "The switch the label names is not rendered." in added[0]
    assert all(row.endswith("| OPEN | |") for row in added)
    assert len(ledger.open_rows(register)) == 3


def test_a_second_report_under_a_banked_name_is_refused_until_it_is_named(tmp_path: Path) -> None:
    """A resumed agent's next report numbers from F1 again: matched row by row it would bank only the labels past the first one's highest."""
    register = _register(tmp_path)
    report = tmp_path / "LENS-L6-report.md"
    report.write_bytes(b"F1 one\n")
    ledger.bank(register, report)
    report.write_bytes(b"F1 another\n\nF2 and another\n")
    refused = _run("ledger", "bank", str(register), str(report))
    assert refused.returncode == 2 and "--as" in refused.stderr
    named = _run("ledger", "bank", str(register), str(report), "--as", "LENS-L6-2")
    assert named.returncode == 0, named.stderr
    assert [row.split(" | ")[0] for row in ledger.open_rows(register)] == ["| LENS-L6-F1", "| LENS-L6-2-F1", "| LENS-L6-2-F2"]


def test_a_ledger_heading_carrying_a_note_is_still_the_ledger(tmp_path: Path) -> None:
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes(REGISTER.format(marker=reg.MARKER).replace("## Findings ledger", "## Findings ledger (from 17:30)").encode("utf-8"))
    report = tmp_path / "A-report.md"
    report.write_bytes(b"F1 one\n")
    assert len(ledger.bank(register, report)) == 1


def test_a_report_numbering_its_findings_another_way_banks_nothing_and_says_so(tmp_path: Path) -> None:
    register = _register(tmp_path)
    report = tmp_path / "LENS-R1B-L6-report.md"
    report.write_bytes(BOLD_NUMBERED.encode("utf-8"))
    done = _run("ledger", "bank", str(register), str(report))
    assert done.returncode == 3
    assert "labels no finding" in done.stderr and "numbers 3 line(s) in another shape" in done.stderr
    assert _run("ledger", "bank", str(register), str(report), "--none").returncode == 0
    assert ledger.open_rows(register) == []


def test_open_exits_one_while_a_row_is_open_and_zero_once_every_row_is_closed(tmp_path: Path) -> None:
    register = _register(tmp_path)
    report = tmp_path / "A-report.md"
    report.write_bytes(b"F1 one finding\n")
    ledger.bank(register, report)
    still = _run("ledger", "open", str(register))
    assert still.returncode == 1 and "| A-F1 |" in still.stdout
    register.write_bytes(register.read_bytes().replace(b"| OPEN |", b"| FIXED |"))
    closed = _run("ledger", "open", str(register))
    assert closed.returncode == 0 and closed.stdout == ""


@pytest.mark.parametrize("tool", ["ledger", "reg"])
def test_a_character_the_pipes_codepage_lacks_prints_rather_than_failing_after_the_write(tmp_path: Path, tool: str) -> None:
    """A minus sign failed the print after the row was written, and the encode error read as a refusal."""
    register = _register(tmp_path)
    report = tmp_path / "A-report.md"
    report.write_bytes("F1 a count \u2212 one\n".encode())
    args = ("bank", str(register), str(report)) if tool == "ledger" else ("append", str(register), "a count \u2212 one")
    # A Windows pipe stands a child's streams on the console's codepage; cp1252 has no minus sign.
    done = _run(tool, *args, env={"PYTHONIOENCODING": "cp1252"})
    assert done.returncode == 0, done.stderr
    assert "a count \u2212 one" in done.stdout


def test_a_skipped_number_is_named(tmp_path: Path) -> None:
    register = _register(tmp_path)
    report = tmp_path / "B-report.md"
    report.write_bytes(b"F1 one\n\nF3 three\n")
    done = _run("ledger", "bank", str(register), str(report))
    assert done.returncode == 0 and "skips F2" in done.stderr


def _banked(tmp_path: Path, *reports: tuple[str, str]) -> Path:
    register = _register(tmp_path)
    for name, text in reports:
        (tmp_path / name).write_bytes(text.encode("utf-8"))
        ledger.bank(register, tmp_path / name)
    return register


def _status(register: Path, row: str) -> list[str]:
    line = next(line for line in register.read_bytes().decode("utf-8").splitlines() if line.startswith(f"| {row} |"))
    return [cell.strip() for cell in line.split("|")[4:6]]


def _set(register: Path, row: str, held: str, owner: str = "") -> None:
    """One row's Status and Owner cells written by hand, as a coordinator keeps a ledger between tools."""
    lines = register.read_bytes().decode("utf-8").split("\n")
    at = next(k for k, line in enumerate(lines) if line.startswith(f"| {row} |"))
    cells = lines[at].split("|")
    cells[4:6] = [f" {held} ", f" {owner} "]
    lines[at] = "|".join(cells)
    register.write_bytes("\n".join(lines).encode("utf-8"))


def test_open_unclosed_prints_every_row_no_closed_status_ends(tmp_path: Path) -> None:
    """The ending proved every row closed with `open`, which passed over ROUTED rows and statuses no command knows."""
    register = _banked(tmp_path, ("A-report.md", "F1 one\n\nF2 two\n\nF3 three\n\nF4 four\n"))
    ledger.route(register, "FIXER", ["A-F1"])
    _set(register, "A-F2", "ENDING")
    _set(register, "A-F3", "NOT A DEFECT", "the test drives it")
    _set(register, "A-F4", "FIXED (abc1234)")
    unclosed = _run("ledger", "open", str(register), "--unclosed")
    assert unclosed.returncode == 1
    assert [line.split(" | ")[0] for line in unclosed.stdout.splitlines()] == ["| A-F1", "| A-F2"]
    assert _run("ledger", "open", str(register)).returncode == 0


def test_a_row_has_one_owner_until_it_is_rerouted(tmp_path: Path) -> None:
    """Two fixers given one finding built opposite designs; the second route is refused and writes nothing."""
    register = _banked(tmp_path, ("A-report.md", "F1 one\n\nF2 two\n"))
    assert _run("ledger", "route", str(register), "FIXER-1", "A-F1", "A-F2").returncode == 0
    assert _status(register, "A-F1") == ["ROUTED", "FIXER-1"]
    before = register.read_bytes()
    second = _run("ledger", "route", str(register), "FIXER-2", "A-F2")
    assert second.returncode == 2 and "routed to FIXER-1 already" in second.stderr
    assert register.read_bytes() == before
    assert _run("ledger", "route", str(register), "FIXER-2", "A-F2", "--reroute").returncode == 0
    assert _status(register, "A-F2") == ["ROUTED", "FIXER-2"]


def test_a_routed_row_carrying_a_note_routes_to_its_owner_again(tmp_path: Path) -> None:
    """The note kept beside the owner read as part of the owner's name, so the next send to the same fixer was refused."""
    register = _banked(tmp_path, ("A-report.md", "F1 one\n"))
    _set(register, "A-F1", "OPEN", "L8 owns the wording")
    ledger.route(register, "FIXER", ["A-F1"])
    assert _status(register, "A-F1") == ["ROUTED", "FIXER; L8 owns the wording"]
    assert ledger.route(register, "FIXER", ["A-F1"]) == []
    ledger.route(register, "OTHER", ["A-F1"], reroute=True)
    assert _status(register, "A-F1") == ["ROUTED", "OTHER; L8 owns the wording"]


@pytest.mark.parametrize(
    ("row", "held", "said"),
    [("A-F9", "OPEN", "is no ledger row"), ("A-F1", "MOOT", "only an OPEN row"), ("A-F1", "ENDING", "only an OPEN row")],
    ids=["no such row", "a closed row", "a status no command knows"],
)
def test_a_route_naming_a_row_it_cannot_take_moves_none(tmp_path: Path, row: str, held: str, said: str) -> None:
    register = _banked(tmp_path, ("A-report.md", "F1 one\n\nF2 two\n"))
    _set(register, "A-F1", held, "its evidence")
    before = register.read_bytes()
    done = _run("ledger", "route", str(register), "FIXER-1", "A-F2", row)
    assert done.returncode == 2 and said in done.stderr
    assert register.read_bytes() == before


LENS_REPEAT: Final = b"F10 (for L8). In `BewerbungAngabenPanel.tsx`, `9cf8a0663` split `Leer` from its comment\n\nF11 `other` and `spans`\n"


@pytest.mark.parametrize("held", ["ROUTED", "FIXED (abc1234)"], ids=["an open earlier row", "a closed earlier row"])
def test_a_finding_several_lenses_reported_is_named_at_its_banking(tmp_path: Path, held: str) -> None:
    """The round's lenses each banked the comment orphaned above `Leer`, as rows nobody tied together; a closed row is history."""
    register = _banked(tmp_path, ("L1-report.md", "F5 (for L8). `9cf8a0663` put two constants between `Leer()` and its comment\n"))
    _set(register, "L1-F5", held, "FIXER")
    report = tmp_path / "L4-report.md"
    report.write_bytes(LENS_REPEAT)
    done = _run("ledger", "bank", str(register), str(report))
    assert done.returncode == 0, done.stderr
    if held == "ROUTED":
        assert "L4-F10 may repeat L1-F5" in done.stderr and "`9cf8a0663`, `Leer`" in done.stderr
    assert ("may repeat" in done.stderr) is (held == "ROUTED")
    assert "L4-F11" not in done.stderr


def _transcript(home: Path, agent: str, *messages: tuple[str, list[str]]) -> None:
    """An agent's transcript as the harness writes it: one line per content block, a message's blocks sharing its id."""
    folder = home / ".claude" / "projects" / "proj" / "session" / "subagents"
    folder.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps({"message": {"role": "user", "content": "the brief"}})]
    for message_id, texts in messages:
        lines.append(json.dumps({"message": {"id": message_id, "role": "assistant", "content": [{"type": "thinking", "thinking": ""}]}}))
        lines += [
            json.dumps({"message": {"id": message_id, "role": "assistant", "content": [{"type": "text", "text": text}]}}) for text in texts
        ]
    (folder / f"agent-{agent}.jsonl").write_bytes("\n".join(lines).encode("utf-8"))


def _home(tmp_path: Path) -> dict[str, str]:
    home = tmp_path / "home"
    (home / ".claude" / "projects").mkdir(parents=True, exist_ok=True)
    return {"HOME": str(home), "USERPROFILE": str(home)}


def test_bank_from_an_agent_saves_its_final_message_and_never_over_another_report(tmp_path: Path) -> None:
    """Banked findings whose report was never saved left fixers nothing to read; a resumed agent's short reply overwrote a report."""
    env = _home(tmp_path)
    _transcript(tmp_path / "home", "a1b2", ("m1", ["an interim note"]), ("m2", ["## Report\n\n", "F1 the \u2212 finding\n"]))
    register, report = _register(tmp_path), tmp_path / "AGENT-report.md"
    done = _run("ledger", "bank", str(register), str(report), "--from", "a1b2", env=env)
    assert done.returncode == 0, done.stderr
    assert report.read_bytes().decode("utf-8") == "## Report\n\nF1 the \u2212 finding\n"
    assert "| AGENT-F1 |" in done.stdout
    _transcript(tmp_path / "home", "c3d4", ("m1", ["F1 a later round\n"]))
    before = register.read_bytes()
    again = _run("ledger", "bank", str(register), str(report), "--from", "c3d4", "--as", "AGENT-r2", env=env)
    assert again.returncode == 2 and "already holds another report" in again.stderr
    assert report.read_bytes().decode("utf-8") == "## Report\n\nF1 the \u2212 finding\n" and register.read_bytes() == before


def test_a_refused_bank_from_an_agent_saves_nothing_so_its_retry_runs(tmp_path: Path) -> None:
    """Saved before it banked, a report with no label left a file the retry with --none then refused."""
    env = _home(tmp_path)
    _transcript(tmp_path / "home", "a1b2", ("m1", ["Nothing to report.\n"]))
    register, report = _register(tmp_path), tmp_path / "AGENT-report.md"
    assert _run("ledger", "bank", str(register), str(report), "--from", "a1b2", env=env).returncode == 3
    assert not report.exists()
    assert _run("ledger", "bank", str(register), str(report), "--from", "a1b2", "--none", env=env).returncode == 0
    assert report.read_bytes() == b"Nothing to report.\n"


@pytest.mark.parametrize(
    ("args", "said"), [(("--from", "nobody"), "0 transcripts"), ((), "X-report.md")], ids=["no transcript", "no report file"]
)
def test_bank_with_no_report_to_read_is_refused(tmp_path: Path, args: tuple[str, ...], said: str) -> None:
    env = _home(tmp_path)
    register = _register(tmp_path)
    before = register.read_bytes()
    done = _run("ledger", "bank", str(register), str(tmp_path / "X-report.md"), *args, env=env)
    assert done.returncode == 2 and said in done.stderr and "Traceback" not in done.stderr
    assert register.read_bytes() == before


# --- reg dispatch and message ---------------------------------------------------------------------

LIVE: Final = (
    "## Live agents\n\n| Agent name, then the id in backticks | Question | Owns | Status |\n| --- | --- | --- | --- |\n"
    "| WORKER `a1b2c3` (implementer) | the work | x | RUNNING |\n| OTHER `d4e5f6` | more | y | RUNNING |\n\n"
)


def _fleet(tmp_path: Path, messages_file: bool = True, briefs_line: bool = True) -> tuple[Path, Path, Path]:
    """A plans directory holding the sending session's register, its briefs folder and one agent's messages file."""
    briefs = tmp_path / "plans" / "prog" / "scratch" / "briefs"
    briefs.mkdir(parents=True)
    register = _banked(tmp_path, ("A-report.md", "F1 one\n\nF2 two\n"))
    head = f"# Agent register\n\nCoordinator session id: sess-1\n{f'Briefs: {briefs}' if briefs_line else ''}\n\n{LIVE}"
    placed = tmp_path / "plans" / "prog" / "REGISTER-s.md"
    placed.write_bytes(head.encode("utf-8") + register.read_bytes().split(b"\n", 1)[1])
    messages = briefs / "WORKER-messages.md"
    if messages_file:
        messages.write_bytes(b"# WORKER -- messages after the brief\n")
    return tmp_path / "plans", placed, messages


def _sent(to: str, text: str, **extra: object) -> dict[str, object]:
    return {"session_id": "sess-1", "tool_name": "SendMessage", "tool_input": {"to": to, "message": text}, **extra}


@pytest.mark.parametrize("to", ["WORKER", "a1b2c3"], ids=["by name", "by id"])
def test_a_sent_message_is_written_to_its_agents_file_and_routes_its_rows(tmp_path: Path, to: str) -> None:
    """An order appended by hand, its send forgotten, never reached the agent: the record follows the send."""
    plans, register, messages = _fleet(tmp_path)
    now = datetime.datetime(2026, 10, 6, 19, 5, tzinfo=datetime.UTC)
    text = 'Fix both.\r\nRows: A-F1, A-F2\nPath C:\\Users\\x stays as typed, and so does "agent_id": in a brief.'
    said = reg.record(_sent(to, text), plans, now)
    assert said is None
    assert messages.read_bytes().decode("utf-8") == (
        "# WORKER -- messages after the brief\n\n## 2026-10-06 19:05 coordinator\n\n"
        'Fix both.\nRows: A-F1, A-F2\nPath C:\\Users\\x stays as typed, and so does "agent_id": in a brief.\n'
    )
    assert _status(register, "A-F1") == ["ROUTED", "WORKER"] and _status(register, "A-F2") == ["ROUTED", "WORKER"]


@pytest.mark.parametrize(
    "payload",
    [
        _sent("a1b2c3", "x", agent_id="a9"),
        {**_sent("a1b2c3", "x"), "session_id": "another"},
        _sent("main", "x"),
        {**_sent("a1b2c3", "x"), "tool_name": "Read"},
    ],
    ids=["a subagent's send", "a session no register claims", "the main session", "another tool"],
)
def test_a_send_that_is_no_coordinators_order_writes_nothing_and_says_nothing(tmp_path: Path, payload: dict[str, object]) -> None:
    plans, register, messages = _fleet(tmp_path)
    before = (messages.read_bytes(), register.read_bytes())
    assert reg.record(payload, plans) is None
    assert (messages.read_bytes(), register.read_bytes()) == before


@pytest.mark.parametrize(
    ("to", "messages_file", "briefs_line", "said"),
    [
        ("WORKER", False, True, "WORKER"),
        ("PEER", True, True, "`reg.py dispatch` creates one"),
        ("WORKER", True, False, "no `Briefs:` line"),
    ],
    ids=["no messages file", "an agent no row or file names", "a register with no Briefs line"],
)
def test_a_coordinators_send_it_cannot_record_is_told_rather_than_dropped(
    tmp_path: Path, to: str, messages_file: bool, briefs_line: bool, said: str
) -> None:
    """Every agent missing from a stale live-agent table was skipped in silence; whatever is not recorded is now said."""
    plans, _, messages = _fleet(tmp_path, messages_file=messages_file, briefs_line=briefs_line)
    before = messages.read_bytes() if messages.exists() else None
    told = reg.record(_sent(to, "x"), plans)
    assert told is not None and "is in no messages file" in told and said in told
    assert (messages.read_bytes() if messages.exists() else None) == before


def test_rows_routed_elsewhere_are_told_and_the_message_still_recorded(tmp_path: Path) -> None:
    plans, register, messages = _fleet(tmp_path)
    ledger.route(register, "OTHER", ["A-F1"])
    said = reg.record(_sent("WORKER", "Fix it.\nRows: A-F1"), plans)
    assert said is not None and "routed to OTHER already" in said
    assert "Fix it." in messages.read_bytes().decode("utf-8") and _status(register, "A-F1") == ["ROUTED", "OTHER"]


def test_the_hook_command_answers_a_notice_and_a_failure_as_hook_json(tmp_path: Path) -> None:
    """A failure inside the hook was swallowed by the shell's exit 0, reading exactly like a recorded send."""
    plans, register, _ = _fleet(tmp_path, messages_file=False)
    (plans / "other" / "REGISTER-x.md").parent.mkdir()
    (plans / "other" / "REGISTER-x.md").write_bytes(b"\xff not this session's, and not utf-8\n")
    done = _run("reg", "message", str(plans), stdin=json.dumps(_sent("WORKER", "x")).encode("utf-8"))
    assert done.returncode == 0, done.stderr
    said = json.loads(done.stdout)["hookSpecificOutput"]
    assert said["hookEventName"] == "PostToolUse" and "is in no messages file" in said["additionalContext"]
    register.write_bytes(register.read_bytes() + b"\xff")
    failed = _run("reg", "message", str(plans), stdin=json.dumps(_sent("WORKER", "x")).encode("utf-8"))
    assert (
        failed.returncode == 0
        and "The messages hook failed (UnicodeDecodeError" in json.loads(failed.stdout)["hookSpecificOutput"]["additionalContext"]
    )


def test_dispatch_writes_the_messages_file_and_the_row_a_send_resolves_through(tmp_path: Path) -> None:
    """The first dispatch after the landing made no messages file and no live-agent row, so its sends had nowhere to go."""
    plans, register, _ = _fleet(tmp_path)
    briefs = tmp_path / "plans" / "prog" / "scratch" / "briefs"
    first = _run("reg", "dispatch", str(register), "NEWBIE", "--question", "the new work")
    assert first.returncode == 0, first.stderr
    assert (briefs / "NEWBIE-messages.md").read_bytes() == b"# NEWBIE -- messages after the brief\n"
    rows = [line for line in register.read_bytes().decode("utf-8").splitlines() if line.startswith("| NEWBIE")]
    assert len(rows) == 1 and rows[0].startswith("| NEWBIE | the new work |  | RUNNING (")
    assert _run("reg", "dispatch", str(register), "NEWBIE", "--id", "f00d").returncode == 0
    rows = [line for line in register.read_bytes().decode("utf-8").splitlines() if "NEWBIE" in line]
    assert len(rows) == 1 and rows[0].startswith("| NEWBIE `f00d` | the new work |")
    assert reg.record(_sent("f00d", "go"), plans) is None
    assert (briefs / "NEWBIE-messages.md").read_bytes().decode("utf-8").endswith("coordinator\n\ngo\n")


def test_dispatch_refuses_a_register_naming_no_briefs_directory(tmp_path: Path) -> None:
    _, register, _ = _fleet(tmp_path, briefs_line=False)
    before = register.read_bytes()
    done = _run("reg", "dispatch", str(register), "NEWBIE")
    assert done.returncode == 2 and "Briefs:" in done.stderr and register.read_bytes() == before


# --- ci -------------------------------------------------------------------------------------------


def _log(*lines: tuple[str, str]) -> bytes:
    """`gh run view --log-failed` as it prints: job, step and stamp before each line, a job's first stamp behind a BOM."""
    seen: set[str] = set()
    stamped = []
    for job, text in lines:
        stamped.append(f"{job}\tRun the scope\t{'' if job in seen else '\ufeff'}2026-10-06T14:54:53.1340914Z {text}")
        seen.add(job)
    return ("\n".join(stamped) + "\n").encode("utf-8")


FAILED_RUN: Final = _log(
    ("docs", "##[error]a row in `## 2. Invariants` is neither an invariant nor a header: '| I_NEW_A_1 | x' (OUT-4)"),
    ("docs", "##[error]a tracked file holds U+FEFF: scripts/tests/test_x.py (invisible)"),
    ("docs", "^[[31m   \u2717^[[0m  The documentation gate failed. Each finding above opens with what it judged"),
    ("docs", "##[error]Process completed with exit code 1."),
    ("frontend-units (1)", "      \u2716 a suite holding the failure (5.1ms)"),
    ("frontend-units (1)", "      \u2716 failing tests:"),
    ("frontend-units (1)", "      test at src/core/apiContract.test.ts:366:3"),
    ("frontend-units (1)", "      \u2716 pairs every published component with a Zod mirror (2.629853ms)"),
    ("frontend-units (1)", "##[error]frontend unit tests failed."),
    # An expected pytest failure and its unit's verdict, then a second unit's verdict with no line of its own.
    ("backend", "      FAILED tests/api/test_konto.py::test_a_read - AssertionError: 2 != 3"),
    ("backend", "##[error]backend pytest failed."),
    ("backend", "##[error]pyright found type errors in fl_backend."),
    # A self-check's own annotation, replayed indented under its step, and the gate's pointer to it.
    ("scripts", "      ::error::compaction hook: the coordinator must be told its register"),
    ("scripts", "##[error]scripts/gate/selfcheck.sh failed \u2014 its findings are above."),
    ("scripts", "^[[31m   \u2717^[[0m  1 finding(s) in this run, 1 section(s), 40s."),
    ("frontend", "      src/features/funktionen/team.test.ts(189,27): error TS2304: Cannot find name 'APIBadStatusError'."),
    ("ops", "^[[31m   \u2717^[[0m  the compose model drifted."),
    ("images", "##[error]Process completed with exit code 1."),
    ("verify", "##[error]A scope job failed -- its own log has the findings."),
    ("verify", "##[error]`db` took 155 s against a budget of 135 s"),
    ("verify", "##[error]`backend` took 81 s against a budget of 70 s"),
)
EXPECTED_RED: Final = (
    "## Expected red\n\n| Matches | Lines | Why it is red | Cleared by | Since | Status |\n| --- | --- | --- | --- | --- | --- |\n"
    "| `is neither an invariant nor a header` | | placeholders | the ending | start | RED |\n"
    "| `against a budget of` | 1 | the budget | a measurement | x | RED |\n"
    "| `test_konto.py::test_a_read` | 1 | a lane | a lane | x | RED |\n"
    "| `compaction hook:` | 1 | the hook | a lane | x | RED |\n"
    "| `apiContract.test.ts :: pairs` | | mirrors | a lane | y | CLEARED z |\n"
    "| `refusalCoverage` | | mapper | a lane | y | RED |\n\n## Next\n"
)


def _report(log: bytes, red: str = EXPECTED_RED) -> tuple[list[str], list[str], bool]:
    said, new = ci.report(log.decode("utf-8"), red)
    return said, [line.split("NEW", 1)[1].strip() for line in said if line.startswith("  NEW")], new


def test_ci_names_every_finding_of_every_failed_job_expected_or_new() -> None:
    """A job holding an expected red was read as wholly expected while a second, unlisted finding sat in it."""
    said, new, flagged = _report(FAILED_RUN)
    assert flagged
    assert new == [
        "a tracked file holds U+FEFF: scripts/tests/test_x.py (invisible)",
        "src/core/apiContract.test.ts :: pairs every published component with a Zod mirror",
        "pyright found type errors in fl_backend.",
        "src/features/funktionen/team.test.ts(189,27): error TS2304: Cannot find name 'APIBadStatusError'.",
        "the compose model drifted.",
        "images: no finding line recognised; read its log",
    ]
    assert "expected  is neither an invariant nor a header  (1 line(s))" in said
    assert "NEW  against a budget of  (2 line(s), more than its 1)" in said
    assert "            verify: `backend` took 81 s against a budget of 70 s" in said
    assert "RED row no line matched: refusalCoverage -- cleared if its job passed, otherwise its job never reached it" in said


def test_ci_passes_a_run_whose_every_finding_is_listed() -> None:
    said, new, flagged = _report(_log(("verify", "##[error]`db` took 155 s against a budget of 135 s")))
    assert not flagged and new == [], said


LIB: Final = REPO_ROOT / "scripts" / "lib" / "_lib.sh"
# Three units: a listed finding, a pytest failure listed by its own line under its unit's verdict,
# and an unlisted finding, each through the gate's own emitters and closing statements.
GATE_RUN: Final = (
    "section docs",
    "step one",
    'fail "the listed one"',
    "step two",
    "printf '      FAILED tests/x.py::t_listed - boom\\n'",
    'fail "pytest failed"',
    "step three",
    'fail "an unlisted one"',
    "finish",
)
GATE_RED: Final = "## Expected red\n\n| Matches | Status |\n| --- | --- |\n| `the listed one` | RED |\n| `t_listed` | RED |\n\n## Next\n"


def _gate(tmp_path: Path, body: tuple[str, ...]) -> bytes:
    """A gate script's real output under Actions, through `scripts/lib/_lib.sh`, wrapped as `gh` prints a failed job's log."""
    assert BASH is not None
    env = {**base_env(), "GITHUB_ACTIONS": "true"}
    script = write_shell(tmp_path / "gate.sh", "\n".join(("#!/usr/bin/env bash", f'source "{LIB.as_posix()}"', *body, "")))
    done = run_shell(BASH, script, env=env)
    assert done.returncode == 1, done.stderr
    # The runner writes stdout and stderr into one log, each stream in its own order, and logs an
    # unindented workflow command as the annotation it raises.
    lines = (re.sub(r"^::error::", "##[error]", line) for line in (done.stdout + done.stderr).splitlines())
    return _log(*(("docs", line) for line in lines))


def test_ci_reads_one_unlisted_finding_among_the_gates_listed_ones_and_none_of_its_summaries(tmp_path: Path) -> None:
    said, new, flagged = _report(_gate(tmp_path, GATE_RUN), GATE_RED)
    assert new == ["an unlisted one"], said
    assert flagged


def test_ci_passes_a_gate_run_whose_every_finding_is_listed(tmp_path: Path) -> None:
    said, new, flagged = _report(_gate(tmp_path, tuple(line for line in GATE_RUN if "unlisted" not in line)), GATE_RED)
    assert new == [] and not flagged, said


def test_ci_reads_a_job_printing_only_summaries_as_new(tmp_path: Path) -> None:
    """A job whose findings no annotation names still fails the read, through its verdict lines."""
    said, new, flagged = _report(_gate(tmp_path, ("section docs", "step one", 'fail --summary "3 finding(s) above"', "finish")), GATE_RED)
    assert "3 finding(s) above" in new and flagged, said


def _stub(tmp_path: Path, name: str, script: str) -> dict[str, str]:
    """A program on PATH answering through `script`, run by this interpreter: a `.bat` Windows finds, and a shell script elsewhere."""
    folder = tmp_path / "bin"
    folder.mkdir(exist_ok=True)
    (folder / f"{name}_stub.py").write_bytes(script.encode("utf-8"))
    stub = folder / f"{name}_stub.py"
    write_shell(folder / name, f'#!/bin/sh\nexec "{Path(sys.executable).as_posix()}" "{stub.as_posix()}" "$@"\n').chmod(0o755)
    (folder / f"{name}.bat").write_bytes(f'@"{sys.executable}" "{stub}" %*\r\n'.encode())
    return {"PATH": f"{folder}{os.pathsep}{os.environ['PATH']}"}


GH: Final = (
    "import sys\nfrom pathlib import Path\nhere = Path(__file__).parent\n"
    "if '--json' in sys.argv:\n    sys.stdout.write((here / 'run.json').read_text(encoding='utf-8'))\n"
    "else:\n    sys.stdout.buffer.write((here / 'log.txt').read_bytes())\n"
    "sys.exit(int((here / 'exit.txt').read_text(encoding='utf-8')))\n"
)


@pytest.mark.parametrize(
    ("run", "log", "code", "exit_code", "said"),
    [
        ('{"status": "in_progress", "conclusion": ""}', FAILED_RUN, 0, 2, "not concluded"),
        ('{"status": "completed", "conclusion": "failure"}', FAILED_RUN, 1, 2, "exited 1"),
        ('{"status": "completed", "conclusion": "failure"}', b"", 0, 2, "no job line"),
        ('{"status": "completed", "conclusion": "failure"}', FAILED_RUN, 0, 1, "NEW"),
        ('{"status": "completed", "conclusion": "success"}', b"", 0, 0, "CLEARED by it"),
    ],
    ids=["a run still going", "gh failing", "an empty log", "a failed run", "a run that passed"],
)
def test_ci_reads_a_run_through_gh_only_once_it_concluded(tmp_path: Path, run: str, log: bytes, code: int, exit_code: int, said: str) -> None:
    """A pipe from gh hid gh's own failure behind ci.py's exit, and nothing checked the run had concluded."""
    env = _stub(tmp_path, "gh", GH)
    (tmp_path / "bin" / "run.json").write_bytes(run.encode())
    (tmp_path / "bin" / "log.txt").write_bytes(log)
    (tmp_path / "bin" / "exit.txt").write_bytes(str(code).encode())
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes(EXPECTED_RED.encode("utf-8"))
    done = _run("ci", str(register), "123", env={**env, "PYTHONIOENCODING": "cp1252"})
    assert done.returncode == exit_code, (done.stdout, done.stderr)
    assert said in done.stdout + done.stderr and "Traceback" not in done.stderr


def test_ci_refuses_a_register_with_no_expected_red_table(tmp_path: Path) -> None:
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes(b"# Agent register\n")
    done = _run("ci", str(register), "123")
    assert done.returncode == 2 and "Expected red" in done.stderr


# --- land -----------------------------------------------------------------------------------------

# The generator stands in for `tests.openapi_document`: the document follows two source files, so
# two branches each moving one move different parts of it.
OPENAPI_WRITER: Final = (
    "from pathlib import Path\n"
    'parts = [Path(f"app/{name}.txt").read_bytes().strip() for name in ("schema", "extra")]\n'
    'Path("openapi.json").write_bytes(b"{" + b", ".join(parts) + b"}\\n")\n'
)
EINWILLIGUNG_WRITER: Final = 'from pathlib import Path\nPath("einwilligung.json").write_bytes(b"{}\\n")\n'
# Records every subject it is handed, and refuses one asking to be refused, so a test can tell a
# commit that ran the hooks from one that did not.
COMMIT_MSG_HOOK: Final = (
    "#!/bin/sh\n"
    'subject="$(head -n 1 "$1")"\n'
    'printf "%s\\n" "$subject" >> "$(git rev-parse --git-dir)/hooklog"\n'
    'case "$subject" in *REFUSE*) echo "refused by the fixture hook" >&2; exit 1 ;; esac\n'
)


def _repo(tmp_path: Path, branch: str = "agent") -> Path:
    """A session branch holding a backend with both generated documents current, and an agent branch off it."""
    root = tmp_path / "repo"
    root.mkdir()
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    write_shell(hooks / "commit-msg", COMMIT_MSG_HOOK).chmod(0o755)
    configure(root, hooks.as_posix())
    # The repository's own `.gitattributes` keeps every checkout LF, which a Windows default would not.
    git(root, "config", "core.autocrlf", "false")
    # The repository's own ignore rule: the regeneration imports the generators and writes their
    # bytecode beside them, which a tree without it would show as untracked work.
    write(root, ".gitignore", "__pycache__/\n")
    write(root, "fl_backend/app/schema.txt", '"a": 1')
    write(root, "fl_backend/app/extra.txt", '"b": 1')
    write(root, "fl_backend/tests/openapi_document.py", OPENAPI_WRITER)
    write(root, "fl_backend/tests/einwilligung_document.py", EINWILLIGUNG_WRITER)
    write(root, "fl_backend/openapi.json", '{"a": 1, "b": 1}\n')
    write(root, "fl_backend/einwilligung.json", "{}\n")
    write(root, "docs/spec.md", TABLE_HEAD + "| I1 | one |\n")
    write(root, "notes.txt", "first\n")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "Repo: The session branch")
    git(root, "branch", branch)
    return root


NOTE: Final = {"notes.txt": "second\n"}


def _agent_commit(root: Path, subject: str, files: dict[str, str], branch: str = "agent") -> str:
    """One commit on the agent branch under the agent's own name, the session branch checked out again after."""
    git(root, "checkout", "-q", branch)
    for rel, text in files.items():
        write(root, rel, text)
    git(root, "add", "-A")
    git(root, "-c", "user.name=agent", "-c", "user.email=agent@example.invalid", "commit", "-q", "--no-verify", "-m", subject)
    sha = git(root, "rev-parse", "HEAD")
    git(root, "checkout", "-q", "main")
    return sha


def _session_commit(root: Path, subject: str, files: dict[str, str]) -> None:
    for rel, text in files.items():
        write(root, rel, text)
    git(root, "add", "-A")
    git(root, "commit", "-q", "--no-verify", "-m", subject)


def _hooked(root: Path) -> list[str]:
    log = root / ".git" / "hooklog"
    return log.read_bytes().decode("utf-8").splitlines() if log.exists() else []


def _land(root: Path, branch: str = "agent", env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    """The landing run from the session's checkout against the register beside it, written the first time."""
    register = root.parent / "REGISTER-s.md"
    if not register.exists():
        _register(root.parent)
    return _run("land", str(register), branch, cwd=root, env=env)


def _stopped_clean(root: Path, head: str, code: int, branch: str = "agent") -> str:
    """A landing that stopped with `code`, leaving no merge in progress, no change and the session branch where it was."""
    done = _land(root, branch)
    assert done.returncode == code, (done.returncode, done.stderr)
    assert "Traceback" not in done.stderr
    assert git(root, "status", "--porcelain") == "" and not (root / ".git" / "MERGE_HEAD").exists()
    assert git(root, "rev-parse", "HEAD") == head, "a stopped landing committed something"
    return done.stderr


def test_a_finished_branch_lands_whole_as_one_merge_through_the_hooks(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    start = git(root, "rev-parse", "HEAD")
    _agent_commit(root, "Docs: A note", NOTE)
    tip = _agent_commit(root, "Docs: Another file", {"other.txt": "new\n"})
    hooked = len(_hooked(root))
    done = _land(root)
    assert done.returncode == 0, done.stderr
    assert done.stdout.startswith("landed agent as")
    assert git(root, "log", "-1", "--format=%P").split() == [start, tip]
    assert git(root, "log", "--format=%an", f"{start}..{tip}").splitlines() == ["agent", "agent"]
    assert _hooked(root)[hooked:] == ["Merge branch 'agent'"]


STANDING: Final = (
    "## Standing actions\n\n| Trigger | The whole brief | Dispatched? |\n| --- | --- | --- |\n"
    "| WORKER lands B2c | wake KONTO-FE for F2 | |\n| WORKER lands B1 | done before | yes 14:02 |\n"
    "| OTHER lands | not this one | |\n\n"
)


def test_a_landing_closes_only_the_rows_routed_to_its_agent_that_a_rows_fixed_line_names(tmp_path: Path) -> None:
    """Routes went out by message and the ledger fell hundreds of rows behind; a bare mention or another fixer's row closed nothing."""
    branch = "worktree-agent-a1b2c3"
    root = _repo(tmp_path, branch=branch)
    register = _banked(tmp_path, ("A-report.md", "F1 one\n\nF2 two\n\nF3 three\n\nF4 four\n\nF11 eleven\n"))
    register.write_bytes(register.read_bytes().replace(b"## Findings ledger", (LIVE + STANDING + "## Findings ledger").encode("utf-8")))
    ledger.route(register, "WORKER", ["A-F1", "A-F4", "A-F11"])
    ledger.route(register, "OTHER", ["A-F2"])
    body = "Rows fixed: A-F11.\nRows fixed: A-F2, A-F3.\n\nA-F4 stays open, unlike A-F1."
    _agent_commit(root, f"Docs: A note\n\n{body}", NOTE, branch=branch)
    done = _land(root, branch)
    assert done.returncode == 0, done.stderr
    merge = git(root, "rev-parse", "--short", "HEAD")
    assert f"FIXED A-F11 by {merge}" in done.stdout
    assert "not ROUTED to WORKER, a1b2c3, so left as they stand: A-F2, A-F3" in done.stdout
    assert _status(register, "A-F11") == [f"FIXED ({merge})", "was WORKER"]
    assert [_status(register, row)[0] for row in ("A-F1", "A-F2", "A-F3", "A-F4")] == ["ROUTED", "ROUTED", "OPEN", "ROUTED"]
    assert "a standing action waits on this landing: WORKER lands B2c" in done.stdout
    assert "B1" not in done.stdout and "OTHER lands" not in done.stdout


def test_a_branch_the_session_already_holds_is_nothing_to_land(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    _agent_commit(root, "Docs: A note", NOTE)
    assert _land(root).returncode == 0
    head = git(root, "rev-parse", "HEAD")
    again = _land(root)
    assert again.returncode == 0 and "nothing to land" in again.stdout
    assert git(root, "rev-parse", "HEAD") == head


def test_a_merge_touching_the_backend_regenerates_a_stale_document(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    _agent_commit(root, "Backend: The schema grows", {"fl_backend/app/schema.txt": '"a": 2'})
    done = _land(root)
    assert done.returncode == 0, done.stderr
    assert "(regenerated openapi.json; type-checked fl_backend)" in done.stdout
    assert git(root, "show", "HEAD:fl_backend/openapi.json") == '{"a": 2, "b": 1}'


def test_a_generated_document_conflict_is_answered_by_regenerating_it(tmp_path: Path) -> None:
    """Each side regenerated its own document, so the two documents conflict while the code merges clean."""
    root = _repo(tmp_path)
    _agent_commit(root, "Backend: The extra grows", {"fl_backend/app/extra.txt": '"b": 2', "fl_backend/openapi.json": '{"a": 1, "b": 2}\n'})
    _session_commit(root, "Backend: The schema grows", {"fl_backend/app/schema.txt": '"a": 2', "fl_backend/openapi.json": '{"a": 2, "b": 1}\n'})
    done = _land(root)
    assert done.returncode == 0, done.stderr
    assert git(root, "show", "HEAD:fl_backend/openapi.json") == '{"a": 2, "b": 2}'


def test_a_spec_table_conflict_lands_merged_by_row_key(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    _agent_commit(root, "Docs: A row", {"docs/spec.md": TABLE_HEAD + "| I1 | one |\n| I3 | three |\n"})
    _session_commit(root, "Docs: The session's row", {"docs/spec.md": TABLE_HEAD + "| I1 | one |\n| I2 | two |\n"})
    done = _land(root)
    assert done.returncode == 0, done.stderr
    assert "merged by row key: docs/spec.md: ADD I3 after I2" in done.stdout
    landed = git(root, "show", "HEAD:docs/spec.md")
    assert "| I2 | two |" in landed and "| I3 | three |" in landed and "<<<<<<<" not in landed


def test_a_conflict_outside_a_table_aborts_the_merge(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    _agent_commit(root, "Docs: A note", {"notes.txt": "agent\n"})
    _session_commit(root, "Repo: The session's note", {"notes.txt": "session\n"})
    said = _stopped_clean(root, git(root, "rev-parse", "HEAD"), 3)
    assert "CONFLICT in notes.txt" in said and "the merge is aborted" in said


@pytest.mark.parametrize(
    ("ours", "theirs", "base", "reason"),
    [
        ("| a | 2 |\n", "| a | 3 |\n", "| K | V |\n| - | - |\n| a | 1 |\n| a | 1 |\n", "no column of the table"),
        ("| A | session |\n", "| A | agent |\n", None, "is missing from the merge-base"),
    ],
    ids=["a table no column keys", "a file both sides added"],
)
def test_a_markdown_conflict_the_row_merge_cannot_settle_aborts_the_merge(
    tmp_path: Path, ours: str, theirs: str, base: str | None, reason: str
) -> None:
    root = _repo(tmp_path)
    if base is not None:
        _session_commit(root, "Docs: The endpoint table", {"docs/endpoints.md": base})
        git(root, "branch", "-f", "agent", "HEAD")
    _agent_commit(root, "Docs: The agent's row", {"docs/endpoints.md": (base or "") + theirs})
    _session_commit(root, "Docs: The session's row", {"docs/endpoints.md": (base or "") + ours})
    assert reason in _stopped_clean(root, git(root, "rev-parse", "HEAD"), 3)


def test_a_row_merge_that_raises_aborts_the_merge(tmp_path: Path) -> None:
    """The row merge reads a conflicted file as utf-8, so a byte outside it raises inside the merge path."""
    root = _repo(tmp_path)
    (root / "docs" / "latin.md").write_bytes(b"| K | v |\n| --- | --- |\n| A | base |\n")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "Docs: A latin-1 table")
    git(root, "branch", "-f", "agent", "HEAD")
    git(root, "checkout", "-q", "agent")
    (root / "docs" / "latin.md").write_bytes(b"| K | v |\n| --- | --- |\n| A | agent \xe9 |\n")
    git(root, "-c", "user.name=agent", "-c", "user.email=agent@example.invalid", "commit", "-q", "--no-verify", "-am", "Docs: The agent's row")
    git(root, "checkout", "-q", "main")
    (root / "docs" / "latin.md").write_bytes(b"| K | v |\n| --- | --- |\n| A | session \xe9 |\n")
    git(root, "commit", "-q", "--no-verify", "-am", "Docs: The session's row")
    assert "UnicodeDecodeError" in _stopped_clean(root, git(root, "rev-parse", "HEAD"), 3)


def test_a_failing_regeneration_aborts_the_merge(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    _agent_commit(root, "Backend: The writer breaks", {"fl_backend/tests/openapi_document.py": "raise SystemExit(3)\n"})
    assert "tests.openapi_document --write exited 3" in _stopped_clean(root, git(root, "rev-parse", "HEAD"), 4)


def test_a_merge_failing_a_touched_packages_type_check_aborts_the_merge(tmp_path: Path) -> None:
    """Each side type-checks alone; together the agent's new caller passes the session's narrowed parameter a string."""
    root = _repo(tmp_path)
    _agent_commit(root, "Backend: A caller", {"fl_backend/app/caller.py": "from app.callee import f\n\nf('one')\n"})
    _session_commit(root, "Backend: A callee", {"fl_backend/app/callee.py": "def f(x: int) -> int:\n    return x\n"})
    said = _stopped_clean(root, git(root, "rev-parse", "HEAD"), 5)
    assert "the merged tree fails `" in said and "caller.py" in said


def test_a_type_failure_already_at_head_is_its_own_outcome(tmp_path: Path) -> None:
    """While the session branch held a type error, every landing touching the package was sent back to an agent no rebase could help."""
    root = _repo(tmp_path)
    _agent_commit(root, "Backend: A clean module", {"fl_backend/app/fine.py": "def g(x: int) -> int:\n    return x\n"})
    _session_commit(root, "Backend: A red module", {"fl_backend/app/bad.py": 'x: int = "not a number"\n'})
    said = _stopped_clean(root, git(root, "rev-parse", "HEAD"), 8)
    assert "the session branch already fails" in said and "bad.py" in said


UV_RECORDER: Final = (
    "import sys\nfrom pathlib import Path\n(Path(__file__).parent / 'uv-called.txt').write_bytes(' '.join(sys.argv[1:]).encode())\n"
)


def test_a_merge_moving_a_lockfile_installs_before_it_type_checks(tmp_path: Path) -> None:
    """Checked against the checkout's stale install, a merge moving a dependency was judged by packages it no longer uses."""
    root = _repo(tmp_path)
    env = _stub(tmp_path, "uv", UV_RECORDER)
    _agent_commit(root, "Backend deps: A lock moves", {"fl_backend/uv.lock": "version = 2\n"})
    done = _land(root, env=env)
    assert done.returncode == 0, done.stderr
    assert (tmp_path / "bin" / "uv-called.txt").read_bytes() == b"sync --project fl_backend --dev --frozen"


def test_a_merge_commit_the_hooks_refuse_aborts_the_merge(tmp_path: Path) -> None:
    root = _repo(tmp_path, branch="agent-REFUSE")
    _agent_commit(root, "Docs: A note", NOTE, branch="agent-REFUSE")
    said = _stopped_clean(root, git(root, "rev-parse", "HEAD"), 6, branch="agent-REFUSE")
    assert "refused by the fixture hook" in said


def _refused(root: Path, branch: str = "agent") -> str:
    head = git(root, "rev-parse", "HEAD")
    done = _land(root, branch)
    assert done.returncode == 2, (done.returncode, done.stderr)
    assert git(root, "rev-parse", "HEAD") == head, "a refused landing committed something"
    return done.stderr


def test_a_checkout_holding_changes_is_refused(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    _agent_commit(root, "Docs: A note", NOTE)
    write(root, "stray.txt", "uncommitted\n")
    assert "land from a clean tree" in _refused(root)


def test_a_name_that_is_no_branch_is_refused(tmp_path: Path) -> None:
    assert "is no local branch" in _refused(_repo(tmp_path), "absent")


def test_uncommitted_work_in_the_agents_worktree_is_refused(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    _agent_commit(root, "Docs: A note", NOTE)
    tree = tmp_path / "agent-tree"
    git(root, "worktree", "add", "-q", str(tree), "agent")
    write(tree, "unsaved.txt", "work\n")
    assert "holds uncommitted work" in _refused(root)


@pytest.mark.parametrize("named", [("-m", "parked"), ()], ids=["named stash", "unnamed stash"])
def test_a_stash_entry_on_the_branch_is_refused(tmp_path: Path, named: tuple[str, ...]) -> None:
    """git lists a named entry as "On <branch>:" and an unnamed one as "WIP on <branch>:"."""
    root = _repo(tmp_path)
    _agent_commit(root, "Docs: A note", NOTE)
    git(root, "checkout", "-q", "agent")
    write(root, "notes.txt", "stashed\n")
    git(root, "stash", "push", "-q", *named)
    git(root, "checkout", "-q", "main")
    assert "a stash entry is on agent" in _refused(root)


def test_a_branch_carrying_a_patch_the_session_already_holds_is_refused(tmp_path: Path) -> None:
    """A cherry-picked commit's twin on the agent's branch merges clean and can double a hunk a later edit touches."""
    root = _repo(tmp_path)
    picked = _agent_commit(root, "Docs: A note", NOTE)
    _agent_commit(root, "Docs: Another file", {"other.txt": "new\n"})
    git(root, "cherry-pick", picked)
    said = _refused(root)
    assert "1 commit(s) whose patch the session branch already holds" in said and "Docs: A note" in said
    assert "Docs: Another file" not in said


def test_git_failing_during_the_merge_is_its_own_exit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Exit 2 says nothing was started; a failure once the merge has begun must not read as that."""
    root = _repo(tmp_path)
    _agent_commit(root, "Backend: The schema grows", {"fl_backend/app/schema.txt": '"a": 2'})
    head = git(root, "rev-parse", "HEAD")
    real_git = land.git

    def add_fails(*args: str, check: bool = True) -> str:
        if args[:1] == ("add",):
            raise land.Stop(2, "git add exited 128: planted")
        return real_git(*args, check=check)

    monkeypatch.setattr(land, "git", add_fails)
    monkeypatch.chdir(root)
    code = land.main([str(_register(tmp_path)), "agent"])
    said = capsys.readouterr().err
    assert code == 7, said
    assert "planted" in said and git(root, "rev-parse", "HEAD") == head
    assert git(root, "status", "--porcelain") == ""
