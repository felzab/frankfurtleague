"""SCRIPTS · the gate's units, run as concurrent processes for verify.sh to replay.

One unit per PROCESS, so a worker is an ordinary `verify.sh` run. A subshell would keep the error
trap, `scripts/_lib.sh` setting `set -E`, but a job backgrounded with `&` loses the interrupt trap
outright, bash giving a backgrounded child `SIG_IGN` for `SIGINT` and then refusing to re-trap it.

A unit carries its own command, so one runner serves both shapes the gate runs beside themselves: a
scope, and one check of a scope. Both leave an exit status in the manifest, and a unit that left
none says the same thing whichever it was.
"""

from __future__ import annotations

import argparse
import contextlib
import os
import re
import signal
import subprocess
import sys
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from types import FrameType
from typing import IO, Final

from checker_kernel import EXIT_INTERRUPTED, EXIT_OK, run

# A word, not a number: a numeric sentinel would reach verify.sh through the arm meant for a real
# exit status.
NOT_STARTED: Final = "not-started"

MANIFEST: Final = "manifest.tsv"

# Neither way of ending a run means anything off POSIX: a terminate there runs no handler, and
# `getppid` names a creator whose pid is reused.
POSIX: Final = sys.platform != "win32"

# A second's grace is nothing beside a build running to its end for a reader who has gone.
CALLER_POLL_S: Final = 1.0

ASSIGNMENT: Final = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")

# Submission order under `--width`, which no caller passes: insurance for a bounded run, never a
# saving. An unlisted unit sorts last.

# MEASURED 2026-09-02, each scope alone as a worker on one contended 16-core Windows machine.
# Contention only inflates, so each figure is an upper bound; the ranking is what the table is for.
TYPICAL_MS: Final[dict[str, int]] = {
    "scripts": 122_000,
    "ops": 67_000,
    "frontend": 50_000,
    "db": 41_000,
    "backend": 28_000,
    "docs": 17_000,
    "images": 14_000,
    "format": 8_000,
}


class Terminated(BaseException):
    """The run was asked to stop, by a signal or by its caller leaving.

    Not an `Exception`: `checker_kernel.py :: run` answers one with a traceback and the crash
    status, and a run told to stop has crashed nothing.
    """


@dataclass(frozen=True)
class Unit:
    name: str
    environment: dict[str, str]
    command: tuple[str, ...]


@dataclass
class Result:
    """`status` is a string for `NOT_STARTED`'s reason."""

    status: str = NOT_STARTED
    started_ms: int = 0
    ended_ms: int = 0


@dataclass
class Pool:
    directory: Path
    merge: bool
    slots: threading.Semaphore
    results: dict[str, Result] = field(default_factory=dict)
    futures: dict[str, Future[None]] = field(default_factory=dict)
    # Locked: a thread registers its child while another is asked to stop.
    live: dict[str, subprocess.Popen[bytes]] = field(default_factory=dict)
    live_lock: threading.Lock = field(default_factory=threading.Lock)
    # Under `--width` a queued unit would otherwise take a freed slot after the caller has gone.
    stopping: bool = False
    started: float = 0.0

    def elapsed_ms(self) -> int:
        return int((time.monotonic() - self.started) * 1000)


def parse_units(path: Path) -> list[Unit]:
    """One unit per line: its name, `env`-style leading assignments, then the command to run.

    Bytes (`.claude/CLAUDE.md` §6).
    """
    units: list[Unit] = []
    seen: set[str] = set()
    for number, line in enumerate(path.read_bytes().decode("utf-8").splitlines(), start=1):
        if not line:
            continue
        name, *rest = line.split("\t")
        environment: dict[str, str] = {}
        while rest and ASSIGNMENT.match(rest[0]):
            key, _, value = rest.pop(0).partition("=")
            environment[key] = value
        if not name:
            raise ValueError(f"line {number} of {path} names no unit")
        if not rest:
            raise ValueError(f"the {name} unit carries no command")
        # A name given twice leaves one of its two results unreported, and the reader cannot tell
        # which.
        if name in seen:
            raise ValueError(f"the {name} unit is named twice")
        seen.add(name)
        units.append(Unit(name=name, environment=environment, command=tuple(rest)))
    return units


def longest_first(units: list[Unit]) -> list[Unit]:
    """A schedule and never a verdict.

    The manifest and the replay stay in the caller's own order, so re-profiling `TYPICAL_MS`
    changes nothing a reader compares.
    """
    return sorted(units, key=lambda unit: -TYPICAL_MS.get(unit.name, 0))


def spawn(pool: Pool, unit: Unit) -> int:
    """Run one unit as its own process, streams captured to files.

    Bytes (`.claude/CLAUDE.md` §6).
    """
    environment = dict(os.environ)
    environment.update(unit.environment)
    with (pool.directory / (unit.name + ".out")).open("wb") as out:
        # Merged where the caller replays one stream: which line a tool wrote first is carried by
        # the interleaving alone, and two files cannot hold it.
        err: IO[bytes] = out if pool.merge else (pool.directory / (unit.name + ".err")).open("wb")
        try:
            child = subprocess.Popen(
                unit.command,
                stdin=subprocess.DEVNULL,
                stdout=out,
                stderr=err,
                env=environment,
                # A session of its own, for `terminate`'s reason; Windows ignores the argument.
                start_new_session=True,
            )
            with pool.live_lock:
                pool.live[unit.name] = child
            try:
                return child.wait()
            finally:
                with pool.live_lock:
                    pool.live.pop(unit.name, None)
        finally:
            if err is not out:
                err.close()


def run_unit(pool: Pool, unit: Unit) -> None:
    """Take a slot, run the unit, record what it returned and when."""
    with pool.slots:
        # Leaves `NOT_STARTED`, the truth for a unit cut short before its turn.
        if pool.stopping:
            return
        result = pool.results[unit.name]
        result.started_ms = pool.elapsed_ms()
        try:
            result.status = str(spawn(pool, unit))
        finally:
            result.ended_ms = pool.elapsed_ms()


def terminate(pool: Pool) -> None:
    """End the run: no unit outlives the pool, and none behind it starts.

    Signalled by GROUP, not killed: a unit is a bash whose trap reclaims its scratch and fires at
    once, while the build it waited on runs on orphaned into scratch already reclaimed.
    """
    with pool.live_lock:
        pool.stopping = True
        children = list(pool.live.values())
    for child in children:
        # Gone between the snapshot and here is the ordinary case, not a fault.
        with contextlib.suppress(OSError):
            if sys.platform == "win32":
                child.terminate()
            else:
                os.killpg(child.pid, signal.SIGTERM)


def watch_caller(pool: Pool, caller: int, stop: threading.Event) -> None:
    """End the run once the process that asked for it is gone.

    Nothing else would: the caller runs this pool as a FOREGROUND child, so bash holds a signal's
    trap until that child returns -- which is the whole build the trap existed to cut short.
    """
    while not stop.wait(CALLER_POLL_S):
        if os.getppid() != caller:
            terminate(pool)
            return


def stop_on_signal(number: int, frame: FrameType | None) -> None:
    """Turn a SIGTERM into an unwind in the main thread, which is where the units are stopped.

    Nothing is touched here: a handler runs on whichever line the main thread had reached, and the
    lock the units are registered under may be held on it.
    """
    raise Terminated


def arm(pool: Pool, stop: threading.Event) -> None:
    """Install both ways a run can be ended before its units are done.

    Off POSIX neither can be, so neither is installed and the run is only ever waited out --
    the reason is on `POSIX`.
    """
    if not POSIX:
        return
    signal.signal(signal.SIGTERM, stop_on_signal)
    threading.Thread(target=watch_caller, args=(pool, os.getppid(), stop), daemon=True).start()


def drive(pool: Pool, submission: list[Unit]) -> int:
    """Run every unit, and end them all rather than wait them out once told to stop.

    A unit has a session of its own, so a Ctrl-C reaches this process and none of them: the
    interrupt is answered here beside the signal, or every unit runs on unheard.
    """
    try:
        with ThreadPoolExecutor(max_workers=len(submission)) as threads:
            try:
                for unit in submission:
                    pool.futures[unit.name] = threads.submit(run_unit, pool, unit)
                for unit in submission:
                    pool.futures[unit.name].result()
            except KeyboardInterrupt:
                # Its own clause: `checker_kernel.py :: PARSE_FLOOR` predates `except A, B:`, and
                # ruff's formatter drops the parentheses.
                terminate(pool)
                raise Terminated from None
            except Terminated:
                # Before the executor's join, which waits on every thread -- and a thread waiting on
                # a build would hold the stop until the build finished.
                terminate(pool)
                raise
    except Terminated:
        return EXIT_INTERRUPTED
    return EXIT_OK


def write_manifest(pool: Pool, units: list[Unit]) -> None:
    """One row per unit, in the order it was given.

    Bytes (`.claude/CLAUDE.md` §6).
    """
    rows: list[str] = []
    for unit in units:
        result = pool.results[unit.name]
        rows.append(f"{unit.name}\t{result.status}\t{result.started_ms}\t{result.ended_ms}\n")
    (pool.directory / MANIFEST).write_bytes("".join(rows).encode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(add_help=True, description="Run the gate's units concurrently.")
    parser.add_argument("--dir", required=True, help="where the captures and the manifest go")
    parser.add_argument("--units", required=True, help="a file of units -- name, environment, command")
    parser.add_argument("--width", type=int, default=0, help="most units at once; 0 for no limit")
    parser.add_argument("--merge", action="store_true", help="capture each unit's two streams as one")
    given = parser.parse_args()

    units = parse_units(Path(given.units))
    if not units:
        raise ValueError(f"{given.units} lists no unit to run")
    submission = longest_first(units)
    pool = Pool(
        directory=Path(given.dir),
        merge=given.merge,
        slots=threading.Semaphore(given.width if given.width > 0 else len(units)),
        results={unit.name: Result() for unit in units},
        started=time.monotonic(),
    )

    watched = threading.Event()
    arm(pool, watched)
    try:
        return drive(pool, submission)
    finally:
        watched.set()
        # Without a manifest a crash here reads as a gate that proved nothing rather than one that
        # proved what it got through.
        write_manifest(pool, units)


if __name__ == "__main__":
    # This file answers on the checkers' scale, never on its units', which travels in the manifest
    # instead.
    raise SystemExit(run(main))
