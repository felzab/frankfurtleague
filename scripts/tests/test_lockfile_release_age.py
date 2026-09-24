"""SCRIPTS · the frontend lockfile step, handed each stop pnpm can make, in both output forms.

pnpm checks every locked release against its minimum age before it compares the lockfile with the
manifest, so a release too young stops the step with no comparison made, and the same lockfile
passes unchanged once the release is old enough. The step grades a stop by the code pnpm printed,
so each case drives the real `scripts/gate/verify.sh` over a copy of `scripts/` behind a stand-in
`pnpm`, once captured and once under `--verbose`, the form that streams the code as it grades it.

Invariants:
  pnpm's release-age stop refuses at `docs/ops/spec.md` §1.7's exit 2, never at 1.
  Each stop grades alike with and without `--verbose`.
"""

from __future__ import annotations

import os
from typing import Final

import pytest
from conftest import BASH, base_env, copy_scripts, new_root, run_shell, write_shell

# The code is the whole of what the step reads: the rest of pnpm's report is replayed, never parsed.
STUB: Final = """#!/usr/bin/env bash
if [[ "${1:-}" == "install" ]]; then
  printf '%s\\n' "${FL_STUB_STOP}"
  exit 1
fi
exit 0
"""

RELEASE_AGE: Final = "ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION  stand-in@1.0.0 was released too recently"
# A drift is the one stop the change can be fixed to answer for, so it is the control: a step
# grading everything at 2 fails here rather than passing every refusal case.
DRIFT: Final = "ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with frozen-lockfile because pnpm-lock.yaml is not up to date"

FINDINGS: Final = "finding(s) in this run"
REFUSED: Final = "Refused after"

# Both forms: `--verbose` streams the output the step grades by, which the captured form holds back.
FORMS: Final = [pytest.param((), id="captured"), pytest.param(("--verbose",), id="verbose")]


def _lockfile_step(stop: str, *flags: str) -> tuple[int, str]:
    """One `--frontend` run whose `pnpm install` stops with `stop`; its status and both streams."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    root = new_root("fl-gate-release-age-")
    copy_scripts(root / "scripts")
    # The install guard asks only that the directory exists; the stand-in answers every tool.
    (root / "fl_frontend" / "node_modules").mkdir(parents=True)
    bin_dir = root / "bin"
    bin_dir.mkdir()
    # The execute bit is what puts this ahead of a real pnpm on PATH.
    os.chmod(write_shell(bin_dir / "pnpm", STUB), 0o755)
    environment = base_env()
    environment["PATH"] = str(bin_dir) + os.pathsep + environment["PATH"]
    environment["FL_STUB_STOP"] = stop
    done = run_shell(BASH, root / "scripts" / "gate" / "verify.sh", "--frontend", *flags, env=environment)
    return done.returncode, done.stdout + done.stderr


@pytest.mark.parametrize("flags", FORMS)
def test_a_release_too_young_to_install_refuses_rather_than_reporting_a_finding(flags: tuple[str, ...]) -> None:
    """Exit 2 rather than 1: `.claude/CLAUDE.md` §7 **exit codes** -- pnpm stopped before judging the lockfile."""
    status, output = _lockfile_step(RELEASE_AGE, *flags)
    assert status == 2, output
    assert "pins releases younger than" in output, output
    assert REFUSED in output, output
    assert FINDINGS not in output, output


@pytest.mark.parametrize("flags", FORMS)
def test_a_lockfile_that_drifted_from_its_manifest_is_a_finding(flags: tuple[str, ...]) -> None:
    status, output = _lockfile_step(DRIFT, *flags)
    assert status == 1, output
    assert "no longer answers its manifest" in output, output
    assert FINDINGS in output, output
