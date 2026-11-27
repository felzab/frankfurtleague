"""
CORE · a gate carries no box's code and stands at no box

A box's fault reaches the body only through `refuse_faults`, which pyright and ruff hold to its shape. A field check
written in a gate's shape instead, an `APIError` carrying a `FieldCode` member or handed a body-located `Subject`,
passes both and marks no box, so the person reads the stale-page line where the box's phrase belongs. Only this walk
sees that shape: it reads every `APIError(...)` and `Subject(...)` the application builds, by the names its modules
import them under.
"""

import ast
from collections.abc import Iterator
from pathlib import Path
from typing import get_args

from app.core import exceptions
from app.core.codes import FieldCode

SOURCE = Path(exceptions.__file__).parents[1]
FIELD_CODES = frozenset(member.name for member in get_args(FieldCode.__value__))

# (module, function, what it builds) for each site that builds a gate the walk would refuse, beside why it stands and
# what would end it. An entry whose reason no longer holds is a box's check to move onto `refuse_faults`, then remove.
ALLOWED: dict[tuple[str, str, str], str] = {
    ("api/address_change/crud.py", "refusal_of", "address_change_taken"): (
        "The link's press judges the address the stored change names, which no box on its page holds; holds while the "
        "press in `address_change/public_router.py` is its one caller."
    ),
    ("api/address_change/services.py", "find_taken_refusal", "address_change_taken"): (
        "Asked by the administrator's start, whose new address is typed into a box, and by the re-send, which reads it "
        "off the stored change; holds until the start asks it as a fault on its box."
    ),
    ("api/address_change/services.py", "find_unchanged_refusal", "address_change_unchanged"): (
        "Both starts, the administrator's and the person's own in Konto, judge an address typed into a box; holds until "
        "they ask it as a fault on that box."
    ),
    ("api/ban_list/services.py", "find_admin_refusal", "ban_list_admin"): (
        "The ban's add judges the address typed into its box; holds until the add asks it as a fault on that box."
    ),
    ("api/ban_list/services.py", "find_listed_refusal", "duplicate_key"): (
        "The ban's add judges the address typed into its box; holds until the add asks it as a fault on that box."
    ),
    ("api/grants/services.py", "find_barred_refusal", "grant_barred"): (
        "The grant's add judges the address typed into its box, and a write on a stored grant the address that grant "
        "names; holds until the add asks it as a fault on its box."
    ),
    ("api/identity/services.py", "find_admin_address_refusal", "admin_address"): (
        "`refuse_an_address_off_limits` asks it of every address an administrator's identity or address-change route acts "
        "on, typed into a box or named by a stored record; holds until each typed one is asked as a fault on its box."
    ),
    ("api/identity/services.py", "find_own_address_refusal", "own_address"): (
        "`refuse_an_address_off_limits` asks it of every address an administrator's identity or address-change route acts "
        "on, typed into a box or named by a stored record; holds until each typed one is asked as a fault on its box."
    ),
    ("api/spielberichte/services.py", "find_not_in_kader_refusal", "spieler_not_in_kader"): (
        "The referee's form picks pupils from the squads it is served, so it takes this as a page gone stale whose "
        "reload serves the squads as they stand; holds while that form offers no pupil outside them."
    ),
    ("api/spielbestaetigungen/services.py", "as_judged_on_the_stored_proposal", "a body-located subject"): (
        "The adoption saves the stored proposal and sends no body, so it answers the save's first fault as a gate whose "
        "subject keeps that fault's path and bounds for the status line's sentence; holds while the adoption rebuilds them."
    ),
    ("api/spielbestaetigungen/services.py", "as_judged_on_the_stored_proposal", "the code first.code"): (
        "The same rebuild, its code the save's first fault's; holds while the adoption rebuilds them."
    ),
    ("api/spielbestaetigungen/services.py", "as_judged_on_the_stored_proposal", "the code refusal.error_code"): (
        "The same rebuild of a gate the save raised, its code and subject the gate's own; holds while the adoption rebuilds them."
    ),
    ("api/spielbestaetigungen/services.py", "judged_as_a_proposal", "the code faults[0].code"): (
        "A club's proposal is judged by the save's checks of a fixture body it does not send, so their faults answer as "
        "one gate naming no field; holds while `spielbestaetigungen/person_router.py` judges a proposal through it."
    ),
    ("core/exceptions.py", "as_judged_on_stored_state", "the code faults[0].code"): (
        "A write judging stored values it carries no body for answers their faults as one gate naming no field; holds "
        "while the draw judges the stored rules through it."
    ),
}


def _imported(module: ast.Module, path: Path) -> dict[str, str]:
    """Each local name this module calls `APIError` or `Subject` by, against the class it names."""

    if path == Path(exceptions.__file__):
        return {"APIError": "APIError", "Subject": "Subject"}

    return {
        alias.asname or alias.name: alias.name
        for node in module.body
        if isinstance(node, ast.ImportFrom) and node.module == "app.core.exceptions"
        for alias in node.names
        if alias.name in {"APIError", "Subject"}
    }


def _argument(call: ast.Call, name: str, position: int) -> ast.expr | None:
    for keyword in call.keywords:
        if keyword.arg == name:
            return keyword.value

    return call.args[position] if position < len(call.args) else None


def _refused(call: ast.Call, built: str) -> str | None:
    """What makes this call a box's check in a gate's shape, or `None`."""

    if built == "Subject":
        location = _argument(call, "location", 1)
        return None if isinstance(location, ast.Constant) and location.value == "path" else "a body-located subject"

    match _argument(call, "code", 1):
        case ast.Attribute(value=ast.Name(id="Code"), attr=member):
            return member.lower() if member in FIELD_CODES else None
        case code:
            # A code read from a value could be any member, a box's among them.
            return f"the code {ast.unparse(code) if code is not None else 'left out'}"


def _sites(node: ast.AST, names: dict[str, str], within: str) -> Iterator[tuple[str, str]]:
    for child in ast.iter_child_nodes(node):
        if isinstance(child, ast.FunctionDef | ast.AsyncFunctionDef):
            yield from _sites(child, names, f"{within}.{child.name}" if within else child.name)
            continue
        if isinstance(child, ast.Call) and isinstance(child.func, ast.Name) and child.func.id in names:
            refused = _refused(child, names[child.func.id])
            if refused is not None:
                yield within, refused
        yield from _sites(child, names, within)


def _found() -> set[tuple[str, str, str]]:
    found: set[tuple[str, str, str]] = set()
    for path in sorted(SOURCE.rglob("*.py")):
        module = ast.parse(path.read_bytes())
        names = _imported(module, path)
        if names:
            found.update((path.relative_to(SOURCE).as_posix(), function, what) for function, what in _sites(module, names, ""))

    return found


def test_a_gate_carries_no_boxs_code_nor_stands_at_a_box_outside_the_sites_named():
    found = _found()

    assert sorted(found - ALLOWED.keys()) == []
    # An entry whose site is gone or moved onto `refuse_faults` leaves, so the list names only what still stands.
    assert sorted(ALLOWED.keys() - found) == []
