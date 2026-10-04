"""ORCHESTRATION · a conflicted markdown table merged by row key rather than by line.

Two agents adding rows to one table conflict on lines that touch no shared row: each hunk is
resolved as the session branch's rows with the agent branch's own row changes applied, keyed by
each row's first cell. A key the hunk holds that is not unique in the merge-base, the agent's branch
or the session branch's side stops the merge, since a first cell such as `GET` names no one row; so
does a row both sides changed differently. Nothing is written then.

    merge_rows.py <path> [<base> <theirs>]     inside a checkout mid-merge; the defaults :1 and :3
                                               are the index's merge-base and agent-branch stages

Exit 0 resolved and written, 2 a true conflict or a hunk that is not table rows (nothing written).
"""

from __future__ import annotations

import re
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

HUNK_RE: Final = re.compile(
    r"^<<<<<<< [^\n]*\n(?P<ours>.*?)(?:^\|\|\|\|\|\|\| [^\n]*\n.*?)?^=======\n(?P<theirs>.*?)^>>>>>>> [^\n]*\n",
    re.DOTALL | re.MULTILINE,
)
ROW_KEY_RE: Final = re.compile(r"^\|\s*([^|]+?)\s*\|")


@dataclass
class Merge:
    """What one file's resolution did, each entry a line the coordinator reads before committing."""

    text: str | None
    done: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)


def row_key(line: str) -> str | None:
    """A table row's first cell, or None for a separator row and for anything that is not a row."""
    found = ROW_KEY_RE.match(line)
    if found is None or set(found.group(1)) <= set("-: "):
        return None
    return found.group(1)


def rows(text: str) -> dict[str, str]:
    """Every keyed row of a file; `merge_text` refuses a hunk touching a repeated key before it reads one."""
    keyed: dict[str, str] = {}
    for line in text.splitlines():
        key = row_key(line)
        if key is not None:
            keyed.setdefault(key, line)
    return keyed


def key_counts(text: str) -> Counter[str]:
    return Counter(key for key in map(row_key, text.splitlines()) if key is not None)


def _same(one: str, other: str) -> bool:
    # Column padding is the formatter's, so two rows differing only in it are the same row.
    return re.sub(r"\s+", " ", one).strip() == re.sub(r"\s+", " ", other).strip()


def _resolve(ours: list[str], theirs: list[str], base: dict[str, str], agent: dict[str, str], merge: Merge) -> list[str]:
    """One hunk: the session branch's side, with the agent branch's own changes to the rows it holds."""
    result: list[str] = []
    for line in ours:
        key = row_key(line)
        if key is None or key not in base:
            result.append(line)
            continue
        if key not in agent:
            if _same(line, base[key]):
                merge.done.append(f"DELETE {key}")
            else:
                merge.conflicts.append(f"{key}: the agent's branch deletes a row the session branch changed")
                result.append(line)
            continue
        if _same(base[key], agent[key]) or _same(line, agent[key]):
            result.append(line)
        elif _same(line, base[key]):
            merge.done.append(f"CHANGE {key}")
            result.append(agent[key])
        else:
            merge.conflicts.append(f"{key}: both sides changed the row")
            result.append(line)
    kept = {row_key(one) for one in ours}
    order = list(agent)
    for line in theirs:
        key = row_key(line)
        if key is not None and key in base and key not in kept and not _same(base[key], line):
            merge.conflicts.append(f"{key}: the agent's branch changes a row the session branch removed")
        if key is None or key in base:
            continue
        held = {row_key(one): one for one in result}
        if key in held:
            if not _same(held[key], line):
                merge.conflicts.append(f"{key}: both sides added the row, differently")
            continue
        # After the nearest row the agent's branch itself puts before it, and at the hunk's end where
        # that row sits outside the hunk: the session branch's rows, then the agent's.
        before = next((order[k] for k in range(order.index(key) - 1, -1, -1) if order[k] in held), None)
        at = next((k + 1 for k, one in enumerate(result) if before is not None and row_key(one) == before), len(result))
        result.insert(at, line)
        merge.done.append(f"ADD {key} after {row_key(result[at - 1]) if at else 'the rows above the hunk'}")
    return result


def merge_text(text: str, base_text: str, agent_text: str) -> Merge:
    """Every conflict hunk of one file resolved, or the reasons it cannot be."""
    merge = Merge(text=None)
    base, agent = rows(base_text), rows(agent_text)
    pieces: list[str] = []
    last = 0
    hunks = list(HUNK_RE.finditer(text))
    if not hunks:
        merge.conflicts.append("no conflict hunk in the file")
        return merge
    # The session branch's side of the file: every hunk read as its own first half.
    ours_text = HUNK_RE.sub(lambda hunk: hunk.group("ours"), text)
    counts = {
        "the merge-base": key_counts(base_text),
        "the agent's branch": key_counts(agent_text),
        "the session branch": key_counts(ours_text),
    }
    for hunk in hunks:
        ours, theirs = hunk.group("ours").splitlines(), hunk.group("theirs").splitlines()
        if not all(line.startswith("|") for line in ours + theirs):
            merge.conflicts.append("a hunk holds lines that are not table rows")
            return merge
        for key in sorted({key for key in map(row_key, ours + theirs) if key is not None}):
            for side, count in counts.items():
                if count[key] > 1:
                    merge.conflicts.append(f"{key}: {count[key]} rows in {side} open with it, so it names no one row")
        if merge.conflicts:
            return merge
        pieces.append(text[last : hunk.start()])
        resolved = _resolve(ours, theirs, base, agent, merge)
        pieces.append("".join(line + "\n" for line in resolved))
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


def main(argv: list[str]) -> int:
    if len(argv) not in (1, 3):
        print(__doc__, file=sys.stderr)
        return 2
    merge = merge_file(*argv)
    for line in merge.done:
        print(line)
    for line in merge.conflicts:
        print(f"CONFLICT {line}", file=sys.stderr)
    return 0 if merge.text is not None else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
