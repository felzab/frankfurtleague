"""SCRIPTS · the readers and runners the scripts' suites share

The readers hold no state and are shared whole -- a module spelling one for itself answers a question
nothing else is held to, which is how two copies of one reader come to disagree.

Invariants:
  Every fixture tree is registered here and removed by `pytest_sessionfinish`, inside the run rather than after it.
"""

from __future__ import annotations

import contextlib
import importlib
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path
from types import ModuleType
from typing import Final

import pytest

REPO_ROOT: Final = Path(__file__).resolve().parent.parent.parent

# Not a skip condition: every script under `scripts/` is bash, so a machine without one cannot run
# the gate at all, and a contract silently skipped is what the suites driving one exist to stop.
BASH: Final = shutil.which("bash")

WINDOWS: Final = sys.platform == "win32"
# The runtime Git Bash's own bash runs on, which none of the launchers in front of it sits beside.
MSYS_RUNTIME: Final = "msys-2.0.dll"

_OWNED: list[Path] = []


def withdraw(*names: str) -> None:
    """Drop a module and its submodules from the cache, so a case's import is never another case's copy."""
    for cached in [name for name in sys.modules if any(name == root or name.startswith(root + ".") for root in names)]:
        del sys.modules[cached]


def import_scripts(*names: str, directories: tuple[str, ...] = ("checks",)) -> list[ModuleType]:
    """Each named module, imported out of this repository's scripts/ directories and withdrawn on both sides.

    An entry point runs as a script, which seeds its own directory onto the path; `withdraw` says
    why the cache is cleared.
    """
    added = [str(REPO_ROOT / "scripts" / directory) for directory in directories]
    packages = {name.partition(".")[0] for name in names} | {"checker_kernel"}
    sys.path[:0] = added
    withdraw(*packages)
    try:
        return [importlib.import_module(name) for name in names]
    finally:
        for entry in added:
            sys.path.remove(entry)
        withdraw(*packages)


def base_env() -> dict[str, str]:
    """The environment a script-driving case must not inherit: a parent gate run's colour and Actions state."""
    env = {name: value for name, value in os.environ.items() if not name.startswith("FL_GATE_")}
    env.pop("GITHUB_ACTIONS", None)
    env.pop("VERBOSE", None)
    env["FL_GATE_COLOR"] = "0"
    env["NO_SPINNER"] = "1"
    return env


def write_shell(path: Path, text: str) -> Path:
    """One shell fixture on disk, `newline=""` throughout.

    A Windows text-mode write turns every newline into a carriage return pair, and bash reads the
    result as a stray return on every line.
    """
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(text)
    return path


def run_shell(
    bash: str, script: Path, *args: str, env: dict[str, str] | None = None, cwd: Path | None = None
) -> subprocess.CompletedProcess[str]:
    """One shell script run to its end, its streams decoded as utf-8.

    `text=True` alone would decode with the machine locale, which is cp1252 on Windows, where a
    verdict carrying an em dash does not survive.
    """
    # `errors="replace"`: a byte outside utf-8 belongs in the output being asserted on rather than
    # in a decode error that says nothing about the run.
    return subprocess.run(
        (bash, script.as_posix(), *args),
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        cwd=cwd,
        check=False,
    )


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


def _foreign_bash(found: str | None, *, windows: bool) -> str | None:
    """Why `found` would fail cases that pass, or None where it runs them as written.

    WSL's launcher reads no Windows path, and the launcher in Git's top `bin` directory puts its own
    `/usr/bin` ahead of a case's stand-ins.
    """
    if not windows or found is None or (Path(found).parent / MSYS_RUNTIME).is_file():
        return None
    return (
        f"{found} is the first bash on PATH and not Git Bash's own, so cases that pass would fail under it."
        " Run pytest from Git Bash, whose PATH finds its own bash first."
    )


def pytest_configure() -> None:
    """Refused before collection: under a foreign bash every case running a script fails, saying nothing of why."""
    reason = _foreign_bash(BASH, windows=WINDOWS)
    if reason is not None:
        raise pytest.UsageError(reason)


def pytest_sessionfinish() -> None:
    """Remove every fixture tree this run built.

    A hook, not `atexit`, which runs after the runner has reported.
    """
    while _OWNED:
        discard(_OWNED.pop())
