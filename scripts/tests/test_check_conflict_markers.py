"""SCRIPTS · the conflict-marker check, over the forms a marker actually reaches the tree in.

Every marker here is BUILT from a repeated character rather than typed. A literal one would make
this file a finding of the checker it drives, and the suite would fail on its own source.

`main` is exercised as well as the rules, the exit contract being the half a rule test cannot
reach: a checker answering 0 where it found something is the failure this one exists to prevent.

Stdlib only, and `scripts/checks/` is put on the path here because the module under test is run
as a script everywhere else, which is what seeds that directory onto the path for it.
"""

from __future__ import annotations

import contextlib
import importlib
import io
import sys
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]

# Withdrawn again, kernel dropped from the cache with it, matching `test_check_compose_mirror.py`:
# a `checker_kernel` left cached here would answer another suite's imports and root it at the wrong
# repository.
sys.path.insert(0, str(SCRIPTS / "checks"))
try:
    markers = importlib.import_module("check_conflict_markers")
finally:
    sys.path.remove(str(SCRIPTS / "checks"))
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


def written(path: Path, text: str) -> Path:
    """One file holding that text, as bytes: a text-mode write would turn every LF into CRLF."""
    path.write_bytes(f"{text}\n".encode())
    return path


def run_main(*argv: str) -> tuple[int, str, str]:
    """`main` over those arguments: its exit code and each stream it wrote.

    Captured by hand rather than through a fixture, so this file imports nothing outside the
    standard library -- `scripts/pyrightconfig.json` declares no environment.
    """
    out, err = io.StringIO(), io.StringIO()
    argv_before = markers.sys.argv
    markers.sys.argv = ["check_conflict_markers.py", *argv]
    try:
        # `checker_kernel :: report_findings` binds its stream at import, so its FAIL lines reach
        # pytest's own capture rather than the strings returned here.
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = markers.main()
    finally:
        markers.sys.argv = argv_before
    return code, out.getvalue(), err.getvalue()


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


def test_a_diff3_base_marker_behind_decoration_is_caught():
    """The base marker meets the same formatter the other three do, and column zero is not where it lands.

    Its own case because no other rule's fixture reaches this one: a marker character that is also
    a table wall needs its own.
    """
    text = joined("- item", f"  {OPENER} HEAD", f"  {BASE} base", "  ancestor", f"  {SEPARATOR}", "  theirs")

    assert kinds(text) == ["a conflict opener", "a diff3 base marker", "a conflict separator"]


def test_a_diff3_base_marker_inside_a_table_cell_is_caught():
    """The incident's own shape, for the marker whose own character is what a table row starts with."""
    text = joined("| a | b |", "| --- | --- |", f"| {OPENER} HEAD | x |", f"| {BASE} base | x |")

    assert kinds(text) == ["a conflict opener", "a diff3 base marker"]


def test_a_marker_away_from_line_start_is_not_a_finding():
    """Prose quoting a marker mid-sentence is not a defect, which is what each `^` is there for."""
    assert markers.markers_in(joined(f"The opener is {OPENER} followed by a name.")) == []


def test_a_backticked_marker_is_not_a_finding():
    """The corpus's escape hatch: a backtick is not whitespace, so a quoted marker fails the gate."""
    assert markers.markers_in(joined(f"`{OPENER} HEAD`", f"- `{CLOSER} other`")) == []


def test_the_line_number_is_the_one_a_reader_opens():
    """A finding locates the marker, so the number has to be one-based over the file's own lines."""
    assert markers.markers_in(joined("one", "two", f"{OPENER} HEAD")) == [(3, "a conflict opener")]


def test_an_indented_conflict_is_caught():
    """prettier's html printer indents a marker rather than refusing it, so it never fails the file."""
    text = joined("<div>", f"  {OPENER} HEAD", "  <p>ours</p>", f"  {SEPARATOR}", "  <p>theirs</p>", f"  {CLOSER} other", "</div>")

    assert kinds(text) == ["a conflict opener", "a conflict separator", "a conflict closer"]


def test_a_conflict_under_a_list_bullet_is_caught():
    """A markdown list re-indents its content, and the closer comes back as an indented blockquote."""
    text = joined("- item", f"  {OPENER} HEAD", "  ours", f"  {SEPARATOR}", "  theirs", f"  {REFLOWED_CLOSER} other")

    assert kinds(text) == [
        "a conflict opener",
        "a conflict separator",
        "a conflict closer the formatter reflowed into blockquotes",
    ]


def test_a_conflict_absorbed_into_table_cells_is_caught():
    """The incident's own shape: prettier padded each marker into a cell of the table around it."""
    text = joined("| a | b |", "| --- | --- |", f"| {OPENER} HEAD | x |", f"| {CLOSER} other | x |")

    assert kinds(text) == ["a conflict opener", "a conflict closer"]


def test_a_conflict_collapsed_onto_one_line_is_caught():
    """A fenced html block is formatted as html, and that printer can put the whole conflict on one line."""
    text = joined("```html", f"<div>{OPENER} HEAD ours {SEPARATOR} theirs {CLOSER} other</div>", "```")

    assert kinds(text) == ["a whole conflict the formatter collapsed onto one line"]


def test_a_run_shorter_than_seven_is_not_a_finding():
    """Seven is git's default marker size and the floor: a shorter run is arrows or a rule, not a marker."""
    assert markers.markers_in(joined(f"{'<' * 6} HEAD", f"{'>' * 6} other")) == []


def test_a_longer_marker_run_is_caught():
    """`conflict-marker-size` widens what git writes, and a wider marker is the same defect."""
    assert kinds(joined(f"{'<' * 9} HEAD")) == ["a conflict opener"]


def test_a_run_followed_by_a_word_is_not_a_finding():
    """git writes whitespace after the run, so a run touching a word is content rather than a marker."""
    assert markers.markers_in(joined(f"{OPENER}x", f"{CLOSER}x")) == []


def test_a_separator_carrying_trailing_text_is_not_a_finding():
    """The separator's line holds nothing else, so a run with a word after it is a rule someone drew."""
    assert kinds(joined(f"{OPENER} HEAD", f"{SEPARATOR} and then some")) == ["a conflict opener"]


def test_a_six_deep_blockquote_is_not_a_finding():
    """The reflowed closer is seven levels because the marker is seven characters; six is a quotation."""
    assert markers.markers_in(joined("> " * 5 + "> quoted")) == []


def test_one_line_yields_one_finding():
    """Two rules can claim one line, and a reader wants the line named once."""
    assert kinds(joined(f"{'> ' * 7}{CLOSER} other")) == ["a conflict closer"]


def test_the_separator_closes_the_gate_it_was_judged_under():
    """One quoted conflict must not turn every setext heading below it into a finding."""
    text = joined(f"{OPENER} HEAD", "ours", SEPARATOR, "theirs", "", "A Real Heading", SEPARATOR)

    assert kinds(text) == ["a conflict opener", "a conflict separator"]


def test_the_closer_closes_the_gate_where_the_separator_did_not_survive():
    """The formatter destroys a separator before it destroys a closer, so the closer closes it too."""
    text = joined(f"{OPENER} HEAD", "ours", f"{CLOSER} other", "", "A Real Heading", SEPARATOR)

    assert kinds(text) == ["a conflict opener", "a conflict closer"]


def test_a_binary_file_is_skipped(tmp_path: Path):
    """git calls a file binary on a NUL in its first 8000 bytes, and its merge writes no marker there."""
    blob = tmp_path / "payload.bin"
    blob.write_bytes(b"\x00\x01" + OPENER.encode() + b" HEAD\n")

    assert markers.text_of(blob) is None


def test_a_nul_past_the_sniff_window_leaves_the_file_text(tmp_path: Path):
    """The window is git's, so a text file carrying one late NUL is still read rather than dropped."""
    blob = tmp_path / "late.md"
    blob.write_bytes(b"a" * markers.BINARY_SNIFF_BYTES + b"\n" + OPENER.encode() + b" HEAD\n\x00")

    text = markers.text_of(blob)

    assert text is not None
    assert kinds(text) == ["a conflict opener"]


def test_a_text_file_is_read_as_text(tmp_path: Path):
    """The other side of the binary test, so a skip cannot pass for a clean read."""
    source = written(tmp_path / "note.md", f"{OPENER} HEAD")

    text = markers.text_of(source)

    assert text is not None
    assert kinds(text) == ["a conflict opener"]


def test_a_byte_order_mark_does_not_hide_the_opener(tmp_path: Path):
    """A BOM sits before the first character, so a marker on line 1 would start at column three."""
    source = tmp_path / "bom.md"
    source.write_bytes(b"\xef\xbb\xbf" + f"{OPENER} HEAD\n".encode())

    text = markers.text_of(source)

    assert text is not None
    assert kinds(text) == ["a conflict opener"]


def test_main_grades_a_marker_as_a_finding(tmp_path: Path):
    """The exit contract's own case: what the rules found has to reach the code the shell reads."""
    source = written(tmp_path / "note.md", f"{OPENER} HEAD")

    assert run_main(str(source))[0] == 1


def test_main_names_every_marker_in_one_file(tmp_path: Path):
    """A conflict is three or four lines, and a reader resolving it needs all of them.

    `main` is where the rules' answer becomes findings, and one per file would report the opener
    and go quiet about the rest.
    """
    text = joined(f"{OPENER} HEAD", "ours", SEPARATOR, "theirs", f"{CLOSER} other")
    source = written(tmp_path / "note.md", text)
    seen: list[str] = []
    grade = markers.report_findings

    def recording(findings, **rest):
        collected = list(findings)
        seen.extend(finding.detail for finding in collected)
        return grade(collected, **rest)

    with patch.object(markers, "report_findings", recording):
        code, _, _ = run_main(str(source))

    assert code == 1
    assert [detail.rsplit(" is ", 1)[1] for detail in seen] == [
        "a conflict opener",
        "a conflict separator",
        "a conflict closer",
    ]
    assert [detail.rsplit(" is ", 1)[0].rsplit(":", 1)[1] for detail in seen] == ["1", "3", "5"]


def test_main_passes_a_clean_file(tmp_path: Path):
    """The other side of it, so a finding-shaped answer cannot be what the checker always gives."""
    source = written(tmp_path / "note.md", "Body text.")

    assert run_main(str(source))[0] == 0


def test_main_refuses_a_file_it_could_not_read(tmp_path: Path):
    """A file nothing opened leaves the tree unproven, which is not the same answer as a clean one."""
    code, _, err = run_main(str(tmp_path / "gone.md"))

    assert code == 2
    assert "gone.md" in err


def test_main_prefers_a_proven_finding_to_a_refusal(tmp_path: Path):
    """A refusal says nothing here stands as a verdict, which would contradict the marker it printed."""
    source = written(tmp_path / "note.md", f"{OPENER} HEAD")

    assert run_main(str(source), str(tmp_path / "gone.md"))[0] == 1


def test_main_crashes_where_git_could_not_list_the_tree():
    """Nothing was read, so the answer is the environment's rather than a pass over an empty list."""
    with patch.object(markers, "tracked_files", return_value=None):
        code, _, _ = run_main()

    assert code == 3


def test_main_accounts_for_every_file_it_was_given(tmp_path: Path):
    """A report naming no marker must not be reachable by a run that opened nothing."""
    text = written(tmp_path / "note.md", "Body text.")
    blob = tmp_path / "payload.bin"
    blob.write_bytes(b"\x00\x01")

    _, out, _ = run_main(str(text), str(blob), str(tmp_path / "gone.md"))

    assert "3 named file(s): 1 read as text, 1 skipped as binary, 1 unreadable" in out
