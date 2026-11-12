"""SCRIPTS · the gate's scopes and the workflow's jobs, each held to the other.

Every event runs every scope (`docs/decisions.md`, **ci**). The workflow's `verify` job proves each job sits in its
`needs`, and nothing else proves each scope has a job: a scope added to `scripts/gate/verify.sh :: SCOPES` alone would
run locally and never in CI, every check green.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Final

from conftest import REPO_ROOT

GATE: Final = REPO_ROOT / "scripts" / "gate" / "verify.sh"
WORKFLOW: Final = REPO_ROOT / ".github" / "workflows" / "verify.yml"

# The jobs that run no scope, each for its reason.
SCOPELESS: Final = {
    "journeys": "the end-to-end journeys, which the gate leaves to CI",
    "verify": "the verdict over every other job",
    "publish": "the push of the images a run on main checked",
}

SCOPES_RE: Final = re.compile(r"^SCOPES=\(([^)]*)\)$", re.MULTILINE)
# A job is a key two spaces under `jobs:`, as Prettier writes the file.
JOB_RE: Final = re.compile(r"^  ([A-Za-z0-9_-]+):\s*$")
RUN_RE: Final = re.compile(r"\./scripts/gate/verify\.sh --([a-z-]+)")


def gate_scopes() -> list[str]:
    """The scopes `verify.sh` runs, as its `SCOPES` array lists them."""
    found = SCOPES_RE.search(GATE.read_bytes().decode("utf-8"))
    assert found is not None, f"{GATE.name} declares no SCOPES=(...) line this reader finds"
    return found[1].split()


def job_scopes() -> dict[str, list[str]]:
    """Each job of the workflow beside every scope its steps run `verify.sh` with."""
    jobs: dict[str, list[str]] = {}
    current = None
    inside = False
    for line in WORKFLOW.read_bytes().decode("utf-8").splitlines():
        if line == "jobs:":
            inside = True
            continue
        if not inside:
            continue
        if line and not line.startswith(" "):
            break
        named = JOB_RE.match(line)
        if named:
            current = named[1]
            jobs[current] = []
        elif current is not None:
            jobs[current] += RUN_RE.findall(line)
    return jobs


def test_every_scope_has_one_job_and_every_job_one_scope() -> None:
    """A scope no job runs is one CI never judges, and a job running none or two is a scope's job no longer."""
    scopes = gate_scopes()
    jobs = job_scopes()
    assert scopes and jobs, f"read {len(scopes)} scope(s) and {len(jobs)} job(s): a reader went inert"

    run = Counter(scope for found in jobs.values() for scope in found)
    unjobbed = [scope for scope in scopes if run[scope] == 0]
    twice = sorted(scope for scope, count in run.items() if count > 1)
    unknown = sorted(scope for scope in run if scope not in scopes)
    crowded = sorted(name for name, found in jobs.items() if len(found) > 1)
    idle = sorted(name for name, found in jobs.items() if not found and name not in SCOPELESS)
    stale = sorted(name for name in SCOPELESS if name not in jobs or jobs[name])

    assert unjobbed == [], f"{GATE.name} runs {unjobbed}, which no job of {WORKFLOW.name} runs"
    assert twice == [], f"{WORKFLOW.name} runs {twice} in more than one job"
    assert unknown == [], f"{WORKFLOW.name} runs {unknown}, which {GATE.name} :: SCOPES does not list"
    assert crowded == [], f"{crowded} each run more than one scope, where a job is one scope's"
    assert idle == [], f"{idle} run no scope and are not among this test's SCOPELESS jobs"
    assert stale == [], f"SCOPELESS names {stale}, which is no job of {WORKFLOW.name} or runs a scope"
