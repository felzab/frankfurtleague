"""SCRIPTS · the branch-scoped checks' scenario net

`scripts/docs_gate/branch.py` reads the branch's diff against its base, so a run over a clean
tree arms almost none of it. Each scenario here shapes one synthetic branch state in a throwaway
repository holding a copy of scripts/, and asserts what armed and what fired. A subprocess does
the reading: the gate derives its repository root from its own file, and importing a copy
in-process would collide with `scripts/tests/test_check_docs.py`'s copy over one module name.
"""

from __future__ import annotations

import atexit
import contextlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any, Final

REPO_ROOT: Final = Path(__file__).resolve().parent.parent.parent

# Built rather than written, for `scripts/tests/test_check_docs.py`'s reason: no line of THIS file
# may carry a marker the gate could read as this file's own comment or heading.
HASH: Final = "#"
QUOTES: Final = '"' * 3

MOD: Final = "fl_backend/app/mod.py"
SIDE: Final = "fl_backend/app/side.py"
LEGACY: Final = "fl_backend/app/legacy.py"
FRESH: Final = "fl_backend/app/fresh.py"
NOTES: Final = "docs/notes.md"
SPARE: Final = "docs/spare.md"
ROADMAP: Final = "docs/_roadmap/open-items.md"
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
ROADMAP_ID: Final = "FX-9"
DROPPABLE: Final = "A droppable line the deletion scenario removes."
LONG_TEXT: Final = "a line of a block that runs past what a comment may hold"
LEGACY_OPEN: Final = "an opening line of a committed comment block that already runs far past what a comment may hold"
LEGACY_MID: Final = "a middle line a scenario amends in place, to prove the fork text exempts the block it opens"
LEGACY_END: Final = "a closing line that keeps the committed block over the bound before any scenario touches it"

# What every diff-reading check's advisory names, and the advisory's own shape
# (`scripts/docs_gate/branch.py :: check_branch_diff`). Spelled here as a pin: the wording is
# behaviour a consolidation must preserve.
DIFF_READERS: Final = "history, counts, added comment citations and comment length"

DRIVER: Final = """
import json
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[1])

import checker_kernel
from docs_gate import branch
from docs_gate.kernel import scanned_files

assert Path(checker_kernel.__file__ or "").resolve().is_relative_to(Path(sys.argv[1]).resolve())

fork = checker_kernel.resolve_base() if sys.argv[2] == "-" else sys.argv[2]
state = branch.Branch(checker_kernel.DEFAULT_BASE, fork)
diffed = branch._added_by_file(fork) if fork is not None else None
additions = branch.branch_additions(state)
findings = [
    [f.severity, f.check, f.file, f.detail]
    for f in (
        *branch.check_branch_diff(state),
        *branch.check_history_phrases(additions),
        *branch.check_counts(additions),
        *branch.check_added_citations(additions),
        *branch.check_comment_bounds(state),
        *branch.check_prose_shas(scanned_files()),
    )
]
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
            "| Rank | ID | Item |",
            "| --- | --- | --- |",
            "| 1 | " + ROADMAP_ID + " | A ranked scenario item |",
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
        ENTRYPOINT: _page(HASH + "!/bin/sh", "exec true"),
        TOML: _page("[tool.sample]", "key = 1"),
        PLAIN: _page("plain text outside every scanned suffix"),
    }


def _git(root: Path, *args: str) -> str:
    done = subprocess.run(("git", *args), cwd=root, capture_output=True, text=True, encoding="utf-8", check=False)
    if done.returncode != 0:
        raise RuntimeError("git " + " ".join(args) + " failed: " + (done.stderr.strip() or done.stdout.strip()))
    return done.stdout.strip()


def _write(root: Path, rel: str, text: str) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    # Bytes, never write_text: that emits CRLF on Windows, and the diff would carry every line.
    path.write_bytes(text.encode("utf-8"))


def _discard(root: Path) -> None:
    """Remove the fixture tree, the read-only files git wrote inside it included."""

    def _clear_readonly(remove: Callable[..., object], path: str, _exc: BaseException) -> None:
        os.chmod(path, stat.S_IWRITE)
        remove(path)

    with contextlib.suppress(OSError):
        shutil.rmtree(root, onexc=_clear_readonly)


def _build() -> tuple[Path, Path]:
    """One fixture repository beside the driver that reads it, built once per session."""
    parent = Path(tempfile.mkdtemp(prefix="branch-checks-fixture-")).resolve()
    atexit.register(_discard, parent)
    root = parent / "repo"
    ignored = shutil.ignore_patterns("__pycache__", "tests", ".ruff_cache", ".pytest_cache", ".mypy_cache")
    shutil.copytree(REPO_ROOT / SCRIPTS_COPY, root / SCRIPTS_COPY, ignore=ignored)
    (parent / "driver.py").write_bytes(DRIVER.encode("utf-8"))
    pages = _corpus()
    for rel, text in pages.items():
        _write(root, rel, text)
    (root / HOOKS_STUB).mkdir()
    _git(root, "init", "-b", "main")
    for name, value in (("user.name", "fixture"), ("user.email", "fixture@example.invalid"), ("commit.gpgsign", "false")):
        _git(root, "config", name, value)
    _git(root, "config", "core.hooksPath", str(root / HOOKS_STUB))
    # By name, never `add -A`: the scripts copy sits in this tree too, gitignored on top.
    _git(root, "add", "--", *pages)
    _git(root, "commit", "-m", "Corpus: the branch scenarios start from here")
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
    _git(root, "reset", "-q", "HEAD", "--", ".")
    _git(root, "checkout", "HEAD", "--", ".")
    _git(root, "clean", "-fdxq", "-e", "/" + SCRIPTS_COPY, "-e", "/" + HOOKS_STUB)


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
    found = [tuple(finding) for finding in data["findings"]]
    return [f for f in found if check is None or f[1] == check]


def _read(rel: str) -> str:
    return (_root() / rel).read_text(encoding="utf-8")


def _replace(rel: str, old: str, new: str) -> None:
    text = _read(rel)
    assert old in text, "the corpus no longer carries " + repr(old) + " in " + rel
    _write(_root(), rel, text.replace(old, new, 1))


def _append(rel: str, *lines: str) -> None:
    _write(_root(), rel, _read(rel) + "\n" + "\n".join(lines) + "\n")


def _line_of(rel: str, text: str) -> int:
    return _read(rel).split("\n").index(text) + 1


def _bound_fail(rel: str, line: int, chars: int) -> tuple[str, str, str, str]:
    detail = f"the comment block at line {line} runs {chars} characters -- INC-9 caps a block at 250, every shape alike"
    return ("fail", "comment-length", rel, detail)


def _scope_report(missing: str) -> tuple[str, str, str, str]:
    return ("report", "branch-scope", BRANCH_DIFF, DIFF_READERS + " did not run: git could not " + missing)


LONG_BLOCK: Final[tuple[str, ...]] = tuple(HASH + " " + LONG_TEXT for _ in range(6))
LONG_CHARS: Final = len(" ".join([LONG_TEXT] * 6))


def test_a_clean_branch_arms_nothing_and_reports_nothing() -> None:
    """The committed over-bound block in the legacy module must stay silent while nothing touches it."""
    _reset()
    data = _run()
    assert data["fork"] is not None
    assert data["diffed"] == []
    assert data["additions"] == {}
    assert _findings(data) == []


def test_an_added_comment_citation_reports_the_review_reference_and_the_roadmap_id() -> None:
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
        ("report", "comment-citation", MOD, "review reference 'last session' in an added comment (INC-6, COR-1)"),
        ("report", "comment-citation", MOD, "roadmap id " + ROADMAP_ID + " in an added comment -- state the constraint (INC-6)"),
    ]


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
    assert _findings(data) == [_bound_fail(MOD, line, LONG_CHARS)]


def test_added_history_phrases_are_one_report_across_the_whole_diff() -> None:
    """A fenced markdown line carrying a phrase is outside the scanned body, so the count stays at the comment's and the prose line's."""
    fence = "`" * 3
    _reset()
    _append(MOD, HASH + " this previously lived elsewhere")
    _append(NOTES, "The page was renamed after the draw.", "", fence, "previously fenced text", fence)
    try:
        data = _run()
    finally:
        _reset()
    assert _findings(data) == [("report", "history", BRANCH_DIFF, "2 added line(s) match a COR-3 history phrase -- read them")]


def test_added_count_words_report_per_file() -> None:
    _reset()
    _append(NOTES, "The pages here number four.")
    _append(MOD, HASH + " it holds five constants")
    try:
        data = _run()
    finally:
        _reset()
    assert _findings(data) == [
        ("report", "counts", NOTES, "1 added line(s) name a count or an ordinal -- read them (COR-4)"),
        ("report", "counts", MOD, "1 added line(s) name a count or an ordinal -- read them (COR-4)"),
    ]


def test_a_prose_sha_reports_only_an_unresolvable_mixed_hex_run() -> None:
    """The digits-only run, the 9-character run and a resolvable prefix of HEAD all stay silent; one sha named twice is one finding."""
    _reset()
    head = _git(_root(), "rev-parse", "HEAD")
    resolvable = next((head[:n] for n in (8, 7) if any(c.isdigit() for c in head[:n]) and any(c.isalpha() for c in head[:n])), None)
    tick = "`"
    lines = [
        "The commit " + tick + "abc1234" + tick + " is named here.",
        "And " + tick + "abc1234" + tick + " is named again.",
        "A digits-only run: " + tick + "1234567" + tick + ".",
        "An asset digest: " + tick + "abcdef123" + tick + ".",
    ]
    if resolvable is not None:
        lines.append("A commit this clone holds: " + tick + resolvable + tick + ".")
    _append(NOTES, *lines)
    try:
        data = _run()
    finally:
        _reset()
    assert _findings(data) == [
        ("report", "sha", NOTES, "commit abc1234 resolves to nothing in this clone -- was it rewritten out of the history?")
    ]


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
        data = _run()
    finally:
        _reset()
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
    _write(root, FRESH, _page(QUOTES + "BACKEND · a module this branch wrote and never staged." + QUOTES, "", "VALUE = 1", "", *LONG_BLOCK))
    _write(root, IGNORED, _page(*LONG_BLOCK))
    _write(root, SKIPPED, _page(*LONG_BLOCK))
    _write(root, "notes-extra.txt", _page(*LONG_BLOCK))
    line = _line_of(FRESH, LONG_BLOCK[0])
    try:
        data = _run()
    finally:
        _reset()
    assert data["diffed"] == [FRESH]
    assert sorted(data["additions"]) == [FRESH]
    assert data["additions"][FRESH][-6:] == list(LONG_BLOCK)
    assert _findings(data) == [_bound_fail(FRESH, line, LONG_CHARS)]


def test_a_source_file_outside_the_incode_scopes_feeds_citations_and_not_the_bounds() -> None:
    """A shell file under nginx carries a source suffix the added-line checks read, while INC-9's scope list leaves it unmeasured."""
    _reset()
    _append(ENTRYPOINT, *LONG_BLOCK)
    _append(ENTRYPOINT, HASH + " drawn up in the last session")
    try:
        data = _run()
    finally:
        _reset()
    assert sorted(data["additions"]) == [ENTRYPOINT]
    assert _findings(data) == [("report", "comment-citation", ENTRYPOINT, "review reference 'last session' in an added comment (INC-6, COR-1)")]


def test_a_scanned_config_suffix_feeds_the_prose_checks_and_not_the_source_ones() -> None:
    """A toml comment is inside history's and counts' reach, and outside comment-citation's and the bounds'."""
    _reset()
    _append(TOML, HASH + " the table was renamed", HASH + " it holds four rows", HASH + " " + ROADMAP_ID + " sits here")
    try:
        data = _run()
    finally:
        _reset()
    assert sorted(data["additions"]) == [TOML]
    assert _findings(data) == [
        ("report", "history", BRANCH_DIFF, "1 added line(s) match a COR-3 history phrase -- read them"),
        ("report", "counts", TOML, "1 added line(s) name a count or an ordinal -- read them (COR-4)"),
    ]


def test_a_missing_base_ref_is_one_advisory_and_the_bounds_stay_silent() -> None:
    """The prose-sha check still reports, reading the corpus rather than the diff; the planted block and phrase go unread."""
    tick = "`"
    _reset()
    _append(MOD, *LONG_BLOCK, HASH + " this previously lived elsewhere")
    _append(NOTES, "The commit " + tick + "abc1234" + tick + " is named here.")
    _git(_root(), "branch", "-m", "main", "trunk")
    try:
        data = _run()
    finally:
        _git(_root(), "branch", "-m", "trunk", "main")
        _reset()
    assert data["fork"] is None
    assert data["diffed"] is None
    assert data["additions"] == {}
    assert _findings(data) == [
        _scope_report("resolve main to a commit this branch forked from"),
        ("report", "sha", NOTES, "commit abc1234 resolves to nothing in this clone -- was it rewritten out of the history?"),
    ]


def test_an_unreadable_fork_is_the_other_advisory_arm() -> None:
    """A fork commit git cannot diff degrades every diff reader together, in one sentence."""
    _reset()
    _append(MOD, *LONG_BLOCK)
    try:
        data = _run(fork="0" * 40)
    finally:
        _reset()
    assert data["diffed"] is None
    assert data["additions"] == {}
    assert _findings(data) == [_scope_report("read this branch's diff")]


def test_an_older_over_bound_block_edited_in_place_stays_exempt() -> None:
    """The fork text identifies the committed block by its opening line.

    An edit inside that block fails nothing, while a block newly added beside it still does.
    """
    _reset()
    _replace(LEGACY, "amends", "adjusts")
    data = _run()
    assert _findings(data, "comment-length") == []
    _append(LEGACY, *LONG_BLOCK)
    line = _line_of(LEGACY, LONG_BLOCK[0])
    try:
        data = _run()
    finally:
        _reset()
    assert _findings(data, "comment-length") == [_bound_fail(LEGACY, line, LONG_CHARS)]


def test_a_committed_addition_reads_the_same_as_a_working_tree_one() -> None:
    """The diff runs from the fork to the working tree, so a commit on the branch changes nothing."""
    _reset()
    root = _root()
    _git(root, "checkout", "-q", "-b", "work")
    _append(MOD, HASH + " " + ROADMAP_ID + " says so")
    _git(root, "add", "--", MOD)
    _git(root, "commit", "-q", "-m", "Scenario: one committed comment")
    try:
        data = _run()
    finally:
        _git(root, "checkout", "-q", "-f", "main")
        _git(root, "branch", "-q", "-D", "work")
        _reset()
    assert data["diffed"] == [MOD]
    assert _findings(data) == [
        ("report", "comment-citation", MOD, "roadmap id " + ROADMAP_ID + " in an added comment -- state the constraint (INC-6)")
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
