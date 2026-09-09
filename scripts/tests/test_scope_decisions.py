"""SCRIPTS · the scope check's DECISION layer, driven against a real branch.

The classifier has a suite of its own; what this one holds is everything after it -- which scopes a
diff asks for, which of those fail and which only report, and the listings a diff is read from at
all. The seam is a throwaway repository holding a copy of scripts/, whose REPO_ROOT derives from
its own location and so roots there.

A mutant that empties `check` has to fail here, and so has one that stops separating the images
finding from every other scope. Stdlib only, the type checker reading scripts/ with no environment.
"""

from __future__ import annotations

import ast
import functools
import importlib
import os
import re
import shutil
import sys
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Final

from conftest import REPO_ROOT, configure, copy_scripts, git, new_root, run_shell, withdraw, write, write_shell

# Not a skip condition, for `scripts/tests/test_exit_contract.py :: BASH`'s reason.
BASH: Final = shutil.which("bash")
SCRIPTS_COPY: Final = "scripts"

# Built, never spelled: a suppression written out in this file's own comments is one ruff reads and
# obeys, and the marker in a corpus string is exactly what the rule under test looks for.
HASH: Final = chr(35)
DIRECTIVE_TYPE: Final = HASH + " type: ignore[operator]"
DIRECTIVE_NOQA: Final = HASH + " noqa: PLR2004"
SHEBANG: Final = HASH + "!/usr/bin/env python3"

DOCKERFILE: Final = "fl_frontend/Dockerfile"
CONFIG_TS: Final = "fl_frontend/src/core/config.ts"
PYPROJECT: Final = "fl_backend/pyproject.toml"
PYTHON_VERSION: Final = "fl_backend/.python-version"
SAMPLE: Final = "fl_backend/app/sample.py"
ROUTES: Final = "fl_backend/app/api/routes.py"
TOOL: Final = "scripts/tool.py"

# A prose comment the TypeScript arm may drop, and a directive above the code that it may not: the
# parser proves both are comments, and only the second changes what the toolchain does.
CONFIG_TS_PROSE: Final = "// why the environment is read once here"
CONFIG_TS_DIRECTIVE: Final = "// @ts-expect-error the upstream types are wrong here"
CONFIG_TS_BODY: Final = CONFIG_TS_PROSE + "\n" + CONFIG_TS_DIRECTIVE + "\nexport const total = 3;\n"

SAMPLE_BODY: Final = (
    '"""A module."""' + "\n\n" + HASH + " why the total is held here\nTOTAL = 3\n\n\n"
    "def widen(value: int) -> int:\n    return value + TOTAL  " + DIRECTIVE_TYPE + "\n"
)
ROUTES_BODY: Final = '"""The routes."""\n\n\ndef list_teams() -> list[str]:\n    """Every team in the season."""\n    return []\n'
PYPROJECT_BODY: Final = (
    HASH + ' why the name is pinned\n[project]\nname = "fl-backend"\n\n[tool.pyright]\nstrict = true\n\n'
    "[tool.pytest.ini_options]\ntimeout = 30\n"
)

CORPUS: Final[dict[str, str]] = {
    DOCKERFILE: HASH + " the frontend image\nFROM node:26-slim\n",
    CONFIG_TS: CONFIG_TS_BODY,
    PYPROJECT: PYPROJECT_BODY,
    PYTHON_VERSION: "3.14\n",
    SAMPLE: SAMPLE_BODY,
    ROUTES: ROUTES_BODY,
    TOOL: '"""SCRIPTS - a helper."""\n\nLIMIT = 7  ' + DIRECTIVE_NOQA + "\n",
    ".gitignore": ".tmp-*/\n__pycache__/\n",
    "docs/x.md": "# A page\n\nProse.\n",
}


@dataclass(frozen=True)
class Fixture:
    """The checker as the fixture repository sees it: the copied module, and the root it resolves to."""

    scope: ModuleType
    root: Path


def _load() -> Fixture:
    root = new_root("check-scope-fixture-")
    copy_scripts(root / SCRIPTS_COPY)
    sys.path.insert(0, str(root / SCRIPTS_COPY / "checks"))
    withdraw("check_scope", "checker_kernel")
    try:
        module = importlib.import_module("check_scope")
    finally:
        sys.path.remove(str(root / SCRIPTS_COPY / "checks"))
        withdraw("check_scope", "checker_kernel")
    # The seam stated as an assertion: the checker derives its root from its own location, so
    # importing this copy is what points every listing below at the fixture instead of at us.
    assert Path(module.__file__ or "").resolve().parents[2] == root, "the checker under test is not the copy"
    # The kernel's own root, which is what every listing below is read against: importing the copy
    # decides it, and a kernel cached by another fixture would point them all at that tree instead.
    assert module.REPO_ROOT == root, "the checker under test reads another fixture's tree"

    # `ts_normalize.mjs` resolves TypeScript from fl_frontend/node_modules, which this root has
    # none of: unset, every `.ts` pair fails to parse and the whole arm reads as code for a reason
    # no case can see.
    os.environ["NODE_PATH"] = str(REPO_ROOT / "fl_frontend" / "node_modules")
    # Not a skip condition, for `BASH`'s reason: a machine that cannot run the classifier cannot
    # run the gate's frontend scope either. Driven both ways, so a classifier stuck on one answer
    # is caught as well as one that never ran.
    prose = CONFIG_TS_BODY.replace(CONFIG_TS_PROSE, "// reworded")
    code = CONFIG_TS_BODY.replace("total = 3", "total = 4")
    verdicts = module.typescript_same_many([(".ts", CONFIG_TS_BODY, prose), (".ts", CONFIG_TS_BODY, code)])
    assert verdicts == [True, False], "the TypeScript classifier did not run in this fixture: " + repr(verdicts)

    for rel, text in CORPUS.items():
        write(root, rel, text)
    configure(root, str(root / ".no-hooks"))
    # `add -A`, the copy of scripts/ included: left untracked it would reach every listing below as
    # a diff of its own, and every case would then read the checker's own source as the change.
    git(root, "add", "-A")
    git(root, "commit", "--no-verify", "-m", "Corpus: a branch that changed nothing")
    return Fixture(module, root)


_STATE: list[Fixture] = []


def _fixture() -> Fixture:
    if not _STATE:
        _STATE.append(_load())
    return _STATE[0]


def _reset() -> Fixture:
    """The corpus as committed, in the index and the working tree, with nothing left over.

    Every case opens with this rather than closing with it: a case that fails part way through
    would otherwise hand its leftovers to whichever case ran next.
    """
    fixture = _fixture()
    git(fixture.root, "reset", "-q", "HEAD", "--", ".")
    git(fixture.root, "checkout", "-f", "HEAD", "--", ".")
    git(fixture.root, "clean", "-fdq")
    return fixture


def _edit(rel: str, old: str, new: str) -> None:
    root = _fixture().root
    body = (root / rel).read_text(encoding="utf-8")
    assert old in body, rel + " does not carry " + repr(old)
    write(root, rel, body.replace(old, new))


def _run(ran: str) -> tuple[list[str], list[str]]:
    """`check` over the fixture's own diff: the failing details, then the advisory ones."""
    scope = _fixture().scope
    base = scope.resolve_base()
    assert base is not None, "the fixture repository has no main to measure against"
    findings = scope.check(base, {name for name in ran.split() if name})
    assert findings is not None, "the checker refused the fixture rather than judging it"
    return (
        [finding.detail for finding in findings if finding.severity == "fail"],
        [finding.detail for finding in findings if finding.severity != "fail"],
    )


# --- what fails, and what only reports ------------------------------------------------------------


def test_a_code_change_asks_for_every_scope_that_covers_it() -> None:
    """The whole check emptied out is a gate with no scope guard at all, and this is where that shows."""
    _reset()
    _edit(SAMPLE, "TOTAL = 3", "TOTAL = 4")
    failing, advisory = _run("")
    assert not failing, "a change reaching no image asked for a build: " + repr(failing)
    named = " ".join(advisory)
    for flag in ("--backend", "--db", "--docs"):
        assert flag in named, flag + " was not asked for: " + named


def test_a_typescript_comment_edit_is_read_as_comments_alone() -> None:
    """The case that fails when the classifier is not really running: unresolved, this file reads as code.

    `config.ts` maps to `images`, the one scope whose absence refuses a run, so a parser that
    answered nothing would refuse here rather than stay quiet.
    """
    _reset()
    _edit(CONFIG_TS, CONFIG_TS_PROSE, "// the environment is read once, here")
    failing, advisory = _run("docs format")
    assert not failing, "a comment edit asked for the image build: " + repr(failing)
    assert not [line for line in advisory if "--frontend" in line], "a comment edit asked for --frontend: " + repr(advisory)


def test_a_deleted_typescript_directive_is_not_a_comment_edit() -> None:
    """A parser proves the line is a comment; pyright, eslint and the compiler read it as an instruction.

    The refusal is restated in the TypeScript arm because the batch reaches the parser without the
    single dispatch that carries it for every other suffix.
    """
    _reset()
    _edit(CONFIG_TS, CONFIG_TS_DIRECTIVE + "\n", "")
    failing, _ = _run("docs format")
    assert len(failing) == 1, "a deleted toolchain directive read as a comment edit: " + repr(failing)
    assert CONFIG_TS in failing[0], failing[0]
    assert "--images" in failing[0], failing[0]


def test_the_image_refusal_names_only_the_files_that_ask_for_it() -> None:
    """One file in the diff cannot tell a narrowed list from the whole one, so this changes two."""
    _reset()
    _edit(DOCKERFILE, "node:26-slim", "node:27-slim")
    _edit(SAMPLE, "TOTAL = 3", "TOTAL = 4")
    failing, _ = _run("frontend backend db docs format")
    assert len(failing) == 1, "the image build did not refuse the run: " + repr(failing)
    assert DOCKERFILE in failing[0], failing[0]
    assert SAMPLE not in failing[0], "a file reaching no image was named as the reason: " + failing[0]
    # `images` is the one scope whose absence refuses a run, and this sentence is what an operator
    # re-runs from.
    assert "--images" in failing[0], failing[0]


def test_naming_the_image_build_clears_the_refusal() -> None:
    """Without this the case above could pass for a check that fails on everything."""
    _reset()
    _edit(DOCKERFILE, "node:26-slim", "node:27-slim")
    failing, _ = _run("frontend docs format images")
    assert not failing, repr(failing)


def test_a_comment_alone_asks_for_the_documentation_scopes_and_nothing_else() -> None:
    """A comment is still documentation, and it is exactly what the formatter reflows."""
    _reset()
    _edit(SAMPLE, "why the total is held here", "why the total is held here, at more length")
    named = " ".join(_run("")[1])
    assert "--docs" in named and "--format" in named, named
    failing, advisory = _run("docs format")
    assert not failing and not advisory, repr(failing) + repr(advisory)


def test_a_scope_the_mapping_grows_and_the_check_does_not_is_reported() -> None:
    """A scope emitted into silence is a surface nobody is told about, the one drift a second list can cause."""
    fixture = _reset()
    mapping = fixture.root / SCRIPTS_COPY / "gate" / "scope_map.sh"
    kept = mapping.read_bytes()
    try:
        mapping.write_bytes(kept + b"\nprintf 'moon=true\\n'\n")
        _edit(SAMPLE, "TOTAL = 3", "TOTAL = 4")
        _, advisory = _run(" ".join(fixture.scope.SCOPES))
        assert any("moon" in detail for detail in advisory), repr(advisory)
    finally:
        mapping.write_bytes(kept)


# --- the listings a diff is read from ---------------------------------------------------------------


def test_a_rename_keeps_the_scopes_its_source_path_selected() -> None:
    """Rename detection prints the destination alone, and the image build would go with the old name."""
    fixture = _reset()
    git(fixture.root, "mv", DOCKERFILE, DOCKERFILE + ".old")
    failing, _ = _run("frontend docs format")
    assert failing and DOCKERFILE in failing[0], repr(failing)


def test_a_change_held_in_the_index_alone_is_seen() -> None:
    """`git diff <base>` never reads the index, and the index is what `git commit` commits."""
    fixture = _reset()
    _edit(SAMPLE, "TOTAL = 3", "TOTAL = 4")
    git(fixture.root, "add", "--", SAMPLE)
    # --worktree alone: `git checkout HEAD -- <path>` would restore the index too and unstage it.
    git(fixture.root, "restore", "--source=HEAD", "--worktree", "--", SAMPLE)
    _, advisory = _run("")
    assert any("--backend" in detail for detail in advisory), repr(advisory)


def test_a_file_named_like_a_throwaway_directory_still_selects_a_scope() -> None:
    """`.gitignore` skips `.tmp-*/`; a path the mapping skips selects nothing at all."""
    fixture = _reset()
    write(fixture.root, ".tmp-config.py", "SETTING = 1\n")
    failing, _ = _run("")
    assert failing, "an untracked .tmp- FILE asked for no scope"


def test_a_throwaway_directory_is_still_skipped() -> None:
    """The other half of that arm: a leftover from an interrupted run is litter, not a change."""
    fixture = _reset()
    write(fixture.root, ".tmp-gate/x.py", "X = 1\n")
    failing, advisory = _run("")
    assert not failing and not advisory, repr(failing) + repr(advisory)


# --- the comments a tool reads ----------------------------------------------------------------------

# A loop, not parametrize, for `scripts/tests/conftest.py`'s pytest invariant.
DIRECTIVE_PAIRS: Final[tuple[tuple[str, str, str], ...]] = (
    ("a suppression deleted", "x = 1  " + DIRECTIVE_TYPE, "x = 1"),
    ("a suppression added", "x = 1", "x = 1  " + DIRECTIVE_NOQA),
    ("a file-wide suppression added", "x = 1", HASH + " ruff: noqa\nx = 1"),
    ("an interpreter swapped", SHEBANG + "\nx = 1", SHEBANG.replace("python3", "python2") + "\nx = 1"),
    ("a type suppression swapped", "// @ts-expect-error why\nx;", "// @ts-ignore why\nx;"),
    ("a lint suppression deleted", "// eslint-disable-next-line no-eval\nx;", "x;"),
    ("a formatter suppression deleted", "// prettier-ignore\nx;", "x;"),
    # The same set of comments over a different line: a per-line suppression follows its line.
    ("a suppression moved", "x = f()  " + DIRECTIVE_TYPE + "\ny = g()\n", "x = f()\ny = g()  " + DIRECTIVE_TYPE + "\n"),
)


def test_a_toolchain_directive_is_never_inert() -> None:
    """A parser proves these hunks comment-only; pyright, ruff, eslint and the OS loader all read them."""
    scope = _fixture().scope
    missed = [name for name, old, new in DIRECTIVE_PAIRS if not scope.directives_differ(old, new)]
    assert not missed, "read as comments alone: " + ", ".join(missed)


def test_prose_beside_a_directive_is_still_a_comment() -> None:
    """The rule reads the line a directive sits on, so an ordinary comment must not trip it."""
    scope = _fixture().scope
    assert scope.directives_differ(HASH + " why the total is held here\nx = 1", HASH + " why, at more length\nx = 1") is False


def test_a_published_docstring_is_not_a_comment() -> None:
    """FastAPI serves an endpoint's docstring as the OpenAPI description, so openapi.json goes stale with it."""
    _reset()
    _edit(ROUTES, "Every team in the season.", "Only the teams that paid.")
    _, advisory = _run("docs format")
    assert any("--backend" in detail for detail in advisory), repr(advisory)


def test_a_docstring_outside_the_published_tree_is_a_comment() -> None:
    """The carve-out is a path, not a language: elsewhere a docstring is prose like any other."""
    _reset()
    _edit(TOOL, "SCRIPTS - a helper.", "SCRIPTS - a helper, described again.")
    failing, advisory = _run("docs format")
    assert not failing and not advisory, repr(failing) + repr(advisory)


# --- the parsers themselves --------------------------------------------------------------------------

RETYPED: Final[tuple[tuple[str, str, str], ...]] = (
    ("a boolean written as an integer", "strict = true", "strict = 1"),
    ("an integer written as a float", "timeout = 30", "timeout = 30.0"),
)


def test_a_retyped_toml_value_is_a_change() -> None:
    """python grades True == 1 and 30 == 30.0 as equal, and this file selects the image build."""
    missed: list[str] = []
    for name, old, new in RETYPED:
        _reset()
        _edit(PYPROJECT, old, new)
        if not _run("docs format")[0]:
            missed.append(name)
    assert not missed, "read as comments alone: " + ", ".join(missed)


# --- the mapping this check reads --------------------------------------------------------------------

SELECTED: Final[tuple[tuple[str, tuple[str, ...]], ...]] = (
    # Not in fl_backend/.dockerignore, so COPY . . carries it to where uv sync --frozen reads it.
    (PYTHON_VERSION, ("images", "backend", "db", "docs")),
    # scripts/ruff.toml extends this file, and the gate's own ruff comes out of the venv it pins.
    (PYPROJECT, ("scripts", "images", "backend", "db", "docs")),
    # The docs gate's line-endings check and its binary-byte exemption both read .gitattributes.
    (".gitattributes", ("scripts", "docs")),
    # .gitignore decides which paths that same gate scans, and which citations it excuses.
    (".gitignore", ("docs",)),
    # The documentation gate resolves the asset paths NOTICE names, and nothing else reads the file.
    ("NOTICE", ("docs",)),
    # `scripts/gate/selfcheck.sh` compares this file's uv tag against the manifest's pin, and runs
    # in the scripts scope alone; a bot's base-image bump touches this file and nothing else.
    ("fl_backend/Dockerfile", ("images", "docs", "scripts")),
    # `COPY . .` is what reads this file, so the image and the comments in it are all an edit here
    # can reach; the `scripts` scope the Dockerfile beside it takes is the uv comparison's.
    ("fl_backend/.dockerignore", ("images", "docs")),
    # `scripts/tests/test_check_gate_budget.py` parses this table itself and drives every budgeted
    # row red and green, so an edit to it is proved in the scripts scope and nowhere else.
    (".github/gate-wall-clock.tsv", ("scripts", "docs")),
)


def test_a_path_selects_every_scope_that_would_check_it() -> None:
    """A file governing a scope it does not select is a change that runs everything but its own check."""
    scope = _fixture().scope
    missed: list[str] = []
    for path, wanted in SELECTED:
        answered = scope.scope_map([path])
        assert answered is not None, "scripts/gate/scope_map.sh could not be run"
        missed += [path + " selected no " + name for name in wanted if not answered.get(name)]
    assert not missed, "\n".join(missed)


def test_the_notice_file_selects_the_documentation_scope_and_nothing_else() -> None:
    """`SELECTED` reads its scopes as a subset, so a scope left true fails nothing there.

    An arm that stopped matching would turn every scope on through the conservative default, and
    only a set comparison catches that.
    """
    scope = _fixture().scope
    answered = scope.scope_map(["NOTICE"])
    assert answered is not None, "scripts/gate/scope_map.sh could not be run"
    assert {name for name, selected in answered.items() if selected} == {"docs"}, repr(answered)


def test_a_hook_registration_selects_the_scripts_scope() -> None:
    """A registration's timeout is read by the self-check, so the file selects the scripts scope.

    A set comparison holds both halves of the arm; `format` rides along, both files being prettier's.
    """
    scope = _fixture().scope
    for path in (".claude/settings.json", ".claude/agents/cold-auditor.md"):
        answered = scope.scope_map([path])
        assert answered is not None, "scripts/gate/scope_map.sh could not be run"
        assert {name for name, selected in answered.items() if selected} == {"scripts", "docs", "format"}, (path, answered)


def test_the_backend_dockerfile_stops_short_of_the_backend_scope() -> None:
    """`SELECTED` reads its scopes as a subset, so its row here passes with `backend` and `db` left true.

    The image builds the backend and runs none of its tests, and only a set comparison says so.
    """
    scope = _fixture().scope
    answered = scope.scope_map(["fl_backend/Dockerfile"])
    assert answered is not None, "scripts/gate/scope_map.sh could not be run"
    assert {name for name, selected in answered.items() if selected} == {"images", "docs", "scripts"}, repr(answered)


def test_the_wall_clock_table_selects_the_scripts_scope_and_stops_there() -> None:
    """`SELECTED` reads its scopes as a subset, so its row here passes with every scope left true.

    Only a set comparison catches the arm widening to the conservative default the fallback gives.
    """
    scope = _fixture().scope
    answered = scope.scope_map([".github/gate-wall-clock.tsv"])
    assert answered is not None, "scripts/gate/scope_map.sh could not be run"
    assert {name for name, selected in answered.items() if selected} == {"scripts", "docs"}, repr(answered)


def test_the_backend_ignore_file_stops_short_of_the_scripts_scope() -> None:
    """`SELECTED` reads its scopes as a subset, so the row above passes with `scripts` left true.

    Only a set comparison holds the two halves of that arm apart.
    """
    scope = _fixture().scope
    answered = scope.scope_map(["fl_backend/.dockerignore"])
    assert answered is not None, "scripts/gate/scope_map.sh could not be run"
    assert {name for name, selected in answered.items() if selected} == {"images", "docs"}, repr(answered)


def test_a_module_the_other_package_reads_selects_that_package_s_scopes() -> None:
    """A set comparison rather than a `SELECTED` row, whose scopes are read as a subset.

    An arm widened to `images` would refuse every later run naming no image build; one below its
    own package's arm is shadowed.
    """
    scope = _fixture().scope
    read_by_a_frontend_suite = {"backend", "db", "frontend", "docs"}
    for path, expected in (
        ("fl_backend/app/core/domain.py", read_by_a_frontend_suite),
        ("fl_backend/app/core/recording.py", read_by_a_frontend_suite),
        ("fl_backend/app/core/exception_handlers.py", read_by_a_frontend_suite),
        ("fl_backend/app/shared/schemas/bounds.py", read_by_a_frontend_suite),
        ("fl_backend/app/shared/schemas/custom.py", read_by_a_frontend_suite),
        ("fl_backend/app/api/bewerbungen/admin_router.py", read_by_a_frontend_suite),
        ("fl_backend/app/api/bewerbungen/services.py", read_by_a_frontend_suite),
        ("fl_backend/app/api/saisons/schemas.py", read_by_a_frontend_suite),
        ("fl_backend/app/api/saisons/services.py", read_by_a_frontend_suite),
        ("fl_backend/app/api/teams/crud.py", read_by_a_frontend_suite),
        # `format` rides along with every TypeScript path, prettier having a parser for it.
        ("fl_frontend/src/features/saisons/actions.ts", {"backend", "db", "frontend", "docs", "format"}),
    ):
        answered = scope.scope_map([path])
        assert answered is not None, "scripts/gate/scope_map.sh could not be run"
        assert {name for name, selected in answered.items() if selected} == expected, (path, answered)


def _mapping_for_base(root: Path, base: str) -> dict[str, bool]:
    """`scope_map.sh` in its base-ref mode, the one CI runs and no case above reaches.

    Every other case arrives through `--stdin`, where the mapping is handed a file list and never
    diffs anything: the listing this mode builds is checked by nothing else.
    """
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    done = run_shell(BASH, root / SCRIPTS_COPY / "gate" / "scope_map.sh", base, cwd=root)
    assert done.returncode == 0, "scope_map.sh refused the base ref: " + done.stderr
    return {name: value == "true" for name, _, value in (line.partition("=") for line in done.stdout.splitlines() if "=" in line)}


def test_the_base_ref_mode_reads_a_rename_by_both_of_its_paths() -> None:
    """A detected rename is one filepair printing the DESTINATION alone, and the scopes go with the source.

    `config.ts` selects the image build and `settings.ts` does not, so without `--no-renames` the
    recipe moves and CI proves nothing about it.
    """
    fixture = _reset()
    moved = "fl_frontend/src/core/settings.ts"
    git(fixture.root, "mv", CONFIG_TS, moved)
    git(fixture.root, "commit", "--no-verify", "-m", "Frontend: the environment module is renamed")
    try:
        answered = _mapping_for_base(fixture.root, "HEAD~1")
    finally:
        # The commit alone comes off; the rename stays in the tree for `_reset` to clear, so no
        # case below is measured against a corpus this one moved.
        git(fixture.root, "reset", "--soft", "HEAD~1")
        _reset()
    assert answered.get("images"), "a renamed image path asked for no image build: " + repr(answered)


def test_the_two_lists_of_scope_names_agree() -> None:
    """A name in the mapping and not in SCOPES is read past in silence; the other way round never fires."""
    scope = _fixture().scope
    answered = scope.scope_map([])
    assert answered is not None
    assert set(answered) == set(scope.SCOPES)


# --- the arms that reach across the package boundary -------------------------------------------------

FRONTEND: Final = "fl_frontend"
BACKEND: Final = "fl_backend"

# A path in one package must select the scope the OTHER package's suites run in. `db` is emitted
# wherever `backend` is, so `backend` answers for that pair.
FAR_SCOPE: Final[dict[str, str]] = {BACKEND: "frontend", FRONTEND: "backend"}

# How each language spells a path into the other package. TypeScript hands `path.resolve` one segment
# per argument, so the package name is a whole segment; python joins a `Path` with `/`.
TS_CALL: Final = re.compile(r"path\.(?:resolve|join)\([^()]*\)")
TS_SEGMENTS: Final = re.compile(r'"' + BACKEND + r'"((?:\s*,\s*"[^"\\\n]+")+)')
TS_QUOTED: Final = re.compile(r'"([^"\\\n]+)"')

# Every shell token that could be a path. WHICH of them the mapping carries across is settled by
# running it below, so a token this misses narrows that question and can raise no finding of its own.
SHELL_TOKEN: Final = re.compile(r"[A-Za-z0-9_./-]+")

# An arm matches a path, so a suite walking a whole tree can be carried by none. Declared rather
# than derived: what a new row owes the mapping is a judgement, and a row here is that question.
UNNAMEABLE: Final[tuple[tuple[str, str], ...]] = (
    ("fl_backend/tests/core/test_domain.py", "fl_frontend/src"),
    ("fl_backend/tests/shared/test_frontend_mirrors.py", "fl_frontend/src"),
)


@dataclass(frozen=True)
class Crossings:
    """Each key below is a path in the package that the OTHER one reads it from."""

    reads: dict[str, set[str]]
    # A module against the TREE it reaches into, no file in it being named.
    reaches: set[tuple[str, str]]
    declared: set[str]
    # `declared` and every read alike, so a derived path is never missing here.
    selected: dict[str, set[str]]


def _file_or_tree(root: Path, reader: str, path: str, package: str, reads: dict[str, set[str]], reaches: set[tuple[str, str]]) -> None:
    """One reach filed by what an arm could match: the file it names, or the tree it reaches into."""
    if path and (root / path).is_file():
        reads.setdefault(path, set()).add(reader)
    elif path and (root / path).is_dir():
        reaches.add((reader, path))
    else:
        # A path composed at run time, or one spelled in a shape this reader could not resolve: its
        # directory part is as much as any arm could be held to.
        reaches.add((reader, path.rsplit("/", 1)[0] if "/" in path else package))


def _widest(reaches: set[tuple[str, str]]) -> set[tuple[str, str]]:
    """One module's reach inside another reach of its own, dropped: the wider one already covers it."""
    return {
        (reader, prefix)
        for reader, prefix in reaches
        if not any(other == reader and prefix.startswith(wider + "/") for other, wider in reaches)
    }


def _frontend_reaches(root: Path, files: list[str]) -> tuple[dict[str, set[str]], set[tuple[str, str]]]:
    """Every backend path a frontend module builds, and every reach that resolves to no file.

    A path call rather than any mention of the package: comments across this tree cite a backend
    module by path, and a citation is prose.
    """
    reads: dict[str, set[str]] = {}
    reaches: set[tuple[str, str]] = set()
    for rel in files:
        text = (root / rel).read_text(encoding="utf-8")
        if BACKEND not in text:
            continue
        for call in TS_CALL.findall(text):
            if BACKEND not in call:
                continue
            found = TS_SEGMENTS.search(call)
            path = "/".join([BACKEND, *TS_QUOTED.findall(found[1])]) if found is not None else ""
            _file_or_tree(root, rel, path, BACKEND, reads, reaches)
    return reads, _widest(reaches)


def _divided(node: ast.expr) -> list[ast.expr]:
    """One `root / "a" / "b"` chain flattened, leftmost operand first."""
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
        return [*_divided(node.left), node.right]
    return [node]


def _literal(node: ast.expr) -> str | None:
    """One path segment as its source fixes it -- a string, or the fixed opening of an f-string."""
    if isinstance(node, ast.Constant):
        return node.value if isinstance(node.value, str) else None
    if isinstance(node, ast.JoinedStr) and node.values:
        return _literal(node.values[0])
    return None


def _backend_reaches(root: Path, files: list[str]) -> tuple[dict[str, set[str]], set[tuple[str, str]]]:
    """Every frontend path a backend module builds, and every reach that resolves to no file.

    A `/` chain rather than any string naming the package: a docstring citing a frontend module is
    prose.
    """
    reads: dict[str, set[str]] = {}
    reaches: set[tuple[str, str]] = set()
    for rel in files:
        text = (root / rel).read_text(encoding="utf-8")
        if FRONTEND not in text:
            continue
        # Named, so a module this suite cannot parse fails saying which one rather than `<unknown>`.
        tree = ast.parse(text, filename=rel)
        divisions = [node for node in ast.walk(tree) if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div)]
        # A chain's own left operand is a division too, and read on its own it answers for a prefix
        # of the path -- `root / "fl_frontend"` where the chain names a module inside it.
        nested = {node.left for node in divisions}
        for node in (division for division in divisions if division not in nested):
            segments: list[str] = []
            for part in _divided(node):
                literal = _literal(part)
                opens = literal is not None and (literal == FRONTEND or literal.startswith(FRONTEND + "/"))
                if literal is None or (not segments and not opens):
                    if segments:
                        break
                    continue
                segments.append(literal)
            if segments:
                _file_or_tree(root, rel, "/".join(segments).rstrip("/"), FRONTEND, reads, reaches)
    return reads, _widest(reaches)


def _package_paths(mapping: Path, root: Path) -> set[str]:
    """Every path in either package the mapping names, read by token rather than from its arms.

    WHICH of them it carries across is settled by running it, so parsing the `case` would buy
    nothing and be more fragile.
    """
    return {
        token
        for token in SHELL_TOKEN.findall(mapping.read_text(encoding="utf-8"))
        # A glob arm falls out here, `fl_frontend/*` tokenising to a name no file has: swept in, it
        # would be probed as a path nothing reads.
        if token.startswith((FRONTEND + "/", BACKEND + "/")) and (root / token).is_file()
    }


def _selected(scope: ModuleType, paths: Iterable[str]) -> dict[str, set[str]]:
    """The scopes the mapping selects for each of these paths, one run of it per path.

    Concurrent for `scripts/checks/check_scope.py :: images_culprits`'s reason: the mapping answers
    for a list and says nothing about which member asked for what.
    """
    ordered = sorted(paths)
    with ThreadPoolExecutor() as pool:
        answers = list(pool.map(lambda path: scope.scope_map([path]), ordered))
    chosen: dict[str, set[str]] = {}
    for path, answered in zip(ordered, answers, strict=True):
        assert answered is not None, "scripts/gate/scope_map.sh could not be run for " + path
        chosen[path] = {name for name, on in answered.items() if on}
    return chosen


@functools.cache
def _crossings() -> Crossings:
    """This repository's two populations and the arms, read once.

    The mapping is the fixture's copy of it, that being the file `scope_map` runs; the two packages
    are read where they live, no fixture holding either.
    """
    listing = git(REPO_ROOT, "-c", "core.quotepath=false", "ls-files", "--cached", "--others", "--exclude-standard")
    files = listing.splitlines()
    frontend_modules = [rel for rel in files if rel.startswith(FRONTEND + "/") and rel.endswith((".ts", ".tsx", ".mts", ".cts"))]
    backend_modules = [rel for rel in files if rel.startswith(BACKEND + "/") and rel.endswith(".py")]
    reads, reaches = _frontend_reaches(REPO_ROOT, frontend_modules)
    further, more = _backend_reaches(REPO_ROOT, backend_modules)
    for path, readers in further.items():
        reads.setdefault(path, set()).update(readers)
    fixture = _fixture()
    declared = _package_paths(fixture.root / SCRIPTS_COPY / "gate" / "scope_map.sh", REPO_ROOT)
    return Crossings(reads, reaches | more, declared, _selected(fixture.scope, declared | set(reads)))


def _carried(crossings: Crossings) -> set[str]:
    """Every path the mapping names whose arm selects the scope the other package's suites run in."""
    return {path for path in crossings.declared if FAR_SCOPE[path.split("/")[0]] in crossings.selected[path]}


def _unarmed(crossings: Crossings) -> list[str]:
    """A file the other package reads that no arm carries across -- the repair is to widen an arm."""
    return [
        path + " is read by " + ", ".join(sorted(readers)) + ", and no arm carries it into --" + FAR_SCOPE[path.split("/")[0]]
        for path, readers in sorted(crossings.reads.items())
        if FAR_SCOPE[path.split("/")[0]] not in crossings.selected[path]
    ]


def _stale(crossings: Crossings) -> list[str]:
    """An arm carrying a file nothing reads, the repair being to narrow that arm.

    A path under a tree the far side walks whole is spared: no arm could be held to a file a walk
    never names.
    """
    walked = tuple(prefix + "/" for _, prefix in crossings.reaches)
    return [
        path + " is carried into --" + FAR_SCOPE[path.split("/")[0]] + ", and nothing there reads it"
        for path in sorted(_carried(crossings) - set(crossings.reads))
        if not path.startswith(walked)
    ]


def test_every_file_the_other_package_reads_is_carried_across_by_an_arm() -> None:
    """The arms are hand-kept lists, and this is what holds each to the reads it exists for.

    Non-emptiness first, and per direction: a set comparison whose derived side came out empty
    passes and guards nothing.
    """
    crossings = _crossings()
    for package, reader in ((BACKEND, "fl_frontend/"), (FRONTEND, "fl_backend/")):
        found = {path for path in crossings.reads if path.startswith(package + "/")}
        assert found, "no file in " + package + " was found read from " + reader + ": that reader went inert"
    assert not (missing := _unarmed(crossings)), "name the path in its arm in scripts/gate/scope_map.sh:\n" + "\n".join(missing)


def test_every_arm_reaching_across_the_boundary_names_a_file_the_other_package_reads() -> None:
    """The other direction of the same equality: an arm carrying a file nothing on the far side reads.

    `test_a_reach_that_names_no_single_file_is_one_this_check_declares` holds the list of walked
    trees that `_stale` spares, which is why this case can rest on it.
    """
    crossings = _crossings()
    # Two inert states, and a reader acts on which: no path read out of the mapping at all, against
    # paths read out of it that no arm carries across.
    assert crossings.declared, "no path in either package was read out of scripts/gate/scope_map.sh: that reader went inert"
    assert _carried(crossings), "no arm in scripts/gate/scope_map.sh was read as reaching across the boundary"
    assert not (stale := _stale(crossings)), "drop the path from its arm in scripts/gate/scope_map.sh:\n" + "\n".join(stale)


def test_a_reach_that_names_no_single_file_is_one_this_check_declares() -> None:
    """What the equality above cannot reach: a suite that walks the far tree.

    Only a person can say what the mapping owes a walk, and every path under one is spared above,
    so this list moving is a failure.
    """
    crossings = _crossings()
    assert crossings.reaches == set(UNNAMEABLE), (
        "the trees one package's suites reach into without naming a file have changed.\n"
        "derived:  " + repr(sorted(crossings.reaches)) + "\ndeclared: " + repr(sorted(UNNAMEABLE))
    )


# Two packages in miniature, shaped like the real reads. The real trees are no place to plant one,
# and neither is `scripts/gate/scope_map.sh`, which this suite does not own.
PLANTED_TREE: Final[dict[str, str]] = {
    "fl_backend/app/core/domain.py": "RULES = ()\n",
    "fl_backend/tests/test_mirror.py": (
        "from pathlib import Path\n\nROOT = Path(__file__).resolve().parents[2]\n"
        'ACTIONS = (ROOT / "fl_frontend" / "src" / "actions.ts").read_text(encoding="utf-8")\n'
        'EVERY = sorted((ROOT / "fl_frontend" / "src").rglob("*.ts"))\n'
    ),
    "fl_frontend/src/actions.ts": "export const total = 1;\n",
    "fl_frontend/src/register.ts": 'const RULES = readFileSync(path.resolve(ROOT, "fl_backend", "app", "core", "domain.py"), "utf8");\n',
    "fl_frontend/src/opaque.ts": 'const RULES = readFileSync(path.resolve(ROOT, "fl_backend/app/core/domain.py"), "utf8");\n',
}

# The mapping's own shape: a continuation, a comment between arms, a glob arm and a literal one.
PLANTED_MAPPING: Final = (
    '    case "$f" in\n'
    "      # A comment naming fl_backend/app/core/domain.py, which is an arm's path either way.\n"
    "      fl_backend/app/core/domain.py|fl_backend/tests/test_mirror.py| \\\n"
    "      fl_frontend/src/actions.ts) backend=true; frontend=true ;;\n"
    "      fl_frontend/*) frontend=true ;;\n"
    "      */.prettierignore) format=true ;;\n"
    "      *) all ;;\n"
    "    esac\n"
)


def _planted() -> Path:
    root = new_root("cross-boundary-fixture-")
    for rel, text in PLANTED_TREE.items():
        write(root, rel, text)
    return root


def test_each_reader_finds_a_file_the_other_package_reads_and_a_reach_it_cannot_place() -> None:
    """Both directions over a planted tree, carrying the spellings this repository does not.

    A reader taking `opaque.ts`'s one string for a named file passes every case over the tree, which
    holds no module spelling a path that way.
    """
    root = _planted()
    # The second module of each pair is the shape that must not read as a named file.
    reads, reaches = _frontend_reaches(root, ["fl_frontend/src/register.ts", "fl_frontend/src/opaque.ts"])
    assert reads == {"fl_backend/app/core/domain.py": {"fl_frontend/src/register.ts"}}, repr(reads)
    assert reaches == {("fl_frontend/src/opaque.ts", BACKEND)}, repr(reaches)

    reads, reaches = _backend_reaches(root, ["fl_backend/tests/test_mirror.py"])
    assert reads == {"fl_frontend/src/actions.ts": {"fl_backend/tests/test_mirror.py"}}, repr(reads)
    assert reaches == {("fl_backend/tests/test_mirror.py", "fl_frontend/src")}, repr(reaches)


def test_the_arm_reader_takes_a_literal_path_and_leaves_a_glob() -> None:
    """A glob is no cross-boundary arm, and swept in as one it would be probed as a path nothing reads."""
    root = _planted()
    mapping = write_shell(root / "scope_map.sh", PLANTED_MAPPING)
    assert _package_paths(mapping, root) == {
        "fl_backend/app/core/domain.py",
        "fl_backend/tests/test_mirror.py",
        "fl_frontend/src/actions.ts",
    }, repr(_package_paths(mapping, root))


# One population carrying every shape at once, the repository holding only the shape that passes.
PLANTED_CROSSINGS: Final = Crossings(
    reads={
        "fl_backend/app/core/domain.py": {"fl_frontend/src/register.ts"},
        "fl_frontend/src/actions.ts": {"fl_backend/tests/test_mirror.py"},
    },
    reaches={("fl_backend/tests/test_mirror.py", "fl_frontend/src")},
    # `recording.py` and `next.config.ts` are a stale arm, one per direction; `constants.ts` is the
    # arm a walked tree spares, which must not swallow `next.config.ts` with it.
    declared={
        "fl_backend/app/core/domain.py",
        "fl_backend/app/core/recording.py",
        "fl_frontend/src/actions.ts",
        "fl_frontend/src/constants.ts",
        "fl_frontend/next.config.ts",
    },
    selected={
        "fl_backend/app/core/domain.py": {"backend", "db", "docs"},
        "fl_backend/app/core/recording.py": {"backend", "db", "frontend", "docs"},
        "fl_frontend/src/actions.ts": {"frontend", "backend", "db", "docs"},
        "fl_frontend/src/constants.ts": {"frontend", "backend", "db", "docs"},
        "fl_frontend/next.config.ts": {"frontend", "backend", "db", "docs"},
    },
)


def test_the_two_repairs_are_reported_apart() -> None:
    """Widening an arm and narrowing one are different edits, and a reader acts on which it was told.

    Planted because the repository is in neither state, and the arm one would name is not this
    suite's to edit.
    """
    assert _unarmed(PLANTED_CROSSINGS) == [
        "fl_backend/app/core/domain.py is read by fl_frontend/src/register.ts, and no arm carries it into --frontend"
    ], repr(_unarmed(PLANTED_CROSSINGS))
    assert _stale(PLANTED_CROSSINGS) == [
        "fl_backend/app/core/recording.py is carried into --frontend, and nothing there reads it",
        "fl_frontend/next.config.ts is carried into --backend, and nothing there reads it",
    ], repr(_stale(PLANTED_CROSSINGS))
