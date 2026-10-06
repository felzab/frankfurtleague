"""SCRIPTS · the orchestration skill's tools, driven over fixture repositories and registers.

Each tool replaces a step a coordinator can get wrong in silence: a merge taking in work nobody
committed, a clock time typed ahead of the clock, a finding banked with no ledger row. Every
refusal arm is driven as well as the pass, since a tool failing open reads exactly like one with
nothing to refuse.
"""

from __future__ import annotations

import datetime
import os
import subprocess
import sys
from pathlib import Path
from typing import Final

import pytest
from conftest import REPO_ROOT, configure, git, import_scripts, write, write_shell

TOOLS: Final = REPO_ROOT / ".claude" / "skills" / "orchestration" / "tools"

merge_rows, reg, ledger, land = import_scripts("merge_rows", "reg", "ledger", "land", directories=("../.claude/skills/orchestration/tools",))


def _run(
    tool: str, *args: str, cwd: Path | None = None, stdin: bytes | None = None, encoding: str | None = None
) -> subprocess.CompletedProcess[str]:
    """One tool run as the coordinator runs it, by this interpreter, its streams decoded as utf-8.

    `encoding` stands the child's streams on another codec, as a Windows pipe stands them on the console's codepage.
    """
    env = {**os.environ, "PYTHONIOENCODING": encoding} if encoding else None
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
    report.write_bytes("F1 a count − one\n".encode())
    args = ("bank", str(register), str(report)) if tool == "ledger" else ("append", str(register), "a count − one")
    done = _run(tool, *args, encoding="cp1252")
    assert done.returncode == 0, done.stderr
    assert "a count − one" in done.stdout


def test_a_skipped_number_is_named(tmp_path: Path) -> None:
    register = _register(tmp_path)
    report = tmp_path / "B-report.md"
    report.write_bytes(b"F1 one\n\nF3 three\n")
    done = _run("ledger", "bank", str(register), str(report))
    assert done.returncode == 0 and "skips F2" in done.stderr


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


def _stopped_clean(root: Path, head: str, code: int, branch: str = "agent") -> str:
    """A landing that stopped with `code`, leaving no merge in progress, no change and the session branch where it was."""
    done = _run("land", branch, cwd=root)
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
    done = _run("land", "agent", cwd=root)
    assert done.returncode == 0, done.stderr
    assert done.stdout.startswith("landed agent as")
    assert git(root, "log", "-1", "--format=%P").split() == [start, tip]
    assert git(root, "log", "--format=%an", f"{start}..{tip}").splitlines() == ["agent", "agent"]
    assert _hooked(root)[hooked:] == ["Merge branch 'agent'"]


def test_a_branch_the_session_already_holds_is_nothing_to_land(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    _agent_commit(root, "Docs: A note", NOTE)
    assert _run("land", "agent", cwd=root).returncode == 0
    head = git(root, "rev-parse", "HEAD")
    again = _run("land", "agent", cwd=root)
    assert again.returncode == 0 and "nothing to land" in again.stdout
    assert git(root, "rev-parse", "HEAD") == head


def test_a_merge_touching_the_backend_regenerates_a_stale_document(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    _agent_commit(root, "Backend: The schema grows", {"fl_backend/app/schema.txt": '"a": 2'})
    done = _run("land", "agent", cwd=root)
    assert done.returncode == 0, done.stderr
    assert "(regenerated openapi.json; type-checked fl_backend)" in done.stdout
    assert git(root, "show", "HEAD:fl_backend/openapi.json") == '{"a": 2, "b": 1}'


def test_a_generated_document_conflict_is_answered_by_regenerating_it(tmp_path: Path) -> None:
    """Each side regenerated its own document, so the two documents conflict while the code merges clean."""
    root = _repo(tmp_path)
    _agent_commit(root, "Backend: The extra grows", {"fl_backend/app/extra.txt": '"b": 2', "fl_backend/openapi.json": '{"a": 1, "b": 2}\n'})
    _session_commit(root, "Backend: The schema grows", {"fl_backend/app/schema.txt": '"a": 2', "fl_backend/openapi.json": '{"a": 2, "b": 1}\n'})
    done = _run("land", "agent", cwd=root)
    assert done.returncode == 0, done.stderr
    assert git(root, "show", "HEAD:fl_backend/openapi.json") == '{"a": 2, "b": 2}'


def test_a_spec_table_conflict_lands_merged_by_row_key(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    _agent_commit(root, "Docs: A row", {"docs/spec.md": TABLE_HEAD + "| I1 | one |\n| I3 | three |\n"})
    _session_commit(root, "Docs: The session's row", {"docs/spec.md": TABLE_HEAD + "| I1 | one |\n| I2 | two |\n"})
    done = _run("land", "agent", cwd=root)
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


def test_a_merge_commit_the_hooks_refuse_aborts_the_merge(tmp_path: Path) -> None:
    root = _repo(tmp_path, branch="agent-REFUSE")
    _agent_commit(root, "Docs: A note", NOTE, branch="agent-REFUSE")
    said = _stopped_clean(root, git(root, "rev-parse", "HEAD"), 6, branch="agent-REFUSE")
    assert "refused by the fixture hook" in said


def _refused(root: Path, branch: str = "agent") -> str:
    head = git(root, "rev-parse", "HEAD")
    done = _run("land", branch, cwd=root)
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
    code = land.main(["agent"])
    said = capsys.readouterr().err
    assert code == 7, said
    assert "planted" in said and git(root, "rev-parse", "HEAD") == head
    assert git(root, "status", "--porcelain") == ""
