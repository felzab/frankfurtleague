"""
CORE · the closed list of acts against the lines that record them

Each act is one hand-written `record_act` line, so a line lost is a gap in the Protokoll nothing else notices. `pyright`
holds a constant to the list; only this walk holds the list to the constants.
"""

import ast
from collections.abc import Iterator, Sequence
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


def _calls_of(name: str, function: Function) -> Iterator[ast.Call]:
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
