"""SCRIPTS · the branch-scoped checks' scenario net

`scripts/checks/docs_gate/branch.py` reads the branch's diff against its base, so a run over a clean
tree arms almost none of it. Each scenario here shapes one synthetic branch state in a throwaway
repository holding a copy of scripts/, and asserts what armed and what fired. A subprocess does
the reading: the gate derives its repository root from its own file, and importing a copy
in-process would collide with `scripts/tests/test_check_docs.py`'s copy over one module name.
"""

from __future__ import annotations

import json
import stat
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
MOVED: Final = "fl_backend/app/moved.py"
EMBEDDED: Final = "fl_backend/app/embedded.py"
TWIN: Final = "fl_backend/app/twin.py"
TWINNED: Final = "fl_backend/app/twinned.py"
OTHER: Final = "fl_backend/app/other.py"
STYLES: Final = "fl_frontend/src/styles.css"
# Empty, and last in `ls-tree -r` order, so the batch the fork pool splits closes on a header line
# with nothing under it. The scenario reading it asserts that position rather than assuming it.
TAIL: Final = "tail.sh"
# The document INC-4's exemption is taken from, and the tree the second listing is read out of.
OPENAPI: Final = "fl_backend/openapi.json"
NOTES: Final = "docs/notes.md"
SPARE: Final = "docs/spare.md"
BACKEND_SPEC: Final = "docs/backend/spec.md"
FRONTEND_SPEC: Final = "docs/frontend/spec.md"
# The one sheet the `L` band belongs to (OUT-4), so a scenario reaching that band has a sheet to add to.
LOGGING_SPEC: Final = "docs/logging/spec.md"
# Where a scenario moves the frontend sheet: still a spec sheet, under a folder the fork holds none in.
MOVED_SPEC: Final = "docs/ui/spec.md"
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
# The issue shape INC-6 bars, and three runs shaped like it that name no issue: an HTML entity, a
# page anchor, and the ban's own form quoted to name it.
ISSUE_REF: Final = HASH + "412"
# The cross-repository spelling INC-6 names, which a word before the hash would let through.
QUALIFIED_ISSUE: Final = "owner/repo" + ISSUE_REF
ENTITY: Final = "&" + HASH + "39;"
ANCHOR: Final = "docs/backend/spec.md" + HASH + "2-invariants"
QUOTED_BAN: Final = '"closes ' + HASH + '12"'
# Three spellings of one number, each an issue number outside a stylesheet: the form GitHub appends
# to a squash subject, the terminated one, and the one a comment marks up as code.
PAREN_ISSUE: Final = "(" + ISSUE_REF + ")"
TERMINATED_ISSUE: Final = ISSUE_REF + ";"
BACKTICKED_ISSUE: Final = "`" + ISSUE_REF + "`"
# Two runs carrying the shape and pointing at a location: a URL's fragment, and a numeric anchor
# into a page, which the hyphenated slug's lookahead does not reach.
URL_FRAGMENT: Final = "https://example.com/page" + HASH + "12"
NUMBERED_ANCHOR: Final = BACKEND_SPEC + HASH + "3"
# A hex colour, whose digits-only spelling is the one shape a stylesheet writes that reads as an
# issue number. The two closers are what a rule declaration and a colour function put after it.
HEX: Final = HASH + "000"
# The same colour as INC-6 has a module write it, the quotes being all that parts it from a tracker.
QUOTED_HEX: Final = '"' + HEX + '"'
# The number both fixture sheets define at the fork: the shape of the low band the real sheets
# share, which OUT-4's allocation rule leaves standing.
SHARED_ID: Final = "I1"
BACKEND_ID: Final = "I2"
FRONTEND_ID: Final = "I3"
# The ceiling the band reaches at the fork, then the two numbers a branch adding two rows takes and
# the one past them.
HIGH_ID: Final = "I17"
FREE_ID: Final = "I18"
SECOND_ID: Final = "I19"
GAPPED_ID: Final = "I20"
# Under the ceiling and defined by no sheet, which is the shape a number allocated and never filled
# leaves behind: no collision arm can see one.
HOLE_ID: Final = "I5"
# Neither sheet holds it at the fork, so only the branch's own rows can catch the second one.
RACED_ID: Final = "I9"
# Far below the other band's ceiling on purpose: a run computed from the wrong band then names a
# number no correct allocation could reach, so conflating the two fails loudly rather than by a
# near miss.
LOG_LOW_ID: Final = "L1"
LOG_HIGH_ID: Final = "L4"
LOG_FREE_ID: Final = "L5"
LOG_GAPPED_ID: Final = "L6"
# A row of the invariant table's shape in neither band, which a reader widened past the two would
# take and allocate against.
OTHER_BAND_ID: Final = "X1"
DROPPABLE: Final = "A droppable line the deletion scenario removes."
LONG_TEXT: Final = "a line of a block that runs past what a comment may hold"
# A run no comment reader finds in its own file, the `.py` tokenizer reading it as a string: only a
# batch split at the wrong offset, which reads every blob as shell, turns it into an ancestor.
SPURIOUS_TEXT: Final = "a line of a shell snippet a module keeps as a string rather than as prose"
SPURIOUS_BLOCK: Final[tuple[str, ...]] = tuple(HASH + " " + SPURIOUS_TEXT for _ in range(3))
SPURIOUS_WORDS: Final = len(" ".join([SPURIOUS_TEXT] * 3).split())
# The block one fixture module carries twice over, so its earlier self is two identical pool entries.
TWIN_TEXT: Final = "a line of the block a module carries word for word twice over, in two runs"
TWIN_BLOCK: Final[tuple[str, ...]] = tuple(HASH + " " + TWIN_TEXT for _ in range(3))
TWIN_WORDS: Final = len(" ".join([TWIN_TEXT] * 3).split())
# A block only this branch writes: five of the twin's line, so it matches the pair the fixture
# module carries and runs to well past what either of them does.
WIDE_BLOCK: Final[tuple[str, ...]] = tuple(HASH + " " + TWIN_TEXT for _ in range(5))
WIDE_WORDS: Final = len(" ".join([TWIN_TEXT] * 5).split())
# git reads a rename by how much of the source survives in the destination, so bulk the fork never
# held is what hides one. The case asserts git missed it rather than trusting this count.
REWRITE_TEXT: Final = "a distinct line the rewrite adds, so too little of the twin survives for git to read a rename"
REWRITE_LINES: Final = 12
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
DIFF_READERS: Final = "history, added comment citations, added invariant rows and comment length"

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
    "check_added_invariant_rows": lambda: branch.check_added_invariant_rows(state, additions),
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


def _row(number: str, invariant: str) -> str:
    return "| " + number + " | " + invariant + " | Its own test |"


def _sheet(surface: str, *rows: str) -> str:
    """One spec sheet in OUT-4's four sections, holding the invariant rows it is given."""
    return _page(
        HASH + " " + surface + " — spec",
        "",
        "The contract this surface answers to.",
        "",
        HASH * 2 + " 1. Contract",
        "",
        HASH * 3 + " 1.1 The one path",
        "",
        "It answers once.",
        "",
        HASH * 2 + " 2. Invariants",
        "",
        "| ID | Invariant | Enforced by |",
        "| --- | --- | --- |",
        *rows,
        "",
        HASH * 2 + " 3. Violation → remedy",
        "",
        "| Symptom | Remedy |",
        "| --- | --- |",
        "| A value nothing names | Name it |",
        "",
        HASH * 2 + " 4. Known-open",
        "",
        "Nothing is open.",
    )


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
        BACKEND_SPEC: _sheet(
            "Backend",
            _row(SHARED_ID, "The write path validates its input"),
            _row(BACKEND_ID, "One document comes back"),
            _row(HIGH_ID, "The number the band has reached"),
        ),
        FRONTEND_SPEC: _sheet("Frontend", _row(SHARED_ID, "A route names its own data"), _row(FRONTEND_ID, "One page renders")),
        LOGGING_SPEC: _sheet(
            "Logging",
            _row(LOG_LOW_ID, "One JSON document per line"),
            _row(LOG_HIGH_ID, "The number the logging band has reached"),
        ),
        MOD: _module("a module the scenarios write comments into."),
        SIDE: _module("a module kept beside the first, so per-file answers separate."),
        EMBEDDED: _page(
            QUOTES + "BACKEND · a module keeping a shell snippet where no comment reader may find one." + QUOTES,
            "",
            "SNIPPET = " + QUOTES,
            *SPURIOUS_BLOCK,
            QUOTES,
        ),
        TWIN: _page(
            QUOTES + "BACKEND · a module whose committed block is written out twice over." + QUOTES,
            "",
            "VALUE = 1",
            "",
            *TWIN_BLOCK,
            "",
            *TWIN_BLOCK,
        ),
        STYLES: _page("/* A stylesheet the scenarios write comments into. */", "", ".card {", "  color: " + HEX + ";", "}"),
        TAIL: "",
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


MIXED_FORM_TRIES: Final = 60


def _mix_the_short_form(root: Path) -> None:
    """Amend until HEAD's short form carries a digit and a letter both.

    One commit's own does only by chance, and the sha scenario needs one that does; amending moves
    the hash and leaves the tree alone.
    """
    for attempt in range(MIXED_FORM_TRIES):
        short = git(root, "rev-parse", "HEAD")[:7]
        if any(c.isdigit() for c in short) and any(c.isalpha() for c in short):
            return
        # The author date, the one field a commit takes from an argument rather than from the clock:
        # a second amend inside one second is otherwise the same commit and the loop never ends.
        git(root, "commit", "--amend", "--no-edit", "--date", "2026-01-01T00:00:" + str(attempt).rjust(2, "0") + "+00:00")
    raise AssertionError("no amend of the corpus commit in " + str(MIXED_FORM_TRIES) + " gave it a mixed short form")


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
    _mix_the_short_form(root)
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


# What the pool's own refusal names, spelled here for `DIFF_READERS`' reason. The pool is a second
# read one check makes, so it degrades alone rather than with the diff its siblings share.
POOL_READER: Final = "comment length"


def _pool_refusal() -> tuple[str, str, str, str]:
    missing = " did not run: git could not read the blocks the fork's tree held over the bound"
    return ("fail", "branch-scope", BRANCH_DIFF, POOL_READER + missing)


LONG_BLOCK: Final[tuple[str, ...]] = tuple(HASH + " " + LONG_TEXT for _ in range(6))
LONG_WORDS: Final = len(" ".join([LONG_TEXT] * 6).split())

# The committed over-bound block, as the fixture spells it and as the ceiling scenarios move it.
LEGACY_LINES: Final[tuple[str, ...]] = (LEGACY_OPEN, LEGACY_MID, LEGACY_END)
LEGACY_BLOCK: Final[tuple[str, ...]] = tuple(HASH + " " + line for line in LEGACY_LINES)
LEGACY_WORDS: Final = len(" ".join(LEGACY_LINES).split())

# One of that block's three lines under two the fork never held, and short of the words the legacy
# block runs to: the shape a ceiling keyed on any single shared line waves through.
PADDED_FIRST: Final = "a fresh line the padded block writes, sharing nothing with any block the fork committed"
PADDED_SECOND: Final = "a second fresh line of the padded block, so its own lines outnumber the one it shares"
PADDED_LINES: Final[tuple[str, ...]] = (LEGACY_OPEN, PADDED_FIRST, PADDED_SECOND)
PADDED_BLOCK: Final[tuple[str, ...]] = tuple(HASH + " " + line for line in PADDED_LINES)
PADDED_WORDS: Final = len(" ".join(PADDED_LINES).split())

# The same shape padded with a line of its OWN, written twice: a repeat shrinks the denominator,
# so this block matches the legacy one and misses it under a count of raw lines.
REPEATED_LINE: Final = "a line the repeating block writes twice, sharing nothing with any block the fork committed"
REPEATED_LINES: Final[tuple[str, ...]] = (LEGACY_OPEN, REPEATED_LINE, REPEATED_LINE)
REPEATED_BLOCK: Final[tuple[str, ...]] = tuple(HASH + " " + line for line in REPEATED_LINES)
REPEATED_WORDS: Final = len(" ".join(REPEATED_LINES).split())


def _shared_fail(rel: str, words: int, charged: int, ceiling: int) -> tuple[str, str, str, str]:
    detail = (
        f"the comment block runs {words} words, and the blocks matching its earlier self run {charged} together,"
        f" up from {ceiling} where the branch forked -- INC-9 lets neither number rise"
    )
    return ("fail", "comment-length", rel, detail)


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


def test_an_added_comment_citation_fails_on_the_issue_number_too() -> None:
    """INC-6 bars five families and this is the fifth: a tracker sitting outside this history."""
    _reset()
    _append(MOD, HASH + " " + ISSUE_REF + " explains the shape")
    try:
        data = _run()
    finally:
        _reset()
    assert MOD in data["additions"]
    assert _findings(data) == [
        ("fail", "comment-citation", MOD, "issue number " + ISSUE_REF + " in an added comment -- state the constraint (INC-6)")
    ]


def _issue_fail(rel: str) -> tuple[str, str, str, str]:
    return ("fail", "comment-citation", rel, "issue number " + ISSUE_REF + " in an added comment -- state the constraint (INC-6)")


def test_a_cross_repository_issue_reference_is_read_as_an_issue_number() -> None:
    """A word before the hash is INC-6's qualified form rather than any citation COR-6 admits.

    Alone in its scenario: a second shape carrying the same number would raise this finding for it.
    """
    _reset()
    _append(MOD, HASH + " " + QUALIFIED_ISSUE + " explains the shape")
    try:
        data = _run()
    finally:
        _reset()
    assert MOD in data["additions"]
    assert _findings(data) == [_issue_fail(MOD)]


def test_an_issue_number_inside_a_one_line_docstring_is_read_too() -> None:
    """A one-line docstring opens and closes on a quoted span, so a span filter eats the whole of it.

    Alone in its scenario, for the case above's reason.
    """
    _reset()
    _append(MOD, "", "def read():", "    " + QUOTES + "The shape " + ISSUE_REF + " asks for." + QUOTES, "    return VALUE")
    try:
        data = _run()
    finally:
        _reset()
    assert MOD in data["additions"]
    assert _findings(data) == [_issue_fail(MOD)]


def test_a_closer_or_a_backtick_after_the_number_leaves_it_an_issue_number() -> None:
    """The three spellings the colour exemption spared while it keyed on punctuation.

    One finding between them: the check reports the number rather than each run carrying it.
    """
    _reset()
    _append(MOD, HASH + " " + PAREN_ISSUE + " and " + TERMINATED_ISSUE + " and " + BACKTICKED_ISSUE)
    try:
        data = _run()
    finally:
        _reset()
    assert MOD in data["additions"]
    assert _findings(data) == [_issue_fail(MOD)]


def test_a_hex_colour_in_a_stylesheet_comment_names_no_issue() -> None:
    """A colour is the run's other innocent spelling, and a stylesheet is where it is written.

    The review reference beside it is the evidence the check read the file at all.
    """
    _reset()
    _append(STYLES, "/* the disabled swatch stays " + HEX + "; and the focus ring darkens to " + HEX + ") beside it */")
    _append(STYLES, "/* drawn up in the last session */")
    try:
        data = _run()
    finally:
        _reset()
    assert STYLES in data["additions"]
    assert _findings(data) == [("fail", "comment-citation", STYLES, "review reference 'last session' in an added comment (INC-6, COR-1)")]


def test_a_hex_colour_in_a_module_comment_is_an_issue_number_until_it_is_quoted() -> None:
    """The exemption above is the stylesheet's alone, so the same colour named in a module reports.

    The second run is the spelling INC-6 sends that writer to, and the first is what makes the
    quotes load-bearing rather than decorative.
    """
    _reset()
    try:
        _append(MOD, HASH + " the swatch stays " + HEX + " while the theme holds")
        bare = _run()
        _reset()
        _append(MOD, HASH + " the swatch stays " + QUOTED_HEX + " while the theme holds")
        # The review reference beside it is the evidence the check read the file at all.
        _append(MOD, HASH + " drawn up in the last session")
        quoted = _run()
    finally:
        _reset()
    assert MOD in bare["additions"]
    colour = "issue number " + HEX + " in an added comment -- state the constraint (INC-6)"
    assert _findings(bare) == [("fail", "comment-citation", MOD, colour)]
    assert _findings(quoted) == [("fail", "comment-citation", MOD, "review reference 'last session' in an added comment (INC-6, COR-1)")]


def test_a_hash_shaped_run_that_names_no_issue_stays_silent() -> None:
    """An HTML entity, a page anchor and the ban quoted to name it each carry the shape and no issue.

    The quoted run is what lets a file documenting the ban spell the very form it bans.
    """
    _reset()
    _append(MOD, HASH + " " + ENTITY + " and " + ANCHOR + " and " + HASH + "2-invariants and " + QUOTED_BAN)
    # The review reference beside them is the evidence the check read the file at all.
    _append(MOD, HASH + " drawn up in the last session")
    try:
        data = _run()
    finally:
        _reset()
    assert MOD in data["additions"]
    assert _findings(data) == [("fail", "comment-citation", MOD, "review reference 'last session' in an added comment (INC-6, COR-1)")]


def test_a_url_fragment_and_a_numbered_anchor_point_at_a_location_rather_than_an_issue() -> None:
    """The run in front decides: a scheme makes a fragment, a corpus suffix makes a page anchor.

    Neither carries the hyphen the slug spelling is held out by, so the shape alone reads both as
    issue numbers.
    """
    _reset()
    _append(MOD, HASH + " " + URL_FRAGMENT + " and " + NUMBERED_ANCHOR + " point into a page")
    # The review reference beside them is the evidence the check read the file at all.
    _append(MOD, HASH + " drawn up in the last session")
    try:
        data = _run()
    finally:
        _reset()
    assert MOD in data["additions"]
    assert _findings(data) == [("fail", "comment-citation", MOD, "review reference 'last session' in an added comment (INC-6, COR-1)")]


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


def _number_fail(rel: str, number: str, *homes: str) -> tuple[str, str, str, str]:
    named = ", ".join("`" + home + "`" for home in homes)
    detail = number + " is defined by " + named + " already -- OUT-4 takes one past the highest number any sheet defines"
    return ("fail", "invariant-number", rel, detail)


def _outside_fail(rel: str, number: str, span: str, ceiling: str = HIGH_ID) -> tuple[str, str, str, str]:
    detail = (
        number + " is outside " + span + " -- OUT-4 allocates from one past " + ceiling + ", the highest number any sheet defines at the fork"
    )
    return ("fail", "invariant-number", rel, detail)


def test_an_added_invariant_row_taking_another_sheet_s_number_fails_and_the_move_clears_it() -> None:
    """OUT-4's allocation rule reaches the branch that breaks it, at the row rather than at a citation.

    The second run is the repair the finding asks for: the same row under a number no sheet defines.
    """
    _reset()
    kept = _row(FRONTEND_ID, "One page renders")
    try:
        _replace(FRONTEND_SPEC, kept, kept + "\n" + _row(BACKEND_ID, "A row reaching for a number the other sheet holds"))
        collided = _run()
        _reset()
        _replace(FRONTEND_SPEC, kept, kept + "\n" + _row(FREE_ID, "A row reaching for a number no sheet holds"))
        moved = _run()
    finally:
        _reset()
    assert FRONTEND_SPEC in collided["additions"]
    assert _findings(collided) == [_number_fail(FRONTEND_SPEC, BACKEND_ID, BACKEND_SPEC)]
    assert FRONTEND_SPEC in moved["additions"]
    assert _findings(moved) == []


def test_a_number_this_sheet_defined_at_the_fork_stays_silent_when_its_row_is_rewritten() -> None:
    """A reflowed or reordered row arrives as an addition, and the shared band is not the branch's.

    The second run is the evidence the check armed here: the same row under the other sheet's own
    number fails.
    """
    _reset()
    shared = _row(SHARED_ID, "A route names its own data")
    try:
        _replace(FRONTEND_SPEC, shared, _row(SHARED_ID, "A route names the data it renders"))
        rewritten = _run()
        _reset()
        _replace(FRONTEND_SPEC, shared, _row(BACKEND_ID, "A route names its own data"))
        renumbered = _run()
    finally:
        _reset()
    assert FRONTEND_SPEC in rewritten["additions"]
    assert _findings(rewritten) == []
    assert _findings(renumbered) == [_number_fail(FRONTEND_SPEC, BACKEND_ID, BACKEND_SPEC)]


def test_two_sheets_reaching_for_one_number_on_one_branch_each_name_the_other() -> None:
    """A number neither sheet held at the fork sits in no fork population, so only the branch's own rows catch it."""
    _reset()
    raced = _row(RACED_ID, "A number this branch reached for twice")
    backend_kept = _row(BACKEND_ID, "One document comes back")
    frontend_kept = _row(FRONTEND_ID, "One page renders")
    try:
        _replace(BACKEND_SPEC, backend_kept, backend_kept + "\n" + raced)
        _replace(FRONTEND_SPEC, frontend_kept, frontend_kept + "\n" + raced)
        data = _run()
    finally:
        _reset()
    assert _findings(data) == [
        _number_fail(BACKEND_SPEC, RACED_ID, FRONTEND_SPEC),
        _number_fail(FRONTEND_SPEC, RACED_ID, BACKEND_SPEC),
    ]


def test_an_added_row_skipping_a_number_fails_and_the_run_spans_both_sheets() -> None:
    """OUT-4's run is contiguous from one past the ceiling, so a skipped number is a gap.

    The second run is the repair, with the two rows on different sheets: one namespace across the
    surfaces (OUT-4).
    """
    _reset()
    kept = _row(FRONTEND_ID, "One page renders")
    backend_kept = _row(HIGH_ID, "The number the band has reached")
    try:
        added = kept + "\n" + _row(FREE_ID, "A row taking one past the ceiling") + "\n" + _row(GAPPED_ID, "A row skipping the number below it")
        _replace(FRONTEND_SPEC, kept, added)
        gapped = _run()
        _reset()
        _replace(FRONTEND_SPEC, kept, kept + "\n" + _row(FREE_ID, "A row taking one past the ceiling"))
        _replace(BACKEND_SPEC, backend_kept, backend_kept + "\n" + _row(SECOND_ID, "The second of the run, on the other sheet"))
        contiguous = _run()
    finally:
        _reset()
    assert _findings(gapped) == [_outside_fail(FRONTEND_SPEC, GAPPED_ID, FREE_ID + " to " + SECOND_ID)]
    assert sorted(contiguous["additions"]) == [BACKEND_SPEC, FRONTEND_SPEC]
    assert _findings(contiguous) == []


def test_an_added_row_reaching_below_the_ceiling_fails_where_no_sheet_defines_that_number() -> None:
    """A number the band passed over is allocated and never reused, so no collision arm sees it.

    The fork's sheets say where the band has reached, so the row under test is outside the
    population judging it (PRE-4).
    """
    _reset()
    kept = _row(FRONTEND_ID, "One page renders")
    try:
        _replace(FRONTEND_SPEC, kept, kept + "\n" + _row(HOLE_ID, "A row reaching for a number the band passed over"))
        data = _run()
    finally:
        _reset()
    assert FRONTEND_SPEC in data["additions"]
    assert _findings(data) == [_outside_fail(FRONTEND_SPEC, HOLE_ID, FREE_ID)]


def test_an_invariant_row_outside_the_fork_s_own_section_defines_nothing() -> None:
    """The fork's sheets are read as the corpus reads them, `## 2. Invariants` and nothing else.

    An unsectioned reader takes the remedy table's rows too, and every number a branch adds under
    one of them then reads as taken.
    """
    _reset()
    stray = _row(FREE_ID, "A row of the invariant shape under the remedy table")
    kept = _row(FRONTEND_ID, "One page renders")
    try:
        _replace(BACKEND_SPEC, "| A value nothing names | Name it |", "| A value nothing names | Name it |\n" + stray)
        git(_root(), "commit", "-aqm", "Corpus: a row of the invariant shape outside section 2")
        _replace(FRONTEND_SPEC, kept, kept + "\n" + _row(FREE_ID, "A row taking one past the ceiling"))
        data = _run()
    finally:
        git(_root(), "reset", "-q", "--soft", "HEAD~1")
        _reset()
    assert FRONTEND_SPEC in data["additions"]
    assert _findings(data) == []


def test_an_added_invariant_row_outside_this_sheet_s_own_section_allocates_nothing() -> None:
    """The added side is sectioned as the fork side is, so the two are one reader.

    Unsectioned it draws an allocation finding for a row the sheet's own table never defines.
    """
    _reset()
    stray = _row(GAPPED_ID, "A row of the invariant shape under the remedy table")
    kept = _row(FRONTEND_ID, "One page renders")
    try:
        _replace(FRONTEND_SPEC, "| A value nothing names | Name it |", "| A value nothing names | Name it |\n" + stray)
        outside = _run()
        _reset()
        _replace(FRONTEND_SPEC, kept, kept + "\n" + stray)
        inside = _run()
    finally:
        _reset()
    assert FRONTEND_SPEC in outside["additions"] and FRONTEND_SPEC in inside["additions"]
    assert _findings(outside) == []
    assert _findings(inside) == [_outside_fail(FRONTEND_SPEC, GAPPED_ID, FREE_ID)]


def test_an_added_logging_row_takes_one_past_the_logging_band_s_own_ceiling() -> None:
    """The second band allocates as the first does, against its own ceiling (OUT-4).

    The row of neither band rides in the passing run: a reader widened past the two bands allocates
    against it, and nothing else here would see that.
    """
    _reset()
    kept = _row(LOG_LOW_ID, "One JSON document per line")
    try:
        taken = _row(LOG_FREE_ID, "A row taking one past the logging ceiling")
        stray = _row(OTHER_BAND_ID, "A row of the table's shape in neither band")
        _replace(LOGGING_SPEC, kept, kept + "\n" + taken + "\n" + stray)
        allocated = _run()
        _reset()
        _replace(LOGGING_SPEC, kept, kept + "\n" + _row(LOG_GAPPED_ID, "A row skipping the number below it"))
        gapped = _run()
    finally:
        _reset()
    assert LOGGING_SPEC in allocated["additions"] and LOGGING_SPEC in gapped["additions"]
    assert _findings(allocated) == []
    assert _findings(gapped) == [_outside_fail(LOGGING_SPEC, LOG_GAPPED_ID, LOG_FREE_ID, LOG_HIGH_ID)]


def test_the_two_bands_allocate_independently_on_one_branch() -> None:
    """One ceiling across both bands would fill the run with the surface row and leave the logging row outside it (OUT-4)."""
    _reset()
    surface_kept = _row(FRONTEND_ID, "One page renders")
    logging_kept = _row(LOG_LOW_ID, "One JSON document per line")
    try:
        _replace(FRONTEND_SPEC, surface_kept, surface_kept + "\n" + _row(FREE_ID, "A row taking one past the surface ceiling"))
        _replace(LOGGING_SPEC, logging_kept, logging_kept + "\n" + _row(LOG_FREE_ID, "A row taking one past the logging ceiling"))
        together = _run()
    finally:
        _reset()
    assert sorted(together["additions"]) == [FRONTEND_SPEC, LOGGING_SPEC]
    assert _findings(together) == []


def test_a_sheet_git_cannot_read_as_a_rename_has_every_row_it_kept_charged_as_a_new_one() -> None:
    """The accepted cost, pinned rather than left for a rebase to discover.

    Additions come from the rename-detecting diff while the fork population is keyed on the fork's
    path, so a sheet rewritten past git's threshold has no earlier self.
    """
    _reset()
    root = _root()
    (root / MOVED_SPEC).parent.mkdir(parents=True)
    git(root, "mv", FRONTEND_SPEC, MOVED_SPEC)
    _append(MOVED_SPEC, *(REWRITE_TEXT + " " + str(number) for number in range(REWRITE_LINES)))
    try:
        status = git(root, "diff", "-M", "--name-status", "HEAD").split("\n")
        data = _run()
    finally:
        _reset()
    assert not [line for line in status if line.startswith("R")], "git read the rename after all, so this proves nothing: " + repr(status)
    assert _findings(data, "invariant-number") == [
        _number_fail(MOVED_SPEC, SHARED_ID, BACKEND_SPEC, FRONTEND_SPEC),
        _number_fail(MOVED_SPEC, FRONTEND_ID, FRONTEND_SPEC),
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

    A resolvable prefix fails beside the dangling one, COR-6 banning a commit SHA rather than a dead
    one.
    """
    _reset()
    resolvable = git(_root(), "rev-parse", "HEAD")[:7]
    # Asserted rather than assumed: `_mix_the_short_form` is what makes this hold, and without this
    # line a fixture that stopped doing so fails below on a findings mismatch that names nothing.
    assert any(c.isdigit() for c in resolvable) and any(c.isalpha() for c in resolvable), "the fixture's HEAD has no mixed short form"
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


def test_a_split_block_spends_its_earlier_self_s_ceiling_once_between_the_halves() -> None:
    """Two blocks as long as the one they came from are what a per-block ceiling waves through."""
    _reset()
    _replace(LEGACY, "\n".join(LEGACY_BLOCK), "\n".join(LEGACY_BLOCK) + "\n\n" + "\n".join(LEGACY_BLOCK))
    first = _line_of(LEGACY, LEGACY_BLOCK[0])
    try:
        data = _run()
    finally:
        _reset()
    charged = LEGACY_WORDS * 2
    # The half the diff leaves as context is charged and not reported: what the branch can fix is
    # the half it wrote (CUR-6).
    assert _findings(data, "comment-length") == [_shared_fail(LEGACY, LEGACY_WORDS, charged, LEGACY_WORDS)]
    assert _lines(data, "comment-length") == [first + len(LEGACY_BLOCK) + 1]


def test_a_block_copied_into_a_second_file_spends_no_part_of_the_first_s_ceiling() -> None:
    """The charge is summed per file, so a copy into a second file is the split this does NOT catch.

    Charging across files would fail a branch for a file it never opened, so the pair is
    `/docs:audit`'s (CUR-6).
    """
    _reset()
    _append(SIDE, *LEGACY_BLOCK)
    try:
        data = _run()
    finally:
        _reset()
    assert sorted(data["additions"]) == [SIDE]
    assert _findings(data, "comment-length") == []


def test_a_block_padded_with_one_borrowed_line_inherits_no_ceiling() -> None:
    """A moved or edited block shares most of itself; one line lifted from a legacy block is not that.

    Its total stays under the legacy block's own count, so any ceiling it inherits waves it through.
    """
    _reset()
    _append(SIDE, *PADDED_BLOCK)
    line = _line_of(SIDE, PADDED_BLOCK[0])
    try:
        data = _run()
    finally:
        _reset()
    assert PADDED_WORDS < LEGACY_WORDS, "the padded block outgrew the ceiling it must not reach"
    assert _findings(data, "comment-length") == [_bound_fail(SIDE, PADDED_WORDS)]
    assert _lines(data, "comment-length") == [line]


def test_a_block_repeating_one_of_its_own_lines_still_matches_the_block_it_came_from() -> None:
    """Silence is the assertion, which a checker counting raw lines breaks.

    A repeat gains nothing towards the half a match needs and costs nothing either: it shrinks
    the denominator, so the same overlap carries the block.
    """
    _reset()
    _append(SIDE, *REPEATED_BLOCK)
    try:
        data = _run()
    finally:
        _reset()
    assert LEGACY_WORDS >= REPEATED_WORDS > 40, "the repeating block sits outside the window the ceiling decides"
    assert _findings(data, "comment-length") == []


def test_a_second_copy_in_another_file_buys_a_new_block_no_ceiling() -> None:
    """A standing is the fork's copies in ONE file, so a pair it filed elsewhere doubles nothing here.

    Counted over the fork's whole tree the twin's pair would wave it through.
    """
    _reset()
    _append(SIDE, *WIDE_BLOCK)
    line = _line_of(SIDE, WIDE_BLOCK[0])
    try:
        data = _run()
    finally:
        _reset()
    detail = f"the comment block runs {WIDE_WORDS} words, up from {TWIN_WORDS} where the branch forked -- INC-9 lets neither number rise"
    assert _findings(data, "comment-length") == [("fail", "comment-length", SIDE, detail)]
    assert _lines(data, "comment-length") == [line]


def test_a_renamed_file_holding_two_identical_blocks_keeps_a_standing_for_each() -> None:
    """One ceiling for the pair would charge a rename that changed neither of them for both.

    Identical blocks are one value, so the fork's copies have to be counted rather than keyed.
    """
    _reset()
    root = _root()
    git(root, "mv", TWIN, TWINNED)
    try:
        # Read from the fixture: rename detection is on for `additions`, which leaves a pure rename
        # looking exactly like a clean tree there.
        touched = sorted(git(root, "diff", "--name-only", "--no-renames", "HEAD").splitlines())
        data = _run()
    finally:
        _reset()
    assert touched == [TWIN, TWINNED]
    assert _findings(data, "comment-length") == []


def test_a_deleted_copy_leaves_its_standing_behind_rather_than_lending_it_to_the_one_that_grew() -> None:
    """A standing the file has no copy for buys nothing, or one block spends what the pair was given.

    Counted on the fork's copies alone, deleting one and growing the other passes at a length no
    block here reaches.
    """
    _reset()
    _replace(TWIN, "\n".join(TWIN_BLOCK) + "\n\n" + "\n".join(TWIN_BLOCK), "\n".join((*TWIN_BLOCK, HASH + " " + ADDED_CLAUSE)))
    line = _line_of(TWIN, TWIN_BLOCK[0])
    try:
        data = _run()
    finally:
        _reset()
    grown = TWIN_WORDS + len(ADDED_CLAUSE.split())
    detail = f"the comment block runs {grown} words, up from {TWIN_WORDS} where the branch forked -- INC-9 lets neither number rise"
    assert _findings(data, "comment-length") == [("fail", "comment-length", TWIN, detail)]
    assert _lines(data, "comment-length") == [line]


def test_a_fresh_file_holding_the_fork_s_pair_inherits_one_standing_between_the_two() -> None:
    """A standing is the fork's copies in the file it filed them in, and no other file gets two.

    Counted per copy that arrived instead, a branch pastes the pair anywhere and passes.
    """
    _reset()
    body = _page(QUOTES + "BACKEND · the module the fork's pair is pasted into." + QUOTES, "", "VALUE = 1", "", *TWIN_BLOCK, "", *TWIN_BLOCK)
    write(_root(), FRESH, body)
    first = _line_of(FRESH, TWIN_BLOCK[0])
    try:
        data = _run()
    finally:
        _reset()
    charged = TWIN_WORDS * 2
    assert _findings(data, "comment-length") == [_shared_fail(FRESH, TWIN_WORDS, charged, TWIN_WORDS)] * 2
    assert _lines(data, "comment-length") == [first, first + len(TWIN_BLOCK) + 1]


def test_a_rename_git_reads_as_a_fresh_file_charges_its_pair_against_one_standing() -> None:
    """The cost the ceiling accepts: a rename git cannot read draws a finding its author repairs.

    A file carrying a duplicated over-bound block, rewritten past git's threshold, is what reaches it.
    """
    _reset()
    root = _root()
    git(root, "mv", TWIN, OTHER)
    _append(OTHER, "FILLER = (", *('    "' + REWRITE_TEXT + " " + str(n) + '",' for n in range(REWRITE_LINES)), ")")
    first = _line_of(OTHER, TWIN_BLOCK[0])
    try:
        status = git(root, "diff", "-M", "--name-status", "HEAD").split("\n")
        data = _run()
    finally:
        _reset()
    assert not [line for line in status if line.startswith("R")], "git read the rename after all, so this proves nothing: " + repr(status)
    charged = TWIN_WORDS * 2
    assert _findings(data, "comment-length") == [_shared_fail(OTHER, TWIN_WORDS, charged, TWIN_WORDS)] * 2
    assert _lines(data, "comment-length") == [first, first + len(TWIN_BLOCK) + 1]


def test_a_hash_run_a_string_holds_is_no_ancestor_when_the_fork_s_last_blob_is_empty() -> None:
    """An empty final blob closes the batch on its header, with no content line under it.

    Read at offset zero that record takes the whole batch, and every `#` line in it becomes an
    ancestor a new block can inherit.
    """
    _reset()
    listed = git(_root(), "ls-tree", "-r", "--name-only", "HEAD").splitlines()
    assert listed[-1] == TAIL, "a corpus file now sorts below the empty one, so this proves nothing"
    _append(MOD, *SPURIOUS_BLOCK)
    line = _line_of(MOD, SPURIOUS_BLOCK[0])
    try:
        data = _run()
    finally:
        _reset()
    assert _findings(data, "comment-length") == [_bound_fail(MOD, SPURIOUS_WORDS)]
    assert _lines(data, "comment-length") == [line]


def test_a_fork_blob_the_object_store_lost_is_refused_rather_than_read_as_no_ceilings() -> None:
    """An unreadable pool read as empty drops every ceiling and fails prose the fork carried.

    The diff still answers, so `check_branch_diff` cannot cover this: it degrades on the fork ref,
    and one blob is missing rather than the ref.
    """
    _reset()
    root = _root()
    _replace(LEGACY, "amends", "adjusts")
    oid = git(root, "rev-parse", "HEAD:" + MOD)
    loose = root / ".git" / "objects" / oid[:2] / oid[2:]
    kept = loose.read_bytes()
    try:
        # git writes a loose object read-only, which Windows will not unlink.
        loose.chmod(stat.S_IWRITE)
        loose.unlink()
        data = _run()
    finally:
        loose.write_bytes(kept)
        _reset()
    assert data["diffed"] == [LEGACY]
    assert _findings(data) == [_pool_refusal()]


def test_one_lost_fork_blob_is_one_refusal_however_many_files_the_branch_touched() -> None:
    """The pool is one cached read, so a second file repeating its refusal names nothing new.

    Two touched files, each carrying a block the pool would have had to answer for.
    """
    _reset()
    root = _root()
    _replace(LEGACY, "amends", "adjusts")
    _append(SIDE, *LONG_BLOCK)
    oid = git(root, "rev-parse", "HEAD:" + MOD)
    loose = root / ".git" / "objects" / oid[:2] / oid[2:]
    kept = loose.read_bytes()
    try:
        # git writes a loose object read-only, which Windows will not unlink.
        loose.chmod(stat.S_IWRITE)
        loose.unlink()
        data = _run()
    finally:
        loose.write_bytes(kept)
        _reset()
    assert data["diffed"] == [LEGACY, SIDE]
    assert _findings(data) == [_pool_refusal()]


def test_a_block_moved_to_a_path_the_fork_has_no_version_of_keeps_its_standing() -> None:
    """A pool drawn from the destination path alone would be empty, and the carried block would read as new."""
    _reset()
    root = _root()
    _replace(LEGACY, "\n" + "\n".join(LEGACY_BLOCK), "")
    write(root, FRESH, _page(QUOTES + "BACKEND · the module the block moved into." + QUOTES, "", "VALUE = 1", "", *LEGACY_BLOCK))
    try:
        data = _run()
    finally:
        _reset()
    # The source file leaves no addition behind, the move being a deletion there.
    assert sorted(data["additions"]) == [FRESH]
    assert _findings(data, "comment-length") == []


def test_a_renamed_file_s_carried_block_is_charged_beside_the_copy_added_next_to_it() -> None:
    """With rename detection on, the carried lines would arrive as context and spend none of the ceiling."""
    _reset()
    root = _root()
    git(root, "mv", LEGACY, MOVED)
    _append(MOVED, *LEGACY_BLOCK)
    first = _line_of(MOVED, LEGACY_BLOCK[0])
    try:
        data = _run()
    finally:
        _reset()
    charged = LEGACY_WORDS * 2
    assert _findings(data, "comment-length") == [_shared_fail(MOVED, LEGACY_WORDS, charged, LEGACY_WORDS)] * 2
    assert _lines(data, "comment-length") == [first, first + len(LEGACY_BLOCK) + 1]


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
