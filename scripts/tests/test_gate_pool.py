"""SCRIPTS · the pool's net: what a unit's exit status has to survive on its way back to the gate.

`scripts/gate_pool.py` is the only channel a unit's status travels, so a loss, a rename or a
reordering here is a gate that closes green over a check that failed. Every case drives the module
as a subprocess: `test_check_docs.py` imports a COPY of scripts/ under these same module names, and
an import here would decide which of the two that file measures.
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

# Lines rather than a triple-quoted block: `scripts/docs_gate/kernel.py :: comment_runs` reads a
# lone closing quote at the margin as a docstring opening, and measures the code under it as prose.
DRIVER: Final[tuple[str, ...]] = (
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


def _drive(snippet: tuple[str, ...], directory: Path) -> subprocess.CompletedProcess[str]:
    """Run one case against the real module, in an interpreter of its own."""
    lines = "\n".join(DRIVER + snippet)
    source = lines.replace("SCRIPTS_DIR", repr(str(SCRIPTS))).replace("DIRECTORY", repr(str(directory)))
    return subprocess.run([sys.executable, "-c", source], capture_output=True, text=True, check=False)


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
