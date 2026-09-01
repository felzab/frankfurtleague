"""SCRIPTS · the gate's units, run as concurrent processes for verify.sh to replay.

One unit per PROCESS, so a worker is an ordinary `verify.sh` run: a subshell loses the error trap
unless `set -E` is on, and a job backgrounded with `&` loses the interrupt trap outright, bash
giving a backgrounded child `SIG_IGN` for `SIGINT` and then refusing to re-trap it.

A unit carries its own command, so one runner serves both shapes the gate runs beside themselves: a
scope, and one check of a scope. Both leave an exit status in the manifest, and a unit that left
none says the same thing whichever it was.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO, Final

from checker_kernel import EXIT_INTERRUPTED, EXIT_OK, run

# A word and not a number: every number in this column is an exit status a unit really returned,
# so a numeric sentinel would reach verify.sh through the arm meant for a real answer.
NOT_STARTED: Final = "not-started"

MANIFEST: Final = "manifest.tsv"

# `env`'s own convention, so one units file carries a command and the environment it needs without
# a second column shape to read.
ASSIGNMENT: Final = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")

# The tail is submitted first, but every unit gets a slot: insurance for a --width run, not a
# saving, an unbounded run's floor being its longest unit because nothing waits. Profile
# 2026-08-26; a unit absent here sorts last, in the given order.
TYPICAL_MS: Final[dict[str, int]] = {
    "db": 86_000,
    "frontend": 61_000,
    "scripts": 46_000,
    "backend": 38_000,
    "format": 33_000,
    "docs": 10_000,
    "images": 8_000,
    "ops": 2_400,
}


@dataclass(frozen=True)
class Unit:
    """One thing to run: what to call it, what to add to its environment, and the command itself."""

    name: str
    environment: dict[str, str]
    command: tuple[str, ...]


@dataclass
class Result:
    """What one unit did, as the manifest carries it.

    `status` is a string on purpose: no integer is free to mean `NOT_STARTED`, and verify.sh has to
    tell that apart from an exit code a unit really returned.
    """

    status: str = NOT_STARTED
    started_ms: int = 0
    ended_ms: int = 0


@dataclass
class Pool:
    """The run's own state, shared by the thread driving each unit."""

    directory: Path
    merge: bool
    slots: threading.Semaphore
    results: dict[str, Result] = field(default_factory=dict)
    futures: dict[str, Future[None]] = field(default_factory=dict)
    started: float = 0.0

    def elapsed_ms(self) -> int:
        return int((time.monotonic() - self.started) * 1000)


def parse_units(path: Path) -> list[Unit]:
    """One unit per line: its name, `env`-style leading assignments, then the command to run.

    Read as bytes: bash writes this file, and reading it through a Windows text handle would leave a
    carriage return on the last word of every command.
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
        # One row per unit is what the manifest promises: a name given twice would leave one of the
        # two results unreported, and the caller reading it back cannot tell which.
        if name in seen:
            raise ValueError(f"the {name} unit is named twice")
        seen.add(name)
        units.append(Unit(name=name, environment=environment, command=tuple(rest)))
    return units


def longest_first(units: list[Unit]) -> list[Unit]:
    """The units in submission order, the given order breaking ties.

    A schedule and never a verdict: the manifest and the replay stay in the caller's own order,
    so re-profiling `TYPICAL_MS` changes nothing a reader compares.
    """
    return sorted(units, key=lambda unit: -TYPICAL_MS.get(unit.name, 0))


def spawn(pool: Pool, unit: Unit) -> int:
    """Run one unit as its own process, streams captured to files.

    Binary descriptors handed to the child: reading them through this process adds a decode and a
    re-encode, which on Windows doubles every newline.
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
            )
            return child.wait()
        finally:
            if err is not out:
                err.close()


def run_unit(pool: Pool, unit: Unit) -> None:
    """Take a slot, run the unit, record what it returned and when."""
    with pool.slots:
        result = pool.results[unit.name]
        result.started_ms = pool.elapsed_ms()
        try:
            result.status = str(spawn(pool, unit))
        finally:
            result.ended_ms = pool.elapsed_ms()


def write_manifest(pool: Pool, units: list[Unit]) -> None:
    """One row per unit, in the order it was given, written as bytes with LF endings.

    Bytes rather than text: bash reads this file back, and a Windows text handle ends every row
    with a carriage return.
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

    try:
        with ThreadPoolExecutor(max_workers=len(units)) as threads:
            for unit in submission:
                pool.futures[unit.name] = threads.submit(run_unit, pool, unit)
            for unit in submission:
                pool.futures[unit.name].result()
    except KeyboardInterrupt:
        # Ctrl-C already reached every unit through the process group, and each is winding down
        # through its own trap: returning first strands a half-built image, or the throwaway
        # certificate the nginx check writes under the repo root.
        return EXIT_INTERRUPTED
    finally:
        # Written even when a unit's thread raised: without the manifest a crash here reads as a
        # gate that proved nothing, rather than one that proved what it got through.
        write_manifest(pool, units)
    return EXIT_OK


if __name__ == "__main__":
    # This file answers on the checkers' scale, never on its units', which travels in the manifest
    # instead.
    raise SystemExit(run(main))
