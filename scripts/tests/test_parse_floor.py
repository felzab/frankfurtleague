from __future__ import annotations

import ast
from pathlib import Path
from typing import Final

SCRIPTS: Final = Path(__file__).resolve().parent.parent

# Below it the walk has stopped finding the modules rather than the modules having gone: a moved
# folder or a tightened filter leaves this reporting success over an empty collection.
MODULE_FLOOR: Final = 10


def _floor() -> tuple[int, int]:
    """PARSE_FLOOR as the kernel's source declares it.

    Read out of the source, never imported: this asserts about a file it must not first execute.
    """
    source = (SCRIPTS / "checker_kernel.py").read_text(encoding="utf-8")
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.AnnAssign) and node.value is not None and getattr(node.target, "id", "") == "PARSE_FLOOR":
            major, minor = ast.literal_eval(node.value)
            return (major, minor)
    raise AssertionError("checker_kernel.py no longer declares PARSE_FLOOR")


def test_every_module_a_checker_imports_parses_at_the_parse_floor() -> None:
    """Newer syntax anywhere on an import path exits 1 -- a finding's code -- before the guard runs.

    `feature_version` is best-effort, so a clean run is evidence rather than proof.
    """
    floor = _floor()
    wrong: list[str] = []
    read = 0
    for path in sorted(SCRIPTS.rglob("*.py")):
        if "tests" in path.parts or "__pycache__" in path.parts:
            continue
        read += 1
        try:
            ast.parse(path.read_text(encoding="utf-8"), feature_version=floor)
        except SyntaxError as exc:
            wrong.append(f"{path.relative_to(SCRIPTS).as_posix()}: line {exc.lineno}: {exc.msg}")
    assert read >= MODULE_FLOOR, f"the walk reached {read} modules, below the floor of {MODULE_FLOOR}"
    assert not wrong, "syntax newer than the parse floor:\n" + "\n".join(wrong)
