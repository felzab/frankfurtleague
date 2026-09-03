"""SCRIPTS · the arms and rows no violation planted in the corpus reaches

`scripts/tests/test_check_docs.py` holds the fixture repository, the corpus it commits, the
plants and the `CASES` table. What stands here is what that table cannot hold: an input the
reader itself refuses, a producer a corpus plant would silence by answering first, and a value
only the clone under test can supply.

It is a file of its own because the gate's pytest step hands a module whole to one worker
(`scripts/tests/test_check_docs_cases.py`).

A planted violation never shares a line of THIS file with a hash or a triple quote, for
`scripts/tests/test_check_docs.py`'s reason.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Final

from conftest import git, write
from test_check_docs import (
    COPY_SAMPLE,
    DOCS_ENTRY,
    HASH,
    NEWLINE,
    NOTES,
    ORPHAN_ENTRY,
    QUOTES,
    ROADMAP,
    ROADMAP_TAIL,
    SCRIPTS_COPY,
    SLICE_DONE,
    SLICE_ROW,
    SLICE_STRAY,
    SPIELER_PANEL,
    UNDECODABLE_BYTES,
    UNTOKENIZABLE_MODULE,
    Reported,
    _append,
    _assert_corpus_restored,
    _clear_caches,
    _gate,
    _heading,
    _module,
    _page,
    _read,
    _replace,
    _reset,
    _run,
    _shape,
    _tick,
    _write_raw,
)

# --- the arms a check takes when its own input refuses ---------------------------------------------


def test_a_roadmap_that_cannot_be_decoded_is_read_against_nothing() -> None:
    """A page the reader refuses yields no heading and no row, which is the shape of a clean page."""
    _reset()
    _write_raw(ROADMAP, UNDECODABLE_BYTES)
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 1, _shape(reported)
    _assert_corpus_restored()


def _roadmap_findings(plant: Callable[[], None]) -> Counter[Reported]:
    """One roadmap plant's findings, restored whatever it raised."""
    _reset()
    try:
        plant()
        return _run()[1]
    finally:
        _reset()


def test_an_entry_heading_no_index_row_defines_is_reported_once() -> None:
    """An id in no index row is the pairing's finding, and nothing else on the page speaks about it."""
    added = _page(
        _heading(3, _tick(ORPHAN_ENTRY) + " · An entry no index row defines"),
        "",
        "It names `docs/notes.md`.",
        "",
        _heading(2, ROADMAP_TAIL),
    ).rstrip("\n")
    reported = _roadmap_findings(lambda: _replace(ROADMAP, _heading(2, ROADMAP_TAIL), added))
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 1, "a heading no row defines went unreported: " + _shape(reported)
    _assert_corpus_restored()


def test_a_written_tag_naming_a_slice_the_entry_never_touches_fails_both_ways() -> None:
    """The arm the slice axis exists for: a tag derived from the tree, against one somebody wrote."""
    reported = _roadmap_findings(lambda: _replace(ROADMAP, SLICE_ROW, SLICE_ROW.replace("BE, spiele", "BE, teams")))
    # Both directions, because either alone passes a row half-right: a derived tag left out reads
    # as a narrower item, and a written one nothing derives reads as a wider one.
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 2, "a slice tag no path touches passed: " + _shape(reported)
    _assert_corpus_restored()


def test_a_slice_is_matched_as_a_whole_segment_rather_than_as_a_substring() -> None:
    """`spiele` opens `spieler` and `spieltage`, so a substring test tags an entry with slices it never touches.

    The entry names the `spieler` panel alone: read as a substring its path carries `spiele` too.
    """

    def plant() -> None:
        _replace(ROADMAP, SLICE_DONE, "Done is `" + SPIELER_PANEL + "` rendering the squad it names.")
        _replace(ROADMAP, SLICE_ROW, SLICE_ROW.replace("BE, spiele", "FE, spieler"))

    reported = _roadmap_findings(plant)
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 0, "a whole-segment match reported anyway: " + _shape(reported)
    _assert_corpus_restored()


def test_a_segment_under_a_slice_root_that_names_no_slice_is_reported() -> None:
    """Dropped instead, a mistyped slice would leave the entry judged against a narrower derivation and the row reading as correct (PRE-4)."""
    # Three: the stray segment, the frontend tag the new path derives, and the two the old one no
    # longer does. The stray is what this case turns on, and the other two follow from the swap.
    reported = _roadmap_findings(lambda: _replace(ROADMAP, SLICE_DONE, "Done is `" + SLICE_STRAY + "` naming a segment no slice owns."))
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 3, "a stray slice segment passed: " + _shape(reported)
    _assert_corpus_restored()


def test_an_entry_naming_no_path_is_reported_rather_than_defaulted() -> None:
    """No derived tag is an entry nobody can place, which is a subject nobody stated."""

    def plant() -> None:
        _replace(ROADMAP, SLICE_DONE, "Done is a read that answers.")
        _replace(ROADMAP, SLICE_ROW, SLICE_ROW.replace("BE, spiele", "BE"))

    reported = _roadmap_findings(plant)
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 1, "an entry naming nothing was defaulted: " + _shape(reported)
    _assert_corpus_restored()


def test_a_batch_naming_an_entry_this_file_holds_stays_silent() -> None:
    """The batching line resolves rather than judges: a token that names an entry is the whole test."""
    reported = _roadmap_findings(lambda: _replace(ROADMAP, SLICE_DONE, SLICE_DONE + "\n\nLands with: " + DOCS_ENTRY))
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 0, "a resolvable batch reported anyway: " + _shape(reported)
    _assert_corpus_restored()


def test_a_file_the_byte_check_cannot_open_is_named_rather_than_passed_over() -> None:
    """Silence there is indistinguishable from a file proved to hold neither byte."""
    _reset()
    checks = _module("docs_gate.checks")
    _clear_caches(_gate().root / SCRIPTS_COPY)
    target = _gate().root / NOTES
    real = Path.read_bytes

    def refusing(self: Path) -> bytes:
        if self == target:
            raise OSError("the file could not be opened")
        return real(self)

    Path.read_bytes = refusing
    try:
        found = [finding for finding in checks.check_binary_bytes() if finding.file == NOTES]
    finally:
        Path.read_bytes = real
        _reset()
    assert len(found) == 1, found
    assert "could not be opened" in found[0].detail, found[0].detail


def test_a_sha_this_clone_resolves_is_failed_like_any_other() -> None:
    """HEAD's own short form is the one SHA no clone can call dangling, and so the case a resolution-shaped reader lets through (COR-6)."""
    _reset()
    branch = _module("docs_gate.branch")
    kernel = _module("docs_gate.kernel")
    head = git(_gate().root, "rev-parse", "HEAD")
    live = next((head[:n] for n in (8, 7) if any(c.isdigit() for c in head[:n]) and any(c.isalpha() for c in head[:n])), None)
    assert live is not None, "HEAD's short form carries no digit and letter, so it proves nothing here"
    _append(NOTES, "The commit `" + live + "` is named here.")
    _clear_caches(_gate().root / SCRIPTS_COPY)
    try:
        found = branch.check_prose_shas(kernel.scanned_files())
    finally:
        _reset()
    assert [(f.check, f.file) for f in found] == [("sha", NOTES)], [f.detail for f in found]
    _assert_corpus_restored()


def test_a_module_header_s_list_markers_cost_it_nothing() -> None:
    """INC-2 measures the header text with its markers stripped, and its `See:` list is written with them.

    Called directly rather than planted: reaching that bound through the corpus needs a header
    longer than every plant beside it.
    """
    checks = _module("docs_gate.checks")
    entry = "- fl_backend/app/sample.py"
    # Enough entries that the markers alone decide, with the prose a word under the bound.
    markers = checks.HEADER_WORD_CAP // 2
    filler = ["BACKEND · a module whose header is a word under the bound before any marker is read."]
    filler += ["a clause of the header's prose"] * ((checks.HEADER_WORD_CAP - 15 - markers * 2) // 6)
    header = filler + ["See:"] + [entry] * markers
    raw = "\n".join("# " + line for line in header) + "\nVALUE = 1\n"
    words = checks.word_count(" ".join(line.removeprefix("- ") for line in header))
    assert words <= checks.HEADER_WORD_CAP < words + markers, "the fixture proves nothing unless the markers alone break the bound"
    found = checks.check_module_header("scripts/sample.py", raw, ".sh")
    assert [f.detail for f in found if "caps it at" in f.detail] == [], [f.detail for f in found]


# --- the copy scanner's own verdict ------------------------------------------------------------------

# Each ends the scan somewhere it did not start, and each is a shape a real edit reaches. The last
# two are why frames alone cannot answer: a brace in code moves a depth and opens no frame.
UNREADABLE_AS_TYPESCRIPT: Final[tuple[tuple[str, str], ...]] = (
    ("a brace closing nothing inside an element", "export function A() { return <p>Text}</p>; }"),
    ("an element nothing closes", "export function A() { return <p>Text; }"),
    ("a template nothing closes", "export const A = `Text;"),
    ("a closer past the top level", "export const A = 1;" + NEWLINE + "}"),
    ("a block nothing closes", "export function A() {" + NEWLINE + "  return 1;"),
)

READABLE_AS_TYPESCRIPT: Final[tuple[str, ...]] = (
    "export const A = 'Text';",
    "export function A() { return <p>Text</p>; }",
)


def test_the_copy_scanner_answers_whether_it_read_the_file_to_the_end() -> None:
    """Two consumers go quiet together when this stops answering: the finding below, and the floor test's assertion over the list it fills."""
    scanner = _module("docs_gate.copy_rules")
    wrong: list[str] = []
    for name, source in UNREADABLE_AS_TYPESCRIPT:
        if scanner._scan(source + NEWLINE, jsx=True)[1]:
            wrong.append(name + " was read as balanced")
    for source in READABLE_AS_TYPESCRIPT:
        if not scanner._scan(source + NEWLINE, jsx=True)[1]:
            wrong.append("a file that balances was refused: " + source)
    assert not wrong, NEWLINE.join(wrong)


def test_a_file_the_copy_scanner_cannot_read_to_the_end_is_reported() -> None:
    """Without it a mis-parsed file passes the copy sweep with no span read out of it at all."""
    _reset()
    _append(COPY_SAMPLE, UNREADABLE_AS_TYPESCRIPT[0][1])
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "copy-corpus", COPY_SAMPLE)] == 1, _shape(reported)
    _assert_corpus_restored()


# --- source the tokenizer refuses ------------------------------------------------------------------


def test_a_module_python_cannot_tokenize_still_has_its_comments_read() -> None:
    """Reading no comments would look like a file holding none, which every comment check passes."""
    _reset()
    # An unterminated triple quote: tokenize raises, and the marker reader keeps the lines anyway.
    write(_gate().root, UNTOKENIZABLE_MODULE, _page(HASH + " a comment naming docs/gone.md", "unterminated = " + QUOTES))
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "bare-path", UNTOKENIZABLE_MODULE)] == 1, _shape(reported)
    _assert_corpus_restored()


# --- the rows and alternatives nothing else plants ---------------------------------------------------


def test_a_working_tree_holding_both_endings_is_named_as_mixed() -> None:
    """`crlf` and `mixed` are two answers from git, and a file carrying one line of each gives the second."""
    _reset()
    _write_raw(NOTES, _read(NOTES).encode("utf-8") + b"A line with a return\r\nand one without\n")
    try:
        _, reported = _run()
        endings = [finding for finding in _module("docs_gate.checks").check_line_endings() if finding.file == NOTES]
    finally:
        _reset()
    assert reported[("fail", "line-endings", NOTES)] == 1, _shape(reported)
    assert "MIXED" in endings[0].detail, endings[0].detail
    _assert_corpus_restored()


def test_a_citation_naming_a_file_by_its_name_alone_is_resolved_by_its_kind() -> None:
    """A Dockerfile carries no suffix, so only the filename register makes the left half read as a file."""
    _reset()
    _append(NOTES, "The image is built by `nginx/Dockerfile :: CMD`.")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "citation", NOTES)] == 1, _shape(reported)
    _assert_corpus_restored()


def test_a_hyphen_holding_a_compound_open_is_not_punctuation() -> None:
    """Rendered alone is the one position the exemption is reached in: elsewhere the word behind the hyphen already settles it."""
    _reset()
    _append(COPY_SAMPLE, "export function Verkauf() {", "  return <p>Ticket<span>-</span> und Cateringverkäufe stehen bereit.</p>;", "}")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert not [key for key in reported if key[1] == "copy-dash"], _shape(reported)
    _assert_corpus_restored()


def test_a_repository_path_never_resolves_through_a_traversal() -> None:
    """What comes back has to be a git listing's spelling, and a normalised traversal is not one."""
    kernel = _module("docs_gate.kernel")
    assert kernel.repo_path(NOTES) == NOTES
    for token in ("../" + NOTES, "docs/../" + NOTES, "/" + NOTES, "./" + NOTES):
        assert kernel.repo_path(token) is None, token


def test_a_skipped_folder_is_skipped_at_every_depth() -> None:
    """`node_modules` occurs nested and never at the root, so a prefix test alone reaches none of it."""
    kernel = _module("docs_gate.kernel")
    root = _gate().root
    assert kernel._skipped(root / "fl_frontend" / "node_modules" / "pkg" / "readme.md")
    assert kernel._skipped(root / "docs" / "audit" / "notes.md")
    assert not kernel._skipped(root / NOTES)
