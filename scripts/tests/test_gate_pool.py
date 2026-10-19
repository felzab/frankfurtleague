"""SCRIPTS · the pool's net: a unit's exit status on its way back to the gate, how a run ends, and how a silent unit is named.

`scripts/gate/gate_pool.py` is the only channel a unit's status travels, so a loss, a rename or a
reordering here is a gate that closes green over a check that failed. The wiring that ends a run
early is held here too, because none of it runs on the machine this suite runs on. Every case
drives the module as a subprocess, for `scripts/tests/conftest.py :: withdraw`'s reason.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from typing import Final

from conftest import declared, lift_function

SCRIPTS: Final = Path(__file__).resolve().parent.parent
POOL: Final = SCRIPTS / "gate" / "gate_pool.py"
KERNEL: Final = SCRIPTS / "lib" / "checker_kernel.py"

# Lines, so each case is `DRIVER` plus its own tuple. `POOL_DIR` and `DIRECTORY` are the holes
# `_drive` fills.
DRIVER: Final[tuple[str, ...]] = (
    "import os",
    "import signal",
    "import subprocess",
    "import sys",
    "import threading",
    "from pathlib import Path",
    "sys.path.insert(0, POOL_DIR)",
    "import gate_pool",
    # Its own session, or `terminate`'s killpg on a child leading no group answers ESRCH into the
    # suppression there and reads as a stop that worked.
    "def sleeper():",
    "    return subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'], stdin=subprocess.DEVNULL, start_new_session=True)",
    # The status a stop leaves -- TerminateProcess's own 1 on Windows -- so a child ending for another
    # reason is not read as stopped.
    "STOPPED_BY = -signal.SIGTERM if gate_pool.POSIX else 1",
    "def pool():",
    "    return gate_pool.Pool(directory=Path(DIRECTORY), merge=False)",
)

TERMINATE: Final[tuple[str, ...]] = (
    "running = pool()",
    "child = sleeper()",
    "running.live['unit'] = child",
    "gate_pool.terminate(running)",
    "child.wait(timeout=30)",
    "assert child.returncode == STOPPED_BY, (child.returncode, STOPPED_BY)",
    "assert running.stopping, 'the run was ended and would still have started the units behind it'",
)

WATCH_CALLER: Final[tuple[str, ...]] = (
    "running = pool()",
    "child = sleeper()",
    "running.live['unit'] = child",
    "stop = threading.Event()",
    # -1 is no process, so the caller this watcher is given is gone from its very first look.
    "threading.Thread(target=gate_pool.watch_caller, args=(running, -1, stop), daemon=True).start()",
    "child.wait(timeout=30)",
    "assert child.returncode == STOPPED_BY, (child.returncode, STOPPED_BY)",
    "stop.set()",
)

QUEUED_UNIT: Final[tuple[str, ...]] = (
    "running = pool()",
    "running.results['queued'] = gate_pool.Result()",
    "running.stopping = True",
    "unit = gate_pool.Unit(name='queued', environment={}, command=(sys.executable, '-c', 'raise SystemExit(7)'))",
    "gate_pool.run_unit(running, unit)",
    "assert running.results['queued'].status == gate_pool.NOT_STARTED, running.results['queued'].status",
    "assert not (Path(DIRECTORY) / 'queued.out').exists(), 'a unit started after the run had been ended'",
)

SIGNALLED: Final[tuple[str, ...]] = (
    "try:",
    "    gate_pool.stop_on_signal(15, None)",
    "except gate_pool.Terminated:",
    "    raise SystemExit(0)",
    "raise SystemExit('a SIGTERM left the main thread running rather than unwinding it')",
)


ARMED: Final[tuple[str, ...]] = (
    "gate_pool.POSIX = True",
    "signals = []",
    "started = []",
    "gate_pool.signal.signal = lambda number, handler: signals.append((number, handler))",
    "class FakeThread:",
    "    def __init__(self, target=None, args=(), daemon=None):",
    "        self.spec = (target, args, daemon)",
    "    def start(self):",
    "        started.append(self.spec)",
    "gate_pool.threading.Thread = FakeThread",
    "running = pool()",
    "stop = threading.Event()",
    "gate_pool.arm(running, stop)",
    "assert signals == [(gate_pool.signal.SIGTERM, gate_pool.stop_on_signal)], signals",
    "assert len(started) == 1, started",
    # The caller's own pid: a watcher given any other one compares two numbers that never meet.
    "assert started[0] == (gate_pool.watch_caller, (running, os.getppid(), stop), True), started[0]",
)

UNARMED: Final[tuple[str, ...]] = (
    "gate_pool.POSIX = False",
    "signals = []",
    "started = []",
    "gate_pool.signal.signal = lambda number, handler: signals.append((number, handler))",
    "class FakeThread:",
    "    def __init__(self, target=None, args=(), daemon=None):",
    "        self.spec = (target, args, daemon)",
    "    def start(self):",
    "        started.append(self.spec)",
    "gate_pool.threading.Thread = FakeThread",
    "gate_pool.arm(pool(), threading.Event())",
    "assert (signals, started) == ([], []), (signals, started)",
)

OWN_SESSION: Final[tuple[str, ...]] = (
    "asked = {}",
    "real = subprocess.Popen",
    "def recording(command, **rest):",
    "    asked.update(rest)",
    "    return real(command, **rest)",
    "gate_pool.subprocess.Popen = recording",
    "unit = gate_pool.Unit(name='probe', environment={}, command=(sys.executable, '-c', 'raise SystemExit(3)'))",
    "assert gate_pool.spawn(pool(), unit) == 3",
    "assert asked.get('start_new_session') is True, asked",
)

# From the child: `start_new_session` lands between fork and exec, and a parent looking early sees
# the old group.
OWN_GROUP: Final[tuple[str, ...]] = (
    "if not gate_pool.POSIX:",
    "    raise SystemExit(0)",
    "body = 'import os, sys; sys.stdout.write(str(os.getpid()) + chr(32) + str(os.getpgid(0)))'",
    "unit = gate_pool.Unit(name='group', environment={}, command=(sys.executable, '-c', body))",
    "assert gate_pool.spawn(pool(), unit) == 0",
    "pid, group = (Path(DIRECTORY) / 'group.out').read_bytes().split()",
    "assert pid == group, (pid, group)",
)

GROUP_SIGNALLED: Final[tuple[str, ...]] = (
    "killed = []",
    "gate_pool.os.killpg = lambda group, number: killed.append((group, number))",
    # Read per call, so rebinding it selects the arm.
    "gate_pool.sys.platform = 'linux'",
    "running = pool()",
    "child = sleeper()",
    "running.live['unit'] = child",
    "gate_pool.terminate(running)",
    "assert killed == [(child.pid, gate_pool.signal.SIGTERM)], killed",
    "child.kill()",
    "child.wait(timeout=30)",
)

# The platform is a VALUE, so both arms run on every machine. `os.killpg` is absent on Windows, so
# the proof is that the group path recorded nothing.
WINDOWS_TERMINATED: Final[tuple[str, ...]] = (
    "killed = []",
    "gate_pool.os.killpg = lambda group, number: killed.append((group, number))",
    "gate_pool.sys.platform = 'win32'",
    "stopped = []",
    "running = pool()",
    "child = sleeper()",
    "child.terminate = lambda: stopped.append(child.pid)",
    "running.live['unit'] = child",
    "gate_pool.terminate(running)",
    "assert stopped == [child.pid], stopped",
    "assert killed == [], killed",
    "child.kill()",
    "child.wait(timeout=30)",
)

# Two bounds, the inner the smaller: the double's own wait for `held` must report before the case's
# timeout does, whose message names a different failure (the pair is held in order by the case).
HELD_START_S: Final = 30
STOPPED_BOUND_S: Final = 90

STOPPED: Final[tuple[str, ...]] = (
    "import time",
    "running = pool()",
    "raiser = gate_pool.Unit(name='raiser', environment={}, command=('never run',))",
    "held = gate_pool.Unit(name='held', environment={}, command=(sys.executable, '-c', 'import time; time.sleep(300)'))",
    "running.results['raiser'] = gate_pool.Result()",
    "running.results['held'] = gate_pool.Result()",
    "real_run_unit = gate_pool.run_unit",
    "def interrupting(running_pool, unit):",
    "    if unit.name != 'raiser':",
    "        real_run_unit(running_pool, unit)",
    "        return",
    f"    deadline = time.monotonic() + {HELD_START_S}",
    "    while 'held' not in running_pool.live:",
    "        if time.monotonic() > deadline:",
    # Stopped first, so a unit starting late cannot hold the executor's join past the case's bound.
    "            gate_pool.terminate(running_pool)",
    "            raise SystemExit('held never started')",
    "        time.sleep(0.05)",
    "    raise KeyboardInterrupt",
    "gate_pool.run_unit = interrupting",
    "assert gate_pool.drive(running, [raiser, held]) == gate_pool.EXIT_INTERRUPTED",
    "assert running.results['held'].status not in ('0', gate_pool.NOT_STARTED), running.results['held'].status",
)


def _exits(status: int) -> tuple[str, ...]:
    return (sys.executable, "-c", f"raise SystemExit({status})")


def _pool(directory: Path, rows: list[tuple[str, ...]], *, merge: bool = False) -> subprocess.CompletedProcess[str]:
    """Run the pool over one units file, written as bash writes it: bytes and LF (CLAUDE.md §6)."""
    units = directory / "units.tsv"
    units.write_bytes("".join("\t".join(row) + "\n" for row in rows).encode("utf-8"))
    command = [sys.executable, str(POOL), "--dir", str(directory), "--units", str(units)]
    if merge:
        command.append("--merge")
    return subprocess.run(command, capture_output=True, text=True, check=False)


def _rows(directory: Path) -> list[list[str]]:
    raw = (directory / str(declared(POOL, "MANIFEST"))).read_bytes()
    assert b"\r" not in raw, "the manifest was written through a text handle, which bash cannot read back"
    return [line.split("\t") for line in raw.decode("utf-8").splitlines()]


def _drive(snippet: tuple[str, ...], directory: Path, *, timeout: float | None = None) -> subprocess.CompletedProcess[str]:
    """Run one case against the real module, in an interpreter of its own.

    `timeout` is for a case whose failure is a run that never returns, where waiting is the wrong
    answer rather than a slow one.
    """
    lines = "\n".join(DRIVER + snippet)
    source = lines.replace("POOL_DIR", repr(str(SCRIPTS / "gate"))).replace("DIRECTORY", repr(str(directory)))
    return subprocess.run([sys.executable, "-c", source], capture_output=True, text=True, check=False, timeout=timeout)


def test_every_unit_s_own_exit_status_reaches_the_manifest_under_its_own_name(tmp_path: Path) -> None:
    """A pass, a finding and a refusal are three different answers, and the gate has only this file to read them from."""
    result = _pool(tmp_path, [("pass", *_exits(0)), ("fail", *_exits(1)), ("refuse", *_exits(2))])
    assert result.returncode == 0, result.stderr
    assert [(row[0], row[1]) for row in _rows(tmp_path)] == [("pass", "0"), ("fail", "1"), ("refuse", "2")]


def test_the_manifest_is_written_in_the_caller_s_order_and_not_the_order_units_finish_in(tmp_path: Path) -> None:
    """The caller replays in written order, so the manifest keeps it whichever unit finished first."""
    lingers = (sys.executable, "-c", "import time; time.sleep(1)")
    result = _pool(tmp_path, [("db", *lingers), ("ops", *_exits(0))])
    assert result.returncode == 0, result.stderr
    rows = _rows(tmp_path)
    assert [(row[0], row[1]) for row in rows] == [("db", "0"), ("ops", "0")]
    # The premise, read off the manifest's own end times: two units finishing in the written order
    # would pass a manifest kept in finishing order too.
    assert int(rows[1][3]) < int(rows[0][3]), f"ops did not finish before db, so the order was never tested: {rows}"


def test_a_unit_that_never_started_leaves_a_word_no_exit_status_could_spell(tmp_path: Path) -> None:
    """The one reading of silence: a numeric sentinel would reach the gate through the arm meant for a real answer."""
    result = _pool(tmp_path, [("gone", str(tmp_path / "no-such-program"))])
    assert result.returncode == int(declared(KERNEL, "EXIT_CRASH")), result.stderr
    # Read out of the source rather than spelled: against a literal the digit assertion below is a
    # pair nothing compares, and it passes whatever word the module holds.
    not_started = str(declared(POOL, "NOT_STARTED"))
    assert not not_started.isdigit()
    assert _rows(tmp_path)[0][1] == not_started


MALFORMED: Final[tuple[tuple[list[tuple[str, ...]], str], ...]] = (
    ([("", *_exits(0))], "names no unit"),
    ([("solo",)], "carries no command"),
    ([("twice", *_exits(0)), ("twice", *_exits(0))], "is named twice"),
    ([], "lists no unit to run"),
)


def test_a_units_file_the_pool_cannot_read_crashes_and_names_what_is_wrong(tmp_path: Path) -> None:
    """A file the caller wrote wrongly must never run in part: the manifest it left behind would be read as a verdict."""
    crash = int(declared(KERNEL, "EXIT_CRASH"))
    wrong: list[str] = []
    for number, (rows, says) in enumerate(MALFORMED):
        directory = tmp_path / f"case{number}"
        directory.mkdir()
        result = _pool(directory, rows)
        if result.returncode != crash:
            wrong.append(f"{says}: exited {result.returncode} rather than {crash}")
        elif says not in result.stderr:
            wrong.append(f"{says}: the crash never said so -- {result.stderr.strip().splitlines()[-1:]}")
    assert not wrong, "; ".join(wrong)


def test_a_unit_s_leading_assignments_are_its_environment_and_the_rest_is_its_command(tmp_path: Path) -> None:
    """`env`'s own convention: an assignment past the first command word is that command's argument."""
    body = "import os, sys; sys.stdout.write(os.environ['FL_POOL_PROBE'] + '|' + sys.argv[1])"
    result = _pool(tmp_path, [("probe", "FL_POOL_PROBE=carried", sys.executable, "-c", body, "LATE=argument")])
    assert result.returncode == 0, result.stderr
    assert (tmp_path / "probe.out").read_bytes() == b"carried|LATE=argument"


def test_the_two_streams_are_captured_apart_unless_the_caller_asks_for_one(tmp_path: Path) -> None:
    """A step is replayed as one stream because the interleaving alone says which line a tool wrote first."""
    body = "import sys; sys.stdout.write('out'); sys.stderr.write('err')"
    apart, merged = tmp_path / "apart", tmp_path / "merged"
    apart.mkdir()
    merged.mkdir()
    assert _pool(apart, [("streams", sys.executable, "-c", body)]).returncode == 0
    assert _pool(merged, [("streams", sys.executable, "-c", body)], merge=True).returncode == 0
    assert (apart / "streams.out").read_bytes() == b"out"
    assert (apart / "streams.err").read_bytes() == b"err"
    assert not (merged / "streams.err").exists()
    assert sorted((merged / "streams.out").read_bytes()) == sorted(b"outerr")


def test_ending_the_run_stops_every_unit_running_under_it(tmp_path: Path) -> None:
    """Nothing else would: the caller runs the pool as a foreground child, so its own trap waits on the build it meant to cut short."""
    result = _drive(TERMINATE, tmp_path)
    assert result.returncode == 0, result.stderr


def test_the_run_ends_once_the_caller_that_asked_for_it_is_gone(tmp_path: Path) -> None:
    """An orphaned build runs to completion holding this run's image tag, for a reader who has left."""
    result = _drive(WATCH_CALLER, tmp_path)
    assert result.returncode == 0, result.stderr


def test_a_unit_still_queued_when_the_run_ends_never_starts(tmp_path: Path) -> None:
    """A unit whose thread reaches its turn after the stop would otherwise start a build for nobody."""
    result = _drive(QUEUED_UNIT, tmp_path)
    assert result.returncode == 0, result.stderr


def test_a_sigterm_unwinds_the_run_rather_than_being_absorbed(tmp_path: Path) -> None:
    """The handler is what turns the signal into the unwind that stops the units; ignoring it leaves them running."""
    result = _drive(SIGNALLED, tmp_path)
    assert result.returncode == 0, result.stderr


def test_both_ways_the_run_can_be_ended_are_armed_where_a_signal_means_something(tmp_path: Path) -> None:
    """Neither is reachable from a test that calls the helper itself, and neither is armed on the machine this runs on."""
    result = _drive(ARMED, tmp_path)
    assert result.returncode == 0, result.stderr


def test_neither_is_armed_where_a_signal_would_run_no_handler(tmp_path: Path) -> None:
    """A handler Windows never runs and a parent pid it reuses are worse than no arming: both read as a stop that works."""
    result = _drive(UNARMED, tmp_path)
    assert result.returncode == 0, result.stderr


def test_a_unit_is_given_a_session_of_its_own(tmp_path: Path) -> None:
    """Without one a stop reaches the bash and not the build it is waiting on, and the build outlives the scratch it writes into."""
    result = _drive(OWN_SESSION, tmp_path)
    assert result.returncode == 0, result.stderr


def test_a_unit_s_own_pid_is_the_group_id_a_stop_signals(tmp_path: Path) -> None:
    """`terminate` signals `child.pid` AS a group: a unit leading none takes the stop nowhere, and the suppression there reads that as done."""
    result = _drive(OWN_GROUP, tmp_path)
    assert result.returncode == 0, result.stderr


def test_ending_a_unit_signals_its_group_rather_than_its_leader(tmp_path: Path) -> None:
    """The leader is a `verify.sh` whose trap exits at once; its foreground child is the one holding the image and the scratch."""
    result = _drive(GROUP_SIGNALLED, tmp_path)
    assert result.returncode == 0, result.stderr


def test_a_stop_on_windows_terminates_the_child_rather_than_signalling_a_group(tmp_path: Path) -> None:
    """Its twin above binds the platform to make the group arm run everywhere; unbound, this one runs nowhere."""
    result = _drive(WINDOWS_TERMINATED, tmp_path)
    assert result.returncode == 0, result.stderr


def test_an_interrupt_ends_the_units_before_the_run_waits_on_them(tmp_path: Path) -> None:
    """A unit runs in a session of its own, so Ctrl-C reaches this process alone -- and terminating after the join waits out the build."""
    assert HELD_START_S < STOPPED_BOUND_S, "the double's wait would outlast the case's own bound, whose message names another failure"
    try:
        result = _drive(STOPPED, tmp_path, timeout=STOPPED_BOUND_S)
    except subprocess.TimeoutExpired:
        raise AssertionError("the run waited on the unit it had been told to stop") from None
    assert result.returncode == 0, result.stderr


# The stall notice, driven at a bound of a second rather than the gate's own. A pool reads where its
# notices go from the environment, so each case starts with none of the gate's run state.
STALLING: Final[tuple[str, ...]] = (
    "for key in [key for key in os.environ if key.startswith(('FL_GATE_', 'PYTEST_'))]:",
    "    del os.environ[key]",
    "gate_pool.STALL_S = 1.0",
    "gate_pool.STALL_POLL_S = 0.1",
    "def run_pool(*units):",
    "    listing = Path(DIRECTORY) / 'units.tsv'",
    "    listing.write_bytes(''.join(name + chr(9) + chr(9).join(command) + chr(10) for name, command in units).encode('utf-8'))",
    "    sys.argv = ['gate_pool', '--dir', str(Path(DIRECTORY)), '--units', str(listing), '--merge']",
    "    raise SystemExit(gate_pool.main())",
)
HUSHED: Final = "import sys, time; sys.stdout.write('started' + chr(10)); sys.stdout.flush(); time.sleep(2.5)"
MOVING: Final = "import sys, time\nfor beat in range(12):\n    sys.stdout.write('beat' + chr(10)); sys.stdout.flush(); time.sleep(0.2)"


def _notice(name: str) -> str:
    return f"the {name} unit has written nothing for"


def test_a_unit_writing_nothing_past_the_bound_is_named_with_what_it_last_wrote(tmp_path: Path) -> None:
    """The hang the gate reported nothing of for half an hour: a notice, and the run still ending on the unit's own status."""
    result = _drive((*STALLING, f"run_pool(('hushed', (sys.executable, '-c', {HUSHED!r})))"), tmp_path)
    assert result.returncode == 0, result.stderr
    assert _notice("hushed") in result.stderr, result.stderr
    assert "started" in result.stderr.split(_notice("hushed"), 1)[1], result.stderr
    assert [(row[0], row[1]) for row in _rows(tmp_path)] == [("hushed", "0")]


# Exits 0 only where its pool had named itself before starting it.
ANNOUNCED: Final = "import os, sys; from pathlib import Path; sys.exit(0 if Path(os.environ['FL_GATE_POOLS']).read_bytes() else 9)"


def test_a_pool_names_itself_where_a_stop_reads_it_before_any_unit_starts(tmp_path: Path) -> None:
    """A Windows stop spares the pools named there, so a unit started first could see its pool ended under it."""
    registry = tmp_path / "pools"
    registry.write_bytes(b"")
    named = f"os.environ[gate_pool.POOLS] = {str(registry)!r}"
    result = _drive(
        (*STALLING, named, "print(os.getpid(), flush=True)", f"run_pool(('unit', (sys.executable, '-c', {ANNOUNCED!r})))"), tmp_path
    )
    assert result.returncode == 0, result.stderr
    assert [(row[0], row[1]) for row in _rows(tmp_path)] == [("unit", "0")], "the unit started before its pool named itself"
    assert registry.read_bytes() == result.stdout.strip().encode("ascii") + b"\n"


def test_a_unit_still_writing_is_never_named_however_long_it_runs(tmp_path: Path) -> None:
    """Silence and not age: an age bound names every slow build and teaches the reader to skip the line."""
    script = tmp_path / "moving.py"
    script.write_bytes(MOVING.encode("utf-8"))
    result = _drive((*STALLING, f"run_pool(('moving', (sys.executable, {str(script)!r})))"), tmp_path)
    assert result.returncode == 0, result.stderr
    assert "has written nothing" not in result.stderr, result.stderr


# A pool started by a unit, as a scope's worker starts its checks: its own stderr is a capture the
# outer pool replays only once the run ends.
INNER_POOL: Final = """import os, sys
from pathlib import Path
sys.path.insert(0, {gate!r})
import gate_pool
gate_pool.STALL_S = 1.0
gate_pool.STALL_POLL_S = 0.1
directory = Path({directory!r})
directory.mkdir()
listing = directory / "units.tsv"
listing.write_bytes(("deep" + chr(9) + sys.executable + chr(9) + "-c" + chr(9) + {hushed!r} + chr(10)).encode("utf-8"))
sys.argv = ["gate_pool", "--dir", str(directory), "--units", str(listing)]
raise SystemExit(gate_pool.main())
"""


def test_a_nested_pool_s_notice_reaches_the_outermost_pool_s_reader(tmp_path: Path) -> None:
    """Left on the nested pool's own stderr, the notice would sit in a capture until the hang it names ends, which is never."""
    inner = tmp_path / "inner.py"
    inner.write_bytes(INNER_POOL.format(gate=str(SCRIPTS / "gate"), directory=str(tmp_path / "inner"), hushed=HUSHED).encode("utf-8"))
    result = _drive((*STALLING, f"run_pool(('worker', (sys.executable, {str(inner)!r})))"), tmp_path)
    assert result.returncode == 0, result.stderr
    assert _notice("deep") in result.stderr, result.stderr
    assert _notice("deep") not in (tmp_path / "worker.out").read_text(encoding="utf-8")


# A case past pytest's own bound under a worker of its own, as every gate pytest step runs. It waits
# for the notice carrying its stack, not a span a loaded machine outlasts before the worker starts.
STALLED_CASE: Final = """import time
from pathlib import Path


def test_a_case_that_stalls() -> None:
    deadline = time.monotonic() + 60
    while not Path({release!r}).exists() and time.monotonic() < deadline:
        time.sleep(0.1)
"""

# The sink every notice passes through, releasing the case once one carries its stack.
RELEASING: Final[tuple[str, ...]] = (
    "routed = gate_pool.notice_route",
    "def releasing_route(running):",
    "    sink, relay = routed(running)",
    "    def releasing(notice):",
    "        sink(notice)",
    "        if b'Timeout (' in notice:",
    "            (Path(DIRECTORY) / 'release').touch()",
    "    return releasing, relay",
    "gate_pool.notice_route = releasing_route",
)


def test_a_stalled_pytest_case_s_stack_reaches_the_notice_through_its_worker(tmp_path: Path) -> None:
    """The notice names the step; the stack is pytest's faulthandler dump, written by an xdist worker whose stderr must reach the capture."""
    case = tmp_path / "suite" / "test_stalled.py"
    case.parent.mkdir()
    case.write_bytes(STALLED_CASE.format(release=str(tmp_path / "release")).encode("utf-8"))
    # Its own root and conftest boundary: pytest otherwise walks the system temporary directory,
    # whose entries other cases create and remove under it.
    (case.parent / "pytest.ini").write_bytes(b"[pytest]\n")
    pytest = ("sys.executable", "'-m'", "'pytest'", repr(str(case)), "'-n'", "'1'", "'-p'", "'no:cacheprovider'")
    options = ("'-o'", "'faulthandler_timeout=1'")
    run = f"run_pool(('pytest', ({', '.join(pytest + options)})))"
    result = _drive((*STALLING, *RELEASING, run), tmp_path)
    assert result.returncode == 0, result.stderr
    said = (tmp_path / "pytest.out").read_bytes().decode("utf-8", "replace")
    assert (tmp_path / "release").exists(), f"no notice carried the stalled case's stack; it wrote:\n{said}\n{_rows(tmp_path)}"
    carried = next(notice for notice in result.stderr.split(_notice("pytest")) if "Timeout (" in notice)
    assert "test_a_case_that_stalls" in carried, result.stderr


VERIFY: Final = SCRIPTS / "gate" / "verify.sh"
# A `do_<check>` body's opening, whichever shape `scripts/tests/conftest.py :: lift_function` reads.
BODY_RE: Final = re.compile(r"^(do_\w+)\(\) +\{", re.MULTILINE)


def test_every_gate_pytest_dumps_a_stalled_case_s_stack_before_the_pool_names_its_step() -> None:
    """Two bounds in order: a dump later than the notice leaves the notice carrying no stack, and a step without one carries none ever."""
    text = VERIFY.read_text(encoding="utf-8")
    assigned = re.search(r"^FAULTHANDLER_S=([0-9]+)$", text, re.MULTILINE)
    assert assigned is not None, "scripts/gate/verify.sh no longer assigns FAULTHANDLER_S a whole number of seconds"
    faulthandler = int(assigned.group(1))
    assert faulthandler < float(declared(POOL, "STALL_S")), "the stack would be dumped after the notice that should carry it"
    bodies = [lift_function(VERIFY, name) for name in BODY_RE.findall(text)]
    running = [body for body in bodies if "-m pytest" in body]
    assert len(running) >= 3, "the scripts, backend and db pytest bodies are no longer found, so nothing below is checked"
    bare = [body.splitlines()[0] for body in running if '-o "faulthandler_timeout=${FAULTHANDLER_S}"' not in body]
    assert not bare, f"a gate pytest dumps no stack when a case stalls: {bare}"
