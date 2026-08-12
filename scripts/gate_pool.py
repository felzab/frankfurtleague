"""
SCRIPTS · the gate's scopes, run as concurrent processes for verify.sh to replay

One scope per process, so a worker is an ordinary `verify.sh` run: its error trap fires where it
always did, and its interrupt trap is still installed. A subshell loses the first unless `set -E` is
on, and a job backgrounded with `&` loses the second outright, because bash gives a backgrounded
child `SIG_IGN` for `SIGINT` and then refuses to re-trap it. Spawning is all this file owns -- the
sections, the closing table and the closing statements stay in `scripts/_lib.sh`, the one place in
this repository they are written down.

Invariants:
- Nothing is printed on a run that worked; verify.sh replays the captures in the serial order.
- A worker's captures are the worker's own bytes, decoded and re-encoded by nothing in between.
- A unit's status travels in the manifest and never in an exit code (ADR-0066).
- No worker is signalled from here; each worker's own interrupt trap reclaims what it made.

See:
- docs/ops/spec.md -- the scopes, the order they are replayed in, and the exit contract
- ADR-0066 -- a checker answers four exit codes, and a refusal is not a failure
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

# A word and not a number: every number in this column is an exit status a scope really returned
# (ADR-0066), so a numeric sentinel would reach verify.sh through the arm meant for a real answer.
NOT_STARTED: Final = "not-started"

MANIFEST: Final = "manifest.tsv"


@dataclass(frozen=True)
class Unit:
    """One scope, and the scopes that must finish before it may start.

    `after` is not a schedule. It is the scopes this one shares mutable state with, which is the
    only thing that may constrain the order -- verify.sh holds that list beside the scope bodies,
    because what is shared is a fact about them rather than about the pool.
    """

    scope: str
    after: tuple[str, ...]


@dataclass
class Result:
    """What one unit did, as the manifest carries it.

    `status` is a string on purpose: an exit code where there is one, and `NOT_STARTED` where the
    unit never ran. Both spellings reach verify.sh, which has to tell them apart, and no integer is
    free to mean the second.
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

    A unit's thread waits on its dependencies' futures, so a future that does not exist yet would
    raise inside a worker thread -- reported as a scope that produced nothing, which is a long way
    from the constraint table having a typo in it. Sorting here is what makes that wait
    unconditional, and it is where a cycle is caught rather than deadlocked on.
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
    """Run one scope as its own verify.sh, its streams captured to files, and answer its status.

    The captures are opened in binary and handed to the child as file descriptors, so the bytes the
    scope printed are the bytes the replay prints. Reading them through this process would put a
    decode and a re-encode in the path, and on Windows that turns every newline into two.

    stdin is closed rather than inherited: a worker reading it would be competing with the terminal
    for the parent's input, and nothing in a scope has any business asking.
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
    """Wait for what this scope shares state with, take a slot, run it, and record what it did.

    The slot is taken after the wait and never before it, so a thread holding one is never waiting
    on another unit. That is what keeps a width limit from deadlocking against the order the shared
    state imposes.
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

    Bytes rather than text: bash reads this file back, and a Windows text handle would end every row
    with a carriage return that survives into the variable the shell reads it into.
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

    # One thread per unit rather than one per slot: a thread waiting on the scopes it shares state
    # with holds nothing, and an executor sized to the slots would run out of threads for waiters.
    try:
        with ThreadPoolExecutor(max_workers=len(units)) as threads:
            for unit in units:
                pool.futures[unit.scope] = threads.submit(run_unit, pool, unit)
            for unit in units:
                pool.futures[unit.scope].result()
    except KeyboardInterrupt:
        # Ctrl-C already reached every worker through the terminal's process group, and each is
        # winding down through its own interrupt trap -- returning before they have is what
        # strands a half-built image or a stand-in .env.
        return EXIT_INTERRUPTED
    finally:
        # Written even when a unit's thread raised: the manifest is how the parent learns which
        # scopes have a capture worth replaying, and without one a crash here reads as a gate
        # that proved nothing rather than one that proved what it got through.
        write_manifest(pool, units)
    return EXIT_OK


if __name__ == "__main__":
    # `run` maps an unhandled exception to a crash and Ctrl-C to 130, so this file answers on the
    # same scale as every checker beside it -- and never on the scale the workers answer on, which
    # travels in the manifest instead.
    raise SystemExit(run(main))
