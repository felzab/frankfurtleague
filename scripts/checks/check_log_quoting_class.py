"""SCRIPTS · the console format's quoting class, spelled once per package and compared here.

A value one surface quotes and the other writes bare is one log line that two greps read
differently, and this pair has already drifted once: the Python predicate and the JavaScript
shorthand that stood in for it disagree about five code points. Each side is written as an explicit
class for that reason, and this is what holds the two spellings to each other.

Rejected: one declaration both packages read, nothing crossing them but the generated
`openapi.json` and `.claude/rules/cross-surface.md`'s openapi clause being the argument for keeping
that seam narrow; and a comparison of the console line's regex and the envelope's key order, which
are asserted inside test bodies and would need a language-aware reader per side, a second parser to
keep honest.

Invariants:
  A declaration this reader cannot find, or a class it cannot expand, refuses rather than reporting the pair as agreeing.
"""

from __future__ import annotations

import argparse
import re
import string
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final

# Every caller runs this as a script, so sys.path opens with THIS directory and `lib/` is a
# sibling of it rather than in it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import (  # noqa: E402 -- the insert above is what resolves it
    EXIT_REFUSED,
    REPO_ROOT,
    UNREADABLE,
    Finding,
    report_findings,
    run,
)

LITERAL: Final = "NEEDS_QUOTING"
BACKEND: Final = "fl_backend/app/core/logging.py"
FRONTEND: Final = "fl_frontend/src/core/logFormat.ts"

# The column `checker_kernel.py :: report_findings` leaves after its `FAIL` tag, so a finding's second
# line lands under its first.
CONTINUATION: Final = " " * 14

# The first of two readers over one file: without it a renamed constant leaves two files with no
# declaration to disagree over, which is not two files that agree.
DECLARING_RE: Final = re.compile(r"^(?:const\s+)?" + LITERAL + r"\s*=", re.MULTILINE)

# The second, as `check_csp_identity.py` reads a policy: a declaration it cannot take one class out
# of is what the refusal below is for.
BACKEND_RE: Final = re.compile(r"^" + LITERAL + r'\s*=\s*re\.compile\(r"\[(?P<body>.*)\]"\)$', re.MULTILINE)
FRONTEND_RE: Final = re.compile(r"^const\s+" + LITERAL + r"\s*=\s*/\[(?P<body>.*)\]/[a-z]*;$", re.MULTILINE)

# How many hex digits each escape owes. `\u` is what both files write; `\x` is here because either
# language accepts it and a class half-spelled in it would otherwise refuse a readable file.
HEX_WIDTHS: Final[dict[str, int]] = {"u": 4, "x": 2}

HYPHEN: Final = ord("-")

# The widest code point a four-digit escape names. A class carrying a character above it is read
# either way, so the spelling widens rather than truncating the one thing a finding is about.
BMP_CEILING: Final = 0xFFFF


class Unreadable(Exception):
    """A declaration this reader cannot find, or a class it cannot expand, named with its file."""


def atoms(body: str, where: str) -> list[tuple[int, bool]]:
    """Each character the class body names, with whether an escape wrote it.

    The flag separates a range's `-` from a literal one: a reader without it either expands `\\-`
    as a range or refuses the ranges both files write.
    """
    found: list[tuple[int, bool]] = []
    index = 0
    while index < len(body):
        char = body[index]
        if char != "\\":
            found.append((ord(char), False))
            index += 1
            continue
        if index + 1 == len(body):
            raise Unreadable(f"{where}: the class ends on a backslash")
        marker = body[index + 1]
        width = HEX_WIDTHS.get(marker)
        if width is None:
            # A shorthand stands for a set each language fixes for itself, which is the whole of
            # what drifted here: comparing two of them would compare the spelling and not the class.
            if marker.isalnum():
                raise Unreadable(f"{where}: the shorthand \\{marker}, which the two languages do not have to agree about")
            found.append((ord(marker), True))
            index += 2
            continue
        digits = body[index + 2 : index + 2 + width]
        if len(digits) != width or any(digit not in string.hexdigits for digit in digits):
            raise Unreadable(f"{where}: \\{marker} without its {width} hex digits")
        found.append((int(digits, 16), True))
        index += 2 + width
    return found


def code_points(body: str, where: str) -> frozenset[int]:
    """Every character the class matches, its ranges expanded."""
    # Refused rather than expanded: two negated classes agree on what they exclude, and a set built
    # from the excluded characters would read as the class itself and compare the wrong thing.
    if body.startswith("^"):
        raise Unreadable(f"{where}: a negated class, which this reader compares nothing to")
    read = atoms(body, where)
    if not read:
        raise Unreadable(f"{where}: an empty class, which matches nothing and quotes nothing")
    points: set[int] = set()
    index = 0
    while index < len(read):
        start = read[index][0]
        if index + 2 < len(read) and read[index + 1] == (HYPHEN, False):
            end = read[index + 2][0]
            if end < start:
                raise Unreadable(f"{where}: a range running backwards, which neither language accepts")
            points.update(range(start, end + 1))
            index += 3
            continue
        points.add(start)
        index += 1
    return frozenset(points)


def escaped(point: int) -> str:
    """One character in this checker's spelling, whatever escape the file it came from used."""
    return f"\\u{point:04x}" if point <= BMP_CEILING else f"\\u{{{point:x}}}"


def spelled(points: frozenset[int]) -> str:
    """A set of characters as one class in one spelling, so two files can be compared as text."""
    runs: list[list[int]] = []
    for point in sorted(points):
        if runs and point == runs[-1][1] + 1:
            runs[-1][1] = point
        else:
            runs.append([point, point])
    return "[" + "".join(escaped(start) if start == end else f"{escaped(start)}-{escaped(end)}" for start, end in runs) + "]"


@dataclass(frozen=True)
class Spelling:
    """One package's class: the file it was read from, and the characters it matches."""

    where: str
    points: frozenset[int]


def lifted(path: Path, where: str, reader: re.Pattern[str]) -> Spelling:
    """The class one file declares, refusing where the declaration is not there rather than passing."""
    text = path.read_text(encoding="utf-8")
    if DECLARING_RE.search(text) is None:
        raise Unreadable(f"{where}: no {LITERAL} is declared here, so there is nothing to compare")
    match = reader.search(text)
    if match is None:
        raise Unreadable(f"{where}: a {LITERAL} this reader cannot take one character class out of")
    return Spelling(where, code_points(match.group("body"), where))


def disagreement(left: Spelling, right: Spelling) -> list[Finding]:
    """The one finding this checker has: both spellings, and what each side matches alone."""
    if left.points == right.points:
        return []
    detail = [
        "the console format's quoting class differs between the two packages",
        f"{left.where}:  {spelled(left.points)}",
        f"{right.where}:  {spelled(right.points)}",
    ]
    # Named as well as shown: the two classes run to a hundred characters each, and what a reader
    # repairs is the handful that only one side quotes.
    for side, other in ((left, right), (right, left)):
        alone = frozenset(side.points - other.points)
        if alone:
            detail.append(f"only {side.where}:  {spelled(alone)}")
    return [Finding("fail", f"\n{CONTINUATION}".join(detail))]


def main() -> int:
    parser = argparse.ArgumentParser(description=f"Do both packages spell {LITERAL} as the same character class?")
    parser.add_argument("--verbose", action="store_true", help="print each class as it is read")
    parser.add_argument("files", nargs="*", metavar="FILE", help=f"the backend and frontend files to compare (default: {BACKEND} {FRONTEND})")
    args = parser.parse_args()

    if len(args.files) not in (0, 2):
        parser.error("give both files or neither")
    # The label a finding carries is the path this run was handed, so a run over a fixture pair
    # cannot read as a verdict on the two files the defaults name.
    paths = [Path(name) for name in args.files] or [REPO_ROOT / BACKEND, REPO_ROOT / FRONTEND]
    labels = args.files or [BACKEND, FRONTEND]

    try:
        left = lifted(paths[0], labels[0], BACKEND_RE)
        right = lifted(paths[1], labels[1], FRONTEND_RE)
    except Unreadable as error:
        print(f"      {error}", file=sys.stderr)
        print("      Nothing was compared, so this is a refusal rather than a verdict on the files.", file=sys.stderr)
        print("      Write the class out character for character, or teach", file=sys.stderr)
        print("      scripts/checks/check_log_quoting_class.py :: atoms the shape.", file=sys.stderr)
        return EXIT_REFUSED
    except UNREADABLE as error:
        print(f"      {error}", file=sys.stderr)
        # A file the checker cannot open is input it cannot judge, which the kernel's contract calls
        # EXIT_REFUSED. EXIT_CRASH would claim the environment is broken.
        print("      Nothing was compared: both files have to be readable for the comparison to mean anything.", file=sys.stderr)
        return EXIT_REFUSED

    if args.verbose:
        for side in (left, right):
            print(f"      read      {side.where}  {spelled(side.points)}")

    findings = disagreement(left, right)
    code = report_findings(findings)
    if findings:
        print("\n      One class, spelled once per package because nothing crosses the two. Edit both")
        print(f"      literals together: {BACKEND} :: {LITERAL} and")
        print(f"      {FRONTEND} :: {LITERAL}.")
        return code

    print(f"      2 file(s) read, {len(left.points)} code point(s), one class spelled twice")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
