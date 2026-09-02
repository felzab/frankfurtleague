"""SCRIPTS · the throwaway repository the gate-facing suites build, and what removes it

Five modules copy scripts/ into a temporary tree and import the gate out of the copy, so the checker
under test roots at a planted corpus rather than at this repository. Shared here is the building and
the removal only: each module keeps its own corpus, its own plants and its own reset, because a
fixture shared where a case mutates it would let a planted violation stop being found.

Invariants:
  Nothing here imports pytest: `scripts/pyrightconfig.json` declares no virtualenv, so it would not resolve.
  Every fixture tree is registered here and removed by `pytest_sessionfinish`, inside the run rather than after it.
"""

from __future__ import annotations

import contextlib
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Final

REPO_ROOT: Final = Path(__file__).resolve().parent.parent.parent

# One list rather than one per module. The folder is live while it is walked -- the scripts scope
# runs selfcheck, ruff, pyright and this suite at once -- and the copy raises on a path that vanishes
# between the listing and the walk.
IGNORED: Final = shutil.ignore_patterns("__pycache__", "tests", ".ruff_cache", ".pytest_cache", ".mypy_cache")

# The identity every fixture repository commits under, so no case depends on the machine's own git.
IDENTITY: Final[tuple[tuple[str, str], ...]] = (
    ("user.name", "fixture"),
    ("user.email", "fixture@example.invalid"),
    ("commit.gpgsign", "false"),
)

_OWNED: list[Path] = []


def git(root: Path, *args: str) -> str:
    """One git command inside a fixture repository, answering its stdout."""
    # `replace` rather than the strict default: a corpus carries paths and messages a fixture chose,
    # and a byte that is not utf-8 in one of them would end the run in a decode error rather than in
    # the finding the case is about.
    done = subprocess.run(("git", *args), cwd=root, capture_output=True, text=True, encoding="utf-8", errors="replace", check=False)
    if done.returncode != 0:
        # Raised with git's own message: a fixture that fails to build otherwise reports a bare exit
        # code, and the case that follows then fails for a reason nothing in the output explains.
        raise RuntimeError("git " + " ".join(args) + " failed: " + (done.stderr.strip() or done.stdout.strip()))
    return done.stdout.strip()


def write(root: Path, rel: str, text: str) -> None:
    """One corpus file under a fixture repository, its parents made as needed."""
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    # Bytes, never write_text: that emits CRLF on Windows, and a line-ending check would then report
    # the whole corpus rather than the one file a case planted.
    path.write_bytes(text.encode("utf-8"))


def copy_scripts(destination: Path) -> None:
    """This repository's scripts/ inside a fixture tree, which is what roots the gate at the corpus."""
    shutil.copytree(REPO_ROOT / "scripts", destination, ignore=IGNORED)


def configure(root: Path, hooks: str) -> None:
    """A fresh repository on main, committing as the fixture identity and running no hook.

    The hooks path is the caller's because the fixtures disagree: some create the folder and pass
    its absolute path, one names a folder that is never there.
    """
    git(root, "init", "-b", "main")
    for name, value in IDENTITY:
        git(root, "config", name, value)
    git(root, "config", "core.hooksPath", hooks)


def withdraw(*names: str) -> None:
    """Drop a module and every submodule of it from the cache, before an import and after it.

    Two fixtures import a copy of scripts/ under the same names, and `checker_kernel` holds
    REPO_ROOT: whichever loads second is otherwise handed the first one's tree.
    """
    for cached in [name for name in sys.modules if any(name == root or name.startswith(root + ".") for root in names)]:
        del sys.modules[cached]


def new_root(prefix: str) -> Path:
    """An empty fixture tree this run owns, removed when the run finishes."""
    root = Path(tempfile.mkdtemp(prefix=prefix)).resolve()
    _OWNED.append(root)
    return root


def discard(root: Path) -> None:
    """Remove one fixture tree, the read-only files git wrote inside it included."""

    def clear_readonly(remove: Callable[..., object], path: str, _exc: BaseException) -> None:
        # Windows will not unlink a read-only file, and that is how git writes every loose object --
        # so ignoring the error alone leaves every `.git` tree behind.
        os.chmod(path, stat.S_IWRITE)
        remove(path)

    # Suppressed around the retry rather than instead of it: a failure swallowed before the retry is
    # what let these accumulate.
    with contextlib.suppress(OSError):
        shutil.rmtree(root, onexc=clear_readonly)


def pytest_sessionfinish() -> None:
    """Remove every fixture tree this run built.

    A hook rather than `atexit`, which runs after the runner has finished reporting: here the
    session is still live, so what the removal does is still the runner's to tell.
    """
    while _OWNED:
        discard(_OWNED.pop())
