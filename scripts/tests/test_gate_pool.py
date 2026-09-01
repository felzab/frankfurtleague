"""SCRIPTS · the pool's net: a unit's exit status on its way back to the gate, and how a run ends.

`scripts/gate_pool.py` is the only channel a unit's status travels, so a loss, a rename or a
reordering here is a gate that closes green over a check that failed. The wiring that ends a run
early is held here too, because none of it runs on the machine this suite runs on. Every case
drives the module as a subprocess: `test_check_docs.py` imports a COPY of scripts/ under these same
module names, and an import here would decide which of the two that file measures.
"""

from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path
from typing import Final

SCRIPTS: Final = Path(__file__).resolve().parent.parent
POOL: Final = SCRIPTS / "gate_pool.py"
KERNEL: Final = SCRIPTS / "checker_kernel.py"

# Everything below reaches the module through one of these two: a pool run over a units file, or a
# snippet importing it inside its own interpreter. `SCRIPTS_DIR` and `DIRECTORY` are the snippet's
# only holes, filled by `_drive`.

# Lines rather than a triple-quoted block: `scripts/docs_gate/structure.py :: comment_runs` reads a
# lone closing quote at the margin as a docstring opening, and measures the code under it as prose.
DRIVER: Final[tuple[str, ...]] = (
    "import os",
    "import subprocess",
    "import sys",
    "import threading",
    "from pathlib import Path",
    "sys.path.insert(0, SCRIPTS_DIR)",
    "import gate_pool",
    "def sleeper():",
    "    return subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'], stdin=subprocess.DEVNULL)",
    "def pool():",
    "    return gate_pool.Pool(directory=Path(DIRECTORY), merge=False, slots=threading.Semaphore(1))",
)

TERMINATE: Final[tuple[str, ...]] = (
    "running = pool()",
    "child = sleeper()",
    "running.live['unit'] = child",
    "gate_pool.terminate(running)",
    "child.wait(timeout=30)",
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

GROUP_SIGNALLED: Final[tuple[str, ...]] = (
    "killed = []",
    "gate_pool.os.killpg = lambda group, number: killed.append((group, number))",
    # The platform the module reads per call, spelt as a machine where a signal means something.
    "gate_pool.sys.platform = 'linux'",
    "running = pool()",
    "child = sleeper()",
    "running.live['unit'] = child",
    "gate_pool.terminate(running)",
    "assert killed == [(child.pid, gate_pool.signal.SIGTERM)], killed",
    "child.kill()",
    "child.wait(timeout=30)",
)

STOPPED: Final[tuple[str, ...]] = (
    "import time",
    "running = pool()",
    "running.slots = threading.Semaphore(2)",
    "raiser = gate_pool.Unit(name='raiser', environment={}, command=('never run',))",
    "held = gate_pool.Unit(name='held', environment={}, command=(sys.executable, '-c', 'import time; time.sleep(300)'))",
    "running.results['raiser'] = gate_pool.Result()",
    "running.results['held'] = gate_pool.Result()",
    "real_run_unit = gate_pool.run_unit",
    "def interrupting(running_pool, unit):",
    "    if unit.name != 'raiser':",
    "        real_run_unit(running_pool, unit)",
    "        return",
    "    while 'held' not in running_pool.live:",
    "        time.sleep(0.05)",
    "    raise KeyboardInterrupt",
    "gate_pool.run_unit = interrupting",
    "assert gate_pool.drive(running, [raiser, held]) == gate_pool.EXIT_INTERRUPTED",
    "assert running.results['held'].status not in ('0', gate_pool.NOT_STARTED), running.results['held'].status",
)

SCHEDULE: Final[tuple[str, ...]] = (
    "seen = []",
    "gate_pool.drive = lambda running, submission: seen.append((running, [unit.name for unit in submission])) or 0",
    "units_file = Path(DIRECTORY) / 'schedule.tsv'",
    "rows = ''.join(name + chr(9) + sys.executable + chr(10) for name in ('ops', 'db', 'frontend'))",
    "units_file.write_bytes(rows.encode('utf-8'))",
    "def once(*extra):",
    "    sys.argv = ['gate_pool.py', '--dir', DIRECTORY, '--units', str(units_file), *extra]",
    "    assert gate_pool.main() == 0",
    "    return seen.pop()",
    "running, order = once('--width', '2')",
    "assert order == ['db', 'frontend', 'ops'], order",
    "assert [running.slots.acquire(blocking=False) for _ in range(3)] == [True, True, False]",
    "running, order = once()",
    "assert [running.slots.acquire(blocking=False) for _ in range(4)] == [True, True, True, False]",
)


def _constant(path: Path, name: str) -> str:
    """A constant as its own source declares it, read rather than imported.

    Spelling one again here would be a pair nothing compares: a rename would leave the test passing
    against a word nothing in the module spells.
    """
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.AnnAssign) and node.value is not None and getattr(node.target, "id", "") == name:
            return str(ast.literal_eval(node.value))
    raise AssertionError(f"{path.name} no longer declares {name}")


def _exits(status: int) -> tuple[str, ...]:
    """A command whose whole job is to leave one exit status behind."""
    return (sys.executable, "-c", f"raise SystemExit({status})")


def _pool(directory: Path, rows: list[tuple[str, ...]], *, merge: bool = False) -> subprocess.CompletedProcess[str]:
    """Run the pool over one units file, written the way bash writes it.

    Bytes and LF: the module reads this file as bytes, and a Windows text handle would leave a
    carriage return on the last word of every command.
    """
    units = directory / "units.tsv"
    units.write_bytes("".join("\t".join(row) + "\n" for row in rows).encode("utf-8"))
    command = [sys.executable, str(POOL), "--dir", str(directory), "--units", str(units)]
    if merge:
        command.append("--merge")
    return subprocess.run(command, capture_output=True, text=True, check=False)


def _rows(directory: Path) -> list[list[str]]:
    """The manifest as the gate reads it back, proved to carry no carriage return on the way."""
    raw = (directory / _constant(POOL, "MANIFEST")).read_bytes()
    assert b"\r" not in raw, "the manifest was written through a text handle, which bash cannot read back"
    return [line.split("\t") for line in raw.decode("utf-8").splitlines()]


def _drive(snippet: tuple[str, ...], directory: Path, *, timeout: float | None = None) -> subprocess.CompletedProcess[str]:
    """Run one case against the real module, in an interpreter of its own.

    `timeout` is for a case whose failure is a run that never returns, where waiting is the wrong
    answer rather than a slow one.
    """
    lines = "\n".join(DRIVER + snippet)
    source = lines.replace("SCRIPTS_DIR", repr(str(SCRIPTS))).replace("DIRECTORY", repr(str(directory)))
    return subprocess.run([sys.executable, "-c", source], capture_output=True, text=True, check=False, timeout=timeout)


def test_every_unit_s_own_exit_status_reaches_the_manifest_under_its_own_name(tmp_path: Path) -> None:
    """A pass, a finding and a refusal are three different answers, and the gate has only this file to read them from."""
    result = _pool(tmp_path, [("pass", *_exits(0)), ("fail", *_exits(1)), ("refuse", *_exits(2))])
    assert result.returncode == 0, result.stderr
    assert [(row[0], row[1]) for row in _rows(tmp_path)] == [("pass", "0"), ("fail", "1"), ("refuse", "2")]


def test_the_manifest_is_written_in_the_caller_s_order_and_not_the_schedule_s(tmp_path: Path) -> None:
    """`longest_first` submits `db` ahead of `ops`; the caller replays in written order and compares captures across runs."""
    result = _pool(tmp_path, [("ops", *_exits(0)), ("db", *_exits(0))])
    assert result.returncode == 0, result.stderr
    assert [row[0] for row in _rows(tmp_path)] == ["ops", "db"]


def test_a_unit_that_never_started_leaves_a_word_no_exit_status_could_spell(tmp_path: Path) -> None:
    """The one reading of silence: a numeric sentinel would reach the gate through the arm meant for a real answer."""
    result = _pool(tmp_path, [("gone", str(tmp_path / "no-such-program"))])
    assert result.returncode == int(_constant(KERNEL, "EXIT_CRASH")), result.stderr
    not_started = _constant(POOL, "NOT_STARTED")
    assert not not_started.isdigit()
    assert _rows(tmp_path)[0][1] == not_started


# One case per way a units file can be wrong. A loop rather than pytest's parametrize: pyright reads
# scripts/ with no environment declared, so nothing here may import outside the standard library.
MALFORMED: Final[tuple[tuple[list[tuple[str, ...]], str], ...]] = (
    ([("", *_exits(0))], "names no unit"),
    ([("solo",)], "carries no command"),
    ([("twice", *_exits(0)), ("twice", *_exits(0))], "is named twice"),
    ([], "lists no unit to run"),
)


def test_a_units_file_the_pool_cannot_read_crashes_and_names_what_is_wrong(tmp_path: Path) -> None:
    """A file the caller wrote wrongly must never run in part: the manifest it left behind would be read as a verdict."""
    crash = int(_constant(KERNEL, "EXIT_CRASH"))
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
    """Under a `--width` below the unit count a freed slot would otherwise start a build for nobody."""
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


def test_ending_a_unit_signals_its_group_rather_than_its_leader(tmp_path: Path) -> None:
    """The leader is a `verify.sh` whose trap exits at once; its foreground child is the one holding the image and the scratch."""
    result = _drive(GROUP_SIGNALLED, tmp_path)
    assert result.returncode == 0, result.stderr


def test_an_interrupt_ends_the_units_before_the_run_waits_on_them(tmp_path: Path) -> None:
    """A unit runs in a session of its own, so Ctrl-C reaches this process alone -- and terminating after the join waits out the build."""
    try:
        result = _drive(STOPPED, tmp_path, timeout=90)
    except subprocess.TimeoutExpired:
        raise AssertionError("the run waited on the unit it had been told to stop") from None
    assert result.returncode == 0, result.stderr


def test_the_expected_longest_unit_is_submitted_first_and_width_bounds_the_slots(tmp_path: Path) -> None:
    """Both are `main`'s wiring rather than a helper's: the schedule and the semaphore are built there and passed on."""
    result = _drive(SCHEDULE, tmp_path)
    assert result.returncode == 0, result.stderr
