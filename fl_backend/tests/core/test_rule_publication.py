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
from tests.core.app_source import BACKEND_ROOT, Declaration, api_routes, bound_at, callee, declared, module_of, resolve_callee, scoped_calls


@dataclass(frozen=True)
class Disarmed:
    """Why a route reaching a rule's check it is not named for cannot raise the code, as a binding the trace can hold."""

    reason: str
    #: The parameter and the literal, as source, every call of the check in that operation binds;
    #: `None` for a check read as a predicate, which no call may hand to `refuse`.
    binding: tuple[str, str] | None


# A rule's check a route reaches without `RULES` naming it, disarmed at every call there.
STORED_NONE = Disarmed("only the rules judging the proposed numbers alone fire, and this code weighs a stored season", ("stored", "None"))
NO_SPANS = Disarmed("the draw dates no matchday and a create holds none, and this code weighs a dated one", ("spieltag_spans", "[]"))
A_MOVE_IS_NO_ENTRY = Disarmed("a group move is no entry, so the season's status gate does not judge it", ("saison_status", "'future'"))
A_PREDICATE = Disarmed("read to decide whether a reactivation mints a link", None)

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

DISARMED: Mapping[tuple[str, str], Disarmed] = {
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
REFUSE = "refuse"


Key = tuple[Path, int]


@dataclass(frozen=True)
class _Site:
    call: ast.Call
    #: The innermost function around the call, whose own callers a pass-through binding is followed to.
    caller: Declaration
    caller_path: Path


@dataclass
class _Reach:
    """What one operation's handler reaches: the functions, as `RULES` spells an `implemented_by`."""

    functions: set[str] = field(default_factory=set)
    #: A rule's check the trace could not follow: called through a module, or held as a value.
    blind: set[str] = field(default_factory=set)
    declarations: dict[str, tuple[Key, Declaration]] = field(default_factory=dict)
    #: Every call site of each reached function, keyed by its declaration.
    sites: dict[Key, list[_Site]] = field(default_factory=dict)
    #: The calls handed straight to `refuse`.
    refused: set[int] = field(default_factory=set)


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
        if callee(call) == REFUSE:
            reach.refused.update(id(argument) for argument in call.args)

        resolved = resolve_callee(call, chain, path)
        if resolved is None:
            if callee(call) in CHECK_NAMES:
                reach.blind.add(f"{here}:{call.lineno} calls `{ast.unparse(call.func)}`, which the trace cannot follow")
            continue

        target, target_path = resolved
        key = (target_path, target.lineno)
        reach.sites.setdefault(key, []).append(_Site(call, chain[-1], path))
        if key in seen:
            continue
        seen.add(key)

        dotted = ".".join((*target_path.relative_to(BACKEND_ROOT).with_suffix("").parts, target.name))
        reach.functions.add(dotted)
        reach.declarations[dotted] = (key, target)
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


def _parameters(declaration: Declaration) -> list[str]:
    return [argument.arg for argument in (*declaration.args.posonlyargs, *declaration.args.args, *declaration.args.kwonlyargs)]


def _unbound(reach: _Reach, site: _Site, called: Declaration, parameter: str, literal: str) -> Iterator[str]:
    """Each call site that does not bind `parameter` to `literal`, a caller's own parameter followed out to that caller's callers."""

    positional = [argument.arg for argument in (*called.args.posonlyargs, *called.args.args)]
    argument = bound_at(site.call, parameter, positional.index(parameter) if parameter in positional else None).argument
    if argument == literal:
        return

    outer = reach.sites.get((site.caller_path, site.caller.lineno), [])
    if argument in _parameters(site.caller) and outer:
        for caller_site in outer:
            yield from _unbound(reach, caller_site, site.caller, argument, literal)
        return

    yield f"{site.caller_path.relative_to(BACKEND_ROOT).as_posix()}:{site.call.lineno} binds `{parameter}` to `{argument}`"


def test_every_allowlisted_call_binds_what_disarms_it():
    """The allowlist is keyed by code and operation, so an armed call would stand on it: each entry's binding is held at every call."""

    armed: list[str] = []
    for (code, operation), disarmed in DISARMED.items():
        reach = _reach()[operation]
        key, called = reach.declarations[next(rule.implemented_by for rule in RULES if rule.code == code)]
        for site in reach.sites[key]:
            if disarmed.binding is None:
                armed.extend([f"{code} on {operation}: a call handed to `refuse`"] if id(site.call) in reach.refused else [])
            else:
                armed.extend(f"{code} on {operation}: {breach}" for breach in _unbound(reach, site, called, *disarmed.binding))

    assert armed == []


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
