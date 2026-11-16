"""The two Vitest tiers, together, run every project `fl_frontend/vitest.config.mts` defines, and each project once.

Each tier selects its projects by a name pattern in a `package.json` script, so a project named off both patterns runs
in neither, every job green, and one matching both runs twice. Vitest itself answers both sides: an instance its Node
API creates (`createVitest` from `vitest/node`, which starts no test) resolves the config's projects, filtered by the
`project` option as the command line filters them (https://vitest.dev/guide/advanced). `vitest list` would import every
db file, each of which starts a replica set at import, so it is not asked.
"""

from __future__ import annotations

import json
import os
import re
import shutil
from typing import Final

from conftest import REPO_ROOT, run_bounded

FRONTEND: Final = REPO_ROOT / "fl_frontend"
# The tier scripts the gate runs, each selecting its projects by `--project='<pattern>'`.
TIERS: Final = ("test", "test:db")
SELECTION_RE: Final = re.compile(r"--project='([^']+)'")

# Each selection's project names, in the order given, an unfiltered instance's first; a selection matching nothing
# throws, which fails the run. One line: on Windows `pnpm` is a batch shim, and cmd.exe drops everything of an
# argument past its first line break.
NAMES: Final = " ".join(
    (
        "import { createVitest } from 'vitest/node';",
        "const names = async (project) => {",
        "  const vitest = await createVitest({ watch: false, ...(project === null ? {} : { project }) });",
        "  try { return vitest.projects.map((one) => one.name); } finally { await vitest.close(); }",
        "};",
        "const answers = [];",
        "for (const project of [null, ...JSON.parse(process.env.FL_SELECTIONS)]) answers.push(await names(project));",
        "process.stderr.write(`FL_PROJECTS ${JSON.stringify(answers)}\\n`);",
    )
)


def selections() -> dict[str, str]:
    """Each tier script beside the one pattern it selects its projects by."""
    scripts = json.loads((FRONTEND / "package.json").read_bytes())["scripts"]
    found = {tier: SELECTION_RE.findall(scripts.get(tier, "")) for tier in TIERS}
    assert all(len(patterns) == 1 for patterns in found.values()), f"each tier script names one --project pattern, and this reads {found}"
    return {tier: patterns[0] for tier, patterns in found.items()}


def resolved(patterns: list[str]) -> tuple[list[str], list[list[str]]]:
    """Every project the config defines, and the projects each pattern selects, from the frontend's own Vitest."""
    pnpm = shutil.which("pnpm")
    assert pnpm, "no pnpm on PATH, which runs the frontend's Vitest"
    assert (FRONTEND / "node_modules" / "vitest").is_dir(), (
        "fl_frontend holds no install of vitest: run `pnpm install --frozen-lockfile` in fl_frontend"
    )
    # Its answer on stderr behind a marker, since the instance writes to stdout as it starts and closes.
    run = run_bounded(
        (pnpm, "exec", "node", "--input-type=module", "-e", NAMES), cwd=FRONTEND, env=os.environ | {"FL_SELECTIONS": json.dumps(patterns)}
    )
    answer = [line.removeprefix("FL_PROJECTS ") for line in run.stderr.splitlines() if line.startswith("FL_PROJECTS ")]
    assert run.returncode == 0 and len(answer) == 1, f"Vitest's projects for {patterns} exited {run.returncode}:\n{run.stderr[-2000:]}"
    every, *selected = json.loads(answer[0])
    return every, selected


def test_the_tiers_together_run_every_project_once() -> None:
    tiers = selections()
    every, selected = resolved(list(tiers.values()))
    runs = {project: [tier for tier, names in zip(tiers, selected, strict=True) if project in names] for project in every}
    assert every, "Vitest resolved no project out of fl_frontend/vitest.config.mts"
    wrong = {project: tiers_running for project, tiers_running in runs.items() if len(tiers_running) != 1}
    assert not wrong, f"each project runs in exactly one of {sorted(tiers)}, and these run in {wrong}"
