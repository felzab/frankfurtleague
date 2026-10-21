"""SCRIPTS · the shard planner: every file in one shard, the heaviest shard as light as the costs allow, a bad input refused.

The plan is driven over shaped lists and tables, and its command line over the committed tables
with the suites' own discovery, so a table the planner refuses, or one naming a path the suite
spells otherwise, fails here rather than in a CI job.
"""

from __future__ import annotations

import subprocess
import sys
from typing import Final

import pytest
from conftest import REPO_ROOT, import_scripts

[shard_plan] = import_scripts("shard_plan", directories=("gate",))

PLANNER: Final = REPO_ROOT / "scripts" / "gate" / "shard_plan.py"
HEADER: Final = "path\tseconds\n"


def plan_of(costs: dict[str, float], candidates: list[str], count: int) -> list[list[str]]:
    return shard_plan.plan(candidates, costs, count)


def test_every_candidate_lands_in_exactly_one_shard():
    """Read as the whole list against the shards' union, so a file dropped or doubled fails whatever the costs."""
    costs = {f"f{n}": float(n % 7) for n in range(40)}
    candidates = [*costs, "new-a", "new-b"]

    shards = plan_of(costs, candidates, 4)

    placed = [path for shard in shards for path in shard]
    assert sorted(placed) == sorted(candidates)
    assert len(placed) == len(set(placed))


def test_the_heaviest_shard_is_lighter_than_by_position():
    """The shape a position split gets wrong: the costly files sit at one shard's places in the sorted list."""
    costs = {"a1": 40.0, "a2": 1.0, "b1": 40.0, "b2": 1.0, "c1": 1.0, "c2": 1.0}
    candidates = sorted(costs)

    by_position = [sum(costs[path] for index, path in enumerate(candidates) if index % 2 == shard) for shard in range(2)]
    balanced = [sum(costs[path] for path in shard) for shard in plan_of(costs, candidates, 2)]

    assert max(by_position) == 81.0
    assert max(balanced) == 42.0


def test_a_file_the_table_lacks_costs_the_mean_of_those_it_holds():
    """A new file is placed as an average one, and a row naming a removed file prices nothing."""
    costs = {"big": 10.0, "small": 2.0, "gone": 1000.0}

    shards = plan_of(costs, ["big", "small", "new"], 2)

    # The mean of `big` and `small` is 6, so `new` joins `small` (2) rather than `big` (10).
    assert shards == [["big"], ["new", "small"]]


def test_ties_fall_to_the_path_and_then_the_lower_shard():
    """Every instance computes the plan alone, so two of them reading one table must agree on it."""
    costs = {"b": 1.0, "a": 1.0, "c": 1.0, "d": 1.0}

    assert plan_of(costs, ["d", "c", "b", "a"], 2) == plan_of(costs, ["a", "b", "c", "d"], 2) == [["a", "c"], ["b", "d"]]


@pytest.mark.parametrize(
    ("text", "reason"),
    [
        pytest.param("a\t1\n", "is not the header", id="no-header"),
        pytest.param(HEADER + "a\t1\na\t2\n", "a second time", id="twice"),
        pytest.param(HEADER + "a\t-1\n", "non-negative decimal", id="negative"),
        pytest.param(HEADER + "a\n", "non-negative decimal", id="no-cost"),
        pytest.param(HEADER, "holds no file", id="empty"),
    ],
)
def test_a_table_it_cannot_read_is_refused(text: str, reason: str):
    with pytest.raises(shard_plan.Refused, match=reason):
        shard_plan.read_table(text)


def run_planner(*args: str, stdin: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(PLANNER), *args], input=stdin, capture_output=True, text=True, encoding="utf-8", cwd=REPO_ROOT, check=False
    )


BACKEND_TABLE: Final = ".github/shard-costs/backend-db.tsv"


@pytest.mark.parametrize(
    ("shard", "stdin", "reason"),
    [
        pytest.param("3/2", "a\n", "is not <index>/<count>", id="past-the-count"),
        pytest.param("1/2", "", "no candidate file arrived", id="no-candidates"),
        pytest.param("1/2", "a\na\n", "arrived twice", id="twice"),
        pytest.param("1/3", "a\nb\n", "3 shards over 2 file(s) leave a shard with none", id="more-shards-than-files"),
    ],
)
def test_a_plan_it_cannot_make_exits_2_and_names_no_file(shard: str, stdin: str, reason: str):
    """An empty shard would hand its runner no path, which each runner reads as its whole tier."""
    done = run_planner("--table", BACKEND_TABLE, "--shard", shard, stdin=stdin)

    assert done.returncode == 2, done.stderr
    assert reason in done.stderr
    assert done.stdout == ""


def test_the_backend_db_tier_is_planned_whole_over_its_shards():
    """The committed table and the tier's own reader, as the gate runs them: every module once, and nothing else."""
    listed = run_planner("--list-db-modules", stdin="")
    assert listed.returncode == 0, listed.stderr
    modules = listed.stdout.splitlines()
    assert modules, "the db tier's reader found no module"

    shards = [run_planner("--table", BACKEND_TABLE, "--shard", f"{n}/2", stdin=listed.stdout) for n in (1, 2)]

    assert [done.returncode for done in shards] == [0, 0], [done.stderr for done in shards]
    placed = [path for done in shards for path in done.stdout.splitlines()]
    assert sorted(placed) == sorted(modules)
    assert all(path.startswith("tests/") and (REPO_ROOT / "fl_backend" / path).is_file() for path in placed)
