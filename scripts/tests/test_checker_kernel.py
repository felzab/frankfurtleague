"""The checker kernel's launcher: a checker that dies before its `run` line answers the crash, never a finding.

Python answers an uncaught exception, one at import or compile included, with 1, the code the exit contract gives
findings, and `run` in a checker's own `__main__` line reaches neither. So every caller runs a checker through
`scripts/lib/checker_kernel.py`, and a caller that does not reads a broken checker as a finding about the change.
"""

from __future__ import annotations

import re
import subprocess
import sys
from typing import Final

import pytest
from conftest import REPO_ROOT, new_root

KERNEL: Final = REPO_ROOT / "scripts" / "lib" / "checker_kernel.py"
LAUNCHER: Final = "scripts/lib/checker_kernel.py"


def _launched(script: str, *arguments: str) -> tuple[int, str]:
    """`script` written to a fixture file and run through the launcher, its exit code and both streams."""
    path = new_root("fl-checker-kernel-") / "checker.py"
    path.write_bytes(script.encode("utf-8"))
    done = subprocess.run(
        (sys.executable, str(KERNEL), str(path), *arguments), capture_output=True, encoding="utf-8", errors="replace", check=False
    )
    return done.returncode, done.stdout + done.stderr


@pytest.mark.parametrize(
    ("script", "code"),
    [
        pytest.param("import sys\nsys.exit(0 if sys.argv[1:] == ['a', 'b'] else 1)\n", 0, id="its-arguments-reach-the-checker"),
        pytest.param("import sys\nsys.exit(1)\n", 1, id="a-finding-stays-a-finding"),
        pytest.param("import sys\nsys.exit(2)\n", 2, id="a-refusal-stays-a-refusal"),
        pytest.param("import a_module_nobody_wrote\n", 3, id="an-import-that-fails-is-a-crash"),
        pytest.param("def broken(:\n", 3, id="a-checker-that-does-not-compile-is-a-crash"),
        pytest.param("raise RuntimeError('at import')\n", 3, id="an-exception-at-import-is-a-crash"),
    ],
)
def test_the_launcher_answers_the_checker_s_own_code_and_a_crash_for_anything_before_it(script: str, code: int) -> None:
    exited, output = _launched(script, "a", "b")
    assert exited == code, f"exited {exited}, and the exit contract gives it {code}\n{output}"


# A Python file of the gate's own, named on a shell line: the launcher itself aside.
CHECKER_RE: Final = re.compile(r"\bscripts/(?:checks|lib)/(?!checker_kernel\.py)\w+\.py\b")


def test_every_shell_caller_runs_a_checker_through_the_launcher() -> None:
    """A caller naming a checker without the launcher ahead of it reads the checker's import crash as a finding."""
    named: list[str] = []
    unlaunched: list[str] = []
    for path in sorted((REPO_ROOT / "scripts").rglob("*.sh")):
        for number, written in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            # The command alone, a comment after it or on a line of its own aside.
            line = "" if written.lstrip().startswith("#") else written.split(" # ", 1)[0]
            for match in CHECKER_RE.finditer(line):
                named.append(match[0])
                if f"{LAUNCHER} {match[0]}" not in line:
                    unlaunched.append(f"{path.relative_to(REPO_ROOT).as_posix()}:{number}: {line.strip()}")
    # Per checker: a sweep that reads no caller passes over none at all.
    assert {"scripts/checks/check_compose_model.py", "scripts/checks/check_public_routes.py", "scripts/lib/nginx_conf.py"} <= set(named), (
        f"the sweep read callers of {sorted(set(named))} alone"
    )
    assert unlaunched == [], f"a checker run without {LAUNCHER} ahead of it:\n" + "\n".join(unlaunched)
