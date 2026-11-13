"""The landing's states are the seed's, wherever a script or CI names them.

`scripts/ops/seed/seed.js :: LANDING_STATES` seeds each state and refuses any other name. `local.sh`
names them again to refuse an unknown one before Docker is asked, and CI's landing loop to run the
landing's cases under each. The seed runs inside mongosh in a container, so neither bash nor a
workflow can read its object: a state added to the seed alone would never run in CI, every job
green, and `local.sh` would refuse it.

CI's loop also ends inside its job: its step's own bound lies below the job's, or a hang in it
would run into the job's, which cancels the job and with it the steps that keep its diagnostics.
"""

from __future__ import annotations

import re
from typing import Final

from conftest import REPO_ROOT

SEED: Final = REPO_ROOT / "scripts/ops/seed/seed.js"
LOCAL: Final = REPO_ROOT / "scripts/ops/local.sh"
WORKFLOW: Final = REPO_ROOT / ".github/workflows/verify.yml"

# The seed as written, which CI's main run loads before its loop runs the other states.
DEFAULT: Final = "running"


def _seed_states() -> set[str]:
    """The keys of the seed's `LANDING_STATES` object, each a line of its own two spaces in."""
    text = SEED.read_text(encoding="utf-8")
    block = re.search(r"^const LANDING_STATES = \{\n(.*?)^\};$", text, re.MULTILINE | re.DOTALL)
    assert block, f"{SEED.name} holds no `const LANDING_STATES = {{ … }};` block"
    return set(re.findall(r'^  "?([\w-]+)"?: ', block[1], re.MULTILINE))


def _one_line(text: str, pattern: str, where: str) -> set[str]:
    found = re.findall(pattern, text, re.MULTILINE)
    assert len(found) == 1, f"{where} names the landing's states on {len(found)} lines, where this reader expects one"
    return set(found[0].split())


def test_local_sh_takes_the_seeds_states() -> None:
    seeded = _seed_states()
    assert DEFAULT in seeded, f"the reader finds {sorted(seeded)} in {SEED.name}, without the seed as written"
    named = _one_line(LOCAL.read_text(encoding="utf-8"), r"^LANDING_STATES=\((.*)\)$", LOCAL.name)
    assert named == seeded, f"local.sh names {sorted(named)}, and the seed seeds {sorted(seeded)}"


def test_ci_runs_every_state_the_main_run_does_not() -> None:
    looped = _one_line(WORKFLOW.read_text(encoding="utf-8"), r"^\s*for state in (.*); do$", WORKFLOW.name)
    expected = _seed_states() - {DEFAULT}
    assert looped == expected, f"CI's landing loop runs {sorted(looped)}, and the seed's states beside its own are {sorted(expected)}"


def _bound(block: str, indent: int, where: str) -> int:
    """The one `timeout-minutes` written `indent` spaces in, as Prettier writes the file."""
    found = re.findall(rf"^ {{{indent}}}timeout-minutes: (\d+)$", block, re.MULTILINE)
    assert len(found) == 1, f"{where} carries {len(found)} timeout-minutes, where this reader expects one"
    return int(found[0])


def test_ci_bounds_the_landing_loop_below_its_job() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    job = re.search(r"^  journeys:\n(.*?)(?=^  \S)", text, re.MULTILINE | re.DOTALL)
    assert job, f"{WORKFLOW.name} holds no journeys job"
    step = re.search(r"^      - name: Run the landing's cases under each of its states\n(.*?)(?=^      - )", job[1], re.MULTILINE | re.DOTALL)
    assert step, "the journeys job holds no step running the landing's cases under each of its states"
    job_bound = _bound(job[1], 4, "the journeys job")
    step_bound = _bound(step[1], 8, "the landing's step")
    assert step_bound < job_bound, f"the landing's step may run {step_bound} minutes in a job cancelled after {job_bound}"
