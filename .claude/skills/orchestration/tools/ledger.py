"""ORCHESTRATION · the findings ledger: one row per labelled finding, each routed to one owner.

A finding routed from memory drops out while its report sits banked, so `bank` writes one OPEN row
per `F<n>` label, `route` moves rows to one owner and refuses a second, and the ending runs `open`
until it prints nothing. A report with no label banks nothing and says so, since a silent zero reads
exactly like a report with nothing in it.

    uv run --project fl_backend --frozen python .claude/skills/orchestration/tools/ledger.py <command>

    bank <register> <report> [--from <agent id>] [--none] [--as <name>]
    route <register> <agent> <row>… [--reroute]
    open <register>

`--from` first saves the agent's final message from its transcript as `<report>`, never over a file
already there. Rows are named after the report's file; `--as` names a second report under a banked
name. Exit 0 done, 2 refused, 3 a report with no label and no `--none`, and `open` 1 while a row is OPEN.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
from pathlib import Path
from typing import Final

LEDGER_HEADING: Final = "## Findings ledger"
# A finding opens a line with its label, behind at most a heading, list or table marker and bold.
LABEL_RE: Final = re.compile(r"^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|\|\s*)?(?:\*\*|__)?F(?P<n>\d+)\b(?P<rest>.*)$")
# Other ways a report numbers its findings, counted when no label is found.
OTHER_SHAPE_RE: Final = re.compile(r"^\s{0,3}(?:(?:#{1,6}\s+)?(?:\*\*|__)\d+[.)]|\|\s*\d+\s*\|)")
SUMMARY_CHARS: Final = 160
# The template's statuses that end a row's life; ROUTED and OPEN are the two that do not.
CLOSED: Final = frozenset({"FIXED", "RULED", "HANDOFF", "NOT", "MOOT", "CLOSED"})
CELL_SPLIT_RE: Final = re.compile(r"(?<!\\)\|")
CODE_SPAN_RE: Final = re.compile(r"`([^`]+)`")
AGENT_ID_RE: Final = re.compile(r"^[A-Za-z0-9]+$")


def findings(report: str) -> dict[int, str]:
    """Each labelled finding's first line, by number, the first occurrence of a number winning."""
    found: dict[int, str] = {}
    fenced = False
    for line in report.splitlines():
        if line.lstrip().startswith("```"):
            fenced = not fenced
            continue
        labelled = None if fenced else LABEL_RE.match(line)
        if labelled is None:
            continue
        summary = re.sub(r"[*_`]{2,}|^[\s.:|)\-–—]+", "", labelled["rest"]).strip(" |")
        found.setdefault(int(labelled["n"]), summary)
    return found


def other_shapes(report: str) -> int:
    return sum(1 for line in report.splitlines() if OTHER_SHAPE_RE.match(line))


def _cell(text: str) -> str:
    text = " ".join(text.split()).replace("|", "\\|")
    return text if len(text) <= SUMMARY_CHARS else text[: SUMMARY_CHARS - 1] + "…"


def _ledger_rows(lines: list[str]) -> tuple[int, int]:
    """The index of the ledger table's last line and the index of its heading."""
    # A heading may carry a note after its name, as a register continuing an earlier ledger does.
    heading = next((k for k, line in enumerate(lines) if line.strip().startswith(LEDGER_HEADING)), -1)
    if heading == -1:
        raise ValueError(f"no `{LEDGER_HEADING}` heading in the register")
    table = next((k for k in range(heading + 1, len(lines)) if lines[k].startswith("|")), -1)
    if table == -1 or any(lines[k].startswith("## ") for k in range(heading + 1, table)):
        raise ValueError(f"no table under `{LEDGER_HEADING}`")
    end = table
    while end + 1 < len(lines) and lines[end + 1].startswith("|"):
        end += 1
    return end, heading


def _cells(line: str) -> list[str]:
    return [cell.strip() for cell in CELL_SPLIT_RE.split(line.strip())[1:-1]]


def _status(cells: list[str]) -> str:
    return (cells[3].split() or [""])[0].upper() if len(cells) == 5 else ""


def _write(path: Path, lines: list[str]) -> None:
    # Beside the register and renamed over it, so an interrupted write leaves the old register whole.
    spare = path.with_name(path.name + ".writing")
    spare.write_bytes("\n".join(lines).encode("utf-8"))
    os.replace(spare, path)


def _spans(text: str) -> set[str]:
    """The code spans a finding names, a call's parentheses and a path's folders dropped."""
    return {span.removesuffix("()").rsplit("/", 1)[-1] for span in CODE_SPAN_RE.findall(text)}


def repeats(register: Path, added: list[str]) -> list[str]:
    """Each banked row naming two code spans an earlier unclosed row names too: one finding several lenses reported."""
    lines = register.read_bytes().decode("utf-8").split("\n")
    end, heading = _ledger_rows(lines)
    new = {_cells(row)[0] for row in added}
    earlier = [cells for line in lines[heading + 1 : end + 1] if len(cells := _cells(line)) == 5 and cells[0] not in new]
    said: list[str] = []
    for row in added:
        name, summary = _cells(row)[0], _cells(row)[2]
        for cells in earlier:
            shared = sorted(_spans(summary) & _spans(cells[2]))
            if len(shared) >= 2 and _status(cells) not in CLOSED:
                said.append(f"{name} may repeat {cells[0]} ({cells[3]} {cells[4]}): both name {', '.join(f'`{span}`' for span in shared)}")
    return said


def bank(register: Path, report: Path, declared_none: bool = False, name: str | None = None) -> list[str]:
    """One OPEN row per labelled finding, written; the rows added."""
    text = report.read_bytes().decode("utf-8")
    labelled = findings(text)
    if not labelled:
        if declared_none:
            return []
        shapes = other_shapes(text)
        raise LookupError(
            f"{report.name} labels no finding F<n>"
            + (f", and numbers {shapes} line(s) in another shape: bank those by hand or have them relabelled" if shapes else "")
            + "; pass --none for a report with no finding"
        )
    source = name or report.name.removesuffix(".md").removesuffix("-report")
    lines = register.read_bytes().decode("utf-8").split("\n")
    end, heading = _ledger_rows(lines)
    # Every report numbers from F1, so a second report under a banked name would bank only the labels
    # past the first one's highest and drop the rest in silence.
    if any(line.startswith(f"| {source}-F") for line in lines[heading : end + 1]):
        raise ValueError(f"the ledger already holds rows for {source}: bank a second report under another name with --as")
    added = [f"| {source}-F{n} | {report.name} | {_cell(summary)} | OPEN | |" for n, summary in sorted(labelled.items())]
    lines[end + 1 : end + 1] = added
    _write(register, lines)
    return added


def final_message(agent: str, projects: Path) -> str:
    """The text of the last assistant message in the agent's transcript, which is its report."""
    if not AGENT_ID_RE.match(agent):
        raise ValueError(f"{agent!r} is no agent id")
    found = sorted(projects.glob(f"*/*/subagents/agent-{agent}.jsonl"))
    if len(found) != 1:
        raise ValueError(f"{len(found)} transcripts under {projects} for agent {agent}")
    last_id, parts = None, []
    for raw in found[0].read_bytes().splitlines():
        try:
            message = json.loads(raw).get("message") or {}
        except ValueError:
            continue
        blocks = message.get("content") if message.get("role") == "assistant" else None
        texts = [block.get("text", "") for block in blocks or [] if isinstance(block, dict) and block.get("type") == "text"]
        if not texts:
            continue
        # One message reaches the transcript as several lines sharing its id.
        if message.get("id") != last_id:
            last_id, parts = message.get("id"), []
        parts += texts
    if not parts:
        raise ValueError(f"no final message in {found[0]}")
    return "".join(parts)


def save(report: Path, agent: str, projects: Path) -> None:
    # A resumed agent's next reply is a report of its own: written over the first, it erased it.
    if report.exists():
        raise ValueError(f"{report} already exists: save a later round under its own name, such as <NAME>-r2-report.md")
    text = final_message(agent, projects)
    report.write_bytes((text.rstrip("\n") + "\n").encode("utf-8"))


def route(register: Path, agent: str, rows: list[str], reroute: bool = False) -> list[str]:
    """Each row ROUTED to the agent, all or none; the rows that moved."""
    lines = register.read_bytes().decode("utf-8").split("\n")
    end, heading = _ledger_rows(lines)
    at = {cells[0]: k for k in range(heading + 1, end + 1) if len(cells := _cells(lines[k])) == 5}
    refused, moved = [], []
    for row in rows:
        if row not in at:
            refused.append(f"{row} is no ledger row")
            continue
        cells = _cells(lines[at[row]])
        status, owner = _status(cells), (cells[4].split() or [""])[0]
        if status in CLOSED:
            refused.append(f"{row} is closed: {cells[3]} {cells[4]}")
        elif status == "ROUTED" and owner != agent and not reroute:
            refused.append(f"{row} is routed to {owner} already: one finding, one owner (--reroute moves it)")
        elif not (status == "ROUTED" and owner == agent):
            note = cells[4] if status == "OPEN" else ""
            cells[3:5] = ["ROUTED", f"{agent}; {note}" if note else agent]
            lines[at[row]] = "| " + " | ".join(cells) + " |"
            moved.append(row)
    if refused:
        raise ValueError("; ".join(refused))
    if moved:
        _write(register, lines)
    return moved


def close(register: Path, rows: list[str], evidence: str) -> list[str]:
    """Each named row still ROUTED set FIXED with the evidence; the rows closed."""
    lines = register.read_bytes().decode("utf-8").split("\n")
    end, heading = _ledger_rows(lines)
    closed = []
    for k in range(heading + 1, end + 1):
        cells = _cells(lines[k])
        if len(cells) == 5 and cells[0] in rows and _status(cells) == "ROUTED":
            cells[3:5] = [f"FIXED ({evidence})", f"was {cells[4]}"]
            lines[k] = "| " + " | ".join(cells) + " |"
            closed.append(cells[0])
    if closed:
        _write(register, lines)
    return closed


def row_ids(register: Path) -> set[str]:
    lines = register.read_bytes().decode("utf-8").split("\n")
    end, heading = _ledger_rows(lines)
    return {cells[0] for line in lines[heading + 1 : end + 1] if len(cells := _cells(line)) == 5}


def gaps(report: Path) -> list[int]:
    numbers = sorted(findings(report.read_bytes().decode("utf-8")))
    return [n for n in range(1, numbers[-1] + 1) if n not in numbers] if numbers else []


def open_rows(register: Path) -> list[str]:
    lines = register.read_bytes().decode("utf-8").split("\n")
    end, heading = _ledger_rows(lines)
    return [line for line in lines[heading + 1 : end + 1] if re.search(r"\|\s*OPEN\s*\|", line)]


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ledger.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    banking = commands.add_parser("bank")
    banking.add_argument("register", type=Path)
    banking.add_argument("report", type=Path)
    banking.add_argument("--from", dest="agent")
    banking.add_argument("--none", action="store_true")
    banking.add_argument("--as", dest="name")
    routing = commands.add_parser("route")
    routing.add_argument("register", type=Path)
    routing.add_argument("agent")
    routing.add_argument("rows", nargs="+")
    routing.add_argument("--reroute", action="store_true")
    opening = commands.add_parser("open")
    opening.add_argument("register", type=Path)
    return parser


def main(argv: list[str]) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "bank":
            if args.agent:
                save(args.report, args.agent, Path.home() / ".claude" / "projects")
            added = bank(args.register, args.report, args.none, args.name)
            for row in added:
                print(row)
            for line in repeats(args.register, added):
                print(line, file=sys.stderr)
            if missing := gaps(args.report):
                print(f"{args.report.name} skips F{', F'.join(map(str, missing))}: a finding may be unlabelled", file=sys.stderr)
            return 0
        if args.command == "route":
            for row in route(args.register, args.agent, args.rows, args.reroute):
                print(f"ROUTED {row} to {args.agent}")
            return 0
        rows = open_rows(args.register)
        for row in rows:
            print(row)
        return 1 if rows else 0
    except LookupError as unlabelled:
        print(unlabelled, file=sys.stderr)
        return 3
    except (ValueError, OSError) as refused:
        print(refused, file=sys.stderr)
        return 2


if __name__ == "__main__":
    # A Windows pipe takes the console's codepage, which cannot encode every character a report holds.
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
