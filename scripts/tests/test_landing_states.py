"""The landing's states are the seed's, wherever CI names them.

`fl_backend/tests/made_up_seed.py :: LANDING_STATES` seeds each state and refuses any other name. CI's landing loop
names them again to run the landing's cases under each, and a workflow cannot import the seed: a state added to the
seed alone would never run in CI, every job green.

CI's loop also ends inside its job: its step's own bound lies below the job's, or a hang in it
would run into the job's, which cancels the job and with it the steps that keep its diagnostics.
"""

from __future__ import annotations

import ast
import re
from typing import Final

from conftest import REPO_ROOT

SEED: Final = REPO_ROOT / "fl_backend/tests/made_up_seed.py"
WORKFLOW: Final = REPO_ROOT / ".github/workflows/verify.yml"

# The seed as written, which CI's main run loads before its loop runs the other states.
DEFAULT: Final = "running"


def _seed_states() -> set[str]:
    """The keys of the seed's module-level `LANDING_STATES` dict, read from its source rather than imported.

    So the scripts scope runs no backend code. Every key a string written out, so a state built any other way fails
    rather than going unread.
    """
    tree = ast.parse(SEED.read_text(encoding="utf-8"), filename=SEED.name)
    found = [
        node.value
        for node in tree.body
        if isinstance(node, (ast.Assign, ast.AnnAssign))
        and any(
            isinstance(target, ast.Name) and target.id == "LANDING_STATES"
            for target in (node.targets if isinstance(node, ast.Assign) else [node.target])
        )
    ]
    assert len(found) == 1, f"{SEED.name} assigns LANDING_STATES {len(found)} times at its top level, where this reader expects once"
    block = found[0]
    assert isinstance(block, ast.Dict), f"{SEED.name}'s LANDING_STATES is no dict written out"
    keys = [key.value if isinstance(key, ast.Constant) and isinstance(key.value, str) else None for key in block.keys]
    assert None not in keys, f"{SEED.name}'s LANDING_STATES holds a key that is no string written out"
    return {key for key in keys if key is not None}


def _one_line(text: str, pattern: str, where: str) -> set[str]:
    found = re.findall(pattern, text, re.MULTILINE)
    assert len(found) == 1, f"{where} names the landing's states on {len(found)} lines, where this reader expects one"
    return set(found[0].split())


def test_ci_runs_every_state_the_main_run_does_not() -> None:
    seeded = _seed_states()
    assert DEFAULT in seeded, f"the reader finds {sorted(seeded)} in {SEED.name}, without the seed as written"
    looped = _one_line(WORKFLOW.read_text(encoding="utf-8"), r"^\s*for state in (.*); do$", WORKFLOW.name)
    expected = seeded - {DEFAULT}
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
