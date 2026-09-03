"""SCRIPTS · the branch-scoped checks' scenario net

`scripts/checks/docs_gate/branch.py` reads the branch's diff against its base, so a run over a clean
tree arms almost none of it. Each scenario here shapes one synthetic branch state in a throwaway
repository holding a copy of scripts/, and asserts what armed and what fired. A subprocess does
the reading: the gate derives its repository root from its own file, and importing a copy
in-process would collide with `scripts/tests/test_check_docs.py`'s copy over one module name.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Final

from conftest import configure, copy_scripts, git, new_root, write

# Built rather than written, for `scripts/tests/test_check_docs.py`'s reason: no line of THIS file
# may carry a marker the gate could read as this file's own comment or heading.
HASH: Final = "#"
QUOTES: Final = '"' * 3

MOD: Final = "fl_backend/app/mod.py"
SIDE: Final = "fl_backend/app/side.py"
LEGACY: Final = "fl_backend/app/legacy.py"
FRESH: Final = "fl_backend/app/fresh.py"
# The document INC-4's exemption is taken from, and the tree the second listing is read out of.
OPENAPI: Final = "fl_backend/openapi.json"
NOTES: Final = "docs/notes.md"
SPARE: Final = "docs/spare.md"
# A German page name, which `core.quotePath` spells back as an escaped run this diff walk cannot
# key on. The domain vocabulary is German, so this path is the ordinary case and not the exotic one.
UMLAUT_PAGE: Final = "docs/prüfung.md"
ROADMAP: Final = "docs/_roadmap/items.md"
ENTRYPOINT: Final = "nginx/entrypoint.sh"
TOML: Final = "fl_backend/pyproject.toml"
# A tracked file outside every scanned suffix: the diff must see it and every check must not.
PLAIN: Final = "notes.txt"
IGNORED: Final = "ignored/scratch.py"
SKIPPED: Final = "docs/audit/scratch.py"
GITIGNORE: Final = ".gitignore"
SCRIPTS_COPY: Final = "scripts"
HOOKS_STUB: Final = "nohooks"
# What a branch-wide finding names in place of a file.
BRANCH_DIFF: Final = "(branch diff)"

# The id the fixture roadmap defines, so an added comment naming it is resolvable. Spelled only in
# strings: named in a comment of this file it would be read as this file's own citation.
ROADMAP_ID: Final = "q7mf-zd4x"
# What `LOOSE_ID_RE` matches and the roadmap table cannot resolve: a short hyphenated word, and a
# token nothing files. Each is what an unresolved hit looks like, and the table is what parts a
# citation from either.
PLAIN_WORD: Final = "read-only"
UNFILED_TOKEN: Final = "zzzz-9999"
DROPPABLE: Final = "A droppable line the deletion scenario removes."
LONG_TEXT: Final = "a line of a block that runs past what a comment may hold"
LEGACY_OPEN: Final = "an opening line of a committed comment block that already runs far past what a comment may hold"
LEGACY_MID: Final = "a middle line a scenario amends in place, to prove the fork text exempts the block it opens"
LEGACY_END: Final = "a closing line that keeps the committed block over the bound before any scenario touches it"
# The one description the fixture document publishes, over the bound so that any silence proves the
# exemption. Multi-line, with a blank line, a heading and a list: a one-line description is the one
# shape whose two normalisers cannot disagree.
PUBLISHED_LINES: Final[tuple[str, ...]] = (
    "Read the operation a caller reaches, whose refusal conditions run past what a comment",
    "beside code may hold.",
    "",
    "# A markdown heading, which the source-side normaliser strips and the document side must too",
    "",
    "- a bulleted refusal a caller would be surprised by",
    "- a second, so the published document carries this contract for a reader with no code open",
)
PUBLISHED_TEXT: Final = "\n".join(PUBLISHED_LINES)
# A docstring of the same length under the same decorator, which the document does not publish.
UNPUBLISHED_LINES: Final[tuple[str, ...]] = (PUBLISHED_LINES[0].replace("Read the", "Write the"), *PUBLISHED_LINES[1:])
UNPUBLISHED_TEXT: Final = "\n".join(UNPUBLISHED_LINES)
# A bulleted clause short enough that six of them keep the bound on words and break it on markers.
BULLET_TEXT: Final = "a bulleted clause charging no word"
BULLET_ITEMS: Final = 6
# What a scenario adds INSIDE the committed block, which no rewrite of a line already there would.
ADDED_CLAUSE: Final = "a further clause a scenario writes into a block that was over the bound already"

# What every diff-reading check's refusal names, and that refusal's own shape
# (`scripts/checks/docs_gate/branch.py :: check_branch_diff`). Spelled here as a pin: the wording is
# behaviour a consolidation must preserve.
DIFF_READERS: Final = "history, added comment citations and comment length"

# The driver composes the branch checks in the gate's own order, read from whichever module wires
# the run rather than listed here: a check dropped from that wiring has to fail this net, and a
# check added to it has to be given a scenario.

# A check no sibling calls is still reached where another check in its own module calls it, so
# the driver credits that caller with wiring it. Dropped means called from nowhere at all, which
# leaves it owned and unwired, and still fails.
DRIVER: Final = """
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[1] + "/lib")
sys.path.insert(0, sys.argv[1] + "/checks")

import checker_kernel
from docs_gate import branch
from docs_gate.kernel import scanned_files

assert Path(checker_kernel.__file__ or "").resolve().is_relative_to(Path(sys.argv[1]).resolve())

fork = checker_kernel.resolve_base() if sys.argv[2] == "-" else sys.argv[2]
state = branch.Branch(checker_kernel.DEFAULT_BASE, fork)
diffed = branch._added_by_file(fork) if fork is not None else None
additions = branch.branch_additions(state)

calls = {
    "check_branch_diff": lambda: branch.check_branch_diff(state),
    "check_history_phrases": lambda: branch.check_history_phrases(additions),
    "check_added_citations": lambda: branch.check_added_citations(additions),
    "check_comment_bounds": lambda: branch.check_comment_bounds(state),
    "check_prose_shas": lambda: branch.check_prose_shas(scanned_files()),
}

home = Path(branch.__file__ or "").resolve()
owned = {n for n in dir(branch) if n.startswith("check_") and getattr(branch, n).__module__ == branch.__name__}
wired = []
for source in sorted(home.parent.glob("*.py")):
    if source.resolve() == home:
        continue
    for name in re.findall("(check_[a-z_]+)[(]", source.read_text(encoding="utf-8")):
        if name in owned and name not in wired:
            wired.append(name)

inner = {n for n in re.findall("(?<!def )(check_[a-z_]+)[(]", home.read_text(encoding="utf-8")) if n in owned}
owned -= inner - set(wired)

assert sorted(wired) == sorted(owned), "the gate wires " + repr(sorted(wired)) + " where branch.py owns " + repr(sorted(owned))
assert sorted(calls) == sorted(owned), "this driver calls " + repr(sorted(calls)) + " where branch.py owns " + repr(sorted(owned))

findings = [[f.severity, f.check, f.file, f.detail, f.line] for name in wired for f in calls[name]()]
print(json.dumps({
    "fork": fork,
    "diffed": None if diffed is None else sorted(diffed),
    "additions": {rel: lines for rel, lines in sorted(additions.items())},
    "findings": findings,
}))"""


def _page(*lines: str) -> str:
    return "\n".join(lines) + "\n"


def _module(title: str) -> str:
    return _page(QUOTES + "BACKEND · " + title + QUOTES, "", "VALUE = 1")


def _corpus() -> dict[str, str]:
    return {
        GITIGNORE: _page("/" + SCRIPTS_COPY + "/", "/" + IGNORED.partition("/")[0] + "/"),
        NOTES: _page(HASH + " Notes", "", "A plain page the scenarios append to.", "", DROPPABLE),
        SPARE: _page(HASH + " Spare", "", "A page that exists to be deleted whole."),
        ROADMAP: _page(
            HASH + " Roadmap",
            "",
            "| ID | Item | Tags | Status |",
            "| --- | --- | --- | --- |",
            "| `" + ROADMAP_ID + "` | A scenario item | Docs | Open |",
        ),
        MOD: _module("a module the scenarios write comments into."),
        SIDE: _module("a module kept beside the first, so per-file answers separate."),
        LEGACY: _page(
            QUOTES + "BACKEND · a module whose committed comment block breaks the bound." + QUOTES,
            "",
            "VALUE = 1",
            "",
            HASH + " " + LEGACY_OPEN,
            HASH + " " + LEGACY_MID,
            HASH + " " + LEGACY_END,
        ),
        OPENAPI: json.dumps({"paths": {"/read": {"get": {"description": PUBLISHED_TEXT}}}}, indent=2) + "\n",
        ENTRYPOINT: _page(HASH + "!/bin/sh", "exec true"),
        TOML: _page("[tool.sample]", "key = 1"),
        PLAIN: _page("plain text outside every scanned suffix"),
    }


def _build() -> tuple[Path, Path]:
    """One fixture repository beside the driver that reads it, built once per session."""
    parent = new_root("branch-checks-fixture-")
    root = parent / "repo"
    copy_scripts(root / SCRIPTS_COPY)
    (parent / "driver.py").write_bytes(DRIVER.encode("utf-8"))
    pages = _corpus()
    for rel, text in pages.items():
        write(root, rel, text)
    (root / HOOKS_STUB).mkdir()
    configure(root, str(root / HOOKS_STUB))
    # By name, never `add -A`: the scripts copy sits in this tree too, gitignored on top.
    git(root, "add", "--", *pages)
    git(root, "commit", "-m", "Corpus: the branch scenarios start from here")
    return parent, root


_STATE: list[tuple[Path, Path]] = []


def _fixture() -> tuple[Path, Path]:
    if not _STATE:
        _STATE.append(_build())
    return _STATE[0]


def _root() -> Path:
    return _fixture()[1]


def _reset() -> None:
    """The corpus as committed, with only the scripts copy left standing.

    `-x` reaches the gitignored plants a plain clean skips; `git checkout HEAD` restores what a
    scenario edited without touching any ref a scenario moved.
    """
    root = _root()
    git(root, "reset", "-q", "HEAD", "--", ".")
    git(root, "checkout", "HEAD", "--", ".")
    git(root, "clean", "-fdxq", "-e", "/" + SCRIPTS_COPY, "-e", "/" + HOOKS_STUB)


def _run(fork: str = "-") -> dict[str, Any]:
    """One subprocess reading the fixture's branch state, as the driver reports it."""
    parent, root = _fixture()
    done = subprocess.run(
        (sys.executable, str(parent / "driver.py"), str(root / SCRIPTS_COPY), fork),
        cwd=parent,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert done.returncode == 0, "the driver crashed:\n" + done.stderr
    return json.loads(done.stdout)


def _findings(data: dict[str, Any], check: str | None = None) -> list[tuple[str, str, str, str]]:
    """Every finding as severity, check, file and detail. The line it carries is `_lines`' subject."""
    found = [tuple(finding[:4]) for finding in data["findings"]]
    return [f for f in found if check is None or f[1] == check]


def _lines(data: dict[str, Any], check: str) -> list[int | None]:
    """One check's findings by the line each looked at, which the detail no longer spells."""
    return [finding[4] for finding in data["findings"] if finding[1] == check]


def _read(rel: str) -> str:
    return (_root() / rel).read_text(encoding="utf-8")


def _replace(rel: str, old: str, new: str) -> None:
    text = _read(rel)
    assert old in text, "the corpus no longer carries " + repr(old) + " in " + rel
    write(_root(), rel, text.replace(old, new, 1))


def _append(rel: str, *lines: str) -> None:
    write(_root(), rel, _read(rel) + "\n" + "\n".join(lines) + "\n")


def _line_of(rel: str, text: str) -> int:
    return _read(rel).split("\n").index(text) + 1


def _bound_fail(rel: str, words: int) -> tuple[str, str, str, str]:
    detail = f"the comment block runs {words} words -- INC-9 caps a block at 40, every shape alike"
    return ("fail", "comment-length", rel, detail)


def _sha_fail(rel: str, sha: str) -> tuple[str, str, str, str]:
    return ("fail", "sha", rel, f"commit {sha} is named here -- COR-6 reaches the argument with `git log -S` on the constraint instead")


def _scope_refusal(missing: str) -> tuple[str, str, str, str]:
    return ("fail", "branch-scope", BRANCH_DIFF, DIFF_READERS + " did not run: git could not " + missing)


LONG_BLOCK: Final[tuple[str, ...]] = tuple(HASH + " " + LONG_TEXT for _ in range(6))
LONG_WORDS: Final = len(" ".join([LONG_TEXT] * 6).split())


def test_a_clean_branch_arms_nothing_and_reports_nothing() -> None:
    """The committed over-bound block in the legacy module must stay silent while nothing touches it."""
    _reset()
    data = _run()
    assert data["fork"] is not None
    assert data["diffed"] == []
    assert data["additions"] == {}
    assert _findings(data) == []


def test_an_added_comment_citation_fails_on_the_review_reference_and_the_roadmap_id() -> None:
    """The same id added to a markdown page stays outside this check, which reads source suffixes alone."""
    _reset()
    _append(MOD, HASH + " " + ROADMAP_ID + " says so", HASH + " the last session shaped this")
    _append(NOTES, ROADMAP_ID + " sits in this prose line as well.")
    try:
        data = _run()
    finally:
        _reset()
    assert MOD in data["additions"] and NOTES in data["additions"]
    assert _findings(data) == [
        ("fail", "comment-citation", MOD, "review reference 'last session' in an added comment (INC-6, COR-1)"),
        ("fail", "comment-citation", MOD, "roadmap id " + ROADMAP_ID + " in an added comment -- state the constraint (INC-6)"),
    ]


def test_an_id_shaped_token_the_roadmap_cannot_resolve_stays_silent() -> None:
    """Resolving a hit against the roadmap table is what separates a citation from an ordinary word.

    An entry id is eight lower-case characters, and so is `register`: without the resolution every
    comment carrying an eight-letter word would report.
    """
    _reset()
    _append(MOD, HASH + " " + PLAIN_WORD + " and " + UNFILED_TOKEN + " are a shape, not an id")
    # The review reference beside them is the evidence the check read the file at all.
    _append(MOD, HASH + " drawn up in the last session")
    try:
        data = _run()
    finally:
        _reset()
    assert MOD in data["additions"]
    assert _findings(data) == [("fail", "comment-citation", MOD, "review reference 'last session' in an added comment (INC-6, COR-1)")]


def test_an_added_block_over_the_bound_fails_and_a_short_one_stays_silent() -> None:
    _reset()
    _append(MOD, *LONG_BLOCK)
    _append(SIDE, HASH + " a short remark")
    line = _line_of(MOD, LONG_BLOCK[0])
    try:
        data = _run()
    finally:
        _reset()
    assert sorted(data["additions"]) == [MOD, SIDE]
    assert _findings(data) == [_bound_fail(MOD, LONG_WORDS)]
    assert _lines(data, "comment-length") == [line]


def test_added_history_phrases_are_one_finding_per_file_naming_its_phrases() -> None:
    """A fenced markdown line carrying a phrase is outside the scanned body, so neither count holds it.

    Two files, so a finding naming one cannot be the branch-wide count that named no file at all.
    """
    fence = "`" * 3
    _reset()
    _append(MOD, HASH + " this previously lived elsewhere")
    _append(NOTES, "The page was renamed after the draw.", "", fence, "previously fenced text", fence)
    try:
        data = _run()
    finally:
        _reset()
    assert _findings(data) == [
        ("fail", "history", NOTES, "1 added line(s) match a COR-3 history phrase ('was renamed') -- rewrite them in the present"),
        ("fail", "history", MOD, "1 added line(s) match a COR-3 history phrase ('previously') -- rewrite them in the present"),
    ]


def test_a_prose_sha_reports_every_mixed_hex_run_resolvable_or_not() -> None:
    """The digits-only run and the 9-character digest stay silent; one sha named twice is one finding.

    A prefix of HEAD fails beside the dangling one, COR-6 banning a commit SHA rather than a dead
    one.
    """
    _reset()
    head = git(_root(), "rev-parse", "HEAD")
    resolvable = next((head[:n] for n in (8, 7) if any(c.isdigit() for c in head[:n]) and any(c.isalpha() for c in head[:n])), None)
    assert resolvable is not None, "HEAD's short form carries no digit and letter, so it proves nothing here"
    tick = "`"
    _append(
        NOTES,
        "The commit " + tick + "abc1234" + tick + " is named here.",
        "And " + tick + "abc1234" + tick + " is named again.",
        "A digits-only run: " + tick + "1234567" + tick + ".",
        "An asset digest: " + tick + "abcdef123" + tick + ".",
        "A commit this clone holds: " + tick + resolvable + tick + ".",
    )
    try:
        data = _run()
    finally:
        _reset()
    assert sorted(_findings(data)) == sorted([_sha_fail(NOTES, "abc1234"), _sha_fail(NOTES, resolvable)])


def test_a_prose_sha_the_branch_never_touched_still_reports() -> None:
    """The sha check reads the whole corpus, which the diff-reading checks beside it do not.

    The sha sits in a page the fork already holds while the branch edits a different page, so
    scoping this check to the branch's own files would leave it silent.
    """
    tick = "`"
    _reset()
    root = _root()
    base = git(root, "rev-parse", "HEAD")
    _append(SPARE, "The commit " + tick + "abc1234" + tick + " is named here.")
    git(root, "add", "--", SPARE)
    git(root, "commit", "-q", "-m", "Corpus: a page carrying an unresolvable sha")
    _append(NOTES, "An unrelated line, so what the branch adds names no sha at all.")
    try:
        data = _run()
    finally:
        # Soft, so the corpus commit comes back as the fork with the working tree untouched; the
        # reset that follows puts the page itself back.
        git(root, "reset", "-q", "--soft", base)
        _reset()
    assert data["diffed"] == [NOTES]
    assert sorted(data["additions"]) == [NOTES]
    assert _findings(data) == [_sha_fail(SPARE, "abc1234")]


def test_a_non_ascii_path_and_a_prefixless_diff_both_still_report() -> None:
    """Two git configurations that silently emptied this walk.

    `core.quotePath` is on by default; `diff.noprefix` drops the `b/` the walk keys on, for EVERY
    file. Each drop is silent, so the evidence is the finding rather than a count.
    """
    _reset()
    root = _root()
    write(root, UMLAUT_PAGE, _page(HASH + " Prüfung", "", "This page was renamed after the draw."))
    # Staged: `git diff <fork>` reaches the working tree, and an unstaged new file goes through
    # `_added_whole` instead, which never reads a diff header at all.
    git(root, "add", "--", UMLAUT_PAGE)
    expected = [("fail", "history", UMLAUT_PAGE, "1 added line(s) match a COR-3 history phrase ('was renamed') -- rewrite them in the present")]
    try:
        quoted = _run()
        git(root, "config", "diff.noprefix", "true")
        prefixless = _run()
    finally:
        git(root, "config", "--unset", "diff.noprefix")
        _reset()
    assert quoted["additions"].get(UMLAUT_PAGE), "the diff walk dropped a non-ASCII path: " + repr(sorted(quoted["additions"]))
    assert _findings(quoted) == expected
    assert _findings(prefixless) == expected


def test_a_change_to_an_unscanned_suffix_reaches_the_diff_and_no_check() -> None:
    _reset()
    _append(PLAIN, "previously there were four of these")
    try:
        data = _run()
    finally:
        _reset()
    assert data["diffed"] == [PLAIN]
    assert data["additions"] == {}
    assert _findings(data) == []


def test_a_pure_deletion_arms_nothing() -> None:
    """A dropped line and a whole deleted page leave the diff with no added line to read."""
    _reset()
    _replace(NOTES, DROPPABLE + "\n", "")
    (_root() / SPARE).unlink()
    try:
        # Read from the fixture rather than inferred from an empty answer: a clean tree reports the
        # same empty diff, so the deletion needs its own evidence that git saw one.
        touched = sorted(git(_root(), "diff", "--name-only").splitlines())
        data = _run()
    finally:
        _reset()
    assert touched == [NOTES, SPARE]
    assert data["diffed"] == []
    assert data["additions"] == {}
    assert _findings(data) == []


def test_an_untracked_corpus_file_is_read_whole_and_a_non_corpus_one_is_not() -> None:
    """git holds no diff for a file the index never saw, so every line counts as added.

    Only the scanned kinds are read whole: the ignored, the skipped and the unscanned plants
    beside the fresh module must reach nothing.
    """
    _reset()
    root = _root()
    write(root, FRESH, _page(QUOTES + "BACKEND · a module this branch wrote and never staged." + QUOTES, "", "VALUE = 1", "", *LONG_BLOCK))
    write(root, IGNORED, _page(*LONG_BLOCK))
    write(root, SKIPPED, _page(*LONG_BLOCK))
    write(root, "notes-extra.txt", _page(*LONG_BLOCK))
    line = _line_of(FRESH, LONG_BLOCK[0])
    try:
        data = _run()
    finally:
        _reset()
    assert data["diffed"] == [FRESH]
    assert sorted(data["additions"]) == [FRESH]
    assert data["additions"][FRESH][-6:] == list(LONG_BLOCK)
    assert _findings(data) == [_bound_fail(FRESH, LONG_WORDS)]
    assert _lines(data, "comment-length") == [line]


def test_a_source_file_outside_the_named_trees_is_reached_by_its_kind() -> None:
    """A shell file under nginx sits in no tree the Scope names, and its kind is what puts it in scope."""
    # Both readers, because the by-kind half is what the bounds and the added-line checks share: a
    # file admitted by one and dropped by the other leaves the Scope naming what nothing measures.
    _reset()
    _append(ENTRYPOINT, *LONG_BLOCK)
    _append(ENTRYPOINT, HASH + " drawn up in the last session")
    line = _line_of(ENTRYPOINT, LONG_BLOCK[0])
    try:
        data = _run()
    finally:
        _reset()
    assert sorted(data["additions"]) == [ENTRYPOINT]
    assert _findings(data) == [
        ("fail", "comment-citation", ENTRYPOINT, "review reference 'last session' in an added comment (INC-6, COR-1)"),
        _bound_fail(ENTRYPOINT, LONG_WORDS),
    ]
    assert _lines(data, "comment-length") == [line]


def test_a_scanned_config_suffix_feeds_the_prose_checks_and_not_the_source_ones() -> None:
    """A toml comment is inside history's reach, and outside comment-citation's and the bounds'."""
    _reset()
    _append(TOML, HASH + " the table was renamed", HASH + " it holds the rows", HASH + " " + ROADMAP_ID + " sits here")
    try:
        data = _run()
    finally:
        _reset()
    assert sorted(data["additions"]) == [TOML]
    assert _findings(data) == [
        ("fail", "history", TOML, "1 added line(s) match a COR-3 history phrase ('was renamed') -- rewrite them in the present")
    ]


def test_a_missing_base_ref_is_one_refusal_and_the_bounds_stay_silent() -> None:
    """The prose-sha check still speaks, reading the corpus rather than the diff; the planted block and phrase go unread."""
    tick = "`"
    _reset()
    _append(MOD, *LONG_BLOCK, HASH + " this previously lived elsewhere")
    _append(NOTES, "The commit " + tick + "abc1234" + tick + " is named here.")
    git(_root(), "branch", "-m", "main", "trunk")
    try:
        data = _run()
    finally:
        git(_root(), "branch", "-m", "trunk", "main")
        _reset()
    assert data["fork"] is None
    assert data["diffed"] is None
    assert data["additions"] == {}
    assert _findings(data) == [
        _scope_refusal("resolve main to a commit this branch forked from"),
        _sha_fail(NOTES, "abc1234"),
    ]


def test_an_unreadable_fork_is_the_other_refusal_arm() -> None:
    """A fork commit git cannot diff degrades every diff reader together, in one sentence."""
    _reset()
    _append(MOD, *LONG_BLOCK)
    try:
        data = _run(fork="0" * 40)
    finally:
        _reset()
    assert data["diffed"] is None
    assert data["additions"] == {}
    assert _findings(data) == [_scope_refusal("read this branch's diff")]


def test_an_older_over_bound_block_edited_in_place_stays_exempt() -> None:
    """The fork text matches the committed block by the lines the two versions share.

    An edit inside that block fails nothing, while a block newly added beside it still does.
    """
    _reset()
    _replace(LEGACY, "amends", "adjusts")
    try:
        edited = _run()
        _append(LEGACY, *LONG_BLOCK)
        line = _line_of(LEGACY, LONG_BLOCK[0])
        added = _run()
    finally:
        _reset()
    assert _findings(edited, "comment-length") == []
    assert _findings(added, "comment-length") == [_bound_fail(LEGACY, LONG_WORDS)]
    assert _lines(added, "comment-length") == [line]


def test_rewriting_an_older_block_s_opening_sentence_keeps_its_standing() -> None:
    """An opening-line key drops the exemption for the one edit INC-9 most wants a writer to make.

    The match is the lines the two versions share, so rewriting the opening costs the block nothing.
    """
    _reset()
    _replace(LEGACY, LEGACY_OPEN, "an opening sentence a scenario rewrote outright, shorter and clearer than the one committed")
    try:
        data = _run()
    finally:
        _reset()
    assert _findings(data, "comment-length") == []


def test_lengthening_an_older_block_fails_and_names_both_numbers() -> None:
    """The standing is the block's own word count, so an edit may not make an over-bound block worse."""
    _reset()
    _replace(LEGACY, HASH + " " + LEGACY_END, HASH + " " + ADDED_CLAUSE + "\n" + HASH + " " + LEGACY_END)
    committed = len(" ".join([LEGACY_OPEN, LEGACY_MID, LEGACY_END]).split())
    try:
        data = _run()
    finally:
        _reset()
    grown = committed + len(ADDED_CLAUSE.split())
    detail = f"the comment block runs {grown} words, up from {committed} where the branch forked -- INC-9 lets neither number rise"
    assert _findings(data, "comment-length") == [("fail", "comment-length", LEGACY, detail)]


def test_a_list_s_markers_cost_a_block_nothing() -> None:
    """INC-9 counts the words a list carries and never the shape COR-8 asks for.

    `word_count` charges a marker one word per item, so the strip belongs in the reader INC-9 alone
    goes through.
    """
    words = len(BULLET_TEXT.split()) * BULLET_ITEMS
    assert words <= 40 < words + BULLET_ITEMS, "the fixture proves nothing unless the markers alone break the bound"
    _reset()
    try:
        _append(MOD, *(HASH + " - " + BULLET_TEXT for _ in range(BULLET_ITEMS)))
        bulleted = _run()
        _reset()
        # One append rather than two: a second would leave a blank line parting the run in half.
        _append(MOD, *(HASH + " - " + BULLET_TEXT for _ in range(BULLET_ITEMS * 2)))
        doubled = _run()
    finally:
        _reset()
    assert _findings(bulleted, "comment-length") == []
    assert _findings(doubled, "comment-length") == [_bound_fail(MOD, words * 2)]


def _endpoint(lines: tuple[str, ...], *, decorated: bool) -> tuple[str, ...]:
    """A function carrying one docstring over as many lines as it was given, decorated or not.

    Indented as a real one is, so the source side has the dedent to undo that the document side
    never had to do.
    """
    opener = ('@router.get("/read")',) if decorated else ()
    body = ("    " + QUOTES + lines[0], *("    " + line if line else "" for line in lines[1:]), "    " + QUOTES)
    return ("", "") + opener + ("def read():", *body, "    return VALUE")


def _bound_words(lines: tuple[str, ...]) -> int:
    """What INC-9 charges the block: a heading's `#` and a list's markers cost nothing.

    Spelled here rather than imported, a test taking its number from the code under test asserting
    only that the code agrees with itself.
    """
    return len(" ".join(line.lstrip("#- ").strip() for line in lines).split())


def test_a_published_endpoint_docstring_is_exempt_and_needs_both_listings() -> None:
    """INC-4 puts a published endpoint docstring at a rung no bound here reaches.

    The exempt set is the published document's; a route decorator is a second condition, not a
    second population, that document being generated from these same docstrings.
    """
    _reset()
    try:
        _append(MOD, *_endpoint(PUBLISHED_LINES, decorated=True))
        exempt = _run()
        _reset()
        _append(MOD, *_endpoint(PUBLISHED_LINES, decorated=False))
        undecorated = _run()
        _reset()
        _append(MOD, *_endpoint(UNPUBLISHED_LINES, decorated=True))
        unpublished = _run()
    finally:
        _reset()
    words = _bound_words(PUBLISHED_LINES)
    assert words > 40, "a docstring inside the bound would pass without the exemption"
    assert _findings(exempt, "comment-length") == []
    # Reached by only one of the two listings, a block is measured like any other.
    assert _findings(undecorated, "comment-length") == [
        (
            "fail",
            "comment-length",
            MOD,
            f"the comment block runs {words} words and no route decorator carries it -- INC-4's exemption needs both (PRE-4)",
        ),
    ]
    assert _findings(unpublished, "comment-length") == [
        (
            "fail",
            "comment-length",
            MOD,
            f"the comment block runs {words} words and `{OPENAPI}` publishes no such description -- INC-4's exemption needs both",
        ),
    ]


def test_a_committed_addition_reads_the_same_as_a_working_tree_one() -> None:
    """The diff runs from the fork to the working tree, so a commit on the branch changes nothing."""
    _reset()
    root = _root()
    git(root, "checkout", "-q", "-b", "work")
    _append(MOD, HASH + " " + ROADMAP_ID + " says so")
    git(root, "add", "--", MOD)
    git(root, "commit", "-q", "-m", "Scenario: one committed comment")
    try:
        data = _run()
    finally:
        git(root, "checkout", "-q", "-f", "main")
        git(root, "branch", "-q", "-D", "work")
        _reset()
    assert data["diffed"] == [MOD]
    assert _findings(data) == [
        ("fail", "comment-citation", MOD, "roadmap id " + ROADMAP_ID + " in an added comment -- state the constraint (INC-6)")
    ]


def test_an_added_code_line_is_outside_the_scanned_body() -> None:
    """A phrase inside a string literal is data: the file arms the diff and hands the checks nothing."""
    _reset()
    _append(MOD, 'WAS = "this previously lived elsewhere"')
    try:
        data = _run()
    finally:
        _reset()
    assert data["diffed"] == [MOD]
    assert data["additions"] == {}
    assert _findings(data) == []
