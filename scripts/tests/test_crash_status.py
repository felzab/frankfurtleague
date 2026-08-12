"""SCRIPTS · the crash status, asserted where two shells spell it as a literal

`checker_kernel.py :: EXIT_CRASH` is what a checker's import-time floor guard raises, and two shell
arms read that status back as a number of their own to tell an interpreter below the floor from a
checker that failed. A comment is not a guard (ADR-0066), so the pairing is asserted here.

Invariants:
- Stdlib only, for the reason `test_check_docs.py` gives.
- `EXIT_CRASH` is read out of the source rather than imported: the module raises on an interpreter
  below its own floor, which is the case this pairing exists for.
- The named arms must exist. A site added elsewhere is outside what this can see.

See:
- scripts/checker_kernel.py — the status, and the guard that raises it
"""

from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Final

SCRIPTS: Final = Path(__file__).resolve().parent.parent

# One arm per shell that degrades on the status rather than on the failure: the compose mirror's
# skip, and the classifier fixtures'.
ARMS: Final[tuple[tuple[str, str], ...]] = (("verify.sh", "OPS_FLOOR"), ("selfcheck.sh", "CLASSIFIER_FLOOR"))


def _crash_status() -> int:
    """EXIT_CRASH as the kernel's source declares it."""
    source = (SCRIPTS / "checker_kernel.py").read_text(encoding="utf-8")
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.AnnAssign) and node.value is not None and getattr(node.target, "id", "") == "EXIT_CRASH":
            return int(ast.literal_eval(node.value))
    raise AssertionError("checker_kernel.py no longer declares EXIT_CRASH")


def test_every_shell_arm_reading_the_crash_status_spells_the_kernels_number() -> None:
    """A literal that stops matching degrades silently: the checker runs on an interpreter beneath it."""
    crash = _crash_status()
    wrong: list[str] = []
    for name, variable in ARMS:
        text = (SCRIPTS / name).read_text(encoding="utf-8")
        spelled = re.findall(r"\(\(\s*" + variable + r"\s*==\s*(\d+)\s*\)\)", text)
        if not spelled:
            wrong.append(f"scripts/{name}: no arm compares {variable} to a status")
        wrong += [f"scripts/{name}: {variable} is compared to {value}, and EXIT_CRASH is {crash}" for value in spelled if int(value) != crash]
    assert not wrong, "\n".join(wrong)
