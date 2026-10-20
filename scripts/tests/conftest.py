"""SCRIPTS · the throwaway repository the gate-facing suites build, and the readers that drive one

The gate-facing modules copy scripts/ into a temporary tree and import the gate out of the copy, so
the checker under test roots at a planted corpus rather than at this repository. Of that tree only
the building and the removal are shared: each module keeps its own corpus, its own plants and its
own reset, because a fixture shared where a case mutates it would let a planted violation stop being
found. The readers below hold no state and are shared whole -- a module spelling one for itself
answers a question nothing else is held to, which is how two copies of one reader come to disagree.

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

# pytest's own, for the guard's test to run a session through it; and the refusal of a test module
# that collects nothing.
pytest_plugins = ("pytester", "collection")

# So no case depends on the machine's git config.
IDENTITY: Final[tuple[tuple[str, str], ...]] = (
    ("user.name", "fixture"),
    ("user.email", "fixture@example.invalid"),
    ("commit.gpgsign", "false"),
)

# Not a skip condition: every script under `scripts/` is bash, so a machine without one cannot run
# the gate at all, and a contract silently skipped is what the suites driving one exist to stop.
BASH: Final = shutil.which("bash")

WINDOWS: Final = sys.platform == "win32"
# The runtime Git Bash's own bash runs on, which none of the launchers in front of it sits beside.
MSYS_RUNTIME: Final = "msys-2.0.dll"

_OWNED: list[Path] = []


def _failure(args: tuple[str, ...], said: str) -> RuntimeError:
    """The failure both readers below raise, carrying git's own words.

    Without them the next case fails for a reason nothing explains.
    """
    return RuntimeError("git " + " ".join(args) + " failed: " + said)


def git(root: Path, *args: str) -> str:
    """One git command answering its stdout as a message, inside a fixture repository or this one."""
    # `errors="replace"`: a non-utf-8 byte in a fixture's path or message would end the run in a
    # decode error rather than in the finding.
    done = subprocess.run(("git", *args), cwd=root, capture_output=True, text=True, encoding="utf-8", errors="replace", check=False)
    if done.returncode != 0:
        raise _failure(args, done.stderr.strip() or done.stdout.strip())
    return done.stdout.strip()


def _listed(root: Path, *args: str) -> list[str]:
    """One git listing's NUL-separated paths, decoded as a filename.

    `git` above reads a message: it strips a leading space off a path and replaces a byte it cannot
    decode, either of which rewrites a name a caller opens.
    """
    done = subprocess.run(("git", *args), cwd=root, capture_output=True, check=False)
    if done.returncode != 0:
        raise _failure(args, done.stderr.decode("utf-8", "replace").strip())
    return [os.fsdecode(entry) for entry in done.stdout.split(b"\0") if entry]


def write(root: Path, rel: str, text: str) -> None:
    """One corpus file under a fixture repository, its parents made as needed."""
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    # Bytes (CLAUDE.md §6).
    path.write_bytes(text.encode("utf-8"))


def copy_scripts(destination: Path, *, source: Path = REPO_ROOT / "scripts") -> None:
    """Every file in one tree that git does not ignore, copied into a fresh directory.

    A walk raises on a path that vanished mid-listing, and the scripts scope has its own tools
    reading this tree while a fixture copies it.
    """
    destination.mkdir(parents=True, exist_ok=True)
    # `--others` beside `--cached`: a module a branch has only just written is one the copy must
    # still hold. The tree's own ignore files and never `--exclude-standard`, whose global half
    # would leave a fixture holding what one developer's configuration says.
    for rel in _listed(source, "ls-files", "--cached", "--others", "--exclude-per-directory=.gitignore", "-z"):
        # The fixture holds the gate's own corpus, and the suite that drives the gate is no part of it.
        if rel.startswith("tests/"):
            continue
        origin = source / rel
        # A tracked path the working tree has dropped is still in the index, and git reads it as
        # deleted: copying it would take out every module's fixture at build time, naming no cause.
        if not origin.is_file():
            continue
        target = destination / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        # copy2 rather than a read and a write: it copies bytes and carries the executable bit.
        shutil.copy2(origin, target)


def configure(root: Path, hooks: str) -> None:
    """A fresh repository on main, committing as the fixture identity and running no hook.

    The hooks path is the caller's: the fixtures disagree on it.
    """
    git(root, "init", "-b", "main")
    for name, value in IDENTITY:
        git(root, "config", name, value)
    git(root, "config", "core.hooksPath", hooks)


def withdraw(*names: str) -> None:
    """Drop a module and its submodules from the cache.

    `scripts/tests/test_check_docs.py :: _load` imports a copy of scripts/ under the names
    `import_scripts` gives this repository's modules, and `checker_kernel` holds REPO_ROOT: whichever
    loads second is otherwise handed the first one's tree.
    """
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


# What `shell: bash` expands to on the runner, less the two flags that only skip start-up files.
RUNNER_SHELL: Final = "set -eo pipefail\n"
# A job's step, and the keys under it, at the indents both workflows keep.
_STEP_OPEN_RE: Final = re.compile(r"^      - ")
_STEP_NAME_RE: Final = re.compile(r"^      (?:- |  )name: (.+)$")
_RUN_BLOCK_RE: Final = re.compile(r"^        run: \|$")
_RUN_LINE: Final = "          "


def step_script(workflow: Path, name: str) -> str:
    """The `run: |` text of the step `name`, dedented to the margin, behind the runner's shell flags.

    Read rather than copied, for `lift_function`'s reason.
    """
    steps: list[list[str]] = []
    inside = False
    for line in workflow.read_text(encoding="utf-8").splitlines():
        if _STEP_OPEN_RE.match(line):
            steps.append([line])
            inside = True
        elif inside and (not line or line.startswith("        ")):
            steps[-1].append(line)
        else:
            inside = False
    named = [step for step in steps if any((found := _STEP_NAME_RE.match(line)) and found[1] == name for line in step)]
    assert len(named) == 1, f"{_cited(workflow)} names {len(named)} steps {name!r}, where the case reads exactly one"
    opened = next((i for i, line in enumerate(named[0]) if _RUN_BLOCK_RE.match(line)), -1)
    assert opened >= 0, f"{_cited(workflow)}'s {name!r} has no `run: |` block"
    block: list[str] = []
    for line in named[0][opened + 1 :]:
        # A key after the block, such as an `env:`, ends it.
        if line and not line.startswith(_RUN_LINE):
            break
        block.append(line.removeprefix(_RUN_LINE))
    text = "\n".join(block).strip("\n") + "\n"
    # An expression would reach the runner substituted and this case unsubstituted.
    assert "${{" not in text, f"{name!r} interpolates an expression into its script"
    return RUNNER_SHELL + text


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
    """One shell function's source, dedented to the margin: from its opening line to the first line bash ends it on.

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
    return "\n".join(line.removeprefix(indent) for line in run)


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
