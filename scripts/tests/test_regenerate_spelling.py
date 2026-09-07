"""SCRIPTS · the one spelling of the command that regenerates the published API document

Six files across three trees print that command to whoever has to run it, so no package can hold
them together from inside: a drifted prefix in any of them sends that reader to an interpreter
without the backend's dependencies, and the failure reads as a broken import rather than as the
wrong command. `fl_backend/tests/openapi_document.py` declares the spelling and the cases below
hold every other site to it, read off that module's source because this suite runs on an
interpreter that has no backend virtualenv.

Invariants:
  The register is closed both ways: a file naming the command and missing from SITES fails the sweep.
  Nothing here spells the command as one literal, which would put this module into its own sweep.
"""

from __future__ import annotations

from pathlib import Path
from typing import Final

from conftest import REPO_ROOT, declared, git

COMMAND_TAIL: Final = "python -m tests." + "openapi_document --write"

HOME: Final = REPO_ROOT / "fl_backend" / "tests" / "openapi_document.py"

SITES: Final[tuple[str, ...]] = (
    ".claude/commands/docs/audit.md",
    "docs/backend/spec.md",
    "fl_frontend/src/core/apiContract.test.ts",
    "fl_frontend/src/core/apiRequests.test.ts",
    "fl_frontend/src/core/einwilligung.test.ts",
)


def regenerate() -> str:
    """The command as the backend declares it, read out of the source rather than imported."""
    return str(declared(HOME, "REGENERATE"))


def naming_the_command() -> set[str]:
    """Every tracked file carrying the command, derived from git rather than from the register it is compared to."""
    tail = COMMAND_TAIL.encode("utf-8")
    tracked = (REPO_ROOT / rel for rel in git(REPO_ROOT, "ls-files", "-z").split("\0") if rel)
    return {path.relative_to(REPO_ROOT).as_posix() for path in tracked if path.is_file() and tail in path.read_bytes()}


def test_the_declared_command_runs_through_the_project_environment():
    """`uv run` rather than a bare `python`.

    Outside an activated virtualenv the interpreter has neither FastAPI nor the package the module imports.
    """
    assert regenerate() == "cd fl_backend && uv run " + COMMAND_TAIL


# A loop, not parametrize, for `scripts/tests/conftest.py`'s pytest invariant. Every site is judged
# before the assertion, so one drifted spelling does not hide the sites behind it.
def test_every_site_spells_the_command_the_way_the_backend_declares_it():
    wrong: list[str] = []
    for site in SITES:
        lines = [line for line in Path(REPO_ROOT / site).read_text(encoding="utf-8").splitlines() if COMMAND_TAIL in line]
        if not lines:
            wrong.append(f"{site} no longer names the command, so this register pins a site nobody reads")
        wrong.extend(f"{site} spells the command as: {line.strip()}" for line in lines if regenerate() not in line)
    assert not wrong, "; ".join(wrong)


def test_every_file_naming_the_command_is_one_this_register_covers():
    """The other direction: a site added later would otherwise print whatever it was written with, compared to nothing."""
    assert naming_the_command() == {HOME.relative_to(REPO_ROOT).as_posix(), *SITES}
