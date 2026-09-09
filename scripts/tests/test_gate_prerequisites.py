"""SCRIPTS · the backend virtualenv the gate needs, driven absent.

A run reporting a missing interpreter as a finding sends its author into the change on a machine
that never held the tool, and nothing later in the run takes that back. The case below drives the
real `scripts/gate/verify.sh` over a copy of `scripts/` with no virtualenv beside it, a lifted line
being unable to show that the guard stands above every scope it protects.

Invariants:
  A prerequisite the machine lacks refuses at `docs/ops/spec.md` §1.7's exit 2, never at 1.
"""

from __future__ import annotations

import shutil
from typing import Final

from conftest import base_env, copy_scripts, new_root, run_shell

# Not a skip condition, for `scripts/tests/test_exit_contract.py :: BASH`'s reason.
BASH: Final = shutil.which("bash")

# One of the four scopes the guard stands above proves it, being one condition over all four; not
# `--db`, whose Docker guard would refuse ahead of it.
SCOPE: Final = "--docs"

# What the gate prints first past the guard, so its absence is the whole of "nothing else ran".
PAST_THE_GUARD: Final = "this run covers"


def test_a_run_with_no_backend_virtualenv_refuses_and_reaches_no_scope() -> None:
    """Exit 2 rather than 1: `.claude/CLAUDE.md` §7 **exit codes** -- no change to the tree creates a virtualenv."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    # Nothing committed under it: the guard stands above the scope check, the one step that reads a
    # repository, so a fixture holding commits would be proving a line this case never reaches.
    root = new_root("fl-gate-prerequisite-")
    copy_scripts(root / "scripts")
    done = run_shell(BASH, root / "scripts" / "gate" / "verify.sh", SCOPE, env=base_env())
    output = done.stdout + done.stderr
    assert done.returncode == 2, output
    assert "No fl_backend virtualenv found" in output, output
    assert "Refused after" in output, output
    assert "finding(s) in this run" not in output, output
    assert PAST_THE_GUARD not in output, output
