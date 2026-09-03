"""SCRIPTS · the shell arms that degrade on the crash status, read against the kernel's own number.

`scripts/lib/checker_kernel.py` declares the status in Python and each arm compares a bash literal
against it. Nothing links the two, so renumbering the kernel leaves every arm comparing to a value
nothing sends — and the arms exist for the interpreter too old to import the kernel, which is why
the number is read out of the source here rather than imported.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Final

from conftest import declared

SCRIPTS: Final = Path(__file__).resolve().parent.parent

# One arm per shell that degrades on the status rather than on the failure. A site added elsewhere
# is outside what this can see.
ARMS: Final[tuple[tuple[str, str], ...]] = (("gate/verify.sh", "OPS_FLOOR"), ("gate/selfcheck.sh", "CLASSIFIER_FLOOR"))


def test_every_shell_arm_reading_the_crash_status_spells_the_kernels_number() -> None:
    """A literal that stops matching degrades silently: the checker runs on an interpreter beneath it."""
    # An interpreter below the kernel's floor is exactly the case these arms exist for, so the
    # number is read out of the source rather than by importing the module that would raise.
    crash = int(declared(SCRIPTS / "lib" / "checker_kernel.py", "EXIT_CRASH"))
    wrong: list[str] = []
    for name, variable in ARMS:
        text = (SCRIPTS / name).read_text(encoding="utf-8")
        spelled = re.findall(r"\(\(\s*" + variable + r"\s*==\s*(\d+)\s*\)\)", text)
        if not spelled:
            wrong.append(f"scripts/{name}: no arm compares {variable} to a status")
        wrong += [f"scripts/{name}: {variable} is compared to {value}, and EXIT_CRASH is {crash}" for value in spelled if int(value) != crash]
    assert not wrong, "\n".join(wrong)
