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

WORKFLOW: Final = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "verify.yml"


def test_every_job_outlasts_a_stuck_cache_restore() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    restore = re.findall(r"^  SEGMENT_DOWNLOAD_TIMEOUT_MINS: (\d+)$", text, re.MULTILINE)
    assert len(restore) == 1, "verify.yml sets no workflow-wide SEGMENT_DOWNLOAD_TIMEOUT_MINS, so a restore waits 10 minutes"
    jobs = re.findall(r"^  ([\w-]+):\n(?:    .*\n|\s*\n)*?    timeout-minutes: (\d+)$", text, re.MULTILINE)
    assert jobs, "verify.yml's jobs carry no timeout-minutes this reader finds"
    assert len(jobs) == len(re.findall(r"^    timeout-minutes: ", text, re.MULTILINE)), "a job's timeout this reader does not tie to its job"
    short = [f"{job} ({minutes} min)" for job, minutes in jobs if int(minutes) <= int(restore[0])]
    assert not short, f"these jobs time out before a stuck restore of {restore[0]} minutes gives up: {', '.join(short)}"
