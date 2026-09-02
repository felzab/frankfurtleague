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

# The caches are live while copied -- the scripts scope runs its tools together -- and copytree
# raises on a path that vanishes mid-walk.
IGNORED: Final = shutil.ignore_patterns("__pycache__", "tests", ".ruff_cache", ".pytest_cache", ".mypy_cache")

# So no case depends on the machine's git config.
IDENTITY: Final[tuple[tuple[str, str], ...]] = (
    ("user.name", "fixture"),
    ("user.email", "fixture@example.invalid"),
    ("commit.gpgsign", "false"),
)

_OWNED: list[Path] = []


def git(root: Path, *args: str) -> str:
    """One git command inside a fixture repository, answering its stdout."""
    # `errors="replace"`: a non-utf-8 byte in a fixture's path or message would end the run in a
    # decode error rather than in the finding.
    done = subprocess.run(("git", *args), cwd=root, capture_output=True, text=True, encoding="utf-8", errors="replace", check=False)
    if done.returncode != 0:
        # With git's message, or the next case fails for a reason nothing explains.
        raise RuntimeError("git " + " ".join(args) + " failed: " + (done.stderr.strip() or done.stdout.strip()))
    return done.stdout.strip()


def write(root: Path, rel: str, text: str) -> None:
    """One corpus file under a fixture repository, its parents made as needed."""
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    # Bytes (CLAUDE.md §6).
    path.write_bytes(text.encode("utf-8"))


def copy_scripts(destination: Path) -> None:
    shutil.copytree(REPO_ROOT / "scripts", destination, ignore=IGNORED)


def configure(root: Path, hooks: str) -> None:
    """A fresh repository on main, committing as the fixture identity and running no hook.

    The hooks path is the caller's: the fixtures disagree on it.
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


def base_env() -> dict[str, str]:
    """The environment a gate-driving fixture must not inherit.

    A parent's own run state would decide the answer: FL_GATE_WORKER silences every summary, and
    the pool's variables point the fixture at a ledger belonging to another run.
    """
    env = {name: value for name, value in os.environ.items() if not name.startswith("FL_GATE_")}
    env.pop("GITHUB_ACTIONS", None)
    env.pop("VERBOSE", None)
    env["FL_GATE_COLOR"] = "0"
    env["NO_SPINNER"] = "1"
    return env


def new_root(prefix: str) -> Path:
    root = Path(tempfile.mkdtemp(prefix=prefix)).resolve()
    _OWNED.append(root)
    return root


def discard(root: Path) -> None:
    def clear_readonly(remove: Callable[..., object], path: str, _exc: BaseException) -> None:
        # Windows will not unlink a read-only file, and that is how git writes every loose object --
        # so ignoring the error alone leaves every `.git` tree behind.
        os.chmod(path, stat.S_IWRITE)
        remove(path)

    # Around the retry, never instead of it: a failure swallowed first leaves the tree behind.
    with contextlib.suppress(OSError):
        shutil.rmtree(root, onexc=clear_readonly)


def pytest_sessionfinish() -> None:
    """Remove every fixture tree this run built.

    A hook, not `atexit`, which runs after the runner has reported.
    """
    while _OWNED:
        discard(_OWNED.pop())
