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

# The tail is submitted first, but every scope gets a slot: insurance for a --width run, not a
# saving, an unbounded run's floor being its longest scope because nothing waits. Profile
# 2026-08-26; a scope absent here sorts last, in the given order.
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


@dataclass
class Result:
    """What one scope did, as the manifest carries it.

    `status` is a string on purpose: no integer is free to mean `NOT_STARTED`, and verify.sh has to
    tell that apart from an exit code a scope really returned.
    """

    status: str = NOT_STARTED
    started_ms: int = 0
    ended_ms: int = 0


@dataclass
class Pool:
    """The run's own state, shared by the thread driving each scope."""

    directory: Path
    bash: str
    verify: str
    slots: threading.Semaphore
    results: dict[str, Result] = field(default_factory=dict)
    futures: dict[str, Future[None]] = field(default_factory=dict)
    started: float = 0.0

    def elapsed_ms(self) -> int:
        return int((time.monotonic() - self.started) * 1000)


def longest_first(scopes: list[str]) -> list[str]:
    """The scopes in submission order, the given order breaking ties.

    A schedule and never a verdict: the manifest and the replay stay in the caller's own order,
    so re-profiling `TYPICAL_MS` changes nothing a reader compares.
    """
    for scope in scopes:
        if not scope:
            raise ValueError("a unit needs a scope name")
    return sorted(scopes, key=lambda scope: -TYPICAL_MS.get(scope, 0))


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


def run_unit(pool: Pool, scope: str) -> None:
    """Take a slot, run the scope, record what it returned and when."""
    with pool.slots:
        result = pool.results[scope]
        result.started_ms = pool.elapsed_ms()
        try:
            result.status = str(spawn(pool, scope))
        finally:
            result.ended_ms = pool.elapsed_ms()


def write_manifest(pool: Pool, scopes: list[str]) -> None:
    """One row per scope, in the order it was given, written as bytes with LF endings.

    Bytes rather than text: bash reads this file back, and a Windows text handle ends every row
    with a carriage return.
    """
    rows: list[str] = []
    for scope in scopes:
        result = pool.results[scope]
        rows.append(f"{scope}\t{result.status}\t{result.started_ms}\t{result.ended_ms}\n")
    (pool.directory / MANIFEST).write_bytes("".join(rows).encode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(add_help=True, description="Run the gate's scopes concurrently.")
    parser.add_argument("--dir", required=True, help="where the captures, ledgers and the manifest go")
    parser.add_argument("--bash", required=True, help="the shell to run each worker under -- the parent's own")
    parser.add_argument("--verify", required=True, help="the gate script a worker is one scope of")
    parser.add_argument("--width", type=int, default=0, help="most workers at once; 0 for no limit")
    parser.add_argument("unit", nargs="+", help="a scope name per unit")
    given = parser.parse_args()

    scopes: list[str] = given.unit
    submission = longest_first(scopes)
    pool = Pool(
        directory=Path(given.dir),
        bash=given.bash,
        verify=given.verify,
        slots=threading.Semaphore(given.width if given.width > 0 else len(scopes)),
        results={scope: Result() for scope in scopes},
        started=time.monotonic(),
    )

    try:
        with ThreadPoolExecutor(max_workers=len(scopes)) as threads:
            for scope in submission:
                pool.futures[scope] = threads.submit(run_unit, pool, scope)
            for scope in submission:
                pool.futures[scope].result()
    except KeyboardInterrupt:
        # Ctrl-C already reached every worker through the process group, and each is winding down
        # through its own trap: returning first strands a half-built image, or the throwaway
        # certificate the nginx check writes under the repo root.
        return EXIT_INTERRUPTED
    finally:
        # Written even when a unit's thread raised: without the manifest a crash here reads as a
        # gate that proved nothing, rather than one that proved what it got through.
        write_manifest(pool, scopes)
    return EXIT_OK


if __name__ == "__main__":
    # This file answers on the checkers' scale, never on the workers', which travels in the
    # manifest instead.
    raise SystemExit(run(main))
