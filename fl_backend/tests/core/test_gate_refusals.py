"""
CORE · a gate carries no box's code and stands at no box

A box's fault reaches the body only through `refuse_faults`, which pyright and ruff hold to its shape. A field check
written in a gate's shape instead, an `APIError` carrying a `FieldCode` member or handed a body-located `Subject`,
passes both and marks no box, so the person reads the stale-page line where the box's phrase belongs. Only this walk
sees that shape: it reads every `APIError(...)` and `Subject(...)` the application builds, by the names its modules
import them under, and every call of a function turning a check it is handed into a gate.
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
        "one gate naming no field; each caller is a site of its own."
    ),
    ("core/exceptions.py", "as_judged_on_stored_state", "the code faults[0].code"): (
        "A write judging stored values it carries no body for answers their faults as one gate naming no field; each "
        "caller is a site of its own."
    ),
    # The callers of the three above, each handing them a check of values no box of its request holds.
    ("api/address_change/admin_router.py", "_refuse_an_address_off_limits", "a call of as_judged_on_stored_state"): (
        "The re-send and the discard act on a change by its id: the address on file is judged on the stored change; "
        "holds while each of its callers acts on a stored change."
    ),
    ("api/address_change/admin_router.py", "resend_confirmation.judge_and_remint_the_change", "a call of as_judged_on_stored_state"): (
        "The re-send sends no address: the new one is judged on the stored change; holds while its body carries none."
    ),
    ("api/grants/admin_router.py", "post_handover.judge", "a call of as_judged_on_stored_state"): (
        "The handover sends no address: the ban is judged on the stored grant's; holds while its body carries none."
    ),
    ("api/saisons/admin_router.py", "post_spielplan.draw_the_whole_season", "a call of as_judged_on_stored_state"): (
        "The draw sends no rules: the season's stored ones are judged; holds while its body carries none."
    ),
    ("api/spielbestaetigungen/admin_router.py", "adopt_spielbestaetigung.adopt_the_proposal", "a call of as_judged_on_the_stored_proposal"): (
        "The adoption sends no fixture: the stored proposal is judged; holds while its body carries none."
    ),
    ("api/spielbestaetigungen/person_router.py", "post_team_answer.answer", "a call of judged_as_a_proposal"): (
        "A club's answer proposes a date and a time, which the save's checks judge on a fixture body the answer does not "
        "send, so the paths their faults name are none of its boxes; holds while the save's checks are asked of that body."
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


def _calls(node: ast.AST, within: str) -> Iterator[tuple[str, ast.Call, str]]:
    """Every call of a bare name under `node`, beside the function it stands in and the name it calls."""

    for child in ast.iter_child_nodes(node):
        if isinstance(child, ast.FunctionDef | ast.AsyncFunctionDef):
            yield from _calls(child, f"{within}.{child.name}" if within else child.name)
            continue
        if isinstance(child, ast.Call) and isinstance(child.func, ast.Name):
            yield within, child, child.func.id
        yield from _calls(child, within)


def _found() -> set[tuple[str, str, str]]:
    modules = {path.relative_to(SOURCE).as_posix(): (path, ast.parse(path.read_bytes())) for path in sorted(SOURCE.rglob("*.py"))}
    calls = {name: list(_calls(module, "")) for name, (_, module) in modules.items()}

    found: set[tuple[str, str, str]] = set()
    for name, (path, module) in modules.items():
        imported = _imported(module, path)
        for within, call, callee in calls[name]:
            if callee in imported and (refused := _refused(call, imported[callee])) is not None:
                found.add((name, within, refused))

    # A function building a gate under a code read from a value turns whatever check its caller hands it into a gate, a
    # box's among them, so each call of it is a site of its own, where the walk sees what the call hands it.
    turning = {within.rsplit(".", 1)[-1] for _, within, what in found if what.startswith("the code ")}
    for name in modules:
        found.update((name, within, f"a call of {callee}") for within, _, callee in calls[name] if callee in turning)

    return found


def test_a_gate_carries_no_boxs_code_nor_stands_at_a_box_outside_the_sites_named():
    found = _found()

    assert sorted(found - ALLOWED.keys()) == []
    # An entry whose site is gone or moved onto `refuse_faults` leaves, so the list names only what still stands.
    assert sorted(ALLOWED.keys() - found) == []
