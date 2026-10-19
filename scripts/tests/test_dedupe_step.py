"""SCRIPTS · the frontend dedupe step, handed each answer `pnpm dedupe --check` can give, in both output forms.

A copy a dedupe would remove passes the lockfile and peer steps above it, every copy being in range,
so this step is what refuses it. Each case drives the real `scripts/gate/verify.sh` over a copy of
`scripts/` behind a stand-in `pnpm` whose every other command passes, once captured and once under
`--verbose`.

Invariants:
  A copy a dedupe would remove is a finding at exit 1.
  A stop naming no change refuses at `docs/ops/spec.md` §1.7's exit 2: nothing was judged.
"""

from __future__ import annotations

import os
from typing import Final

import pytest
from conftest import BASH, base_env, copy_scripts, new_root, run_shell, write_shell

# Every other command passes, so the dedupe step is the one that can stop the run.
STUB: Final = """#!/usr/bin/env bash
if [[ "${1:-}" == "dedupe" ]]; then
  printf '%s\\n' "${FL_STUB_DEDUPE}"
  exit "${FL_STUB_DEDUPE_RC}"
fi
exit 0
"""

# pnpm's own report of the duplicate a `pnpm add` of an older react-aria range leaves.
DUPLICATE: Final = "\n".join(
    (
        "[ERR_PNPM_DEDUPE_CHECK_ISSUES] Dedupe --check found changes to the lockfile",
        "",
        "Importers",
        ".",
        "└── react-aria 3.52.1 → 3.53.1",
        "",
        "Packages",
        "- react-aria@3.52.1",
        "",
        "Run pnpm dedupe to apply the changes above.",
    )
)
UNREAD: Final = "ERR_PNPM_META_FETCH_FAIL  GET https://registry.npmjs.org/stand-in: request failed"
CLEAN: Final = "Progress: resolved 795, reused 0, downloaded 0, added 0, done"

FINDINGS: Final = "finding(s) in this run"
REFUSED: Final = "Refused after"
PASSED: Final = "no copy a dedupe would remove"
NAMED: Final = "holds a copy of a package that a dedupe would remove"

FORMS: Final = [pytest.param((), id="captured"), pytest.param(("--verbose",), id="verbose")]


def _dedupe_step(answer: str, status: int, *flags: str) -> tuple[int, str]:
    """One `--frontend` run whose `pnpm dedupe --check` answers `answer` at `status`; its status and both streams."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    root = new_root("fl-gate-dedupe-")
    copy_scripts(root / "scripts")
    (root / "fl_frontend" / "node_modules").mkdir(parents=True)
    bin_dir = root / "bin"
    bin_dir.mkdir()
    os.chmod(write_shell(bin_dir / "pnpm", STUB), 0o755)
    environment = base_env()
    environment["PATH"] = str(bin_dir) + os.pathsep + environment["PATH"]
    environment["FL_STUB_DEDUPE"] = answer
    environment["FL_STUB_DEDUPE_RC"] = str(status)
    done = run_shell(BASH, root / "scripts" / "gate" / "verify.sh", "--frontend", *flags, env=environment)
    return done.returncode, done.stdout + done.stderr


@pytest.mark.parametrize("flags", FORMS)
def test_a_copy_a_dedupe_would_remove_is_a_finding(flags: tuple[str, ...]) -> None:
    status, output = _dedupe_step(DUPLICATE, 1, *flags)
    assert status == 1, output
    assert NAMED in output, output
    assert FINDINGS in output, output


@pytest.mark.parametrize("flags", FORMS)
def test_a_stop_naming_no_change_refuses_rather_than_reporting_a_finding(flags: tuple[str, ...]) -> None:
    """The step names no change here, so it cannot say the change needs work."""
    status, output = _dedupe_step(UNREAD, 1, *flags)
    assert status == 2, output
    assert "for a reason this step does not read" in output, output
    assert REFUSED in output, output
    assert FINDINGS not in output, output


def test_a_lockfile_with_no_copy_to_remove_passes_the_step() -> None:
    """The control: without it, a step failing every answer would pass the two cases above."""
    _, output = _dedupe_step(CLEAN, 0)
    assert PASSED in output, output
    assert NAMED not in output, output
