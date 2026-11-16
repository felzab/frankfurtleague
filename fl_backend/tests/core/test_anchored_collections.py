"""
CORE · every collection an anchor writes against the record model declaring the field it advances

An anchor advances `ANCHOR_FIELD` on the documents a judgement is scoped by, and their collection's record model declares
that field by inheriting `Anchored`, or `python -m app.readback` refuses every document an anchor has written. Which
collection a call anchors is an argument only the source names, so this walks the source as `test_recording.py` does:
every call of an anchoring function and every call writing the field, its `collection` read as `db[Collection.<member>]`
or as a name or attribute spelled after the collection, as the application names each collection it hands on. A call
spelled any other way, or the field named outside such a call, fails the walk rather than passing it.
"""

import ast
from collections.abc import Iterator
from pathlib import Path

from app.core import crud
from app.core.collections import Collection
from app.core.crud import ANCHOR_FIELD, Anchored, anchor_in_db, anchor_mailboxes_in_db
from app.readback import RECORD_MODELS

CRUD = Path(crud.__file__)
SOURCE = CRUD.parents[1]

# The functions advancing the field on whatever collection their caller hands them, read at each call.
ANCHORING = frozenset({anchor_in_db.__name__, anchor_mailboxes_in_db.__name__})
FIELD = "ANCHOR_FIELD"
MEMBERS = frozenset(Collection)


def _defines(statement: ast.stmt) -> bool:
    """Whether a statement of `crud.py` is the field, its declaration or an anchoring function, which name the field for every caller."""

    match statement:
        case ast.FunctionDef(name=name) | ast.AsyncFunctionDef(name=name) | ast.ClassDef(name=name):
            return name in {*ANCHORING, Anchored.__name__}
        case ast.AnnAssign(target=ast.Name(id=name)) | ast.Assign(targets=[ast.Name(id=name)]):
            return name == FIELD
    return False


def _mentions(node: ast.AST) -> bool:
    """Whether a node names an anchoring function or the field, by its constant or as it is spelled."""

    match node:
        case ast.Name(id=name, ctx=ast.Load()) | ast.Attribute(attr=name, ctx=ast.Load()):
            return name in {*ANCHORING, FIELD}
        case ast.Constant(value=value):
            return value == ANCHOR_FIELD
    return False


def _anchors(call: ast.Call) -> bool:
    """Whether a call is an anchoring function's, or hands a `collection` an update naming the field."""

    match call.func:
        case ast.Name(id=name) | ast.Attribute(attr=name) if name in ANCHORING:
            return True
    return any(keyword.arg == "collection" for keyword in call.keywords) and any(_mentions(node) for node in ast.walk(call))


def _named(value: ast.expr | None, where: str) -> Collection:
    """The collection a call's `collection` argument names."""

    match value:
        case ast.Subscript(slice=ast.Attribute(value=ast.Name(id="Collection"), attr=member)):
            return Collection[member]
        case ast.Name(id=name) | ast.Attribute(attr=name) if name.removesuffix("_collection") in MEMBERS:
            return Collection(name.removesuffix("_collection"))
    raise AssertionError(f"{where} anchors a collection this walk cannot name")


def _anchored() -> Iterator[tuple[str, Collection]]:
    """Each anchoring call of the application, where it stands, with the collection it anchors."""

    for path in sorted(SOURCE.rglob("*.py")):
        module = path.relative_to(SOURCE).as_posix()
        nodes = [
            node
            for statement in ast.parse(path.read_bytes()).body
            if not (path == CRUD and _defines(statement))
            for node in ast.walk(statement)
        ]
        calls = [node for node in nodes if isinstance(node, ast.Call) and _anchors(node)]
        reached = {id(node) for call in calls for node in ast.walk(call)}
        for node in nodes:
            if _mentions(node) and id(node) not in reached:
                raise AssertionError(f"{module}:{getattr(node, 'lineno', '?')} names the anchor outside a call this walk reads")
        for call in calls:
            where = f"{module}:{call.lineno}"
            yield where, _named(next((keyword.value for keyword in call.keywords if keyword.arg == "collection"), None), where)


def test_every_collection_an_anchor_writes_has_a_record_model_declaring_the_field():
    anchored = list(_anchored())

    assert anchored, "the walk found no anchor"
    assert [f"{where}: {collection}" for where, collection in anchored if not issubclass(RECORD_MODELS[collection], Anchored)] == []
