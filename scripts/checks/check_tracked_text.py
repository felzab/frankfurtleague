"""SCRIPTS · no tracked file carries a merge conflict marker or an invisible character.

An unresolved conflict's markers are ordinary text to every parser
here, so once committed nothing downstream tells the file apart from a document its author meant;
an invisible character is worse, because nobody can see it in a diff or a review -- a word-boundary
escape a JSON decode turned into a backspace sits inside a regex literal narrowing it, under a
green suite. Each conflict rule stands on its own, the formatter running at commit time destroying
some of the set and leaving the rest, and each tolerates the indentation and the quote, list and
table decoration that formatter puts in front of a marker rather than refusing the file.

Every tracked file is read, with no suffix list and no exemption for a fenced block: a fence is
where a conflict inside an example hides, and a list of extensions silently passes whatever it
forgets. The one allowlist is `ALLOWED`, which the invisible rule alone reads.
"""

from __future__ import annotations

import argparse
import codecs
import re
import sys
from pathlib import Path
from typing import Final

# Every caller runs this as a script, so sys.path opens with THIS directory and `lib/` is a
# sibling of it rather than in it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import (
    EXIT_CRASH,
    EXIT_REFUSED,
    REPO_ROOT,
    Finding,
    git,
    report_findings,
    run,
)

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


# Tab, newline and carriage return are the three a text file is made of; every other C0 control and
# DEL reach a source file only by accident.
_CONTROL: Final = frozenset(chr(point) for point in (*range(0x00, 0x20), 0x7F)) - frozenset("\t\n\r")
_BIDIRECTIONAL: Final = frozenset("\u200e\u200f") | frozenset(chr(point) for point in (*range(0x202A, 0x202F), *range(0x2066, 0x206A)))

BYTE_ORDER_MARK: Final = "\ufeff"

# What a finding calls each one. The class and not the character, because a reader shown `U+202E`
# alone still has to look it up before knowing whether it can reorder the line around it.
NAMED: Final[dict[str, str]] = {
    **dict.fromkeys(_CONTROL, "a control character"),
    **dict.fromkeys("\u200b\u200c\u200d", "a zero-width character"),
    **dict.fromkeys(_BIDIRECTIONAL, "a bidirectional control"),
    **dict.fromkeys("\u2028\u2029", "a line separator"),
    BYTE_ORDER_MARK: "a byte order mark",
}

# Derived from the map rather than spelled beside it, so the set this finds and the set it can name
# cannot drift apart: a character one holds is one the other answers for.
FORBIDDEN: Final = re.compile(f"[{''.join(re.escape(character) for character in NAMED)}]")

# A file whose invisible characters are its SUBJECT, each with what makes it data. A path here is a
# decision, not a backlog entry: a file neither clean nor listed fails, and so does a listed file
# that carries none.
ALLOWED: Final[dict[str, str]] = {
    "fl_frontend/src/core/emailAddress.test.ts": (
        "the characters `new URL` deletes while parsing, spelled as themselves because what that parse does to them is the subject"
    ),
}


def invisible_in(text: str) -> list[tuple[int, str]]:
    """Every invisible character in one file's text, as its line number and what it is."""
    # One class scan before any per-character walk: almost every file holds none, and answering that
    # in a single pass is what keeps this rule's cost a rounding error against the read beside it.
    if FORBIDDEN.search(text) is None:
        return []

    return [(text.count("\n", 0, hit.start()) + 1, f"{NAMED[hit.group()]} U+{ord(hit.group()):04X}") for hit in FORBIDDEN.finditer(text)]


def text_of(raw: bytes) -> str | None:
    """Those bytes as text, or None where they are binary.

    Decoding is lenient because every marker is ASCII: a replacement character can neither invent
    one nor hide one.
    """
    if b"\x00" in raw[:BINARY_SNIFF_BYTES]:
        return None
    # Dropped as bytes rather than decoded: a BOM left in place puts a line-1 marker at column three.
    return raw.removeprefix(codecs.BOM_UTF8).decode("utf-8", errors="replace")


def shown(path: Path) -> str:
    """The path as a finding names it -- repo-relative where it can be, forward slashes either way."""
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
    parser = argparse.ArgumentParser(description="Does any tracked file carry a merge conflict marker or an invisible character?")
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

    markers_found: list[Finding] = []
    invisible_found: list[Finding] = []
    unreadable: list[str] = []
    carried: set[str] = set()
    read = 0
    binary = 0
    for path in paths:
        try:
            raw = path.read_bytes()
        except OSError as error:
            unreadable.append(f"{shown(path)}: {error}")
            continue
        text = text_of(raw)
        if text is None:
            binary += 1
            continue
        read += 1
        rel = shown(path)
        markers_found.extend(Finding("fail", f"{rel}:{number} is {what}") for number, what in markers_in(text))

        hits = invisible_in(text)
        # `text_of` drops the mark before decoding, so the one character no scan of the text can
        # reach is the one standing at offset zero.
        if raw.startswith(codecs.BOM_UTF8):
            hits.insert(0, (1, f"{NAMED[BYTE_ORDER_MARK]} U+FEFF opening the file"))
        if hits:
            carried.add(rel)
        if rel not in ALLOWED:
            invisible_found.extend(Finding("fail", f"{rel}:{number} carries {what}") for number, what in hits)

    # Over the whole tree alone: a run given a file list was never offered the other entries, and
    # would call every one of them stale.
    if not args.files:
        invisible_found.extend(
            Finding("fail", f"{rel} is allowed an invisible character and carries none -- drop the entry")
            for rel in sorted(ALLOWED)
            if rel not in carried
        )

    findings = [*markers_found, *invisible_found]
    code = report_findings(findings)

    if markers_found:
        print("\n      A committed marker destroys both sides of the merge at once: the formatter")
        print("      reflows it into ordinary text and every other check here reads it as content.")
        print("      Resolve the conflict and commit the resolution.\n")

    if invisible_found:
        print("\n      An invisible character reaches a review as nothing at all, and the line around")
        print("      it means something else than it reads. Delete it, or spell it by code point; a")
        print("      file whose subject IS such a character earns a line in ALLOWED with its reason.\n")

    # Every path lands in exactly one of the three counts, so a run naming no marker can never mean
    # the files were never opened.
    scope = "named" if args.files else "tracked"
    print(f"      {len(paths)} {scope} file(s): {read} read as text, {binary} skipped as binary, {len(unreadable)} unreadable")

    for line in unreadable:
        print(f"      {line}", file=sys.stderr)
    if unreadable:
        print("      Those files were not read, so this run proves nothing about them.", file=sys.stderr)

    # A finding outranks a refusal: `scripts/gate/verify.sh :: run_checker` reads exit 2 as nothing here
    # standing as a verdict, which would contradict the FAIL lines above it. The unread files are
    # named either way, so the precedence loses nothing.
    if unreadable and not findings:
        return EXIT_REFUSED
    return code


if __name__ == "__main__":
    sys.exit(run(main))
