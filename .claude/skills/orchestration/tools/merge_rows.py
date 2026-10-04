"""ORCHESTRATION · a conflicted markdown table merged by row key rather than by line.

Two agents adding rows to one spec-sheet table conflict on lines that touch no shared row: each
hunk is resolved as the session branch's rows with the landing commit's own row changes applied,
keyed by each row's first cell. A row both sides changed differently is a true conflict and nothing
is written.

    merge_rows.py <path> <base-sha> <commit-sha>     inside the checkout holding the conflict

Exit 0 resolved and written, 2 a true conflict or a hunk that is not table rows (nothing written).
"""

from __future__ import annotations

import re
import subprocess
import sys
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
    """Every keyed row of a file, the first of a repeated key winning."""
    keyed: dict[str, str] = {}
    for line in text.splitlines():
        key = row_key(line)
        if key is not None:
            keyed.setdefault(key, line)
    return keyed


def _same(one: str, other: str) -> bool:
    # Column padding is the formatter's, so two rows differing only in it are the same row.
    return re.sub(r"\s+", " ", one).strip() == re.sub(r"\s+", " ", other).strip()


def _resolve(ours: list[str], theirs: list[str], base: dict[str, str], commit: dict[str, str], merge: Merge) -> list[str]:
    """One hunk: the session branch's side, with the commit's own changes to the rows it holds."""
    result: list[str] = []
    for line in ours:
        key = row_key(line)
        if key is None or key not in base:
            result.append(line)
            continue
        if key not in commit:
            if _same(line, base[key]):
                merge.done.append(f"DELETE {key}")
            else:
                merge.conflicts.append(f"{key}: the commit deletes a row the session branch changed")
                result.append(line)
            continue
        if _same(base[key], commit[key]) or _same(line, commit[key]):
            result.append(line)
        elif _same(line, base[key]):
            merge.done.append(f"CHANGE {key}")
            result.append(commit[key])
        else:
            merge.conflicts.append(f"{key}: both sides changed the row")
            result.append(line)
    kept = {row_key(one) for one in ours}
    order = list(commit)
    for line in theirs:
        key = row_key(line)
        if key is not None and key in base and key not in kept and not _same(base[key], line):
            merge.conflicts.append(f"{key}: the commit changes a row the session branch removed")
        if key is None or key in base:
            continue
        held = {row_key(one): one for one in result}
        if key in held:
            if not _same(held[key], line):
                merge.conflicts.append(f"{key}: both sides added the row, differently")
            continue
        # After the nearest row the commit itself puts before it, and at the hunk's end where that row
        # sits outside the hunk: the session branch's rows, then the landing's.
        before = next((order[k] for k in range(order.index(key) - 1, -1, -1) if order[k] in held), None)
        at = next((k + 1 for k, one in enumerate(result) if before is not None and row_key(one) == before), len(result))
        result.insert(at, line)
        merge.done.append(f"ADD {key} after {row_key(result[at - 1]) if at else 'the rows above the hunk'}")
    return result


def merge_text(text: str, base_text: str, commit_text: str) -> Merge:
    """Every conflict hunk of one file resolved, or the reasons it cannot be."""
    merge = Merge(text=None)
    base, commit = rows(base_text), rows(commit_text)
    pieces: list[str] = []
    last = 0
    hunks = list(HUNK_RE.finditer(text))
    if not hunks:
        merge.conflicts.append("no conflict hunk in the file")
        return merge
    for hunk in hunks:
        ours, theirs = hunk.group("ours").splitlines(), hunk.group("theirs").splitlines()
        if not all(line.startswith("|") for line in ours + theirs):
            merge.conflicts.append("a hunk holds lines that are not table rows")
            return merge
        pieces.append(text[last : hunk.start()])
        resolved = _resolve(ours, theirs, base, commit, merge)
        pieces.append("".join(line + "\n" for line in resolved))
        last = hunk.end()
    pieces.append(text[last:])
    if not merge.conflicts:
        merge.text = "".join(pieces)
    return merge


def _show(sha: str, path: str) -> str:
    done = subprocess.run(("git", "show", f"{sha}:{path}"), capture_output=True, check=True)
    return done.stdout.decode("utf-8")


def merge_file(path: str, base_sha: str, commit_sha: str) -> Merge:
    """The conflicted working copy of `path` merged against the commit and its parent, written in bytes where it resolves."""
    target = Path(path)
    merge = merge_text(target.read_bytes().decode("utf-8"), _show(base_sha, path), _show(commit_sha, path))
    if merge.text is not None:
        target.write_bytes(merge.text.encode("utf-8"))
    return merge


def main(argv: list[str]) -> int:
    if len(argv) != 3:
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
