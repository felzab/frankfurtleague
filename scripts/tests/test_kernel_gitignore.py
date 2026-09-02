"""SCRIPTS · the git-facing seams a suffixless file reaches the gate through

Three answers a case has to be able to make fail: which paths git calls ignored, asked in one
batch; which suffixless files the scan reaches; and whether INC-9's bound is measured over a git
hook, which carries no suffix and sits in no scope the other comment checks name. A subprocess
reads each over a throwaway repository holding a copy of scripts/ (the collision
`scripts/tests/conftest.py :: withdraw` names).
"""

from __future__ import annotations

import itertools
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Final

from conftest import configure, copy_scripts, git, new_root, write

SCRIPTS_COPY: Final = "scripts"
HOOKS_STUB: Final = "nohooks"
GITIGNORE: Final = ".gitignore"
# Built, for `test_check_docs.py :: HASH`'s reason.
HASH: Final = "#"
TICK: Final = "`"

# Ruled with a trailing slash, which matches the bare name only while the folder exists: the double
# probe's case.
IGNORED_FOLDER: Final = "docs/scratch"
IGNORED_FILE: Final = "docs/scratch-notes.md"
UNRULED: Final = "docs/never-written.md"
COMMENT: Final = "planned under " + IGNORED_FOLDER + ", " + IGNORED_FILE + " and " + UNRULED
COMMENT_HOME: Final = "docs/plan.md"

HOOK: Final = ".githooks/pre-push"
DEAD_PATH: Final = "docs/gone.md"
HOOK_LINES: Final = (HASH + "!/usr/bin/env bash", HASH, HASH + " A hook whose comment names " + TICK + DEAD_PATH + TICK + ".", "exit 0")

# Blank-line separated from the header, or `comment_runs` reads them as one block and the fork's copy
# exempts the plant.
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

# The trace counts how many of these reached git.
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


def _build() -> tuple[Path, Path]:
    parent = new_root("kernel-seams-fixture-")
    root = parent / "repo"
    copy_scripts(root / SCRIPTS_COPY)
    (parent / IGNORE_DRIVER).write_bytes(IGNORE_SCRIPT.encode("utf-8"))
    (parent / SCAN_DRIVER).write_bytes(SCAN_SCRIPT.encode("utf-8"))
    (parent / BOUNDS_DRIVER).write_bytes(BOUNDS_SCRIPT.encode("utf-8"))
    # The scripts copy is ignored on top, or the scan reads the gate's own modules as the corpus.
    write(root, GITIGNORE, _page("/" + SCRIPTS_COPY + "/", IGNORED_FOLDER + "/", IGNORED_FILE))
    write(root, HOOK, _page(*HOOK_LINES))
    (root / HOOKS_STUB).mkdir()
    configure(root, str(root / HOOKS_STUB))
    git(root, "add", "--", GITIGNORE, HOOK)
    git(root, "commit", "-m", "Corpus: one hook and three rules")
    return parent, root


_STATE: list[tuple[Path, Path]] = []
_TRACES: Final = itertools.count()


def _fixture() -> tuple[Path, Path]:
    if not _STATE:
        _STATE.append(_build())
    return _STATE[0]


def _run(driver: str, *args: str, broken: bool = False) -> tuple[dict[str, Any], int]:
    """One driver's answer, and how many times it reached `check-ignore`.

    `GIT_DIR` at an absent path is a git that cannot answer; `GIT_TRACE` is git's own launch count.
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
    fork = git(root, "rev-parse", "HEAD")
    write(root, HOOK, _page(*HOOK_LINES, *OVER_BOUND_BLOCK))
    try:
        answer, _ = _run(BOUNDS_DRIVER, fork)
    finally:
        # Restored by hand: the scan case reads the same hook.
        write(root, HOOK, _page(*HOOK_LINES))
    reported = [(check, file) for check, file, _, _ in answer["findings"]]
    assert reported == [("comment-length", HOOK)], answer["findings"]
    assert "INC-9 caps a block at 250" in answer["findings"][0][3]


def test_a_hook_block_that_was_already_over_the_bound_is_left_alone() -> None:
    """The grandfather clause is what keeps a widened population from failing comments nobody touched."""
    parent, root = _fixture()
    write(root, HOOK, _page(*HOOK_LINES, *OVER_BOUND_BLOCK))
    git(root, "add", "--", HOOK)
    git(root, "commit", "-m", "Corpus: the hook carries the block before the branch does")
    fork = git(root, "rev-parse", "HEAD")
    write(root, HOOK, _page(*HOOK_LINES, *OVER_BOUND_BLOCK, "exit 0"))
    try:
        answer, _ = _run(BOUNDS_DRIVER, fork)
    finally:
        write(root, HOOK, _page(*HOOK_LINES))
        git(root, "add", "--", HOOK)
        git(root, "commit", "-m", "Corpus: the hook goes back to its committed shape")
    assert answer["findings"] == [], "a block over the bound at the fork is the branch's to leave"


def test_a_pre_push_hook_is_scanned_and_its_comment_read() -> None:
    """A git hook has no suffix to match, so the roster names it; left off, its comments are outside the gate."""
    answer, _ = _run(SCAN_DRIVER)
    assert answer["scanned"] == [HOOK]
    assert [(check, file) for check, file, _ in answer["findings"]] == [("path", HOOK)]
    assert DEAD_PATH in answer["findings"][0][2]
