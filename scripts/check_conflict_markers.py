"""SCRIPTS · no tracked file carries a merge conflict marker.

An unresolved conflict reads as content. The markers sit at line start where every parser here
treats them as ordinary text, so once one is committed nothing downstream can tell the file apart
from a document its author meant. The rules below anchor on the forms that survive
`.githooks/pre-commit`, and the separator is judged in context because a bare run of `=` at line
start is also a setext heading underline.

Every tracked file is read, with no suffix list and no exemption for a fenced block: a fence is
where a conflict inside an example hides, and a list of extensions silently passes whatever it
forgets.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Final

from checker_kernel import EXIT_CRASH, EXIT_REFUSED, REPO_ROOT, Finding, git, report_findings, run

# `{7}` rather than the characters themselves, so this file carries no marker of its own: a checker
# its own rules fail on could never report.
OPENER: Final = re.compile(r"^<{7}(?:\s|$)")

# What `merge.conflictStyle=diff3` writes above the separator. Absent from the default style, so
# nothing else here would ever see it.
BASE: Final = re.compile(r"^\|{7}(?:\s|$)")

CLOSER: Final = re.compile(r"^>{7}(?:\s|$)")

# prettier reflows a closer in a markdown file into nested blockquotes, so the raw closer above does
# not survive a commit that stages one. This is the form that reaches the tree.
BLOCKQUOTED_CLOSER: Final = re.compile(r"^(?:> ){6}>(?:\s|$)")

# Judged only under an opener. Alone it is a setext heading underline, which is valid markdown and
# carries no defect, and nothing in the line itself separates the two readings.
SEPARATOR: Final = re.compile(r"^={7}\s*$")

# In the order a conflict writes them, which is the order a reader wants them reported in.
UNAMBIGUOUS: Final = (
    (OPENER, "a conflict opener"),
    (BASE, "a diff3 base marker"),
    (CLOSER, "a conflict closer"),
    (BLOCKQUOTED_CLOSER, "a conflict closer the formatter reflowed into blockquotes"),
)


def markers_in(text: str) -> list[tuple[int, str]]:
    """Every conflict marker in one file's text, as its line number and what the line is.

    The separator is gated on an opener standing above it in the same file, which is what keeps a
    setext heading out of the findings.
    """
    found: list[tuple[int, str]] = []
    opened = False
    for number, line in enumerate(text.split("\n"), start=1):
        for pattern, name in UNAMBIGUOUS:
            if pattern.match(line):
                found.append((number, name))
                opened = opened or pattern is OPENER
                break
        else:
            if opened and SEPARATOR.match(line):
                found.append((number, "a conflict separator"))
    return found


def text_of(path: Path) -> str | None:
    """One file as text, or None where it is binary. Raises OSError where it cannot be read.

    A NUL byte is git's own test for binary. Decoding is lenient because every marker is ASCII: a
    replacement character can neither invent one nor hide one.
    """
    raw = path.read_bytes()
    if b"\x00" in raw:
        return None
    return raw.decode("utf-8", errors="replace")


def shown(path: Path) -> str:
    """The path as a finding names it -- repo-relative where it can be, forward slashes either way.

    One exception type, not a tuple: the formatter rewrites a tuple into a form the kernel's parse
    floor rejects (`scripts/tests/test_parse_floor.py`).
    """
    try:
        return path.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def tracked_files() -> list[Path] | None:
    """Every file git tracks here, or None where git could not answer.

    The whole tree rather than a branch's diff: a marker that reached an earlier commit is still a
    marker, and it is the one nothing has caught.
    """
    listing = git("ls-files", "-z")
    if listing is None:
        return None
    return [REPO_ROOT / name for name in listing.split("\0") if name]


def main() -> int:
    parser = argparse.ArgumentParser(description="Does any tracked file carry a merge conflict marker?")
    parser.add_argument("files", nargs="*", metavar="FILE", help="the files to read (default: every file git tracks)")
    args = parser.parse_args()

    if args.files:
        paths = [Path(name) for name in args.files]
    else:
        tracked = tracked_files()
        if tracked is None:
            print("      git could not list the tracked files, so nothing was read.", file=sys.stderr)
            return EXIT_CRASH
        paths = tracked

    findings: list[Finding] = []
    unreadable: list[str] = []
    scanned = 0
    for path in paths:
        try:
            text = text_of(path)
        except OSError as error:
            unreadable.append(f"{shown(path)}: {error}")
            continue
        if text is None:
            continue
        scanned += 1
        findings.extend(Finding("fail", f"{shown(path)}:{number} is {what}") for number, what in markers_in(text))

    code = report_findings(findings)

    if findings:
        print("\n      A committed marker destroys both sides of the merge at once: the formatter")
        print("      reflows it into ordinary text and every other check here reads it as content.")
        print("      Resolve the conflict and commit the resolution.")

    # Refused after the findings print, so what WAS read is not lost: an unreadable tracked file
    # leaves the tree unproven, which is not the same answer as a clean one.
    if unreadable:
        for line in unreadable:
            print(f"      {line}", file=sys.stderr)
        print("      Those tracked files were not read, so this run proves nothing about them.", file=sys.stderr)
        return EXIT_REFUSED

    if not findings:
        print(f"      {scanned} tracked text file(s), no conflict marker")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
