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

import subprocess
import sys
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Final

from conftest import REPO_ROOT, git, write
from test_check_docs import (
    BACKEND_SPEC,
    BLOCKED_ENTRY,
    BLOCKED_FIELDS,
    COPY_SAMPLE,
    DOCS_ENTRY,
    HASH,
    INVARIANT_ROW,
    NEWLINE,
    NOTES,
    ORPHAN_ENTRY,
    PARAGRAPH_CELL,
    QUOTES,
    ROADMAP,
    ROADMAP_FIELD_HEADER,
    SAMPLE,
    SCRIPTS_COPY,
    SHORT_FORM,
    SLICE_DONE,
    SLICE_ENTRY,
    STANDARD,
    UNDECODABLE_BYTES,
    UNTOKENIZABLE_MODULE,
    VOCAB_ENTRY,
    VOCAB_FIELDS,
    Reported,
    _about,
    _append,
    _assert_corpus_restored,
    _clear_caches,
    _gate,
    _module,
    _output,
    _page,
    _read,
    _replace,
    _reported,
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


def test_a_batch_naming_an_entry_this_file_holds_stays_silent() -> None:
    """The batching line resolves rather than judges: a token that names an entry is the whole test."""
    reported = _roadmap_findings(lambda: _replace(ROADMAP, SLICE_DONE, SLICE_DONE + "\n\nLands with: " + DOCS_ENTRY))
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 0, "a resolvable batch reported anyway: " + _shape(reported)
    _assert_corpus_restored()


def test_an_entry_naming_no_path_is_reported() -> None:
    """A reader finds an entry by the paths it names, so one naming none states no subject."""
    reported = _roadmap_findings(lambda: _replace(ROADMAP, SLICE_DONE, "Done is a read that answers."))
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 1, "an entry naming no path passed: " + _shape(reported)
    _assert_corpus_restored()


def test_a_blocked_entry_whose_only_dependency_left_is_reported_once() -> None:
    """The departed token is the finding; the `Blocked` arm reporting it too would give one defect two findings."""
    reported = _roadmap_findings(
        lambda: _replace(ROADMAP, BLOCKED_FIELDS, BLOCKED_FIELDS.replace("| Open | — |", "| Blocked | " + _tick(ORPHAN_ENTRY) + " |"))
    )
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 1, "a departed blocker was not reported exactly once: " + _shape(reported)
    _assert_corpus_restored()


def test_a_field_table_headed_out_of_order_is_reported_once() -> None:
    """The column arm's finding alone: read by position, the status arm would take the em dash for a word outside the set."""
    reordered = "| Depends on | Status |\n| --- | --- |"
    reported = _roadmap_findings(
        lambda: _replace(ROADMAP, VOCAB_FIELDS, VOCAB_FIELDS.replace(ROADMAP_FIELD_HEADER, reordered).replace("| Open | — |", "| — | Open |"))
    )
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 1, "a reordered header was not reported exactly once: " + _shape(reported)
    _assert_corpus_restored()


EMPTY_STATUS: Final = "|  |"


def _roadmap_output(plant: Callable[[], None]) -> tuple[Counter[Reported], str]:
    """One roadmap plant's findings and what the run printed, restored whatever it raised."""
    _reset()
    try:
        plant()
        _, output = _output()
        return _reported(output), output
    finally:
        _reset()


def test_a_status_cell_left_empty_is_reported_as_no_status() -> None:
    """An empty cell is no word, so it is named as missing rather than as a word outside the set."""
    reported, output = _roadmap_output(lambda: _replace(ROADMAP, VOCAB_FIELDS, VOCAB_FIELDS.replace("| Open |", EMPTY_STATUS)))
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 1, "an empty status cell was not reported once: " + _shape(reported)
    assert "entry " + VOCAB_ENTRY + " states no status" in output, output
    _assert_corpus_restored()


def test_a_batch_naming_its_own_entry_is_reported() -> None:
    """A batch of one is no shared pass, and its token resolves, so the resolution arm alone would pass it."""
    reported = _roadmap_findings(lambda: _replace(ROADMAP, SLICE_DONE, SLICE_DONE + "\n\nLands with: " + SLICE_ENTRY))
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 1, "a batch naming its own entry passed: " + _shape(reported)
    _assert_corpus_restored()


def test_a_blocked_entry_naming_itself_is_blocked_by_nothing() -> None:
    """Its own token resolves against the page, so the arm reading the column finds an entry and passes."""
    reported = _roadmap_findings(
        lambda: _replace(ROADMAP, BLOCKED_FIELDS, BLOCKED_FIELDS.replace("| Open | — |", "| Blocked | " + _tick(BLOCKED_ENTRY) + " |"))
    )
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 1, "an entry blocked on itself passed: " + _shape(reported)
    _assert_corpus_restored()


def test_an_entry_naming_itself_in_its_dependency_column_is_reported_whatever_its_status() -> None:
    """Inside the `Blocked` fork the test read no `Open` entry, whose self-reference never clears either."""

    def itself() -> None:
        _replace(ROADMAP, VOCAB_FIELDS, VOCAB_FIELDS.replace("| — |", "| " + _tick(VOCAB_ENTRY) + " |"))

    reported = _roadmap_findings(itself)
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 1, "an open entry depending on itself passed: " + _shape(reported)
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
    live = head[:SHORT_FORM]
    # What the fixture builder mints, never what one commit's own hash carries: a run of digits
    # alone is not the shape `sha` fails, so the case would prove nothing about the check.
    assert any(c.isdigit() for c in live) and any(c.isalpha() for c in live), "the fixture no longer mints a mixed short form: " + live
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


# --- the spans and cells a renderer reads differently from a pipe or a tick counted one by one -----


def test_an_escaped_pipe_parts_no_cell_of_an_invariant_row() -> None:
    """GFM parts a row at an unescaped pipe alone, a code span's included, so counting every pipe fails a row the page draws in three cells."""
    _reset()
    _replace(BACKEND_SPEC, INVARIANT_ROW, "| I1 | The write path validates `a \\| b` as one input | The sample module's own suite |")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert not _about("invariant-row", reported), _shape(reported)
    _assert_corpus_restored()


def test_a_cell_an_escaped_pipe_sits_in_is_measured_whole() -> None:
    """Parted at that pipe, a paragraph reads as two cells under OUT-4's bound, and the one cell the page draws passes unmeasured."""
    _reset()
    cell = PARAGRAPH_CELL.replace("anything,", "anything, `a \\| b`", 1)
    _replace(BACKEND_SPEC, INVARIANT_ROW, "| I1 | " + cell + " | The sample module's own suite |")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "cell-prose", BACKEND_SPEC)] == 1, _shape(reported)
    _assert_corpus_restored()


def test_a_span_two_backticks_open_closes_on_two_and_what_follows_it_is_read() -> None:
    """CommonMark closes a span on a run of its opener's length.

    Pairing single ticks inverts the rest of the line, and a dead path after the span reads as prose.
    """
    _reset()
    _append(NOTES, "A span holding a tick, ``a`b``, and after it `docs/gone-past-a-double-span.md`.")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "path", NOTES)] == 1, _shape(reported)
    _assert_corpus_restored()


def test_a_span_opening_straight_after_an_escaped_tick_is_read() -> None:
    """CommonMark consumes the escaped tick as text, and the run after it opens a span as any other would."""
    _reset()
    _append(NOTES, "An escaped tick \\``docs/gone-after-an-escaped-tick.md` and the span after it.")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "path", NOTES)] == 1, _shape(reported)
    _assert_corpus_restored()


def test_a_path_between_two_escaped_ticks_is_read_as_the_bare_path_it_renders_as() -> None:
    """An escaped tick is text, so no span holds the path, and in a comment the bare-path reader is the one left to read it."""
    _reset()
    _append(SAMPLE, HASH + " Between escaped ticks \\`docs/gone-between-escaped-ticks.md\\` stands a path.")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "bare-path", SAMPLE)] == 1, _shape(reported)
    assert reported[("fail", "path", SAMPLE)] == 0, _shape(reported)
    _assert_corpus_restored()


def test_an_escaped_tick_opens_no_span_even_where_a_tick_closes_one_later() -> None:
    """Read as an opener, the escaped tick would pair with the plain one and hide the path in a span the page never draws."""
    _reset()
    _append(SAMPLE, HASH + " An escaped opener \\`docs/gone-behind-an-escaped-opener.md` with a plain tick after it.")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "path", SAMPLE)] == 0, _shape(reported)
    assert reported[("fail", "bare-path", SAMPLE)] == 1, _shape(reported)
    _assert_corpus_restored()


def test_a_check_name_is_read_off_the_spans_the_field_draws() -> None:
    """An unclosed double run leaves its ticks as text, and pairing one tick at a time names a check nobody wrote and hides the one written."""
    _reset()
    _replace(STANDARD, "_Enforced by_ `glossary-entry`.", "_Enforced by_ `glossary-entry` and ``x`no-such-check`.")
    try:
        _, output = _output()
    finally:
        _reset()
    assert "gate check `no-such-check`, which this gate does not emit" in output, output
    assert "gate check `x`," not in output, output
    _assert_corpus_restored()


def test_a_prose_sha_is_read_off_the_spans_the_page_draws() -> None:
    """Paired one tick at a time, an unclosed double run swallows the opening tick of the span after it."""
    _reset()
    _append(NOTES, "Named ``abcdefa`abc1234` in passing.")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "sha", NOTES)] == 1, _shape(reported)
    _assert_corpus_restored()


def test_a_quote_opening_before_a_code_span_closes_past_it() -> None:
    """CommonMark binds the span first, so the quote around it closes on the quote after it and the phrase is a mention.

    The unquoted line is the second run, so a reader blanking the page fails it.
    """
    _reset()
    try:
        _append(NOTES, 'Quoted whole, "a `b"c` the owner d" names nobody.')
        _, quoted = _run()
        _reset()
        _append(NOTES, "Unquoted, the owner is named.")
        _, said = _run()
    finally:
        _reset()
    assert quoted[("fail", "owner-voice", NOTES)] == 0, "a quote was closed inside a code span: " + _shape(quoted)
    assert said[("fail", "owner-voice", NOTES)] == 1, "the page was read by nothing: " + _shape(said)
    _assert_corpus_restored()


def test_a_path_a_double_run_wraps_is_reported() -> None:
    """A renderer joins the wrap and pairs the two double runs across it, so the span renders with a space inside the path."""
    _reset()
    _append(NOTES, "A path a double run wraps: ``docs/gloss", "ary.md`` renders with a space.")
    try:
        _, output = _output()
    finally:
        _reset()
    assert output.count("wraps inside the path, which a code span renders with a space in it") == 1, output
    _assert_corpus_restored()


def test_a_span_s_offsets_index_the_line_it_sits_on_an_image_s_alt_text_included() -> None:
    """The parser reads an image's alt text as a source of its own, so an offset counted there lands elsewhere on the line."""
    kernel = _module("docs_gate.kernel")
    line = "A [link `in` text](u), an ![alt `z`](i.png) and ``a`b`` last."
    spans = kernel.located_code_spans(line)
    assert [span.code for span in spans] == ["in", "z", "a`b"], spans
    for span in spans:
        assert line[span.code_start : span.code_end] == span.code, span
        assert line[span.start] == line[span.end - 1] == "`", span


def test_a_span_an_unclosed_label_scan_passes_is_text() -> None:
    """markdown-it-py's parse, not CommonMark's, which reads code here.

    A release pairing it fails this, and the comment at `_line_spans` goes with it. Each control
    moves one part of the trigger, so the pin holds that shape and no wider one.
    """
    kernel = _module("docs_gate.kernel")

    def codes(line: str) -> list[str]:
        return [span.code for span in kernel.located_code_spans(line)]

    assert codes("[`a :: b` `` x") == [], "the label scan's cache no longer leaves the span as text"
    assert codes("`a :: b` `` x") == ["a :: b"], "no bracket, no scan"
    assert codes("[`a :: b`] `` x") == ["a :: b"], "the label closes before the unclosed run"
    assert codes("[`a :: b` `` x `c`") == ["a :: b", "c"], "a later run of the span's length"


def test_a_missing_markdown_parser_exits_as_a_broken_environment() -> None:
    """The parser is imported before `run` can classify a failure, so unguarded its absence exits 1 and reads as findings."""
    entry = REPO_ROOT / "scripts" / "checks" / "check_docs.py"
    # As a script is run: its own folder first on the path, which is where the package sits.
    blocked = (
        "import os, runpy, sys; sys.modules['markdown_it'] = None; sys.path.insert(0, os.path.dirname(sys.argv[1]));"
        " runpy.run_path(sys.argv[1], run_name='__main__')"
    )
    done = subprocess.run([sys.executable, "-c", blocked, str(entry)], capture_output=True, text=True, encoding="utf-8", check=False)
    assert done.returncode == 3, (done.returncode, done.stdout, done.stderr)
    assert "cannot import markdown_it" in done.stderr, done.stderr


# A module the comment reader lexes: a regex literal's quotes and slashes are not a string or a comment.
LEXED_MODULE: Final = "fl_frontend/src/lexed.ts"


def test_a_comment_below_a_regex_literal_holding_a_tick_is_read() -> None:
    """Read as a template's opener, the tick hides every comment below it, and the gate passes whatever they say."""
    _reset()
    write(_gate().root, LEXED_MODULE, _page("export const TICKED = /`/;", "// The owner reads this comment.", "export const AFTER = 1;"))
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "owner-voice", LEXED_MODULE)] == 1, _shape(reported)
    _assert_corpus_restored()


def test_code_after_a_regex_literal_ending_in_an_escaped_slash_is_not_read_as_a_comment() -> None:
    """The regex's escaped slash and its closing one read as a line comment's opener, and the code after them as prose."""
    _reset()
    write(_gate().root, LEXED_MODULE, _page("export const SLASHED = /a\\//; export const CODE = `COR-99`;"))
    try:
        _, reported = _run()
    finally:
        _reset()
    assert not [key for key in reported if key[2] == LEXED_MODULE], _shape(reported)
    _assert_corpus_restored()
