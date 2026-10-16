"""SCRIPTS · the orchestration skill's tools, driven over fixture repositories and registers.

Each tool replaces a step a coordinator can get wrong in silence: a merge taking in work nobody
committed, a clock time typed ahead of the clock, a finding banked with no ledger row, a CI red read
as expected. Every
refusal arm is driven as well as the pass, since a tool failing open reads exactly like one with
nothing to refuse.
"""

from __future__ import annotations

import contextlib
import datetime
import io
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Mapping
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


# --- the skill text's calls -----------------------------------------------------------------------

# Every page the coordinator or an agent reads a tool call from.
PAGES: Final = tuple(
    sorted(
        [
            *(REPO_ROOT / ".claude" / "skills" / "orchestration").glob("*.md"),
            *(REPO_ROOT / ".claude" / "agents").glob("*.md"),
            *(REPO_ROOT / ".claude" / "commands").glob("*.md"),
        ]
    )
)
TOOL_NAME_RE: Final = re.compile(r"(?<![\w-])(?:reg|ledger|ci|land)\.py\b")
FENCE_LINE_RE: Final = re.compile(r"^\s*```")
# The register template's marker line names a tool in prose.
COMMENT_RE: Final = re.compile(r"<!--.*?-->", re.DOTALL)
SPAN_PLACEHOLDER_RE: Final = re.compile(r"<[^<>]+>")
# What argparse says of a call leaving out a word a full one carries, which a page naming a command may do.
SHORT_RE: Final = re.compile(r"the following arguments are required|expected one argument")


def _calls(text: str) -> list[str]:
    """Each tool call a page names, a `path :: symbol` citation aside: from the tool's name to the end of its code span.

    A span opened by a path or `uv run` holds a call too, and a fenced line holds one outside any span, to its end.
    """
    calls: list[str] = []
    fenced, ticks = False, 0
    lines = COMMENT_RE.sub("", text).split("\n")
    for k, line in enumerate(lines):
        if FENCE_LINE_RE.match(line):
            fenced, ticks = not fenced, 0
            continue
        # A code span never crosses a blank line, so the backticks before a name are counted from the paragraph's start.
        ticks = ticks if line.strip() else 0
        for found in TOOL_NAME_RE.finditer(line):
            if (ticks + line.count("`", 0, found.start())) % 2:
                calls.append(" ".join("\n".join([line[found.start() :], *lines[k + 1 :]]).split("`", 1)[0].split()))
            elif fenced:
                calls.append(line[found.start() :].strip())
        ticks += line.count("`")
    return [call for call in calls if "::" not in call]


def _misnamed(call: str) -> str | None:
    """argparse's refusal of a call naming a word its tool lacks, or None; a call short of words is filled out first."""
    words = shlex.split(SPAN_PLACEHOLDER_RE.sub("1", call.replace("…", "").replace("...", "")))
    tool, argv = words[0].removesuffix(".py"), words[1:]
    if tool == "ci":
        build, argv = (ci.expect_parser, argv[1:]) if argv[:1] == ["expect"] else (ci.read_parser, argv)
    else:
        build = {"reg": reg.parser, "ledger": ledger.parser, "land": land.parser}[tool]
    said = ""
    # A word appended at a time stands in for each the page left out: a flag's value, then a positional.
    for filled in range(6):
        stderr = io.StringIO()
        try:
            with contextlib.redirect_stderr(stderr):
                build().parse_args([*argv, *["1"] * filled])
        except SystemExit:
            said = stderr.getvalue().strip().splitlines()[-1]
            if SHORT_RE.search(said):
                continue
            return said
        return None
    return said


def test_the_judge_of_a_call_refuses_a_misnamed_word_and_passes_a_short_mention() -> None:
    assert _misnamed("reg.py resume <register> --next <text>") is not None
    assert _misnamed("reg.py pauses <register>") is not None
    assert _misnamed("reg.py dispatch --nope") is not None
    assert _misnamed("ci.py expect <register> <run> --cleared-by <landing> --wait") is not None
    assert [_misnamed(call) for call in ("ledger.py bank --from", "reg.py overlap --brief", "ci.py", "land.py")] == [None] * 4
    assert _calls("`reg.py live <register>`, `ledger.py :: STATUSES` and `reg.py`") == ["reg.py live <register>", "reg.py"]
    # A span a path opens, a span wrapping a line, a fenced shell line, and neither prose nor a comment.
    page = "`uv run x/tools/reg.py pause <r>` and `ledger.py close\n<r>`, prose reg.py\n<!-- reg.py x -->\n```bash\nuv run ci.py --head\n```\n"
    assert _calls(page) == ["reg.py pause <r>", "ledger.py close <r>", "ci.py --head"]


@pytest.mark.parametrize("page", PAGES, ids=lambda page: f"{page.parent.name}/{page.name}")
def test_every_tool_call_a_page_names_parses_through_its_tool(page: Path) -> None:
    """The text and the tools were written on two branches against one spec, and a flag the text named that the tool lacked ran nowhere."""
    refused = [f"`{call}`: {said}" for call in _calls(page.read_bytes().decode("utf-8")) if (said := _misnamed(call))]
    assert refused == []


def test_the_core_names_tool_calls_for_the_seam_to_read() -> None:
    """A page set or a span shape the extraction misses would leave the seam case passing over nothing."""
    assert len(_calls((REPO_ROOT / ".claude" / "skills" / "orchestration" / "SKILL.md").read_bytes().decode("utf-8"))) >= 5


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
    "# Agent register\n\n## Resume point\n\nNext action: land.\n\n{marker}\n\n{live}## Findings ledger\n\n"
    "| # | Source report | Finding (file :: anchor) | Status | Owner, or the evidence that closed it |\n"
    "|---|---|---|---|---|\n\n## Findings banked\n"
)
# Every owner a fixture routes to has its row: a route names a live agent or a queue.
LIVE: Final = (
    "## Live agents\n\n| Agent name, then the id in backticks | Question | Owns | Status |\n| --- | --- | --- | --- |\n"
    "| WORKER `a1b2c3` (implementer) | the work | x | RUNNING |\n| OTHER `d4e5f6` | more | y | RUNNING |\n"
    "| FIXER | a fix |  | RUNNING |\n| FIXER-1 | a fix |  | RUNNING |\n| FIXER-2 | a fix |  | RUNNING |\n\n"
)


def _register(tmp_path: Path, markers: int = 1, live: str = LIVE) -> Path:
    path = tmp_path / "REGISTER-s.md"
    path.write_bytes(REGISTER.format(marker="\n".join([reg.MARKER] * markers), live=live).encode("utf-8"))
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


@pytest.mark.parametrize("command", ["append", "resume"])
def test_text_given_as_arguments_is_refused_naming_the_two_ways(tmp_path: Path, command: str) -> None:
    """A backtick inside a double-quoted argument ran as a command, and the line kept the words around the gap."""
    register = _register(tmp_path)
    before = register.read_bytes()
    done = _run("reg", command, str(register), "a", "beside it counts")
    assert done.returncode == 2 and "--file <path>" in done.stderr and "<<'EOF'" in done.stderr, done.stderr
    assert register.read_bytes() == before
    written = "(a `typeof X` beside it)" if command == "append" else "Next action: land `X`"
    text = tmp_path / "update.txt"
    text.write_bytes(f"{written}\n".encode())
    assert _run("reg", command, str(register), "--file", str(text)).returncode == 0
    assert written in register.read_bytes().decode("utf-8")


# A writer killed while it holds the lock: its `finally` never runs, so the lock stays.
KILLED_HOLDER: Final = (
    "import os, sys; from pathlib import Path; import ledger; held = ledger.locked(Path(sys.argv[1])); held.__enter__(); os._exit(0)"
)


@pytest.mark.parametrize("stale", [False, True], ids=["no lock", "a lock its killed writer left"])
def test_twenty_writers_started_together_each_land_their_line(tmp_path: Path, stale: bool) -> None:
    """Each writer rewrote the whole register through one shared spare, so a concurrent change vanished while its command exited 0.

    A lock left by a killed writer stopped every later one; twenty finding it at once must break it once.
    """
    register = _register(tmp_path)
    if stale:
        subprocess.run((sys.executable, "-c", KILLED_HOLDER, str(register)), cwd=TOOLS, check=True)
        assert (tmp_path / f"{register.name}.lock").exists()
    texts = []
    for k in range(20):
        texts.append(tmp_path / f"u{k}.txt")
        texts[-1].write_bytes(f"writer {k}\n".encode())
    writers = [
        subprocess.Popen((sys.executable, str(TOOLS / "reg.py"), "append", str(register), "--file", str(text)), stderr=subprocess.PIPE)
        for text in texts
    ]
    failed = [(writer.returncode, writer.stderr.read() if writer.stderr else b"") for writer in writers if writer.wait() != 0]
    assert failed == []
    held = register.read_bytes().decode("utf-8")
    assert sorted(int(found) for found in re.findall(r"^UPDATE [\d -]+:\d\d: writer (\d+)$", held, re.MULTILINE)) == list(range(20))
    assert sorted(path.name for path in tmp_path.iterdir() if path.name.startswith(register.name)) == [register.name]


def test_a_writer_waits_for_the_lock_and_then_writes(tmp_path: Path) -> None:
    """The twenty writers above pass by luck where nothing excludes them; holding the lock makes the wait certain."""
    register = _register(tmp_path)
    done: list[str] = []
    with ledger.locked(register):
        writer = threading.Thread(target=lambda: done.append(reg.append(register, "after the lock")))
        writer.start()
        writer.join(0.5)
        assert writer.is_alive() and "after the lock" not in register.read_bytes().decode("utf-8")
    writer.join(ledger.LOCK_SECONDS)
    assert done and done[0] in register.read_bytes().decode("utf-8")
    assert not (tmp_path / f"{register.name}.lock").exists()


def test_every_register_writer_waits_for_the_lock(tmp_path: Path) -> None:
    """A writer rewriting the register without the lock drops a concurrent write, and no other case notices one that skips it.

    Each starts while both locks are held, and one that ends before they are released took neither.
    """
    plans, register, messages = _fleet(tmp_path)
    tables = STANDING + EXPECTED_RED.replace("## Next\n", "") + "## Findings ledger"
    register.write_bytes(register.read_bytes().replace(b"## Findings ledger", tables.encode()))
    (tmp_path / "C-report.md").write_bytes(b"F1 one\n\nF2 two\n\nF3 three\n\nF4 four\n")
    ledger.bank(register, tmp_path / "C-report.md")
    ledger.route(register, "WORKER", ["C-F4"])
    brief = _brief(tmp_path, "LATER", "")
    writers = {
        "reg.py :: append": lambda: reg.append(register, "x"),
        "reg.py :: resume": lambda: reg.resume(register, "Next action: y\n"),
        "reg.py :: queue": lambda: reg.queue(register, "window", brief),
        "reg.py :: tick_windows": lambda: reg.tick_windows(register, "e"),
        "reg.py :: dispatch": lambda: reg.dispatch(register, "NEWBIE"),
        "reg.py :: pause": lambda: reg.pause(register, ["FIXER"]),
        "reg.py :: record": lambda: reg.record(_sent("WORKER", "go"), plans),
        "ledger.py :: bank_text": lambda: ledger.bank_text(register, "F1 one\n", "B-report.md"),
        "ledger.py :: route": lambda: ledger.route(register, "OTHER", ["C-F1"]),
        "ledger.py :: route_each": lambda: ledger.route_each(register, "OTHER", ["C-F2"]),
        "ledger.py :: close": lambda: ledger.close(register, "MOOT", "e", ["C-F3"]),
        "ledger.py :: close_routed": lambda: ledger.close_routed(register, ["C-F4"], "e", {"WORKER"}),
        "ci.py :: clear": lambda: ci.clear(register, {("compaction hook:", None): "CLEARED x"}),
        "ci.py :: expect": lambda: ci.expect(register, "1", "abc1234", [("job", "a line")], "x"),
    }
    errors: dict[str, BaseException] = {}

    def run(name: str, write: Callable[[], object]) -> None:
        try:
            write()
        except BaseException as error:
            errors[name] = error

    before = (register.read_bytes(), messages.read_bytes())
    with ledger.locked(register), ledger.locked(messages):
        threads = {name: threading.Thread(target=run, args=(name, write)) for name, write in writers.items()}
        for thread in threads.values():
            thread.start()
        time.sleep(0.5)
        ended = sorted(name for name, thread in threads.items() if not thread.is_alive())
        assert ended == [] and (register.read_bytes(), messages.read_bytes()) == before, (ended, errors)
    for thread in threads.values():
        thread.join(ledger.LOCK_SECONDS)
    assert errors == {} and not any(thread.is_alive() for thread in threads.values()), errors
    assert "| C-F4 | C-report.md | four | FIXED (e) | was WORKER |" in register.read_bytes().decode("utf-8")


@pytest.mark.parametrize(("running", "said"), [(True, "names process {pid}, still running"), (False, "names no process")])
def test_a_lock_naming_a_running_process_or_none_is_kept_and_named(tmp_path: Path, running: bool, said: str) -> None:
    """Only a lock whose process has ended is broken: an id reused, or a writer between making its lock and naming itself, still writes."""
    register = _register(tmp_path)
    lock = tmp_path / f"{register.name}.lock"
    lock.write_bytes(str(os.getpid()).encode() if running else b"")
    before = register.read_bytes()
    with pytest.raises(OSError, match=re.escape(said.format(pid=os.getpid()))):
        ledger.update(register, lambda lines: lines.append("x"), time.monotonic() + 0.2)
    assert register.read_bytes() == before and lock.exists()


def test_a_write_waits_out_a_reader_holding_the_register_open(tmp_path: Path) -> None:
    """On Windows a replace refuses a file another process holds open, and a reader holding the register failed the write."""
    register = _register(tmp_path)
    done: list[str] = []
    failed: list[BaseException] = []

    def write() -> None:
        try:
            done.append(reg.append(register, "past the reader"))
        except BaseException as error:
            failed.append(error)

    with register.open("rb"):
        writer = threading.Thread(target=write)
        writer.start()
        writer.join(0.3)
    writer.join(ledger.LOCK_SECONDS)
    assert failed == [] and done and done[0] in register.read_bytes().decode("utf-8")


def test_a_register_written_with_carriage_returns_keeps_them_through_every_writer(tmp_path: Path) -> None:
    """A rewritten row lost its carriage return, since a row is split into cells and joined again."""
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes((RESUME_POINT.format(marker=reg.MARKER) + LIVE + REGISTER.split("{live}")[1]).replace("\n", "\r\n").encode("utf-8"))
    (tmp_path / "A-report.md").write_bytes(b"F1 one\n")
    ledger.bank(register, tmp_path / "A-report.md")
    ledger.route(register, "FIXER", ["A-F1"])
    reg.resume(register, "Next action, and why it is next: push\n")
    reg.append(register, "an update")
    held = register.read_bytes()
    assert held.count(b"\n") == held.count(b"\r\n") and b"Next action, and why it is next: push\r\n" in held
    assert b"| A-F1 | A-report.md | one | ROUTED | FIXER |\r\n" in held


RESUME_POINT: Final = (
    "# Agent register\n\n## Resume point -- rewritten whenever what it names changes\n"
    "Next action, and why it is next: land A\nLive at 18:59 (each reports by notification): A, B\n"
    "Branch about to land: A's\nLast gate run: none\nUPDATE 2026-10-15 15:05: W0 dispatched\n{marker}\n\n## Next\n"
)


def test_resume_rewrites_the_fields_its_text_names_and_no_other(tmp_path: Path) -> None:
    """The fields read fifteen hours stale beneath 128 newer UPDATE lines, since no command rewrote them."""
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes(RESUME_POINT.format(marker=reg.MARKER).encode("utf-8"))
    now = datetime.datetime(2026, 10, 16, 11, 20, tzinfo=datetime.UTC)
    line = reg.resume(register, "Next action, and why it is next: push\n\nLive at 18:59 (each reports by notification): B only\n", now)
    assert (
        line == "UPDATE 2026-10-16 11:20: resume point rewritten: Next action, and why it is next; Live at 18:59 (each reports by notification)"
    )
    held = register.read_bytes().decode("utf-8")
    assert "Next action, and why it is next: push\nLive at 18:59 (each reports by notification): B only\nBranch about to land: A's\n" in held
    assert f"W0 dispatched\n{line}\n{reg.MARKER}" in held
    before = register.read_bytes()
    with pytest.raises(ValueError, match="holds no single field Estimate to the ending.*its fields are Next action"):
        reg.resume(register, "Next action, and why it is next: x\nEstimate to the ending, each figure measured or estimated: 17:30\n", now)
    assert register.read_bytes() == before


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
    with pytest.raises(ValueError, match="F1 is labelled on prose lines 5 “The switch the label names is not rendered.”, 16 “again"):
        ledger.bank(register, report)
    added = ledger.bank(register, report, settled={1: 5}).added
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
    assert named.returncode == 4, named.stderr
    assert [row.split(" | ")[0] for row in ledger.open_rows(register)] == ["| LENS-L6-F1", "| LENS-L6-2-F1", "| LENS-L6-2-F2"]


def test_a_ledger_heading_carrying_a_note_is_still_the_ledger(tmp_path: Path) -> None:
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes(
        REGISTER.format(marker=reg.MARKER, live=LIVE).replace("## Findings ledger", "## Findings ledger (from 17:30)").encode("utf-8")
    )
    report = tmp_path / "A-report.md"
    report.write_bytes(b"F1 one\n")
    assert len(ledger.bank(register, report).added) == 1


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
    args = ("bank", str(register), str(report)) if tool == "ledger" else ("append", str(register))
    # A Windows pipe stands a child's streams on the console's codepage; cp1252 has no minus sign.
    done = _run(tool, *args, stdin="a count \u2212 one".encode(), env={"PYTHONIOENCODING": "cp1252"})
    assert done.returncode == (4 if tool == "ledger" else 0), done.stderr
    assert "a count \u2212 one" in done.stdout


def test_a_skipped_number_is_named(tmp_path: Path) -> None:
    register = _register(tmp_path)
    report = tmp_path / "B-report.md"
    report.write_bytes(b"F1 one\n\nF3 three\n")
    done = _run("ledger", "bank", str(register), str(report))
    assert done.returncode == 4 and "skips F2" in done.stderr


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
    """The ending proved every row closed with `open`, which passes over ROUTED rows."""
    register = _banked(tmp_path, ("A-report.md", "F1 one\n\nF3 three\n\nF4 four\n"))
    ledger.route(register, "FIXER", ["A-F1"])
    _set(register, "A-F3", "NOT A DEFECT", "the test drives it")
    _set(register, "A-F4", "FIXED (abc1234)")
    unclosed = _run("ledger", "open", str(register), "--unclosed")
    assert unclosed.returncode == 1
    assert [line.split(" | ")[0] for line in unclosed.stdout.splitlines()] == ["| A-F1"]
    assert _run("ledger", "open", str(register)).returncode == 0


@pytest.mark.parametrize(
    "args",
    [("open",), ("open", "--unclosed"), ("route", "FIXER", "A-F2"), ("close", "MOOT", "its evidence", "A-F2"), ("bank", "B-report.md")],
    ids=["open", "open --unclosed", "route", "close of another row", "bank"],
)
def test_a_status_no_command_knows_is_refused_by_every_command_reading_the_ledger(tmp_path: Path, args: tuple[str, ...]) -> None:
    """A helper wrote `CLOSED` over finished rows: `open --unclosed` printed them all and `open` read them as closed."""
    register = _banked(tmp_path, ("A-report.md", "F1 one\n\nF2 two\n"))
    _set(register, "A-F1", "CLOSED", "its evidence")
    (tmp_path / "B-report.md").write_bytes(b"F1 one\n")
    before = register.read_bytes()
    done = _run("ledger", args[0], str(register), *(str(tmp_path / arg) if arg.endswith(".md") else arg for arg in args[1:]))
    assert done.returncode == 2 and "A-F1 is `CLOSED`" in done.stderr and "--reclose" in done.stderr, done.stderr
    assert done.stdout == "" and register.read_bytes() == before
    mended = _run("ledger", "close", str(register), "MOOT", "its evidence", "A-F1", "--reclose")
    assert mended.returncode == 0, mended.stderr
    assert _run("ledger", "open", str(register), "--unclosed").stdout.split(" | ")[0] == "| A-F2"


@pytest.mark.parametrize(
    ("held", "said", "commands"),
    [
        ("OPENED", "A-F1 is `OPENED`, no word of OPEN, ROUTED, FIXED, RULED, HANDOFF, NOT A DEFECT, MOOT: where its finding is done", True),
        ("FIXED (abc1234) | stray", "has 6 cells, not 5: mend its cells by hand", False),
    ],
    ids=["a word a status opens", "a row of six cells"],
)
def test_a_status_cell_naming_no_status_whole_is_refused(tmp_path: Path, held: str, said: str, commands: bool) -> None:
    """Read by its opening letters `OPENED` was OPEN, and a row an unescaped pipe widened was no row at all.

    Each refusal names the repair that works for its kind: no command rewrites a row it cannot split.
    """
    register = _banked(tmp_path, ("A-report.md", "F1 one\n"))
    _set(register, "A-F1", held)
    done = _run("ledger", "open", str(register), "--unclosed")
    assert done.returncode == 2 and said in done.stderr, done.stderr
    assert ("--reclose" in done.stderr and "--reroute" in done.stderr) is commands, done.stderr
    assert ("--reclose" in done.stderr or "--reroute" in done.stderr) is commands, done.stderr


def _printed(said: str, kind: str, **filled: str) -> list[str]:
    """The repair a refusal printed for `kind`, each `<placeholder>` filled, as the arguments a shell runs."""
    found = re.search(rf"where {kind}, `([^`]+)`", said)
    assert found is not None, said
    return [filled[arg[1:-1]] if ledger.PLACEHOLDER_RE.fullmatch(arg) else arg for arg in shlex.split(found[1])]


@pytest.mark.parametrize(
    ("kind", "filled", "after"),
    [
        ("its finding is done", {"status": "MOOT", "evidence": "the plan moved"}, ["MOOT (the plan moved)", "was ROUTD; FIXER"]),
        ("it is in flight", {"agent": "FIXER"}, ["ROUTED", "FIXER; was ROUTD; FIXER"]),
    ],
    ids=["done", "in flight"],
)
def test_a_mistyped_status_is_mended_by_either_repair_its_refusal_prints(
    tmp_path: Path, kind: str, filled: dict[str, str], after: list[str]
) -> None:
    """Offered a closing repair alone, a mistyped in-flight row was steered to closed, a finding nobody fixed.

    Each printed line runs whole, from outside the repository, into a register whose path holds a space.
    """
    folder = tmp_path / "a fleet"
    folder.mkdir()
    register = _banked(folder, ("A-report.md", "F1 one\n"))
    _set(register, "A-F1", "ROUTD", "FIXER")
    refused = _run("ledger", "open", str(register), "--unclosed")
    assert refused.returncode == 2, refused.stderr
    mend = subprocess.run(_printed(refused.stderr, kind, **filled), cwd=tmp_path, capture_output=True, check=False)
    assert mend.returncode == 0, mend.stderr.decode("utf-8", "replace")
    assert _row(register, "A-F1")[3:] == after


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
    ("row", "held", "flags", "said"),
    [
        ("A-F9", "OPEN", (), "is no ledger row"),
        ("A-F1", "MOOT", (), "only an OPEN row"),
        ("A-F1", "MOOT", ("--reroute",), "only an OPEN row"),
        ("A-F1", "ENDING", (), "A-F1 is `ENDING`"),
    ],
    ids=["no such row", "a closed row", "a closed row rerouted", "a status no command knows"],
)
def test_a_route_naming_a_row_it_cannot_take_moves_none(tmp_path: Path, row: str, held: str, flags: tuple[str, ...], said: str) -> None:
    """`--reroute` lifts the refusal of a word no command knows, and never a closed row's evidence."""
    register = _banked(tmp_path, ("A-report.md", "F1 one\n\nF2 two\n"))
    _set(register, "A-F1", held, "its evidence")
    before = register.read_bytes()
    done = _run("ledger", "route", str(register), "FIXER-1", "A-F2", row, *flags)
    assert done.returncode == 2 and said in done.stderr
    assert register.read_bytes() == before


def _row(register: Path, row: str) -> list[str]:
    """One row's cells as the ledger splits them, an escaped pipe kept inside its cell."""
    return next(cells for line in register.read_bytes().decode("utf-8").splitlines() if (cells := ledger.cells(line))[:1] == [row])


def test_close_sets_open_and_routed_rows_to_a_closing_status_and_its_evidence(tmp_path: Path) -> None:
    """Rows closed by hand took a word outside the vocabulary; evidence holding a pipe would split its row."""
    register = _banked(tmp_path, ("A-report.md", "F1 one\n\nF2 two\n\nF3 three\n"))
    ledger.route(register, "FIXER", ["A-F1"])
    done = _run("ledger", "close", str(register), "NOT A DEFECT", "the test | drives it\nalready", "A-F1", "A-F2")
    assert done.returncode == 0, done.stderr
    assert done.stdout.splitlines() == ["NOT A DEFECT A-F1", "NOT A DEFECT A-F2"]
    assert _row(register, "A-F1")[3:] == ["NOT A DEFECT (the test \\| drives it already)", "was FIXER"]
    assert _row(register, "A-F2")[3:] == ["NOT A DEFECT (the test \\| drives it already)", ""]
    assert [line.split(" | ")[0] for line in _run("ledger", "open", str(register), "--unclosed").stdout.splitlines()] == ["| A-F3"]
    again = _run("ledger", "close", str(register), "MOOT", "the plan moved", "A-F1", "--reclose")
    assert again.returncode == 0, again.stderr
    assert _row(register, "A-F1")[3:] == ["MOOT (the plan moved)", "was NOT A DEFECT (the test \\| drives it already); was FIXER"]


@pytest.mark.parametrize(
    ("word", "evidence", "rows", "said"),
    [
        ("CLOSED", "e", ("A-F2",), "`CLOSED` is no closing status"),
        ("ROUTED", "e", ("A-F2",), "`ROUTED` is no closing status"),
        ("MOOT", " \n ", ("A-F2",), "the evidence is empty"),
        ("MOOT", "e", ("A-F2", "A-F9"), "A-F9 is no ledger row"),
        ("MOOT", "e", ("A-F2", "A-F1"), "A-F1 is `FIXED (abc1234)` already: --reclose"),
    ],
    ids=["a word outside the vocabulary", "a word that closes nothing", "no evidence", "no such row", "a closed row"],
)
def test_a_close_it_cannot_make_closes_none(tmp_path: Path, word: str, evidence: str, rows: tuple[str, ...], said: str) -> None:
    register = _banked(tmp_path, ("A-report.md", "F1 one\n\nF2 two\n"))
    _set(register, "A-F1", "FIXED (abc1234)", "was FIXER")
    before = register.read_bytes()
    done = _run("ledger", "close", str(register), word, evidence, *rows)
    assert done.returncode == 2 and said in done.stderr, done.stderr
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
    assert done.returncode == 4, done.stderr
    if held == "ROUTED":
        assert "L4-F10 may repeat L1-F5" in done.stderr and "`9cf8a0663`, `Leer`" in done.stderr
    assert ("may repeat" in done.stderr) is (held == "ROUTED")
    assert "L4-F11 may repeat" not in done.stderr


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
    assert done.returncode == 4, done.stderr
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


def _synthetic(home: Path, agent: str) -> None:
    """The quota stop the harness appends to a transcript as an assistant message of its own, after the report."""
    path = home / ".claude" / "projects" / "proj" / "session" / "subagents" / f"agent-{agent}.jsonl"
    content = [{"type": "text", "text": "You've hit your session limit"}]
    message = {"id": "uuid", "model": "<synthetic>", "role": "assistant", "usage": {"input_tokens": 0}, "content": content}
    path.write_bytes(path.read_bytes() + b"\n" + json.dumps({"isApiErrorMessage": True, "message": message}).encode())


def test_bank_from_an_agent_skips_the_quota_stop_and_sets_its_live_row_done(tmp_path: Path) -> None:
    """The quota message banked as the report, so the report was saved by hand; and 108 finished agents read RUNNING."""
    env = _home(tmp_path)
    _transcript(tmp_path / "home", "a1b2c3", ("m1", ["F1 the real finding\n"]))
    _synthetic(tmp_path / "home", "a1b2c3")
    register, report = _register(tmp_path), tmp_path / "WORKER-report.md"
    done = _run("ledger", "bank", str(register), str(report), "--from", "a1b2c3", env=env)
    assert done.returncode == 4, done.stderr
    assert report.read_bytes() == b"F1 the real finding\n"
    live = next(line for line in register.read_bytes().decode().splitlines() if line.startswith("| WORKER"))
    assert re.fullmatch(r"\| WORKER `a1b2c3` \(implementer\) \| the work \| x \| DONE \d{4}-\d\d-\d\d \d\d:\d\d WORKER-report\.md \|", live), (
        live
    )


@pytest.mark.parametrize(
    ("after", "said"),
    [
        ({"role": "assistant", "content": [{"type": "tool_use", "name": "Bash", "input": {}}]}, "ending in a tool call"),
        ({"role": "user", "content": [{"type": "text", "text": "[Request interrupted by user]"}]}, "ending in a message to it"),
    ],
    ids=["a quota stop after a tool call", "an interruption"],
)
@pytest.mark.parametrize("flags", [(), ("--none",)], ids=["labelled", "--none"])
def test_bank_from_an_agent_stopped_mid_task_banks_and_saves_nothing(
    tmp_path: Path, after: dict[str, object], said: str, flags: tuple[str, ...]
) -> None:
    """A stopped agent's last text was an interim note written beside its next call, and `--none` saved it as the report."""
    env = _home(tmp_path)
    _transcript(tmp_path / "home", "a1b2c3", ("m1", ["F1 looks real; checking the merge next.\n"]))
    path = tmp_path / "home" / ".claude" / "projects" / "proj" / "session" / "subagents" / "agent-a1b2c3.jsonl"
    path.write_bytes(path.read_bytes() + b"\n" + json.dumps({"message": {"id": "m1", **after}}).encode())
    _synthetic(tmp_path / "home", "a1b2c3")
    register, report = _register(tmp_path), tmp_path / "WORKER-report.md"
    before = register.read_bytes()
    done = _run("ledger", "bank", str(register), str(report), "--from", "a1b2c3", *flags, env=env)
    assert done.returncode == 2 and f"a1b2c3 stopped mid-task, its transcript {said}" in done.stderr, done.stderr
    assert register.read_bytes() == before and not report.exists()


def test_bank_routes_and_closes_in_its_own_write_and_names_each_row_left_open(tmp_path: Path) -> None:
    """Implementer and research rows were banked and never routed: 555 of them sat OPEN at once."""
    register = _register(tmp_path)
    report = tmp_path / "A-report.md"
    report.write_bytes(b"F1 one\n\nF2 two\n\nF3 three\n\nF4 four\n")
    done = _run("ledger", "bank", str(register), str(report), "--route", "FIXER=F1,F3", "--close", "NOT A DEFECT=the test: drives it:F2")
    assert done.returncode == 4 and "left OPEN: A-F4" in done.stderr, done.stderr
    assert _status(register, "A-F1") == ["ROUTED", "FIXER"] and _status(register, "A-F3") == ["ROUTED", "FIXER"]
    assert _status(register, "A-F2") == ["NOT A DEFECT (the test: drives it)", ""] and _status(register, "A-F4") == ["OPEN", ""]
    report.write_bytes(b"F1 one\n")
    assert _run("ledger", "bank", str(register), str(report), "--as", "B", "--route", "owner-german=F1").returncode == 0


@pytest.mark.parametrize(
    "args",
    [("--route", "FIXER=F9"), ("--route", "FIXER=F1", "--close", "MOOT=e:F1"), ("--route", "NOBODY=F1"), ("--close", "CLOSED=e:F1")],
    ids=["no such label", "one label twice", "an owner no row or queue names", "a word that closes nothing"],
)
def test_a_bank_whose_routes_or_closes_cannot_all_apply_writes_nothing(tmp_path: Path, args: tuple[str, ...]) -> None:
    register = _register(tmp_path)
    (tmp_path / "A-report.md").write_bytes(b"F1 one\n\nF2 two\n")
    before = register.read_bytes()
    done = _run("ledger", "bank", str(register), str(tmp_path / "A-report.md"), *args)
    assert done.returncode == 2 and done.stdout == "" and register.read_bytes() == before, done.stderr


def test_a_route_to_an_owner_neither_live_nor_a_queue_is_refused_naming_the_queues(tmp_path: Path) -> None:
    """180 rows sat with 21 names that never became agents, seven of them spellings of the owner's queues."""
    register = _banked(tmp_path, ("A-report.md", "F1 one\n\nF2 two\n"))
    before = register.read_bytes()
    done = _run("ledger", "route", str(register), "owner-pass", "A-F1")
    assert done.returncode == 2 and "owner-pass is no owner" in done.stderr and "owner-browser-pass, ending" in done.stderr
    assert register.read_bytes() == before
    assert _run("ledger", "route", str(register), "owner-browser-pass", "A-F1").returncode == 0


# A fixer's report: its acceptance table names the audit's findings by their bare labels, ahead of its own.
FIXER_REPORT: Final = (
    "## (c) Acceptance\n\n| Item | Evidence |\n| --- | --- |\n| F1 | `tsc` 0, the plant red |\n| F2 | the case drives it |\n\n"
    "## (e) What was wrong\n\nF1 — correction for the commit body.\nIt names the wrong file.\n\n### F3 The tail\n\nNot shown.\n"
)


def test_a_number_a_table_row_and_a_prose_line_both_label_banks_the_prose() -> None:
    """S9-AUTH-r6's F1 to F9 were banked from its acceptance table, and its real findings never reached the ledger.

    A number only that table labels, above the report's own F1, banks nothing until it is cited or named.
    """
    with pytest.raises(ValueError, match=r"^F2 is labelled only above the report's own F1 \(line 10\), on 6: --line banks it, --cited F2"):
        ledger.bankable(FIXER_REPORT)
    cited = ledger.bankable(FIXER_REPORT, cited=[2])
    assert {n: label.summary for n, label in cited.chosen.items()} == {1: "correction for the commit body.", 3: "The tail"}
    assert cited.said == [] and ledger.bankable(FIXER_REPORT, settled={2: 6}).chosen[2].summary == "the case drives it"


# A cold audit's shape: an index naming each finding, the findings in prose, and a ranked table closing it.
INDEXED_REPORT: Final = (
    "# Audit\n\n- **F1.** `ci.py expect` records a placeholder.\n- **F2** — no lock.\n\n## Findings\n\n"
    "**F1. `ci.py expect` writes a job's placeholder as an expected red.**\n\n**Evidence.** The job's later failures read as expected.\n\n"
    "**F2. Register writes have no lock.**\n\n**Evidence.** Two writers overlap.\n\n"
    "## Outside my scope\n\n**F3** — a dash before the summary.\n\n"
    "| finding | repair |\n| --- | --- |\n| F1 | skip generic lines |\n| F2 | a lock |\n| F3 | strip the dash |\n"
)


def test_a_number_an_index_list_repeats_is_refused_until_its_line_is_named() -> None:
    """An index item listed first was banked as the finding, and the longest paragraph that replaced it picked evidence lines.

    A closing ranked table repeats every finding by design and refuses nothing.
    """
    with pytest.raises(ValueError) as refused:
        ledger.bankable(INDEXED_REPORT)
    said = str(refused.value).splitlines()
    assert [line.split(" “")[0] for line in said] == ["F1 is labelled on prose lines 3", "F2 is labelled on prose lines 4"], said
    assert ", 8 “" in said[0] and ", 12 “Register writes have no lock.”: --line F2=<line> names the finding" in said[1]
    named = ledger.bankable(INDEXED_REPORT, settled={1: 8, 2: 12})
    assert {n: label.line + 1 for n, label in named.chosen.items()} == {1: 8, 2: 12, 3: 18} and named.said == []
    held = ledger._cell("Register writes have no lock.")
    assert ledger.paragraph(INDEXED_REPORT, 2, held) == "**F2. Register writes have no lock.**\n\n**Evidence.** Two writers overlap."
    with pytest.raises(ValueError, match="F2 is labelled on prose lines 4"):
        ledger.paragraph(INDEXED_REPORT, 2)
    cold = INDEXED_REPORT.split("## Findings\n\n", 1)[1]
    assert sorted(ledger.bankable(cold).chosen) == [1, 2, 3] and ledger.bankable(cold).said == []


# SKILL-FIX-TOOLS-2's report, its labels kept and its prose cut: its acceptance section labels the audit's
# findings bare, F23 among them, and its own findings follow from F1.
CITING_REPORT: Final = (
    "## (c) Acceptance\n\n**Item 1: the audit's F1 to F3.**\n\n"
    "- **F1 (`expect` and generic lines).** `expect` no longer writes a row for a job's verdict-only line.\n"
    "- **F2 (one writer at a time).** `ledger.update` holds a lock file across the read and the replace.\n"
    "  - Plants: `F2-lock`, red 2 of 2 times.\n"
    "- **F3 (prune keeps a working agent).** A finished agent keeps its tree in four cases.\n"
    "- F23: a failure after the record is reported beside it (`F23-oserror`).\n\n"
    "## (d) What I could not verify\n\n"
    "- **F1.** I did not run `prune` or `overlap` against the real worktrees.\n"
    "- **F2.** That bash ignores `-n` in an interactive shell is not established by a run.\n\n"
    "## (e) What in the brief was wrong\n\n- **F3.** The repair for audit F5 would refuse 872 real final reports.\n"
)


def test_a_report_labelling_a_number_twice_or_citing_one_bare_banks_nothing_until_each_is_named(tmp_path: Path) -> None:
    """Its F1 to F3 were banked from bullets citing the audit, and its bare F23 became a row for a finding it never made."""
    register = _register(tmp_path)
    report = tmp_path / "SKILL-FIX-TOOLS-2-report.md"
    report.write_bytes(CITING_REPORT.encode())
    before = register.read_bytes()
    first = _run("ledger", "bank", str(register), str(report))
    assert first.returncode == 2 and register.read_bytes() == before and first.stdout == "", first.stderr
    assert [line.split(" “")[0] for line in first.stderr.splitlines()] == [
        f"F{n} is labelled on prose lines {k}" for n, k in ((1, 5), (2, 6), (3, 8))
    ]
    assert ", 13 “I did not run" in first.stderr and ", 14 “That bash" in first.stderr and ", 18 “The repair" in first.stderr
    wrong = _run("ledger", "bank", str(register), str(report), "--line", "F1=6")
    assert wrong.returncode == 2 and "--line F1=6: line 6 labels no F1" in wrong.stderr, wrong.stderr
    named = _run("ledger", "bank", str(register), str(report), "--line", "F1=13,F2=14", "--line", "F3=18")
    assert named.returncode == 2 and register.read_bytes() == before
    assert named.stderr.strip() == "F23 is labelled only above the report's own F1 (line 13), on 9: --line banks it, --cited F23 banks no row"
    done = _run("ledger", "bank", str(register), str(report), "--line", "F1=13,F2=14", "--line", "F3=18", "--cited", "F23")
    assert done.returncode == 4, done.stderr
    assert [ledger.cells(row)[2] for row in done.stdout.splitlines()] == [
        "I did not run `prune` or `overlap` against the real worktrees.",
        "That bash ignores `-n` in an interactive shell is not established by a run.",
        "The repair for audit F5 would refuse 872 real final reports.",
    ]


def test_show_prints_a_rows_whole_finding_from_its_saved_report(tmp_path: Path) -> None:
    """Over half the ledger's rows end cut at 160 characters, and a driver barred from the report worked from the half."""
    reports = tmp_path / "reports"
    reports.mkdir()
    register = _register(tmp_path)
    (reports / "A-report.md").write_bytes(FIXER_REPORT.encode())
    ledger.bank(register, reports / "A-report.md", settled={2: 6})
    head = register.read_bytes().replace(b"# Agent register\n", f"# Agent register\nReports: {reports}\n".encode(), 1)
    register.write_bytes(head)
    done = _run("ledger", "show", str(register), "A-F1", "A-F2", "A-F9")
    assert done.returncode == 2 and "A-F9 is no ledger row" in done.stderr
    shown = done.stdout.replace("\r\n", "\n").split("\n\n")
    assert shown[0].splitlines()[1:] == ["F1 — correction for the commit body.", "It names the wrong file."]
    assert shown[1].splitlines()[1:] == ["| F2 | the case drives it |"]
    # A row banked from the table before prose won prints the line it holds, not the prose beside it.
    register.write_bytes(register.read_bytes().replace(b"| correction for the commit body. |", b"| `tsc` 0, the plant red |"))
    assert _run("ledger", "show", str(register), "A-F1").stdout.splitlines()[1:] == ["| F1 | `tsc` 0, the plant red |"]


def test_open_names_a_running_agent_whose_report_was_saved_after_its_stamp(tmp_path: Path) -> None:
    """The live-agent table read 108 finished agents RUNNING; an agent resumed after its first report is RUNNING again rightly."""
    briefs, reports = tmp_path / "briefs", tmp_path / "reports"
    briefs.mkdir()
    reports.mkdir()
    register = _register(tmp_path, live=LIVE.replace("| FIXER | a fix |  | RUNNING |", "| FIXER | a fix |  | RUNNING (2020-01-01 10:00) |"))
    register.write_bytes(register.read_bytes().replace(b"# Agent register\n", f"# Agent register\nBriefs: {briefs}\n".encode(), 1))
    (reports / "FIXER-report.md").write_bytes(b"F1 x\n")
    (reports / "FIXER-1-r2-report.md").write_bytes(b"F1 x\n")
    os.utime(reports / "FIXER-1-r2-report.md", (0, 0))
    done = _run("ledger", "open", str(register))
    assert done.returncode == 0 and done.stdout == ""
    flagged = [line for line in done.stderr.splitlines() if "set its Status DONE" in line]
    assert len(flagged) == 2 and flagged[0].startswith("FIXER is `RUNNING (2020-01-01 10:00)` while FIXER-report.md was saved")
    assert flagged[1].startswith("FIXER-1 is `RUNNING` while FIXER-1-r2-report.md")
    # Saved in its stamp's own minute, a report is the round before the resume that wrote the stamp.
    for saved, flags in ((datetime.datetime(2020, 1, 1, 10, 0, 59), False), (datetime.datetime(2020, 1, 1, 10, 1), True), (None, False)):
        when = saved.timestamp() if saved else 0
        os.utime(reports / "FIXER-report.md", (when, when))
        assert any(line.startswith("FIXER is") for line in _run("ledger", "open", str(register)).stderr.splitlines()) is flags, saved
    # Read after the rows print, an undatable stamp once turned the exit the ending loops on into a refusal.
    register.write_bytes(register.read_bytes().replace(b"RUNNING (2020-01-01 10:00)", b"RUNNING (2020-13-45 10:00)"))
    undated = _run("ledger", "open", str(register))
    assert undated.returncode == 0 and "FIXER's stamp `2020-13-45 10:00` is no date" in undated.stderr, undated.stderr


# --- reg dispatch and message ---------------------------------------------------------------------


def _fleet(tmp_path: Path, messages_file: bool = True, briefs_line: bool = True) -> tuple[Path, Path, Path]:
    """A plans directory holding the sending session's register, its briefs folder and one agent's messages file."""
    briefs = tmp_path / "plans" / "prog" / "scratch" / "briefs"
    briefs.mkdir(parents=True)
    register = _banked(tmp_path, ("A-report.md", "F1 one\n\nF2 two\n"))
    head = f"# Agent register\n\nCoordinator session id: sess-1\n{f'Briefs: {briefs}' if briefs_line else ''}\n"
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
    # Each tool names its own way to move the row: `--reroute` is a flag of `ledger.py route` alone.
    assert said is not None and "routed to OTHER already" in said and "a `Reroute: OTHER: A-F1` line" in said and "--reroute" not in said
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


def test_the_messages_hook_says_a_lock_it_cannot_take_inside_its_timeout(tmp_path: Path) -> None:
    """The hook waited on a held lock as long as its own timeout, so the harness killed it and the coordinator heard nothing.

    The record's whole wait is held to at most half the timeout `.claude/settings.json` gives the hook.
    """
    settings = json.loads((REPO_ROOT / ".claude" / "settings.json").read_bytes())
    hooks = [hook for entry in settings["hooks"]["PostToolUse"] for hook in entry["hooks"] if "orchestration-messages.sh" in hook["command"]]
    assert len(hooks) == 1 and 2 * reg.HOOK_SECONDS <= hooks[0]["timeout"], hooks
    plans, _, messages = _fleet(tmp_path)
    (messages.parent / f"{messages.name}.lock").write_bytes(str(os.getpid()).encode())
    before = messages.read_bytes()
    started = time.monotonic()
    done = subprocess.run(
        (sys.executable, str(TOOLS / "reg.py"), "message", str(plans)),
        input=json.dumps(_sent("WORKER", "x")).encode(),
        capture_output=True,
        check=False,
        timeout=hooks[0]["timeout"],
    )
    took = time.monotonic() - started
    said = json.loads(done.stdout)["hookSpecificOutput"]["additionalContext"]
    assert done.returncode == 0 and took < hooks[0]["timeout"] and messages.read_bytes() == before, (took, done.stderr)
    assert f"names process {os.getpid()}, still running" in said and "in no messages file" in said, said


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


def test_a_sent_rows_line_routes_each_row_it_can_and_names_each_it_cannot(tmp_path: Path) -> None:
    """One refused row in a `Rows:` line once dropped the eight beside it, the route being all or none."""
    plans, register, _ = _fleet(tmp_path)
    ledger.route(register, "OTHER", ["A-F2"])
    said = reg.record(_sent("WORKER", "Fix them.\nRows: A-F1, A-F2, A-F9."), plans)
    assert said is not None and "A-F2 is routed to OTHER already" in said and "A-F9 is no ledger row" in said
    assert _status(register, "A-F1") == ["ROUTED", "WORKER"] and _status(register, "A-F2") == ["ROUTED", "OTHER"]


def test_a_sent_reroute_line_moves_rows_only_from_the_owner_it_names(tmp_path: Path) -> None:
    plans, register, _ = _fleet(tmp_path)
    ledger.route(register, "OTHER", ["A-F1", "A-F2"])
    said = reg.record(_sent("WORKER", "Take these.\nReroute: OTHER: A-F1\nReroute: FIXER: A-F2"), plans)
    assert said is not None and "A-F2 is `ROUTED` to OTHER, not routed to FIXER" in said
    assert _status(register, "A-F1") == ["ROUTED", "WORKER"] and _status(register, "A-F2") == ["ROUTED", "OTHER"]


def _brief(tmp_path: Path, name: str, rows: str) -> Path:
    brief = tmp_path / "plans" / "prog" / "scratch" / "briefs" / f"{name}.md"
    brief.write_bytes(f"THE WORK.       1. Build it.\n                {rows}\n\nTRAPS.          none\n".encode())
    return brief


def test_dispatch_routes_its_briefs_rows_one_by_one_and_takes_a_queues_rows(tmp_path: Path) -> None:
    """A brief is a file and its dispatch no SendMessage, so the rows a brief named reached no hook and stayed OPEN."""
    _, register, _ = _fleet(tmp_path)
    ledger.route(register, "OTHER", ["A-F2"])
    brief = _brief(tmp_path, "NEWBIE", "Rows: A-F1, A-F2.")
    done = _run("reg", "dispatch", str(register), "NEWBIE", "--brief", str(brief))
    assert done.returncode == 0 and "ROUTED A-F1 to NEWBIE" in done.stdout, done.stderr
    assert "not routed: A-F2 is routed to OTHER already" in done.stderr
    assert "`--takes OTHER` moves every row OTHER holds" in done.stderr and "--reroute" not in done.stderr
    assert _status(register, "A-F1") == ["ROUTED", "NEWBIE"] and _status(register, "A-F2") == ["ROUTED", "OTHER"]
    ledger.route(register, "owner", ["A-F1"], reroute=True)
    # The brief names a row the queue holds: `--takes` moves it, and nothing says it was not routed.
    brief = _brief(tmp_path, "LATER", "Rows: A-F1.")
    taken = _run("reg", "dispatch", str(register), "LATER", "--brief", str(brief), "--takes", "owner")
    assert taken.returncode == 0 and taken.stderr == "" and taken.stdout.count("ROUTED A-F1 to LATER") == 1, (taken.stdout, taken.stderr)
    assert _status(register, "A-F1") == ["ROUTED", "LATER"]


def test_dispatch_never_takes_a_running_agents_rows(tmp_path: Path) -> None:
    _, register, _ = _fleet(tmp_path)
    ledger.route(register, "OTHER", ["A-F2"])
    before = register.read_bytes()
    done = _run("reg", "dispatch", str(register), "NEWBIE", "--takes", "OTHER")
    assert done.returncode == 2 and "OTHER is a RUNNING agent" in done.stderr and register.read_bytes() == before


def test_dispatch_with_an_id_sets_a_finished_agents_row_running_again(tmp_path: Path) -> None:
    """A resumed agent left DONE reads as finished to the gauge and to the resume protocol."""
    _, register, _ = _fleet(tmp_path)
    register.write_bytes(
        register.read_bytes().replace(b"| the work | x | RUNNING |", b"| the work | x | DONE 2026-10-16 10:00 WORKER-report.md |")
    )
    now = datetime.datetime(2026, 10, 16, 11, 5, tzinfo=datetime.UTC)
    said, _ = reg.dispatch(register, "WORKER", "a1b2c3", now=now)
    assert "set WORKER's live-agent row RUNNING again: a resume" in said
    assert "| WORKER `a1b2c3` (implementer) | the work | x | RUNNING (2026-10-16 11:05) |" in register.read_bytes().decode()


@pytest.mark.parametrize("name", ["NEWBIE", "OTHER"], ids=["a new row", "another agent's row"])
def test_dispatch_refuses_an_id_another_live_row_names(tmp_path: Path, name: str) -> None:
    """Two rows naming one id left every later write to either row refused, and a send by that id in no messages file."""
    _, register, _ = _fleet(tmp_path)
    briefs = tmp_path / "plans" / "prog" / "scratch" / "briefs"
    before = register.read_bytes()
    done = _run("reg", "dispatch", str(register), name, "--id", "a1b2c3")
    assert done.returncode == 2 and "`a1b2c3` is named by WORKER's live-agent row already" in done.stderr, done.stderr
    assert register.read_bytes() == before and not (briefs / f"{name}-messages.md").exists()
    assert _run("reg", "dispatch", str(register), "WORKER", "--id", "a1b2c3").returncode == 0


def test_a_queued_standing_action_is_ticked_by_the_dispatch_of_its_brief(tmp_path: Path) -> None:
    """Standing actions lived in UPDATE text, where nothing read them, and the four rows of the table stayed `no`."""
    _, register, _ = _fleet(tmp_path)
    register.write_bytes(register.read_bytes().replace(b"## Findings ledger", (STANDING + "## Findings ledger").encode()))
    brief = _brief(tmp_path, "NEWBIE", "")
    assert _run("reg", "queue", str(register), "window", str(brief)).stdout.startswith("queued NEWBIE.md for window")
    assert reg.windows(register.read_bytes().decode()) == [f"`{brief.resolve()}`"]
    assert _run("reg", "dispatch", str(register), "NEWBIE").returncode == 0
    assert reg.windows(register.read_bytes().decode()) == []
    assert re.search(
        rf"\| window \| `{re.escape(str(brief.resolve()))}` \| yes \d{{4}}-\d\d-\d\d \d\d:\d\d \(`reg.py dispatch NEWBIE`\) \|",
        register.read_bytes().decode(),
    )


def test_live_lists_the_running_rows_and_their_count(tmp_path: Path) -> None:
    register = _register(tmp_path, live=LIVE.replace("| FIXER-2 | a fix |  | RUNNING |", "| FIXER-2 | a fix |  | DONE 2026-10-16 x |"))
    done = _run("reg", "live", str(register))
    assert done.returncode == 0 and done.stdout.splitlines()[-1] == "4 RUNNING" and "FIXER-2" not in done.stdout


def _live_status(register: Path, name: str) -> str:
    return next(ledger.cells(line)[-1] for line in register.read_bytes().decode().splitlines() if ledger.row_name(line) == name)


def test_a_paused_agent_is_counted_apart_and_a_message_resumes_it(tmp_path: Path) -> None:
    """An agent paused under /pace read RUNNING, so the gauge counted it and the width it bounds was wrong."""
    plans, register, _ = _fleet(tmp_path)
    assert _run("reg", "pause", str(register), "WORKER").returncode == 0
    assert re.fullmatch(r"PAUSED \d{4}-\d\d-\d\d \d\d:\d\d", _live_status(register, "WORKER"))
    said = _run("reg", "live", str(register)).stdout.splitlines()
    assert said[-1] == "4 RUNNING" and "1 PAUSED, outside the gauge:" in said and not any(line.startswith("WORKER") for line in said)
    before = register.read_bytes()
    again = _run("reg", "pause", str(register), "OTHER", "WORKER")
    assert again.returncode == 2 and "WORKER is no single RUNNING live-agent row: it reads `PAUSED" in again.stderr
    assert register.read_bytes() == before
    assert reg.record(_sent("WORKER", "carry on"), plans) is None
    assert _live_status(register, "WORKER").startswith("RUNNING (")


def test_a_message_to_a_finished_agent_sets_its_row_running(tmp_path: Path) -> None:
    """A finished agent resumed by a message stayed DONE, so the gauge and the pacing count missed it."""
    plans, register, _ = _fleet(tmp_path)
    register.write_bytes(register.read_bytes().replace(b"| the work | x | RUNNING |", b"| the work | x | DONE 2026-10-16 10:00 W.md |"))
    now = datetime.datetime(2026, 10, 16, 15, 1, tzinfo=datetime.UTC)
    assert reg.record(_sent("a1b2c3", "a new round"), plans, now) is None
    assert _live_status(register, "WORKER") == "RUNNING (2026-10-16 15:01)"
    assert _live_status(register, "OTHER") == "RUNNING"


@pytest.mark.parametrize(
    ("module", "name", "said"),
    [
        ("ledger", "route_each", "these rows were not routed to it: the register is locked"),
        ("reg", "_wake", "its live-agent row was not set RUNNING (OSError: the register is locked)."),
    ],
    ids=["the route", "the wake"],
)
def test_a_register_write_failing_after_the_record_says_the_message_is_recorded(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, module: str, name: str, said: str
) -> None:
    """The hook said a message was in no messages file after writing it there, and the coordinator sent it twice."""
    plans, _, messages = _fleet(tmp_path)

    def locked(*_: object, **__: object) -> None:
        raise OSError("the register is locked")

    monkeypatch.setattr({"ledger": ledger, "reg": reg}[module], name, locked)
    told = reg.record(_sent("WORKER", "Fix it.\nRows: A-F1"), plans)
    assert told is not None and told.startswith(f"The message to WORKER is recorded; {said}"), told
    assert "Fix it." in messages.read_bytes().decode("utf-8")


def test_a_message_to_an_agent_no_row_names_is_recorded_and_its_rows_refused(tmp_path: Path) -> None:
    plans, register, _ = _fleet(tmp_path)
    (tmp_path / "plans" / "prog" / "scratch" / "briefs" / "PEER-messages.md").write_bytes(b"# PEER\n")
    said = reg.record(_sent("PEER", "Fix it.\nRows: A-F1"), plans)
    assert said is not None and said.startswith("The message to PEER is recorded;") and "PEER is no owner" in said
    assert _status(register, "A-F1") == ["OPEN", ""]


def test_dispatch_takes_a_finished_agents_rows_and_never_a_paused_ones(tmp_path: Path) -> None:
    _, register, _ = _fleet(tmp_path)
    ledger.route(register, "FIXER-2", ["A-F1"])
    ledger.route(register, "FIXER-1", ["A-F2"])
    register.write_bytes(register.read_bytes().replace(b"| FIXER-2 | a fix |  | RUNNING |", b"| FIXER-2 | a fix |  | DONE 2026-10-16 x |"))
    assert _run("reg", "pause", str(register), "FIXER-1").returncode == 0
    taken = _run("reg", "dispatch", str(register), "NEWBIE", "--takes", "FIXER-2")
    assert taken.returncode == 0 and _status(register, "A-F1") == ["ROUTED", "NEWBIE"], taken.stderr
    paused = _run("reg", "dispatch", str(register), "LATER", "--takes", "FIXER-1")
    assert paused.returncode == 2 and "FIXER-1 is a PAUSED agent" in paused.stderr


def test_context_reads_the_last_calls_context_and_counts_the_calls(tmp_path: Path) -> None:
    """Agents resumed for a new round at 950,000 tokens of context cost a fresh agent's quota many times over."""
    env = _home(tmp_path)
    folder = tmp_path / "home" / ".claude" / "projects" / "proj" / "session" / "subagents"
    folder.mkdir(parents=True)
    usage = {"input_tokens": 2, "cache_creation_input_tokens": 1040, "cache_read_input_tokens": 873091}
    lines = [{"message": {"id": "m1", "role": "assistant", "model": "claude", "usage": {"input_tokens": 9}, "content": []}}]
    # One call reaches the transcript as a line per content block, each carrying its usage.
    lines += [{"message": {"id": "m2", "role": "assistant", "model": "claude", "usage": usage, "content": []}}] * 2
    (folder / "agent-a1b2c3.jsonl").write_bytes("\n".join(map(json.dumps, lines)).encode())
    _synthetic(tmp_path / "home", "a1b2c3")
    done = _run("reg", "context", str(_register(tmp_path)), "a1b2c3", "f00d", env=env)
    assert done.returncode == 2 and "0 transcripts" in done.stderr
    assert done.stdout.strip() == "WORKER `a1b2c3`: 874,133 tokens at its last call, 2 calls"


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
    reading = ci.report(log.decode("utf-8"), red)
    return reading.said, [text for _, text in reading.new], reading.flagged


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
    assert "NEW       against a budget of  (2 line(s), more than its 1)" in said
    assert "            verify: `backend` took 81 s against a budget of 70 s" in said
    assert "RED       refusalCoverage  (no line matched, and its job is not recorded: it stays RED)" in said


def test_ci_prints_every_new_line_last_and_the_count_after_them() -> None:
    """A `tail -8` of a read printing NEW lines first showed two of its four, and none where the expected blocks ran long."""
    said, _, _ = _report(FAILED_RUN)
    first_new = next(k for k, line in enumerate(said) if line.startswith("NEW"))
    assert all(line.startswith(("NEW", " ")) for line in said[first_new:-1]), said
    assert said[-1] == "7 NEW, 3 expected"
    assert "            docs: a row in `## 2. Invariants` is neither an invariant nor a header: '| I_NEW_A_1 | x' (OUT-4)" not in said
    verbose = ci.report(FAILED_RUN.decode("utf-8"), EXPECTED_RED, verbose=True).said
    assert "            docs: a row in `## 2. Invariants` is neither an invariant nor a header: '| I_NEW_A_1 | x' (OUT-4)" in verbose


def test_a_red_row_whose_recorded_job_passed_is_cleared_and_one_with_no_job_stays() -> None:
    """A row its job's passing had cleared stayed RED until someone wrote CLEARED by hand, a job the row never named."""
    red = EXPECTED_RED.replace("| `refusalCoverage` | | mapper |", "| `refusalCoverage` | | `frontend` job: NEW in run 1 |")
    reading = ci.report(FAILED_RUN.decode("utf-8"), red, passed=frozenset({"frontend"}))
    assert [row.matches for row in reading.cleared] == ["refusalCoverage"]
    assert "CLEARED   refusalCoverage  (its job `frontend` passed)" in reading.said
    assert ci.report(FAILED_RUN.decode("utf-8"), red, passed=frozenset({"docs"})).cleared == []


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


# Answers `run list` from `list-<n>.json`, the nth call's file or the last one, `run view --log-failed`
# from `log.txt` and any other view from `run.json`, recording every call; call n exits with code n
# of `exits.txt`, else `exit.txt`'s.
GH: Final = (
    "import sys\nfrom pathlib import Path\nhere = Path(__file__).parent\nargs = sys.argv[1:]\ncalls = here / 'calls.txt'\n"
    "calls.write_bytes((calls.read_bytes() if calls.exists() else b'') + ' '.join(args).encode() + b'\\n')\n"
    "if args[:2] == ['run', 'list']:\n"
    "    answers = sorted(here.glob('list-*.json'))\n"
    "    sys.stdout.write(answers[min(calls.read_bytes().count(b'run list'), len(answers)) - 1].read_text(encoding='utf-8'))\n"
    "elif '--log-failed' in args:\n    sys.stdout.buffer.write((here / 'log.txt').read_bytes())\n"
    "else:\n    sys.stdout.write((here / 'run.json').read_text(encoding='utf-8'))\n"
    "codes = (here / 'exits.txt').read_text(encoding='utf-8').split() if (here / 'exits.txt').exists() else []\n"
    "n = calls.read_bytes().count(b'\\n')\n"
    "sys.exit(int(codes[n - 1] if n <= len(codes) else (here / 'exit.txt').read_text(encoding='utf-8')))\n"
)


def _pushed(tmp_path: Path) -> tuple[Path, str]:
    """A checkout whose upstream is the pushed commit, and whose HEAD a landing made since has moved past it."""
    root = tmp_path / "repo"
    root.mkdir()
    configure(root, (tmp_path / "hooks").as_posix())
    write(root, "notes.txt", "first\n")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "Repo: The session branch")
    git(root, "remote", "add", "origin", "https://example.invalid/repo.git")
    git(root, "update-ref", "refs/remotes/origin/main", "HEAD")
    git(root, "branch", "-q", "--set-upstream-to", "origin/main")
    pushed = git(root, "rev-parse", "HEAD")
    _session_commit(root, "Repo: A landing during the run", {"notes.txt": "second\n"})
    return root, pushed


def _gh(
    tmp_path: Path, run: Mapping[str, object], log: bytes = b"", code: int = 0, lists: tuple[object, ...] = (), exits: tuple[int, ...] = ()
) -> dict[str, str]:
    env = _stub(tmp_path, "gh", GH)
    (tmp_path / "bin" / "run.json").write_bytes(json.dumps(run).encode())
    (tmp_path / "bin" / "log.txt").write_bytes(log)
    (tmp_path / "bin" / "exit.txt").write_bytes(str(code).encode())
    (tmp_path / "bin" / "exits.txt").write_bytes(" ".join(map(str, exits)).encode())
    for k, answer in enumerate(lists, 1):
        (tmp_path / "bin" / f"list-{k}.json").write_bytes(json.dumps(answer).encode())
    return {**env, "PYTHONIOENCODING": "cp1252"}


@pytest.mark.parametrize(
    ("status", "conclusion", "log", "code", "exit_code", "said"),
    [
        ("in_progress", "", FAILED_RUN, 0, 2, "not concluded"),
        ("completed", "failure", FAILED_RUN, 1, 2, "exited 1"),
        ("completed", "failure", b"", 0, 2, "no job line"),
        ("completed", "failure", FAILED_RUN, 0, 1, "7 NEW, 3 expected"),
        ("completed", "success", b"", 0, 0, "5 RED row(s) CLEARED"),
    ],
    ids=["a run still going", "gh failing", "an empty log", "a failed run", "a run that passed"],
)
def test_ci_reads_a_run_through_gh_only_once_it_concluded(
    tmp_path: Path, status: str, conclusion: str, log: bytes, code: int, exit_code: int, said: str
) -> None:
    """A pipe from gh hid gh's own failure behind ci.py's exit, and nothing checked the run had concluded."""
    root, sha = _pushed(tmp_path)
    env = _gh(tmp_path, {"status": status, "conclusion": conclusion, "workflowName": "verify", "headSha": sha}, log, code)
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes(EXPECTED_RED.encode("utf-8"))
    done = _run("ci", str(register), "123", cwd=root, env=env)
    assert done.returncode == exit_code, (done.stdout, done.stderr)
    assert said in done.stdout + done.stderr and "Traceback" not in done.stderr


@pytest.mark.parametrize(
    ("workflow", "head", "said"),
    [("pr-body", True, "is pr-body's for"), ("verify", False, "is verify's for 000000000")],
    ids=["workflow", "commit"],
)
def test_ci_refuses_a_run_of_another_workflow_or_another_commit(tmp_path: Path, workflow: str, head: bool, said: str) -> None:
    """The coordinator handed it the pr-body run, "the newest on the branch", and the read judged a run that tests nothing."""
    root, sha = _pushed(tmp_path)
    env = _gh(tmp_path, {"status": "completed", "conclusion": "success", "workflowName": workflow, "headSha": sha if head else "0" * 40})
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes(EXPECTED_RED.encode("utf-8"))
    before = register.read_bytes()
    done = _run("ci", str(register), "123", cwd=root, env=env)
    assert done.returncode == 2 and said in done.stderr, done.stderr
    assert register.read_bytes() == before


def test_ci_head_waits_for_the_pushed_commits_verify_run_to_exist_and_conclude(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A watch started before its run existed read nothing, so every push's watch began with `sleep 5` and a grep of the log."""
    root, sha = _pushed(tmp_path)
    run = {"status": "completed", "conclusion": "failure", "workflowName": "verify", "headSha": sha}
    lists = ([], [{"databaseId": 77, "status": "in_progress"}], [{"databaseId": 77, "status": "completed"}])
    env = _gh(tmp_path, run, FAILED_RUN, lists=lists)
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes(EXPECTED_RED.encode("utf-8"))
    monkeypatch.setenv("PATH", env["PATH"])
    monkeypatch.setattr(ci, "POLL_SECONDS", 0)
    monkeypatch.chdir(root)
    assert ci.main([str(register), "--head", "--wait"]) == 1
    calls = (tmp_path / "bin" / "calls.txt").read_bytes().decode().splitlines()
    assert calls[:3] == [f"run list --workflow verify --commit {sha} --limit 1 --json databaseId,status,conclusion"] * 3
    assert calls[3].startswith("run view 77 --json") and capsys.readouterr().out.startswith(f"run 77 for {sha[:9]}")
    (tmp_path / "bin" / "list-2.json").unlink()
    (tmp_path / "bin" / "list-3.json").unlink()
    (tmp_path / "bin" / "calls.txt").unlink()
    assert ci.main([str(register), "--head", "--wait", "--timeout", "0"]) == 2
    assert f"no verify run started for {sha[:9]} within 0 s" in capsys.readouterr().err


def test_a_read_writes_cleared_on_each_red_row_its_run_passed(tmp_path: Path) -> None:
    """The register's rows were turned CLEARED by hand, one of them from a detail line no read ever matched."""
    root, sha = _pushed(tmp_path)
    jobs = [{"name": "frontend", "conclusion": "success"}, {"name": "docs", "conclusion": "failure"}]
    run = {"status": "completed", "conclusion": "failure", "workflowName": "verify", "headSha": sha, "jobs": jobs}
    env = _gh(tmp_path, run, _log(("docs", "##[error]`db` took 155 s against a budget of 135 s")))
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes(EXPECTED_RED.replace("| `refusalCoverage` | | mapper |", "| `refusalCoverage` | | `frontend` job: x |").encode())
    done = _run("ci", str(register), "123", cwd=root, env=env)
    assert done.returncode == 0, (done.stdout, done.stderr)
    statuses = {cells[0]: cells[-1] for line in register.read_bytes().decode().splitlines() if len(cells := ledger.cells(line)) == 6}
    assert statuses["`refusalCoverage`"] == f"CLEARED {sha[:9]} (run 123: `frontend` passed)"
    assert statuses["`compaction hook:`"] == statuses["`against a budget of`"] == "RED"
    run.update(conclusion="success")
    done = _run("ci", str(register), "123", cwd=root, env=_gh(tmp_path, run))
    statuses = {cells[0]: cells[-1] for line in register.read_bytes().decode().splitlines() if len(cells := ledger.cells(line)) == 6}
    assert done.returncode == 0 and statuses["`compaction hook:`"] == f"CLEARED {sha[:9]} (run 123: every job passed)"


def test_expect_writes_a_red_row_per_new_line_that_the_next_read_expects(tmp_path: Path) -> None:
    """Rows were written by heredoc scripts, one matching a detail line the read never takes, so the next run read NEW again."""
    root, sha = _pushed(tmp_path)
    log = _log(("frontend-units (1)", "##[error]`db` | a pipe took 155 s"), ("docs", "##[error]`is neither an invariant nor a header` here"))
    env = _gh(tmp_path, {"status": "completed", "conclusion": "failure", "workflowName": "verify", "headSha": sha}, log)
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes(EXPECTED_RED.encode("utf-8"))
    done = _run("ci", "expect", str(register), "123", "--cleared-by", "S9's fix", cwd=root, env=env)
    assert done.returncode == 0, done.stderr
    assert done.stdout.splitlines() == [
        f"| ``db` \\| a pipe took 155 s` | 1 | `frontend-units (1)` job: NEW in run 123 | S9's fix | {sha[:9]} | RED |"
    ]
    assert not ci.report(log.decode(), register.read_bytes().decode()).flagged


def test_ci_refuses_a_register_with_no_expected_red_table(tmp_path: Path) -> None:
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes(b"# Agent register\n")
    done = _run("ci", str(register), "123")
    assert done.returncode == 2 and "Expected red" in done.stderr


def _failed(sha: str, **extra: object) -> dict[str, object]:
    return {"status": "completed", "conclusion": "failure", "workflowName": "verify", "headSha": sha, **extra}


def test_expect_writes_no_row_for_a_jobs_summary_and_a_relay_is_no_finding(tmp_path: Path) -> None:
    """A row matching a job's placeholder expected every later failure of that job, so the read could not fail."""
    root, sha = _pushed(tmp_path)
    log = _log(
        ("images", "##[error]Process completed with exit code 1."), ("verify", "##[error]A scope job failed -- its own log has the findings.")
    )
    env = _gh(tmp_path, _failed(sha), log)
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes(EXPECTED_RED.encode("utf-8"))
    before = register.read_bytes()
    done = _run("ci", "expect", str(register), "123", "--cleared-by", "a fix", cwd=root, env=env)
    assert done.returncode == 0 and done.stdout == "", (done.stdout, done.stderr)
    assert "not written: `images: no finding line recognised; read its log` is `images`'s summary" in done.stderr
    assert register.read_bytes() == before
    read = _run("ci", str(register), "123", cwd=root, env=env)
    assert read.returncode == 1 and "NEW       images: images: no finding line recognised" in read.stdout, read.stdout
    # The summary job's pointer is relayed from the scope jobs, unless no scope job's line is there.
    assert "relay     verify: a scope job failed" in read.stdout and "NEW       verify" not in read.stdout
    alone = ci.report(_log(("verify", "##[error]A scope job failed -- its own log has the findings.")).decode(), EXPECTED_RED)
    assert alone.new == [("verify", "verify: no finding line recognised; read its log")], alone.said


def test_expect_keeps_a_lines_spacing_so_the_next_read_matches_it(tmp_path: Path) -> None:
    """Spaces were collapsed in the row's literal, so the line it was written for read NEW again."""
    root, sha = _pushed(tmp_path)
    log = _log(("docs", "##[error]two  spaces\tand a tab"))
    env = _gh(tmp_path, _failed(sha), log)
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes(EXPECTED_RED.encode("utf-8"))
    assert _run("ci", "expect", str(register), "123", "--cleared-by", "a fix", cwd=root, env=env).returncode == 0
    assert not ci.report(log.decode(), register.read_bytes().decode()).flagged


def test_a_passing_job_clears_its_own_row_and_not_another_jobs_holding_its_literal(tmp_path: Path) -> None:
    root, sha = _pushed(tmp_path)
    red = EXPECTED_RED.replace(
        "| `refusalCoverage` | | mapper | a lane | y | RED |",
        "| `shared` | | `a` job: x | l | y | RED |\n| `shared` | | `b` job: y | l | y | RED |",
    )
    run = _failed(sha, jobs=[{"name": "a", "conclusion": "success"}, {"name": "b", "conclusion": "failure"}])
    env = _gh(tmp_path, run, _log(("b", "##[error]`db` took 155 s against a budget of 135 s")))
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes(red.encode())
    assert _run("ci", str(register), "123", cwd=root, env=env).returncode == 0
    statuses = [cells[-1] for line in register.read_bytes().decode().splitlines() if (cells := ledger.cells(line))[:1] == ["`shared`"]]
    assert statuses == [f"CLEARED {sha[:9]} (run 123: `a` passed)", "RED"]


def test_ci_names_a_cancelled_run_rather_than_reading_its_log(tmp_path: Path) -> None:
    root, sha = _pushed(tmp_path)
    env = _gh(tmp_path, {**_failed(sha), "conclusion": "cancelled"}, FAILED_RUN)
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes(EXPECTED_RED.encode("utf-8"))
    for args in ((str(register), "123"), ("expect", str(register), "123", "--cleared-by", "x")):
        done = _run("ci", *args, cwd=root, env=env)
        assert done.returncode == 2 and "run 123 was cancelled" in done.stderr, done.stderr


def test_ci_reads_another_commits_run_with_commit_and_writes_no_row(tmp_path: Path) -> None:
    """Every run of another commit was refused, main's among them, and such a run says nothing of the pushed head's rows."""
    root, sha = _pushed(tmp_path)
    head = git(root, "rev-parse", "HEAD")
    jobs = [{"name": "frontend", "conclusion": "success"}]
    red = EXPECTED_RED.replace("| `refusalCoverage` | | mapper |", "| `refusalCoverage` | | `frontend` job: x |")
    env = _gh(tmp_path, _failed(head, jobs=jobs), _log(("docs", "##[error]`db` took 155 s against a budget of 135 s")))
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes(red.encode())
    before = register.read_bytes()
    refused = _run("ci", str(register), "123", cwd=root, env=env)
    assert refused.returncode == 2 and f"not verify's for {sha[:9]}" in refused.stderr
    done = _run("ci", str(register), "123", "--commit", head[:9], cwd=root, env=env)
    assert done.returncode == 0 and f"run 123 for {head[:9]}" in done.stdout and "no row above was set CLEARED" in done.stderr
    assert register.read_bytes() == before
    assert _run("ci", str(register), "123", "--commit", "0" * 12, cwd=root, env=env).returncode == 2


def test_a_reading_prints_before_the_write_that_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    root, sha = _pushed(tmp_path)
    run = _failed(sha, jobs=[{"name": "frontend", "conclusion": "success"}])
    env = _gh(tmp_path, run, _log(("docs", "##[error]`db` took 155 s against a budget of 135 s")))
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes(EXPECTED_RED.replace("| `refusalCoverage` | | mapper |", "| `refusalCoverage` | | `frontend` job: x |").encode())

    def unwritable(*_: object) -> None:
        raise OSError("the register is locked")

    monkeypatch.setenv("PATH", env["PATH"])
    monkeypatch.setattr(ci, "clear", unwritable)
    monkeypatch.chdir(root)
    assert ci.main([str(register), "123"]) == 2
    said = capsys.readouterr()
    assert "CLEARED   refusalCoverage" in said.out and said.out.endswith("0 NEW, 1 expected\n") and "the register is locked" in said.err


def test_a_wait_asks_again_after_one_failed_gh_and_stops_after_three(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    root, sha = _pushed(tmp_path)
    lists = ([{"databaseId": 77, "status": "completed"}],)
    env = _gh(tmp_path, _failed(sha), _log(("verify", "##[error]`db` took 155 s against a budget of 135 s")), lists=lists, exits=(1,))
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes(EXPECTED_RED.encode("utf-8"))
    monkeypatch.setenv("PATH", env["PATH"])
    monkeypatch.setattr(ci, "POLL_SECONDS", 0)
    monkeypatch.chdir(root)
    assert ci.main([str(register), "--head", "--wait"]) == 0
    assert "gh failed while waiting (1 of 3), asking again" in capsys.readouterr().err
    (tmp_path / "bin" / "exits.txt").write_bytes(b"1 1 1 1 1 1")
    (tmp_path / "bin" / "calls.txt").unlink()
    assert ci.main([str(register), "--head", "--wait"]) == 2
    assert "gh failed 3 time(s) running" in capsys.readouterr().err


def test_ci_head_without_wait_reads_the_pushed_commits_run_or_says_there_is_none(tmp_path: Path) -> None:
    root, sha = _pushed(tmp_path)
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes(EXPECTED_RED.encode("utf-8"))
    none = _run("ci", str(register), "--head", cwd=root, env=_gh(tmp_path, _failed(sha), lists=([],)))
    assert none.returncode == 2 and f"no verify run for {sha[:9]} yet: read it with --wait" in none.stderr, none.stderr
    found = ([{"databaseId": 88, "status": "completed"}],)
    read = _run("ci", str(register), "--head", cwd=root, env=_gh(tmp_path, _failed(sha), FAILED_RUN, lists=found))
    assert read.returncode == 1 and read.stdout.startswith(f"run 88 for {sha[:9]}"), (read.stdout, read.stderr)


def test_expect_names_a_row_past_its_bound_and_writes_none_for_it(tmp_path: Path) -> None:
    root, sha = _pushed(tmp_path)
    log = _log(
        ("verify", "##[error]`db` took 155 s against a budget of 135 s"), ("verify", "##[error]`backend` took 81 s against a budget of 70 s")
    )
    register = tmp_path / "REGISTER-s.md"
    register.write_bytes(EXPECTED_RED.encode("utf-8"))
    done = _run("ci", "expect", str(register), "123", "--cleared-by", "x", cwd=root, env=_gh(tmp_path, _failed(sha), log))
    assert done.returncode == 0 and "not written, its row's `Lines` cell is for you to judge: against a budget of" in done.stderr
    assert register.read_bytes() == EXPECTED_RED.encode("utf-8")


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


def _land(root: Path, branch: str = "agent", env: dict[str, str] | None = None, *flags: str) -> subprocess.CompletedProcess[str]:
    """The landing run from the session's checkout against the register beside it, written the first time."""
    register = root.parent / "REGISTER-s.md"
    if not register.exists():
        _register(root.parent)
    return _run("land", str(register), branch, *flags, cwd=root, env=env)


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


@pytest.mark.parametrize("folder", ["fleet", "a fleet"], ids=["a plain path", "a register path holding a space"])
def test_a_landing_closes_only_the_rows_routed_to_its_agent_that_a_rows_fixed_line_names(tmp_path: Path, folder: str) -> None:
    """Routes went out by message and the ledger fell hundreds of rows behind; a bare mention or another fixer's row closed nothing."""
    tmp_path = tmp_path / folder
    tmp_path.mkdir()
    branch = "worktree-agent-a1b2c3"
    root = _repo(tmp_path, branch=branch)
    register = _banked(tmp_path, ("A-report.md", "F1 one\n\nF2 two\n\nF3 three\n\nF4 four\n\nF11 eleven\n"))
    register.write_bytes(register.read_bytes().replace(b"## Findings ledger", (STANDING + "## Findings ledger").encode("utf-8")))
    ledger.route(register, "WORKER", ["A-F1", "A-F4", "A-F11"])
    ledger.route(register, "OTHER", ["A-F2"])
    body = "Rows fixed: A-F11.\nRows fixed: A-F2, A-F3.\n\nA-F4 stays open, unlike A-F1."
    _agent_commit(root, f"Docs: A note\n\n{body}", NOTE, branch=branch)
    done = _land(root, branch)
    assert done.returncode == 0, done.stderr
    merge = git(root, "rev-parse", "--short", "HEAD")
    assert f"FIXED A-F11 by {merge}" in done.stdout
    assert "not ROUTED to WORKER, a1b2c3, so left as they stand: A-F2" in done.stdout
    # An OPEN row a body names was never routed: the landing prints its close and leaves it OPEN.
    said = done.stdout.splitlines()
    opened = said.index("named fixed by the merged commits while OPEN; run the line of each row the merge fixed:")
    assert shlex.split(said[opened + 1])[-1] == "A-F3" and _status(register, "A-F3")[0] == "OPEN"
    # A fixer's body naming finding numbers rather than rows left its rows ROUTED with nothing said.
    said = done.stdout.splitlines()
    assert "still ROUTED to WORKER, a1b2c3 with no `Rows fixed:` line closing them: A-F1, A-F4" in said
    assert _status(register, "A-F11") == [f"FIXED ({merge})", "was WORKER"]
    assert [_status(register, row)[0] for row in ("A-F1", "A-F2", "A-F3", "A-F4")] == ["ROUTED", "ROUTED", "OPEN", "ROUTED"]
    # One printed line per row, each run whole as printed and from outside the repository: a single
    # command over every row closed as FIXED the one this merge left for a later round.
    lines = said[said.index("  run only the line of each row this merge fixed; the rest stay routed:") + 1 :][:2]
    assert [shlex.split(line)[-1] for line in lines] == ["A-F1", "A-F4"]
    fixed = subprocess.run(shlex.split(lines[0]), cwd=tmp_path.parent, capture_output=True, check=False)
    assert fixed.returncode == 0, fixed.stderr.decode("utf-8", "replace")
    assert _status(register, "A-F1") == [f"FIXED ({merge})", "was WORKER"] and _status(register, "A-F4") == ["ROUTED", "WORKER"]
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


def test_a_conflict_outside_a_table_aborts_the_merge_naming_who_else_changes_the_path(tmp_path: Path) -> None:
    """Six landings stopped on a conflict, and the next branch over the same file was found only by its own landing."""
    root = _repo(tmp_path)
    _agent_commit(root, "Docs: A note", {"notes.txt": "agent\n"})
    git(root, "branch", "worktree-agent-d4e5f6")
    _agent_commit(root, "Docs: Another note", {"notes.txt": "other\n"}, branch="worktree-agent-d4e5f6")
    git(root, "worktree", "add", "-q", str(tmp_path / "other"), "worktree-agent-d4e5f6")
    _session_commit(root, "Repo: The session's note", {"notes.txt": "session\n"})
    said = _stopped_clean(root, git(root, "rev-parse", "HEAD"), 3)
    assert "CONFLICT in notes.txt" in said and "the merge is aborted" in said
    assert "notes.txt also changed by OTHER (worktree-agent-d4e5f6)" in said and land.MERGE_BACK in said


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
    """Checked against the checkout's stale install, a merge moving a dependency is judged by packages it does not use."""
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


def test_a_ledger_holding_a_status_no_command_knows_is_refused_before_the_merge(tmp_path: Path) -> None:
    """Met first at the closing of rows, the refusal would come after the merge commit."""
    root = _repo(tmp_path)
    _agent_commit(root, "Docs: A note", NOTE)
    _set(_banked(tmp_path, ("A-report.md", "F1 one\n")), "A-F1", "CLOSED")
    said = _refused(root)
    assert "cannot be read" in said and "A-F1 is `CLOSED`" in said


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


def test_a_landing_credits_every_agent_whose_branch_it_brought_in(tmp_path: Path) -> None:
    """A merge agent's landing carried a fixer's commits, and the fixer's named rows stayed ROUTED to be closed by hand."""
    root = _repo(tmp_path, branch="worktree-agent-a1b2c3")
    register = _banked(tmp_path, ("A-report.md", "F1 one\n\nF2 two\n"))
    ledger.route(register, "WORKER", ["A-F1"])
    ledger.route(register, "OTHER", ["A-F2"])
    _agent_commit(root, "Docs: A note\n\nRows fixed: A-F1.", NOTE, branch="worktree-agent-a1b2c3")
    git(root, "branch", "worktree-agent-d4e5f6", "worktree-agent-a1b2c3")
    _agent_commit(root, "Docs: Another file\n\nRows fixed: A-F2.", {"other.txt": "new\n"}, branch="worktree-agent-d4e5f6")
    done = _land(root, "worktree-agent-d4e5f6")
    assert done.returncode == 0, done.stderr
    merge = git(root, "rev-parse", "--short", "HEAD")
    assert _status(register, "A-F1") == [f"FIXED ({merge})", "was WORKER"] and _status(register, "A-F2") == [f"FIXED ({merge})", "was OTHER"]


@pytest.mark.parametrize(("status", "code"), [("completed", 9), ("in_progress", 0)], ids=["the window open", "its run still going"])
def test_a_landing_waits_while_a_standing_action_waits_on_the_open_window(tmp_path: Path, status: str, code: int) -> None:
    """Three times the writers queued for a concluded window went out only after the next landing had closed it."""
    root = _repo(tmp_path)
    _agent_commit(root, "Docs: A note", NOTE)
    register, brief = _register(tmp_path), tmp_path / "NEXT.md"
    brief.write_bytes(b"the brief\n")
    standing = "## Standing actions\n\n| Trigger | The whole brief | Dispatched? |\n| --- | --- | --- |\n"
    register.write_bytes(
        register.read_bytes().replace(b"## Findings ledger", f"{standing}| window | `{brief}` | |\n\n## Findings ledger".encode())
    )
    env = _gh(tmp_path, {}, lists=([{"databaseId": 5, "status": status, "conclusion": ""}],))
    head = git(root, "rev-parse", "HEAD")
    done = _land(root, "agent", env)
    assert done.returncode == code, done.stderr
    if code == 9:
        assert "dispatch them first, or land with --after-dispatch" in done.stderr and str(brief) in done.stderr
        assert git(root, "rev-parse", "HEAD") == head
        assert _land(root, "agent", env, "--after-dispatch").returncode == 0
        # Ticked by the flag, the row lets the next landing in the same concluded window through.
        assert re.search(r"\| yes \d{4}-\d\d-\d\d \d\d:\d\d \(`land.py --after-dispatch`\) \|", register.read_bytes().decode())
        git(root, "branch", "second")
        _agent_commit(root, "Docs: A second note", {"other.txt": "new\n"}, branch="second")
        assert _land(root, "second", env).returncode == 0


def test_a_window_whose_run_cannot_be_read_refuses_naming_the_flag(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    _agent_commit(root, "Docs: A note", NOTE)
    register, brief = _register(tmp_path), tmp_path / "NEXT.md"
    brief.write_bytes(b"the brief\n")
    standing = "## Standing actions\n\n| Trigger | The whole brief | Dispatched? |\n| --- | --- | --- |\n"
    register.write_bytes(
        register.read_bytes().replace(b"## Findings ledger", f"{standing}| window | `{brief}` | |\n\n## Findings ledger".encode())
    )
    head = git(root, "rev-parse", "HEAD")
    done = _land(root, "agent", _gh(tmp_path, {}, code=1, lists=([],)))
    assert done.returncode == 2 and "could not be read" in done.stderr and "--after-dispatch" in done.stderr, done.stderr
    assert git(root, "rev-parse", "HEAD") == head


def test_a_landing_credits_no_agent_whose_branch_had_landed_before_it(tmp_path: Path) -> None:
    """An agent landed earlier keeps a row for a later round, which another branch's claim must not close."""
    root = _repo(tmp_path, branch="worktree-agent-a1b2c3")
    register = _banked(tmp_path, ("A-report.md", "F1 one\n\nF2 two\n"))
    ledger.route(register, "WORKER", ["A-F2"])
    _agent_commit(root, "Docs: A note", NOTE, branch="worktree-agent-a1b2c3")
    assert _land(root, "worktree-agent-a1b2c3").returncode == 0
    git(root, "branch", "worktree-agent-d4e5f6")
    _agent_commit(root, "Docs: Another file\n\nRows fixed: A-F2.", {"other.txt": "new\n"}, branch="worktree-agent-d4e5f6")
    done = _land(root, "worktree-agent-d4e5f6")
    assert done.returncode == 0, done.stderr
    assert _status(register, "A-F2") == ["ROUTED", "WORKER"] and "still ROUTED" not in done.stdout


def test_bookkeeping_that_fails_after_the_merge_is_its_own_exit(tmp_path: Path) -> None:
    """Two live rows naming one id raised a traceback after the merge commit, and a git failure there read as refused before it."""
    branch = "worktree-agent-a1b2c3"
    root = _repo(tmp_path, branch=branch)
    _register(tmp_path, live=LIVE.replace("| OTHER `d4e5f6` |", "| OTHER `a1b2c3` |"))
    _agent_commit(root, "Docs: A note", NOTE, branch=branch)
    head = git(root, "rev-parse", "HEAD")
    done = _land(root, branch)
    assert done.returncode == 10 and "landed as" in done.stderr and "two names" in done.stderr, done.stderr
    assert "Traceback" not in done.stderr and git(root, "rev-parse", "HEAD^1") == head


def test_git_failing_in_the_bookkeeping_after_the_merge_is_not_a_refusal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A git failure reading the carried branches stopped as exit 2, "refused before the merge", with the merge commit made."""
    branch = "worktree-agent-a1b2c3"
    root = _repo(tmp_path, branch=branch)
    _agent_commit(root, "Docs: A note", NOTE, branch=branch)
    head = git(root, "rev-parse", "HEAD")
    real_git = land.git

    def listing_fails(*args: str, check: bool = True) -> str:
        if args[:1] == ("for-each-ref",):
            raise land.Stop(2, "git for-each-ref exited 128: planted")
        return real_git(*args, check=check)

    monkeypatch.setattr(land, "git", listing_fails)
    monkeypatch.chdir(root)
    code = land.main([str(_register(tmp_path)), branch])
    said = capsys.readouterr().err
    assert code == 10 and "landed as" in said and "planted" in said, said
    assert git(root, "rev-parse", "HEAD^1") == head and git(root, "status", "--porcelain") == ""


def test_queue_names_a_row_queued_already_and_done_ticks_it(tmp_path: Path) -> None:
    """A message's standing action, ticked by nothing, held back every later landing in a concluded window."""
    _, register, _ = _fleet(tmp_path)
    register.write_bytes(register.read_bytes().replace(b"## Findings ledger", (STANDING + "## Findings ledger").encode()))
    brief = _brief(tmp_path, "LATER", "")
    assert _run("reg", "queue", str(register), "window", str(brief)).returncode == 0
    again = _run("reg", "queue", str(register), "window", str(brief))
    assert again.returncode == 0 and again.stdout.startswith("already queued: window")
    assert reg.windows(register.read_bytes().decode()) == [f"`{brief.resolve()}`"]
    done = _run("reg", "queue", str(register), "window", str(brief), "--done", "sent by message")
    assert done.returncode == 0 and reg.windows(register.read_bytes().decode()) == [], done.stderr
    assert re.search(r"\| window \| `[^`]+` \| yes \d{4}-\d\d-\d\d \d\d:\d\d \(sent by message\) \|", register.read_bytes().decode())
    none = _run("reg", "queue", str(register), "window", str(brief), "--done", "again")
    assert none.returncode == 2 and "no unticked standing action `window`" in none.stderr


def _agents(tmp_path: Path, *rows: str) -> Path:
    live = "## Live agents\n\n| Agent | Question | Owns | Status |\n| --- | --- | --- | --- |\n" + "".join(f"{row}\n" for row in rows) + "\n"
    return _register(tmp_path, live=live)


def test_prune_removes_a_finished_agents_merged_clean_worktree_and_branch_alone(tmp_path: Path) -> None:
    """58 worktrees took 4.9 GB, 56 of them merged, while the worktree table stayed empty."""
    root = _repo(tmp_path, branch="worktree-agent-a1b2c3")
    for agent in ("d4e5f6", "f00d", "beef"):
        git(root, "branch", f"worktree-agent-{agent}")
    _agent_commit(root, "Docs: A note", NOTE, branch="worktree-agent-a1b2c3")
    _agent_commit(root, "Docs: Unlanded", {"other.txt": "new\n"}, branch="worktree-agent-d4e5f6")
    git(root, "merge", "-q", "--no-ff", "worktree-agent-a1b2c3", "-m", "Merge the note")
    trees = {agent: tmp_path / f"tree-{agent}" for agent in ("a1b2c3", "d4e5f6", "f00d", "beef")}
    for agent, tree in trees.items():
        git(root, "worktree", "add", "-q", str(tree), f"worktree-agent-{agent}")
    # Ignored output, as a worktree's installs and bytecode are, does not hold a removal back.
    write(trees["a1b2c3"], "__pycache__/x.pyc", "bytes")
    write(trees["f00d"], "unsaved.txt", "work\n")
    done = "DONE 2026-10-16 10:00 x-report.md"
    rows = (
        f"| WORKER `a1b2c3` | q |  | {done} |",
        f"| OTHER `d4e5f6` | q |  | {done} |",
        f"| SAVER `f00d` | q |  | {done} |",
        "| LIVE `beef` | q |  | RUNNING |",
    )
    pruned = _run("reg", "prune", str(_agents(tmp_path, *rows)), cwd=root, env=_home(tmp_path))
    assert pruned.returncode == 0, pruned.stderr
    assert f"removed {trees['a1b2c3']} and worktree-agent-a1b2c3 (WORKER)" in pruned.stdout
    assert f"kept {trees['d4e5f6']} (OTHER): not merged into HEAD" in pruned.stdout
    assert f"kept {trees['f00d']} (SAVER): it holds uncommitted work" in pruned.stdout
    assert f"left {trees['beef']} (LIVE): its row reads `RUNNING`" in pruned.stdout
    assert not trees["a1b2c3"].exists() and all(trees[agent].exists() for agent in ("d4e5f6", "f00d", "beef"))
    branches = git(root, "for-each-ref", "--format=%(refname:short)", "refs/heads/worktree-agent-*").split()
    assert branches == ["worktree-agent-beef", "worktree-agent-d4e5f6", "worktree-agent-f00d"]


def _transcribed(tmp_path: Path, agent: str, *, ended: bool = True, written: float | None = 0.0) -> None:
    """A finished agent's transcript, or one whose last message calls a tool; `written` sets its time, None leaving it now."""
    _transcript(tmp_path / "home", agent, ("m1", ["F1 done\n"]))
    path = tmp_path / "home" / ".claude" / "projects" / "proj" / "session" / "subagents" / f"agent-{agent}.jsonl"
    if not ended:
        call = {"message": {"id": "m1", "role": "assistant", "content": [{"type": "tool_use", "name": "Bash", "input": {}}]}}
        path.write_bytes(path.read_bytes() + b"\n" + json.dumps(call).encode())
    if written is not None:
        os.utime(path, (written, written))


def test_prune_keeps_a_finished_agent_that_works_again_holds_rows_or_holds_ignored_files(tmp_path: Path) -> None:
    """A resumed writer passed every guard between its resume and its first edit, and its tree went with every file git ignores."""
    agents = {"a1b2c3": "WORKER", "d4e5f6": "OTHER", "f00d": "SAVER", "beef": "KEEPER", "cafe": "CLEAN"}
    root = _repo(tmp_path, branch="worktree-agent-a1b2c3")
    (root / ".git" / "info").mkdir(exist_ok=True)
    with (root / ".git" / "info" / "exclude").open("ab") as excluded:
        excluded.write(b"\n.env*\nnode_modules/\n.claude/settings.local.json\n")
    trees = {agent: tmp_path / f"tree-{agent}" for agent in agents}
    for agent, tree in trees.items():
        if agent != "a1b2c3":
            git(root, "branch", f"worktree-agent-{agent}")
        git(root, "worktree", "add", "-q", str(tree), f"worktree-agent-{agent}")
    env = _home(tmp_path)
    _transcribed(tmp_path, "a1b2c3", written=None)
    _transcribed(tmp_path, "d4e5f6", ended=False)
    _transcribed(tmp_path, "cafe")
    write(trees["beef"], ".env.local", "A=1\n")
    # The harness's copy of the checkout's own settings, and an install, go with the tree.
    write(root, ".claude/settings.local.json", "{}\n")
    write(trees["cafe"], ".claude/settings.local.json", "{}\n")
    write(trees["cafe"], "node_modules/x/index.js", "")
    register = _agents(tmp_path, *(f"| {name} `{agent}` | q |  | DONE 2020-01-01 10:00 x-report.md |" for agent, name in agents.items()))
    (tmp_path / "A-report.md").write_bytes(b"F1 one\n")
    ledger.bank(register, tmp_path / "A-report.md", routes=[("SAVER", [1])])
    pruned = _run("reg", "prune", str(register), cwd=root, env=env)
    assert pruned.returncode == 0, pruned.stderr
    said = pruned.stdout
    assert f"kept {trees['a1b2c3']} (WORKER): its transcript was written at" in said and "after its DONE stamp" in said
    assert f"kept {trees['d4e5f6']} (OTHER): its transcript ends mid-turn, in a tool call" in said
    assert f"kept {trees['f00d']} (SAVER): it still holds ROUTED rows, A-F1" in said
    assert f"kept {trees['beef']} (KEEPER): it holds ignored files no install or build writes again: .env.local" in said
    assert f"removed {trees['cafe']} and worktree-agent-cafe (CLEAN)" in said, said
    assert [agent for agent, tree in trees.items() if tree.exists()] == ["a1b2c3", "d4e5f6", "f00d", "beef"]


def test_prune_names_every_worktree_it_leaves_and_prunes_one_whose_folder_is_gone(tmp_path: Path) -> None:
    """After a prune the text read every worktree left as a live agent's, while a detached tree and a stale row's tree stayed unnamed."""
    root = _repo(tmp_path, branch="worktree-agent-a1b2c3")
    git(root, "branch", "worktree-agent-d4e5f6")
    git(root, "branch", "elsewhere")
    loose, other, live, gone = (tmp_path / name for name in ("loose", "other", "live", "gone"))
    git(root, "worktree", "add", "-q", "--detach", str(loose))
    git(root, "worktree", "add", "-q", str(other), "elsewhere")
    git(root, "worktree", "add", "-q", str(live), "worktree-agent-d4e5f6")
    git(root, "worktree", "add", "-q", str(gone), "worktree-agent-a1b2c3")
    shutil.rmtree(gone)
    register = _agents(tmp_path, "| GONE `a1b2c3` | q |  | DONE 2020-01-01 10:00 x |", "| LIVE `d4e5f6` | q |  | RUNNING (2026-10-16 10:00) |")
    pruned = _run("reg", "prune", str(register), cwd=root, env=_home(tmp_path))
    assert pruned.returncode == 0, pruned.stderr
    assert f"left {loose}: detached at" in pruned.stdout
    assert f"left {other} (elsewhere): no live-agent row names it" in pruned.stdout
    assert f"left {live} (LIVE): its row reads `RUNNING (2026-10-16 10:00)`" in pruned.stdout
    assert f"removed {gone} and worktree-agent-a1b2c3 (GONE)" in pruned.stdout
    assert "worktree-agent-a1b2c3" not in git(root, "branch", "--list")


def test_prune_exits_one_naming_each_removal_git_refuses(tmp_path: Path) -> None:
    root = _repo(tmp_path, branch="worktree-agent-a1b2c3")
    tree = tmp_path / "tree"
    git(root, "worktree", "add", "-q", str(tree), "worktree-agent-a1b2c3")
    git(root, "worktree", "lock", str(tree))
    pruned = _run("reg", "prune", str(_agents(tmp_path, "| LOCKED `a1b2c3` | q |  | DONE 2020-01-01 10:00 x |")), cwd=root, env=_home(tmp_path))
    assert pruned.returncode == 1 and "git worktree remove" in pruned.stderr and "(LOCKED) exited" in pruned.stderr
    assert tree.exists()


def test_prune_removes_a_tree_holding_a_path_past_windows_limit(tmp_path: Path) -> None:
    """At the path limit git unregistered the tree, failed to delete it, and the next prune called it removed while the folder stayed."""
    root = _repo(tmp_path, branch="worktree-agent-a1b2c3")
    (root / ".git" / "info").mkdir(exist_ok=True)
    with (root / ".git" / "info" / "exclude").open("ab") as excluded:
        excluded.write(b"\nnode_modules/\n")
    tree = tmp_path / "tree"
    git(root, "worktree", "add", "-q", str(tree), "worktree-agent-a1b2c3")
    deep = tree / "node_modules" / "x"
    while len(str(deep)) < 280:
        deep = deep / "a-package-nested-in-another"
    # Python hands Windows a path past its limit whole only behind the `\\?\` prefix.
    (Path("\\\\?\\" + str(deep)) if os.name == "nt" else deep).mkdir(parents=True)
    pruned = _run("reg", "prune", str(_agents(tmp_path, "| DEEP `a1b2c3` | q |  | DONE 2020-01-01 10:00 x |")), cwd=root, env=_home(tmp_path))
    assert pruned.returncode == 0 and f"removed {tree} and worktree-agent-a1b2c3 (DEEP)" in pruned.stdout, (pruned.stdout, pruned.stderr)
    assert not tree.exists()


def test_prune_names_a_folder_a_removal_left_until_it_is_gone(tmp_path: Path) -> None:
    """A tree git unregistered and could not delete was named once, then pruned as having no worktree while its folder stayed."""
    root = _repo(tmp_path, branch="worktree-agent-a1b2c3")
    left = root / reg.AGENT_TREES / "agent-a1b2c3"
    git(root, "worktree", "add", "-q", str(left), "worktree-agent-a1b2c3")
    # What a removal stopped part-way leaves: the tree unregistered and its `.git` file gone, the folder on disk.
    (left / ".git").unlink()
    git(root, "worktree", "prune")
    register = _agents(tmp_path, "| HALF `a1b2c3` | q |  | DONE 2020-01-01 10:00 x |")
    for _ in range(2):
        pruned = _run("reg", "prune", str(register), cwd=root, env=_home(tmp_path))
        assert pruned.returncode == 1 and f"{left} (HALF) stays on disk" in pruned.stderr, (pruned.stdout, pruned.stderr)
    assert "worktree-agent-a1b2c3" in git(root, "branch", "--list")
    shutil.rmtree(left)
    pruned = _run("reg", "prune", str(register), cwd=root, env=_home(tmp_path))
    assert pruned.returncode == 0 and "removed no worktree and worktree-agent-a1b2c3 (HALF)" in pruned.stdout, pruned.stderr


def test_overlap_names_each_path_a_live_worktree_changes_by_commit_or_by_edit(tmp_path: Path) -> None:
    """Briefs were diffed path by path against nothing, so six overlaps surfaced as landing conflicts."""
    root = _repo(tmp_path, branch="worktree-agent-a1b2c3")
    _agent_commit(root, "Docs: A row", {"docs/spec.md": TABLE_HEAD + "| I2 | two |\n"}, branch="worktree-agent-a1b2c3")
    git(root, "worktree", "add", "-q", str(tmp_path / "tree"), "worktree-agent-a1b2c3")
    write(tmp_path / "tree", "notes.txt", "unsaved\n")
    write(tmp_path / "tree", "fl_backend/app/schema.txt", '"a": 9')
    register = _register(tmp_path)
    shared = _run("reg", "overlap", str(register), "docs/**", "notes.txt", cwd=root)
    assert shared.returncode == 1 and shared.stdout.splitlines() == [
        "docs/spec.md  WORKER (worktree-agent-a1b2c3)",
        "notes.txt  WORKER (worktree-agent-a1b2c3)",
    ]
    assert _run("reg", "overlap", str(register), "fl_backend/tests", cwd=root).returncode == 0


def test_overlap_reads_a_briefs_owns_lines_and_names_a_path_no_file_answers(tmp_path: Path) -> None:
    """Read from the OWNERSHIP prose, a path written relative to its package matched nothing, and overlap answered none."""
    root = _repo(tmp_path, branch="worktree-agent-a1b2c3")
    git(root, "worktree", "add", "-q", str(tmp_path / "tree"), "worktree-agent-a1b2c3")
    write(tmp_path / "tree", "fl_backend/app/schema.txt", '"a": 9')
    register, brief = _register(tmp_path), tmp_path / "brief.md"
    brief.write_bytes(
        b"1  OWNERSHIP.   The exact files, on the `Owns:` lines below; never app/schema.txt's neighbours.\n"
        b"Owns: docs/spec.md, `fl_backend/app/schema.txt`\nOwns: app/extra.txt\n\n3  THE WORK.    notes.txt\n"
    )
    done = _run("reg", "overlap", str(register), "--brief", str(brief), cwd=root)
    assert done.returncode == 1 and done.stdout.splitlines() == ["fl_backend/app/schema.txt  WORKER (worktree-agent-a1b2c3)"]
    assert done.stderr.splitlines() == [
        "app/extra.txt names no tracked path: compared as written, a file still to be made or a path written wrong"
    ]
    brief.write_bytes(b"1  OWNERSHIP.   fl_backend/app/schema.txt, in prose alone\n")
    prose = _run("reg", "overlap", str(register), "--brief", str(brief), cwd=root)
    assert prose.returncode == 2 and "carries no `Owns:` line" in prose.stderr
