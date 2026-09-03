"""SCRIPTS · the throwaway repository the gate-facing suites build, and the readers that drive one

Five modules copy scripts/ into a temporary tree and import the gate out of the copy, so the checker
under test roots at a planted corpus rather than at this repository. Of that tree only the building
and the removal are shared: each module keeps its own corpus, its own plants and its own reset,
because a fixture shared where a case mutates it would let a planted violation stop being found. The
readers below hold no state and are shared whole -- a module spelling one for itself answers a
question nothing else is held to, which is how two copies of one reader come to disagree.

Invariants:
  Nothing here imports pytest: `scripts/pyrightconfig.json` declares no virtualenv, so it would not resolve.
  Every fixture tree is registered here and removed by `pytest_sessionfinish`, inside the run rather than after it.
"""

from __future__ import annotations

import ast
import contextlib
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


def lift_function(script: Path, name: str, indent: str = "") -> str:
    """One shell function's source, by its opening and closing lines, dedented to the margin.

    Read rather than reimplemented: a copy in a test passes while the gate's own copy regresses.
    """
    lines = script.read_text(encoding="utf-8").splitlines()
    # Anchored on the opening line's own text rather than on a position, so a function that moves
    # inside its script is still found.
    start = next((i for i, line in enumerate(lines) if line.startswith(f"{indent}{name}() {{")), -1)
    assert start >= 0, f"{_cited(script)} no longer defines {name}"
    end = next((i for i in range(start + 1, len(lines)) if lines[i] == f"{indent}}}"), -1)
    assert end > start, f"{_cited(script)}'s {name} has no closing line"
    return "\n".join(line.removeprefix(indent) for line in lines[start : end + 1])


def declared(source: Path, name: str) -> Any:
    """One module-level annotated constant, as its own source declares it.

    Never imported: a checker raises on an interpreter below its own floor, and a module another
    fixture cached would answer for the copy under test.
    """
    for node in ast.walk(ast.parse(source.read_text(encoding="utf-8"))):
        if isinstance(node, ast.AnnAssign) and node.value is not None and getattr(node.target, "id", "") == name:
            return ast.literal_eval(node.value)
    raise AssertionError(f"{_cited(source)} no longer declares {name}")


def _cited(path: Path) -> str:
    """A path as a citation, and its bare name where it sits in a fixture tree instead."""
    try:
        return path.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.name


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
