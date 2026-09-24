"""SCRIPTS · the pages a check derives its vocabulary from, and the files the corpus holds

`scripts/tests/test_check_docs.py` holds the fixture repository, the corpus it commits, the
plants and the `CASES` table. What stands here is each page a check reads a vocabulary, a register
or a lead-in from -- taken out of the index, refused by its reader, or read outside the part that
defines it -- and each file whose place in the corpus a check turns on: unstaged, ignored, or
declared binary by `.gitattributes`.

It is a file of its own because the gate's pytest step hands a module whole to one worker
(`scripts/tests/test_check_docs_cases.py`).

A planted violation never shares a line of THIS file with a hash or a triple quote, for
`scripts/tests/test_check_docs.py`'s reason.
"""

from __future__ import annotations

from collections import Counter

from conftest import git, write
from test_check_docs import (
    ADDED_STATUS_RULE,
    APP_GLOBALS,
    BLOCKED_FIELDS,
    DOCS_ENTRY,
    ERROR_CODES,
    FRONTEND_ROW,
    GITATTRIBUTES,
    GLOSSARY,
    HASH,
    HELPER_LEAD_IN,
    IGNORED_MODULE,
    NEWLINE,
    NOTES,
    OPS_SPEC,
    ORPHAN_ENTRY,
    OTHERWISE_RULE,
    OUTPUT_LEAD_IN,
    PROTOCOL,
    QUOTES,
    ROADMAP,
    SKIPPED_MODULE,
    SLICE_ENTRY,
    STANDARD,
    STATUS_COLUMN_ROW,
    UNDECODABLE,
    UNDECODABLE_BYTES,
    UNSTAGED_BLOCK,
    UNSTAGED_MODULE,
    VOCAB_FIELDS,
    _append,
    _assert_corpus_restored,
    _gate,
    _heading,
    _module,
    _module_named,
    _output,
    _page,
    _read,
    _replace,
    _reset,
    _run,
    _shape,
    _tick,
    _write_bytes,
    _write_raw,
)


def test_a_season_nothing_imports_leaves_the_token_list_unanchored() -> None:
    """The import arm cannot share the scheme case's plant: with no season there is no token list.

    Driven directly for that reason, and the count is what parts the one finding from the parity
    arms falling silent beside it.
    """
    _reset()
    _replace(APP_GLOBALS, '@import "./schemes/2025-26.css";', '@import "./schemes/1999-00.css";')
    try:
        code, reported = _run()
    finally:
        _reset()
    assert reported == Counter({("fail", "scheme-token", APP_GLOBALS): 1}), "an unimported season: " + _shape(reported)
    assert code == 1
    _assert_corpus_restored()


def test_a_check_naming_one_page_reads_the_tracked_one() -> None:
    """A check that names a fixed page resolves it through the corpus, not off disk.

    Driven directly: this input silences the glossary's other producers by returning first, and a
    `Case` declares every finding.
    """
    _reset()
    git(_gate().root, "rm", "--cached", "-q", "--", GLOSSARY)
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "glossary-entry", GLOSSARY)] == 1, "an untracked glossary was read as the corpus': " + _shape(reported)
    _assert_corpus_restored()


def test_a_rule_family_the_patterns_never_spelled_is_read_off_the_standard() -> None:
    """Read off the list lines, a rule under a new prefix is held to PRE-4 and its citations resolve.

    Two citations, one finding: the planted rule resolves, and the neighbour nobody wrote fails
    rather than falling outside every pattern.
    """
    _reset()
    _append(STANDARD, "- **DOC-7:** a rule under a family the patterns never spelled. _Enforced by_ review judgment.")
    _append(NOTES, "A claim citing DOC-7, and one citing DOC-8.")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "rule-id", NOTES)] == 1, "a family the standard states was read by no pattern: " + _shape(reported)
    _assert_corpus_restored()


def test_the_standard_leaving_the_index_empties_its_readers_rather_than_raising() -> None:
    """A page out of the index reaches its readers as None, and one that hands it on raises.

    `enforced-by` and `rule-shape` each guard for it. Without either guard the run ends on a
    traceback at `EXIT_CRASH`, rather than on every citation of a rule failing.
    """
    _reset()
    git(_gate().root, "rm", "--cached", "-q", "--", STANDARD)
    try:
        code, reported = _run()
    finally:
        _reset()
    # Counted by name rather than by number: what is pinned is which checks spoke, the citation
    # count being the corpus' own and free to move.
    assert set(reported) == {("fail", "rule-id", STANDARD)}, _shape(reported)
    assert code == 1
    _assert_corpus_restored()


def test_an_untracked_roadmap_is_read_as_a_page_nobody_added() -> None:
    """The roadmap on disk and outside the index fails, rather than passing unexamined.

    Driven directly: a page out of the index yields no shape finding to share a case with, and
    satisfies `inputs`, which asks the disk.
    """
    _reset()
    git(_gate().root, "rm", "--cached", "-q", "--", ROADMAP)
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 1, "an untracked roadmap passed: " + _shape(reported)
    _assert_corpus_restored()


def test_a_status_table_that_yields_no_vocabulary_is_reported_rather_than_passed_over() -> None:
    """An empty vocabulary silences the arm reading it, so the silence is a finding of its own.

    Driven alone: the case sharing this check name puts two statuses outside the vocabulary, so it
    would prove this arm switched off.
    """
    _reset()
    _replace(PROTOCOL, STATUS_COLUMN_ROW, STATUS_COLUMN_ROW.replace("Status", "Verdict"))
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "roadmap-shape", PROTOCOL)] == 1, "a moved status table passed: " + _shape(reported)
    _assert_corpus_restored()


def test_an_untracked_protocol_page_is_reported_rather_than_emptying_the_vocabulary() -> None:
    """The page on disk and outside the index yields no vocabulary, which switched the status arm off in silence.

    `inputs` asks the disk, so only the reader itself can say the index does not hold the page.
    """
    _reset()
    git(_gate().root, "rm", "--cached", "-q", "--", PROTOCOL)
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "roadmap-shape", PROTOCOL)] == 1, "an untracked protocol page passed: " + _shape(reported)
    _assert_corpus_restored()


def test_a_protocol_page_that_cannot_be_decoded_is_reported_rather_than_emptying_the_vocabulary() -> None:
    """A page the reader refuses yields no table, the shape of a page deriving nothing.

    Read from the words: the empty-table arm reports about this file under this name too, so a
    count cannot say which spoke.
    """
    _reset()
    _write_raw(PROTOCOL, UNDECODABLE_BYTES)
    try:
        _, output = _output()
    finally:
        _reset()
    assert "untracked or unreadable, so the status vocabulary was derived from nothing" in output, output
    _assert_corpus_restored()


def test_a_status_table_outside_section_four_widens_no_vocabulary() -> None:
    """A second `Status`-headed table on the page is not the derivation, and a reader re-arming on any header would take it.

    Its word is planted as an entry's status, so a reader taking it reports nothing.
    """
    _reset()
    _append(
        PROTOCOL,
        "",
        _heading(2, "5. A table that derives nothing"),
        "",
        STATUS_COLUMN_ROW,
        "| --- | --- | --- |",
        "| 1 | A row a reader scoped to section four never reads | **Parked** |",
    )
    _replace(ROADMAP, VOCAB_FIELDS, VOCAB_FIELDS.replace("| Open |", "| Parked |"))
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 1, "a table outside section four widened the vocabulary: " + _shape(reported)
    _assert_corpus_restored()


def test_a_rule_added_to_the_status_table_widens_the_vocabulary() -> None:
    """A vocabulary retyped in the checker would pass both refusal cases and fail this one alone.

    The word is the one those cases put outside the set, so the three differ in the planted row
    alone.
    """
    _reset()
    _replace(PROTOCOL, OTHERWISE_RULE, ADDED_STATUS_RULE + "\n" + OTHERWISE_RULE.replace("| 4 |", "| 5 |"))
    _replace(ROADMAP, VOCAB_FIELDS, VOCAB_FIELDS.replace("| Open |", "| Parked |"))
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 0, "a status the table derives was refused: " + _shape(reported)
    _assert_corpus_restored()


def test_a_blocked_entry_naming_two_dependencies_is_read_token_by_token() -> None:
    """A `Depends on` cell naming two entries is read token by token, each held to the page.

    Read as one token it names no entry, and a true claim about two other entries draws a finding.
    """
    _reset()
    both = BLOCKED_FIELDS.replace("| Open | — |", "| Blocked | " + _tick(DOCS_ENTRY) + ", " + _tick(SLICE_ENTRY) + " |")
    _replace(ROADMAP, BLOCKED_FIELDS, both)
    try:
        _, reported = _run()
        _replace(ROADMAP, both, both.replace(_tick(DOCS_ENTRY), _tick(ORPHAN_ENTRY)))
        _, departed = _run()
    finally:
        _reset()
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 0, "two filed dependencies were refused: " + _shape(reported)
    # One: the departed token, and never the `Blocked` arm as well while the other still blocks.
    assert departed[("fail", "roadmap-shape", ROADMAP)] == 1, "a departed dependency beside a filed one passed: " + _shape(departed)
    _assert_corpus_restored()


def test_a_reworded_lead_in_leaves_the_verb_reader_with_nothing_to_arm_on() -> None:
    """Driven alone rather than from this check's own case.

    This arm returns before that case's plant is reached, so a shared run would count one finding
    for two plants and leave whichever spoke second unproven.
    """
    for lead_in, reworded in ((OUTPUT_LEAD_IN, "The verbs."), (HELPER_LEAD_IN, "The helpers.")):
        _reset()
        _replace(OPS_SPEC, lead_in, lead_in.replace(lead_in.split("**")[1], reworded))
        try:
            _, reported = _run()
        finally:
            _reset()
        assert reported[("fail", "output-verbs", OPS_SPEC)] == 1, "a moved lead-in passed: " + _shape(reported)
    _assert_corpus_restored()


def test_a_third_lead_in_constant_is_one_this_check_resolves() -> None:
    """A lead-in spelled in a constant the check walks past is a table nothing keeps a verdict on.

    Set on the module rather than in the corpus: the pairing under test is between the constants and
    the loop beside them.
    """
    names = vars(_module("docs_gate.checks"))
    _reset()
    names["THIRD_LEAD_IN"] = r"^\*\*A third table\."
    try:
        _, reported = _run()
    finally:
        del names["THIRD_LEAD_IN"]
        _reset()
    assert reported[("fail", "output-verbs", OPS_SPEC)] == 1, "a lead-in no arm resolved passed: " + _shape(reported)
    _assert_corpus_restored()


def test_a_row_under_an_area_no_pattern_spelled_is_held_to_the_trees() -> None:
    """A code's shape is what selects it, so a fifth area's row is owed a spelling like the four's.

    A closed alternation drops the row from both populations at once, and the check stays green.
    """
    _reset()
    _replace(ERROR_CODES, FRONTEND_ROW, FRONTEND_ROW + "\n| `OPS-SAMPLE-001` | A row under an area no pattern spelled |")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "error-codes", ERROR_CODES)] == 1, "a row under a fifth area was read by nothing: " + _shape(reported)
    _assert_corpus_restored()


def test_an_untracked_register_page_is_the_check_s_own_finding() -> None:
    """The page on disk and outside the index satisfies `inputs` and yields no row, so the comparison ran over nothing."""
    _reset()
    git(_gate().root, "rm", "--cached", "-q", "--", ERROR_CODES)
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "error-codes", ERROR_CODES)] == 1, "an untracked register passed: " + _shape(reported)
    _assert_corpus_restored()


def test_a_register_page_that_cannot_be_decoded_is_the_check_s_own_finding() -> None:
    """A page the reader refuses yields no row, so the register is compared against nothing.

    Read from the words: with this finding gone the run names the codes each tree raises and never
    the page it could not read.
    """
    _reset()
    _write_raw(ERROR_CODES, UNDECODABLE_BYTES)
    try:
        _, output = _output()
    finally:
        _reset()
    assert "unreadable, so the register was held to nothing" in output, output
    _assert_corpus_restored()


def test_only_a_gitattributes_declaration_exempts_a_file_from_the_byte_check() -> None:
    """The corpus binary is passed over because `.gitattributes` says so, not because of its bytes.

    Only withdrawing the declaration can prove that: a suffix list answers the same either way.
    """
    _reset()
    root = _gate().root
    declaration = "*.bin binary"
    assert declaration in _read(GITATTRIBUTES), "the corpus no longer declares its binary"
    _write_bytes(root, GITATTRIBUTES, _read(GITATTRIBUTES).replace(declaration + NEWLINE, ""))
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "binary-byte", UNDECODABLE)] == 1, "an undeclared binary was passed over anyway: " + _shape(reported)
    _assert_corpus_restored()


def test_a_file_the_branch_has_not_staged_is_read_like_a_tracked_one() -> None:
    """The corpus is the working tree, so a file written and not yet added is inside every check.

    Iterating runs the gate over work not yet added, so an index-only read would pass clean over a
    branch's unstaged files.
    """
    _reset()
    write(_gate().root, UNSTAGED_MODULE, _module_named("a module this branch wrote and never staged."))
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "bare-path", UNSTAGED_MODULE)] == 1, "an unstaged module was scanned by nothing: " + _shape(reported)
    _assert_corpus_restored()


def test_an_ignored_or_skipped_file_stays_outside_the_corpus() -> None:
    """Widening the corpus to the working tree stops at what git ignores and at SKIP_DIRS.

    Both carry the case above's plant, so only placement can be what silences them.
    """
    _reset()
    root = _gate().root
    for rel in (IGNORED_MODULE, SKIPPED_MODULE):
        write(root, rel, _module_named("a module no check may reach."))
    try:
        _, reported = _run()
    finally:
        for rel in (IGNORED_MODULE, SKIPPED_MODULE):
            (root / rel).unlink()
        _reset()
    parked = {rel: count for (_, _, rel), count in reported.items() if rel in (IGNORED_MODULE, SKIPPED_MODULE)}
    assert not parked, "a file the corpus must not reach was scanned anyway: " + repr(parked)
    _assert_corpus_restored()


def test_an_unstaged_file_s_lines_are_read_as_lines_this_branch_added() -> None:
    """INC-9 and the added-line checks read a whole unstaged file, git holding no diff for one.

    git has no version of a file the index never reached, so the block below sits in no hunk.
    """
    _reset()
    over = [HASH + " a line of a block that runs past what a comment may hold" for _ in range(6)]
    write(_gate().root, UNSTAGED_BLOCK, _page(QUOTES + "BACKEND · an unstaged module." + QUOTES, "", "VALUE = 1", "", *over))
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "comment-length", UNSTAGED_BLOCK)] == 1, "an unstaged block was measured by nothing: " + _shape(reported)
    _assert_corpus_restored()
