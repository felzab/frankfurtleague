"""ORCHESTRATION · what the coordinator writes into its register's records: stamped lines and sent messages.

A typed time runs ahead of the clock, so `append` stamps an UPDATE line from it, above the marker
`register-template.md` places at the end of the resume point. An order appended to a messages file
without its send never reached its agent, so `message`, run by `.claude/hooks/orchestration-messages.sh`
after each send, writes the sent text to the recipient's messages file and routes the rows its `Rows:`
line names; where it cannot, it says so to the coordinator rather than guessing a file.

    uv run --project fl_backend --frozen python .claude/skills/orchestration/tools/reg.py append <register> <text…>
    <a PostToolUse payload> | … reg.py message <plans directory>

`append` reads its text from stdin when none is given, and exits 0 written, 2 refused: no text, or
not exactly one marker. `message` always exits 0, a hook's failure being the send's.
"""

from __future__ import annotations

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


def append(register: Path, text: str, now: datetime.datetime | None = None) -> str:
    """The register with one stamped line above its marker, written; the line."""
    body = " ".join(text.split())
    if not body:
        raise ValueError("no text to append")
    content = register.read_bytes().decode("utf-8")
    lines = content.split("\n")
    at = [k for k, line in enumerate(lines) if line.strip() == MARKER]
    if len(at) != 1:
        raise ValueError(f"{register} holds {len(at)} copies of the marker line, where one says where the line goes: {MARKER}")
    line = f"UPDATE {stamp(now)}: {body}"
    # The marker's own ending, so a register written with carriage returns keeps them on every line.
    lines.insert(at[0], line + ("\r" if lines[at[0]].endswith("\r") else ""))
    # Written beside the register and renamed over it, so an interrupted write leaves the old register whole.
    spare = register.with_name(register.name + ".writing")
    spare.write_bytes("\n".join(lines).encode("utf-8"))
    os.replace(spare, register)
    return line


def _agent_name(register: str, to: str) -> str | None:
    """The live-agent row naming the recipient by name or by id; None where no row does."""
    lines = register.split("\n")
    heading = next((k for k, line in enumerate(lines) if line.startswith(LIVE_HEADING)), None)
    names: set[str] = set()
    for line in lines[heading + 1 :] if heading is not None else []:
        if line.startswith("## "):
            break
        first = line.split("|")[1].strip() if line.startswith("|") and line.count("|") > 2 else ""
        name = first.split()[0].strip("`*") if first.split() else ""
        if name and (to == name or f"`{to}`" in first):
            names.add(name)
    if len(names) > 1:
        raise ValueError(f"live-agent rows give {to} two names: {', '.join(sorted(names))}")
    return names.pop() if names else None


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
    registers = [path for path in sorted(plans.glob("*/REGISTER-*.md")) if claimed.search(path.read_bytes().decode("utf-8"))]
    if not registers:
        return None
    if len(registers) > 1:
        return f"The message to {to} is in no messages file: {len(registers)} registers name this session."
    register = registers[0].read_bytes().decode("utf-8")
    try:
        name = _agent_name(register, to)
    except ValueError as ambiguous:
        return f"The message to {to} is in no messages file: {ambiguous}."
    if name is None:
        return None
    briefs = BRIEFS_RE.search(register)
    target = Path(briefs["path"]) / f"{name}-messages.md" if briefs and NAME_RE.match(name) else None
    if target is None or not target.is_file():
        return f"The message to {name} is in no messages file: {target or 'the register has no Briefs: line'} is not a file."
    held = target.read_bytes()
    lead = b"" if held.endswith(b"\n") or not held else b"\n"
    body = text.replace("\r\n", "\n").rstrip("\n")
    target.write_bytes(held + lead + f"\n## {stamp(now)} coordinator\n\n{body}\n".encode())
    rows = [row for found in ROWS_RE.findall(text) for row in re.split(r"[,\s]+", found) if row]
    if rows:
        try:
            ledger.route(registers[0], name, rows)
        except ValueError as refused:
            return f"The message to {name} is recorded, and its Rows: line routed nothing: {refused}."
    return None


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == "message":
        try:
            payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        except ValueError:
            return 0
        said = record(payload, Path(argv[1])) if isinstance(payload, dict) else None
        if said:
            print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": said}}))
        return 0
    if len(argv) < 2 or argv[0] != "append":
        print(__doc__, file=sys.stderr)
        return 2
    text = " ".join(argv[2:]) if len(argv) > 2 else sys.stdin.buffer.read().decode("utf-8")
    try:
        print(append(Path(argv[1]), text))
    except ValueError as refused:
        print(refused, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    # A Windows pipe takes the console's codepage, which cannot encode every character a line holds.
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
