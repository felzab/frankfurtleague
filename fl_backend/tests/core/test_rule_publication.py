"""
TESTS · where a rule's code can be raised, traced from each route's own source

`app/main.py :: declared_refusals` publishes a rule's code on the operations `RULES` names and on no
other, so a route reaching a rule's check without being named raises a code its 409 never lists.
Traced as `tests/core/test_duplicate_key_publication.py` traces writes: each handler is followed
through the application's own functions, nested callbacks read with the function declaring them.
"""

import ast
import functools
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from pathlib import Path

from app.core.config import API_VERSION
from app.core.domain import OPERATION_SEPARATOR, RULES
from app.main import create_app
from tests.config import build_test_config
from tests.core.app_source import BACKEND_ROOT, Declaration, api_routes, callee, declared, module_of, resolve_callee, scoped_calls

# A rule's check a route reaches without `RULES` naming it, with why the call there cannot raise its
# code. Only a call whose arguments disarm the check belongs here; reading, not the trace, holds that.
STORED_NONE = "called with `stored=None`, so only the rules judging the proposed numbers alone fire, and this code weighs a stored season"
NO_SPANS = "called with `spieltag_spans=[]`: the draw dates no matchday and a create holds none, and this code weighs a dated one"
A_MOVE_IS_NO_ENTRY = 'called with `saison_status="future"`: a group move is no entry, so the season\'s status gate does not judge it'
A_PREDICATE = "read as a predicate deciding whether a reactivation mints a link, never passed to `refuse`"

CREATE_AND_DRAW = ("POST /saisons", "POST /saisons/{saison_id}/spielplan")
STORED_SEASON_CODES = (
    "REQ-RULES-002",
    "REQ-RULES-003",
    "REQ-RULES-004",
    "REQ-RULES-005",
    "REQ-RULES-006",
    "REQ-RULES-009",
    "REQ-RULES-011",
    "REQ-RULES-012",
)

DISARMED: Mapping[tuple[str, str], str] = {
    **{(code, operation): STORED_NONE for code in STORED_SEASON_CODES for operation in CREATE_AND_DRAW},
    **{("REQ-DATE-004", operation): NO_SPANS for operation in CREATE_AND_DRAW},
    ("REQ-ENTER-001", "PATCH /teams/{team_id}/saisons/{saison_id}"): A_MOVE_IS_NO_ENTRY,
    ("REQ-SCHIEDSRICHTER-006", "POST /schiedsrichter/{schiedsrichter_id}/reactivate"): A_PREDICATE,
}

# A named operation raising the code through a second function: `implemented_by` holds one, so the
# trace cannot see this operation reach it, and the control below would read that as a blind trace.
SECOND_IMPLEMENTER: Mapping[tuple[str, str], str] = {
    ("REQ-BEWERBUNG-011", "POST /bewerbungen/{bewerbung_id}/kontakte/{seat}"): (
        "the reseat raises it through `app/api/bewerbungen/services.py :: find_reseat_refusal`"
    ),
}

PREFIX = f"/api/v{API_VERSION}"


# The bare names the checks are declared under, which is all a call through a module or a value can spell.
CHECK_NAMES = frozenset(rule.implemented_by.rsplit(".", 1)[1] for rule in RULES)


@dataclass
class _Reach:
    """What one operation's handler reaches: the functions, as `RULES` spells an `implemented_by`."""

    functions: set[str] = field(default_factory=set)
    #: A rule's check the trace could not follow: called through a module, or held as a value.
    blind: set[str] = field(default_factory=set)


def _names(declaration: Declaration) -> Iterator[tuple[ast.Name | ast.Attribute, str]]:
    for node in ast.walk(declaration):
        if isinstance(node, ast.Name):
            yield node, node.id
        elif isinstance(node, ast.Attribute):
            yield node, node.attr


def _trace(declaration: Declaration, path: Path, reach: _Reach, seen: set[tuple[Path, int]]) -> None:
    here = path.relative_to(BACKEND_ROOT).as_posix()

    # `resolve_callee` follows a bare name alone, so a check reached any other way raises a code
    # the trace never sees: each such reference is recorded rather than passed over.
    called = {id(node.func) for node in ast.walk(declaration) if isinstance(node, ast.Call)}
    reach.blind.update(
        f"{here}:{node.lineno} holds `{ast.unparse(node)}` as a value"
        for node, name in _names(declaration)
        if name in CHECK_NAMES and id(node) not in called
    )

    for chain, call in scoped_calls(declaration, (declaration,)):
        resolved = resolve_callee(call, chain, path)
        if resolved is None:
            if callee(call) in CHECK_NAMES:
                reach.blind.add(f"{here}:{call.lineno} calls `{ast.unparse(call.func)}`, which the trace cannot follow")
            continue

        target, target_path = resolved
        if (target_path, target.lineno) in seen:
            continue
        seen.add((target_path, target.lineno))

        reach.functions.add(".".join((*target_path.relative_to(BACKEND_ROOT).with_suffix("").parts, target.name)))
        _trace(target, target_path, reach, seen)


@functools.cache
def _reach() -> Mapping[str, _Reach]:
    """Each served operation, keyed as `RULES` spells one."""

    reach: dict[str, _Reach] = {}
    for route in api_routes(create_app(build_test_config())):
        traced = _Reach()
        _trace(declared(route.endpoint), module_of(route.endpoint), traced, set())
        for method in route.methods or ():
            reach[f"{method} {route.path_format.removeprefix(PREFIX)}"] = traced

    return reach


def _named(operations: str) -> set[str]:
    return set(operations.split(OPERATION_SEPARATOR))


def _unnamed_reaches() -> set[tuple[str, str]]:
    return {
        (rule.code, operation)
        for rule in RULES
        for operation, reach in _reach().items()
        if rule.implemented_by in reach.functions and operation not in _named(rule.operation)
    }


def test_the_trace_follows_every_reference_to_a_rules_check():
    """A check called through its module, or handed on as a value, raises its code where the cases below see nothing."""

    assert sorted({entry for reach in _reach().values() for entry in reach.blind}) == []


def test_an_operation_reaching_a_rules_check_is_one_rules_names():
    """Both ways: an unnamed reach raises a code the document never lists, and a stale entry hides the next one."""

    unnamed = _unnamed_reaches()

    assert sorted(unnamed - DISARMED.keys()) == [], (
        "these reach a rule's check that `RULES` does not name them for, so their 409 omits its code"
    )
    assert sorted(DISARMED.keys() - unnamed) == [], "these entries name a reach the trace no longer finds"


def test_every_operation_rules_names_reaches_the_rules_check():
    """The control: a trace that followed no call would find no unnamed reach either, and pass the case above."""

    unreached = {
        (rule.code, operation)
        for rule in RULES
        for operation in _named(rule.operation)
        if operation not in _reach() or rule.implemented_by not in _reach()[operation].functions
    }

    assert sorted(unreached - SECOND_IMPLEMENTER.keys()) == []
    assert sorted(SECOND_IMPLEMENTER.keys() - unreached) == []
