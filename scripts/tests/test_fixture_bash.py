"""SCRIPTS · the bash `scripts/tests/conftest.py` hands every case, refused where it would fail cases that pass.

From PowerShell the first bash on PATH is a launcher, WSL's or Git's, and most cases running a
script then fail for that alone, naming nothing of why. Each case drives
`scripts/tests/conftest.py :: pytest_configure` in a subprocess with the platform and the bash
rebound as values, so both arms run on every machine.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Final

import pytest
from conftest import MSYS_RUNTIME, base_env, new_root

TESTS: Final = Path(__file__).resolve().parent

# The platform's binding goes between the two halves.
REBOUND: Final[tuple[str, ...]] = (
    "import sys",
    "sys.path.insert(0, sys.argv[1])",
    "import conftest",
    "import pytest",
    "conftest.BASH = sys.argv[2]",
)
CONFIGURED: Final[tuple[str, ...]] = (
    "try:",
    "    conftest.pytest_configure()",
    "except pytest.UsageError as refused:",
    "    sys.exit(str(refused))",
)


def _configure(found: Path, platform: str) -> subprocess.CompletedProcess[str]:
    program = "\n".join((*REBOUND, platform, *CONFIGURED))
    return subprocess.run(
        (sys.executable, "-c", program, str(TESTS), str(found)),
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        env=base_env(),
        check=False,
    )


@pytest.mark.parametrize(
    ("beside", "platform", "refused"),
    [
        pytest.param(False, "conftest.WINDOWS = True", True, id="a-launcher-on-windows"),
        pytest.param(True, "conftest.WINDOWS = True", False, id="git-bash-s-own-on-windows"),
        pytest.param(False, "conftest.WINDOWS = False", False, id="any-bash-elsewhere"),
    ],
)
def test_only_a_bash_beside_the_msys_runtime_runs_the_cases_on_windows(beside: bool, platform: str, refused: bool) -> None:
    """The launcher row is the load-bearing one; the other two keep the refusal from reaching the routes that work."""
    found = new_root("fl-fixture-bash-") / "bin" / "bash.exe"
    found.parent.mkdir()
    found.write_bytes(b"")
    if beside:
        (found.parent / MSYS_RUNTIME).write_bytes(b"")

    done = _configure(found, platform)

    assert (done.returncode != 0) is refused, done.stderr
    assert (str(found) in done.stderr and "Run pytest from Git Bash" in done.stderr) is refused, done.stderr
