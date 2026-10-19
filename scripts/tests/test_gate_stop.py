"""SCRIPTS · a stopped gate leaves nothing it started running, on Windows as on POSIX.

Each case stops the real gate the way its platform stops a run -- a signal to the launcher's process
group on POSIX, the launcher alone ended on Windows, where no signal reaches past it -- and then
watches the tools the gate had started and the scratch its shells had made. A tool still running is a
build writing for a reader who has gone; a directory left behind is a trap the stop never ran.
"""

from __future__ import annotations

import contextlib
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Final

import pytest
from conftest import BASH, WINDOWS, base_env, copy_scripts, declared, lift_function, new_root, run_shell, write_shell

VERIFY: Final = Path(__file__).resolve().parent.parent / "gate" / "verify.sh"

# Three scopes off a runner: the scope pool runs, two workers run their tool in place and the
# frontend's opens a pool of its own -- every shape a stop has to reach, and a directory each pool's
# opener reclaims.
FLAGS: Final = ("--frontend",)
TOOLS: Final = 3

# A heartbeat rather than a pid: a file that stops growing is a process that has ended, on every
# platform alike. Bounded, so a red case leaves nothing past it.
SLEEPER: Final = """import os, sys, time
beat = os.path.join(sys.argv[1], str(os.getpid()))
deadline = time.monotonic() + 120
while time.monotonic() < deadline:
    with open(beat, "ab") as handle:
        handle.write(b".")
    time.sleep(0.1)
"""

# The tools those scopes start.
STUB_PNPM: Final = """#!/usr/bin/env bash
case "${1:-}" in
  format:check|test|typecheck:only) "$FL_STUB_PYTHON" "$FL_STUB_SLEEPER" "$FL_STUB_LOG" ;;
esac
exit 0
"""

STUB_PYTHON: Final = """#!/usr/bin/env bash
exec "{interpreter}" "$@"
"""

# How long a heartbeat stays still before its tool counts as ended: ten beats.
STILL_S: Final = 1.0
# The tools' own start, then their end once stopped: the second above the watcher's grace
# (`scripts/gate/gate_watch.py :: GRACE_S`), so a stop it had to force reads as what its traps left
# behind rather than as a gate still running.
STARTED_BOUND_S: Final = 60
STOPPED_BOUND_S: Final = 60
WATCH: Final = VERIFY.parent / "gate_watch.py"

# A shell as a harness runs a command, `:` keeping bash from replacing itself with the gate; one
# running it through a script, which outlives the shell a stop ends; and a native process, leaving
# MSYS no parent to name.
LAUNCHERS: Final = ("a shell", "a shell through a script", "a native process")
WRAPPER: Final = """#!/usr/bin/env bash
"$@"
:
"""
NATIVE: Final = "import subprocess, sys; raise SystemExit(subprocess.call(sys.argv[1:]))"


def _launch(kind: str, verify: Path, env: dict[str, str], wrapper: Path) -> subprocess.Popen[bytes]:
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    gate = (verify.as_posix(), *FLAGS)
    commands = {
        "a shell": (BASH, "-c", '"$0" "$@"; :', *gate),
        "a shell through a script": (BASH, "-c", '"$BASH" "$0" "$@"; :', wrapper.as_posix(), *gate),
        "a native process": (sys.executable, "-c", NATIVE, BASH, *gate),
    }
    return subprocess.Popen(
        commands[kind], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, start_new_session=True
    )


def _stop(launcher: subprocess.Popen[bytes]) -> None:
    """The platform's own stop: job control signals a POSIX shell's group, and Windows ends the one process."""
    if WINDOWS:
        launcher.kill()
    else:
        # A negative pid names the process group the launcher leads.
        os.kill(-launcher.pid, signal.SIGTERM)


def _still_beating(beats: list[Path]) -> list[Path]:
    """The heartbeats still growing once every other one has stayed still for `STILL_S`, or the bound passed."""
    sizes = {beat: -1 for beat in beats}
    still_since = dict.fromkeys(beats, time.monotonic())
    deadline = time.monotonic() + STOPPED_BOUND_S
    while time.monotonic() < deadline:
        now = time.monotonic()
        for beat in beats:
            size = beat.stat().st_size
            if size != sizes[beat]:
                sizes[beat], still_since[beat] = size, now
        if all(now - since >= STILL_S for since in still_since.values()):
            return []
        time.sleep(0.1)
    return [beat for beat in beats if time.monotonic() - still_since[beat] < STILL_S]


def _tree(pnpm: str, python3: str) -> tuple[Path, dict[str, str], Path, Path]:
    """A copy of `scripts/` whose only tools are stubs: its root, the gate's environment, where the tools report, and its scratch."""
    root = new_root("fl-gate-stop-")
    copy_scripts(root / "scripts")
    (root / "fl_frontend" / "node_modules").mkdir(parents=True)
    stubs = new_root("fl-gate-stop-stubs-")
    for name, text in (("pnpm", pnpm), ("python3", python3)):
        os.chmod(write_shell(stubs / name, text), 0o755)
    started = stubs / "started"
    started.mkdir()
    scratch = stubs / "tmp"
    scratch.mkdir()
    env = base_env()
    env["PATH"] = str(stubs) + os.pathsep + env["PATH"]
    env["FL_STUB_LOG"] = str(started)
    env["FL_STUB_PYTHON"] = Path(sys.executable).as_posix()
    env["FL_STUB_SLEEPER"] = str(write_shell(stubs / "sleeper.py", SLEEPER))
    env["TMPDIR"] = scratch.as_posix()
    return root, env, started, scratch


@pytest.mark.parametrize("kind", list(LAUNCHERS))
def test_stopping_the_gate_ends_every_tool_it_started(kind: str) -> None:
    """Started by a shell, as a harness or a terminal starts it, through a wrapper script, and by a native process.

    Three routes to the watcher: MSYS's parent, an MSYS ancestor beyond a parent left running, and
    Windows' own parent.
    """
    assert float(declared(WATCH, "GRACE_S")) < STOPPED_BOUND_S, "a stop the watcher forced would read as a gate still running"
    root, env, started, scratch = _tree(STUB_PNPM, STUB_PYTHON.format(interpreter=Path(sys.executable).as_posix()))
    launcher = _launch(kind, root / "scripts" / "gate" / "verify.sh", env, write_shell(started.parent / "wrapper.sh", WRAPPER))
    output: list[bytes] = []
    reader = threading.Thread(target=lambda: output.append(launcher.stdout.read() if launcher.stdout else b""), daemon=True)
    reader.start()
    try:
        deadline = time.monotonic() + STARTED_BOUND_S
        while len(list(started.iterdir())) < TOOLS:
            assert launcher.poll() is None, f"the gate ended before every tool started:\n{_said(reader, output)}"
            assert time.monotonic() < deadline, f"not every tool started:\n{_said(reader, output)}"
            time.sleep(0.1)

        _stop(launcher)
        survivors = _still_beating(list(started.iterdir()))
        assert not survivors, f"the stopped gate left its tools running: {[beat.name for beat in survivors]}"
        reader.join(STOPPED_BOUND_S)
        # Every process holding the gate's output closes it as it ends, the gate's own included.
        assert not reader.is_alive(), "the stopped gate itself was still running"
        left = sorted(path.name for path in scratch.iterdir())
        assert not left, f"the stopped gate's traps left what they make behind: {left}\n{_said(reader, output)}"
    finally:
        for beat in started.iterdir():
            with contextlib.suppress(OSError):
                os.kill(int(beat.name), signal.SIGTERM)
        with contextlib.suppress(OSError):
            launcher.kill()
        launcher.wait()


def _said(reader: threading.Thread, output: list[bytes]) -> str:
    """What the gate printed, where it has ended and closed its output."""
    reader.join(0)
    return output[0].decode("utf-8", "replace") if output else "(the gate is still running; its output is unread)"


# `scripts/gate/verify.sh :: join_the_job` with no interpreter to watch by, under each `$OSTYPE` it
# can be handed: bash sets the variable at start, and a fixture assigns it after.
UNWATCHED_FIXTURE: Final = """set -euo pipefail
OSTYPE={ostype}
any_python() {{ return 1; }}
python_at_floor() {{ return 1; }}
UNWATCHED=""
{join}
join_the_job
printf '%s' "$UNWATCHED"
"""


@pytest.mark.parametrize(("ostype", "unwatched"), [("msys", True), ("cygwin", True), ("linux-gnu", False)])
def test_a_windows_run_nothing_can_watch_says_so(ostype: str, unwatched: bool, tmp_path: Path) -> None:
    """Unwatched, the run still reaches its verdict, so this line is all that tells a reader a stop would leave its tools running."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    fixture = UNWATCHED_FIXTURE.format(ostype=ostype, join=lift_function(VERIFY, "join_the_job"))
    done = run_shell(BASH, write_shell(tmp_path / "join.sh", fixture), env=base_env())
    assert done.returncode == 0, done.stdout + done.stderr
    assert bool(done.stdout) is unwatched, f"{ostype}: {done.stdout!r}"


# The first `python3` on PATH, under the checkers' floor, so nothing can watch the run.
BELOW_FLOOR: Final = """#!/usr/bin/env bash
printf 'Python 3.9.13\\n'
"""
QUICK_PNPM: Final = """#!/usr/bin/env bash
exit 0
"""
UNWATCHED_NOTICE: Final = "this run is unwatched"


def test_an_unwatched_run_says_so_where_a_watcher_was_owed() -> None:
    """On Windows alone: a POSIX run is stopped through its group and owes no watcher, so the line there would be false."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    root, env, _, _ = _tree(QUICK_PNPM, BELOW_FLOOR)
    done = run_shell(BASH, root / "scripts" / "gate" / "verify.sh", "--format", env=env)
    assert done.returncode == 0, done.stdout + done.stderr
    assert (UNWATCHED_NOTICE in done.stdout) is WINDOWS, done.stdout
