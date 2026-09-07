"""SCRIPTS · the In-code Scope, held to the gate that reads it.

`docs/_standard/standard.md`'s Scope line names the trees and
`scripts/checks/docs_gate/kernel.py`'s suffix registers name the kinds; this file sweeps the first
for a file whose kind the second leaves unread. What the sweep catches is a tree the Scope names and
this repository does not hold, a Dockerfile, workflow or manifest the Scope reaches by kind while
`scripts/checks/docs_gate/branch.py :: _bounded` does not, and one of those three drifting inside a
named tree. Narrowing `_bounded` itself is `scripts/tests/test_scope_agreement.py :: _bounded_of`'s,
which admits the two registers named here and refuses every other module-level name that function
reads, a tree register under any spelling among them.
"""

from __future__ import annotations

import ast
import re
from collections.abc import Callable
from pathlib import Path
from typing import Final

from conftest import declared

REPO_ROOT: Final = Path(__file__).resolve().parents[2]
SCRIPTS: Final = REPO_ROOT / "scripts"
STANDARD: Final = REPO_ROOT / "docs" / "_standard" / "standard.md"

# The section whose scope line this is, and the label opening it. Both are `docs/_standard/standard.md`'s own
# spelling; a rename leaves the reader finding nothing, which fails rather than passing empty.
IN_CODE_HEADING: Final = "## In-code"
SCOPE_LABEL: Final = "Scope:"
# The kernel holding the suffix registers, and the gate function that reads them.
KERNEL: Final = "checks/docs_gate/kernel.py"
BRANCH: Final = "checks/docs_gate/branch.py"
BOUNDED: Final = "_bounded"
# The two registers `_bounded` may read, and the tree register a plant gives it beside them, spelled
# as nothing here bans by name: that spelling is what a guard reading one name would let through.
REGISTERS: Final[frozenset[str]] = frozenset({"SCANNED_SUFFIXES", "OPS_FILENAMES"})
TREES: Final = "SCOPED_TREES"
_A_THIRD_REGISTER: Final = "\n".join(
    (
        "def " + BOUNDED + "(rel):",
        "    return rel.endswith(SCANNED_SUFFIXES) or rel in OPS_FILENAMES or rel.startswith(" + TREES + ")",
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


def _module_names(function: ast.FunctionDef) -> frozenset[str]:
    """The module-level names one function's BODY reads, its parameters and its own bindings dropped.

    The signature is walked past because an annotation on it names a type rather than a register.
    """
    body = [node for statement in function.body for node in ast.walk(statement)]
    own = {argument.arg for argument in function.args.args}
    own |= {node.id for node in body if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store)}
    return frozenset(node.id for node in body if isinstance(node, ast.Name)) - own


def _bounded_of(source: str | None = None) -> Callable[[str], bool]:
    """`branch.py :: _bounded`, rebuilt whole from the registers that function itself reads.

    `source` is the plant the refusal below is driven with; the real module answers without it.
    """
    # Rebuilt rather than imported, for `_declared`'s reason.
    body = (SCRIPTS / BRANCH).read_text(encoding="utf-8") if source is None else source
    gate = next((n for n in ast.walk(ast.parse(body)) if isinstance(n, ast.FunctionDef) and n.name == BOUNDED), None)
    assert gate is not None, f"branch.py no longer declares {BOUNDED}"
    # Positive, and never a ban on the tree register's name: a selection by tree admits every kind
    # inside the tree, and one spelled anything else passes a ban while this rebuild goes on reading
    # like the whole function.
    read = _module_names(gate)
    assert read == REGISTERS, f"{BOUNDED} reads {sorted(read)}, where this test can rebuild {sorted(REGISTERS)} alone"
    suffixes = _scanned_suffixes()
    names = _declared(KERNEL, "OPS_FILENAMES")
    return lambda rel: rel.endswith(suffixes) or rel.rsplit("/", 1)[-1] in names


def test_every_tree_the_standard_names_is_a_path_this_repository_holds() -> None:
    """A Scope line naming a path nobody has reaches no file, which reads exactly like a clean sweep."""
    named = _scoped_by_the_standard()
    assert named, "the standard's scope line names nothing"
    missing = [entry for entry in named if not (REPO_ROOT / entry).exists()]
    assert not missing, f"no such path: {missing}"


def test_a_file_of_an_unread_kind_inside_a_named_tree_is_not_bounded() -> None:
    """A tree is in scope for the kinds the gate reads, and a stylesheet in one is not among them."""
    reads = _bounded_of()
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
    bounded = [rel for rel in unread if reads(rel)]
    assert not bounded, f"the `#` reader would measure these as comment blocks: {sorted(bounded)[:5]}"


def test_a_gate_reading_a_register_beside_the_two_is_refused() -> None:
    """A tree register is what this refuses, and a ban on one name lets one through under any other."""
    try:
        _bounded_of(_A_THIRD_REGISTER)
    except AssertionError as refusal:
        assert TREES in str(refusal), f"the refusal named none of what it caught: {refusal}"
    else:
        raise AssertionError(f"{BOUNDED} reading {TREES} beside the two was rebuilt rather than refused")


def test_the_by_kind_half_of_the_scope_reaches_the_files_the_standard_names_it_for() -> None:
    """The Scope reaches a Dockerfile, a workflow and a manifest that sit under no tree it names."""
    reads = _bounded_of()
    trees = tuple(_folder(entry) + "/" for entry in _scoped_by_the_standard())
    # What the Scope line says the by-kind half exists to reach.
    by_kind = ("fl_backend/Dockerfile", ".github/workflows/verify.yml", "fl_backend/pyproject.toml")
    for rel in by_kind:
        assert not rel.startswith(trees), f"{rel} is inside a named tree, so it proves nothing about the by-kind half"
        assert reads(rel), f"the Scope line reaches {rel} by kind and no comment check opens it"
