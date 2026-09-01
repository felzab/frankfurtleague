"""SCRIPTS · the conflict-marker check, over the forms a marker actually reaches the tree in.

Every marker here is BUILT from a repeated character rather than typed. A literal one would make
this file a finding of the checker it drives, and the suite would fail on its own source.

Stdlib only, and `scripts/` is put on the path here because the module under test imports
`checker_kernel` as a sibling rather than as a package.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent

# Withdrawn again, kernel dropped from the cache with it, matching `tests/test_check_compose_mirror.py`:
# a `checker_kernel` left cached here would answer another suite's imports and root it at the wrong
# repository.
sys.path.insert(0, str(SCRIPTS))
try:
    markers = importlib.import_module("check_conflict_markers")
finally:
    sys.path.remove(str(SCRIPTS))
    sys.modules.pop("check_conflict_markers", None)
    sys.modules.pop("checker_kernel", None)

OPENER = "<" * 7
SEPARATOR = "=" * 7
CLOSER = ">" * 7

# What prettier leaves where a markdown file was staged holding a closer.
REFLOWED_CLOSER = "> " * 6 + ">"

BASE = "|" * 7


def joined(*lines: str) -> str:
    """The lines as one file's text."""
    return "\n".join(lines)


def kinds(text: str) -> list[str]:
    """What the checker calls each marker it found, in file order."""
    return [what for _, what in markers.markers_in(text)]


def test_a_file_with_no_marker_yields_nothing():
    """The ordinary case, and the one every run of the gate takes."""
    assert markers.markers_in(joined("A heading", "", "Body text.", "")) == []


def test_a_raw_conflict_reports_all_three_lines():
    """What sits in the working tree before anything has formatted it."""
    text = joined("Intro.", f"{OPENER} HEAD", "ours", SEPARATOR, "theirs", f"{CLOSER} other-branch")

    assert kinds(text) == ["a conflict opener", "a conflict separator", "a conflict closer"]


def test_a_setext_heading_is_not_a_finding():
    """A run of `=` under text is valid markdown, and no opener stands above it."""
    assert markers.markers_in(joined("A Real Heading", SEPARATOR, "", "Body.")) == []


def test_a_separator_under_an_opener_is_a_finding():
    """The other half of the same rule: context is what tells the two readings apart."""
    assert kinds(joined(f"{OPENER} HEAD", "ours", SEPARATOR)) == ["a conflict opener", "a conflict separator"]


def test_the_reflowed_closer_is_caught():
    """prettier rewrites a closer into nested blockquotes, so this is the form a commit carries."""
    assert kinds(joined("text", f"{REFLOWED_CLOSER} other-branch")) == ["a conflict closer the formatter reflowed into blockquotes"]


def test_a_diff3_base_marker_is_caught():
    """`merge.conflictStyle=diff3` writes a fourth marker the default style never produces."""
    assert kinds(joined(f"{BASE} base", "the common ancestor")) == ["a diff3 base marker"]


def test_a_marker_away_from_line_start_is_not_a_finding():
    """git writes every marker at column zero, so prose quoting one is not a defect."""
    assert markers.markers_in(joined(f"The opener is {OPENER} followed by a name.", f"  {OPENER} HEAD")) == []


def test_the_line_number_is_the_one_a_reader_opens():
    """A finding locates the marker, so the number has to be one-based over the file's own lines."""
    assert markers.markers_in(joined("one", "two", f"{OPENER} HEAD")) == [(3, "a conflict opener")]


def test_a_binary_file_is_skipped(tmp_path: Path):
    """A NUL byte is git's own test for binary, and a marker there is a byte pattern, not a line."""
    blob = tmp_path / "payload.bin"
    blob.write_bytes(b"\x00\x01" + OPENER.encode() + b" HEAD\n")

    assert markers.text_of(blob) is None


def test_a_text_file_is_read_as_text(tmp_path: Path):
    """The other side of the binary test, so a skip cannot pass for a clean read."""
    source = tmp_path / "note.md"
    source.write_bytes(f"{OPENER} HEAD\n".encode())

    text = markers.text_of(source)

    assert text is not None
    assert kinds(text) == ["a conflict opener"]
