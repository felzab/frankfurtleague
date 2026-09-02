"""SCRIPTS · the scope check's DECISION layer, driven against a real branch.

The classifier has a suite of its own; what this one holds is everything after it -- which scopes a
diff asks for, which of those fail and which only report, and the listings a diff is read from at
all. The seam is a throwaway repository holding a copy of scripts/, whose REPO_ROOT derives from
its own location and so roots there.

A mutant that empties `check` has to fail here, and so has one that stops separating the images
finding from every other scope. Stdlib only, the type checker reading scripts/ with no environment.
"""

from __future__ import annotations

import atexit
import contextlib
import importlib
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Final

REPO_ROOT: Final = Path(__file__).resolve().parent.parent.parent

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


def _git(root: Path, *args: str) -> None:
    done = subprocess.run(("git", *args), cwd=root, capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert done.returncode == 0, "git " + " ".join(args) + ": " + done.stderr


def _write(root: Path, rel: str, text: str) -> None:
    target = root / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    # Bytes, because a Windows text stream rewrites every \n as \r\n and the corpus would then
    # differ from the blob git stored for it (CLAUDE.md, the repo-specific traps).
    target.write_bytes(text.encode("utf-8"))


def _discard(root: Path) -> None:
    """Remove one fixture repository, the read-only files git wrote inside it included."""

    def _clear_readonly(remove: Callable[..., object], path: str, _exc: BaseException) -> None:
        os.chmod(path, stat.S_IWRITE)
        remove(path)

    with contextlib.suppress(OSError):
        shutil.rmtree(root, onexc=_clear_readonly)


@dataclass(frozen=True)
class Fixture:
    """The checker as the fixture repository sees it: the copied module, and the root it resolves to."""

    scope: ModuleType
    root: Path


def _withdraw(*names: str) -> None:
    """Drop a module and every submodule of it from the cache, before an import and after it.

    Two fixtures import a copy of scripts/ under the same names, and `checker_kernel` holds
    REPO_ROOT: whichever loads second is otherwise handed the first one's tree.
    """
    for cached in [name for name in sys.modules if any(name == root or name.startswith(root + ".") for root in names)]:
        del sys.modules[cached]


def _load() -> Fixture:
    root = Path(tempfile.mkdtemp(prefix="check-scope-fixture-")).resolve()
    atexit.register(_discard, root)
    ignored = shutil.ignore_patterns("__pycache__", "tests", ".ruff_cache", ".pytest_cache")
    shutil.copytree(REPO_ROOT / SCRIPTS_COPY, root / SCRIPTS_COPY, ignore=ignored)
    sys.path.insert(0, str(root / SCRIPTS_COPY))
    _withdraw("check_scope", "checker_kernel")
    try:
        module = importlib.import_module("check_scope")
    finally:
        sys.path.remove(str(root / SCRIPTS_COPY))
        _withdraw("check_scope", "checker_kernel")
    # The seam stated as an assertion: the checker derives its root from its own location, so
    # importing this copy is what points every listing below at the fixture instead of at us.
    assert Path(module.__file__ or "").resolve().parent.parent == root, "the checker under test is not the copy"
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
        _write(root, rel, text)
    _git(root, "init", "-b", "main")
    for name, value in (("user.name", "fixture"), ("user.email", "fixture@example.invalid"), ("commit.gpgsign", "false")):
        _git(root, "config", name, value)
    _git(root, "config", "core.hooksPath", str(root / ".no-hooks"))
    # `add -A`, the copy of scripts/ included: left untracked it would reach every listing below as
    # a diff of its own, and every case would then read the checker's own source as the change.
    _git(root, "add", "-A")
    _git(root, "commit", "--no-verify", "-m", "Corpus: a branch that changed nothing")
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
    _git(fixture.root, "reset", "-q", "HEAD", "--", ".")
    _git(fixture.root, "checkout", "-f", "HEAD", "--", ".")
    _git(fixture.root, "clean", "-fdq")
    return fixture


def _edit(rel: str, old: str, new: str) -> None:
    root = _fixture().root
    body = (root / rel).read_text(encoding="utf-8")
    assert old in body, rel + " does not carry " + repr(old)
    _write(root, rel, body.replace(old, new))


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


def test_only_the_image_build_fails_and_it_names_the_file() -> None:
    """`images` is the one scope whose absence refuses a run, and the finding is what an operator re-runs from."""
    _reset()
    _edit(DOCKERFILE, "node:26-slim", "node:27-slim")
    failing, _ = _run("frontend docs format")
    assert len(failing) == 1, "the image build did not refuse the run: " + repr(failing)
    assert DOCKERFILE in failing[0]
    assert "--images" in failing[0]


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
    mapping = fixture.root / SCRIPTS_COPY / "ci_scopes.sh"
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
    _git(fixture.root, "mv", DOCKERFILE, DOCKERFILE + ".old")
    failing, _ = _run("frontend docs format")
    assert failing and DOCKERFILE in failing[0], repr(failing)


def test_a_change_held_in_the_index_alone_is_seen() -> None:
    """`git diff <base>` never reads the index, and the index is what `git commit` commits."""
    fixture = _reset()
    _edit(SAMPLE, "TOTAL = 3", "TOTAL = 4")
    _git(fixture.root, "add", "--", SAMPLE)
    # --worktree alone: `git checkout HEAD -- <path>` would restore the index too and unstage it.
    _git(fixture.root, "restore", "--source=HEAD", "--worktree", "--", SAMPLE)
    _, advisory = _run("")
    assert any("--backend" in detail for detail in advisory), repr(advisory)


def test_a_file_named_like_a_throwaway_directory_still_selects_a_scope() -> None:
    """`.gitignore` skips `.tmp-*/`; a path the mapping skips selects nothing at all."""
    fixture = _reset()
    _write(fixture.root, ".tmp-config.py", "SETTING = 1\n")
    failing, _ = _run("")
    assert failing, "an untracked .tmp- FILE asked for no scope"


def test_a_throwaway_directory_is_still_skipped() -> None:
    """The other half of that arm: a leftover from an interrupted run is litter, not a change."""
    fixture = _reset()
    _write(fixture.root, ".tmp-gate/x.py", "X = 1\n")
    failing, advisory = _run("")
    assert not failing and not advisory, repr(failing) + repr(advisory)


# --- the comments a tool reads ----------------------------------------------------------------------

# A loop rather than pytest's parametrize, for `test_gate_pool.py :: MALFORMED`'s reason: pyright
# reads scripts/ with no environment declared, so nothing here may import outside the standard library.
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
)


def test_a_path_selects_every_scope_that_would_check_it() -> None:
    """A file governing a scope it does not select is a change that runs everything but its own check."""
    scope = _fixture().scope
    missed: list[str] = []
    for path, wanted in SELECTED:
        answered = scope.ci_scopes([path])
        assert answered is not None, "scripts/ci_scopes.sh could not be run"
        missed += [path + " selected no " + name for name in wanted if not answered.get(name)]
    assert not missed, "\n".join(missed)


def _mapping_for_base(root: Path, base: str) -> dict[str, bool]:
    """`ci_scopes.sh` in its base-ref mode, the one CI runs and no case above reaches.

    Every other case arrives through `--stdin`, where the mapping is handed a file list and never
    diffs anything: the listing this mode builds is checked by nothing else.
    """
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    done = subprocess.run(
        (BASH, str(root / SCRIPTS_COPY / "ci_scopes.sh"), base),
        cwd=root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert done.returncode == 0, "ci_scopes.sh refused the base ref: " + done.stderr
    return {name: value == "true" for name, _, value in (line.partition("=") for line in done.stdout.splitlines() if "=" in line)}


def test_the_base_ref_mode_reads_a_rename_by_both_of_its_paths() -> None:
    """A detected rename is one filepair printing the DESTINATION alone, and the scopes go with the source.

    `config.ts` selects the image build and `settings.ts` does not, so without `--no-renames` the
    recipe moves and CI proves nothing about it.
    """
    fixture = _reset()
    moved = "fl_frontend/src/core/settings.ts"
    _git(fixture.root, "mv", CONFIG_TS, moved)
    _git(fixture.root, "commit", "--no-verify", "-m", "Frontend: the environment module is renamed")
    try:
        answered = _mapping_for_base(fixture.root, "HEAD~1")
    finally:
        # The commit alone comes off; the rename stays in the tree for `_reset` to clear, so no
        # case below is measured against a corpus this one moved.
        _git(fixture.root, "reset", "--soft", "HEAD~1")
        _reset()
    assert answered.get("images"), "a renamed image path asked for no image build: " + repr(answered)


def test_the_two_lists_of_scope_names_agree() -> None:
    """A name in the mapping and not in SCOPES is read past in silence; the other way round never fires."""
    scope = _fixture().scope
    answered = scope.ci_scopes([])
    assert answered is not None
    assert set(answered) == set(scope.SCOPES)
