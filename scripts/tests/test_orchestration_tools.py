"""SCRIPTS · the orchestration skill's tools, driven over fixture repositories and registers.

Each tool replaces a step a coordinator did by hand and got wrong in silence: a landing that
re-picked commits an earlier landing took, a clock time typed ahead of the clock, a finding banked
with no ledger row. Every refusal arm is driven as well as the pass, since a tool failing open
reads exactly like one with nothing to refuse.
"""

from __future__ import annotations

import datetime
import subprocess
import sys
from pathlib import Path
from typing import Final

import pytest
from conftest import REPO_ROOT, configure, git, import_scripts, write, write_shell

TOOLS: Final = REPO_ROOT / ".claude" / "skills" / "orchestration" / "tools"

merge_rows, reg, ledger, land = import_scripts("merge_rows", "reg", "ledger", "land", directories=("../.claude/skills/orchestration/tools",))


def _run(tool: str, *args: str, cwd: Path | None = None, stdin: bytes | None = None) -> subprocess.CompletedProcess[str]:
    """One tool run as the coordinator runs it, by this interpreter, its streams decoded as utf-8."""
    done = subprocess.run((sys.executable, str(TOOLS / f"{tool}.py"), *args), cwd=cwd, input=stdin, capture_output=True, check=False)
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
        ("| I4 | four |\n", "| I2 | theirs |\n", "| I2 | theirs |\n", "the commit changes a row the session branch removed"),
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
    ids=["both add a POST row", "both add a GET row the table already keys"],
)
def test_a_key_naming_more_than_one_row_stops_the_merge(ours: str, theirs: str) -> None:
    conflicted = f"{ENDPOINTS}<<<<<<< HEAD\n{ours}=======\n{theirs}>>>>>>> agent\n"
    merge = merge_rows.merge_text(conflicted, ENDPOINTS, ENDPOINTS + theirs)
    assert merge.text is None
    assert any("names no one row" in conflict for conflict in merge.conflicts), merge.conflicts


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


def test_a_skipped_number_is_named(tmp_path: Path) -> None:
    register = _register(tmp_path)
    report = tmp_path / "B-report.md"
    report.write_bytes(b"F1 one\n\nF3 three\n")
    done = _run("ledger", "bank", str(register), str(report))
    assert done.returncode == 0 and "skips F2" in done.stderr


# --- land -----------------------------------------------------------------------------------------

# The generator stands in for `tests.openapi_document`: the document follows a source file, so a
# commit moving that file moves the document.
OPENAPI_WRITER: Final = (
    'from pathlib import Path\nPath("openapi.json").write_bytes(b"{" + Path("app/schema.txt").read_bytes().strip() + b"}\\n")\n'
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
DEFERRED: Final = "`fl_backend/openapi.json` is regenerated at landing."


def _repo(tmp_path: Path) -> Path:
    """A session branch holding a backend with both generated documents current, and an agent branch off it."""
    root = tmp_path / "repo"
    root.mkdir()
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    write_shell(hooks / "commit-msg", COMMIT_MSG_HOOK).chmod(0o755)
    configure(root, hooks.as_posix())
    # The repository's own `.gitattributes` keeps every checkout LF, which a Windows default would not.
    git(root, "config", "core.autocrlf", "false")
    write(root, "fl_backend/app/schema.txt", '"a": 1')
    write(root, "fl_backend/tests/openapi_document.py", OPENAPI_WRITER)
    write(root, "fl_backend/tests/einwilligung_document.py", EINWILLIGUNG_WRITER)
    write(root, "fl_backend/openapi.json", '{"a": 1}\n')
    write(root, "fl_backend/einwilligung.json", "{}\n")
    write(root, "docs/spec.md", TABLE_HEAD + "| I1 | one |\n")
    write(root, "notes.txt", "first\n")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "Repo: The session branch")
    git(root, "branch", "agent")
    return root


NOTE: Final = {"notes.txt": "second\n"}


def _agent_commit(root: Path, subject: str, body: str, files: dict[str, str]) -> str:
    """One commit on the agent branch under the agent's own name, the session branch checked out again after."""
    git(root, "checkout", "-q", "agent")
    for rel, text in files.items():
        write(root, rel, text)
    git(root, "add", "-A")
    git(root, "-c", "user.name=agent", "-c", "user.email=agent@example.invalid", "commit", "-q", "--no-verify", "-m", subject, "-m", body)
    sha = git(root, "rev-parse", "HEAD")
    git(root, "checkout", "-q", "main")
    return sha


def _hooked(root: Path) -> list[str]:
    log = root / ".git" / "hooklog"
    return log.read_bytes().decode("utf-8").splitlines() if log.exists() else []


def test_a_landing_regenerates_into_its_commit_and_keeps_the_agent_as_author(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    start = git(root, "rev-parse", "HEAD")
    first = _agent_commit(root, "Backend: The schema grows", f"The model moved.\n\n{DEFERRED}", {"fl_backend/app/schema.txt": '"a": 2'})
    second = _agent_commit(root, "Docs: A note", "Prose only.", NOTE)
    hooked = len(_hooked(root))
    done = _run("land", start, "agent", cwd=root)
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip().endswith(f"recorded tip: {second}")
    assert "(regenerated openapi.json)" in done.stdout
    landed = git(root, "log", "--format=%H", f"{start}..HEAD").split()
    assert len(landed) == 2
    backend = landed[1]
    assert git(root, "show", f"{backend}:fl_backend/openapi.json") == '{"a": 2}'
    assert "`fl_backend/openapi.json` is regenerated in this commit." in git(root, "log", "-1", "--format=%B", backend)
    assert git(root, "log", "-1", "--format=%an", backend) == "agent"
    assert _hooked(root)[hooked:] == ["Backend: The schema grows", "Docs: A note"]
    assert first != backend


def test_a_second_landing_from_the_recorded_tip_takes_only_the_new_commit(tmp_path: Path) -> None:
    """The rebase this replaces existed because the merge-base range lists commits a landing already took."""
    root = _repo(tmp_path)
    start = git(root, "rev-parse", "HEAD")
    tip = _agent_commit(root, "Docs: A note", "Prose only.", NOTE)
    assert _run("land", start, "agent", cwd=root).returncode == 0
    # A later session commit removes a line the landed commit added, which a re-pick would bring back.
    write(root, "notes.txt", "rewritten by the session\n")
    git(root, "commit", "-q", "-am", "Repo: The session rewrites the note")
    _agent_commit(root, "Docs: Another file", "Prose only.", {"other.txt": "new\n"})
    done = _run("land", tip, "agent", cwd=root)
    assert done.returncode == 0, done.stderr
    assert git(root, "log", "--format=%s", "-2").splitlines() == ["Docs: Another file", "Repo: The session rewrites the note"]
    assert (root / "notes.txt").read_bytes() == b"rewritten by the session\n"


def test_a_spec_table_conflict_lands_merged_by_row_key(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    start = git(root, "rev-parse", "HEAD")
    _agent_commit(root, "Docs: A row", "An invariant.", {"docs/spec.md": TABLE_HEAD + "| I1 | one |\n| I3 | three |\n"})
    write(root, "docs/spec.md", TABLE_HEAD + "| I1 | one |\n| I2 | two |\n")
    git(root, "commit", "-q", "-am", "Docs: The session's row")
    done = _run("land", start, "agent", cwd=root)
    assert done.returncode == 0, done.stderr
    assert "merged by row key: docs/spec.md: ADD I3 after I2" in done.stdout
    landed = (root / "docs" / "spec.md").read_bytes().decode("utf-8")
    assert "| I2 | two |" in landed and "| I3 | three |" in landed and "<<<<<<<" not in landed


def test_an_already_landed_change_is_skipped_rather_than_committed_empty(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    start = git(root, "rev-parse", "HEAD")
    tip = _agent_commit(root, "Docs: A note", "Prose only.", NOTE)
    write(root, "notes.txt", "second\n")
    git(root, "commit", "-q", "-am", "Docs: The same note, landed by hand")
    done = _run("land", start, "agent", cwd=root)
    assert done.returncode == 0, done.stderr
    assert f"skipped {tip[:9]}" in done.stdout


def _refused(root: Path, start: str) -> subprocess.CompletedProcess[str]:
    head = git(root, "rev-parse", "HEAD")
    done = _run("land", start, "agent", cwd=root)
    assert done.returncode == 2, (done.returncode, done.stderr)
    assert git(root, "rev-parse", "HEAD") == head, "a refused landing committed something"
    return done


def test_a_checkout_holding_changes_is_refused(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    start = git(root, "rev-parse", "HEAD")
    _agent_commit(root, "Docs: A note", "Prose only.", NOTE)
    write(root, "stray.txt", "uncommitted\n")
    assert "land from a clean tree" in _refused(root, start).stderr


def test_a_rewritten_branch_is_refused_with_the_range_diff_to_land_by(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    start = git(root, "rev-parse", "HEAD")
    tip = _agent_commit(root, "Docs: A note", "Prose only.", NOTE)
    git(root, "branch", "-f", "agent", start)
    _agent_commit(root, "Docs: The note, rewritten", "Prose only.", {"notes.txt": "other\n"})
    said = _refused(root, tip).stderr
    assert f"git range-diff {tip}...agent" in said and "git merge-base HEAD agent" in said


def test_uncommitted_work_in_the_agents_worktree_is_refused(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    start = git(root, "rev-parse", "HEAD")
    _agent_commit(root, "Docs: A note", "Prose only.", NOTE)
    tree = tmp_path / "agent-tree"
    git(root, "worktree", "add", "-q", str(tree), "agent")
    write(tree, "unsaved.txt", "work\n")
    assert "holds uncommitted work" in _refused(root, start).stderr


@pytest.mark.parametrize("named", [("-m", "parked"), ()], ids=["named stash", "unnamed stash"])
def test_a_stash_entry_on_the_branch_is_refused(tmp_path: Path, named: tuple[str, ...]) -> None:
    """git lists a named entry as "On <branch>:" and an unnamed one as "WIP on <branch>:"."""
    root = _repo(tmp_path)
    start = git(root, "rev-parse", "HEAD")
    _agent_commit(root, "Docs: A note", "Prose only.", NOTE)
    git(root, "checkout", "-q", "agent")
    write(root, "notes.txt", "stashed\n")
    git(root, "stash", "push", "-q", *named)
    git(root, "checkout", "-q", "main")
    assert "a stash entry is on agent" in _refused(root, start).stderr


def test_a_merge_commit_in_the_range_is_refused(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    start = git(root, "rev-parse", "HEAD")
    _agent_commit(root, "Docs: A note", "Prose only.", NOTE)
    write(root, "other.txt", "session\n")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "Repo: Session work")
    git(root, "checkout", "-q", "agent")
    git(root, "merge", "-q", "--no-edit", "--no-verify", "main")
    git(root, "checkout", "-q", "main")
    assert "holds a merge commit" in _refused(root, start).stderr


@pytest.mark.parametrize(
    ("body", "files", "said"),
    [
        (DEFERRED, NOTE, "the landing leaves it unchanged"),
        ("The model moved.", {"fl_backend/app/schema.txt": '"a": 3'}, "the body does not say so"),
        (
            "`fl_backend/openapi.json` is not regenerated here; the regeneration adds a field.",
            {"fl_backend/app/schema.txt": '"a": 3'},
            "the body does not say so",
        ),
    ],
    ids=["claims a move that did not happen", "moves a document it does not name", "names a moved document in other words"],
)
def test_a_body_disagreeing_with_its_landed_diff_stops_with_the_pick_staged(
    tmp_path: Path, body: str, files: dict[str, str], said: str
) -> None:
    root = _repo(tmp_path)
    start = git(root, "rev-parse", "HEAD")
    _agent_commit(root, "Docs: A change", body, files)
    done = _run("land", start, "agent", cwd=root)
    assert done.returncode == 5, (done.returncode, done.stderr)
    assert said in done.stderr and f"recorded tip: {start}" in done.stderr
    assert git(root, "rev-parse", "HEAD") == start
    assert git(root, "diff", "--cached", "--name-only"), "the pick should be left staged for the coordinator"


def test_a_conflict_outside_a_table_stops_with_nothing_of_that_commit_staged(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    start = git(root, "rev-parse", "HEAD")
    first = _agent_commit(root, "Docs: Another file", "Prose only.", {"other.txt": "agent\n"})
    _agent_commit(root, "Docs: A note", "Prose only.", {"notes.txt": "agent\n"})
    write(root, "notes.txt", "session\n")
    git(root, "commit", "-q", "-am", "Repo: The session's note")
    done = _run("land", start, "agent", cwd=root)
    assert done.returncode == 3, (done.returncode, done.stderr)
    assert "CONFLICT" in done.stderr and f"recorded tip: {first}" in done.stderr
    assert git(root, "status", "--porcelain") == ""
    assert git(root, "log", "-1", "--format=%s") == "Docs: Another file"


def test_a_commit_the_hooks_refuse_stops_with_its_message_kept(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    start = git(root, "rev-parse", "HEAD")
    _agent_commit(root, "Docs: REFUSE this", "Prose only.", NOTE)
    done = _run("land", start, "agent", cwd=root)
    assert done.returncode == 6, (done.returncode, done.stderr)
    assert "refused by the fixture hook" in done.stderr
    kept = Path(done.stderr.split("its message is ", 1)[1].splitlines()[0])
    assert kept.read_bytes().decode("utf-8").startswith("Docs: REFUSE this")


@pytest.mark.parametrize(
    ("ours", "theirs", "base", "reason"),
    [
        ("| POST | `/teams` |\n", "| POST | `/spieler` |\n", ENDPOINTS, "names no one row"),
        ("| A | session |\n", "| A | agent |\n", None, "is missing from"),
    ],
    ids=["a method-keyed table", "a file both sides added"],
)
def test_a_markdown_conflict_the_merge_cannot_settle_stops_clean(tmp_path: Path, ours: str, theirs: str, base: str | None, reason: str) -> None:
    """Both stopped badly before: the first landed with the agent's row dropped, the second in a traceback with the pick left half done."""
    root = _repo(tmp_path)
    if base is not None:
        write(root, "docs/endpoints.md", base)
        git(root, "add", "-A")
        git(root, "commit", "-q", "-m", "Docs: The endpoint table")
        git(root, "branch", "-f", "agent", "HEAD")
    start = git(root, "rev-parse", "HEAD")
    _agent_commit(root, "Docs: The agent's row", "A row.", {"docs/endpoints.md": (base or "") + theirs})
    write(root, "docs/endpoints.md", (base or "") + ours)
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "Docs: The session's row")
    head = git(root, "rev-parse", "HEAD")
    done = _run("land", start, "agent", cwd=root)
    assert done.returncode == 3, (done.returncode, done.stderr)
    assert "Traceback" not in done.stderr and "CONFLICT" in done.stderr and reason in done.stderr
    assert git(root, "status", "--porcelain") == "" and git(root, "rev-parse", "HEAD") == head


def _in_process(root: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], *argv: str) -> tuple[int, str]:
    """`land.main` run inside this process, for a case that swaps one of its collaborators."""
    monkeypatch.chdir(root)
    code = land.main(list(argv))
    captured = capsys.readouterr()
    return code, captured.out + captured.err


def test_a_pick_that_stages_nothing_is_skipped_only_when_its_change_is_present(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A merge resolving to the session branch's side, which the method-keyed table produced, empties the index while the change is absent."""
    root = _repo(tmp_path)
    start = git(root, "rev-parse", "HEAD")
    _agent_commit(root, "Docs: A row", "An invariant.", {"docs/spec.md": TABLE_HEAD + "| I1 | one |\n| I3 | three |\n"})
    write(root, "docs/spec.md", TABLE_HEAD + "| I1 | one |\n| I2 | two |\n")
    git(root, "commit", "-q", "-am", "Docs: The session's row")
    head = git(root, "rev-parse", "HEAD")

    def drops_the_commits_side(path: str, base_sha: str, commit_sha: str) -> object:
        ours = git(root, "show", f"HEAD:{path}") + "\n"
        (root / path).write_bytes(ours.encode("utf-8"))
        return merge_rows.Merge(text=ours)

    monkeypatch.setattr(land, "merge_file", drops_the_commits_side)
    code, said = _in_process(root, monkeypatch, capsys, start, "agent")
    assert code == 8, said
    assert "its change is absent" in said and git(root, "rev-parse", "HEAD") == head


def test_hold_stages_the_next_commit_and_its_message_and_commits_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    root = _repo(tmp_path)
    start = git(root, "rev-parse", "HEAD")
    first = _agent_commit(root, "Backend: The schema grows", f"The model moved.\n\n{DEFERRED}", {"fl_backend/app/schema.txt": '"a": 2'})
    _agent_commit(root, "Docs: A note", "Prose only.", NOTE)
    code, said = _in_process(root, monkeypatch, capsys, "--hold", start, "agent")
    assert code == 0, said
    assert git(root, "rev-parse", "HEAD") == start, "a held landing committed"
    assert sorted(git(root, "diff", "--cached", "--name-only").split()) == ["fl_backend/app/schema.txt", "fl_backend/openapi.json"]
    held = Path(said.split("its message is ", 1)[1].splitlines()[0])
    assert "`fl_backend/openapi.json` is regenerated in this commit." in held.read_bytes().decode("utf-8")
    assert "--author=agent <agent@example.invalid>" in said and f"then continue from: {first}" in said


def test_git_failing_after_a_pick_is_its_own_exit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    """Exit 2 says nothing was picked; a failure past the first pick leaves the landing part done, so it must not read as that."""
    root = _repo(tmp_path)
    start = git(root, "rev-parse", "HEAD")
    _agent_commit(root, "Backend: The schema grows", f"The model moved.\n\n{DEFERRED}", {"fl_backend/app/schema.txt": '"a": 2'})
    real_git = land.git

    def add_fails(*args: str, check: bool = True) -> str:
        if args[:1] == ("add",):
            raise land.Stop(2, "git add exited 128: planted")
        return real_git(*args, check=check)

    monkeypatch.setattr(land, "git", add_fails)
    code, said = _in_process(root, monkeypatch, capsys, start, "agent")
    assert code == 7, said
    assert "read `git status`" in said and f"recorded tip: {start}" in said
