"""The journeys job's legs, together, run every project the Playwright config defines.

Each leg names its projects by hand, so a project added to `fl_frontend/playwright.config.ts` alone would run in no leg,
every job green. Playwright itself answers both sides: its JSON reporter's `config.projects` is every project the
config defines, and each test it lists for a leg's flags carries the project it runs in, the projects those reach
through `dependencies` among them (https://playwright.dev/docs/test-reporters#json-reporter). `--list` runs no test,
so no stack is needed, only the frontend's install.

Here in the scripts scope rather than as a step of a journeys leg, which installs the frontend anyway, so a local run of
the gate holds the rule too: the price is that the scripts scope needs `fl_frontend/node_modules`, and CI's scripts job
a frontend install of its own.
"""

from __future__ import annotations

import json
import os
import re
import shutil
from typing import Any, Final

from conftest import REPO_ROOT, run_bounded

WORKFLOW: Final = REPO_ROOT / ".github" / "workflows" / "verify.yml"
FRONTEND: Final = REPO_ROOT / "fl_frontend"

# A job is a key two spaces under `jobs:`, as Prettier writes the file, and it ends where the next one starts.
JOB_RE: Final = re.compile(r"^  journeys:\n(.*?)(?=^  \S|\Z)", re.MULTILINE | re.DOTALL)
LEG_RE: Final = re.compile(r"^ +- leg: (\S+)\n +projects: (.+)$", re.MULTILINE)


def legs() -> dict[str, list[str]]:
    """Each leg of the journeys matrix beside its flags, one word each, as the job's own `read -r -a` splits them."""
    job = JOB_RE.search(WORKFLOW.read_bytes().decode("utf-8"))
    assert job, f"{WORKFLOW.name} holds no journeys job"
    found = {leg: flags.split() for leg, flags in LEG_RE.findall(job[1])}
    written = len(re.findall(r"^ +- leg: ", job[1], re.MULTILINE))
    assert found and len(found) == written, f"the journeys job writes {written} leg(s), and this reader finds {sorted(found)}"
    return found


def listed(flags: list[str]) -> dict[str, Any]:
    """Playwright's JSON report of what a run with these flags would run, from the frontend's own install."""
    pnpm = shutil.which("pnpm")
    assert pnpm, "no pnpm on PATH, which runs the frontend's Playwright"
    assert (FRONTEND / "node_modules" / "@playwright" / "test").is_dir(), (
        "fl_frontend holds no install of @playwright/test: run `pnpm install --frozen-lockfile` in fl_frontend"
    )
    # Its report to stdout alone, never to a file a caller's environment names.
    env = {name: value for name, value in os.environ.items() if not name.startswith("PLAYWRIGHT_JSON_OUTPUT")}
    run = run_bounded((pnpm, "exec", "playwright", "test", "--list", "--reporter=json", *flags), cwd=FRONTEND, env=env)
    assert run.returncode == 0, f"playwright test --list {' '.join(flags)} exited {run.returncode}:\n{run.stderr}{run.stdout[-2000:]}"
    return json.loads(run.stdout)


def projects_run(report: dict[str, Any]) -> set[str]:
    """The project of every test a report lists, its suites walked whole."""
    found: set[str] = set()
    suites = list(report["suites"])
    while suites:
        suite = suites.pop()
        found |= {test["projectName"] for spec in suite.get("specs", []) for test in spec["tests"]}
        suites += suite.get("suites", [])
    return found


def test_the_legs_together_run_every_project() -> None:
    reports = {leg: listed(flags) for leg, flags in legs().items()}
    defined = {project["name"] for project in next(iter(reports.values()))["config"]["projects"]}
    run = set().union(*(projects_run(report) for report in reports.values()))
    assert defined, "Playwright lists no project of fl_frontend/playwright.config.ts: the reader went inert"
    unrun = sorted(defined - run)
    assert unrun == [], f"{unrun} run in no leg of {WORKFLOW.name}'s journeys job, whose legs run {sorted(run)}"
