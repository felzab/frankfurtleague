"""
CORE · every database client built on the application's options (`app/core/db.py :: new_client`)

A client built on other options serves the same documents differently, a stored UUID as `Binary` where the app reads
`uuid.UUID`, with nothing failing. Ruff's banned-api rule bans a name rather than a call, and the client's name types
every handler that takes one, so only this walk holds the constructions.
"""

import ast
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]
SOURCES = (BACKEND_ROOT / "app", BACKEND_ROOT / "tests")
THE_ONE = BACKEND_ROOT / "app" / "core" / "db.py"
CLIENTS = frozenset({"AsyncMongoClient", "MongoClient"})

# The one client the walk admits beside `new_client`, by where it stands: the replica set's initiation, a synchronous
# client of a server the run has just started, which reads no document and serves none to the app.
INITIATES_THE_REPLICA_SET = ("tests/conftest.py", "_elected")


def _callee(call: ast.Call) -> str | None:
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return None


def _constructions(path: Path) -> list[tuple[str | None, ast.Call]]:
    """Each client constructed in `path`, beside the function it stands in."""

    found: list[tuple[str | None, ast.Call]] = []

    def visit(node: ast.AST, function: str | None) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.Call) and _callee(child) in CLIENTS:
                found.append((function, child))
            visit(child, child.name if isinstance(child, ast.FunctionDef | ast.AsyncFunctionDef) else function)

    visit(ast.parse(path.read_bytes(), filename=str(path)), None)
    return found


def test_every_client_is_built_through_new_client():
    constructions = [
        (path.relative_to(BACKEND_ROOT).as_posix(), function, call)
        for source in SOURCES
        for path in sorted(source.rglob("*.py"))
        for function, call in _constructions(path)
    ]
    the_one = (THE_ONE.relative_to(BACKEND_ROOT).as_posix(), "new_client")
    elsewhere = [
        f"{path}:{call.lineno}: {ast.unparse(call)}"
        for path, function, call in constructions
        if (path, function) not in {the_one, INITIATES_THE_REPLICA_SET}
    ]

    # The one in `new_client` first, so a walk reading nothing cannot pass.
    assert [(path, function) for path, function, _ in constructions if (path, function) == the_one] == [the_one], constructions
    assert elsewhere == [], "a client built outside `new_client`:\n" + "\n".join(elsewhere)
