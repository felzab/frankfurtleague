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
from collections.abc import Iterator
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

# How long a heartbeat stays still before its tool counts as ended: ten beats of a control sleeper
# nothing stops, never a span of the clock, which a machine stalling every sleeper at once outlasts.
STILL_BEATS: Final = 10
# The tools' own start, then their end once stopped: the second above the watcher's grace
# (`scripts/gate/gate_watch.py :: GRACE_S`), so a stop it had to force reads as what its traps left
# behind rather than as a gate still running.
STARTED_BOUND_S: Final = 60
STOPPED_BOUND_S: Final = 60
WATCH: Final = VERIFY.parent / "gate_watch.py"

# A shell as a harness runs one (`:` stops bash replacing itself); on Windows, each other route to
# the watcher: a wrapper script, a native process, Git's launcher. A POSIX stop signals the whole
# group, so one route there.
LAUNCHERS: Final = (
    ("a shell", "a shell through a script", "a native process", "a native process through Git's launcher") if WINDOWS else ("a shell",)
)
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
        # Git's `bin\bash.exe`, two levels above the `usr\bin\bash.exe` a case runs.
        "a native process through Git's launcher": (sys.executable, "-c", NATIVE, str(Path(BASH).parents[2] / "bin" / "bash.exe"), *gate),
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


@contextlib.contextmanager
def _control() -> Iterator[Path]:
    """A sleeper of the test's own, beating beside the tools until the case is done."""
    beats = new_root("fl-gate-stop-control-")
    sleeper = subprocess.Popen((sys.executable, "-c", SLEEPER, str(beats)), stdin=subprocess.DEVNULL)
    try:
        deadline = time.monotonic() + STARTED_BOUND_S
        # Named by the interpreter's own pid, which a launcher in front of it does not share.
        while not (named := list(beats.iterdir())):
            assert sleeper.poll() is None and time.monotonic() < deadline, "the control sleeper never beat"
            time.sleep(0.05)
        yield named[0]
    finally:
        sleeper.kill()
        sleeper.wait()


def _still_beating(beats: list[Path], control: Path, bound: float = STOPPED_BOUND_S) -> list[Path]:
    """The heartbeats that grew within the control's last `STILL_BEATS` beats once the bound passed, else none."""
    sizes = {beat: -1 for beat in beats}
    # The control's size when each heartbeat last grew.
    grew_at = dict.fromkeys(beats, 0)
    deadline = time.monotonic() + bound
    while True:
        paced = control.stat().st_size
        for beat in beats:
            size = beat.stat().st_size
            if size != sizes[beat]:
                sizes[beat], grew_at[beat] = size, paced
        moving = [beat for beat in beats if paced - grew_at[beat] < STILL_BEATS]
        if not moving or time.monotonic() >= deadline:
            return moving
        time.sleep(0.1)


def test_a_stall_freezing_every_heartbeat_never_reads_as_a_stop(tmp_path: Path) -> None:
    """Paced by a clock, a second's stall of the whole machine passed a stop that had failed, and the cleanup then hid it."""
    tool, frozen = tmp_path / "tool", tmp_path / "control"
    tool.write_bytes(b".")
    frozen.write_bytes(b".")
    assert _still_beating([tool], frozen, bound=1.5) == [tool]


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
    """One case per route a stop takes to the watcher, as `LAUNCHERS` names them: missing any one leaves a gate running past the stop."""
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

        with _control() as control:
            _stop(launcher)
            survivors = _still_beating(list(started.iterdir()), control)
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


# A terminal's Ctrl-C on Windows: the gate typed into a console of its own, with no window to flash
# (`CREATE_NO_WINDOW`), interrupted from inside it once the tools run; its exit status is the gate's.
CONSOLE: Final = 0x0800_0000
CONSOLE_INTERRUPT: Final = """import ctypes, signal, subprocess, sys, time
from pathlib import Path
kernel32 = ctypes.WinDLL("kernel32")
kernel32.SetConsoleCtrlHandler(None, False)
started, tools, log, *gate = sys.argv[1:]
with open(log, "wb") as out:
    child = subprocess.Popen(gate, stdout=out, stderr=subprocess.STDOUT)
    while len(list(Path(started).iterdir())) < int(tools) and child.poll() is None:
        time.sleep(0.1)
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    kernel32.SetConsoleCtrlHandler(None, True)
    kernel32.GenerateConsoleCtrlEvent(0, 0)
    raise SystemExit(child.wait())
"""
INTERRUPTED: Final = 130


def _interrupted(gate: tuple[str, ...], env: dict[str, str], started: Path, log: Path) -> subprocess.Popen[bytes]:
    """The gate, interrupted as its platform's terminal interrupts a run once every tool has started."""
    if WINDOWS:
        command = (sys.executable, "-c", CONSOLE_INTERRUPT, str(started), str(TOOLS), str(log), *gate)
        run = subprocess.Popen(command, env=env, creationflags=CONSOLE)
    else:
        with log.open("wb") as out:
            run = subprocess.Popen(gate, stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT, env=env, start_new_session=True)
        deadline = time.monotonic() + STARTED_BOUND_S
        while len(list(started.iterdir())) < TOOLS and run.poll() is None and time.monotonic() < deadline:
            time.sleep(0.1)
        # The foreground group a terminal's Ctrl-C reaches, a negative pid naming the group it leads.
        os.kill(-run.pid, signal.SIGINT)
    return run


def test_an_interrupt_ends_every_tool_and_leaves_nothing_behind() -> None:
    """Ctrl-C at the terminal: on Windows the console's interrupt reaches no shell without a console of its own and no tool MSYS starts."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    root, env, started, scratch = _tree(STUB_PNPM, STUB_PYTHON.format(interpreter=Path(sys.executable).as_posix()))
    log = started.parent / "gate.log"
    run = _interrupted((BASH, (root / "scripts" / "gate" / "verify.sh").as_posix(), *FLAGS), env, started, log)
    try:
        try:
            status = run.wait(STARTED_BOUND_S + STOPPED_BOUND_S)
        except subprocess.TimeoutExpired:
            raise AssertionError("the interrupted gate was still running") from None
        said = log.read_bytes().decode("utf-8", "replace")
        assert len(list(started.iterdir())) == TOOLS, f"not every tool started:\n{said}"
        with _control() as control:
            survivors = _still_beating(list(started.iterdir()), control)
        assert not survivors, f"the interrupted gate left its tools running: {[beat.name for beat in survivors]}"
        assert status == INTERRUPTED, f"the interrupted gate exited {status}, not as an interrupt:\n{said}"
        left = sorted(path.name for path in scratch.iterdir())
        assert not left, f"the interrupted gate's traps left what they make behind: {left}\n{said}"
    finally:
        for beat in started.iterdir():
            with contextlib.suppress(OSError):
                os.kill(int(beat.name), signal.SIGTERM)
        with contextlib.suppress(OSError):
            run.kill()
        run.wait()


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


# `scripts/gate/gate_watch.py :: _watched` over real processes, in an interpreter of its own: the
# module refuses to load off Windows.
WATCHED: Final = """import os, subprocess, sys
sys.path.insert(0, sys.argv[1])
import gate_watch as watch
me = watch.kernel32.GetCurrentProcess()
later = subprocess.Popen((sys.executable, "-c", "import time; time.sleep(60)"))
try:
    # Created after the process it is asked about, as a pid reused since would be: never its launcher.
    assert watch._watched(later.pid, me) is None, "a process created later was read as this one's launcher"
    assert watch._watched(os.getppid(), me) is not None, "the process that started this one was not watched"
finally:
    later.kill()
    later.wait()
# Held by its Popen, an ended process still opens, and reads as ended.
assert watch._watched(later.pid, me) is None, "an ended launcher was watched"
try:
    # The System process, which no account of a developer's opens.
    watch._watched(4, me)
except OSError:
    pass
else:
    raise SystemExit("a process this account cannot open was read as one that had ended")
"""
REFUSED: Final = 2


def test_the_watcher_tells_an_ended_launcher_from_one_it_cannot_see_or_one_a_reused_pid_names() -> None:
    """Read as ended, a launcher the account cannot open stopped the gate before it ran, naming a launcher that never ended."""
    if WINDOWS:
        done = subprocess.run((sys.executable, "-c", WATCHED, str(WATCH.parent)), capture_output=True, text=True, check=False)
        assert done.returncode == 0, done.stdout + done.stderr
    else:
        done = subprocess.run((sys.executable, str(WATCH), "--gate", "1"), capture_output=True, text=True, check=False)
        assert done.returncode == REFUSED and "a POSIX gate is stopped by a signal" in done.stderr, done.stdout + done.stderr
