"""ORCHESTRATION · an UPDATE line written into a register, stamped from the clock rather than typed.

A typed time can run ahead of the clock, and every figure derived from it moves with the guess. The
line goes in above the marker
`register-template.md` places at the end of the resume point, in one write of the file's bytes.

    uv run --project fl_backend --frozen python .claude/skills/orchestration/tools/reg.py append <register> <text…>

The text is read from stdin when none is given.

Exit 0 written, 2 refused: no text, or not exactly one marker.
"""

from __future__ import annotations

import datetime
import io
import os
import sys
from pathlib import Path
from typing import Final

MARKER: Final = "<!-- reg.py appends UPDATE lines above this line -->"


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


def main(argv: list[str]) -> int:
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
