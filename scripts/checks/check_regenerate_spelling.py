"""SCRIPTS · the one spelling of the command that regenerates the published API document.

The command is printed to whoever has to run it by documents and test files across three trees, and
no package holds them together from inside: a drifted prefix in any of them sends that reader to an
interpreter without the backend's dependencies, where the failure reads as a broken import rather
than as the wrong command. `fl_backend/tests/openapi_document.py` declares the spelling every other
site is held to.

The register is closed both ways: a tracked file naming the command and missing from `SITES` is a
finding, and so is a registered site that has stopped naming it -- a site whose own tail drifted
leaves the population silently, which is the one direction a sweep keyed on that tail cannot see.

Invariants:
  A declaration this sweep cannot compare a site against refuses, rather than reporting every site as drifted.
"""

from __future__ import annotations

import argparse
import ast
import sys
from pathlib import Path
from typing import Final

# Every caller runs this as a script, so sys.path opens with THIS directory and `lib/` is a
# sibling of it rather than in it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import (  # noqa: E402 -- the insert above is what resolves it
    EXIT_REFUSED,
    REPO_ROOT,
    UNREADABLE,
    Finding,
    git,
    report_findings,
    run,
)

HOME: Final = "fl_backend/tests/openapi_document.py"
DECLARATION: Final = "REGENERATE"

# What the declaration opens with, or the command reaches an interpreter holding neither FastAPI nor
# the package the module imports, and fails as an ImportError naming nothing about the spelling.
RUN_THROUGH: Final = "cd fl_backend && uv run "

# The end of the command, which FINDS a site rather than judging one: the prefix is the half that
# drifts, so a population keyed on the whole command would hold only the sites already right.
COMMAND_TAIL: Final = "python -m tests.openapi_document --write"

# This file spells the tail, so it stands in its own population. Excluded by path rather than by
# splitting that literal across an operator: the split survives only while `__pycache__` stays ignored.
SELF: Final = "scripts/checks/check_regenerate_spelling.py"

# Where the command is printed to somebody who has to run it, hand-written and closed both ways
# below.
SITES: Final[tuple[str, ...]] = (
    ".claude/commands/docs/audit.md",
    "docs/backend/spec.md",
    "fl_frontend/src/core/apiContract.test.ts",
    "fl_frontend/src/core/apiRequests.test.ts",
    "fl_frontend/src/core/einwilligung.test.ts",
)

# The column `checker_kernel.py :: report_findings` leaves after its `FAIL` tag, so a finding's second
# line lands under its first.
CONTINUATION: Final = " " * 14

# How much of the line in front of the command a finding quotes. A site's line can be a whole
# spec-sheet table row, and what its reader repairs is the prefix rather than the row.
QUOTED_LEAD: Final = 60


class Refusal(Exception):
    """Input this sweep cannot judge: a tree it cannot list, or a declaration no site can be compared against."""


def declared(source: Path) -> str:
    """The command as the backend declares it, read out of the source rather than imported.

    An import builds the application, which reaches FastAPI and the settings this checker's own
    environment is not asked to hold.
    """
    try:
        tree = ast.parse(source.read_bytes().decode("utf-8"))
    except UNREADABLE as error:
        raise Refusal(f"{HOME}: {error}") from error
    except SyntaxError as error:
        raise Refusal(f"{HOME}: the declaration could not be parsed out of it -- {error}") from error
    for node in ast.walk(tree):
        if isinstance(node, ast.AnnAssign) and node.value is not None and getattr(node.target, "id", "") == DECLARATION:
            return _usable(node.value)
    raise Refusal(f"{HOME} no longer declares {DECLARATION}, which is the one spelling every site below is held to")


def _usable(value: ast.expr) -> str:
    """One declaration, refused where it is not a reference this sweep can hold a site to."""
    try:
        command = ast.literal_eval(value)
    except ValueError as error:
        raise Refusal(f"{HOME} declares {DECLARATION} as something no reader can evaluate -- {error}") from error
    if not isinstance(command, str):
        raise Refusal(f"{HOME} declares {DECLARATION} as a {type(command).__name__}, and a site names a command rather than one of those")
    # Refused rather than reported: every site still spelling the old command would otherwise be a
    # finding telling its reader to copy this one, and the defect is here.
    if not command.startswith(RUN_THROUGH):
        raise Refusal(f"{HOME} declares {DECLARATION} as {command!r}, which does not run through the project environment")
    if not command.endswith(COMMAND_TAIL):
        raise Refusal(f"{HOME} declares {DECLARATION} as {command!r}, which is not the command this sweep finds a site by")
    return command


def tracked(root: Path) -> list[str]:
    """Every path git tracks in `root`.

    `-C` rather than a launcher of this checker's own: the kernel runs git at THIS repository, and
    the tree is an argument so a suite can drive it over a planted one.
    """
    listing = git("-C", str(root), "ls-files", "-z")
    if listing is None:
        raise Refusal(f"{root}: git could not list the tracked files here")
    return [name for name in listing.split("\0") if name]


def sweep(root: Path, paths: list[str]) -> tuple[dict[str, list[tuple[int, str]]], list[str]]:
    """Every tracked file's lines naming the command, and the paths this run could not read."""
    found: dict[str, list[tuple[int, str]]] = {}
    unread: list[str] = []
    tail = COMMAND_TAIL.encode("utf-8")
    for name in paths:
        if name == SELF:
            continue
        try:
            raw = (root / name).read_bytes()
        except UNREADABLE as error:
            unread.append(f"{name}: {error}")
            continue
        if tail not in raw:
            continue
        # Decoded only under the marker, which is ASCII: a file that cannot hold it never reaches
        # this, so no image or archive in the tree is decoded to be swept.
        try:
            text = raw.decode("utf-8")
        except UNREADABLE as error:
            unread.append(f"{name}: {error}")
            continue
        found[name] = [(number, line) for number, line in enumerate(text.split("\n"), start=1) if COMMAND_TAIL in line]
    return found, unread


def spelling(line: str) -> str:
    """One line's command through a window ending at the command, an ellipsis marking what was cut."""
    end = line.index(COMMAND_TAIL) + len(COMMAND_TAIL)
    start = max(0, end - len(COMMAND_TAIL) - QUOTED_LEAD)
    return f"{'...' if start else ''}{line[start:end].strip()}"


def judge(found: dict[str, list[tuple[int, str]]], command: str) -> list[Finding]:
    """Every site against the declaration, and the population against the register."""
    findings: list[Finding] = []
    for site in SITES:
        lines = found.get(site)
        if not lines:
            findings.append(
                Finding(
                    "fail",
                    f"{site} no longer names the command, so this register pins a site nobody reads\n"
                    f"{CONTINUATION}drop it from {SELF} :: SITES, or restore the command it printed",
                )
            )
            continue
        findings.extend(
            Finding(
                "fail",
                f"{site}:{number} spells the command as: {spelling(line)}\n{CONTINUATION}{HOME} declares it as: {command}",
            )
            for number, line in lines
            if command not in line
        )
    findings.extend(
        Finding(
            "fail",
            f"{name} names the command and no entry in {SELF} :: SITES registers it\n"
            f"{CONTINUATION}register it, or its spelling is compared to nothing the day the declaration moves",
        )
        for name in sorted(found)
        if name != HOME and name not in SITES
    )
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Does every file naming the regenerate command spell it the way the backend declares it?")
    parser.add_argument("root", nargs="?", metavar="ROOT", help=f"the tree to sweep (default: {REPO_ROOT})")
    args = parser.parse_args()
    root = Path(args.root).resolve() if args.root else REPO_ROOT

    try:
        command = declared(root / HOME)
        found, unread = sweep(root, tracked(root))
    except Refusal as refusal:
        print(f"      {refusal}", file=sys.stderr)
        print("      Nothing was swept, so this is a refusal rather than a verdict on the spellings.", file=sys.stderr)
        return EXIT_REFUSED

    findings = judge(found, command)
    code = report_findings(findings)

    if findings:
        print(f"\n      One spelling, declared at {HOME} :: {DECLARATION} and printed unchanged by")
        print("      every site that names it. A drifted prefix reaches an interpreter without the")
        print(f"      backend's dependencies; the register is {SELF} :: SITES.")

    for line in unread:
        print(f"      {line}", file=sys.stderr)
    if unread:
        print("      Those files were not read, so nothing here closes the register against them.", file=sys.stderr)

    if not findings:
        print(f"      {len(found)} tracked file(s) name the command, {len(SITES)} registered site(s) beside {HOME}")

    # A finding outranks a refusal, for the reason `scripts/checks/check_conflict_markers.py` records
    # at its own: exit 2 says nothing here stands as a verdict, contradicting the FAIL lines above it.
    if unread and not findings:
        return EXIT_REFUSED
    return code


if __name__ == "__main__":
    sys.exit(run(main))
