"""SCRIPTS · a stuck cache restore gives up inside every job that waits on it.

The cache library behind `actions/cache`, `astral-sh/setup-uv` and `pnpm/setup` aborts a stuck download
after `SEGMENT_DOWNLOAD_TIMEOUT_MINS` and the job goes on without the cache. A job whose own timeout
comes first is cancelled instead, failing a run that would have passed uncached, and nothing else
compares the two numbers.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Final

import pytest

WORKFLOWS: Final = Path(__file__).resolve().parents[2] / ".github" / "workflows"

# `actions/cache` itself, or one of the toolchain actions, whose setup-uv and pnpm/setup restore one.
RESTORES_A_CACHE: Final = re.compile(r"^\s*(?:- )?uses: (?:actions/cache(?:/restore)?@|\./\.github/actions/)", re.MULTILINE)


def _restoring() -> list[Path]:
    return sorted(path for path in WORKFLOWS.glob("*.yml") if RESTORES_A_CACHE.search(path.read_text(encoding="utf-8")))


def test_the_reader_finds_the_workflows_restoring_a_cache() -> None:
    assert {path.name for path in _restoring()} >= {"verify.yml", "ai-tooling.yml"}, "the cache-restore reader misses a workflow"


@pytest.mark.parametrize("workflow", _restoring(), ids=lambda path: path.name)
def test_every_job_outlasts_a_stuck_cache_restore(workflow: Path) -> None:
    text = workflow.read_text(encoding="utf-8")
    restore = re.findall(r"^  SEGMENT_DOWNLOAD_TIMEOUT_MINS: (\d+)$", text, re.MULTILINE)
    assert len(restore) == 1, f"{workflow.name} sets no workflow-wide SEGMENT_DOWNLOAD_TIMEOUT_MINS, so a restore waits 10 minutes"
    # A job's body is lines indented four spaces or blank ones; the two never match one line, so no backtracking.
    jobs = re.findall(r"^  ([\w-]+):\n(?:    .*\n| {0,3}\n)*?    timeout-minutes: (\d+)$", text, re.MULTILINE)
    assert jobs, f"{workflow.name}'s jobs carry no timeout-minutes this reader finds"
    assert len(jobs) == len(re.findall(r"^    timeout-minutes: ", text, re.MULTILINE)), "a job's timeout this reader does not tie to its job"
    short = [f"{job} ({minutes} min)" for job, minutes in jobs if int(minutes) <= int(restore[0])]
    assert not short, f"these jobs time out before a stuck restore of {restore[0]} minutes gives up: {', '.join(short)}"
