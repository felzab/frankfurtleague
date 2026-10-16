"""ORCHESTRATION · the findings ledger: one row per labelled finding, each routed to one owner.

A finding routed from memory drops out while its report sits banked, so `bank` writes one row per
`F<n>` label and names each it leaves OPEN, `route` gives a row one owner, a live agent or a declared
queue, and the ending runs `open --unclosed` until it exits 0. A report with no label banks nothing
and says so, since a silent zero reads exactly like a report with nothing in it.

    uv run --project fl_backend --frozen python .claude/skills/orchestration/tools/ledger.py <command>

    bank <register> <report> [--from <agent id>] [--none] [--as <name>]
         [--route <owner>=<F-labels>]... [--close "<status>=<evidence>:<F-labels>"]...
    route <register> <owner> <row>… [--reroute]
    close <register> <status> <evidence> <row>… [--reclose]
    open <register> [--unclosed]
    show <register> <row>…

Exit 0 done, 2 refused, 3 a report with no label and no `--none`, 4 banked with rows left OPEN;
`open` 1 while it prints a row; `show` 2 naming each row it could not print.
"""

from __future__ import annotations

import argparse
import contextlib
import datetime
import io
import json
import os
import re
import shlex
import sys
import tempfile
import time
from collections.abc import Callable, Collection, Iterator
from pathlib import Path
from typing import Final, NamedTuple

LEDGER_HEADING: Final = "## Findings ledger"
LIVE_HEADING: Final = "## Live agents"
# A finding opens a line with its label, behind at most a heading, list or table marker and bold.
LABEL_RE: Final = re.compile(r"^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|\|\s*)?(?:\*\*|__)?F(?P<n>\d+)\b(?P<rest>.*)$")
TABLE_ROW_RE: Final = re.compile(r"^\s{0,3}\|")
HEADING_RE: Final = re.compile(r"^\s{0,3}#{1,6}\s")
# Other ways a report numbers its findings, counted when no label is found.
OTHER_SHAPE_RE: Final = re.compile(r"^\s{0,3}(?:(?:#{1,6}\s+)?(?:\*\*|__)\d+[.)]|\|\s*\d+\s*\|)")
SUMMARY_CHARS: Final = 160
# The Status cell's whole vocabulary, which `register-template.md` cites. A word outside it is a row
# no command can judge, unclosed to one reader and closed to another, so every command reading the
# ledger refuses it.
STATUSES: Final = ("OPEN", "ROUTED", "FIXED", "RULED", "HANDOFF", "NOT A DEFECT", "MOOT")
CLOSED: Final = frozenset({"FIXED", "RULED", "HANDOFF", "NOT A DEFECT", "MOOT"})
# Every owner a row may be routed to besides a live agent. A name outside both is a row no landing
# and no agent ever closes: seven spellings of the owner's queues each held rows nobody read.
QUEUES: Final = ("owner", "owner-checklist", "owner-german", "owner-browser-pass", "ending", "handoff", "pr-corrections", "CI")
# A word of the vocabulary opening the cell and ending there, so `OPENED` is no OPEN.
STATUS_RE: Final = re.compile(rf"^(?P<word>{'|'.join(map(re.escape, STATUSES))})(?!\w)")
CELL_SPLIT_RE: Final = re.compile(r"(?<!\\)\|")
CODE_SPAN_RE: Final = re.compile(r"`([^`]+)`")
AGENT_ID_RE: Final = re.compile(r"^[A-Za-z0-9]+$")
BRIEFS_RE: Final = re.compile(r"^Briefs:\s*`?(?P<path>[^`]+?)`?\s*$", re.MULTILINE)
REPORTS_RE: Final = re.compile(r"^Reports:\s*`?(?P<path>[^`]+?)`?\s*$", re.MULTILINE)
RUNNING_RE: Final = re.compile(r"^RUNNING\b(?:\s*\((?P<stamp>\d{4}-\d\d-\d\d \d\d:\d\d)\))?")
ROW_NUMBER_RE: Final = re.compile(r"-F(?P<n>\d+)$")
# The harness writes a quota stop or an API failure into an agent's transcript as an assistant
# message of its own, after the report it would otherwise replace.
SYNTHETIC_MODEL: Final = "<synthetic>"
# A printed command names this file and its repository's backend project by absolute path, so the
# line runs as printed from any directory: a bare `ledger.py` runs nowhere.
TOOL: Final = Path(__file__).resolve()
INVOCATION: Final = ("uv", "run", "--project", str(TOOL.parents[4] / "fl_backend"), "--frozen", "python", str(TOOL))
PLACEHOLDER_RE: Final = re.compile(r"<[a-z]+>")
# A write holds the lock for milliseconds, so a lock held this long is a writer stopped holding it.
LOCK_SECONDS: Final = 10.0
LOCK_POLL_SECONDS: Final = 0.02


def command(*args: str) -> str:
    """One ledger command as a line a shell runs, each `<placeholder>` left bare for the reader to fill."""
    return " ".join(arg if PLACEHOLDER_RE.fullmatch(arg) else shlex.quote(arg) for arg in (*INVOCATION, *args))


def stamp(now: datetime.datetime | None = None) -> str:
    """The local wall-clock minute, dated: a register outlives midnight."""
    return (now or datetime.datetime.now().astimezone()).strftime("%Y-%m-%d %H:%M")


class Label(NamedTuple):
    line: int
    summary: str
    table: bool
    # The line after its paragraph: a table row is a paragraph of one line.
    end: int
    size: int


def labels(report: str) -> dict[int, list[Label]]:
    """Every line a label opens, by number in report order, with its paragraph's end; a fenced example is no label."""
    lines = report.splitlines()
    opened: list[tuple[int, int, str]] = []
    fenced = False
    for k, line in enumerate(lines):
        if line.lstrip().startswith("```"):
            fenced = not fenced
            continue
        labelled = None if fenced else LABEL_RE.match(line)
        if labelled is None:
            continue
        # The bold goes first: the dash after `**F1**` opens the rest only once the bold is gone.
        summary = re.sub(r"^[\s.:|)\-–—]+", "", re.sub(r"[*_`]{2,}", "", labelled["rest"])).strip(" |")
        opened.append((k, int(labelled["n"]), summary))
    starts = {k for k, _, _ in opened}
    found: dict[int, list[Label]] = {}
    for k, n, summary in opened:
        end = _end(lines, k, starts)
        found.setdefault(n, []).append(Label(k, summary, TABLE_ROW_RE.match(lines[k]) is not None, end, len("\n".join(lines[k:end]).strip())))
    return found


def _end(lines: list[str], start: int, starts: set[int]) -> int:
    if TABLE_ROW_RE.match(lines[start]):
        return start + 1
    end, fenced = start + 1, False
    while end < len(lines):
        if lines[end].lstrip().startswith("```"):
            fenced = not fenced
        elif not fenced and (end in starts or HEADING_RE.match(lines[end])):
            break
        end += 1
    return end


def _finding(found: list[Label]) -> Label:
    # An index line, an acceptance table or an evidence line citing another report carries the number
    # too, often first: the finding is the prose label with the longest paragraph, a table row only
    # where no prose carries it.
    prose = [label for label in found if not label.table]
    return max(prose, key=lambda label: label.size) if prose else found[0]


def findings(report: str) -> dict[int, str]:
    """Each labelled finding's first line, by number."""
    return {n: _finding(found).summary for n, found in labels(report).items()}


def shadowed(report: str) -> list[str]:
    """A warning per number banked from a choice: labelled on several lines, or by a table row alone in a prose report."""
    found = labels(report)
    if not any(not label.table for each in found.values() for label in each):
        return []
    said: list[str] = []
    for n, each in sorted(found.items()):
        chosen = _finding(each)
        if chosen.table:
            said.append(f"F{n} is banked from the table row at line {chosen.line + 1} alone: close it where it names another report's finding")
        # A ranked table closing the report repeats every finding by design, which needs no word.
        elif any(not label.table or label.line < chosen.line for label in each if label.line != chosen.line):
            on = ", ".join(str(label.line + 1) for label in each)
            said.append(f"F{n} is labelled on lines {on}: banked from line {chosen.line + 1}, whose paragraph runs longest")
    return said


def paragraph(report: str, n: int, banked: str | None = None) -> str | None:
    """Finding `n` whole: from its banked label to the next label or heading, or its table row alone."""
    found = labels(report)
    if n not in found:
        return None
    # The line whose summary the row holds: a row banked by an earlier choice prints what it banked.
    chosen = next((label for label in found[n] if _cell(label.summary) == banked), _finding(found[n]))
    return "\n".join(report.splitlines()[chosen.line : chosen.end]).rstrip()


def other_shapes(report: str) -> int:
    return sum(1 for line in report.splitlines() if OTHER_SHAPE_RE.match(line))


def escaped(text: str) -> str:
    """The text as one table cell: on one line, and no pipe in it splitting the row."""
    return " ".join(text.split()).replace("|", "\\|")


def _cell(text: str) -> str:
    text = escaped(text)
    return text if len(text) <= SUMMARY_CHARS else text[: SUMMARY_CHARS - 1] + "…"


def table_under(lines: list[str], heading_text: str) -> tuple[int, int, int]:
    """The index of the heading, of the first line of the table under it, and of its last line."""
    # A heading may carry a note after its name, as a register continuing an earlier ledger does.
    heading = next((k for k, line in enumerate(lines) if line.strip().startswith(heading_text)), -1)
    if heading == -1:
        raise ValueError(f"no `{heading_text}` heading in the register")
    table = next((k for k in range(heading + 1, len(lines)) if lines[k].startswith("|")), -1)
    if table == -1 or any(lines[k].startswith("## ") for k in range(heading + 1, table)):
        raise ValueError(f"no table under `{heading_text}`")
    end = table
    while end + 1 < len(lines) and lines[end + 1].startswith("|"):
        end += 1
    return heading, table, end


def cells(line: str) -> list[str]:
    return [cell.strip() for cell in CELL_SPLIT_RE.split(line.strip())[1:-1]]


def joined(row: list[str]) -> str:
    return "| " + " | ".join(row) + " |"


def status(row: list[str]) -> str:
    """The row's status word from the vocabulary, or the cell's first word where it names none."""
    cell = row[3].upper() if len(row) == 5 else ""
    word = STATUS_RE.match(cell)
    return word["word"] if word else (cell.split() or [""])[0]


def owner(row: list[str]) -> str:
    # `route` writes the owner, then `; ` and whatever the cell held before.
    return row[4].split(";", 1)[0].strip() if len(row) == 5 else ""


def _patient[T](act: Callable[[], T], deadline: float | None = None) -> T:
    """`act`, asked again while Windows refuses it a file another process holds, until the deadline."""
    until = time.monotonic() + LOCK_SECONDS if deadline is None else deadline
    while True:
        try:
            return act()
        except PermissionError:
            # Windows refuses to replace or delete a file another process has open, and to open one being replaced.
            if os.name != "nt" or time.monotonic() >= until:
                raise
            time.sleep(LOCK_POLL_SECONDS)


def read(path: Path, deadline: float | None = None) -> bytes:
    """The bytes of a file a tool writes, read past a replace in flight."""
    return _patient(path.read_bytes, deadline)


@contextlib.contextmanager
def locked(path: Path) -> Iterator[None]:
    """The file's lock, a file beside it created only where none exists, held; a second taker waits, refused past `LOCK_SECONDS`."""
    lock = path.with_name(path.name + ".lock")
    deadline = time.monotonic() + LOCK_SECONDS
    while True:
        try:
            # `x` creates only where no file is: the create and the test for one are a single step.
            lock.open("xb").close()
            break
        # Windows refuses a create racing the holder's delete with PermissionError, not FileExistsError.
        except (FileExistsError, PermissionError) as held:
            if time.monotonic() >= deadline:
                raise OSError(
                    f"{lock} could not be taken within {LOCK_SECONDS:g} s ({held}): another tool is writing {path.name}, or one "
                    "stopped holding the lock; delete the lock file once no tool runs"
                ) from None
            time.sleep(LOCK_POLL_SECONDS)
    try:
        yield
    finally:
        lock.unlink()


def _replace(path: Path, data: bytes, deadline: float | None = None) -> None:
    # A spare of its own beside the file, renamed over it: an interrupted write leaves the old file whole.
    handle, spare = tempfile.mkstemp(dir=path.parent, prefix=f"{path.name}.", suffix=".writing")
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(data)
        _patient(lambda: os.replace(spare, path), deadline)
    except BaseException:
        Path(spare).unlink(missing_ok=True)
        raise


def update[T](path: Path, edit: Callable[[list[str]], T], deadline: float | None = None) -> T:
    """`edit` applied to the file's lines under its lock, writing nothing where it raises; what it returned.

    Every register write comes through here: the messages hook and a background `ci.py --wait` write
    unbidden, and overlapping whole-file rewrites drop the earlier. The deadline bounds the whole write.
    """
    until = time.monotonic() + LOCK_SECONDS if deadline is None else deadline
    with locked(path):
        held = read(path, until)
        text = held.decode("utf-8")
        # A register written with carriage returns keeps them, `edit` seeing its lines without.
        crlf = "\r\n" in text and "\n" not in text.replace("\r\n", "")
        lines = (text.replace("\r\n", "\n") if crlf else text).split("\n")
        done = edit(lines)
        written = "\n".join(lines)
        data = (written.replace("\n", "\r\n") if crlf else written).encode("utf-8")
        if data != held:
            _replace(path, data, until)
        return done


# --- the live-agent table -------------------------------------------------------------------------


def live_table(lines: list[str]) -> tuple[int, int]:
    """The live-agent table's header index and its last row's index."""
    return table_under(lines, LIVE_HEADING)[1:]


def first_cell(line: str) -> str:
    return line.split("|")[1].strip() if line.startswith("|") and line.count("|") > 2 else ""


def row_name(line: str) -> str:
    first = first_cell(line).split()
    return first[0].strip("`*") if first else ""


def status_column(header: str) -> int:
    """The live-agent table's Status column: so named, else its last."""
    names = cells(header)
    return names.index("Status") if "Status" in names else len(names) - 1


def live_names(lines: list[str]) -> set[str] | None:
    """Every live-agent row's name; None where the register holds no live-agent table."""
    try:
        table, end = live_table(lines)
    except ValueError:
        return None
    return {name for k in range(table + 2, end + 1) if (name := row_name(lines[k]))}


def agent_name(register: str, to: str) -> str | None:
    """The name of the live-agent row naming `to` by name or by its backticked id; None where no row does."""
    lines = register.split("\n")
    try:
        table, end = live_table(lines)
    except ValueError:
        return None
    names = {name for line in lines[table + 2 : end + 1] if (name := row_name(line)) and (to == name or f"`{to}`" in first_cell(line))}
    if len(names) > 1:
        raise ValueError(f"live-agent rows give {to} two names: {', '.join(sorted(names))}")
    return names.pop() if names else None


def set_live_status(lines: list[str], agent: str, word: str) -> str:
    """The live-agent row naming `agent` by its id given the Status `word` in `lines`; what was done."""
    try:
        table, end = live_table(lines)
    except ValueError:
        return f"no live-agent table, so no row was set {word.split()[0]}"
    column = status_column(lines[table])
    rows = [k for k in range(table + 2, end + 1) if f"`{agent}`" in first_cell(lines[k])]
    if len(rows) != 1 or column >= len(row := cells(lines[rows[0]])):
        return f"{len(rows)} live-agent rows of the table's width name `{agent}`, so none was set {word.split()[0]}"
    row[column] = word
    lines[rows[0]] = joined(row)
    return f"{row_name(lines[rows[0]])}'s live-agent row is {word}"


def reports_dir(register: str) -> Path | None:
    """Where the saved reports sit: the `Reports:` line, else `reports` beside the `Briefs:` directory."""
    if found := REPORTS_RE.search(register):
        return Path(found["path"])
    briefs = BRIEFS_RE.search(register)
    return Path(briefs["path"]).parent / "reports" if briefs else None


def stale_live(register: str) -> list[str]:
    """Each RUNNING live-agent row whose agent's report was saved after its stamp, said, or why none was read."""
    lines = register.split("\n")
    try:
        table, end = live_table(lines)
    except ValueError:
        return ["no live-agent table, so no RUNNING row was checked against the saved reports"]
    folder = reports_dir(register)
    if folder is None or not folder.is_dir():
        return [f"no reports directory ({folder}), so no RUNNING row was checked against the saved reports"]
    # Read after `open`'s rows print, so no failure here may turn its exit: each is said instead.
    saved: dict[str, datetime.datetime] = {}
    for path in folder.glob("*-report.md"):
        with contextlib.suppress(OSError):
            saved[path.name] = datetime.datetime.fromtimestamp(path.stat().st_mtime).replace(second=0, microsecond=0)
    column = status_column(lines[table])
    said: list[str] = []
    for k in range(table + 2, end + 1):
        row = cells(lines[k])
        running = RUNNING_RE.match(row[column]) if column < len(row) else None
        if running is None:
            continue
        name = row_name(lines[k])
        try:
            since = datetime.datetime.strptime(running["stamp"], "%Y-%m-%d %H:%M") if running["stamp"] else None
        except ValueError:
            said.append(f"{name}'s stamp `{running['stamp']}` is no date, so its row was not checked against the saved reports")
            continue
        # A resumed agent's earlier report predates the stamp `dispatch --id` wrote, so it is no sign.
        own = re.compile(rf"^{re.escape(name)}(?:-r\d+)?-report\.md$")
        later = sorted((when, file) for file, when in saved.items() if own.match(file) and (since is None or when > since))
        if later:
            said.append(f"{name} is `{row[column]}` while {later[-1][1]} was saved {later[-1][0]:%Y-%m-%d %H:%M}: set its Status DONE")
    return said


# --- the ledger -----------------------------------------------------------------------------------


def _ledger_rows(lines: list[str]) -> tuple[int, int]:
    """The index of the ledger table's last line and the index of its heading."""
    heading, _, end = table_under(lines, LEDGER_HEADING)
    return end, heading


def rows_at(lines: list[str], register: Path, mending: Collection[str] = ()) -> dict[str, int]:
    """Each ledger row's index, refused while a row outside `mending` has no status to judge."""
    _, table, end = table_under(lines, LEDGER_HEADING)
    at: dict[str, int] = {}
    unjudged: list[str] = []
    # Past the table's header and separator rows.
    for k in range(table + 2, end + 1):
        row = cells(lines[k])
        # A row of another width has no status cell to judge, and skipped it would read as no row at all.
        # No command can mend it either, since `close` rewrites only a row it can split into five cells.
        if len(row) != 5:
            unjudged.append(f"`{lines[k][:60]}` has {len(row)} cells, not 5: mend its cells by hand, a pipe inside one written `\\|`")
            continue
        at[row[0]] = k
        if status(row) not in STATUSES and row[0] not in mending:
            # Both repairs: a mistyped in-flight row steered to a closing status closes a finding nobody fixed.
            done = command("close", str(register.resolve()), "<status>", "<evidence>", row[0], "--reclose")
            in_flight = command("route", str(register.resolve()), "<agent>", row[0], "--reroute")
            unjudged.append(
                f"{row[0]} is `{row[3]}`, no word of {', '.join(STATUSES)}: "
                f"where its finding is done, `{done}`; where it is in flight, `{in_flight}`"
            )
    if unjudged:
        raise ValueError("; ".join(unjudged))
    return at


def _rows(register: Path, mending: Collection[str] = ()) -> tuple[list[str], dict[str, int]]:
    lines = read(register).decode("utf-8").split("\n")
    return lines, rows_at(lines, register, mending)


def _spans(text: str) -> set[str]:
    """The code spans a finding names, a call's parentheses and a path's folders dropped."""
    return {span.removesuffix("()").rsplit("/", 1)[-1] for span in CODE_SPAN_RE.findall(text)}


def repeats(register: Path, added: list[str]) -> list[str]:
    """Each banked row naming two code spans an earlier unclosed row names too: one finding several lenses reported."""
    lines, at = _rows(register)
    new = {cells(row)[0] for row in added}
    earlier = [cells(lines[k]) for name, k in at.items() if name not in new]
    said: list[str] = []
    for row in added:
        name, summary = cells(row)[0], cells(row)[2]
        for held in earlier:
            shared = sorted(_spans(summary) & _spans(held[2]))
            if len(shared) >= 2 and status(held) not in CLOSED:
                said.append(f"{name} may repeat {held[0]} ({held[3]} {held[4]}): both name {', '.join(f'`{span}`' for span in shared)}")
    return said


def check_owner(lines: list[str], agent: str) -> None:
    """Refused unless `agent` is a declared queue or a live-agent row's name."""
    names = live_names(lines)
    if agent not in QUEUES and (names is None or agent not in names):
        where = "the register has no live-agent table" if names is None else "no live-agent row has that name"
        raise ValueError(f"{agent} is no owner: {where}, and the queues are {', '.join(QUEUES)}")


def route_lines(
    lines: list[str],
    at: dict[str, int],
    agent: str,
    rows: list[str],
    reroute: bool = False,
    held_by: str | None = None,
    moves: str = "--reroute moves it",
) -> tuple[list[str], list[str]]:
    """Each row `lines` can move ROUTED to the agent there; the rows moved, and a refusal per row it cannot.

    `moves` names the calling tool's own way to move a row another owner holds, `{by}` and `{row}` filled.
    """
    refused, moved = [], []
    for row in rows:
        if row not in at:
            refused.append(f"{row} is no ledger row")
            continue
        held = cells(lines[at[row]])
        word, by = status(held), owner(held)
        if held_by is not None and (word, by) != ("ROUTED", held_by):
            refused.append(f"{row} is `{held[3]}`" + (f" to {by}" if by else "") + f", not routed to {held_by}")
        elif word == "ROUTED" and by == agent:
            continue
        elif word == "ROUTED" and not reroute:
            refused.append(f"{row} is routed to {by} already: one finding, one owner ({moves.format(by=by, row=row)})")
        elif word in CLOSED:
            # A closed row carries evidence a route would overwrite.
            refused.append(f"{row} is {held[3]}, which only an OPEN row leaves by a route")
        else:
            if word == "ROUTED":
                note = held[4].split(";", 1)[1].strip() if ";" in held[4] else ""
            else:
                # An OPEN row's cell is a note; a word no command knows keeps itself and its cell beside the owner.
                note = held[4] if word == "OPEN" else "; ".join(cell for cell in (f"was {held[3]}", held[4]) if cell)
            held[3:5] = ["ROUTED", f"{agent}; {note}" if note else agent]
            lines[at[row]] = joined(held)
            moved.append(row)
    return moved, refused


def route(register: Path, agent: str, rows: list[str], reroute: bool = False) -> list[str]:
    """Each row ROUTED to the agent, all or none; the rows that moved."""

    def edit(lines: list[str]) -> list[str]:
        # `--reroute` lifts the refusal of a word no command knows for the rows it names, as `close
        # --reclose` does: the in-flight half of the repair that refusal names.
        at = rows_at(lines, register, mending=rows if reroute else ())
        check_owner(lines, agent)
        moved, refused = route_lines(lines, at, agent, rows, reroute)
        if refused:
            raise ValueError("; ".join(refused))
        return moved

    return update(register, edit)


def route_each(
    register: Path,
    agent: str,
    rows: list[str],
    reroute: bool = False,
    held_by: str | None = None,
    moves: str = "--reroute moves it",
    deadline: float | None = None,
) -> tuple[list[str], list[str]]:
    """Each row the agent can take ROUTED to it, one refused row never holding back the rest; the rows moved and the refusals."""

    def edit(lines: list[str]) -> tuple[list[str], list[str]]:
        at = rows_at(lines, register, mending=rows if reroute else ())
        check_owner(lines, agent)
        return route_lines(lines, at, agent, rows, reroute, held_by, moves)

    return update(register, edit, deadline)


def _closed(row: list[str], word: str, evidence: str) -> str:
    """The row set to `word` with its evidence, keeping after `was` what it held before."""
    held = [row[4]] if status(row) in ("OPEN", "ROUTED") else [row[3], row[4]]
    before = "; ".join(cell for cell in held if cell)
    row[3:5] = [f"{word} ({escaped(evidence)})", f"was {before}" if before else ""]
    return joined(row)


def _closing(word: str, evidence: str) -> None:
    if word not in CLOSED:
        raise ValueError(f"`{word}` is no closing status: one of {', '.join(held for held in STATUSES if held in CLOSED)}")
    if not escaped(evidence):
        raise ValueError("a row closes on its evidence, and the evidence is empty")


def close(register: Path, word: str, evidence: str, rows: list[str], reclose: bool = False) -> list[str]:
    """Each row set to the closing status `word` with the evidence, all or none; the rows closed."""
    _closing(word, evidence)
    rows = list(dict.fromkeys(rows))

    def edit(lines: list[str]) -> list[str]:
        # A row whose word no command knows is what `--reclose` exists to mend, so naming it lifts the refusal.
        at = rows_at(lines, register, mending=rows)
        refused = []
        for row in rows:
            if row not in at:
                refused.append(f"{row} is no ledger row")
                continue
            held = cells(lines[at[row]])
            if status(held) in ("OPEN", "ROUTED") or reclose:
                lines[at[row]] = _closed(held, word, evidence)
            else:
                # Its evidence would go, and a second verdict on a closed row is a decision to say aloud.
                refused.append(f"{row} is `{held[3]}` already: --reclose closes it again")
        if refused:
            raise ValueError("; ".join(refused))
        return rows

    return update(register, edit)


def close_routed(register: Path, rows: list[str], evidence: str, by: set[str]) -> list[str]:
    """Each named row ROUTED to one of `by`, the names of the landed agents, set FIXED with the evidence; the rows closed."""

    def edit(lines: list[str]) -> list[str]:
        at = rows_at(lines, register)
        closed = []
        for row in rows:
            held = cells(lines[at[row]]) if row in at else []
            if held and status(held) == "ROUTED" and owner(held) in by:
                lines[at[row]] = _closed(held, "FIXED", evidence)
                closed.append(row)
        return closed

    return update(register, edit)


def routed(register: Path, by: set[str]) -> list[str]:
    """Each row ROUTED to one of `by`, the names of the landed agents."""
    lines, at = _rows(register)
    return [row for row, k in at.items() if status(held := cells(lines[k])) == "ROUTED" and owner(held) in by]


def held_as(register: Path, rows: list[str]) -> dict[str, str]:
    """Each named ledger row's status word."""
    lines, at = _rows(register)
    return {row: status(cells(lines[at[row]])) for row in rows if row in at}


def gaps(text: str) -> list[int]:
    numbers = sorted(findings(text))
    return [n for n in range(1, numbers[-1] + 1) if n not in numbers] if numbers else []


def open_rows(register: Path, unclosed: bool = False) -> list[str]:
    """The OPEN rows, or with `unclosed` every row whose status is not a closed one."""
    lines, at = _rows(register)
    return [lines[k] for k in at.values() if (status(cells(lines[k])) not in CLOSED if unclosed else status(cells(lines[k])) == "OPEN")]


# --- banking --------------------------------------------------------------------------------------


class Banked(NamedTuple):
    added: list[str]
    left_open: list[str]
    said: list[str]


def labelled_numbers(text: str) -> list[int]:
    """`F1,F3` or `F1 F3` as its numbers, refused where any word is no label."""
    words = [word for word in re.split(r"[,\s]+", text) if word]
    if not words or any(not re.fullmatch(r"F\d+", word) for word in words):
        raise ValueError(f"`{text}` is no list of labels such as F1,F3")
    return [int(word[1:]) for word in words]


def parse_route(value: str) -> tuple[str, list[int]]:
    agent, sep, named = value.partition("=")
    if not sep or not agent.strip():
        raise ValueError(f"--route `{value}` is no <owner>=<F-labels>")
    return agent.strip(), labelled_numbers(named)


def parse_close(value: str) -> tuple[str, str, list[int]]:
    # The labels follow the last colon, so the evidence may hold one.
    word, sep, rest = value.partition("=")
    evidence, colon, named = rest.rpartition(":")
    if not sep or not colon:
        raise ValueError(f'--close `{value}` is no "<status>=<evidence>:<F-labels>"')
    return word.strip(), evidence.strip(), labelled_numbers(named)


def bank_text(
    register: Path,
    text: str,
    report_name: str,
    declared_none: bool = False,
    name: str | None = None,
    routes: Collection[tuple[str, list[int]]] = (),
    closes: Collection[tuple[str, str, list[int]]] = (),
    agent: str | None = None,
    now: datetime.datetime | None = None,
) -> Banked:
    """One row per labelled finding of a report's text, OPEN unless routed or closed, written with the agent's live row in one write."""
    labelled = findings(text)
    if not labelled and not declared_none:
        shapes = other_shapes(text)
        raise LookupError(
            f"{report_name} labels no finding F<n>"
            + (f", and numbers {shapes} line(s) in another shape: bank those by hand or have them relabelled" if shapes else "")
            + "; pass --none for a report with no finding"
        )
    source = name or report_name.removesuffix(".md").removesuffix("-report")

    def edit(lines: list[str]) -> Banked:
        rows_at(lines, register)
        end, heading = _ledger_rows(lines)
        # Every report numbers from F1, so a second report under a banked name would bank only the labels
        # past the first one's highest and drop the rest in silence.
        if labelled and any(line.startswith(f"| {source}-F") for line in lines[heading : end + 1]):
            raise ValueError(f"the ledger already holds rows for {source}: bank a second report under another name with --as")
        rows = {n: [f"{source}-F{n}", report_name, _cell(summary), "OPEN", ""] for n, summary in sorted(labelled.items())}
        taken: dict[int, str] = {}
        refused: list[str] = []

        def take(n: int, by: str) -> bool:
            if n not in rows:
                refused.append(f"{by} names F{n}, which {report_name} does not label")
            elif n in taken:
                refused.append(f"F{n} is named by {taken[n]} and by {by}: one finding, one verdict")
            else:
                taken[n] = by
                return True
            return False

        for by, numbers in routes:
            check_owner(lines, by)
            for n in numbers:
                if take(n, f"--route {by}"):
                    rows[n][3:5] = ["ROUTED", by]
        for word, evidence, numbers in closes:
            _closing(word, evidence)
            for n in numbers:
                if take(n, f"--close {word}"):
                    rows[n][3] = f"{word} ({escaped(evidence)})"
        if refused:
            raise ValueError("; ".join(refused))
        said = shadowed(text)
        if agent is not None:
            said.append(set_live_status(lines, agent, f"DONE {stamp(now)} {report_name}"))
        # An OPEN row keeps the shape it was always written in, its empty owner cell one space wide.
        added = [joined(row) if row[4] else joined(row[:4]) + " |" for row in rows.values()]
        lines[end + 1 : end + 1] = added
        return Banked(added, [row[0] for row in rows.values() if row[3] == "OPEN"], said)

    return update(register, edit)


def bank(
    register: Path,
    report: Path,
    declared_none: bool = False,
    name: str | None = None,
    routes: Collection[tuple[str, list[int]]] = (),
    closes: Collection[tuple[str, str, list[int]]] = (),
) -> Banked:
    return bank_text(register, report.read_bytes().decode("utf-8"), report.name, declared_none, name, routes, closes)


def transcripts(agent: str, projects: Path) -> list[Path]:
    """Every transcript file the harness's projects directory holds for the agent."""
    if not AGENT_ID_RE.match(agent):
        raise ValueError(f"{agent!r} is no agent id")
    return sorted(projects.glob(f"*/*/subagents/agent-{agent}.jsonl"))


def transcript(agent: str, projects: Path) -> Path:
    """The agent's transcript file under the harness's projects directory."""
    found = transcripts(agent, projects)
    if len(found) != 1:
        raise ValueError(f"{len(found)} transcripts under {projects} for agent {agent}")
    return found[0]


def messages(path: Path) -> Iterator[tuple[str, dict[str, object]]]:
    """Each user or assistant message line of a transcript with its role, the harness's own error messages left out."""
    for raw in path.read_bytes().splitlines():
        try:
            entry = json.loads(raw)
        except ValueError:
            continue
        message = entry.get("message") if isinstance(entry, dict) else None
        if not isinstance(message, dict) or message.get("role") not in ("user", "assistant"):
            continue
        if entry.get("isApiErrorMessage") or message.get("model") == SYNTHETIC_MODEL:
            continue
        yield str(message["role"]), message


def calls(path: Path) -> Iterator[dict[str, object]]:
    """Each assistant message the model wrote, one line per content block."""
    return (message for role, message in messages(path) if role == "assistant")


def last_message(path: Path) -> tuple[str, list[dict[str, object]]]:
    """The role of the transcript's last message and its content blocks."""
    role, ident, blocks = "", None, []
    for said, message in messages(path):
        # One assistant message reaches the transcript as several lines sharing its id.
        if not (said == role == "assistant" and message.get("id") == ident):
            blocks = []
        role, ident = said, message.get("id")
        content = message.get("content")
        blocks += [block for block in content if isinstance(block, dict)] if isinstance(content, list) else []
    return role, blocks


def mid_turn(role: str, blocks: list[dict[str, object]]) -> str | None:
    """What the last message is where the agent's turn has not ended: a turn ends in a message calling no tool."""
    if role != "assistant":
        return "a message to it: a tool's result, an interruption or a resume" if role else "no message"
    return "a tool call" if any(block.get("type") == "tool_use" for block in blocks) else None


def final_message(agent: str, projects: Path) -> str:
    """The text of the agent's last message, which is its report, refused where its turn has not ended."""
    path = transcript(agent, projects)
    role, blocks = last_message(path)
    # A stopped agent's last text is an interim note written beside a tool call, which reads like a report.
    if stopped := mid_turn(role, blocks):
        raise ValueError(f"{agent} stopped mid-task, its transcript ending in {stopped}: resume it, and bank once it ends its turn")
    texts = [str(block.get("text", "")) for block in blocks if block.get("type") == "text"]
    if not texts:
        raise ValueError(f"the last message in {path} holds no text")
    return "".join(texts).rstrip("\n") + "\n"


def bank_from(
    register: Path,
    report: Path,
    agent: str,
    projects: Path,
    declared_none: bool = False,
    name: str | None = None,
    routes: Collection[tuple[str, list[int]]] = (),
    closes: Collection[tuple[str, str, list[int]]] = (),
) -> Banked:
    """The agent's final message banked, then saved as `report`: a refused bank saves nothing, so its retry is clean."""
    text = final_message(agent, projects)
    # A resumed agent's next reply is a report of its own: written over the first, it erased it.
    if report.exists() and report.read_bytes() != text.encode("utf-8"):
        raise ValueError(f"{report} already holds another report: save a later round under its own name, such as <NAME>-r2-report.md")
    banked = bank_text(register, text, report.name, declared_none, name, routes, closes, agent=agent)
    report.write_bytes(text.encode("utf-8"))
    return banked


def show(register: Path, rows: list[str]) -> tuple[list[str], list[str]]:
    """Each row's whole finding from its saved report, and a refusal per row it cannot print."""
    lines, at = _rows(register)
    folder = reports_dir("\n".join(lines))
    shown, refused = [], []
    for row in rows:
        number = ROW_NUMBER_RE.search(row)
        if row not in at or number is None:
            refused.append(f"{row} is no ledger row")
            continue
        _, report, summary, *_ = cells(lines[at[row]])
        path = folder / report if folder is not None else None
        if path is None or not path.is_file():
            refused.append(f"{row}: no saved report at {path or 'a directory the register names in a `Reports:` or `Briefs:` line'}")
            continue
        text = paragraph(path.read_bytes().decode("utf-8"), int(number["n"]), summary)
        if text is None:
            refused.append(f"{row}: {report} labels no F{number['n']}")
            continue
        shown.append(f"{row} ({path})\n{text}")
    return shown, refused


def parser() -> argparse.ArgumentParser:
    top = argparse.ArgumentParser(prog="ledger.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = top.add_subparsers(dest="command", required=True)
    banking = commands.add_parser("bank")
    banking.add_argument("register", type=Path)
    banking.add_argument("report", type=Path)
    banking.add_argument(
        "--from",
        dest="agent",
        help="save the agent's final message as the report once banked, never over another file, and set its live row DONE",
    )
    banking.add_argument("--none", action="store_true", help="a report with no finding")
    banking.add_argument("--as", dest="name", help="the rows' name, for a second report under a banked one")
    banking.add_argument("--route", action="append", default=[], metavar="OWNER=F-LABELS", help="route these labels' rows in the same write")
    banking.add_argument(
        "--close", action="append", default=[], metavar="STATUS=EVIDENCE:F-LABELS", help="close these labels' rows in the same write"
    )
    routing = commands.add_parser("route")
    routing.add_argument("register", type=Path)
    routing.add_argument("agent", help=f"a live-agent row's name, or a queue: {', '.join(QUEUES)}")
    routing.add_argument("rows", nargs="+")
    routing.add_argument("--reroute", action="store_true", help="move a row routed to another agent, or one whose status no command knows")
    closing = commands.add_parser("close")
    closing.add_argument("register", type=Path)
    closing.add_argument("status", help=f"one of {', '.join(word for word in STATUSES if word in CLOSED)}, quoted where it is several words")
    closing.add_argument("evidence")
    closing.add_argument("rows", nargs="+")
    closing.add_argument("--reclose", action="store_true", help="close again a row no longer OPEN or ROUTED")
    opening = commands.add_parser("open", help="also names, on stderr, a RUNNING live-agent row whose report is saved")
    opening.add_argument("register", type=Path)
    opening.add_argument("--unclosed", action="store_true")
    showing = commands.add_parser("show", help="each row's whole finding from its saved report")
    showing.add_argument("register", type=Path)
    showing.add_argument("rows", nargs="+")
    return top


def _bank(args: argparse.Namespace) -> int:
    routes = [parse_route(value) for value in args.route]
    closes = [parse_close(value) for value in args.close]
    if args.agent:
        banked = bank_from(args.register, args.report, args.agent, Path.home() / ".claude" / "projects", args.none, args.name, routes, closes)
    else:
        banked = bank(args.register, args.report, args.none, args.name, routes, closes)
    for row in banked.added:
        print(row)
    for line in banked.said + repeats(args.register, banked.added):
        print(line, file=sys.stderr)
    if missing := gaps(args.report.read_bytes().decode("utf-8")):
        print(f"{args.report.name} skips F{', F'.join(map(str, missing))}: a finding may be unlabelled", file=sys.stderr)
    if banked.left_open:
        print(f"left OPEN: {', '.join(banked.left_open)} -- route each to its owner or close it", file=sys.stderr)
        return 4
    return 0


def main(argv: list[str]) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "bank":
            return _bank(args)
        if args.command == "route":
            for row in route(args.register, args.agent, args.rows, args.reroute):
                print(f"ROUTED {row} to {args.agent}")
            return 0
        if args.command == "close":
            for row in close(args.register, args.status, args.evidence, args.rows, args.reclose):
                print(f"{args.status} {row}")
            return 0
        if args.command == "show":
            shown, refused = show(args.register, args.rows)
            print("\n\n".join(shown))
            for line in refused:
                print(line, file=sys.stderr)
            return 2 if refused else 0
        rows = open_rows(args.register, args.unclosed)
        for row in rows:
            print(row)
        for line in stale_live(read(args.register).decode("utf-8")):
            print(line, file=sys.stderr)
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
