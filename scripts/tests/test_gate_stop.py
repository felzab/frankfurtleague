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


def _drive_watcher(snippet: str) -> None:
    """One case against the watcher's own functions on Windows, and its refusal to load anywhere else."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    if WINDOWS:
        done = subprocess.run((sys.executable, "-c", snippet, str(WATCH.parent), BASH), capture_output=True, text=True, check=False)
        assert done.returncode == 0, done.stdout + done.stderr
    else:
        done = subprocess.run((sys.executable, str(WATCH), "--gate", "1"), capture_output=True, text=True, check=False)
        assert done.returncode == REFUSED and "a POSIX gate is stopped by a signal" in done.stderr, done.stdout + done.stderr


def test_the_watcher_tells_an_ended_launcher_from_one_it_cannot_see_or_one_a_reused_pid_names() -> None:
    """Read as ended, a launcher the account cannot open stopped the gate before it ran, naming a launcher that never ended."""
    _drive_watcher(WATCHED)


# `scripts/gate/gate_watch.py :: wind_down` over a listing one of whose members has ended since, as a
# member does between the listing and its reads, and a registry the gate's own trap has removed.
ENDED_MEMBER: Final = """import subprocess, sys, tempfile
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import gate_watch as watch
kernel32 = watch.kernel32
job = kernel32.CreateJobObjectW(None, None)
def joined():
    process = subprocess.Popen((sys.executable, "-c", "import time; time.sleep(60)"), stdin=subprocess.DEVNULL)
    handle = kernel32.OpenProcess(watch.GATE_ACCESS, False, process.pid)
    assert kernel32.AssignProcessToJobObject(job, handle)
    kernel32.CloseHandle(handle)
    return process
ended, running = joined(), joined()
listed = watch._job_pids(job)
# Its Popen keeps its handle, as a parent waiting on it does, so its pid still opens.
ended.kill()
ended.wait()
watch._job_pids = lambda _: listed
try:
    outlived = watch.wind_down(job, Path(sys.argv[2]).parent / "kill.exe", Path(tempfile.mkdtemp()) / "removed")
    assert outlived == 0, outlived
    assert running.wait(timeout=30) == watch.EXIT_INTERRUPTED, "the member still running was never ended"
finally:
    running.kill()
"""


def test_a_member_ending_while_the_stop_reads_the_job_never_loses_the_stop() -> None:
    """Read as a crash, the watcher ended nothing, and a gate interrupted in its start-up ran on to a green verdict."""
    _drive_watcher(ENDED_MEMBER)


# `scripts/gate/gate_watch.py :: main` whose wind-down fails: the gate a sleeper of MSYS's own, as
# the watcher reads `kill.exe` beside it, and the interrupt the first thing to end.
FAILED_WIND_DOWN: Final = """import subprocess, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import gate_watch as watch
gate = subprocess.Popen((str(Path(sys.argv[2]).parent / "sleep.exe"), "60"), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
watch.first_to_end = lambda *processes: processes[1]
def failing(job, kill, registry):
    raise OSError("a wind-down that failed")
watch.wind_down = failing
sys.argv = ["gate_watch", "--gate", str(gate.pid)]
try:
    watch.main()
except OSError:
    pass
else:
    raise SystemExit("the wind-down's failure was never raised")
try:
    gate.wait(timeout=30)
except subprocess.TimeoutExpired:
    gate.kill()
    raise SystemExit("a wind-down that failed left the job running") from None
"""


def test_a_wind_down_that_fails_still_ends_the_job() -> None:
    """The graceful phase is a courtesy; the job's end is the stop, and skipped it leaves the gate running."""
    _drive_watcher(FAILED_WIND_DOWN)


# `scripts/gate/gate_watch.py :: wind_down` over a shell whose tool the stop's first listing missed, as
# one started between the listing and the signal is: the shell waits on the tool, and its trap then
# starts work of its own, which the stop must leave to finish.
UNLISTED_TOOL: Final = """import os, subprocess, sys, tempfile, time
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import gate_watch as watch
kernel32 = watch.kernel32
scratch = Path(tempfile.mkdtemp())
started, reclaimed = scratch / "started", scratch / "reclaimed"
(scratch / "tool.py").write_bytes(b"import sys, time; open(sys.argv[1], 'wb'); time.sleep(60)")
(scratch / "reclaim.py").write_bytes(b"import sys, time; time.sleep(1); open(sys.argv[1], 'wb')")
(scratch / "shell.sh").write_bytes(
    b'reclaim() { "$FL_PY" "$FL_SCRATCH/reclaim.py" "$FL_SCRATCH/reclaimed"; exit 130; }\\n'
    b"trap reclaim TERM\\n"
    b'"$FL_PY" "$FL_SCRATCH/tool.py" "$FL_SCRATCH/started"\\n'
)
env = dict(os.environ, FL_PY=Path(sys.executable).as_posix(), FL_SCRATCH=scratch.as_posix())
job = kernel32.CreateJobObjectW(None, None)
shell = subprocess.Popen((sys.argv[2], (scratch / "shell.sh").as_posix()), stdin=subprocess.DEVNULL, env=env)
handle = kernel32.OpenProcess(watch.GATE_ACCESS, False, shell.pid)
assert kernel32.AssignProcessToJobObject(job, handle)
kernel32.CloseHandle(handle)
try:
    deadline = time.monotonic() + 30
    while not started.exists():
        assert time.monotonic() < deadline, "the shell's tool never started"
        time.sleep(0.05)
    listings = [[shell.pid]]
    real = watch._job_pids
    watch._job_pids = lambda job: listings.pop() if listings else real(job)
    watch.GRACE_S = 10.0
    outlived = watch.wind_down(job, Path(sys.argv[2]).parent / "kill.exe", scratch / "pools")
    assert outlived == 0, "the shell waited out the grace on a tool the stop never reached"
    assert shell.wait(timeout=30) == 130, shell.returncode
    assert reclaimed.exists(), "the stop ended what the shell's own trap started"
finally:
    kernel32.TerminateJobObject(job, 1)
"""


def test_a_tool_started_before_its_shell_s_signal_is_stopped_and_its_trap_s_work_is_not() -> None:
    """Listed once, a shell signalled while starting a tool waited on it for the whole grace and was then ended unreclaimed."""
    _drive_watcher(UNLISTED_TOOL)


# `scripts/gate/gate_watch.py :: wind_down`'s order: the stop marked in the registry before the pools
# named there are read.
MARKED_FIRST: Final = """import sys, tempfile
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import gate_watch as watch
registry = Path(tempfile.mkdtemp()) / "pools"
registry.write_bytes(b"")
read = []
named = watch._pools_named
def reading(path):
    read.append(path.read_bytes().split())
    return named(path)
watch._pools_named = reading
job = watch.kernel32.CreateJobObjectW(None, None)
assert watch.wind_down(job, Path(sys.argv[2]).parent / "kill.exe", registry) == 0
assert read == [[watch.STOPPED.encode("ascii")]], read
"""


def test_a_stop_marks_the_registry_before_it_reads_the_pools_named_there() -> None:
    """Read first, a pool naming itself in between was neither spared nor told, and was ended under the units it then started."""
    _drive_watcher(MARKED_FIRST)


# `scripts/gate/verify.sh :: pool_open`, its directory's creation witnessed: what `POOL_DIRS` held then.
POOL_OPEN_FIXTURE: Final = """set -euo pipefail
POOL_DIRS=()
mkdir() {{ printf '%s' "${{POOL_DIRS[*]}}" > "{witness}"; command mkdir "$@"; }}
{pool_open}
pool_open
printf '%s' "$POOL_DIR"
"""


def test_a_pool_s_directory_is_named_for_its_reclaim_before_it_exists(tmp_path: Path) -> None:
    """Created first, a stop landing before the name was kept left the directory behind with nothing to reclaim it."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    witness = tmp_path / "witness"
    fixture = POOL_OPEN_FIXTURE.format(witness=witness.as_posix(), pool_open=lift_function(VERIFY, "pool_open"))
    env = base_env()
    env["TMPDIR"] = (tmp_path / "scratch").as_posix()
    (tmp_path / "scratch").mkdir()
    done = run_shell(BASH, write_shell(tmp_path / "open.sh", fixture), env=env)
    assert done.returncode == 0, done.stdout + done.stderr
    assert witness.exists(), "the directory was created before anything ran that could name it"
    assert witness.read_bytes().decode("utf-8") == done.stdout, "the directory existed before the run kept its name"
    assert (tmp_path / "scratch" / Path(done.stdout).name / "units.tsv").is_file(), done.stdout


# `scripts/gate/verify.sh :: gate_exit` over one pool directory whose manifest holds one unit's status.
GATE_EXIT_FIXTURE: Final = """set -uo pipefail
step_worker() {{ return 1; }}
worker() {{ return 1; }}
cleanup() {{ :; }}
detail() {{ printf '%s\\n' "$@"; }}
DB_RUN_MARKER=""
POOLS_REGISTRY=""
POOL_DIRS=("{directory}")
{crashed_units}
{gate_exit}
trap gate_exit EXIT
exit {ending}
"""
# What a unit's bash records when the stop's SIGTERM reaches it before its trap is set: Windows
# shifts the signal into the exit code, and POSIX's `Popen` answers it negated.
SIGNALLED_BEFORE_ITS_TRAP: Final = "3840"
POSIX_SIGNALLED: Final = "-15"


@pytest.mark.parametrize(
    ("ending", "unit_status", "kept"),
    [
        (INTERRUPTED, SIGNALLED_BEFORE_ITS_TRAP, False),
        (INTERRUPTED, POSIX_SIGNALLED, False),
        (INTERRUPTED, "5", True),
        (1, SIGNALLED_BEFORE_ITS_TRAP, True),
    ],
    ids=[
        "a Windows kill in an interrupted run",
        "a POSIX kill in an interrupted run",
        "a crash in an interrupted run",
        "a kill behind a verdict",
    ],
)
def test_an_interrupted_run_reads_a_unit_killed_by_its_stop_as_no_crash(ending: int, unit_status: str, kept: bool, tmp_path: Path) -> None:
    """Read as a crash, every unit the stop reached early was blamed and its directory kept; only the stop's own kills are spared."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    pool = tmp_path / "pool"
    pool.mkdir()
    (pool / "manifest.tsv").write_bytes(f"unit\t{unit_status}\t0\t1\n".encode("ascii"))
    fixture = GATE_EXIT_FIXTURE.format(
        directory=pool.as_posix(),
        crashed_units=lift_function(VERIFY, "crashed_units"),
        gate_exit=lift_function(VERIFY, "gate_exit"),
        ending=ending,
    )
    done = run_shell(BASH, write_shell(tmp_path / "exit.sh", fixture), env=base_env())
    assert done.returncode == ending, done.stdout + done.stderr
    assert pool.exists() is kept, done.stdout + done.stderr
    assert (f"the unit unit crashed with status {unit_status}" in done.stderr) is kept, done.stderr
