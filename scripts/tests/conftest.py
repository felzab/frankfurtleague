"""SCRIPTS · the readers and runners the scripts' suites share

The readers hold no state and are shared whole -- a module spelling one for itself answers a question
nothing else is held to, which is how two copies of one reader come to disagree.

Invariants:
  Every fixture tree is registered here and removed by `pytest_sessionfinish`, inside the run rather than after it.
"""

from __future__ import annotations

import ast
import contextlib
import functools
import importlib
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path
from types import ModuleType
from typing import Any, Final

import pytest

REPO_ROOT: Final = Path(__file__).resolve().parent.parent.parent

# Not a skip condition: every script under `scripts/` is bash, so a machine without one cannot run
# the gate at all, and a contract silently skipped is what the suites driving one exist to stop.
BASH: Final = shutil.which("bash")

WINDOWS: Final = sys.platform == "win32"
# The runtime Git Bash's own bash runs on, which none of the launchers in front of it sits beside.
MSYS_RUNTIME: Final = "msys-2.0.dll"

_OWNED: list[Path] = []


def write(root: Path, rel: str, text: str) -> None:
    """One corpus file under a fixture repository, its parents made as needed."""
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    # Bytes (CLAUDE.md §6).
    path.write_bytes(text.encode("utf-8"))


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


_SECOND_DEFINITION_RE: Final = re.compile(r"\b[A-Za-z_][\w-]*\s*\(\)\s*\{")


@functools.cache
def _parses(text: str) -> bool:
    """bash's own verdict that `text` is whole, asked of bash because a pattern misreads quotes, expansions and here-documents."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    said = subprocess.run([BASH, "-n"], input=text.encode("utf-8"), capture_output=True, check=False)
    # A warning, such as a here-document running to the end of the text, is a body bash read past the text.
    return said.returncode == 0 and not said.stderr


def _joined(lines: tuple[str, ...]) -> str:
    return "\n".join(lines) + "\n"


@functools.cache
def _reads_as_code(lines: tuple[str, ...], at: int) -> bool:
    """Whether bash, over text it parses whole, reads line `at` as code rather than as a here-document's or a string's text.

    A lone `)` is a syntax error wherever a command may start and plain text inside either.
    """
    return not _parses(_joined((*lines[:at], ")", *lines[at:])))


def lift_function(script: Path, name: str, indent: str = "") -> str:
    """One shell function's source, its code dedented to the margin: from its opening line to the first line bash ends it on.

    Read rather than reimplemented: a copy in a test passes while the gate's own copy regresses.
    """
    lines = tuple(script.read_text(encoding="utf-8").splitlines())
    assert _parses(_joined(lines)), f"{_cited(script)} does not parse whole, so {name}'s lines cannot be told code from text"
    # Anchored on the opening line's own text rather than on a position, so a function that moves
    # inside its script is still found. The run of spaces is the column `scripts/gate/verify.sh`
    # aligns a block of definitions on.
    opens = re.compile(re.escape(indent) + re.escape(name) + r"\(\) +\{")
    start, opener = next(((i, found) for i, line in enumerate(lines) if (found := opens.match(line)) and _reads_as_code(lines, i)), (-1, None))
    assert opener is not None, f"{_cited(script)} no longer defines {name}"
    opening = lines[start]
    # bash's verdict is on the whole line, so a second definition opened there would answer for this one.
    assert not _SECOND_DEFINITION_RE.search(opening, opener.end()), f"{_cited(script)}'s {name} shares its opening line: {opening}"
    # Only a line opening with a brace at the definition's own indent is asked, each question costing
    # a bash process; a body closed on any other line runs on to a later block's, refused below.
    closers = (start, *(i for i in range(start + 1, len(lines)) if lines[i].startswith(indent + "}")))
    end = next((i for i in closers if _parses(_joined(lines[start : i + 1]))), -1)
    assert end >= start, f"{_cited(script)}'s {name} has no line at its indent that ends what its opening line begins"
    run = lines[start : end + 1]
    assert end == start or not _SECOND_DEFINITION_RE.search(run[-1]), f"{_cited(script)}'s {name} shares its closing line: {run[-1]}"
    # Code at or left of the definition's own column inside the run is code after the function's end.
    beyond = [line for at, line in enumerate(run[1:-1], 1) if _outdented(line, indent) and _reads_as_code(run, at)]
    assert not beyond, f"{_cited(script)}'s {name} ends before the line closing it, which is a later block's: {beyond[0]}"
    source = "\n".join(run)
    dedented = "\n".join(line.removeprefix(indent) for line in run)
    if not indent or _defines_alike(name, source, dedented):
        return dedented
    # A here-document's body and a string's later lines are text, whose leading spaces are their own: dedented,
    # a body line reading as the terminator ends the document early. Asked line by line only here, a process each.
    kept = "\n".join(line if at and not _reads_as_code(run, at) else line.removeprefix(indent) for at, line in enumerate(run))
    assert _defines_alike(name, source, kept), f"{_cited(script)}'s {name} reads otherwise once dedented: {kept}"
    return kept


@functools.cache
def _defines_alike(name: str, first: str, second: str) -> bool:
    """bash's verdict that both texts define `name` alike: its own printing drops code's indentation and keeps text's."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    probe = f'{first}\nprinted="$(declare -f {name})"\nunset -f {name}\n{second}\n[[ "$printed" == "$(declare -f {name})" ]]\n'
    said = subprocess.run([BASH, "-s"], input=probe.encode("utf-8"), capture_output=True, check=False)
    return said.returncode == 0


def _outdented(line: str, indent: str) -> bool:
    return bool(line.strip()) and len(line) - len(line.lstrip()) <= len(indent)


def lift_assignment(script: Path, name: str) -> str:
    """One top-level shell assignment: an array on one line, a double-quoted value on one, or a single-quoted one of any length.

    Read rather than restated, for `lift_function`'s reason.
    """
    found = re.search(rf"""^{name}=(\(.*\)|"[^"\n]*"|'[^']*')$""", script.read_text(encoding="utf-8"), re.MULTILINE)
    assert found is not None, f"{_cited(script)} assigns no {name}"
    return found.group(0)


def declared(source: Path, name: str) -> Any:
    """One module-level annotated constant, as its own source declares it.

    Read rather than imported: a module another fixture cached would answer for the copy under test.
    """
    for node in ast.walk(ast.parse(source.read_text(encoding="utf-8"))):
        if isinstance(node, ast.AnnAssign) and node.value is not None and getattr(node.target, "id", "") == name:
            return ast.literal_eval(node.value)
    raise AssertionError(f"{_cited(source)} no longer declares {name}")


def details(findings: list) -> str:
    """Every finding's text as one string, for a case asserting on what a run reported."""
    return "\n".join(finding.detail for finding in findings)


def severities(findings: list) -> list:
    """The severities a run reported, so a case pins how many findings it caused as well as which."""
    return [finding.severity for finding in findings]


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
