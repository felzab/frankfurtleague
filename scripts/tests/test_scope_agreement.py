"""SCRIPTS · the gate's scope register, held to the rule text it enforces.

`scripts/checks/docs_gate/branch.py :: INCODE_SCOPES` spells the subtrees the In-code Scope names,
and is what this file sweeps for a file whose kind the gate does not read. The two listings are
reached by different routes and required to agree (PRE-4), so narrowing either breaks the agreement.
"""

from __future__ import annotations

import ast
import re
from collections.abc import Callable
from pathlib import Path
from typing import Final

REPO_ROOT: Final = Path(__file__).resolve().parents[2]
SCRIPTS: Final = REPO_ROOT / "scripts"
STANDARD: Final = REPO_ROOT / "docs" / "standard.md"

# The section whose scope line this is, and the label opening it. Both are `docs/standard.md`'s own
# spelling; a rename leaves the reader finding nothing, which fails rather than passing empty.
IN_CODE_HEADING: Final = "## In-code"
SCOPE_LABEL: Final = "Scope:"
# The kernel holding the suffix registers, and the gate function that reads one of them.
KERNEL: Final = "checks/docs_gate/kernel.py"
BRANCH: Final = "checks/docs_gate/branch.py"
BOUNDED: Final = "_bounded"
TREES: Final = "INCODE_SCOPES"
BACKTICKED: Final = re.compile(r"`([^`\n]+)`")
# A working tree carries these inside the scanned trees and the index carries none of them, so a
# walk that kept them would fail on whatever the last build or test run left behind.
UNTRACKED_DIRS: Final = frozenset({"__pycache__", "node_modules", ".venv", ".next", ".pytest_cache", ".ruff_cache"})


def _declared(module: str, name: str) -> tuple[str, ...]:
    """One module-level tuple of strings, read out of the source rather than imported.

    Never imported: `test_check_docs.py` drives a COPY of this package under the same name, and a
    module cached here would decide which of the two either file measures.
    """
    source = (SCRIPTS / module).read_text(encoding="utf-8")
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.AnnAssign) and node.value is not None and getattr(node.target, "id", "") == name:
            value = ast.literal_eval(node.value)
            return tuple(str(entry) for entry in value)
    raise AssertionError(f"{module} no longer declares {name}")


def _scoped_by_the_standard() -> tuple[str, ...]:
    """The subtrees the In-code section names, as its scope line spells them."""
    lines = STANDARD.read_text(encoding="utf-8").split("\n")
    at = next((index for index, line in enumerate(lines) if line.strip() == IN_CODE_HEADING), None)
    assert at is not None, f"docs/standard.md no longer carries a {IN_CODE_HEADING!r} heading"
    opening = next((index for index in range(at + 1, at + 8) if lines[index].startswith(SCOPE_LABEL)), None)
    assert opening is not None, f"the In-code section no longer opens on a {SCOPE_LABEL!r} line"
    # The Scope line runs past its first physical line, so the blank line below it is what ends it.
    end = next((index for index in range(opening, len(lines)) if not lines[index].strip()), len(lines))
    tokens = BACKTICKED.findall("\n".join(lines[opening:end]))
    # A citation beside the trees names the by-kind registers, which is the Scope's other half
    # rather than a tree in it.
    return tuple(token for token in tokens if "::" not in token)


def _folder(token: str) -> str:
    return token.rstrip("/")


def _register(name: str) -> tuple[str, ...]:
    """One suffix register by the name `_bounded` calls it. `SCANNED_SUFFIXES` is a sum, not a literal."""
    if name == "SCANNED_SUFFIXES":
        return _declared(KERNEL, "SOURCE_SUFFIXES") + _declared(KERNEL, "OPS_SUFFIXES")
    return _declared(KERNEL, name)


def _bounded_of() -> Callable[[str], bool]:
    """`branch.py :: _bounded`, rebuilt whole from the registers that function itself reads."""
    # Rebuilt rather than imported, for `_declared`'s reason.
    source = (SCRIPTS / BRANCH).read_text(encoding="utf-8")
    gate = next((n for n in ast.walk(ast.parse(source)) if isinstance(n, ast.FunctionDef) and n.name == BOUNDED), None)
    assert gate is not None, f"branch.py no longer declares {BOUNDED}"
    # Read out of `_bounded`'s own source rather than named here: the two halves of the scope are
    # one decision, and a test spelling the suffixes itself would stay green while `_bounded`
    # narrowed to a shorter list.
    used = {node.id for node in ast.walk(gate) if isinstance(node, ast.Name)}
    # Rejected rather than rebuilt: a tree test admits every kind inside the tree, and it would
    # leave this rebuild half the function while reading like the whole of it.
    assert TREES not in used, f"{BOUNDED} selects by tree, which bounds a stylesheet under one"
    registers = sorted(used & {"SOURCE_SUFFIXES", "OPS_SUFFIXES", "SCANNED_SUFFIXES"})
    assert len(registers) == 1, f"{BOUNDED} reads {registers}, where this test can rebuild exactly one"
    suffixes = _register(registers[0])
    names = _declared(KERNEL, "OPS_FILENAMES") if "OPS_FILENAMES" in used else ()
    return lambda rel: rel.endswith(suffixes) or rel.rsplit("/", 1)[-1] in names


def test_the_comment_scopes_the_gate_checks_are_the_ones_the_standard_names() -> None:
    """The register and the Scope line drift apart silently, and every case in the corpus still passes."""
    checked = _declared(BRANCH, "INCODE_SCOPES")
    named = _scoped_by_the_standard()
    assert checked, "INCODE_SCOPES is empty, so every comment check iterates nothing and passes"
    assert named, "the standard's scope line names nothing"
    assert {_folder(entry) for entry in checked} == {_folder(entry) for entry in named}


def test_every_scope_the_gate_checks_is_a_path_this_repository_holds() -> None:
    """A register naming a path nobody has reaches no file, which reads exactly like a clean sweep."""
    missing = [entry for entry in _declared(BRANCH, "INCODE_SCOPES") if not (REPO_ROOT / entry).exists()]
    assert not missing, f"no such path: {missing}"


def test_a_file_of_an_unread_kind_inside_a_named_tree_is_not_bounded() -> None:
    """A tree is in scope for the kinds the gate reads, and a stylesheet in one is not among them."""
    reads = _bounded_of()
    suffixes = _register("SCANNED_SUFFIXES")
    names = _declared(KERNEL, "OPS_FILENAMES")
    unread = [
        rel
        for tree in _declared(BRANCH, TREES)
        for path in (REPO_ROOT / tree).rglob("*")
        if path.is_file()
        and UNTRACKED_DIRS.isdisjoint(path.parts)
        and not (rel := path.relative_to(REPO_ROOT).as_posix()).endswith((*suffixes, ".md"))
        and path.name not in names
    ]
    # Without one the sweep asserts nothing, and the tree half went unwatched for exactly that reason.
    assert unread, f"no file of an unread kind sits under {_declared(BRANCH, TREES)}, so this proves nothing"
    bounded = [rel for rel in unread if reads(rel)]
    assert not bounded, f"the `#` reader would measure these as comment blocks: {sorted(bounded)[:5]}"


def test_the_by_kind_half_of_the_scope_reaches_the_files_the_standard_names_it_for() -> None:
    """The Scope reaches a Dockerfile, a workflow and a manifest that sit under no tree it names."""
    reads = _bounded_of()
    trees = _declared(BRANCH, "INCODE_SCOPES")
    # What the Scope line says the by-kind half exists to reach.
    by_kind = ("fl_backend/Dockerfile", ".github/workflows/verify.yml", "fl_backend/pyproject.toml")
    for rel in by_kind:
        assert not rel.startswith(trees), f"{rel} is inside a named tree, so it proves nothing about the by-kind half"
        assert reads(rel), f"the Scope line reaches {rel} by kind and no comment check opens it"
