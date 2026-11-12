"""
CORE · the closed list of acts against the lines that record them

Each act is one hand-written `record_act` line, so a line lost is a gap in the Protokoll nothing else notices. `pyright`
holds a constant to the list; only this walk holds the list to the constants, and each line leaving out who acted to the
routes that bind an administrator.
"""

import ast
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import get_args

from app.core import recording
from app.core.recording import FLAction

SOURCE = Path(recording.__file__).parents[1]

type Function = ast.FunctionDef | ast.AsyncFunctionDef


def _functions() -> list[Function]:
    return [
        node
        for path in sorted(SOURCE.rglob("*.py"))
        for node in ast.walk(ast.parse(path.read_bytes()))
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef)
    ]


def _calls_of(name: str, function: ast.AST) -> Iterator[ast.Call]:
    for node in ast.walk(function):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == name:
            yield node


def _parameters(function: Function) -> list[str]:
    return [argument.arg for argument in (*function.args.posonlyargs, *function.args.args)]


def _argument(call: ast.Call, name: str, position: int | None) -> ast.expr | None:
    """What `call` hands the parameter, by keyword or at `position`; `None` where it leaves the default."""

    for keyword in call.keywords:
        if keyword.arg == name:
            return keyword.value

    return call.args[position] if position is not None and position < len(call.args) else None


def _constants(value: ast.expr, call: ast.Call, functions: Sequence[Function]) -> Iterator[str]:
    """Every action `value` can name: a conditional's arms, and a parameter's arguments at every call of its function."""

    match value:
        case ast.Constant(value=str(action)):
            yield action
        case ast.Constant(value=None):
            return
        case ast.IfExp(body=body, orelse=orelse):
            yield from _constants(body, call, functions)
            yield from _constants(orelse, call, functions)
        case ast.BoolOp(values=values):
            for one in values:
                yield from _constants(one, call, functions)
        case ast.Name(id=parameter):
            yield from _forwarded(parameter, call, functions)
        case _:
            raise AssertionError(f"line {value.lineno} names an action this walk cannot read")


def _forwarded(parameter: str, call: ast.Call, functions: Sequence[Function]) -> Iterator[str]:
    owners = [
        function
        for function in functions
        if any(node is call for node in ast.walk(function))
        and parameter in (*_parameters(function), *(argument.arg for argument in function.args.kwonlyargs))
    ]
    assert owners, f"line {call.lineno} names an action no parameter of its function holds"

    for owner in owners:
        position = _parameters(owner).index(parameter) if parameter in _parameters(owner) else None
        for caller in functions:
            for forwarding in _calls_of(owner.name, caller):
                argument = _argument(forwarding, parameter, position)
                if argument is not None:
                    yield from _constants(argument, forwarding, functions)


def _recorded() -> set[str]:
    functions = _functions()
    recorded: set[str] = set()
    for function in functions:
        for call in _calls_of("record_act", function):
            action = _argument(call, "action", None)
            assert action is not None, f"line {call.lineno} records no action"
            recorded.update(_constants(action, call, functions))

    return recorded


def test_every_action_has_its_line_and_every_line_its_action():
    assert _recorded() == set(get_args(FLAction.__value__))


@dataclass(frozen=True)
class _TopLevel:
    """A module's statement, holding whatever is nested in it; `name` is `None` where nothing can call it."""

    path: Path
    statement: ast.stmt
    name: str | None
    reads: frozenset[str]


def _top_levels() -> list[_TopLevel]:
    return [
        _TopLevel(
            path=path,
            statement=statement,
            name=statement.name if isinstance(statement, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef) else None,
            # A name and an attribute alike: a call, a callback handed on, a `Depends`, a function reached through its module.
            reads=frozenset(
                node.id if isinstance(node, ast.Name) else node.attr
                for node in ast.walk(statement)
                if isinstance(node, ast.Name | ast.Attribute)
            ),
        )
        for path in sorted(SOURCE.rglob("*.py"))
        for statement in ast.parse(path.read_bytes()).body
    ]


def _entries(top_level: _TopLevel, top_levels: Sequence[_TopLevel], walked: set[_TopLevel]) -> Iterator[Path]:
    """The file of every statement a call of `top_level` can come in from, each one nothing else reads.

    By name, as the walk above, so a namesake's reader counts as a caller too: that can only add an entry.
    """

    callers = [other for other in top_levels if top_level.name in other.reads and other.name != top_level.name] if top_level.name else []
    if not callers:
        yield top_level.path

    for caller in callers:
        if caller not in walked:
            walked.add(caller)
            yield from _entries(caller, top_levels, walked)


def test_an_act_leaving_out_who_acted_is_reached_from_an_administrators_route_alone():
    """`record_act` reads a left-out `by` off `bind_actor`, which only an admin router binds, so elsewhere the act fails at the press."""

    top_levels = _top_levels()
    leaving_it_out = [
        top_level
        for top_level in top_levels
        if any(_argument(call, "by", None) is None for call in _calls_of("record_act", top_level.statement))
    ]
    entries = {entry for top_level in leaving_it_out for entry in _entries(top_level, top_levels, {top_level})}

    assert {entry.relative_to(SOURCE).as_posix() for entry in entries if entry.name != "admin_router.py"} == set()
