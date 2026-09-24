"""SCRIPTS · the frontend lockfile step, handed pnpm's release-age stop.

pnpm checks every locked release against its minimum age before it compares the lockfile with the
manifest, so a release too young stops the step with no comparison made, and the same lockfile
passes unchanged once the release is old enough. The case drives the real `scripts/gate/verify.sh`
over a copy of `scripts/` behind a stand-in `pnpm`, so no install and no registry.

Invariants:
  pnpm's release-age stop refuses at `docs/ops/spec.md` §1.7's exit 2, never at 1.
"""

from __future__ import annotations

import os
from typing import Final

from conftest import BASH, base_env, copy_scripts, new_root, run_shell, write_shell

# The code is the whole of what the step reads: the rest of pnpm's report is replayed, never parsed.
STUB: Final = """#!/usr/bin/env bash
if [[ "${1:-}" == "install" ]]; then
  printf '%s\\n' "ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION  stand-in@1.0.0 was released too recently"
  exit 1
fi
exit 0
"""


def test_a_release_too_young_to_install_refuses_rather_than_reporting_a_finding() -> None:
    """Exit 2 rather than 1: `.claude/CLAUDE.md` §7 **exit codes** -- no change to the tree ages a release."""
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
    done = run_shell(BASH, root / "scripts" / "gate" / "verify.sh", "--frontend", env=environment)
    output = done.stdout + done.stderr
    assert done.returncode == 2, output
    assert "pins releases younger than" in output, output
    assert "Refused after" in output, output
    assert "finding(s) in this run" not in output, output
