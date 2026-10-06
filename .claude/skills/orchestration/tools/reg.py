"""ORCHESTRATION · what the coordinator writes into its register's records: stamped lines, dispatches and sent messages.

A typed time runs ahead of the clock, so `append` stamps an UPDATE line from it, above the marker
`register-template.md` places at the end of the resume point. `dispatch` creates an agent's messages
file and its live-agent row in one step, so neither waits on memory. An order appended to a messages
file without its send never reached its agent, so `message`, run by
`.claude/hooks/orchestration-messages.sh` after each send, writes the sent text to the recipient's
messages file and routes the rows its `Rows:` line names; whatever it cannot record it says to the
coordinator, staying silent only for a session no register claims.

    uv run --project fl_backend --frozen python .claude/skills/orchestration/tools/reg.py <command>

    append <register> <text…>            the text from stdin when none is given
    dispatch <register> <NAME> [--id <agent id>] [--question <text>]
    message <plans directory>            a PostToolUse payload on stdin

Exit 0 written, 2 refused; `message` always exits 0, a hook's failure being the send's.
"""

from __future__ import annotations

import argparse
import datetime
import io
import json
import os
import re
import sys
from pathlib import Path
from typing import Final

# Run as a script, python seeds this file's own directory on the path.
import ledger

MARKER: Final = "<!-- reg.py appends UPDATE lines above this line -->"
SESSION_RE: Final = re.compile(r"^[A-Za-z0-9_-]+$")
NAME_RE: Final = re.compile(r"^[A-Za-z0-9_.-]+$")
BRIEFS_RE: Final = re.compile(r"^Briefs:\s*`?(?P<path>[^`]+?)`?\s*$", re.MULTILINE)
ROWS_RE: Final = re.compile(r"^Rows:\s*(?P<rows>.+)$", re.MULTILINE)
LIVE_HEADING: Final = "## Live agents"


def stamp(now: datetime.datetime | None = None) -> str:
    """The local wall-clock minute, dated: a register outlives midnight."""
    return (now or datetime.datetime.now().astimezone()).strftime("%Y-%m-%d %H:%M")


def _write(path: Path, lines: list[str]) -> None:
    # Written beside the register and renamed over it, so an interrupted write leaves the old register whole.
    spare = path.with_name(path.name + ".writing")
    spare.write_bytes("\n".join(lines).encode("utf-8"))
    os.replace(spare, path)


def append(register: Path, text: str, now: datetime.datetime | None = None) -> str:
    """The register with one stamped line above its marker, written; the line."""
    body = " ".join(text.split())
    if not body:
        raise ValueError("no text to append")
    lines = register.read_bytes().decode("utf-8").split("\n")
    at = [k for k, line in enumerate(lines) if line.strip() == MARKER]
    if len(at) != 1:
        raise ValueError(f"{register} holds {len(at)} copies of the marker line, where one says where the line goes: {MARKER}")
    line = f"UPDATE {stamp(now)}: {body}"
    # The marker's own ending, so a register written with carriage returns keeps them on every line.
    lines.insert(at[0], line + ("\r" if lines[at[0]].endswith("\r") else ""))
    _write(register, lines)
    return line


def _live_rows(lines: list[str]) -> tuple[int, int]:
    """The live-agent table's header index and its last row's index."""
    heading = next((k for k, line in enumerate(lines) if line.startswith(LIVE_HEADING)), -1)
    table = next((k for k in range(heading + 1, len(lines)) if lines[k].startswith("|")), -1) if heading != -1 else -1
    if table == -1 or any(lines[k].startswith("## ") for k in range(heading + 1, table)):
        raise ValueError(f"no table under `{LIVE_HEADING}` in the register")
    end = table
    while end + 1 < len(lines) and lines[end + 1].startswith("|"):
        end += 1
    return table, end


def _first_cell(line: str) -> str:
    return line.split("|")[1].strip() if line.startswith("|") and line.count("|") > 2 else ""


def agent_name(register: str, to: str) -> str | None:
    """The name of the live-agent row naming `to` by name or by its backticked id; None where no row does."""
    lines = register.split("\n")
    try:
        table, end = _live_rows(lines)
    except ValueError:
        return None
    names: set[str] = set()
    for line in lines[table + 2 : end + 1]:
        first = _first_cell(line)
        name = first.split()[0].strip("`*") if first.split() else ""
        if name and (to == name or f"`{to}`" in first):
            names.add(name)
    if len(names) > 1:
        raise ValueError(f"live-agent rows give {to} two names: {', '.join(sorted(names))}")
    return names.pop() if names else None


def _briefs(register: str) -> Path | None:
    found = BRIEFS_RE.search(register)
    return Path(found["path"]) if found else None


def dispatch(register: Path, name: str, agent: str | None = None, question: str = "", now: datetime.datetime | None = None) -> list[str]:
    """The agent's messages file created where missing and its live-agent row written; what was done."""
    if not NAME_RE.match(name) or (agent is not None and not ledger.AGENT_ID_RE.match(agent)):
        raise ValueError(f"{name!r} or {agent!r} is no agent name or id")
    text = register.read_bytes().decode("utf-8")
    briefs = _briefs(text)
    if briefs is None or not briefs.is_dir():
        raise ValueError(f"the register's `Briefs:` line names no directory ({briefs}): add one under its header")
    lines = text.split("\n")
    table, end = _live_rows(lines)
    said = []
    messages = briefs / f"{name}-messages.md"
    if not messages.exists():
        messages.write_bytes(f"# {name} -- messages after the brief\n".encode())
        said.append(f"created {messages}")
    first = f"{name} `{agent}`" if agent else name
    row = next((k for k in range(table + 2, end + 1) if (_first_cell(lines[k]).split() or [""])[0].strip("`*") == name), None)
    if row is not None:
        if agent and f"`{agent}`" not in _first_cell(lines[row]):
            cells = lines[row].split("|")
            cells[1] = f" {first} "
            lines[row] = "|".join(cells)
            said.append(f"named {agent} in {name}'s live-agent row")
    else:
        width = lines[table].count("|") - 1
        cells = [first, question, *[""] * max(width - 3, 0), f"RUNNING ({stamp(now)})"][:width]
        lines.insert(end + 1, "| " + " | ".join(cells) + " |")
        said.append(f"added {name}'s live-agent row")
    _write(register, lines)
    return said


def record(payload: dict[str, object], plans: Path, now: datetime.datetime | None = None) -> str | None:
    """The sent message written to its recipient's messages file and its rows routed; what the coordinator is told, if anything."""
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
    name = to if NAME_RE.match(to) and (briefs / f"{to}-messages.md").is_file() else agent_name(register, to)
    target = briefs / f"{name}-messages.md" if name and NAME_RE.match(name) else None
    if target is None or not target.is_file():
        return f"{lost} no `<NAME>-messages.md` in {briefs} answers to it; `reg.py dispatch` creates one."
    held = target.read_bytes()
    lead = b"" if held.endswith(b"\n") or not held else b"\n"
    body = text.replace("\r\n", "\n").rstrip("\n")
    target.write_bytes(held + lead + f"\n## {stamp(now)} coordinator\n\n{body}\n".encode())
    rows = [row for found in ROWS_RE.findall(text) for row in re.split(r"[,\s]+", found) if row]
    if rows:
        try:
            ledger.route(registers[0], name or to, rows)
        except ValueError as refused:
            return f"The message to {name} is recorded, and its Rows: line routed nothing: {refused}."
    return None


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="reg.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    appending = commands.add_parser("append")
    appending.add_argument("register", type=Path)
    appending.add_argument("text", nargs="*")
    dispatching = commands.add_parser("dispatch")
    dispatching.add_argument("register", type=Path)
    dispatching.add_argument("name")
    dispatching.add_argument("--id", dest="agent")
    dispatching.add_argument("--question", default="")
    messaging = commands.add_parser("message")
    messaging.add_argument("plans", type=Path)
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


def main(argv: list[str]) -> int:
    args = _parser().parse_args(argv)
    if args.command == "message":
        return _message(args.plans)
    try:
        if args.command == "dispatch":
            for line in dispatch(args.register, args.name, args.agent, args.question):
                print(line)
        else:
            print(append(args.register, " ".join(args.text) if args.text else sys.stdin.buffer.read().decode("utf-8")))
    except (ValueError, OSError) as refused:
        print(refused, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    # A Windows pipe takes the console's codepage, which cannot encode every character a line holds.
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
