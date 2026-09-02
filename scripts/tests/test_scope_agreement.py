"""SCRIPTS · the gate's scope register, held to the rule text it enforces.

`scripts/checks/docs_gate/branch.py :: INCODE_SCOPES` decides which subtrees the comment rules are checked
in, and a subtree dropped from it stops being checked in silence. The two listings are reached by
different routes and required to agree (PRE-4), so narrowing either breaks the agreement.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Final

REPO_ROOT: Final = Path(__file__).resolve().parents[2]
SCRIPTS: Final = REPO_ROOT / "scripts"
STANDARD: Final = REPO_ROOT / "docs" / "standard.md"

# The section whose scope line this is, and the label opening it. Both are `docs/standard.md`'s own
# spelling; a rename leaves the reader finding nothing, which fails rather than passing empty.
IN_CODE_HEADING: Final = "## In-code"
SCOPE_LABEL: Final = "Scope:"
BACKTICKED: Final = re.compile(r"`([^`\n]+)`")


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
    for line in lines[at + 1 : at + 8]:
        if line.startswith(SCOPE_LABEL):
            return tuple(BACKTICKED.findall(line))
    raise AssertionError(f"the In-code section no longer opens on a {SCOPE_LABEL!r} line")


def _folder(token: str) -> str:
    return token.rstrip("/")


def test_the_comment_scopes_the_gate_checks_are_the_ones_the_standard_names() -> None:
    """A subtree dropped from the register stops being checked, and every case in the corpus still passes."""
    checked = _declared("checks/docs_gate/branch.py", "INCODE_SCOPES")
    named = _scoped_by_the_standard()
    assert checked, "INCODE_SCOPES is empty, so every comment check iterates nothing and passes"
    assert named, "the standard's scope line names nothing"
    assert {_folder(entry) for entry in checked} == {_folder(entry) for entry in named}


def test_every_scope_the_gate_checks_is_a_folder_this_repository_holds() -> None:
    """A register naming a folder nobody has reaches no file, which reads exactly like a clean sweep."""
    missing = [entry for entry in _declared("checks/docs_gate/branch.py", "INCODE_SCOPES") if not (REPO_ROOT / entry).is_dir()]
    assert not missing, f"no such folder: {missing}"
