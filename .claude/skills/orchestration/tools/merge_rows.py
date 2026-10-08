"""ORCHESTRATION · a conflicted markdown table merged by row key rather than by line.

Two agents adding rows to one table conflict on lines that touch no shared row: each hunk is
resolved as the session branch's rows with the agent branch's own row changes applied. A table is
found by its header's cells in the merge-base, the agent's branch and the session branch's side, and
keyed by its leftmost column naming one row in each, since a first cell such as `GET` names none.
No such column, a row both sides changed differently, and a keyless continuation row only one side
holds each stop the merge, and nothing is written then. `land.py` calls `merge_file` inside a merge,
whose defaults `:1` and `:3` read the index's merge-base and agent-branch stages.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

HUNK_RE: Final = re.compile(
    r"^<<<<<<< [^\n]*\n(?P<ours>.*?)(?:^\|\|\|\|\|\|\| [^\n]*\n.*?)?^=======\n(?P<theirs>.*?)^>>>>>>> [^\n]*\n",
    re.DOTALL | re.MULTILINE,
)
# An escaped pipe sits inside a cell rather than between two.
CELL_SPLIT_RE: Final = re.compile(r"(?<!\\)\|")
HEADER: Final = "the header row"


@dataclass
class Merge:
    """What one file's resolution did, each entry a line the coordinator reads before committing."""

    text: str | None
    done: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)


def cells(line: str) -> list[str]:
    parts = CELL_SPLIT_RE.split(line.strip())
    return [part.strip() for part in parts[1 : -1 if parts[-1].strip() == "" else None]]


def _separator(line: str) -> bool:
    found = cells(line)
    return bool(found) and all(cell and set(cell) <= set("-: ") for cell in found)


def _norm(line: str) -> str:
    # Column padding and a separator's dash count are the formatter's, so a re-padded table's rows
    # compare equal to the rows they were.
    if _separator(line):
        return "|" + "---|" * len(cells(line))
    return re.sub(r"\s+", " ", line).strip()


def _same(one: str, other: str) -> bool:
    return _norm(one) == _norm(other)


def _tables(text: str) -> dict[str, list[list[str]]]:
    """Every run of table rows, by its header's normalised line; a header two tables share lists both."""
    found: dict[str, list[list[str]]] = {}
    block: list[str] = []
    for line in [*text.splitlines(), ""]:
        if line.startswith("|"):
            block.append(line)
        elif block:
            found.setdefault(_norm(block[0]), []).append(block)
            block = []
    return found


@dataclass
class Table:
    """One table's three versions, read through the column that names one row in each."""

    header: str
    column: int

    def key(self, line: str) -> str | None:
        """The row's key; None for the separator and for a row whose empty first cell continues the one above."""
        if _norm(line) == self.header:
            return HEADER
        found = cells(line)
        if _separator(line) or not found or not found[0] or self.column >= len(found):
            return None
        return found[self.column] or None

    def rows(self, lines: list[str]) -> dict[str, str]:
        return {key: line for line in lines if (key := self.key(line)) is not None}


def _key_column(header: str, versions: dict[str, list[str]]) -> int | None:
    """The leftmost column whose cells are filled and distinct across every keyed row of every version."""
    width = len(cells(header))
    for column in range(width):
        probe = Table(header, column)
        if all(_names_one_row(probe, lines) for lines in versions.values()):
            return column
    return None


def _names_one_row(table: Table, lines: list[str]) -> bool:
    data = [line for line in lines[1:] if not _separator(line) and (found := cells(line)) and found[0]]
    keys = [table.key(line) for line in data]
    return None not in keys and len(keys) == len(set(keys))


def _resolve(ours: list[str], theirs: list[str], table: Table, base_lines: list[str], agent_lines: list[str], merge: Merge) -> list[str]:
    """One hunk: the session branch's side, with the agent branch's own changes to the rows it holds."""
    key = table.key
    base, agent = table.rows(base_lines), table.rows(agent_lines)
    result: list[str] = []
    # A row with an empty first cell continues the row above it and names nothing to place it by, so
    # one present on a single side stops the merge rather than being kept or dropped by guess.
    ours_norm, theirs_norm, base_norm = ({_norm(line) for line in side} for side in (ours, theirs, base_lines))
    for line in theirs:
        if key(line) is None and _norm(line) not in ours_norm:
            merge.conflicts.append(f"a row with no key, {line.strip()!r}, is on the agent's branch alone")
    for line in ours:
        if key(line) is None and _norm(line) in base_norm and _norm(line) not in theirs_norm:
            merge.conflicts.append(f"a row with no key, {line.strip()!r}, is gone from the agent's branch")
    for line in ours:
        name = key(line)
        if name is None or name not in base:
            result.append(line)
            continue
        if name not in agent:
            if _same(line, base[name]):
                merge.done.append(f"DELETE {name}")
            else:
                merge.conflicts.append(f"{name}: the agent's branch deletes a row the session branch changed")
                result.append(line)
            continue
        if _same(base[name], agent[name]) or _same(line, agent[name]):
            result.append(line)
        elif _same(line, base[name]):
            merge.done.append(f"CHANGE {name}")
            result.append(agent[name])
        else:
            merge.conflicts.append(f"{name}: both sides changed the row")
            result.append(line)
    kept = {key(one) for one in ours}
    order = list(agent)
    for line in theirs:
        name = key(line)
        if name is not None and name in base and name not in kept and not _same(base[name], line):
            merge.conflicts.append(f"{name}: the agent's branch changes a row the session branch removed")
        if name is None or name in base:
            continue
        held = {key(one): one for one in result}
        if name in held:
            if not _same(held[name], line):
                merge.conflicts.append(f"{name}: both sides added the row, differently")
            continue
        # After the nearest row the agent's branch itself puts before it, and at the hunk's end where
        # that row sits outside the hunk: the session branch's rows, then the agent's.
        before = next((order[k] for k in range(order.index(name) - 1, -1, -1) if order[k] in held), None)
        at = next((k + 1 for k, one in enumerate(result) if before is not None and key(one) == before), len(result))
        result.insert(at, line)
        merge.done.append(f"ADD {name} after {key(result[at - 1]) if at else 'the rows above the hunk'}")
    return result


def _hunk_header(ours_lines: list[str], start: int, ours: list[str], theirs: list[str]) -> str | None:
    """The first line of the table the hunk sits in, read on the session branch's side where it has one."""
    top = start
    while top > 0 and ours_lines[top - 1].startswith("|"):
        top -= 1
    if top < start:
        return ours_lines[top]
    return (ours or theirs or [None])[0]


def _table_for(header: str, sides: dict[str, dict[str, list[list[str]]]], merge: Merge) -> tuple[Table, dict[str, list[str]]] | None:
    versions: dict[str, list[str]] = {}
    for side, tables in sides.items():
        held = tables.get(_norm(header), [])
        if len(held) != 1:
            merge.conflicts.append(f"{len(held)} tables in {side} open with the header {header.strip()!r}")
            return None
        versions[side] = held[0]
    column = _key_column(_norm(header), versions)
    if column is None:
        merge.conflicts.append(f"no column of the table under {header.strip()!r} names one row in every side")
        return None
    return Table(_norm(header), column), versions


def merge_text(text: str, base_text: str, agent_text: str) -> Merge:
    """Every conflict hunk of one file resolved, or the reasons it cannot be."""
    merge = Merge(text=None)
    hunks = list(HUNK_RE.finditer(text))
    if not hunks:
        merge.conflicts.append("no conflict hunk in the file")
        return merge
    # The session branch's side of the file: every hunk read as its own first half.
    ours_text = HUNK_RE.sub(lambda hunk: hunk.group("ours"), text)
    ours_lines = ours_text.splitlines()
    sides = {"the merge-base": _tables(base_text), "the agent's branch": _tables(agent_text), "the session branch": _tables(ours_text)}
    pieces: list[str] = []
    last = start = 0
    for hunk in hunks:
        start += text.count("\n", last, hunk.start())
        ours, theirs = hunk.group("ours").splitlines(), hunk.group("theirs").splitlines()
        if not all(line.startswith("|") for line in ours + theirs):
            merge.conflicts.append("a hunk holds lines that are not table rows")
            return merge
        header = _hunk_header(ours_lines, start, ours, theirs)
        found = _table_for(header, sides, merge) if header is not None else None
        if found is None:
            return merge
        table, versions = found
        pieces.append(text[last : hunk.start()])
        resolved = _resolve(ours, theirs, table, versions["the merge-base"], versions["the agent's branch"], merge)
        pieces.append("".join(line + "\n" for line in resolved))
        start += len(ours)
        last = hunk.end()
    pieces.append(text[last:])
    if not merge.conflicts:
        merge.text = "".join(pieces)
    return merge


def _show(ref: str, path: str) -> str | None:
    """The file at one revision or index stage, or None where it holds no such file."""
    done = subprocess.run(("git", "show", f"{ref}:{path}"), capture_output=True, check=False)
    return done.stdout.decode("utf-8") if done.returncode == 0 else None


def merge_file(path: str, base_ref: str = ":1", agent_ref: str = ":3") -> Merge:
    """The conflicted working copy of `path` merged against the merge-base and the agent's branch, written in bytes where it resolves."""
    target = Path(path)
    base_text, agent_text = _show(base_ref, path), _show(agent_ref, path)
    # An add/add or modify/delete conflict has no merge-base or no agent side to key rows against.
    if base_text is None or agent_text is None or not target.is_file():
        missing = "the merge-base" if base_text is None else "the agent's branch" if agent_text is None else "the working tree"
        return Merge(text=None, conflicts=[f"{path} is missing from {missing}"])
    merge = merge_text(target.read_bytes().decode("utf-8"), base_text, agent_text)
    if merge.text is not None:
        target.write_bytes(merge.text.encode("utf-8"))
    return merge
