"""SCRIPTS · the interpreter floor, decided in bash before any checker is compiled.

Below the floor every checker dies compiling and python exits 1 -- a finding's code -- so the machine
would be reported as a defect in the change. `scripts/lib/_lib.sh :: python_at_floor` is the one
place that decides and `.githooks/commit-msg :: at_floor` mirrors it, sourcing the library into a
commit hook installing an ERR trap that aborts the commit. Both are driven against a stub per shape
a real interpreter answers with, so a copy that has drifted fails here rather than at a commit.

Invariants:
  The two floors are one number: the hook's is read out of its own source rather than respelled here.
"""

from __future__ import annotations

import os
import re
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Final

from conftest import base_env, configure, copy_scripts, lift_function, new_root, run_shell, write, write_shell

SCRIPTS: Final = Path(__file__).resolve().parent.parent
REPO_ROOT: Final = SCRIPTS.parent
LIB: Final = SCRIPTS / "lib" / "_lib.sh"
HOOK: Final = REPO_ROOT / ".githooks" / "commit-msg"

# Not a skip condition, for `scripts/tests/test_exit_contract.py :: BASH`'s reason.
BASH: Final = shutil.which("bash")

# One stub per shape a real interpreter answers with, the pair either side of the floor being the
# whole comparison.
SHAPES: Final[tuple[tuple[str, str, bool], ...]] = (
    ("at the floor", 'printf "Python 3.14.4\\n"', True),
    ("one minor below the floor", 'printf "Python 3.13.9\\n"', False),
    ("far below the floor", 'printf "Python 3.9.13\\n"', False),
    # No ceiling: a version above the floor is above it whatever the major says.
    ("a major above the floor", 'printf "Python 4.0.0\\n"', True),
    # The three below answer nothing a version reads out of, and a guard taking silence for assent
    # hands each of them a checker it cannot compile.
    ("a python 2, which answers on stderr", 'printf "Python 2.7.18\\n" >&2', False),
    ("the Windows Store stub, which answers nothing", "exit 9009", False),
    ("a shim reporting a missing command", 'printf "pyenv: python: command not found\\n"', False),
)

# Both implementations against one table: the hook's copy is reached only by a commit on a machine
# below the floor, which is the one run nobody makes on purpose.
SUBJECTS: Final[tuple[tuple[Path, str], ...]] = ((LIB, "python_at_floor"), (HOOK, "at_floor"))


def _declared_floor(source: Path) -> str:
    """The floor one file declares, as one quoted value."""
    found = re.search(r'^PYTHON_FLOOR="([^"]+)"$', source.read_text(encoding="utf-8"), re.MULTILINE)
    assert found is not None, f"{source.name} declares no PYTHON_FLOOR as one quoted value"
    return found.group(1)


def _preamble(source: Path, name: str) -> tuple[str, ...]:
    """What a fixture needs in front of it before either guard can be called."""
    if source == LIB:
        return (f'source "{LIB.as_posix()}"',)
    # The hook is never sourced, so its own floor line comes with the lifted function or the
    # comparison reads a name nothing set.
    return ("set -euo pipefail", f'PYTHON_FLOOR="{_declared_floor(HOOK)}"', lift_function(HOOK, name))


def _run(lines: tuple[str, ...]) -> tuple[int, str]:
    """One fixture shell, run to its end."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    with tempfile.TemporaryDirectory() as scratch:
        fixture = Path(scratch) / "floor.sh"
        done = run_shell(BASH, write_shell(fixture, "\n".join(("#!/usr/bin/env bash", *lines, ""))), env=base_env())
    return done.returncode, done.stdout + done.stderr


def _stub(directory: Path, body: str) -> Path:
    """One stand-in interpreter, absolute: `_lib.sh` cds on source, so a relative name stops resolving."""
    path = write_shell(directory / "python-stub", "\n".join(("#!/usr/bin/env bash", "set -u", body, "")))
    os.chmod(path, 0o755)
    return path


def test_both_guards_read_every_interpreter_shape_the_same_way(tmp_path: Path) -> None:
    """The hook's copy answers each shape as the library does, or a commit is refused where the gate would run."""
    wrong: list[str] = []
    for source, name in SUBJECTS:
        for index, (shape, body, at_floor) in enumerate(SHAPES):
            room = tmp_path / f"{name}-{index}"
            room.mkdir()
            stub = _stub(room, body)
            lines = (*_preamble(source, name), f'if {name} "{stub.as_posix()}"; then printf "at-floor\\n"; else printf "below\\n"; fi')
            rc, out = _run(lines)
            said = out.strip().splitlines()[-1] if out.strip() else "<nothing>"
            want = "at-floor" if at_floor else "below"
            if rc != 0 or said != want:
                wrong.append(f"{source.name} :: {name}: {shape} read as {said!r}, expected {want!r} (exit {rc})")
    assert not wrong, "\n".join(wrong)


def test_the_hook_mirrors_the_library_s_floor() -> None:
    """One number in two files: a drifted copy refuses commits on a machine the gate itself would run on."""
    assert _declared_floor(HOOK) == _declared_floor(LIB)


def test_the_library_names_the_version_it_read(tmp_path: Path) -> None:
    """A refusal that cannot say what it found sends a reader to the wrong interpreter."""
    stub = _stub(tmp_path, 'printf "Python 3.9.13\\n"')
    rc, out = _run((f'source "{LIB.as_posix()}"', f'python_at_floor "{stub.as_posix()}" || true', 'printf "found=%s\\n" "$PYTHON_FOUND"'))
    assert rc == 0, out
    assert "found=python 3.9" in out, out


def test_the_library_forgets_what_it_read_when_it_cannot_read_one(tmp_path: Path) -> None:
    """A value left standing from the previous call would put another interpreter's version in this refusal."""
    room = tmp_path / "below"
    room.mkdir()
    below = _stub(room, 'printf "Python 3.9.13\\n"')
    silent = _stub(tmp_path, "exit 9009")
    lines = (
        f'source "{LIB.as_posix()}"',
        f'python_at_floor "{below.as_posix()}" || true',
        f'python_at_floor "{silent.as_posix()}" || true',
        'printf "found=%s\\n" "${PYTHON_FOUND:-<empty>}"',
    )
    rc, out = _run(lines)
    assert rc == 0, out
    assert "found=<empty>" in out, out


def test_a_run_the_floor_refuses_ends_at_two_and_never_reaches_the_work(tmp_path: Path) -> None:
    """Exit 2 rather than 1: `.claude/CLAUDE.md` §7 **exit codes** -- no change to the tree answers for an old interpreter."""
    stub = _stub(tmp_path, 'printf "Python 3.9.13\\n"')
    rc, out = _run((f'source "{LIB.as_posix()}"', f'require_python_floor "{stub.as_posix()}"', 'printf "the run went on\\n"'))
    assert rc == 2, out
    assert "python 3.9" in out, out
    assert _declared_floor(LIB) in out, out
    assert "uv sync --dev" in out, out
    assert "the run went on" not in out, out


def test_a_run_the_floor_admits_prints_nothing_and_carries_on(tmp_path: Path) -> None:
    """A guard that spoke on the pass path would print a line on every gate run, which is where a real refusal gets lost."""
    stub = _stub(tmp_path, 'printf "Python 3.14.4\\n"')
    rc, out = _run((f'source "{LIB.as_posix()}"', f'require_python_floor "{stub.as_posix()}"', 'printf "the run went on\\n"'))
    assert rc == 0, out
    assert out.strip() == "the run went on", out


# The word the hook prints when no candidate clears the floor, which is what its own skip is read by.
SKIPPED_FOR_THE_FLOOR: Final = "or newer here"


def _hook_run(interpreter: str) -> tuple[int, str]:
    """The hook, end to end, in a repository whose only reachable interpreter is `interpreter`.

    A repository of its own: the hook resolves its root through git, and the real one holds a
    virtualenv the candidate list reaches before PATH.
    """
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    root = new_root("fl-commit-msg-")
    copy_scripts(root / "scripts")
    (root / ".githooks").mkdir()
    shutil.copy2(HOOK, root / ".githooks" / "commit-msg")
    configure(root, hooks=str(root / ".githooks"))
    write(root, "message", "Backend: a subject the checker will judge\n")
    bin_dir = root / "bin"
    bin_dir.mkdir()
    for name in ("python3", "python"):
        os.chmod(write_shell(bin_dir / name, "\n".join(("#!/usr/bin/env bash", "set -u", interpreter, ""))), 0o755)
    env = base_env()
    # Prepended rather than replaced: the hook runs git, and bash needs its own tools on PATH.
    env["PATH"] = str(bin_dir) + os.pathsep + env["PATH"]
    done = run_shell(BASH, root / ".githooks" / "commit-msg", (root / "message").as_posix(), env=env, cwd=root)
    return done.returncode, done.stdout + done.stderr


def test_the_hook_skips_rather_than_refusing_a_commit_on_a_machine_below_the_floor() -> None:
    """The failure this guard exists for: a `SyntaxError` exits 1, which this hook reads as a finding and blocks on."""
    rc, out = _hook_run('printf "Python 3.9.13\\n"')
    assert rc == 0, out
    assert SKIPPED_FOR_THE_FLOOR in out, out


def test_the_hook_reaches_the_checker_when_the_interpreter_clears_the_floor() -> None:
    """The contrast the case above needs: a hook that skipped unconditionally would pass it and check nothing."""
    rc, out = _hook_run(f'exec "{Path(sys.executable).as_posix()}" "$@"')
    assert SKIPPED_FOR_THE_FLOOR not in out, f"exit {rc}: {out}"
