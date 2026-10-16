"""
API · the static sweep behind `docs/backend/spec.md :: I52`

The source under `app/` is read as syntax, never run: every function's write-helper call sites
are recorded, and an endpoint's count is the transitive sum over its callees without descending
into a callback handed to `with_transaction`. `app/core/crud.py` is the chokepoint the helpers
live in, `app/core/recording.py` is the log's companion insert -- the pairing gap
`docs/backend/spec.md` section 4 names -- and `app/core/drosselung.py` counts a person's write
outside its transaction by design (`docs/backend/spec.md :: I617`), so none of the three is swept.

What the sweep proves is exactly that no endpoint composes a second write outside a transaction.
It follows a call only where `tests/core/app_source.py :: resolve_callee` resolves it, so a writer
held as a value and called under another name is
`fl_backend/tests/core/test_duplicate_key_publication.py :: test_no_writer_is_held_as_a_value`'s to refuse.
Whether a write inside a callback carries `session=` is
`fl_backend/tests/core/test_write_shapes.py :: TestEveryWriteInsideATransactionCarriesIt`'s.
"""

import ast
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from tests.core.app_source import (
    DRIVER_WRITES,
    REMOVAL_HELPERS,
    TRANSACTION_RUNNER,
    WRITE_HELPERS,
    Declaration,
    callee,
    handed_callbacks,
    parsed,
    resolve_callee,
    scoped_calls,
)

APP_ROOT = Path(__file__).resolve().parents[2] / "app"

# The crud helpers, their removals included, AND the driver methods they wrap, so a later write
# taken straight to the driver is counted the same as one through the chokepoint.
WRITE_SITES = WRITE_HELPERS | REMOVAL_HELPERS | DRIVER_WRITES
UNSWEPT_MODULES = frozenset({"app/core/crud.py", "app/core/recording.py", "app/core/drosselung.py"})
HTTP_METHODS = frozenset({"get", "post", "patch", "put", "delete"})


@dataclass
class _FunctionRecord:
    name: str
    module: str
    is_endpoint: bool
    # The callbacks it hands to a transaction, by the one finder every sweep shares
    # (`tests/core/app_source.py :: handed_callbacks`): their writes are the transaction's.
    transaction_callbacks: frozenset[int]
    # (callable name, line) lexically in this function's own body -- a nested def keeps its own.
    write_sites: list[tuple[str, int]] = field(default_factory=list)
    # Each declaration its own body calls, as `resolve_callee` resolves the call: lexically and through the
    # imports, never by a bare name, which took `str.split` for `app/core/transactions.py :: split`.
    callees: list[int] = field(default_factory=list)
    opens_transaction: bool = False


def _is_route_decorator(node: ast.expr) -> bool:
    """`@<name>.<http method>(...)` -- any name, so `app/main.py`'s `@app.get` root counts alongside the routers."""
    if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
        return False
    return node.func.attr in HTTP_METHODS and isinstance(node.func.value, ast.Name)


def _record(node: Declaration, module: str, handed: dict[int, set[int]]) -> _FunctionRecord:
    return _FunctionRecord(
        name=node.name,
        module=module,
        is_endpoint=any(_is_route_decorator(decorator) for decorator in node.decorator_list),
        transaction_callbacks=frozenset(handed.get(id(node), set())),
    )


def _collect() -> dict[int, _FunctionRecord]:
    """One record per function def, keyed by its node; a write inside a nested def lands on the nested record."""

    handed: dict[int, set[int]] = {}
    for holder, callback in handed_callbacks():
        if holder is not None:
            handed.setdefault(id(holder), set()).add(id(callback))

    records: dict[int, _FunctionRecord] = {}
    for source in sorted(APP_ROOT.rglob("*.py")):
        module = source.relative_to(APP_ROOT.parent).as_posix()
        if module in UNSWEPT_MODULES:
            continue

        tree = parsed(source)
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                records[id(node)] = _record(node, module, handed)

        for chain, call in scoped_calls(tree, ()):
            if not chain:
                continue
            record = records[id(chain[-1])]
            name = callee(call)
            if name == TRANSACTION_RUNNER:
                record.opens_transaction = True
            elif name in WRITE_SITES:
                record.write_sites.append((name, call.lineno))
            elif (resolved := resolve_callee(call, chain, source)) is not None:
                record.callees.append(id(resolved[0]))

    return records


FUNCTIONS = _collect()
ENDPOINTS = [record for record in FUNCTIONS.values() if record.is_endpoint]
ENDPOINT_IDS = [f"{record.module}::{record.name}" for record in ENDPOINTS]


def _followed(record: _FunctionRecord) -> list[_FunctionRecord]:
    """The records its calls reach, past every callback it hands a transaction; a module this sweep leaves out has none."""

    return [FUNCTIONS[target] for target in record.callees if target not in record.transaction_callbacks and target in FUNCTIONS]


def _bare_write_sites(record: _FunctionRecord, seen: set[int]) -> list[tuple[str, str, int]]:
    """Every write site reachable from `record` without passing through a `with_transaction` callback."""
    if id(record) in seen:
        return []
    seen.add(id(record))
    sites = [(record.module, name, line) for name, line in record.write_sites]
    for target in _followed(record):
        sites.extend(_bare_write_sites(target, seen))
    return sites


def _opens_transaction(record: _FunctionRecord, seen: set[int]) -> bool:
    """Whether `record` reaches a `with_transaction` call, along the same edges the site walk takes."""
    if id(record) in seen:
        return False
    seen.add(id(record))
    if record.opens_transaction:
        return True
    return any(_opens_transaction(target, seen) for target in _followed(record))


# Three ways the sweep could go blind, each asserted PRESENT so a silent regression of the detector
# fails here rather than passing over an empty or writeless parameter set.
assert ENDPOINTS, "no route-decorated function found under app/ -- the endpoint detector, not the routers, is the likely cause"
assert any(record.write_sites for record in FUNCTIONS.values()), (
    "no function under app/ makes a write -- the write detector, not the handlers, is the likely cause"
)
# The registry writes nothing of its own: every write it makes is a step's, so it counts only as far
# as the counter follows calls.
_ERASURE_REGISTRY = next(
    record for record in FUNCTIONS.values() if record.name == "erase_everything" and record.module.startswith("app/api/identitaet/")
)
assert len(_bare_write_sites(_ERASURE_REGISTRY, set())) >= 2, (
    "the erasure registry no longer counts as multi-write -- the transitive counter, not the erasure, is the likely cause"
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
