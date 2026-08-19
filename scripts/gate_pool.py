"""SCRIPTS · the gate's scopes, run as concurrent processes for verify.sh to replay.

One scope per PROCESS, so a worker is an ordinary `verify.sh` run: a subshell loses the error trap
unless `set -E` is on, and a job backgrounded with `&` loses the interrupt trap outright, bash
giving a backgrounded child `SIG_IGN` for `SIGINT` and then refusing to re-trap it.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

from checker_kernel import EXIT_INTERRUPTED, EXIT_OK, run

# A word and not a number: every number in this column is an exit status a scope really returned,
# so a numeric sentinel would reach verify.sh through the arm meant for a real answer.
NOT_STARTED: Final = "not-started"

MANIFEST: Final = "manifest.tsv"


@dataclass(frozen=True)
class Unit:
    """One scope, and the scopes that must finish before it may start.

    `after` is not a schedule but the scopes this one shares mutable state with, which verify.sh
    holds beside the scope bodies: what is shared is a fact about them, not about the pool.
    """

    scope: str
    after: tuple[str, ...]


@dataclass
class Result:
    """What one unit did, as the manifest carries it.

    `status` is a string on purpose: no integer is free to mean `NOT_STARTED`, and verify.sh has to
    tell that apart from an exit code a scope really returned.
    """

    status: str = NOT_STARTED
    started_ms: int = 0
    ended_ms: int = 0


@dataclass
class Pool:
    """The run's own state, shared by the thread driving each unit."""

    directory: Path
    bash: str
    verify: str
    slots: threading.Semaphore
    results: dict[str, Result] = field(default_factory=dict)
    futures: dict[str, Future[None]] = field(default_factory=dict)
    started: float = 0.0

    def elapsed_ms(self) -> int:
        return int((time.monotonic() - self.started) * 1000)


def parse_unit(text: str) -> Unit:
    """`scope` or `scope:after,after` -- the form verify.sh writes its constraint table in."""
    scope, _, after = text.partition(":")
    if not scope:
        raise ValueError("a unit needs a scope name: " + repr(text))
    return Unit(scope=scope, after=tuple(name for name in after.split(",") if name))


def ordered(units: list[Unit]) -> list[Unit]:
    """The units in an order where every dependency is submitted before whatever waits on it.

    An absent future raises inside a worker thread, reported as a scope that produced nothing
    rather than as the typo it is.
    """
    known = {unit.scope for unit in units}
    for unit in units:
        unknown = sorted(set(unit.after) - known)
        if unknown:
            raise ValueError(unit.scope + " must follow scopes this run does not have: " + ", ".join(unknown))
    settled: list[Unit] = []
    placed: set[str] = set()
    remaining = list(units)
    while remaining:
        ready = [unit for unit in remaining if placed.issuperset(unit.after)]
        if not ready:
            raise ValueError("the units' constraints form a cycle: " + ", ".join(unit.scope for unit in remaining))
        settled.extend(ready)
        placed.update(unit.scope for unit in ready)
        remaining = [unit for unit in remaining if unit not in ready]
    return settled


def spawn(pool: Pool, scope: str) -> int:
    """Run one scope as its own `scripts/verify.sh`, streams captured to files.

    Binary descriptors handed to the child: reading them through this process adds a decode and a
    re-encode, which on Windows doubles every newline.
    """
    environment = dict(os.environ)
    environment["FL_GATE_WORKER"] = "1"
    environment["FL_GATE_LEDGER"] = str(pool.directory / (scope + ".ledger"))
    with (
        (pool.directory / (scope + ".out")).open("wb") as out,
        (pool.directory / (scope + ".err")).open("wb") as err,
    ):
        child = subprocess.Popen(
            (pool.bash, pool.verify, "--" + scope),
            stdin=subprocess.DEVNULL,
            stdout=out,
            stderr=err,
            env=environment,
        )
        return child.wait()


def run_unit(pool: Pool, unit: Unit) -> None:
    """Wait for what this scope shares state with, take a slot, run it, record it.

    The slot is taken after the wait, so a thread holding one never waits on another unit: a width
    limit would otherwise deadlock against the shared-state order.
    """
    for name in unit.after:
        pool.futures[name].result()
    with pool.slots:
        result = pool.results[unit.scope]
        result.started_ms = pool.elapsed_ms()
        try:
            result.status = str(spawn(pool, unit.scope))
        finally:
            result.ended_ms = pool.elapsed_ms()


def write_manifest(pool: Pool, units: list[Unit]) -> None:
    """One row per unit, in the order it was given, written as bytes with LF endings.

    Bytes rather than text: bash reads this file back, and a Windows text handle ends every row
    with a carriage return.
    """
    rows: list[str] = []
    for unit in units:
        result = pool.results[unit.scope]
        rows.append(f"{unit.scope}\t{result.status}\t{result.started_ms}\t{result.ended_ms}\n")
    (pool.directory / MANIFEST).write_bytes("".join(rows).encode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(add_help=True, description="Run the gate's scopes concurrently.")
    parser.add_argument("--dir", required=True, help="where the captures, ledgers and the manifest go")
    parser.add_argument("--bash", required=True, help="the shell to run each worker under -- the parent's own")
    parser.add_argument("--verify", required=True, help="the gate script a worker is one scope of")
    parser.add_argument("--width", type=int, default=0, help="most workers at once; 0 for no limit")
    parser.add_argument("unit", nargs="+", help="scope, or scope:after,after")
    given = parser.parse_args()

    units = ordered([parse_unit(text) for text in given.unit])
    pool = Pool(
        directory=Path(given.dir),
        bash=given.bash,
        verify=given.verify,
        slots=threading.Semaphore(given.width if given.width > 0 else len(units)),
        results={unit.scope: Result() for unit in units},
        started=time.monotonic(),
    )

    # One thread per unit, not per slot: an executor sized to the slots would run out of threads
    # for the waiters, which hold nothing.
    try:
        with ThreadPoolExecutor(max_workers=len(units)) as threads:
            for unit in units:
                pool.futures[unit.scope] = threads.submit(run_unit, pool, unit)
            for unit in units:
                pool.futures[unit.scope].result()
    except KeyboardInterrupt:
        # Ctrl-C already reached every worker through the process group, and each is winding down
        # through its own trap: returning first strands a half-built image or a stand-in .env.
        return EXIT_INTERRUPTED
    finally:
        # Written even when a unit's thread raised: without the manifest a crash here reads as a
        # gate that proved nothing, rather than one that proved what it got through.
        write_manifest(pool, units)
    return EXIT_OK


if __name__ == "__main__":
    # This file answers on the checkers' scale, never on the workers', which travels in the
    # manifest instead.
    raise SystemExit(run(main))
