from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Final

SCRIPTS: Final = Path(__file__).resolve().parent.parent

# One arm per shell that degrades on the status rather than on the failure. A site added elsewhere
# is outside what this can see.
ARMS: Final[tuple[tuple[str, str], ...]] = (("gate/verify.sh", "OPS_FLOOR"), ("gate/selfcheck.sh", "CLASSIFIER_FLOOR"))


def _crash_status() -> int:
    """EXIT_CRASH as the kernel's source declares it.

    Read out of the source, never imported: the module raises on an interpreter below its own floor,
    which is the case this pairing exists for.
    """
    source = (SCRIPTS / "lib" / "checker_kernel.py").read_text(encoding="utf-8")
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
