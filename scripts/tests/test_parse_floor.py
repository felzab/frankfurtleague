"""SCRIPTS · the parse floor, asserted rather than commented

`checker_kernel.py :: PARSE_FLOOR` is the oldest interpreter that REACHES a checker, and a runtime
guard cannot print from a file that interpreter will not compile. A comment is not a guard
(ADR-0066), so every module a checker can import is parsed at the floor here.

Invariants:
- Stdlib only, for the reason `test_check_docs.py` gives.
- `PARSE_FLOOR` is read out of the source, never imported: this asserts about a file it must not
  first execute.
- `feature_version` is best-effort, so a clean run is evidence rather than proof.

See:
- scripts/checker_kernel.py — the floor, and the guard that reads it
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Final

SCRIPTS: Final = Path(__file__).resolve().parent.parent


def _floor() -> tuple[int, int]:
    """PARSE_FLOOR as the kernel's source declares it."""
    source = (SCRIPTS / "checker_kernel.py").read_text(encoding="utf-8")
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.AnnAssign) and node.value is not None and getattr(node.target, "id", "") == "PARSE_FLOOR":
            major, minor = ast.literal_eval(node.value)
            return (major, minor)
    raise AssertionError("checker_kernel.py no longer declares PARSE_FLOOR")


def test_every_module_a_checker_imports_parses_at_the_parse_floor() -> None:
    """Newer syntax anywhere on an import path exits 1 -- a finding's code -- before the guard runs."""
    floor = _floor()
    wrong: list[str] = []
    for path in sorted(SCRIPTS.rglob("*.py")):
        if "tests" in path.parts or "__pycache__" in path.parts:
            continue
        try:
            ast.parse(path.read_text(encoding="utf-8"), feature_version=floor)
        except SyntaxError as exc:
            wrong.append(f"{path.relative_to(SCRIPTS).as_posix()}: line {exc.lineno}: {exc.msg}")
    assert not wrong, "syntax newer than the parse floor:\n" + "\n".join(wrong)
