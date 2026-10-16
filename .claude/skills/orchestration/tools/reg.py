"""ORCHESTRATION · what the coordinator writes into its register's records, and reads from its worktrees.

A typed time runs ahead of the clock, so `append` and `resume` stamp from it; text arrives by file
or stdin, since a backtick inside a double-quoted argument ran as a command and dropped words. A
table no tool writes drifts, so `dispatch` writes the live-agent row, routes the brief's `Rows:`,
ticks the standing action naming the brief and marks a resume RUNNING, and `message`, the messages
hook's, records each send and routes its rows one by one.

    uv run --project fl_backend --frozen python .claude/skills/orchestration/tools/reg.py <command>

    append <register> [--file <path>]
    resume <register> [--file <path>]
    dispatch <register> <NAME> [--id <agent id>] [--question <text>] [--brief <file>] [--takes <queue>]
    queue <register> <trigger> <brief> [--done <evidence>]
    message <plans directory>
    pause <register> <NAME>…
    live <register>
    prune <register>
    overlap <register> (<path>… | --brief <file>)
    context <register> <agent id>…

Exit 0 done, 2 refused; `overlap` 1 while a path is shared; `prune` 1 where git refused a removal;
`message` always 0, a hook's failure being the send's.
"""

from __future__ import annotations

import argparse
import contextlib
import datetime
import io
import json
import re
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path, PurePosixPath
from typing import Final, NamedTuple

# Run as a script, python seeds this file's own directory on the path.
import ledger

MARKER: Final = "<!-- reg.py appends UPDATE lines above this line -->"
SESSION_RE: Final = re.compile(r"^[A-Za-z0-9_-]+$")
NAME_RE: Final = re.compile(r"^[A-Za-z0-9_.-]+$")
ROWS_RE: Final = re.compile(r"^Rows:\s*(?P<rows>.+)$", re.MULTILINE)
# A brief's `Rows:` line sits indented under THE WORK, as the brief template lays a section out.
BRIEF_ROWS_RE: Final = re.compile(r"^[ \t]*Rows:[ \t]*(?P<rows>.+)$", re.MULTILINE)
REROUTE_RE: Final = re.compile(r"^Reroute:\s*(?P<owner>[^:\n]+?)\s*:\s*(?P<rows>.+)$", re.MULTILINE)
RESUME_HEADING: Final = "## Resume point"
STANDING_HEADING: Final = "## Standing actions"
WINDOW: Final = "window"
# A field's label ends at the first colon a space follows, so a time inside it such as 18:59 stays in it.
FIELD_RE: Final = re.compile(r"^(?P<label>[^\n]{1,80}?):(?:[ \t]+(?P<text>.*))?$")
# The brief template's line, at a line's start, its entries parted by a comma and a space.
OWNS_RE: Final = re.compile(r"^Owns:[ \t]*(?P<paths>.*)$", re.MULTILINE)
AGENT_BRANCH_RE: Final = re.compile(r"^worktree-agent-(?P<id>[A-Za-z0-9]+)$")
GLOB_CHARS: Final = frozenset("*?[")
# The live-agent states an agent holds its rows and its worktree in; `pause` writes the second.
LIVE_STATES: Final = ("RUNNING", "PAUSED")
DONE_RE: Final = re.compile(r"^DONE (?P<stamp>\d{4}-\d\d-\d\d \d\d:\d\d)\b")
# What an install, a build or a test run writes again, so a worktree holding no other ignored file
# loses nothing with it: a `.env` file or an audit report is nowhere else.
REBUILT_DIRS: Final = frozenset({"node_modules", ".venv", ".next", "__pycache__", ".pytest_cache", ".ruff_cache"})
REBUILT_FILE_RE: Final = re.compile(r"\.(?:pyc|tsbuildinfo)$|^(?:next-env\.d\.ts|\.eslintcache)$")
# The harness copies the checkout's own into every worktree it makes.
LOCAL_SETTINGS: Final = ".claude/settings.local.json"
# How each command moves a row another owner holds, named in its refusal: `--reroute` is `ledger.py route`'s alone.
TAKES_MOVES: Final = "`--takes {by}` moves every row {by} holds once it is a queue or a finished agent"
REROUTE_MOVES: Final = "a `Reroute: {by}: {row}` line in the message moves it"


def append(register: Path, text: str, now: datetime.datetime | None = None) -> str:
    """The register with one stamped line above its marker, written; the line."""
    return ledger.update(register, lambda lines: _update(lines, text, now))


def _update(lines: list[str], text: str, now: datetime.datetime | None) -> str:
    body = " ".join(text.split())
    if not body:
        raise ValueError("no text to append")
    at = [k for k, line in enumerate(lines) if line.strip() == MARKER]
    if len(at) != 1:
        raise ValueError(f"the register holds {len(at)} copies of the marker line, where one says where the line goes: {MARKER}")
    line = f"UPDATE {ledger.stamp(now)}: {body}"
    lines.insert(at[0], line)
    return line


def resume(register: Path, text: str, now: datetime.datetime | None = None) -> str:
    """The resume point's fields the text names rewritten, every other left as it stands, and an UPDATE line saying so, in one write."""
    given: dict[str, str] = {}
    for line in filter(str.strip, text.splitlines()):
        found = FIELD_RE.match(line.strip())
        if found is None or found["label"] in given:
            raise ValueError(f"`{line.strip()[:60]}` is no `<label>: <text>` line, or names its field twice")
        given[found["label"]] = " ".join((found["text"] or "").split())
    if not given:
        raise ValueError("no `<label>: <text>` line to write")

    def edit(lines: list[str]) -> str:
        heading = next((k for k, line in enumerate(lines) if line.startswith(RESUME_HEADING)), None)
        marker = [k for k, line in enumerate(lines) if line.strip() == MARKER]
        if heading is None or len(marker) != 1 or marker[0] < heading:
            raise ValueError(f"no `{RESUME_HEADING}` heading above one marker line ({MARKER})")
        held: dict[str, list[int]] = {}
        for k in range(heading + 1, marker[0]):
            if lines[k].startswith("UPDATE "):
                break
            if found := FIELD_RE.match(lines[k]):
                held.setdefault(found["label"], []).append(k)
        if wrong := [label for label in given if len(held.get(label, [])) != 1]:
            raise ValueError(f"the resume point holds no single field {'; '.join(wrong)}: its fields are {'; '.join(held)}")
        for label, value in given.items():
            lines[held[label][0]] = f"{label}: {value}".rstrip()
        return _update(lines, f"resume point rewritten: {'; '.join(given)}", now)

    return ledger.update(register, edit)


def _briefs(register: str) -> Path | None:
    found = ledger.BRIEFS_RE.search(register)
    return Path(found["path"]) if found else None


def standing_table(lines: list[str]) -> tuple[int, int]:
    """The standing actions table's header index and its last row's index."""
    return ledger.table_under(lines, STANDING_HEADING)[1:]


def unticked(row: list[str]) -> bool:
    # The third cell is ticked only on evidence the action went out (`register-template.md`).
    return len(row) == 3 and (not row[2] or row[2].lower().startswith("no"))


def windows(register: str) -> list[str]:
    """Each unticked standing action waiting on the next concluded CI window, by its brief."""
    lines = register.split("\n")
    try:
        table, end = standing_table(lines)
    except ValueError:
        return []
    return [row[1] for k in range(table + 2, end + 1) if unticked(row := ledger.cells(lines[k])) and row[0].strip("`").lower() == WINDOW]


def _same_file(cell: str, target: Path) -> bool:
    try:
        return Path(cell.strip().strip("`")).resolve() == target
    except OSError, ValueError:
        return False


def queue(register: Path, trigger: str, brief: Path, done: str | None = None, now: datetime.datetime | None = None) -> str:
    """A standing action naming the brief added under its trigger, or with `done` ticked on that evidence; what was done."""
    trigger = " ".join(trigger.split())
    if not trigger:
        raise ValueError("the trigger is empty")
    if done is None and not brief.is_file():
        raise ValueError(f"a standing action needs a saved brief: {brief} is no file")
    if done is not None and not ledger.escaped(done):
        raise ValueError("a standing action is ticked on its evidence, and the evidence is empty")
    target = brief.resolve()

    def held(row: list[str]) -> bool:
        return row[0] == ledger.escaped(trigger) and _same_file(row[1], target)

    def edit(lines: list[str]) -> str:
        table, end = standing_table(lines)
        if done is not None:
            # A message or a withdrawal is the action's end too: unticked, the row held the next landing back.
            if not (ticked := _tick(lines, held, done, now)):
                raise ValueError(f"no unticked standing action `{trigger}` names {target}")
            return "; ".join(ticked)
        if any(unticked(row := ledger.cells(lines[k])) and held(row) for k in range(table + 2, end + 1)):
            return f"already queued: {trigger} -> {target}"
        lines.insert(end + 1, ledger.joined([ledger.escaped(trigger), f"`{target}`", ""]))
        return f"queued {target.name} for {trigger}"

    return ledger.update(register, edit)


def _tick(lines: list[str], held: Callable[[list[str]], bool], evidence: str, now: datetime.datetime | None) -> list[str]:
    """Each unticked standing action `held` picks ticked in `lines` on the evidence; what was done."""
    try:
        table, end = standing_table(lines)
    except ValueError:
        return []
    said = []
    for k in range(table + 2, end + 1):
        row = ledger.cells(lines[k])
        if unticked(row) and held(row):
            row[2] = f"yes {ledger.stamp(now)} ({ledger.escaped(evidence)})"
            lines[k] = ledger.joined(row)
            said.append(f"ticked the standing action `{row[0]}` for {row[1]}")
    return said


def tick_windows(register: Path, evidence: str) -> list[str]:
    """Each unticked `window` standing action ticked on the evidence; what was done."""
    return ledger.update(register, lambda lines: _tick(lines, lambda row: row[0].strip("`").lower() == WINDOW, evidence, None))


def brief_rows(brief: Path) -> list[str]:
    text = brief.read_bytes().decode("utf-8")
    return [row.rstrip(".") for found in BRIEF_ROWS_RE.findall(text) for row in re.split(r"[,\s]+", found) if row.rstrip(".")]


def dispatch(
    register: Path,
    name: str,
    agent: str | None = None,
    question: str = "",
    brief: Path | None = None,
    takes: str | None = None,
    now: datetime.datetime | None = None,
) -> tuple[list[str], list[str]]:
    """The agent's messages file and live-agent row written, its rows routed and its standing action ticked; what was done, and each refusal."""
    if not NAME_RE.match(name) or (agent is not None and not ledger.AGENT_ID_RE.match(agent)):
        raise ValueError(f"{name!r} or {agent!r} is no agent name or id")
    briefs = _briefs(register.read_bytes().decode("utf-8"))
    if briefs is None or not briefs.is_dir():
        raise ValueError(f"the register's `Briefs:` line names no directory ({briefs}): add one under its header")
    if brief is not None and not brief.is_file():
        raise ValueError(f"{brief} is no brief file")
    rows = brief_rows(brief) if brief else []

    def edit(lines: list[str]) -> tuple[list[str], list[str]]:
        table, end = ledger.live_table(lines)
        said: list[str] = []
        first = f"{name} `{agent}`" if agent else name
        rows_naming = {ledger.row_name(lines[k]) for k in range(table + 2, end + 1) if agent and f"`{agent}`" in ledger.first_cell(lines[k])}
        if others := sorted(rows_naming - {name}):
            # Two rows naming one id leave a send by that id, and every later write to either row, refused.
            raise ValueError(f"`{agent}` is named by {', '.join(others)}'s live-agent row already: one id names one agent")
        row = next((k for k in range(table + 2, end + 1) if ledger.row_name(lines[k]) == name), None)
        if row is not None:
            if agent and f"`{agent}`" not in ledger.first_cell(lines[row]):
                parts = lines[row].split("|")
                parts[1] = f" {first} "
                lines[row] = "|".join(parts)
                said.append(f"named {agent} in {name}'s live-agent row")
            if agent and (woke := _wake(lines, name, now)):
                said.append(woke)
        else:
            width = lines[table].count("|") - 1
            made = [first, question, *[""] * max(width - 3, 0), f"RUNNING ({ledger.stamp(now)})"][:width]
            lines.insert(end + 1, "| " + " | ".join(made) + " |")
            said.append(f"added {name}'s live-agent row")
        target = (brief or briefs / f"{name}.md").resolve()
        said += _tick(lines, lambda row: _same_file(row[1], target), f"`reg.py dispatch {name}`", now)
        if brief is not None and not rows:
            said.append(f"{brief.name} carries no `Rows:` line, so it routed no row")
        return said, _take_rows(register, lines, name, rows, takes, said)

    said, refused = ledger.update(register, edit)
    messages = briefs / f"{name}-messages.md"
    if not messages.exists():
        messages.write_bytes(f"# {name} -- messages after the brief\n".encode())
        said.insert(0, f"created {messages}")
    return said, refused


def _take_rows(register: Path, lines: list[str], name: str, rows: list[str], takes: str | None, said: list[str]) -> list[str]:
    """Every row routed to `takes` and the brief's rows routed to the agent in `lines`; each refusal."""
    if not rows and takes is None:
        return []
    at = ledger.rows_at(lines, register)
    ledger.check_owner(lines, name)
    moved: list[str] = []
    refused: list[str] = []
    if takes is not None:
        # A live fixer's rows are in flight: taken in silence, two agents would fix one finding.
        if takes != name and (state := _live_state(lines, takes)):
            raise ValueError(f"{takes} is a {state} agent: its rows stay with it until it reports")
        held = [row for row, k in at.items() if ledger.status(cells := ledger.cells(lines[k])) == "ROUTED" and ledger.owner(cells) == takes]
        moved, refused = ledger.route_lines(lines, at, name, held, reroute=True, held_by=takes)
        if not held:
            said.append(f"no row is routed to {takes}")
    # After the queue's: a row the brief names that `--takes` moved is the agent's by then, and no refusal.
    more, refusals = ledger.route_lines(lines, at, name, rows, moves=TAKES_MOVES)
    said += [f"ROUTED {row} to {name}" for row in moved + more]
    return refused + refusals


def _live_state(lines: list[str], name: str) -> str | None:
    """The state of the live agent `name` names, RUNNING or PAUSED; None where it is neither."""
    table, end = ledger.live_table(lines)
    column = ledger.status_column(lines[table])
    rows = (ledger.cells(lines[k]) for k in range(table + 2, end + 1) if ledger.row_name(lines[k]) == name)
    return next((state for row in rows if column < len(row) for state in LIVE_STATES if row[column].startswith(state)), None)


def _wake(lines: list[str], name: str, now: datetime.datetime | None) -> str | None:
    """The row of `name` set RUNNING where it reads DONE or PAUSED, in `lines`; what was done."""
    try:
        table, end = ledger.live_table(lines)
    except ValueError:
        return None
    column = ledger.status_column(lines[table])
    for k in range(table + 2, end + 1):
        row = ledger.cells(lines[k])
        # A finished or paused agent sent another round is live again: the gauge and the stale-row check read this cell.
        if ledger.row_name(lines[k]) == name and column < len(row) and row[column].startswith(("DONE", "PAUSED")):
            row[column] = f"RUNNING ({ledger.stamp(now)})"
            lines[k] = ledger.joined(row)
            return f"set {name}'s live-agent row RUNNING again: a resume"
    return None


def pause(register: Path, names: list[str], now: datetime.datetime | None = None) -> list[str]:
    """Each named RUNNING agent's row set PAUSED, all or none; what was done."""

    def edit(lines: list[str]) -> list[str]:
        table, end = ledger.live_table(lines)
        column = ledger.status_column(lines[table])
        said, refused = [], []
        for name in dict.fromkeys(names):
            at = [k for k in range(table + 2, end + 1) if ledger.row_name(lines[k]) == name]
            row = ledger.cells(lines[at[0]]) if len(at) == 1 else []
            if column >= len(row) or not row[column].startswith("RUNNING"):
                refused.append(f"{name} is no single RUNNING live-agent row" + (f": it reads `{row[column]}`" if column < len(row) else ""))
                continue
            row[column] = f"PAUSED {ledger.stamp(now)}"
            lines[at[0]] = ledger.joined(row)
            said.append(f"{name} is PAUSED: a message resumes it, and the messages hook sets it RUNNING")
        if refused:
            raise ValueError("; ".join(refused))
        return said

    return ledger.update(register, edit)


def record(payload: dict[str, object], plans: Path, now: datetime.datetime | None = None) -> str | None:
    """The sent message recorded, the recipient a send resumes set RUNNING and its rows routed one by one; what the coordinator is told."""
    if "agent_id" in payload or payload.get("tool_name") != "SendMessage":
        return None
    session, sent = payload.get("session_id"), payload.get("tool_input")
    if not isinstance(session, str) or not SESSION_RE.match(session) or not isinstance(sent, dict):
        return None
    to, text = sent.get("to"), sent.get("message")
    if not isinstance(to, str) or not isinstance(text, str) or not text.strip() or to == "main":
        return None
    # A peer's `[ref]` suffix addresses the same agent.
    to = re.sub(r"\s*\[[^\]]*\]$", "", to)
    claimed = re.compile(rf"^Coordinator session id: {re.escape(session)}\s*$", re.MULTILINE)
    # Replaced rather than refused: an unreadable register the sending session never claimed stops nothing.
    registers = [path for path in sorted(plans.glob("*/REGISTER-*.md")) if claimed.search(path.read_bytes().decode("utf-8", "replace"))]
    if not registers:
        return None
    lost = f"The message to {to} is in no messages file:"
    if len(registers) > 1:
        return f"{lost} {len(registers)} registers name this session."
    register = registers[0].read_bytes().decode("utf-8")
    briefs = _briefs(register)
    if briefs is None:
        return f"{lost} the register has no `Briefs:` line."
    # The file names the agent where the send did; an id goes through the live-agent row `dispatch` wrote.
    name = to if NAME_RE.match(to) and (briefs / f"{to}-messages.md").is_file() else ledger.agent_name(register, to)
    if not name or not NAME_RE.match(name) or not (target := briefs / f"{name}-messages.md").is_file():
        return f"{lost} no `<NAME>-messages.md` in {briefs} answers to it; `reg.py dispatch` creates one."
    body = text.replace("\r\n", "\n").rstrip("\n")
    entry = f"\n## {ledger.stamp(now)} coordinator\n\n{body}\n".split("\n")

    def add(lines: list[str]) -> None:
        if not lines[-1]:
            lines.pop()
        lines += entry

    ledger.update(target, add)
    # Recorded from here on: a failure past this line is said beside the record, never as a lost send.
    said: list[str] = []
    try:
        ledger.update(registers[0], lambda lines: _wake(lines, name, now))
    except Exception as failed:
        said.append(f"its live-agent row was not set RUNNING ({type(failed).__name__}: {failed})")
    # Each line routes on its own, and each row within it: a refused row once dropped eight others with it.
    orders = [(None, _named(found)) for found in ROWS_RE.findall(text)]
    orders += [(found["owner"], _named(found["rows"])) for found in REROUTE_RE.finditer(text)]
    refused: list[str] = []
    for held_by, rows in orders:
        if not rows:
            continue
        try:
            refused += ledger.route_each(registers[0], name, rows, reroute=held_by is not None, held_by=held_by, moves=REROUTE_MOVES)[1]
        except Exception as failed:
            refused.append(str(failed))
    if refused:
        said.append(f"these rows were not routed to it: {'; '.join(refused)}")
    return f"The message to {name} is recorded; {'; '.join(said)}." if said else None


def _named(found: str) -> list[str]:
    return [row.rstrip(".") for row in re.split(r"[,\s]+", found) if row.rstrip(".")]


def live(register: Path) -> list[str]:
    """Each RUNNING live-agent row, the PAUSED ones apart, and the RUNNING count last: the fleet's gauge."""
    lines = register.read_bytes().decode("utf-8").split("\n")
    table, end = ledger.live_table(lines)
    column = ledger.status_column(lines[table])
    rows = [row for k in range(table + 2, end + 1) if column < len(row := ledger.cells(lines[k]))]
    running, paused = ([row for row in rows if row[column].startswith(state)] for state in LIVE_STATES)
    said = [f"{row[0]}  {row[column]}  {ledger.escaped(row[1])[:100]}" for row in running]
    # A paused agent spends nothing until a message resumes it, so the gauge leaves it out.
    said += [f"{len(paused)} PAUSED, outside the gauge:", *(f"  {row[0]}  {row[column]}" for row in paused)] if paused else []
    return [*said, f"{len(running)} RUNNING"]


# --- worktrees ------------------------------------------------------------------------------------


def _git(*args: str) -> str:
    done = subprocess.run(("git", *args), capture_output=True, check=False)
    if done.returncode != 0:
        raise ValueError(f"git {' '.join(args)} exited {done.returncode}: {done.stderr.decode('utf-8', 'replace').strip()}")
    return done.stdout.decode("utf-8", "replace")


def _ok(*args: str) -> bool:
    return subprocess.run(("git", *args), capture_output=True, check=False).returncode == 0


class Worktree(NamedTuple):
    path: Path
    head: str
    branch: str | None


def worktrees() -> list[Worktree]:
    """Every worktree of the repository but the one this runs in."""
    here = Path(_git("rev-parse", "--show-toplevel").strip()).resolve()
    found = []
    for block in _git("worktree", "list", "--porcelain").split("\n\n"):
        fields = {key: value for key, _, value in (line.partition(" ") for line in block.splitlines())}
        if "worktree" in fields and Path(fields["worktree"]).resolve() != here:
            found.append(
                Worktree(Path(fields["worktree"]), fields.get("HEAD", ""), fields.get("branch", "").removeprefix("refs/heads/") or None)
            )
    return found


def label(register: str, tree: Worktree) -> str:
    """The agent a worktree belongs to: its live-agent row's name, else its branch or path."""
    found = AGENT_BRANCH_RE.match(tree.branch or "")
    name = ledger.agent_name(register, found["id"]) if found else None
    return f"{name} ({tree.branch})" if name else tree.branch or str(tree.path)


def touched(tree: Worktree) -> set[str]:
    """The paths a worktree's unmerged commits change, and those its uncommitted work changes."""
    ref = tree.branch or tree.head
    paths: set[str] = set()
    if not _ok("merge-base", "--is-ancestor", ref, "HEAD"):
        paths |= set(_git("diff", "-z", "--name-only", f"HEAD...{ref}").split("\0"))
    if tree.path.is_dir():
        entries = iter(_git("-C", str(tree.path), "status", "--porcelain", "-z", "--untracked-files=all").split("\0"))
        for entry in entries:
            paths.add(entry[3:])
            # A rename or a copy names its source in the entry after it.
            if entry[:1] in ("R", "C"):
                paths.add(next(entries, ""))
    return paths - {""}


def matches(path: str, pattern: str) -> bool:
    """A repository path against a brief's path: a glob, else the path or a folder holding it."""
    pattern = pattern.replace("\\", "/").removeprefix("./")
    if GLOB_CHARS & set(pattern):
        return PurePosixPath(path).full_match(pattern)
    return path == pattern.rstrip("/") or path.startswith(pattern.rstrip("/") + "/")


def owned(brief: Path) -> list[str]:
    """The paths a brief's `Owns:` lines name, refused where it carries none."""
    found = OWNS_RE.findall(brief.read_bytes().decode("utf-8"))
    paths = [entry.strip().strip("`") for line in found for entry in line.split(", ") if entry.strip().strip("`")]
    if not paths:
        # Never the OWNERSHIP prose: a path it writes relative to its package, or bare, matches nothing, silently.
        raise ValueError(f"{brief} carries no `Owns:` line naming a path, so there is nothing to compare (brief-template.md)")
    return list(dict.fromkeys(paths))


def unresolved(patterns: list[str]) -> list[str]:
    """Each pattern no tracked path answers: a file still to be made, or a path written wrong."""
    tracked = _git("ls-files", "-z").split("\0")
    return [pattern for pattern in patterns if not any(matches(path, pattern) for path in tracked if path)]


def overlap(register: Path, patterns: list[str]) -> list[str]:
    """Each path a live worktree changes that the patterns name, with the worktree's agent."""
    text = register.read_bytes().decode("utf-8")
    shared = []
    for tree in worktrees():
        hits = sorted(path for path in touched(tree) if any(matches(path, pattern) for pattern in patterns))
        shared += [f"{path}  {label(text, tree)}" for path in hits]
    return shared


class Agent(NamedTuple):
    name: str
    status: str


def _holding(lines: list[str], register: Path) -> dict[str, list[str]] | None:
    """Each owner's ROUTED rows; None where the register holds no ledger."""
    try:
        ledger.table_under(lines, ledger.LEDGER_HEADING)
    except ValueError:
        return None
    holding: dict[str, list[str]] = {}
    for row, k in ledger.rows_at(lines, register).items():
        if ledger.status(cells := ledger.cells(lines[k])) == "ROUTED":
            holding.setdefault(ledger.owner(cells), []).append(row)
    return holding


def _resumed(agent: str, status: str, projects: Path) -> str | None:
    """Why the agent's transcript says it is working again, or may be; None where it says the agent finished."""
    found = ledger.transcripts(agent, projects)
    if len(found) > 1:
        return f"{len(found)} transcripts name it, so whether it was resumed is not known"
    if not found:
        return None
    written = datetime.datetime.fromtimestamp(found[0].stat().st_mtime).replace(second=0, microsecond=0)
    done = DONE_RE.match(status)
    with contextlib.suppress(ValueError):
        if done and written > datetime.datetime.strptime(done["stamp"], "%Y-%m-%d %H:%M"):
            return f"its transcript was written at {written:%Y-%m-%d %H:%M}, after its DONE stamp: a resumed agent"
    if stopped := ledger.mid_turn(*ledger.last_message(found[0])):
        return f"its transcript ends mid-turn, in {stopped}"
    return None


def _rebuilt(path: str, tree: Path, root: Path) -> bool:
    """Whether an ignored path is one an install, a build or the harness writes again."""
    parts = PurePosixPath(path.rstrip("/")).parts
    if REBUILT_DIRS & set(parts) or REBUILT_FILE_RE.search(parts[-1]):
        return True
    copy, own = tree / LOCAL_SETTINGS, root / LOCAL_SETTINGS
    return path == LOCAL_SETTINGS and own.is_file() and copy.read_bytes() == own.read_bytes()


def _kept(agent: str, held: Agent, tree: Worktree | None, holding: dict[str, list[str]], projects: Path, root: Path) -> str | None:
    """Why a finished agent's branch and worktree stay; None where both can go."""
    branch = f"worktree-agent-{agent}"
    if not _ok("merge-base", "--is-ancestor", branch, "HEAD"):
        return "not merged into HEAD"
    if rows := holding.get(held.name):
        return f"it still holds ROUTED rows, {', '.join(rows[:5])}" + (f" and {len(rows) - 5} more" if len(rows) > 5 else "")
    if resumed := _resumed(agent, held.status, projects):
        return resumed
    if tree is None or not tree.path.is_dir():
        return None
    # `matching` names an ignored folder without walking it, where the default walks every installed package.
    entries = [entry for entry in _git("-C", str(tree.path), "status", "--porcelain", "-z", "--ignored=matching").split("\0") if entry]
    if any(not entry.startswith("!! ") for entry in entries):
        return "it holds uncommitted work"
    # `git worktree remove` takes ignored files with the tree: a `.env` file or an audit report is nowhere else.
    if kept := [entry[3:] for entry in entries if not _rebuilt(entry[3:], tree.path, root)]:
        return f"it holds ignored files no install or build writes again: {', '.join(kept[:5])}" + (" …" if len(kept) > 5 else "")
    return None


def prune(register: Path, projects: Path) -> tuple[list[str], list[str]]:
    """Each finished agent's merged branch and clean worktree removed, each other worktree named with why; what was done, each refusal."""
    lines = register.read_bytes().decode("utf-8").split("\n")
    table, end = ledger.live_table(lines)
    column = ledger.status_column(lines[table])
    agents: dict[str, Agent] = {}
    for k in range(table + 2, end + 1):
        row = ledger.cells(lines[k])
        for agent in ledger.CODE_SPAN_RE.findall(ledger.first_cell(lines[k])):
            agents[agent] = Agent(ledger.row_name(lines[k]), row[column] if column < len(row) else "")
    holding = _holding(lines, register)
    root = Path(_git("rev-parse", "--show-toplevel").strip())
    every = worktrees()
    trees = {tree.branch: tree for tree in every if tree.branch}
    said = [] if holding is not None else ["no findings ledger, so no agent was kept for the rows it holds"]
    failed: list[str] = []
    for tree in every:
        found = AGENT_BRANCH_RE.match(tree.branch or "")
        if tree.branch is None:
            said.append(f"left {tree.path}: detached at {tree.head[:9]}, so no branch names its agent")
        elif found is None or found["id"] not in agents:
            said.append(f"left {tree.path} ({tree.branch}): no live-agent row names it")
        elif not (held := agents[found["id"]]).status.startswith("DONE"):
            said.append(f"left {tree.path} ({held.name}): its row reads `{held.status}`")
    for agent, held in agents.items():
        branch = f"worktree-agent-{agent}"
        if not held.status.startswith("DONE") or not _ok("show-ref", "--verify", "--quiet", f"refs/heads/{branch}"):
            continue
        tree = trees.get(branch)
        if reason := _kept(agent, held, tree, holding or {}, projects, root):
            said.append(f"kept {tree.path if tree else branch} ({held.name}): {reason}")
            continue
        # `remove` drops a worktree whose folder is gone as well, and `prune` would drop every other stale one with it.
        steps = [("worktree", "remove", str(tree.path))] if tree else []
        for step in [*steps, ("branch", "-d", branch)]:
            done = subprocess.run(("git", *step), capture_output=True, check=False)
            if done.returncode != 0:
                failed.append(f"git {' '.join(step)} ({held.name}) exited {done.returncode}: {done.stderr.decode('utf-8', 'replace').strip()}")
                break
        else:
            said.append(f"removed {tree.path if tree else 'no worktree'} and {branch} ({held.name})")
    return said, failed


def context(register: Path, agents: list[str], projects: Path) -> tuple[list[str], list[str]]:
    """Each agent's context at its last call, and its call count; each agent whose transcript could not be read."""
    text = register.read_bytes().decode("utf-8")
    said, refused = [], []
    for agent in agents:
        try:
            path = ledger.transcript(agent, projects)
        except ValueError as unread:
            refused.append(str(unread))
            continue
        ids: set[object] = set()
        last: dict[str, object] | None = None
        for message in ledger.calls(path):
            if isinstance(usage := message.get("usage"), dict):
                ids.add(message.get("id"))
                last = usage
        if last is None:
            refused.append(f"{path} holds no call")
            continue
        size = sum(int(str(last.get(key) or 0)) for key in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
        said.append(f"{ledger.agent_name(text, agent) or 'no live-agent row'} `{agent}`: {size:,} tokens at its last call, {len(ids)} calls")
    return said, refused


def parser() -> argparse.ArgumentParser:
    top = argparse.ArgumentParser(prog="reg.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = top.add_subparsers(dest="command", required=True)
    appending = commands.add_parser("append")
    appending.add_argument("register", type=Path)
    # Taken only to be refused by name: argparse's own refusal would not say which way works.
    appending.add_argument("text", nargs="*", help=argparse.SUPPRESS)
    appending.add_argument("--file", type=Path, help="the text, written with the Write tool; stdin where absent")
    resuming = commands.add_parser("resume")
    resuming.add_argument("register", type=Path)
    resuming.add_argument("text", nargs="*", help=argparse.SUPPRESS)
    resuming.add_argument("--file", type=Path, help="`<label>: <text>` lines, written with the Write tool; stdin where absent")
    dispatching = commands.add_parser("dispatch")
    dispatching.add_argument("register", type=Path)
    dispatching.add_argument("name")
    dispatching.add_argument("--id", dest="agent")
    dispatching.add_argument("--question", default="")
    dispatching.add_argument("--brief", type=Path, help="route the rows its `Rows:` line names to the agent")
    dispatching.add_argument("--takes", metavar="QUEUE", help="move every row routed to this queue or finished agent to the agent")
    queueing = commands.add_parser("queue")
    queueing.add_argument("register", type=Path)
    queueing.add_argument("trigger", help=f"`{WINDOW}` for the next concluded CI window, which `land.py` holds a landing for")
    queueing.add_argument("brief", type=Path)
    queueing.add_argument("--done", metavar="EVIDENCE", help="tick the row on this evidence: sent by message, or withdrawn and why")
    messaging = commands.add_parser("message")
    messaging.add_argument("plans", type=Path, help="the plans directory; the PostToolUse payload arrives on stdin")
    pausing = commands.add_parser("pause", help="each named RUNNING agent paused under /pace, which a message resumes")
    pausing.add_argument("register", type=Path)
    pausing.add_argument("names", nargs="+")
    for read in ("live", "prune"):
        commands.add_parser(read).add_argument("register", type=Path)
    overlapping = commands.add_parser("overlap")
    overlapping.add_argument("register", type=Path)
    overlapping.add_argument("paths", nargs="*")
    overlapping.add_argument("--brief", type=Path, help="the paths its `Owns:` lines name")
    reading = commands.add_parser("context")
    reading.add_argument("register", type=Path)
    reading.add_argument("agents", nargs="+")
    return top


def _message(plans: Path) -> int:
    try:
        payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        said = record(payload, plans) if isinstance(payload, dict) else None
    # Any failure reaches the coordinator: a hook that fails quietly reads exactly like one that recorded.
    except Exception as failed:
        said = f"The messages hook failed ({type(failed).__name__}: {failed}), so this message is in no messages file."
    if said:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": said}}))
    return 0


def _run(args: argparse.Namespace) -> int:
    if args.command in ("append", "resume"):
        if args.text:
            raise ValueError(
                f"{args.command} reads its text from --file <path>, written with the Write tool, or from stdin as a quoted "
                "heredoc (<<'EOF'), never from arguments: a backtick inside double quotes ran as a command and dropped its words"
            )
        text = (args.file.read_bytes() if args.file else sys.stdin.buffer.read()).decode("utf-8")
        print((append if args.command == "append" else resume)(args.register, text))
        return 0
    if args.command == "dispatch":
        said, refused = dispatch(args.register, args.name, args.agent, args.question, args.brief, args.takes)
        print("\n".join(said))
        for line in refused:
            print(f"not routed: {line}", file=sys.stderr)
        return 0
    if args.command == "queue":
        print(queue(args.register, args.trigger, args.brief, args.done))
        return 0
    if args.command == "pause":
        print("\n".join(pause(args.register, args.names)))
        return 0
    if args.command == "live":
        print("\n".join(live(args.register)))
        return 0
    if args.command == "overlap":
        if bool(args.paths) == (args.brief is not None):
            raise ValueError("overlap takes paths or --brief <file>, one of the two")
        patterns = args.paths or owned(args.brief)
        for pattern in unresolved(patterns):
            print(f"{pattern} names no tracked path: compared as written, a file still to be made or a path written wrong", file=sys.stderr)
        shared = overlap(args.register, patterns)
        print("\n".join(shared) if shared else "no live worktree changes a path of these")
        return 1 if shared else 0
    projects = Path.home() / ".claude" / "projects"
    if args.command == "prune":
        said, failed = prune(args.register, projects)
        print("\n".join(said) if said else "nothing to prune")
        for line in failed:
            print(line, file=sys.stderr)
        return 1 if failed else 0
    said, refused = context(args.register, args.agents, projects)
    print("\n".join(said))
    for line in refused:
        print(line, file=sys.stderr)
    return 2 if refused else 0


def main(argv: list[str]) -> int:
    args = parser().parse_args(argv)
    if args.command == "message":
        return _message(args.plans)
    try:
        return _run(args)
    except (ValueError, OSError) as refused:
        print(refused, file=sys.stderr)
        return 2


if __name__ == "__main__":
    # A Windows pipe takes the console's codepage, which cannot encode every character a line holds.
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
