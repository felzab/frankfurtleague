"""SCRIPTS · which of a suite's test files one CI shard runs, balanced by each file's measured cost.

A shard by position takes the files at its places in the sorted list whatever they cost, so which
shard is heaviest moves as files land, and a budget held per shard follows file names rather than
work. Longest first, each file to the shard holding least, over a committed table of costs: a file
the table lacks costs the mean of those it holds, so an added file needs no re-cut to be placed.

The candidates arrive on stdin, one path a line, from the suite's own discovery, so every file the
suite would run lands in exactly one shard of the count, whatever the table says.
"""

from __future__ import annotations

import argparse
import importlib.util
import io
import re
import sys
from pathlib import Path
from typing import Final

# `scripts/lib/` is a sibling of this directory, and a script's sys.path opens with this one.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import EXIT_OK, EXIT_REFUSED, REPO_ROOT, UNREADABLE, run

SHARD: Final = re.compile(r"^([1-9][0-9]*)/([1-9][0-9]*)$")
COST: Final = re.compile(r"^[0-9]+(?:\.[0-9]+)?$")


class Refused(Exception):
    """The input cannot be planned, so no shard is named and the run stops before any test."""


def read_table(text: str) -> dict[str, float]:
    """`path<TAB>seconds` a line under a `path<TAB>seconds` header; `#` lines are comments."""
    costs: dict[str, float] = {}
    header_seen = False
    for number, line in enumerate(text.splitlines(), start=1):
        if not line.strip() or line.startswith("#"):
            continue
        fields = line.split("\t")
        if not header_seen:
            if fields != ["path", "seconds"]:
                raise Refused(f"line {number} is not the header `path<TAB>seconds`")
            header_seen = True
            continue
        if len(fields) != 2 or not fields[0] or not COST.match(fields[1]):
            raise Refused(f"line {number} is not `<path><TAB><seconds>`, seconds a non-negative decimal")
        if fields[0] in costs:
            raise Refused(f"line {number} names {fields[0]} a second time")
        costs[fields[0]] = float(fields[1])
    if not costs:
        raise Refused("the table holds no file, so every candidate would cost its mean of nothing")
    return costs


def plan(candidates: list[str], costs: dict[str, float], count: int) -> list[list[str]]:
    """Every candidate in exactly one of `count` shards, each sorted by path.

    Ties fall to the path and then to the lower shard, so every instance reading one table and one
    list computes one plan.
    """
    known = [costs[path] for path in candidates if path in costs]
    # The mean of the files the table holds and the suite still runs: a row naming a file since
    # removed would otherwise price every new one.
    unknown = sum(known) / len(known) if known else 1.0
    loads = [0.0] * count
    shards: list[list[str]] = [[] for _ in range(count)]
    for path in sorted(candidates, key=lambda path: (-costs.get(path, unknown), path)):
        lightest = min(range(count), key=lambda index: (loads[index], index))
        loads[lightest] += costs.get(path, unknown)
        shards[lightest].append(path)
    return [sorted(shard) for shard in shards]


BACKEND: Final = REPO_ROOT / "fl_backend"


def db_modules() -> list[str]:
    """The modules `pytest -m db` collects, by the db tier's own reader.

    A module named to pytest is collected whatever it spells (`fl_backend/tests/db_modules.py ::
    pytest_ignore_collect`), so one holding no db case would be imported for nothing.
    """
    # Loaded by its path, so neither tree's `tests` package shadows the other's on sys.path.
    spec = importlib.util.spec_from_file_location("fl_backend_db_modules", BACKEND / "tests" / "db_modules.py")
    if spec is None or spec.loader is None:
        raise Refused("fl_backend/tests/db_modules.py could not be loaded, so the db tier's modules cannot be read")
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    return sorted(path.relative_to(BACKEND).as_posix() for path in (BACKEND / "tests").rglob("test_*.py") if reader.spells_a_db_case(path))


def main() -> int:
    parser = argparse.ArgumentParser(description="Name the test files one shard runs, read from stdin, balanced by a cost table.")
    parser.add_argument("--list-db-modules", action="store_true", help="print the backend's db-tier modules, relative to fl_backend, and stop")
    parser.add_argument("--table", metavar="PATH", help="the committed cost table, repository-relative")
    parser.add_argument("--shard", metavar="I/N", help="this shard's index, counting from 1, and the count")
    args = parser.parse_args()
    # The gate splits what this prints at `\n` alone, so a Windows python's CRLF would end every path in `\r`.
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(newline="\n")
    if args.list_db_modules:
        try:
            modules = db_modules()
        except Refused as exc:
            print(f"      {exc}. No module was listed.", file=sys.stderr)
            return EXIT_REFUSED
        for path in modules:
            print(path)
        return EXIT_OK
    if args.table is None or args.shard is None:
        parser.error("--table and --shard name the plan, unless --list-db-modules is given")
    try:
        match = SHARD.match(args.shard)
        if match is None or int(match.group(1)) > int(match.group(2)):
            raise Refused(f"the shard `{args.shard}` is not <index>/<count>, counting from 1, the index no larger than the count")
        try:
            text = (REPO_ROOT / args.table).read_text(encoding="utf-8")
        except UNREADABLE as exc:
            raise Refused(f"the table {args.table} could not be read ({exc})") from None
        costs = read_table(text)
        candidates = [line for line in sys.stdin.read().splitlines() if line.strip()]
        if not candidates:
            raise Refused("no candidate file arrived on stdin, so the suite's discovery found nothing or did not run")
        if len(set(candidates)) != len(candidates):
            raise Refused("a candidate arrived twice, and a plan places each file once")
        index, count = int(match.group(1)), int(match.group(2))
        # An empty shard would hand its runner no path, and each runner reads none as its whole tier.
        if count > len(candidates):
            raise Refused(f"{count} shards over {len(candidates)} file(s) leave a shard with none")
    except Refused as exc:
        print(f"      {args.table}: {exc}. No shard was planned.", file=sys.stderr)
        return EXIT_REFUSED
    unpriced = sorted(path for path in candidates if path not in costs)
    if unpriced:
        # A notice, never a refusal: an added file is placed at the mean, and the run says how many.
        print(f"      {len(unpriced)} of {len(candidates)} file(s) have no row in {args.table} and cost its mean", file=sys.stderr)
    for path in plan(candidates, costs, count)[index - 1]:
        print(path)
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(run(main))
