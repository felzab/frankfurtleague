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
    queue <register> <trigger> <brief>
    message <plans directory>
    live <register>
    prune <register>
    overlap <register> (<path>… | --brief <file>)
    context <register> <agent id>…

Exit 0 done, 2 refused; `overlap` 1 while a path is shared; `prune` 1 where git refused a removal;
`message` always 0, a hook's failure being the send's.
"""

from __future__ import annotations

import argparse
import datetime
import io
import json
import re
import subprocess
import sys
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
SECTION_RE: Final = re.compile(r"^\s*(?:\d+\s+)?[A-Z][A-Z ]*[A-Z][.:](?:\s|$)")
OWNERSHIP_RE: Final = re.compile(r"^\s*(?:\d+\s+)?OWNERSHIP[.:]")
PATH_TOKEN_RE: Final = re.compile(r"(?<![\w./*@-])(?:\./)?[\w.@*-]+(?:/[\w.@*-]+)+/?")
AGENT_BRANCH_RE: Final = re.compile(r"^worktree-agent-(?P<id>[A-Za-z0-9]+)$")
GLOB_CHARS: Final = frozenset("*?[")


def append(register: Path, text: str, now: datetime.datetime | None = None) -> str:
    """The register with one stamped line above its marker, written; the line."""
    lines = register.read_bytes().decode("utf-8").split("\n")
    line = _update(lines, text, now)
    ledger.write(register, lines)
    return line


def _update(lines: list[str], text: str, now: datetime.datetime | None) -> str:
    body = " ".join(text.split())
    if not body:
        raise ValueError("no text to append")
    at = [k for k, line in enumerate(lines) if line.strip() == MARKER]
    if len(at) != 1:
        raise ValueError(f"the register holds {len(at)} copies of the marker line, where one says where the line goes: {MARKER}")
    line = f"UPDATE {ledger.stamp(now)}: {body}"
    # The marker's own ending, so a register written with carriage returns keeps them on every line.
    lines.insert(at[0], line + ("\r" if lines[at[0]].endswith("\r") else ""))
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
    lines = register.read_bytes().decode("utf-8").split("\n")
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
        k = held[label][0]
        lines[k] = f"{label}: {value}".rstrip() + ("\r" if lines[k].endswith("\r") else "")
    line = _update(lines, f"resume point rewritten: {'; '.join(given)}", now)
    ledger.write(register, lines)
    return line


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


def queue(register: Path, trigger: str, brief: Path) -> str:
    """A standing action naming the brief added under its trigger; what was done."""
    trigger = " ".join(trigger.split())
    if not trigger or not brief.is_file():
        raise ValueError(f"a standing action needs a trigger and a saved brief: {brief} is no file" if trigger else "the trigger is empty")
    lines = register.read_bytes().decode("utf-8").split("\n")
    table, end = standing_table(lines)
    target = brief.resolve()
    for k in range(table + 2, end + 1):
        row = ledger.cells(lines[k])
        if unticked(row) and row[0] == ledger.escaped(trigger) and _same_file(row[1], target):
            return f"already queued: {trigger} -> {target}"
    lines.insert(end + 1, ledger.joined([ledger.escaped(trigger), f"`{target}`", ""]))
    ledger.write(register, lines)
    return f"queued {target.name} for {trigger}"


def _tick(lines: list[str], target: Path, name: str, now: datetime.datetime | None) -> list[str]:
    """Each unticked standing action naming the brief ticked in `lines`; what was done."""
    try:
        table, end = standing_table(lines)
    except ValueError:
        return []
    said = []
    for k in range(table + 2, end + 1):
        row = ledger.cells(lines[k])
        if unticked(row) and _same_file(row[1], target):
            row[2] = f"yes {ledger.stamp(now)} (`reg.py dispatch {name}`)"
            lines[k] = ledger.joined(row)
            said.append(f"ticked the standing action `{row[0]}` for {target.name}")
    return said


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
    text = register.read_bytes().decode("utf-8")
    briefs = _briefs(text)
    if briefs is None or not briefs.is_dir():
        raise ValueError(f"the register's `Briefs:` line names no directory ({briefs}): add one under its header")
    if brief is not None and not brief.is_file():
        raise ValueError(f"{brief} is no brief file")
    lines = text.split("\n")
    table, end = ledger.live_table(lines)
    column = ledger.status_column(lines[table])
    said: list[str] = []
    first = f"{name} `{agent}`" if agent else name
    row = next((k for k in range(table + 2, end + 1) if ledger.row_name(lines[k]) == name), None)
    if row is not None:
        if agent and f"`{agent}`" not in ledger.first_cell(lines[row]):
            parts = lines[row].split("|")
            parts[1] = f" {first} "
            lines[row] = "|".join(parts)
            said.append(f"named {agent} in {name}'s live-agent row")
        held = ledger.cells(lines[row])
        # A finished agent sent another round is live again: its gauge and its stale-row check read this cell.
        if agent and column < len(held) and held[column].startswith("DONE"):
            held[column] = f"RUNNING ({ledger.stamp(now)})"
            lines[row] = ledger.joined(held)
            said.append(f"set {name}'s live-agent row RUNNING again: a resume")
    else:
        width = lines[table].count("|") - 1
        made = [first, question, *[""] * max(width - 3, 0), f"RUNNING ({ledger.stamp(now)})"][:width]
        lines.insert(end + 1, "| " + " | ".join(made) + " |")
        said.append(f"added {name}'s live-agent row")
    said += _tick(lines, (brief or briefs / f"{name}.md").resolve(), name, now)
    rows = brief_rows(brief) if brief else []
    if brief is not None and not rows:
        said.append(f"{brief.name} carries no `Rows:` line, so it routed no row")
    refused = _take_rows(register, lines, name, rows, takes, said)
    messages = briefs / f"{name}-messages.md"
    if not messages.exists():
        messages.write_bytes(f"# {name} -- messages after the brief\n".encode())
        said.insert(0, f"created {messages}")
    ledger.write(register, lines)
    return said, refused


def _take_rows(register: Path, lines: list[str], name: str, rows: list[str], takes: str | None, said: list[str]) -> list[str]:
    """The brief's rows and every row routed to `takes` routed to the agent in `lines`; each refusal."""
    if not rows and takes is None:
        return []
    at = ledger.rows_at(lines, register)
    ledger.check_owner(lines, name)
    moved, refused = ledger.route_lines(lines, at, name, rows)
    if takes is not None:
        # A live fixer's rows are in flight: taken in silence, two agents would fix one finding.
        if takes != name and _running(lines, takes):
            raise ValueError(f"{takes} is a RUNNING agent: its rows stay with it until it reports")
        held = [row for row, k in at.items() if ledger.status(cells := ledger.cells(lines[k])) == "ROUTED" and ledger.owner(cells) == takes]
        taken, more = ledger.route_lines(lines, at, name, held, reroute=True, held_by=takes)
        moved, refused = moved + taken, refused + more
        if not held:
            said.append(f"no row is routed to {takes}")
    said += [f"ROUTED {row} to {name}" for row in moved]
    return refused


def _running(lines: list[str], name: str) -> bool:
    table, end = ledger.live_table(lines)
    column = ledger.status_column(lines[table])
    rows = (ledger.cells(lines[k]) for k in range(table + 2, end + 1) if ledger.row_name(lines[k]) == name)
    return any(column < len(row) and row[column].startswith("RUNNING") for row in rows)


def record(payload: dict[str, object], plans: Path, now: datetime.datetime | None = None) -> str | None:
    """The sent message written to its recipient's messages file and its rows routed one by one; what the coordinator is told, if anything."""
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
    held = target.read_bytes()
    lead = b"" if held.endswith(b"\n") or not held else b"\n"
    body = text.replace("\r\n", "\n").rstrip("\n")
    target.write_bytes(held + lead + f"\n## {ledger.stamp(now)} coordinator\n\n{body}\n".encode())
    # Each line routes on its own, and each row within it: a refused row once dropped eight others with it.
    orders = [(None, _named(found)) for found in ROWS_RE.findall(text)]
    orders += [(found["owner"], _named(found["rows"])) for found in REROUTE_RE.finditer(text)]
    refused: list[str] = []
    for held_by, rows in orders:
        if not rows:
            continue
        try:
            refused += ledger.route_each(registers[0], name, rows, reroute=held_by is not None, held_by=held_by)[1]
        except ValueError as failed:
            refused.append(str(failed))
    return f"The message to {name} is recorded; these rows were not routed to it: {'; '.join(refused)}." if refused else None


def _named(found: str) -> list[str]:
    return [row.rstrip(".") for row in re.split(r"[,\s]+", found) if row.rstrip(".")]


def live(register: Path) -> list[str]:
    """Each RUNNING live-agent row, then their count: the fleet's gauge."""
    lines = register.read_bytes().decode("utf-8").split("\n")
    table, end = ledger.live_table(lines)
    column = ledger.status_column(lines[table])
    running = [row for k in range(table + 2, end + 1) if column < len(row := ledger.cells(lines[k])) and row[column].startswith("RUNNING")]
    said = [f"{row[0]}  {row[column]}  {ledger.escaped(row[1])[:100]}" for row in running]
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


def brief_paths(brief: Path, root: Path) -> list[str]:
    """The repository paths a brief's OWNERSHIP section names, a token counted only where its first folder exists."""
    lines = brief.read_bytes().decode("utf-8").splitlines()
    start = next((k for k, line in enumerate(lines) if OWNERSHIP_RE.match(line)), None)
    if start is None:
        raise ValueError(f"{brief} has no OWNERSHIP section")
    end = next((k for k in range(start + 1, len(lines)) if SECTION_RE.match(lines[k]) or lines[k].startswith("#")), len(lines))
    tokens = (token.rstrip(".,;:)") for line in lines[start:end] for token in PATH_TOKEN_RE.findall(OWNERSHIP_RE.sub("", line)))
    paths = list(
        dict.fromkeys(token for token in tokens if not GLOB_CHARS & set(token.split("/")[0]) and (root / token.split("/")[0]).exists())
    )
    if not paths:
        raise ValueError(f"{brief}'s OWNERSHIP section names no repository path")
    return paths


def overlap(register: Path, patterns: list[str]) -> list[str]:
    """Each path a live worktree changes that the patterns name, with the worktree's agent."""
    text = register.read_bytes().decode("utf-8")
    shared = []
    for tree in worktrees():
        hits = sorted(path for path in touched(tree) if any(matches(path, pattern) for pattern in patterns))
        shared += [f"{path}  {label(text, tree)}" for path in hits]
    return shared


def prune(register: Path) -> tuple[list[str], list[str]]:
    """Each DONE agent's merged branch and clean worktree removed; what was done, and each removal git refused."""
    lines = register.read_bytes().decode("utf-8").split("\n")
    table, end = ledger.live_table(lines)
    column = ledger.status_column(lines[table])
    trees = {tree.branch: tree for tree in worktrees() if tree.branch}
    said, failed = [], []
    for k in range(table + 2, end + 1):
        if column >= len(row := ledger.cells(lines[k])) or not row[column].startswith("DONE"):
            continue
        name = ledger.row_name(lines[k])
        for agent in ledger.CODE_SPAN_RE.findall(ledger.first_cell(lines[k])):
            branch = f"worktree-agent-{agent}"
            if not _ok("show-ref", "--verify", "--quiet", f"refs/heads/{branch}"):
                continue
            if not _ok("merge-base", "--is-ancestor", branch, "HEAD"):
                said.append(f"kept {branch} ({name}): not merged into HEAD")
                continue
            tree = trees.get(branch)
            if tree is not None and tree.path.is_dir() and _git("-C", str(tree.path), "status", "--porcelain").strip():
                said.append(f"kept {tree.path} ({name}): it holds uncommitted work")
                continue
            # A worktree whose folder is gone is pruned from git's records rather than removed.
            steps = [("worktree", "remove", str(tree.path)) if tree.path.is_dir() else ("worktree", "prune")] if tree else []
            for step in [*steps, ("branch", "-d", branch)]:
                done = subprocess.run(("git", *step), capture_output=True, check=False)
                if done.returncode != 0:
                    failed.append(f"git {' '.join(step)} ({name}) exited {done.returncode}: {done.stderr.decode('utf-8', 'replace').strip()}")
                    break
            else:
                said.append(f"removed {tree.path if tree else 'no worktree'} and {branch} ({name})")
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


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="reg.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
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
    messaging = commands.add_parser("message")
    messaging.add_argument("plans", type=Path, help="the plans directory; the PostToolUse payload arrives on stdin")
    for read in ("live", "prune"):
        commands.add_parser(read).add_argument("register", type=Path)
    overlapping = commands.add_parser("overlap")
    overlapping.add_argument("register", type=Path)
    overlapping.add_argument("paths", nargs="*")
    overlapping.add_argument("--brief", type=Path, help="the paths its OWNERSHIP section names")
    reading = commands.add_parser("context")
    reading.add_argument("register", type=Path)
    reading.add_argument("agents", nargs="+")
    return parser


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
        print(queue(args.register, args.trigger, args.brief))
        return 0
    if args.command == "live":
        print("\n".join(live(args.register)))
        return 0
    if args.command == "overlap":
        if bool(args.paths) == (args.brief is not None):
            raise ValueError("overlap takes paths or --brief <file>, one of the two")
        root = Path(_git("rev-parse", "--show-toplevel").strip())
        shared = overlap(args.register, args.paths or brief_paths(args.brief, root))
        print("\n".join(shared) if shared else "no live worktree changes a path of these")
        return 1 if shared else 0
    if args.command == "prune":
        said, failed = prune(args.register)
        print("\n".join(said) if said else "nothing to prune")
        for line in failed:
            print(line, file=sys.stderr)
        return 1 if failed else 0
    said, refused = context(args.register, args.agents, Path.home() / ".claude" / "projects")
    print("\n".join(said))
    for line in refused:
        print(line, file=sys.stderr)
    return 2 if refused else 0


def main(argv: list[str]) -> int:
    args = _parser().parse_args(argv)
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
