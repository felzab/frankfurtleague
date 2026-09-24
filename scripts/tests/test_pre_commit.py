"""SCRIPTS · the commit hook's refusal on main, driven through a real `git commit`.

`.githooks/pre-commit` is the one local refusal of a commit on main, and a regression in it looks
exactly like a pass. The staged file is one prettier does not read, or one it does in a tree with no
prettier installed, so the refusal is pinned ahead of both of the hook's exits that pass a commit
unformatted.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Final

from conftest import REPO_ROOT, configure, git, new_root, write

HOOK: Final = REPO_ROOT / ".githooks" / "pre-commit"

# The words the refusal is read by: a hook failing for any other reason exits non-zero too.
REFUSED_ON_MAIN: Final = "HEAD is main"


def _repository(staged: str = "probe.py") -> Path:
    """A fresh repository on main whose only hook is the tree's `pre-commit`, one file staged."""
    root = new_root("fl-pre-commit-")
    (root / ".githooks").mkdir()
    shutil.copy2(HOOK, root / ".githooks" / "pre-commit")
    configure(root, hooks=str(root / ".githooks"))
    write(root, staged, "VALUE = 1\n")
    git(root, "add", staged)
    return root


def _commit(root: Path) -> subprocess.CompletedProcess[str]:
    """`git commit` run to its end: the refusal is a non-zero exit, which `scripts/tests/conftest.py :: git` raises on."""
    return subprocess.run(("git", "commit", "-m", "probe"), cwd=root, capture_output=True, encoding="utf-8", errors="replace", check=False)


def test_a_commit_on_main_is_refused_and_leaves_no_commit_behind() -> None:
    root = _repository()
    done = _commit(root)
    assert done.returncode != 0, done.stdout + done.stderr
    assert REFUSED_ON_MAIN in done.stderr, done.stderr
    head = subprocess.run(("git", "rev-parse", "--verify", "--quiet", "HEAD"), cwd=root, capture_output=True, check=False)
    assert head.returncode != 0, "a commit landed on main"


def test_a_commit_on_main_staging_a_file_prettier_reads_is_refused_too() -> None:
    """With no prettier installed here, this file's commit reaches the hook's other passing exit."""
    done = _commit(_repository("probe.md"))
    assert done.returncode != 0, done.stdout + done.stderr
    assert REFUSED_ON_MAIN in done.stderr, done.stderr


def test_the_same_commit_on_a_branch_goes_through() -> None:
    """The contrast the refusal needs: a hook refusing every commit would pass the case above."""
    root = _repository()
    git(root, "checkout", "-b", "topic")
    done = _commit(root)
    assert done.returncode == 0, done.stdout + done.stderr
    assert REFUSED_ON_MAIN not in done.stderr, done.stderr
