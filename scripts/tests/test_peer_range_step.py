"""SCRIPTS · the frontend peer step, handed each answer `pnpm peers check` can give, in both output forms.

`strictPeerDependencies` refuses an out-of-range peer only in the install that resolves, and the
lockfile that failed install writes passes every frozen install, so this step is what refuses it.
Each case drives the real `scripts/gate/verify.sh` over a copy of `scripts/` behind a stand-in `pnpm`
whose install passes, once captured and once under `--verbose`.

Invariants:
  An unmet peer is a finding at exit 1.
  A stop naming no peer refuses at `docs/ops/spec.md` §1.7's exit 2: nothing was judged.
"""

from __future__ import annotations

import os
from typing import Final

import pytest
from conftest import BASH, base_env, copy_scripts, new_root, run_shell, write_shell

# Every other command passes, so the peer step is the one that can stop the run.
STUB: Final = """#!/usr/bin/env bash
if [[ "${1:-}" == "peers" ]]; then
  printf '%s\\n' "${FL_STUB_PEERS}"
  exit "${FL_STUB_PEERS_RC}"
fi
exit 0
"""

UNMET: Final = "\n".join(
    (
        "Issues with peer dependencies found",
        "",
        "✕ unmet peer react-aria",
        "  Installed: 3.51.0",
        "  Wanted:",
        "    ^3.52.1:",
        "      @heroui/react@3.2.6",
    )
)
UNREAD: Final = "ERR_PNPM_META_FETCH_FAIL  GET https://registry.npmjs.org/stand-in: request failed"
CLEAN: Final = "No peer dependency issues found"

FINDINGS: Final = "finding(s) in this run"
REFUSED: Final = "Refused after"
PASSED: Final = "every peer in range"

FORMS: Final = [pytest.param((), id="captured"), pytest.param(("--verbose",), id="verbose")]


def _peer_step(answer: str, status: int, *flags: str) -> tuple[int, str]:
    """One `--frontend` run whose `pnpm peers check` answers `answer` at `status`; its status and both streams."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    root = new_root("fl-gate-peers-")
    copy_scripts(root / "scripts")
    (root / "fl_frontend" / "node_modules").mkdir(parents=True)
    bin_dir = root / "bin"
    bin_dir.mkdir()
    os.chmod(write_shell(bin_dir / "pnpm", STUB), 0o755)
    environment = base_env()
    environment["PATH"] = str(bin_dir) + os.pathsep + environment["PATH"]
    environment["FL_STUB_PEERS"] = answer
    environment["FL_STUB_PEERS_RC"] = str(status)
    done = run_shell(BASH, root / "scripts" / "gate" / "verify.sh", "--frontend", *flags, env=environment)
    return done.returncode, done.stdout + done.stderr


@pytest.mark.parametrize("flags", FORMS)
def test_an_unmet_peer_is_a_finding(flags: tuple[str, ...]) -> None:
    status, output = _peer_step(UNMET, 1, *flags)
    assert status == 1, output
    assert "installs a peer outside the range" in output, output
    assert FINDINGS in output, output


@pytest.mark.parametrize("flags", FORMS)
def test_a_stop_naming_no_peer_refuses_rather_than_reporting_a_finding(flags: tuple[str, ...]) -> None:
    """The step names no peer here, so it cannot say the change needs work."""
    status, output = _peer_step(UNREAD, 1, *flags)
    assert status == 2, output
    assert "for a reason this step does not read" in output, output
    assert REFUSED in output, output
    assert FINDINGS not in output, output


def test_a_tree_with_every_peer_in_range_passes_the_step() -> None:
    """The control: without it, a step failing every answer would pass the two cases above."""
    _, output = _peer_step(CLEAN, 0)
    assert PASSED in output, output
    assert "installs a peer outside the range" not in output, output
