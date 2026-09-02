"""SCRIPTS · the git-facing seams a suffixless file reaches the gate through

Three answers a case has to be able to make fail: which paths git calls ignored, asked in one
batch; which suffixless files the scan reaches; and whether INC-9's bound is measured over a git
hook, which carries no suffix and sits in no scope the other comment checks name. A subprocess
reads each over a throwaway repository holding a copy of scripts/: the gate roots at its own
file, and importing a copy in-process would collide with `scripts/tests/test_check_docs.py`'s
copy over one module name. Stdlib only, the type checker reading scripts/ with no environment
declared.
"""

from __future__ import annotations

import atexit
import contextlib
import itertools
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

SCRIPTS_COPY: Final = "scripts"
HOOKS_STUB: Final = "nohooks"
GITIGNORE: Final = ".gitignore"
# Built rather than written, for the fixture net's reason: a marker on a line of THIS file would be
# read as this file's own comment.
HASH: Final = "#"
TICK: Final = "`"

# Three paths a comment names and the tree does not hold. The folder is ruled with a trailing
# slash, which matches its bare name only while the folder is there -- the double probe's case.
IGNORED_FOLDER: Final = "docs/scratch"
IGNORED_FILE: Final = "docs/scratch-notes.md"
UNRULED: Final = "docs/never-written.md"
# A comment naming all three, and the file it is read as belonging to.
COMMENT: Final = "planned under " + IGNORED_FOLDER + ", " + IGNORED_FILE + " and " + UNRULED
COMMENT_HOME: Final = "docs/plan.md"

# The suffixless hook the scan has to reach by name, and the dead path its comment backticks.
HOOK: Final = ".githooks/pre-push"
DEAD_PATH: Final = "docs/gone.md"
HOOK_LINES: Final = (HASH + "!/usr/bin/env bash", HASH, HASH + " A hook whose comment names " + TICK + DEAD_PATH + TICK + ".", "exit 0")

# One comment block past INC-9's bound, split over lines as a hook's own comments are. Blank-line
# separated from the header above it, or `comment_runs` reads the two as one block and the fork's
# copy of that block exempts the plant.
OVER_BOUND_BLOCK: Final[tuple[str, ...]] = (
    "",
    HASH + " A block planted below the header and past the character bound, whose whole purpose is",
    HASH + " to be measured: a git hook carries no suffix, so nothing about its name puts it inside",
    HASH + " the population the comment checks walk, and only a plant that is over the bound can say",
    HASH + " whether the widened population reaches it or passes it by in silence.",
)

IGNORE_DRIVER: Final = "ignore_driver.py"
SCAN_DRIVER: Final = "scan_driver.py"
BOUNDS_DRIVER: Final = "bounds_driver.py"
BUILT_IN: Final = "built-in: git check-ignore"

# One batch first where asked, then every token alone, then each again, then the check that
# consumes the answers: the trace counts how many of those reached git.
IGNORE_SCRIPT: Final = """
import json
import sys

sys.path.insert(0, sys.argv[1])

import checker_kernel
from docs_gate import checks, kernel

assert kernel.REPO_ROOT == checker_kernel.REPO_ROOT

tokens = json.loads(sys.argv[2])
batch = sorted(kernel.gitignored(tokens)) if sys.argv[3] == "batch" else None
single = {token: kernel.is_gitignored(token) for token in tokens}
repeat = {token: kernel.is_gitignored(token) for token in tokens}
findings = [[f.check, f.detail] for f in checks.check_bare_paths(sys.argv[4], sys.argv[5])]
print(json.dumps({"batch": batch, "single": single, "repeat": repeat, "findings": findings}))
"""

SCAN_SCRIPT: Final = """
import json
import sys

sys.path.insert(0, sys.argv[1])

from docs_gate import checks, kernel

files = kernel.scanned_files()
scanned = [path.relative_to(kernel.REPO_ROOT).as_posix() for path in files]
findings = [[f.check, f.file, f.detail] for path in files for f in checks.check_file(path, {}, {})]
print(json.dumps({"scanned": scanned, "findings": findings}))
"""


BOUNDS_SCRIPT: Final = """
import json
import sys

sys.path.insert(0, sys.argv[1])

from docs_gate import branch

state = branch.Branch("main", sys.argv[2])
findings = [[f.check, f.file, f.line, f.detail] for f in branch.check_comment_bounds(state)]
print(json.dumps({"findings": findings}))
"""


def _page(*lines: str) -> str:
    return "\n".join(lines) + "\n"


def _git(root: Path, *args: str) -> str:
    done = subprocess.run(("git", *args), cwd=root, capture_output=True, text=True, encoding="utf-8", check=False)
    if done.returncode != 0:
        raise RuntimeError("git " + " ".join(args) + " failed: " + (done.stderr.strip() or done.stdout.strip()))
    return done.stdout.strip()


def _write(root: Path, rel: str, text: str) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    # Bytes, never write_text: that emits CRLF on Windows, and the hook would read as a line-ending
    # finding rather than the one its comment plants.
    path.write_bytes(text.encode("utf-8"))


def _discard(root: Path) -> None:
    """Remove the fixture tree, the read-only files git wrote inside it included."""

    def _clear_readonly(remove: Callable[..., object], path: str, _exc: BaseException) -> None:
        os.chmod(path, stat.S_IWRITE)
        remove(path)

    with contextlib.suppress(OSError):
        shutil.rmtree(root, onexc=_clear_readonly)


def _build() -> tuple[Path, Path]:
    """One fixture repository beside the drivers that read it, built once per session."""
    parent = Path(tempfile.mkdtemp(prefix="kernel-seams-fixture-")).resolve()
    atexit.register(_discard, parent)
    root = parent / "repo"
    ignored = shutil.ignore_patterns("__pycache__", "tests", ".ruff_cache", ".pytest_cache", ".mypy_cache")
    shutil.copytree(REPO_ROOT / SCRIPTS_COPY, root / SCRIPTS_COPY, ignore=ignored)
    (parent / IGNORE_DRIVER).write_bytes(IGNORE_SCRIPT.encode("utf-8"))
    (parent / SCAN_DRIVER).write_bytes(SCAN_SCRIPT.encode("utf-8"))
    (parent / BOUNDS_DRIVER).write_bytes(BOUNDS_SCRIPT.encode("utf-8"))
    # The scripts copy is ignored on top, or the scan reads the gate's own modules as the corpus.
    _write(root, GITIGNORE, _page("/" + SCRIPTS_COPY + "/", IGNORED_FOLDER + "/", IGNORED_FILE))
    _write(root, HOOK, _page(*HOOK_LINES))
    (root / HOOKS_STUB).mkdir()
    _git(root, "init", "-b", "main")
    for name, value in (("user.name", "fixture"), ("user.email", "fixture@example.invalid"), ("commit.gpgsign", "false")):
        _git(root, "config", name, value)
    _git(root, "config", "core.hooksPath", str(root / HOOKS_STUB))
    _git(root, "add", "--", GITIGNORE, HOOK)
    _git(root, "commit", "-m", "Corpus: one hook and three rules")
    return parent, root


_STATE: list[tuple[Path, Path]] = []
_TRACES: Final = itertools.count()


def _fixture() -> tuple[Path, Path]:
    if not _STATE:
        _STATE.append(_build())
    return _STATE[0]


def _run(driver: str, *args: str, broken: bool = False) -> tuple[dict[str, Any], int]:
    """One driver's answer, and how many times it reached `check-ignore`.

    `GIT_DIR` at a path that is not there is a git that cannot answer: every command it is given
    dies before reading the tree. The trace file is git's own account of what was launched.
    """
    parent, root = _fixture()
    trace = parent / ("trace-" + str(next(_TRACES)) + ".log")
    env = dict(os.environ)
    env.pop("GIT_DIR", None)
    env.pop("GIT_WORK_TREE", None)
    env["GIT_TRACE"] = str(trace)
    if broken:
        env["GIT_DIR"] = str(parent / "no-such-repository")
    command = (sys.executable, str(parent / driver), str(root / SCRIPTS_COPY), *args)
    done = subprocess.run(command, cwd=root, env=env, capture_output=True, text=True, encoding="utf-8", check=False)
    assert done.returncode == 0, done.stderr
    spawns = trace.read_text(encoding="utf-8").count(BUILT_IN) if trace.is_file() else 0
    return json.loads(done.stdout), spawns


def _ignore(mode: str, *tokens: str, broken: bool = False) -> tuple[dict[str, Any], int]:
    return _run(IGNORE_DRIVER, json.dumps(list(tokens)), mode, COMMENT_HOME, COMMENT, broken=broken)


def _named(findings: list[list[str]]) -> list[str]:
    """The tokens the bare-path findings name, in the order the check reported them."""
    return [detail.split("path named but not present: ", 1)[1].split(" ", 1)[0] for check, detail in findings if check == "bare-path"]


# --- the check-ignore batch -----------------------------------------------------------------------


def test_a_directory_only_rule_is_found_through_the_second_spelling() -> None:
    """The folder is absent, so only the trailing-slash spelling matches: dropping the double probe reports it."""
    answer, spawns = _ignore("batch", IGNORED_FOLDER, IGNORED_FILE, UNRULED)
    assert answer["batch"] == sorted((IGNORED_FOLDER, IGNORED_FILE))
    assert answer["single"] == {IGNORED_FOLDER: True, IGNORED_FILE: True, UNRULED: False}
    assert _named(answer["findings"]) == [UNRULED]
    assert spawns == 1, "the batch answered, so nothing after it reaches git"


def test_a_git_that_cannot_answer_leaves_every_finding_standing() -> None:
    """A refused batch calls nothing ignored: the two ruled paths are reported beside the unruled one."""
    answer, _ = _ignore("single", IGNORED_FOLDER, IGNORED_FILE, UNRULED, broken=True)
    assert answer["single"] == {IGNORED_FOLDER: False, IGNORED_FILE: False, UNRULED: False}
    assert answer["repeat"] == answer["single"]
    assert _named(answer["findings"]) == sorted((IGNORED_FOLDER, IGNORED_FILE, UNRULED))
    working, _ = _ignore("single", IGNORED_FOLDER, IGNORED_FILE, UNRULED)
    assert _named(working["findings"]) == [UNRULED], "the same run with git answering keeps only the unruled path"


def test_a_token_reaches_git_once_a_run() -> None:
    """Asked alone, each token costs one launch whatever git answers, and asking again costs none."""
    tokens = (IGNORED_FOLDER, IGNORED_FILE, UNRULED)
    answer, spawns = _ignore("single", *tokens)
    assert answer["single"] == {IGNORED_FOLDER: True, IGNORED_FILE: True, UNRULED: False}
    assert answer["repeat"] == answer["single"]
    assert spawns == len(tokens), "one launch per token: the second spelling rides in the same batch, the repeat in the memo"


def test_a_batch_answers_the_tokens_asked_alone_afterwards() -> None:
    """A token the batch answered is served from the run's memo; only the one it did not cover costs a launch."""
    answer, spawns = _ignore("batch", IGNORED_FOLDER, UNRULED)
    assert answer["batch"] == [IGNORED_FOLDER]
    assert answer["repeat"] == {IGNORED_FOLDER: True, UNRULED: False}
    assert _named(answer["findings"]) == [UNRULED]
    assert spawns == 2, "the batch, and one launch for the third path the comment names"


# --- the suffixless roster --------------------------------------------------------------------------


def test_a_comment_block_over_the_bound_in_a_hook_is_reported() -> None:
    """A hook has no suffix and no source-suffix scope, so the population reaches it by name or not at all."""
    parent, root = _fixture()
    fork = _git(root, "rev-parse", "HEAD")
    _write(root, HOOK, _page(*HOOK_LINES, *OVER_BOUND_BLOCK))
    try:
        answer, _ = _run(BOUNDS_DRIVER, fork)
    finally:
        # Restored here rather than by git, which no case in this module may run for a write: the
        # scan case below measures the same hook and would read the plant as its own subject.
        _write(root, HOOK, _page(*HOOK_LINES))
    reported = [(check, file) for check, file, _, _ in answer["findings"]]
    assert reported == [("comment-length", HOOK)], answer["findings"]
    assert "INC-9 caps a block at 250" in answer["findings"][0][3]


def test_a_hook_block_that_was_already_over_the_bound_is_left_alone() -> None:
    """The grandfather clause is what keeps a widened population from failing comments nobody touched."""
    parent, root = _fixture()
    _write(root, HOOK, _page(*HOOK_LINES, *OVER_BOUND_BLOCK))
    _git(root, "add", "--", HOOK)
    _git(root, "commit", "-m", "Corpus: the hook carries the block before the branch does")
    fork = _git(root, "rev-parse", "HEAD")
    _write(root, HOOK, _page(*HOOK_LINES, *OVER_BOUND_BLOCK, "exit 0"))
    try:
        answer, _ = _run(BOUNDS_DRIVER, fork)
    finally:
        _write(root, HOOK, _page(*HOOK_LINES))
        _git(root, "add", "--", HOOK)
        _git(root, "commit", "-m", "Corpus: the hook goes back to its committed shape")
    assert answer["findings"] == [], "a block over the bound at the fork is the branch's to leave"


def test_a_pre_push_hook_is_scanned_and_its_comment_read() -> None:
    """A git hook has no suffix to match, so the roster names it; left off, its comments are outside the gate."""
    answer, _ = _run(SCAN_DRIVER)
    assert answer["scanned"] == [HOOK]
    assert [(check, file) for check, file, _ in answer["findings"]] == [("path", HOOK)]
    assert DEAD_PATH in answer["findings"][0][2]
