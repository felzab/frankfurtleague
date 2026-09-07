"""SCRIPTS · the In-code Scope, held to the gate that reads it.

`docs/_standard/standard.md`'s Scope line names the trees and
`scripts/checks/docs_gate/kernel.py`'s suffix registers name the kinds; this file sweeps the first
for a file whose kind the second leaves unread. What the sweep catches is a tree the Scope names and
this repository does not hold, a Dockerfile, workflow or manifest the Scope reaches by kind while
`scripts/checks/docs_gate/branch.py :: _bounded` does not, and one of those three drifting inside a
named tree. That predicate is asked rather than rebuilt, so the grading is the gate's own; the
population is those trees alone, which is why the last case below asks about the paths outside every
one of them.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from collections.abc import Iterable
from pathlib import Path
from typing import Final

from conftest import declared, git

REPO_ROOT: Final = Path(__file__).resolve().parents[2]
SCRIPTS: Final = REPO_ROOT / "scripts"
STANDARD: Final = REPO_ROOT / "docs" / "_standard" / "standard.md"

# The section whose scope line this is, and the label opening it. Both are `docs/_standard/standard.md`'s own
# spelling; a rename leaves the reader finding nothing, which fails rather than passing empty.
IN_CODE_HEADING: Final = "## In-code"
SCOPE_LABEL: Final = "Scope:"
# The kernel holding the suffix registers, and the gate function that reads them.
KERNEL: Final = "checks/docs_gate/kernel.py"
BOUNDED: Final = "_bounded"
# The gate's own package, and the only path a driver needs: `scripts/checks/docs_gate/__init__.py`
# puts `lib/` on the path itself, before a sibling of it is compiled.
CHECKS: Final = SCRIPTS / "checks"
_ASK: Final = "\n".join(
    (
        "import json, sys",
        "sys.path.insert(0, sys.argv[1])",
        f"from docs_gate.branch import {BOUNDED}",
        f"json.dump([rel for rel in json.load(sys.stdin) if {BOUNDED}(rel)], sys.stdout)",
    )
)
BACKTICKED: Final = re.compile(r"`([^`\n]+)`")
# A working tree carries these inside the scanned trees and the index carries none of them, so a
# walk that kept them would fail on whatever the last build or test run left behind.
UNTRACKED_DIRS: Final = frozenset({"__pycache__", "node_modules", ".venv", ".next", ".pytest_cache", ".ruff_cache"})


def _declared(module: str, name: str) -> tuple[str, ...]:
    """One module-level tuple of strings, named relative to `scripts/`.

    `scripts/tests/test_check_docs.py` drives a COPY of this package under the same name, so a
    module imported here would decide which of the two trees either file measures.
    """
    return tuple(str(entry) for entry in declared(SCRIPTS / module, name))


def _scoped_by_the_standard() -> tuple[str, ...]:
    """The subtrees the In-code section names, as its scope line spells them, once each.

    That line names one tree twice, to say what the kind register keeps out of it.
    """
    lines = STANDARD.read_text(encoding="utf-8").split("\n")
    at = next((index for index, line in enumerate(lines) if line.strip() == IN_CODE_HEADING), None)
    assert at is not None, f"docs/_standard/standard.md no longer carries a {IN_CODE_HEADING!r} heading"
    opening = next((index for index in range(at + 1, at + 8) if lines[index].startswith(SCOPE_LABEL)), None)
    assert opening is not None, f"the In-code section no longer opens on a {SCOPE_LABEL!r} line"
    # The Scope line runs past its first physical line, so the blank line below it is what ends it.
    end = next((index for index in range(opening, len(lines)) if not lines[index].strip()), len(lines))
    tokens = BACKTICKED.findall("\n".join(lines[opening:end]))
    # A citation beside the trees names the by-kind registers, which is the Scope's other half
    # rather than a tree in it.
    return tuple(dict.fromkeys(token for token in tokens if "::" not in token))


def _folder(token: str) -> str:
    return token.rstrip("/")


def _scanned_suffixes() -> tuple[str, ...]:
    """The one suffix register `_bounded` reads, summed here because the kernel declares it as a sum."""
    return _declared(KERNEL, "SOURCE_SUFFIXES") + _declared(KERNEL, "OPS_SUFFIXES")


def _tracked() -> tuple[str, ...]:
    """Every path this repository's index holds, which is the population the Scope line reads.

    `core.quotePath=false`: a path outside ascii arrives escaped otherwise, and a caller below reads
    the suffix it ends on.
    """
    return tuple(rel for rel in git(REPO_ROOT, "-c", "core.quotePath=false", "ls-files").split("\n") if rel)


# `package` points the ask at a copy of this package whose `_bounded` was widened by hand, which is
# how a case here is shown to fail; every call below asks the tree.
def _bounded_by_the_gate(paths: Iterable[str], *, package: Path = CHECKS) -> frozenset[str]:
    """Which of the paths asked about the gate's own `_bounded` bounds, in one subprocess.

    For `scripts/tests/test_scope_agreement.py :: _declared`'s reason: an import here would decide
    which of the two trees `scripts/tests/test_check_docs.py` measures.
    """
    done = subprocess.run(
        (sys.executable, "-c", _ASK, str(package)),
        input=json.dumps(list(paths)),
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    assert done.returncode == 0, f"{BOUNDED} could not be asked: {done.stderr.strip() or done.stdout.strip()}"
    return frozenset(json.loads(done.stdout))


def test_every_tree_the_standard_names_is_a_path_this_repository_holds() -> None:
    """A Scope line naming a path nobody has reaches no file, which reads exactly like a clean sweep."""
    named = _scoped_by_the_standard()
    assert named, "the standard's scope line names nothing"
    missing = [entry for entry in named if not (REPO_ROOT / entry).exists()]
    assert not missing, f"no such path: {missing}"


def test_a_file_of_an_unread_kind_inside_a_named_tree_is_not_bounded() -> None:
    """A tree is in scope for the kinds the gate reads, and a stylesheet in one is not among them."""
    suffixes = _scanned_suffixes()
    names = _declared(KERNEL, "OPS_FILENAMES")
    named = _scoped_by_the_standard()
    unread = [
        rel
        for tree in named
        for path in (REPO_ROOT / tree).rglob("*")
        if path.is_file()
        and UNTRACKED_DIRS.isdisjoint(path.parts)
        and not (rel := path.relative_to(REPO_ROOT).as_posix()).endswith((*suffixes, ".md"))
        and path.name not in names
    ]
    # Without one the sweep asserts nothing, and the tree half went unwatched for exactly that reason.
    assert unread, f"no file of an unread kind sits under {named}, so this proves nothing"
    bounded = _bounded_by_the_gate(unread)
    assert not bounded, f"the `#` reader would measure these as comment blocks: {sorted(bounded)[:5]}"


def test_the_by_kind_half_of_the_scope_reaches_the_files_the_standard_names_it_for() -> None:
    """The Scope reaches a Dockerfile, a workflow and a manifest that sit under no tree it names."""
    trees = tuple(_folder(entry) + "/" for entry in _scoped_by_the_standard())
    # What the Scope line says the by-kind half exists to reach.
    by_kind = ("fl_backend/Dockerfile", ".github/workflows/verify.yml", "fl_backend/pyproject.toml")
    bounded = _bounded_by_the_gate(by_kind)
    for rel in by_kind:
        assert not rel.startswith(trees), f"{rel} is inside a named tree, so it proves nothing about the by-kind half"
        assert rel in bounded, f"the Scope line reaches {rel} by kind and no comment check opens it"


def test_a_file_of_an_unread_kind_outside_every_named_tree_is_not_bounded() -> None:
    """The sweep above samples the named trees alone, so a tree `_bounded` gains is caught here or nowhere."""
    trees = tuple(_folder(entry) + "/" for entry in _scoped_by_the_standard())
    unread = (*_scanned_suffixes(), ".md")
    names = _declared(KERNEL, "OPS_FILENAMES")
    outside = [rel for rel in _tracked() if not rel.startswith(trees) and not rel.endswith(unread) and rel.rsplit("/", 1)[-1] not in names]
    assert outside, f"every tracked file of an unread kind sits under {trees}, so this proves nothing"
    bounded = _bounded_by_the_gate(outside)
    assert not bounded, f"the gate bounds these by the tree they sit in rather than by their kind: {sorted(bounded)[:5]}"
