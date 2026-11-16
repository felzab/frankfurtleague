"""Every process a case runs ends at the bound, with every process it started, through `conftest.py :: run_bounded`.

The bound holds only while the runner ends the whole tree, and only while no case starts a process past it, which
`scripts/tests/ruff.toml` refuses. Lost, either passes every case, until a stand-in that never answers holds a run.
"""

from __future__ import annotations

import subprocess
import time
import tomllib
from typing import Any, Final

import pytest
from conftest import BASH, REPO_ROOT, run_bounded

# Far past the bound and far below the child's own end, so a run returning before it was ended at the bound.
BOUND_S: Final = 1
ENDED_WITHIN_S: Final = 30


def test_a_child_whose_own_child_outlives_the_bound_ends_with_it_at_the_bound() -> None:
    """bash forks `sleep`, which holds the pipes: ending bash alone leaves the run waiting for the sleep's minute."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    started = time.monotonic()
    with pytest.raises(subprocess.TimeoutExpired):
        run_bounded((BASH, "-c", "sleep 60; echo late"), bound_s=BOUND_S)
    took = time.monotonic() - started
    assert took < ENDED_WITHIN_S, f"the run returned {took:.1f} s in, under a {BOUND_S} s bound: the tree outlived it"


def _banned(path: str) -> dict[str, Any]:
    return tomllib.loads((REPO_ROOT / path).read_bytes().decode("utf-8"))["lint"]["flake8-tidy-imports"]["banned-api"]


def test_the_tests_ban_list_holds_every_entry_of_the_folder_s() -> None:
    """A child's `banned-api` replaces its parent's, so an entry the parent gains and the child lacks is unbanned here."""
    folder, tests = _banned("scripts/ruff.toml"), _banned("scripts/tests/ruff.toml")
    lost = {name: entry for name, entry in folder.items() if tests.get(name) != entry}
    assert folder, "scripts/ruff.toml bans nothing, so nothing is compared"
    assert not lost, f"scripts/tests/ruff.toml does not ban, as scripts/ruff.toml does: {lost}"
