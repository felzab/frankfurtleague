"""SCRIPTS · every citation form driven to each verdict the resolver can give it

`scripts/tests/test_check_docs.py` holds the fixture repository, the corpus it commits, the
plants and the `CASES` table. What stands here is a citation in each spelling the resolver admits
or refuses, an anchor a page carries or only appears to, a span a wrap parts, a case name one
module declares twice, and a citation a file makes about itself.

It is a file of its own because the gate's pytest step hands a module whole to one worker
(`scripts/tests/test_check_docs_cases.py`).

A planted violation never shares a line of THIS file with a hash or a triple quote, for
`scripts/tests/test_check_docs.py`'s reason.
"""

from __future__ import annotations

from collections import Counter
from typing import Final

import pytest
from conftest import write
from test_check_docs import (
    ABSENT_ANCHOR,
    BACKEND_RAISE,
    BACKEND_SPEC,
    BACKEND_TEST,
    CASE_MODULE,
    CITED_CASE,
    CITED_HEADING,
    CITED_PYTHON_CASE,
    COMPOSE_FILE,
    DEAD_ROOT_FOLDER_PATH,
    DOMAIN_REGISTER,
    ESCAPED_CASE,
    ESCAPED_SOURCE,
    FENCED_ANCHOR,
    FORK_ONLY_RULE,
    FRONTEND_SPEC,
    GLOSSARY,
    GLOSSARY_ANCHOR,
    GLOSSARY_HEADING,
    HASH,
    IGNORED_MODULE,
    IGNORED_PAGE,
    KERNEL,
    MARKER_TSX,
    NOTES,
    OTHER_SPELLING,
    QUOTE,
    QUOTED_ERROR,
    RENAMED_HEADING,
    RETIRED_ID,
    ROOT_FOLDER_FILE,
    SAMPLE,
    SCRIPTS_COPY,
    SECOND_CASE,
    SECOND_PYTHON_CASE,
    SELF_CLAIMED_CHECK,
    SHAPE_CLASSIFIER,
    SHARED_BASENAME,
    SPIELER_PANEL,
    STANDARD,
    TWIN_NOTES,
    UNCITED_CASE,
    UNCITED_PYTHON_CASE,
    UNENFORCED_SUBJECT,
    UNSTAGED_MODULE,
    UNTRACKED_TWIN,
    _append,
    _as_literal,
    _assert_corpus_restored,
    _clear_caches,
    _drop,
    _gate,
    _heading,
    _module,
    _module_named,
    _output,
    _page,
    _plant_enforced_by,
    _plant_wrapped_paths,
    _read,
    _replace,
    _reported,
    _reset,
    _run,
    _shape,
    _tick,
    _undo_enforced_by,
)

# A suite whose comment is the only place an old case name survives, parted across two lines.
WRAPPED_CASE_MODULE: Final = "fl_frontend/src/wrapped.test.ts"


def test_a_bare_name_reaches_an_unstaged_file_and_the_index_still_answers_first() -> None:
    """A bare-name citation resolves through the index, and through the tree only where it cannot.

    Two citations separate a file not reached from an anchor not there, and the twin proves the
    order: reading the tree first lands on the copy.
    """
    _reset()
    root = _gate().root
    twin = (root / UNTRACKED_TWIN).read_bytes()
    write(root, UNTRACKED_TWIN, _read(GLOSSARY).replace(GLOSSARY_HEADING, "a heading the corpus does not cite"))
    write(root, UNSTAGED_MODULE, _module_named("a module cited by name before it was staged."))
    _append(SAMPLE, HASH + " see `unstaged.py :: VALUE = 1`", HASH + " and `unstaged.py :: a symbol nobody wrote`")
    try:
        _, reported = _run()
    finally:
        (root / UNTRACKED_TWIN).write_bytes(twin)
        _reset()
    assert reported[("fail", "citation", SAMPLE)] == 1, "a bare name did not reach the unstaged file it names: " + _shape(reported)
    assert reported[("fail", "citation", NOTES)] == 0, "an untracked copy answered a bare name the index holds: " + _shape(reported)
    _assert_corpus_restored()


def test_a_citation_a_file_makes_about_itself_is_proved_by_some_other_line_or_by_nothing() -> None:
    """The citing line spells the anchor, so presence in the whole text certifies the citation against itself.

    The second run is the evidence the arm reads the OTHER lines: the same shape with the anchor
    spelled above stays silent.
    """
    _reset()
    spelled = "an anchor the line above the citation spells"
    try:
        _append(SAMPLE, HASH + " see `" + SAMPLE + " :: an anchor no other line spells`")
        _, alone = _run()
        _reset()
        _append(SAMPLE, HASH + " " + spelled, HASH + " see `" + SAMPLE + " :: " + spelled + "`")
        _, elsewhere = _run()
    finally:
        _reset()
    assert alone[("fail", "citation", SAMPLE)] == 1, "an anchor spelled only on its own citing line passed: " + _shape(alone)
    assert elsewhere[("fail", "citation", SAMPLE)] == 0, "an anchor the file spells elsewhere was failed: " + _shape(elsewhere)
    _assert_corpus_restored()


def test_a_continuation_a_file_makes_about_itself_is_read_as_a_self_citation() -> None:
    """A continuation is joined from an antecedent, so its joined form sits on no line of the file.

    The second run is the evidence the arm reads the OTHER lines, as the whole citation's case is.
    """
    _reset()
    spelled = "a continued anchor the line above spells"
    try:
        _append(SAMPLE, HASH + " see `" + SAMPLE + "` and `:: a continued anchor no other line spells`")
        _, alone = _run()
        _reset()
        _append(SAMPLE, HASH + " " + spelled, HASH + " see `" + SAMPLE + "` and `:: " + spelled + "`")
        _, elsewhere = _run()
    finally:
        _reset()
    assert alone[("fail", "citation", SAMPLE)] == 1, "a continuation resolving only against its own line passed: " + _shape(alone)
    assert elsewhere[("fail", "citation", SAMPLE)] == 0, "a continued anchor the file spells elsewhere was failed: " + _shape(elsewhere)
    _assert_corpus_restored()


def test_a_self_citation_a_wrap_parts_is_read_as_one_citation_over_both_its_lines() -> None:
    """Wrapped at the separator, so the joined citation sits on neither line whole.

    The anchor is on the SECOND line, which the citing line has to reach or the arm reports the
    same pass a whole-line citation would fail.
    """
    _reset()
    spelled = "a wrapped anchor the line above spells"
    try:
        _append(SAMPLE, HASH + " see `" + SAMPLE + " ::", HASH + " a wrapped anchor no other line spells`")
        _, alone = _run()
        _reset()
        _append(SAMPLE, HASH + " " + spelled, HASH + " see `" + SAMPLE + " ::", HASH + " " + spelled + "`")
        _, elsewhere = _run()
    finally:
        _reset()
    assert alone[("fail", "citation", SAMPLE)] == 1, "a wrapped self-citation proved by its own tail passed: " + _shape(alone)
    assert elsewhere[("fail", "citation", SAMPLE)] == 0, "a wrapped anchor the file spells elsewhere was failed: " + _shape(elsewhere)
    _assert_corpus_restored()


def test_a_self_citation_is_proved_by_the_file_s_own_text_and_never_by_a_second_citation() -> None:
    """Modules here name their symbols alike, so one file's citation of an anchor would certify another's.

    The second run is the evidence the arm still reads the other lines: a comment spelling the
    anchor keeps it silent.
    """
    _reset()
    spelled = "an anchor a comment of this module spells"
    try:
        _append(
            SAMPLE,
            HASH + " The entry `" + GLOSSARY + " :: " + GLOSSARY_ANCHOR + "` is written beside this module.",
            HASH + " A second `" + SAMPLE + " :: " + GLOSSARY_ANCHOR + "` has that citation for its only proof.",
        )
        _, cited = _run()
        _reset()
        _append(SAMPLE, HASH + " " + spelled, HASH + " See `" + SAMPLE + " :: " + spelled + "`.")
        _, seen = _run()
    finally:
        _reset()
    assert cited[("fail", "citation", SAMPLE)] == 1, "an anchor only another citation spells passed: " + _shape(cited)
    assert seen[("fail", "citation", SAMPLE)] == 0, "an anchor the module's own comment spells was failed: " + _shape(seen)
    _assert_corpus_restored()


def test_the_tail_line_of_a_wrapped_citation_proves_no_self_citation_of_its_anchor() -> None:
    """A wrap parts the other file's citation, so its tail carries the anchor and no whole span.

    The second run is the evidence the arm reads other lines: the same pair with the anchor
    spelled outside both citations passes.
    """
    _reset()
    wrapped = (HASH + " The entry `" + GLOSSARY + " ::", HASH + " " + GLOSSARY_ANCHOR + "` is written beside this module.")
    second = HASH + " A second `" + SAMPLE + " :: " + GLOSSARY_ANCHOR + "` has that tail line for its only proof."
    try:
        _append(SAMPLE, *wrapped, "", second)
        _, tailed = _run()
        _reset()
        _append(SAMPLE, *wrapped, "", HASH + " The module itself spells " + GLOSSARY_ANCHOR + ".", "", second)
        _, spelled = _run()
    finally:
        _reset()
    assert tailed[("fail", "citation", SAMPLE)] == 1, "an anchor only a wrapped citation's tail spells passed: " + _shape(tailed)
    assert spelled[("fail", "citation", SAMPLE)] == 0, "an anchor the module's own sentence spells was failed: " + _shape(spelled)
    _assert_corpus_restored()


def test_a_cited_case_name_two_suites_of_one_module_declare_is_reported() -> None:
    """Two describe blocks naming one case is what the runner permits and a citation cannot part.

    The second run renames onto a name no document cites: what fires is the citation, never the
    repetition.
    """
    _reset()
    try:
        _replace(CASE_MODULE, _as_literal(SECOND_CASE), _as_literal(CITED_CASE))
        _, cited = _run()
        _reset()
        _replace(CASE_MODULE, _as_literal(SECOND_CASE), _as_literal(UNCITED_CASE))
        _, uncited = _run()
    finally:
        _reset()
    assert cited[("fail", "citation", NOTES)] == 1, "a cited case name two suites declare passed: " + _shape(cited)
    assert not uncited, "a repeated case name no document cites was reported: " + _shape(uncited)
    _assert_corpus_restored()


def test_a_cited_case_name_two_classes_of_one_python_module_declare_is_reported() -> None:
    """Python holds one method name on two classes without minding, and the definition listing loses the count.

    The second run collides onto an uncited name, as the frontend tier's case does.
    """
    _reset()
    try:
        _replace(BACKEND_TEST, "def " + SECOND_PYTHON_CASE, "def " + CITED_PYTHON_CASE)
        _, cited = _run()
        _reset()
        _replace(BACKEND_TEST, "def " + SECOND_PYTHON_CASE, "def " + UNCITED_PYTHON_CASE)
        _, uncited = _run()
    finally:
        _reset()
    assert cited[("fail", "citation", NOTES)] == 1, "a cited case name two classes declare passed: " + _shape(cited)
    assert not uncited, "a repeated python case name no document cites was reported: " + _shape(uncited)
    _assert_corpus_restored()


def test_a_citation_of_a_case_name_the_source_escapes_is_refused_before_any_count() -> None:
    """The count reads the literal's own body, so an escaped name and its anchor are different strings.

    Free while presence refuses the citation first; the day presence resolves an escape, the count
    must resolve it in that change.
    """
    _reset()
    try:
        # Twice, so the count is what the arm would report on if the two spellings ever met.
        _replace(CASE_MODULE, _as_literal(UNCITED_CASE), ESCAPED_SOURCE)
        _replace(CASE_MODULE, _as_literal(SECOND_CASE), ESCAPED_SOURCE)
        _append(NOTES, "A citation of " + _tick(CASE_MODULE + " :: " + ESCAPED_CASE) + ".")
        code, output = _output()
    finally:
        _reset()
    assert code == 1, output
    assert "no longer appears" in output, output
    assert "test cases in" not in output, output
    _assert_corpus_restored()


# Each dead address a reason can argue from, one per shape the gate reads, beside a live read rule.
DEAD_REASON: Final = (
    "`REQ-GONE-001`, `REQ-GONE-*`, `READ-SAMPLE-002`, `app/gone.py`, `app/sample.py :: GONE`, "
    "`app/core/domain.py :: RULES` and `I999`, where `READ-SAMPLE-001` stands."
)
READ_RULE_TABLE: Final = "It answers with one document.\n\n| Rule | Withholds |\n| --- | --- |\n| `READ-SAMPLE-001` | A name |"


def _declare_unenforced(*entries: str) -> None:
    """Entries after the fixture's own, each a `reason=` expression as the source spells it."""
    rows = "".join(
        f'    Unenforced(\n        subject="a planted state {n}",\n        reason={reason},\n    ),\n' for n, reason in enumerate(entries)
    )
    _replace(DOMAIN_REGISTER, "    ),\n)\n", "    ),\n" + rows + ")\n")


def test_every_address_a_reason_argues_from_is_resolved_and_a_dead_one_named_by_its_check() -> None:
    """One finding per dead address and one for a reason no literal spells; the live read rule and the fixture's own entry raise none."""
    _reset()
    _replace(BACKEND_SPEC, "It answers with one document.", READ_RULE_TABLE)
    _declare_unenforced('"' + DEAD_REASON + '"', "REASON_HELD_ELSEWHERE")
    try:
        _, output = _output()
        reported = _reported(output)
    finally:
        _reset()
    about = {check: reported[("fail", check, DOMAIN_REGISTER)] for check in ("citation", "path", "invariant-id")}
    assert about == {"citation": 6, "path": 1, "invariant-id": 1}, _shape(reported)
    assert "READ-SAMPLE-001" not in output, output
    assert UNENFORCED_SUBJECT not in output, output
    _assert_corpus_restored()


def test_a_register_declaring_no_unenforced_state_is_named_rather_than_read_as_clean() -> None:
    """A reader that found no tuple would otherwise pass every reason it never read."""
    _reset()
    _replace(DOMAIN_REGISTER, "UNENFORCED: tuple[Unenforced, ...] = (", "STATES = (")
    try:
        _, output = _output()
        reported = _reported(output)
    finally:
        _reset()
    assert reported[("fail", "citation", DOMAIN_REGISTER)] == 1, _shape(reported)
    assert "yielded no `UNENFORCED` reason" in output, output
    _assert_corpus_restored()


def test_a_tree_raising_no_rule_code_is_named_rather_than_failing_every_code_a_reason_names() -> None:
    """The one module raising a code goes quiet, so the listing reason codes resolve against is empty."""
    _reset()
    _drop(SAMPLE, BACKEND_RAISE)
    try:
        _, output = _output()
        reported = _reported(output)
    finally:
        _reset()
    assert reported[("fail", "citation", DOMAIN_REGISTER)] == 1, _shape(reported)
    assert "so codes were read against nothing" in output, output
    _assert_corpus_restored()


def test_a_shape_the_backend_hands_over_and_the_gate_does_not_read_is_named_both_ways() -> None:
    """The invariant pattern narrowed in the backend's list: that list keeps the gate's, and hands over one the gate never reads."""
    _reset()
    _replace(SHAPE_CLASSIFIER, r"^[IL]\d{1,3}[a-z]?$", r"^[I]\d{1,3}[a-z]?$")
    try:
        _, output = _output()
        reported = _reported(output)
    finally:
        _reset()
    assert reported[("fail", "citation", SHAPE_CLASSIFIER)] == 2, _shape(reported)
    assert "a shape the gate does not read" in output and "a shape the gate reads too" in output, output
    _assert_corpus_restored()


@pytest.mark.parametrize(
    ("old", "new"),
    [
        pytest.param("re.compile(pattern)", "re.compile(pattern, re.IGNORECASE)", id="flag-by-position"),
        pytest.param("re.compile(pattern)", "re.compile(pattern, flags=re.IGNORECASE)", id="flag-by-keyword"),
        pytest.param("re.compile(pattern)", "re.compile(pattern.lower())", id="transformed-pattern"),
        pytest.param("\n))", "\n) if pattern)", id="filtered-patterns"),
    ],
)
def test_a_shape_the_backend_compiles_other_than_its_text_says_is_named(old: str, new: str) -> None:
    """Every pattern's text still the gate's, so only the form tells that the backend matches otherwise."""
    _reset()
    _replace(SHAPE_CLASSIFIER, old, new)
    try:
        _, output = _output()
        reported = _reported(output)
    finally:
        _reset()
    assert reported[("fail", "citation", SHAPE_CLASSIFIER)] == 1, _shape(reported)
    assert "no bare `re.compile(pattern)` over literal patterns" in output, output
    _assert_corpus_restored()


# A module whose code holds a tick in a string, on the line of a comment citing it.
TICKED_MODULE: Final = "fl_frontend/src/ticked.ts"
TICKED_ANCHOR: Final = "a phrase only citations spell"


def test_a_citation_beside_a_tick_in_code_proves_nothing_of_its_own_anchor() -> None:
    """Over the raw text the string's tick pairs with the comment's, and the continuation it parts proves the first.

    Two findings, each citation being spelled only by a citation; one means the continuation
    answered for its neighbour.
    """
    _reset()
    write(
        _gate().root,
        TICKED_MODULE,
        _page(
            "// See `" + TICKED_MODULE + " :: " + TICKED_ANCHOR + "`.",
            # A paragraph apart, so no tick above can pair the line's odd one away.
            "",
            'export const again = "`"; // and `:: ' + TICKED_ANCHOR + "`",
        ),
    )
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "citation", TICKED_MODULE)] == 2, _shape(reported)
    _assert_corpus_restored()


def test_a_name_cut_short_resolves_nowhere_while_the_whole_name_and_a_quoted_fragment_do() -> None:
    """Read as a substring, a name resolves inside any longer one, and a symbol renamed by a suffix certifies.

    `MARKED` catches a reader failing every name; the quoted run stays a fragment, matched as spelled.
    """
    _reset()
    cited = [MARKER_TSX + " :: " + anchor for anchor in ("MARK", "MARKED", QUOTE + "MARK" + QUOTE)]
    _append(NOTES, "The marker module's constant: " + ", ".join(_tick(citation) for citation in cited) + ".")
    try:
        _, output = _output()
        reported = _reported(output)
    finally:
        _reset()
    assert reported[("fail", "citation", NOTES)] == 1, "a whole name or a fragment of one was judged wrongly: " + _shape(reported)
    assert "anchor 'MARK' no longer appears in " + MARKER_TSX in output, output
    _assert_corpus_restored()


def test_a_hyphen_continues_a_name_in_yaml_and_ends_one_in_typescript() -> None:
    """A compose option spells `--no-autoupdate`, so `autoupdate` there is no name; `1-SPAN` subtracts a name.

    One finding: the dead YAML name. The live YAML key and the TypeScript name each resolve.
    """
    _reset()
    _append(COMPOSE_FILE, "    command: --no-autoupdate")
    _append(MARKER_TSX, "export const minus = 1-SPAN;")
    cited = [COMPOSE_FILE + " :: autoupdate", COMPOSE_FILE + " :: fixture", MARKER_TSX + " :: SPAN"]
    _append(NOTES, "Three names: " + ", ".join(_tick(citation) for citation in cited) + ".")
    try:
        _, output = _output()
        reported = _reported(output)
    finally:
        _reset()
    assert reported[("fail", "citation", NOTES)] == 1, _shape(reported)
    assert "anchor 'autoupdate' no longer appears in " + COMPOSE_FILE in output, output
    _assert_corpus_restored()


def test_a_path_a_command_or_a_mount_spells_from_the_root_is_read_up_to_its_first_argument() -> None:
    """`./` is how a page tells a reader to run a script, and read as prose it survives a rename.

    The live span's argument is no part of its path; a mount's container half follows a colon.
    """
    _reset()
    _append(NOTES, "A live " + _tick("./" + KERNEL + " --a-flag") + ", a dead " + _tick("./docs/gone-led-by-a-dot.md --a-flag") + ".")
    _append(TWIN_NOTES, "A dead mount " + _tick("./docs/gone-mounted.md:/etc/gone.md") + ".")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported == Counter({("fail", "path", NOTES): 1, ("fail", "path", TWIN_NOTES): 1}), _shape(reported)
    _assert_corpus_restored()


def test_a_root_level_directory_the_tree_holds_is_a_prefix_the_resolver_reaches() -> None:
    """The live path is planted beside the dead one because silence is what a typed tuple produces.

    Without it the case passes on a resolver that reports everything under the new prefix.
    """
    _reset()
    root = _gate().root
    write(root, ROOT_FOLDER_FILE, _page("{", QUOTE + "note" + QUOTE + ": " + QUOTE + "a file holding a root-level folder open" + QUOTE, "}"))
    _append(NOTES, "A live " + _tick(ROOT_FOLDER_FILE) + ", and a dead " + _tick(DEAD_ROOT_FOLDER_PATH) + ".")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported == Counter({("fail", "path", NOTES): 1}), "a root-level folder outside the typed tuple: " + _shape(reported)
    _assert_corpus_restored()


def test_one_file_s_four_spellings_each_draw_their_own_verdict() -> None:
    """The three spellings the resolver admits, and the fourth, from inside the package's source root, which it refuses on purpose."""
    _reset()
    checks = _module("docs_gate.checks")
    _clear_caches(_gate().root / SCRIPTS_COPY)
    inside = SPIELER_PANEL.partition("src/")[2]
    for spelling in (SPIELER_PANEL, SPIELER_PANEL.partition("/")[2], SPIELER_PANEL.rsplit("/", 1)[1]):
        found = checks._check_citation(spelling + " :: Panel", NOTES, {})
        assert not found, spelling + " did not resolve: " + repr([finding.human() for finding in found])
    refused = [finding.detail for finding in checks._check_citation(inside + " :: Panel", NOTES, {})]
    assert refused == ["cited path is neither repository-relative nor package-relative: " + inside], repr(refused)
    _assert_corpus_restored()


def test_a_citation_whose_case_differs_from_the_tracked_spelling_is_dead_here_too() -> None:
    """The case the filesystem forgives, refused on both platforms.

    Windows answers a mis-cased path yes where the Linux runner answers no, so a citation the gate
    passes here fails the branch on CI and nothing local says why.
    """
    _reset()
    checks = _module("docs_gate.checks")
    _clear_caches(_gate().root / SCRIPTS_COPY)
    # The repository path and the bare name, which reach the listing by different routes: the second
    # is what the name index folding its keys to one case would go on resolving.
    for spelling in ("docs/Glossary.md", "Glossary.md"):
        found = [finding.check for finding in checks._check_citation(spelling + " :: " + GLOSSARY_ANCHOR, NOTES, {})]
        assert found == ["citation"], spelling + " resolved anyway: " + repr(found)
    _assert_corpus_restored()


def test_a_mis_cased_suffix_fails_a_citation_rather_than_dropping_it_out_of_the_population() -> None:
    """The register is folded and the path lookup is not, which parts this case from the one above it.

    Only the suffix is mis-cased, so the finding is the register's and not a second reading of the path.
    """
    _reset()
    checks = _module("docs_gate.checks")
    _clear_caches(_gate().root / SCRIPTS_COPY)
    shouted = "docs/gone-in-a-shouted-suffix.MD"
    found = [finding.detail for finding in checks._check_citation(shouted + " :: an anchor", NOTES, {})]
    assert found == ["cited path names no file in the repository, under any spelling: " + shouted], repr(found)
    # The other half of the boundary: a suffix folded in the register leaves the LISTING exact, so a
    # tracked page named in another case still resolves to nothing.
    dead = [finding.check for finding in checks._check_citation("docs/Notes.md :: an anchor", NOTES, {})]
    assert dead == ["citation"], "a mis-cased tracked page resolved: " + repr(dead)
    _assert_corpus_restored()


def test_a_dead_citation_is_told_apart_from_a_present_file_in_a_refused_spelling() -> None:
    """Both fail, and the reader is sent two ways: after a rename or a deletion, or after the spelling the gate admits.

    One message for both sent the common case, a typo or a deleted module, hunting for another spelling.
    """
    _reset()
    checks = _module("docs_gate.checks")
    _clear_caches(_gate().root / SCRIPTS_COPY)
    dead = [finding.detail for finding in checks._check_citation("docs/gone.md :: symbol", NOTES, {})]
    assert dead == ["cited path names no file in the repository, under any spelling: docs/gone.md"], repr(dead)
    inside = SPIELER_PANEL.partition("src/")[2]
    spelled = [finding.detail for finding in checks._check_citation(inside + " :: Panel", NOTES, {})]
    assert spelled == ["cited path is neither repository-relative nor package-relative: " + inside], repr(spelled)
    _assert_corpus_restored()


def test_a_renamed_heading_kills_the_citation_naming_it_however_its_wording_survives() -> None:
    """The old wording is left in prose: on a presence test it keeps the citation alive.

    The rename is the one edit a section citation exists to catch, and the edit that scatters the
    old words over the page.
    """
    _reset()
    _append(NOTES, _heading(2, CITED_HEADING), "", "A section the page beside this one names.")
    _append(TWIN_NOTES, "The section is " + _tick(NOTES + " :: " + CITED_HEADING) + ".")
    try:
        _, before = _run()
        _replace(NOTES, _heading(2, CITED_HEADING), _heading(2, RENAMED_HEADING))
        _replace(NOTES, "A section the page beside this one names.", CITED_HEADING + " is a phrase the prose still carries.")
        _, after = _run()
    finally:
        _reset()
    assert not before, "the citation did not resolve before the rename: " + _shape(before)
    assert after == Counter({("fail", "citation", TWIN_NOTES): 1}), "a renamed heading: " + _shape(after)
    _assert_corpus_restored()


def test_a_quoted_fragment_of_a_page_is_proved_by_the_sentence_carrying_it() -> None:
    """COR-6's other anchor form, which the landmark reader would refuse: a fragment names no heading.

    Both halves, because a reader that admitted every quoted run would pass the second as readily
    as the first.
    """
    _reset()
    checks = _module("docs_gate.checks")
    _clear_caches(_gate().root / SCRIPTS_COPY)
    carried = QUOTE + "A plain page, which is where a planted violation is written." + QUOTE
    assert not checks._check_citation(NOTES + " :: " + carried, TWIN_NOTES, {}), "a quoted sentence the page carries was refused"
    gone = QUOTE + "a sentence the page never carried" + QUOTE
    found = [finding.check for finding in checks._check_citation(NOTES + " :: " + gone, TWIN_NOTES, {})]
    assert found == ["citation"], "a quoted fragment the page lacks resolved: " + repr(found)
    _assert_corpus_restored()


def test_a_quoted_fragment_a_wrap_parts_in_the_cited_file_is_still_carried() -> None:
    """Prettier re-wraps JSX text at its own width, and a sentence parted across two source lines still renders whole."""
    _reset()
    notice = ("export const Notice = () => (", "  <p>", "    A sentence the formatter wrapped", "    across two lines.", "  </p>", ");")
    _append(MARKER_TSX, *notice)
    _append(NOTES, "The notice says `" + MARKER_TSX + " :: " + QUOTE + "the formatter wrapped across two lines" + QUOTE + "`.")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "citation", NOTES)] == 0, _shape(reported)
    _assert_corpus_restored()


def test_a_fragment_the_page_parts_with_a_blank_line_or_a_tag_is_not_carried() -> None:
    """Across either the page shows two texts rather than one sentence, so the join stops at both."""
    _reset()
    notice = (
        "export const Parted = () => (",
        "  <div>",
        "    <p>",
        "      Words before a blank",
        "",
        "      line, then",
        "    </p>",
        "    <p>",
        "      words after",
        "      a tag.",
        "    </p>",
        "  </div>",
        ");",
    )
    _append(MARKER_TSX, *notice)
    for fragment in ("before a blank line, then", "then words after"):
        _append(NOTES, "The notice says `" + MARKER_TSX + " :: " + QUOTE + fragment + QUOTE + "`.")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "citation", NOTES)] == 2, _shape(reported)
    _assert_corpus_restored()


def test_a_renamed_case_surviving_only_in_a_wrapped_comment_is_still_dead() -> None:
    """The join reads rendered text alone: a comment parted across two lines is no case, and a case name is no quoted fragment."""
    _reset()
    write(
        _gate().root,
        WRAPPED_CASE_MODULE,
        _page("// once named a case the suite", "// declared under its old name", 'it("a case under its new name", () => {});'),
    )
    _append(NOTES, "The case `" + WRAPPED_CASE_MODULE + " :: a case the suite declared under its old name` is gone.")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "citation", NOTES)] == 1, _shape(reported)
    _assert_corpus_restored()


def test_an_anchor_a_fenced_block_alone_carries_resolves_nowhere() -> None:
    """A fenced sample is code a renderer shows and no reader navigates to, so an anchor found only there names nothing."""
    _reset()
    checks = _module("docs_gate.checks")
    _clear_caches(_gate().root / SCRIPTS_COPY)
    found = [finding.detail for finding in checks._check_citation(NOTES + " :: " + FENCED_ANCHOR, TWIN_NOTES, {})]
    wanted = "anchor '" + FENCED_ANCHOR + "' names no heading, table row or bold key in " + NOTES
    assert found and found[0].startswith(wanted), repr(found)
    _assert_corpus_restored()


def test_an_invariant_citation_is_proved_by_the_sheet_s_table_and_not_by_its_prose() -> None:
    """A sheet mentions a neighbour's number in prose, and presence would resolve a citation of it there.

    Three citations, one finding: the id the frontend sheet defines, the id two sheets define,
    and the id it only mentions.
    """
    _reset()
    _replace(FRONTEND_SPEC, "It renders one page.", "It renders one page, and rests on I2 for its output vocabulary.")
    _append(NOTES, "`docs/frontend/spec.md :: I1`, `docs/backend/spec.md :: I1` and `docs/frontend/spec.md :: I2` are cited.")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "citation", NOTES)] == 1, "an invariant the sheet only mentions resolved there: " + _shape(reported)
    _assert_corpus_restored()


def test_a_present_gitignored_file_still_answers_for_its_anchor() -> None:
    """The listing declines an ignored file; where the disk holds it, its anchor is a claim like any other.

    Only an ignored file that is absent is excused, a clone holding none by design.
    """
    _reset()
    root = _gate().root
    write(root, IGNORED_MODULE, _page("VALUE = 1"))
    checks = _module("docs_gate.checks")
    _clear_caches(root / SCRIPTS_COPY)
    try:
        live = checks._check_citation(IGNORED_MODULE + " :: VALUE", NOTES, {})
        dead = [finding.detail for finding in checks._check_citation(IGNORED_MODULE + " :: MISSING", NOTES, {})]
        absent = checks._check_citation("ignored/absent.py :: VALUE", NOTES, {})
    finally:
        (root / IGNORED_MODULE).unlink()
        _reset()
    assert not live, "a live anchor in an ignored file was reported: " + repr([finding.human() for finding in live])
    assert dead == ["anchor 'MISSING' is not defined in " + IGNORED_MODULE], repr(dead)
    assert not absent, "an absent ignored file was reported: " + repr([finding.human() for finding in absent])
    _assert_corpus_restored()


def test_a_link_to_a_present_gitignored_page_is_not_dead_and_its_anchor_is_still_read() -> None:
    """The link arm excuses an ignored target as its sibling arms do, and reads one that is here.

    Three links, one finding: a heading the ignored page carries, one it does not, and an absent
    ignored page.
    """
    _reset()
    root = _gate().root
    write(root, IGNORED_PAGE, _page(_heading(1, "Scratch"), "", "Notes nobody commits."))
    _append(NOTES, "[live](../ignored/scratch.md#scratch), [stale](../ignored/scratch.md#nowhere) and [absent](../ignored/absent.md).")
    try:
        _, reported = _run()
    finally:
        (root / IGNORED_PAGE).unlink()
        _reset()
    assert reported[("fail", "link", NOTES)] == 0, "a link to an ignored page was read as dead: " + _shape(reported)
    assert reported[("fail", "anchor", NOTES)] == 1, "a dead anchor into an ignored page went unread: " + _shape(reported)
    _assert_corpus_restored()


def test_a_file_the_branch_wrote_and_never_staged_resolves_by_its_repository_path() -> None:
    """The listing is git's, and a branch's new modules are in no index yet.

    Left to the tracked half alone, every citation a branch adds to a file it also adds reads as dead.
    """
    _reset()
    root = _gate().root
    write(root, UNSTAGED_MODULE, _module_named("a module this branch wrote and never staged."))
    checks = _module("docs_gate.checks")
    _clear_caches(root / SCRIPTS_COPY)
    try:
        found = checks._check_citation(UNSTAGED_MODULE + " :: VALUE", NOTES, {})
    finally:
        _reset()
    assert not found, [finding.human() for finding in found]
    _assert_corpus_restored()


def test_a_citation_that_wraps_across_a_line_is_read_as_one_citation() -> None:
    """A code span may wrap, and a pattern that stops at the newline calls the page clean.

    Two wrap points, because a pattern widened until one instance passed would leave the other
    unseen: one break after the separator, one before it.
    """
    _reset()
    _append(
        NOTES,
        "Naming nothing, wrapped after the separator: `docs/gone-in-a-wrap.md ::",
        "a symbol nobody wrote`.",
        "",
        "And wrapped before it: `docs/glossary.md",
        ":: an anchor the glossary does not carry`.",
    )
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "citation", NOTES)] == 2, "a citation that wraps was read by nothing: " + _shape(reported)
    _assert_corpus_restored()


def test_a_code_span_is_not_joined_across_a_blank_line() -> None:
    """The join stops at the blank line that ends a paragraph, which is what bounds it.

    Without that bound a stray backtick would pair with one in the paragraph below and the citation
    it invents would be reported against a page carrying none.
    """
    _reset()
    _append(
        NOTES,
        "A paragraph whose last span is left open: `docs/gone-across-a-paragraph.md ::",
        "",
        "and the paragraph after it, carrying the closing tick`.",
    )
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "citation", NOTES)] == 0, "a span was joined across a blank line: " + _shape(reported)
    _assert_corpus_restored()


def test_a_quoted_error_is_not_a_citation_and_a_broken_wrapped_one_still_is() -> None:
    """The separator alone is not evidence: COR-6's left half names a file, and quoted text does not.

    The corpus proves the marker is stripped: its wrapped citations resolve only while it is, so a
    surviving `#` speaks through the clean-corpus case.
    """
    _reset()
    _append(NOTES, "The store answered `" + QUOTED_ERROR + "`.")
    _append(SAMPLE, HASH + " The store answered `" + QUOTED_ERROR + "`.")
    # A DIFFERENT module, because the plant writes the anchor text into the file it is appended to.
    _append(SAMPLE, HASH + " and see `fl_backend/app/second.py ::", HASH + " a symbol nobody wrote`")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "citation", NOTES)] == 0, "a quoted error was read as a citation: " + _shape(reported)
    assert reported[("fail", "citation", SAMPLE)] == 1, "a wrapped citation naming a dead anchor went unread: " + _shape(reported)
    _assert_corpus_restored()


def test_a_continuation_that_wraps_across_a_comment_line_is_still_resolved() -> None:
    """Split at the wrap, the separator ends a line with nothing to its right.

    A reader admitting a file on the spaced form alone would skip it; the bare `::` is what has to
    admit it.
    """
    _reset()
    _append(SAMPLE, HASH + " `fl_backend/app/second.py :: OTHER` continues onto `::", HASH + " MISSING`.")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "citation", SAMPLE)] == 1, "a continuation that wraps went unresolved: " + _shape(reported)
    _assert_corpus_restored()


def test_a_line_citation_that_wraps_across_a_line_is_still_found() -> None:
    """Wrapped after the slash, neither raw line is a citation and the joined text is.

    Both patterns read it there -- the backticked span, and the bare tail the join leaves after the
    space -- so the count is two spellings of one defect.
    """
    _reset()
    _append(NOTES, "See `docs/", "glossary.md:7` for the shape.")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "line-citation", NOTES)] == 2, "a line citation that wraps went unread: " + _shape(reported)
    _assert_corpus_restored()


def test_a_wrapped_span_is_reported_by_what_its_closed_join_names() -> None:
    """The marker comes off a comment's continuation, or the join names nothing and reads as dead.

    A count reads a marker left in the join as the dead-path arm working, so the three plants are
    told apart by their messages.
    """
    _reset()
    _plant_wrapped_paths()
    try:
        code, output = _output()
    finally:
        _reset()
    assert output.count("wraps inside the path, which a code span renders with a space in it") == 2, output
    assert output.count("wraps inside the path, and the join names no file") == 1, output
    assert code == 1
    _assert_corpus_restored()


def test_a_family_the_fork_states_keeps_its_citations_checked() -> None:
    """A family read off this tree alone drops every citation of one the branch retires (PRE-4).

    The fork's own copy of the standard is what leaves the id recognisable, so the citation fails
    rather than passing unread.
    """
    _reset()
    _drop(STANDARD, FORK_ONLY_RULE)
    _append(NOTES, "A claim citing " + RETIRED_ID + ".")
    try:
        code, reported = _run()
    finally:
        _reset()
    assert reported == Counter({("fail", "rule-id", NOTES): 1}), "a retired family: " + _shape(reported)
    assert code == 1
    _assert_corpus_restored()


def test_a_dead_citation_and_another_spelling_of_one_are_told_apart_by_whole_segments() -> None:
    """The basename alone calls a dead `notes.md` another spelling of the two pages the tree holds.

    Both arms in one run: each is a `citation` finding about one page, so only the words part them.
    """
    _reset()
    _append(NOTES, "`" + SHARED_BASENAME + " :: symbol` names nothing.")
    _append(NOTES, "`" + OTHER_SPELLING + " :: symbol` is spelled from a root no resolver reaches.")
    try:
        code, output = _output()
    finally:
        _reset()
    assert _reported(output) == Counter({("fail", "citation", NOTES): 2}), "the two arms: " + _shape(_reported(output))
    assert "names no file in the repository, under any spelling: " + SHARED_BASENAME in output, output
    assert "is neither repository-relative nor package-relative: " + OTHER_SPELLING in output, output
    assert code == 1
    _assert_corpus_restored()


def test_a_registered_claim_names_a_missing_file_and_a_missing_anchor_apart() -> None:
    """Both arms of a registry row's contract: no file of that name, and a file the anchor is not in.

    One check and one file either way, so the counted triples cannot tell which arm answered.
    """
    _reset()
    _plant_enforced_by()
    try:
        code, output = _output()
    finally:
        _undo_enforced_by()
        _reset()
    assert "`echo` claims `docs/gone.md :: I1`, which names no file" in output, output
    assert "`anchor` claims `" + NOTES + " :: " + ABSENT_ANCHOR + "`, which does not resolve" in output, output
    assert code == 1
    _assert_corpus_restored()


def test_a_registered_claim_is_not_proved_by_the_registry_row_that_makes_it() -> None:
    """A row spells its contract inside a string, so no line of the file spells the citation.

    Read from the words: this claim draws one finding about the registry however it resolves.
    """
    _reset()
    kernel = _module("docs_gate.kernel")
    row = kernel.CHECKS[SELF_CLAIMED_CHECK]
    kernel.CHECKS[SELF_CLAIMED_CHECK] = kernel.Check(row.severities, kernel.claimed(KERNEL + " :: " + SELF_CLAIMED_CHECK))
    try:
        _, output = _output()
    finally:
        kernel.CHECKS[SELF_CLAIMED_CHECK] = row
        _reset()
    assert "anchor '" + SELF_CLAIMED_CHECK + "' is spelled in " + KERNEL + " only by a citation of it" in output, output
    _assert_corpus_restored()
