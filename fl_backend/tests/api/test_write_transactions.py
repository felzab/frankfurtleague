"""
API · the static sweep behind `docs/backend/spec.md :: I52`

The source under `app/` is read as text, never imported: every function's write-helper call sites
are recorded, and an endpoint's count is the transitive sum over its callees without descending
into a callback handed to `with_transaction`. `app/core/crud.py` is the chokepoint the helpers
live in, and `app/core/recording.py` is the log's companion insert -- the pairing gap
`docs/backend/spec.md` section 4 names -- so neither module is swept.

What the sweep proves is exactly that no endpoint composes a second write outside a transaction.
Whether a write inside a callback carries `session=` is beyond a lexical read, and stays with the
comment at each read and the isolation suite.
"""

import ast
from dataclasses import dataclass, field
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[2] / "app"

# The crud helpers AND the driver methods they wrap, so a later write taken straight to the driver
# is counted the same as one through the chokepoint.
WRITE_HELPERS = frozenset(
    {
        "patch_one_in_db",
        "patch_many_in_db",
        "post_one_to_db",
        "post_many_to_db",
        "delete_many_from_db",
        "erase_many_from_db",
        "set_inactive_since",
        "insert_live",
    }
)
DRIVER_WRITE_METHODS = frozenset(
    {
        "insert_one",
        "insert_many",
        "update_one",
        "update_many",
        "replace_one",
        "delete_one",
        "delete_many",
        "find_one_and_update",
        "find_one_and_replace",
        "find_one_and_delete",
        "bulk_write",
    }
)
UNSWEPT_MODULES = frozenset({"app/core/crud.py", "app/core/recording.py"})
HTTP_METHODS = frozenset({"get", "post", "patch", "put", "delete"})


@dataclass
class _FunctionRecord:
    name: str
    module: str
    # (callable name, line) lexically in this function's own body -- a nested def keeps its own.
    write_sites: list[tuple[str, int]] = field(default_factory=list)
    callees: set[str] = field(default_factory=set)
    transaction_callbacks: set[str] = field(default_factory=set)
    opens_transaction: bool = False
    is_endpoint: bool = False


def _call_name(node: ast.Call) -> str | None:
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        return node.func.attr
    return None


def _is_route_decorator(node: ast.expr) -> bool:
    """`@<name>.<http method>(...)` -- any name, so `app/main.py`'s `@app.get` root counts alongside the routers."""
    if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
        return False
    return node.func.attr in HTTP_METHODS and isinstance(node.func.value, ast.Name)


class _ModuleCollector(ast.NodeVisitor):
    """One record per function def; a write inside a nested def lands on the nested record."""

    def __init__(self, module: str, records: dict[str, list[_FunctionRecord]]) -> None:
        self.module = module
        self.records = records
        self.stack: list[_FunctionRecord] = []

    def _enter(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        record = _FunctionRecord(name=node.name, module=self.module)
        record.is_endpoint = any(_is_route_decorator(decorator) for decorator in node.decorator_list)
        self.records.setdefault(node.name, []).append(record)
        self.stack.append(record)
        for child in node.body:
            self.visit(child)
        self.stack.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._enter(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._enter(node)

    def visit_Call(self, node: ast.Call) -> None:
        name = _call_name(node)
        if self.stack and name is not None:
            record = self.stack[-1]
            if name == "with_transaction":
                # The callback is an argument, not a call: its writes are the transaction's.
                record.opens_transaction = True
                record.transaction_callbacks.update(argument.id for argument in node.args if isinstance(argument, ast.Name))
            elif name in WRITE_HELPERS or name in DRIVER_WRITE_METHODS:
                record.write_sites.append((name, node.lineno))
            else:
                record.callees.add(name)
        self.generic_visit(node)


def _collect() -> dict[str, list[_FunctionRecord]]:
    records: dict[str, list[_FunctionRecord]] = {}
    for source in sorted(APP_ROOT.rglob("*.py")):
        module = source.relative_to(APP_ROOT.parent).as_posix()
        if module in UNSWEPT_MODULES:
            continue
        _ModuleCollector(module, records).visit(ast.parse(source.read_text(encoding="utf-8")))
    return records


FUNCTIONS = _collect()
ENDPOINTS = [record for named in FUNCTIONS.values() for record in named if record.is_endpoint]
ENDPOINT_IDS = [f"{record.module}::{record.name}" for record in ENDPOINTS]


def _resolve(name: str, caller: _FunctionRecord) -> list[_FunctionRecord]:
    """Bare-name resolution, the caller's own module first so a name two slices share stays local."""
    named = FUNCTIONS.get(name, [])
    local = [record for record in named if record.module == caller.module]
    return local or named


def _bare_write_sites(record: _FunctionRecord, seen: set[int]) -> list[tuple[str, str, int]]:
    """Every write site reachable from `record` without passing through a `with_transaction` callback."""
    if id(record) in seen:
        return []
    seen.add(id(record))
    sites = [(record.module, name, line) for name, line in record.write_sites]
    for callee in sorted(record.callees - record.transaction_callbacks):
        for target in _resolve(callee, record):
            sites.extend(_bare_write_sites(target, seen))
    return sites


def _opens_transaction(record: _FunctionRecord, seen: set[int]) -> bool:
    """Whether `record` reaches a `with_transaction` call, along the same edges the site walk takes."""
    if id(record) in seen:
        return False
    seen.add(id(record))
    if record.opens_transaction:
        return True
    return any(
        _opens_transaction(target, seen)
        for callee in sorted(record.callees - record.transaction_callbacks)
        for target in _resolve(callee, record)
    )


# Three ways the sweep could go blind, each asserted PRESENT so a silent regression of the detector
# fails here rather than passing over an empty or writeless parameter set.
assert ENDPOINTS, "no route-decorated function found under app/ -- the endpoint detector, not the routers, is the likely cause"
assert any(len(_bare_write_sites(record, set())) == 1 for record in ENDPOINTS), (
    "no endpoint reaches a single bare write -- the write detector, not the handlers, is the likely cause"
)
_ERASURE_CALLBACK = next(
    record for record in FUNCTIONS.get("erase_the_person_and_their_record", []) if record.module.startswith("app/api/spieler/")
)
assert len(_bare_write_sites(_ERASURE_CALLBACK, set())) >= 2, (
    "the erasure's transaction callback no longer counts as multi-write -- the transitive counter, not the erasure, is the likely cause"
)


@pytest.mark.parametrize("record", ENDPOINTS, ids=ENDPOINT_IDS)
def test_an_endpoint_makes_at_most_one_write_outside_a_transaction(record: _FunctionRecord):
    """`docs/backend/spec.md :: I52` -- a write outside `with_transaction` is one a failure strands."""
    sites = _bare_write_sites(record, set())
    # An endpoint that opens a transaction gets NO bare write beside it: a write outside the
    # callback is exactly the stranded half the transaction was opened to rule out.
    allowed = 0 if _opens_transaction(record, set()) else 1
    assert len(sites) <= allowed, (
        f"{record.module}::{record.name} reaches {len(sites)} write sites outside a with_transaction callback: {sites} "
        "-- a request making more than one write makes them in one transaction (docs/backend/spec.md :: I52)"
    )
