"""ORCHESTRATION · the helpers the orchestration tools' tests share.

Copies of `scripts/tests/conftest.py`'s helpers of the same names rather than an import of them:
this folder goes with `.claude/`, and nothing outside `.claude/` may need it or be needed by it.
"""

from __future__ import annotations

import importlib
import os
import shutil
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from typing import Final

REPO_ROOT: Final = Path(__file__).resolve().parents[4]
TOOLS: Final = REPO_ROOT / ".claude" / "skills" / "orchestration" / "tools"

BASH: Final = shutil.which("bash")

# So no case depends on the machine's git config.
IDENTITY: Final[tuple[tuple[str, str], ...]] = (
    ("user.name", "fixture"),
    ("user.email", "fixture@example.invalid"),
    ("commit.gpgsign", "false"),
)


def git(root: Path, *args: str) -> str:
    """One git command answering its stdout, inside a fixture repository; its own words where it fails."""
    done = subprocess.run(("git", *args), cwd=root, capture_output=True, text=True, encoding="utf-8", errors="replace", check=False)
    if done.returncode != 0:
        raise RuntimeError("git " + " ".join(args) + " failed: " + (done.stderr.strip() or done.stdout.strip()))
    return done.stdout.strip()


def write(root: Path, rel: str, text: str) -> None:
    """One file under a fixture repository, its parents made as needed, as bytes (a Windows text-mode write ends lines in CRLF)."""
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))


def configure(root: Path, hooks: str) -> None:
    """A fresh repository on main, committing as the fixture identity and running the hooks at `hooks`."""
    git(root, "init", "-b", "main")
    for name, value in IDENTITY:
        git(root, "config", name, value)
    git(root, "config", "core.hooksPath", hooks)


def import_tools(*names: str) -> list[ModuleType]:
    """Each named tool, imported out of the tools folder, which python seeds on the path for a tool run as a script."""
    sys.path.insert(0, str(TOOLS))
    try:
        return [importlib.import_module(name) for name in names]
    finally:
        sys.path.remove(str(TOOLS))


def base_env() -> dict[str, str]:
    """The environment a case running the gate's library must not inherit: a parent run's colour and Actions state."""
    env = {name: value for name, value in os.environ.items() if not name.startswith("FL_GATE_")}
    env.pop("GITHUB_ACTIONS", None)
    env.pop("VERBOSE", None)
    env["FL_GATE_COLOR"] = "0"
    env["NO_SPINNER"] = "1"
    return env


def write_shell(path: Path, text: str) -> Path:
    """One shell fixture on disk, `newline=""`, so bash reads no stray carriage return on a Windows checkout."""
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(text)
    return path


def run_shell(
    bash: str, script: Path, *args: str, env: dict[str, str] | None = None, cwd: Path | None = None
) -> subprocess.CompletedProcess[str]:
    """One shell script run to its end, its streams decoded as utf-8 whatever the machine's locale."""
    return subprocess.run(
        (bash, script.as_posix(), *args), capture_output=True, encoding="utf-8", errors="replace", env=env, cwd=cwd, check=False
    )
