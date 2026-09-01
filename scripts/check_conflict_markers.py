"""SCRIPTS · no tracked file carries a merge conflict marker.

An unresolved conflict reads as content: the markers are ordinary text to every parser here, so
once one is committed nothing downstream tells the file apart from a document its author meant.
Each rule below stands on its own, because the formatter running at commit time destroys some of
the set and leaves the rest, and each tolerates the indentation and the quote, list and table
decoration that formatter puts in front of a marker rather than refusing the file.

Every tracked file is read, with no suffix list, no path allowlist and no exemption for a fenced
block: a fence is where a conflict inside an example hides, and a list of extensions silently
passes whatever it forgets.
"""

from __future__ import annotations

import argparse
import codecs
import re
import sys
from pathlib import Path
from typing import Final

from checker_kernel import EXIT_CRASH, EXIT_REFUSED, REPO_ROOT, Finding, git, report_findings, run

# What a formatter leaves to the LEFT of a marker: indentation, blockquote levels, list bullets, a
# table cell wall. prettier moves a marker behind these rather than failing, so a column-zero
# anchor reads an indented conflict as clean.
DECORATION: Final = r"[ \t]*(?:[-*+>|][ \t]+|\d{1,9}[.)][ \t]+)*"

# `{7,}` and never the characters themselves, so this file carries no marker of its own: a checker
# its own rules fail on could never report. The open bound answers `conflict-marker-size`; the
# trailing gate keeps a run followed by a word out.
OPENER: Final = re.compile(rf"^{DECORATION}<{{7,}}(?:\s|$)")

# What `merge.conflictStyle=diff3` writes above the separator. Absent from the default style, so
# nothing else here would ever see it.
BASE: Final = re.compile(rf"^{DECORATION}\|{{7,}}(?:\s|$)")

CLOSER: Final = re.compile(rf"^{DECORATION}>{{7,}}(?:\s|$)")

# prettier reflows a closer in a markdown file into nested blockquotes, so the raw closer above
# does not survive a commit that stages one. A blockquote seven levels deep is byte-identical to
# it, and that false positive is accepted.
BLOCKQUOTED_CLOSER: Final = re.compile(rf"^{DECORATION}(?:> ){{6}}>(?:\s|$)")

# Judged only under an opener. Alone it is a setext heading underline, which is valid markdown and
# carries no defect, and nothing in the line itself separates the two readings.
SEPARATOR: Final = re.compile(rf"^{DECORATION}={{7,}}\s*$")

# The one rule not anchored to a line start: prettier formats a fenced embedded language
# (`.prettierrc.json :: embeddedLanguageFormatting`) and can collapse a whole conflict onto one
# line, three runs together being a shape no ordinary content has.
COLLAPSED: Final = re.compile(r"<{7,}\s.*\s={7,}\s.*\s>{7,}(?:\s|$)")

# In the order a conflict writes them, which is the order a reader wants them reported in.
UNAMBIGUOUS: Final = (
    (OPENER, "a conflict opener"),
    (BASE, "a diff3 base marker"),
    (CLOSER, "a conflict closer"),
    (BLOCKQUOTED_CLOSER, "a conflict closer the formatter reflowed into blockquotes"),
    (COLLAPSED, "a whole conflict the formatter collapsed onto one line"),
)

# No path allowlist, and the corpus needs none: a backtick is not whitespace, so a quoted marker
# fails every rule above. A fence reproducing a conflict as git writes it is a finding, that shape
# being the one nothing tells from an unresolved merge.

# git's own test, at `buffer_is_binary`: a NUL in the first 8000 bytes. The skip set is then the
# set git refuses to merge line-wise, which no merge can have written a marker into; the residual
# is a hand-written one, held by the count.
BINARY_SNIFF_BYTES: Final = 8000


def markers_in(text: str) -> list[tuple[int, str]]:
    """Every conflict marker in one file's text, as its line number and what it is.

    The separator is gated on an opener above it, and the gate closes on the marker ending that
    conflict -- otherwise one quoted example claims every heading below it.
    """
    found: list[tuple[int, str]] = []
    opened = False
    for number, line in enumerate(text.split("\n"), start=1):
        for pattern, name in UNAMBIGUOUS:
            # `search` and not `match`, so each `^` above is the rule rather than decoration: under
            # `match` the anchor could be deleted without changing a single answer.
            if pattern.search(line):
                found.append((number, name))
                if pattern is OPENER:
                    opened = True
                elif pattern is CLOSER or pattern is BLOCKQUOTED_CLOSER:
                    opened = False
                break
        else:
            if opened and SEPARATOR.search(line):
                found.append((number, "a conflict separator"))
                opened = False
    return found


def text_of(path: Path) -> str | None:
    """One file as text, or None where it is binary. Raises OSError where it cannot be read.

    Decoding is lenient because every marker is ASCII: a replacement character can neither invent
    one nor hide one.
    """
    raw = path.read_bytes()
    if b"\x00" in raw[:BINARY_SNIFF_BYTES]:
        return None
    # Dropped as bytes rather than decoded: a BOM left in place puts a line-1 marker at column three.
    return raw.removeprefix(codecs.BOM_UTF8).decode("utf-8", errors="replace")


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
    read = 0
    binary = 0
    for path in paths:
        try:
            text = text_of(path)
        except OSError as error:
            unreadable.append(f"{shown(path)}: {error}")
            continue
        if text is None:
            binary += 1
            continue
        read += 1
        findings.extend(Finding("fail", f"{shown(path)}:{number} is {what}") for number, what in markers_in(text))

    code = report_findings(findings)

    if findings:
        print("\n      A committed marker destroys both sides of the merge at once: the formatter")
        print("      reflows it into ordinary text and every other check here reads it as content.")
        print("      Resolve the conflict and commit the resolution.\n")

    # Every path lands in exactly one of the three counts, so a run naming no marker can never mean
    # the files were never opened.
    scope = "named" if args.files else "tracked"
    print(f"      {len(paths)} {scope} file(s): {read} read as text, {binary} skipped as binary, {len(unreadable)} unreadable")

    for line in unreadable:
        print(f"      {line}", file=sys.stderr)
    if unreadable:
        print("      Those files were not read, so this run proves nothing about them.", file=sys.stderr)

    # A finding outranks a refusal: `scripts/verify.sh :: run_checker` reads exit 2 as nothing here
    # standing as a verdict, which would contradict the FAIL lines above it. The unread files are
    # named either way, so the precedence loses nothing.
    if unreadable and not findings:
        return EXIT_REFUSED
    return code


if __name__ == "__main__":
    sys.exit(run(main))
