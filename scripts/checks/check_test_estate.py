"""SCRIPTS · the backend suite answers loudly when a guarantee stops holding.

Two ways a suite goes quiet without going red, and nothing else here catches either: a discovered
parametrize list that found nothing, and a fixture no test consumes. Each is a green run over a
guarantee that has stopped being checked, which is worse than a red one. A test reaching a database
in the tier that starts no container is refused as it runs, by `fl_backend/tests/tier.py`.
"""

from __future__ import annotations

import ast
import sys
import tomllib
from pathlib import Path
from typing import Final

# Every caller runs this as a script, so sys.path opens with THIS directory and `lib/` is a
# sibling of it rather than in it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import (  # noqa: E402 -- the insert above is what resolves it
    EXIT_REFUSED,
    REPO_ROOT,
    Finding,
    report_findings,
    run,
)

BACKEND: Final = REPO_ROOT / "fl_backend"
TESTS: Final = BACKEND / "tests"
PYPROJECT: Final = BACKEND / "pyproject.toml"

FunctionNode = ast.FunctionDef | ast.AsyncFunctionDef

# What a fixture is asked for by name rather than by parameter. Both take the name as a string, so
# a fixture reached only this way looks unconsumed to a parameter sweep.
BY_NAME: Final = frozenset({"usefixtures", "getfixturevalue"})

# The values that turn an empty parametrize into a failure. `skip` is pytest's default and the one
# this rule exists to refuse; `xfail` reports a pass, which is the same silence.
LOUD_EMPTY_MARKS: Final = frozenset({"fail_at_collect"})
EMPTY_MARK_KEY: Final = "empty_parameter_set_mark"

# A module handed to the parser that does not come back. `ValueError` is the NUL byte, which raises
# before any syntax is read.
UNPARSABLE: Final = (OSError, UnicodeDecodeError, SyntaxError, ValueError)


class Module:
    """One parsed test module, and the fixtures it defines at any class depth."""

    def __init__(self, path: Path, tree: ast.Module) -> None:
        self.path = path
        self.tree = tree
        self.fixtures: dict[str, FunctionNode] = {}
        self.autouse: set[str] = set()
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            fixture = _fixture_decorator(node)
            if fixture is None:
                continue
            registered = _fixture_name(fixture, node.name)
            self.fixtures.setdefault(registered, node)
            if _is_autouse(fixture):
                self.autouse.add(registered)


def _fixture_name(decorator: ast.expr, defined: str) -> str:
    """What pytest registers this fixture under: its `name=` argument where one is written."""
    if isinstance(decorator, ast.Call):
        for kw in decorator.keywords:
            if kw.arg == "name" and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                return kw.value.value
    return defined


def _fixture_decorator(node: FunctionNode) -> ast.expr | None:
    for decorator in node.decorator_list:
        target = decorator.func if isinstance(decorator, ast.Call) else decorator
        if isinstance(target, ast.Attribute) and target.attr == "fixture":
            return decorator
    return None


def _is_autouse(decorator: ast.expr) -> bool:
    """An autouse fixture is consumed by every test in its scope and named by none of them."""
    if not isinstance(decorator, ast.Call):
        return False
    for kw in decorator.keywords:
        if kw.arg != "autouse":
            continue
        # A non-literal argument is read as autouse: the alternative reports a live fixture dead.
        return not (isinstance(kw.value, ast.Constant) and kw.value.value is False)
    return False


def _parameters(node: FunctionNode) -> list[str]:
    args = node.args
    named = [*args.posonlyargs, *args.args, *args.kwonlyargs]
    return [arg.arg for arg in named if arg.arg != "self"]


class Estate:
    """Every module under `tests/`."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.modules: list[Module] = []
        # A module that will not parse is an input this cannot judge rather than a rule it broke, so
        # it is collected for `main` to refuse on and never allowed to end the run as a crash.
        self.unreadable: list[tuple[Path, str]] = []
        for path in sorted(root.rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            try:
                tree = ast.parse(path.read_bytes().decode("utf-8"), filename=str(path))
            except UNPARSABLE as error:
                self.unreadable.append((path, f"{type(error).__name__}: {error}"))
                continue
            self.modules.append(Module(path, tree))

    def consumed_names(self) -> set[str]:
        """Every fixture name something asks for — as a parameter, or by string."""
        asked: set[str] = set()
        for module in self.modules:
            for node in ast.walk(module.tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    asked.update(_parameters(node))
                elif isinstance(node, ast.Call):
                    target = node.func
                    name = target.attr if isinstance(target, ast.Attribute) else (target.id if isinstance(target, ast.Name) else "")
                    if name in BY_NAME:
                        asked.update(arg.value for arg in node.args if isinstance(arg, ast.Constant) and isinstance(arg.value, str))
        return asked


def check_dead_fixtures(estate: Estate) -> list[Finding]:
    """A fixture nothing consumes is a guarantee that was deleted from one end only."""
    asked = estate.consumed_names()
    findings: list[Finding] = []
    for module in estate.modules:
        for name, node in module.fixtures.items():
            if name in asked or name in module.autouse:
                continue
            detail = f"{_shown(module.path)}:{node.lineno} fixture `{name}` is consumed by no test and no other fixture"
            findings.append(Finding("fail", detail))
    return findings


def check_empty_parametrize() -> list[Finding]:
    """The one setting that turns a parametrize list which discovered nothing into a failure.

    The per-module floors guarding a handful of sweeps cover none of the rest.
    """
    try:
        config = tomllib.loads(PYPROJECT.read_bytes().decode("utf-8"))
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as error:
        return [Finding("fail", f"{_shown(PYPROJECT)} could not be read, so the suite's empty-parametrize setting is unknown: {error}")]
    options = config.get("tool", {}).get("pytest", {}).get("ini_options", {})
    setting = options.get(EMPTY_MARK_KEY)
    if setting in LOUD_EMPTY_MARKS:
        return []
    spelled = "nothing, so pytest's default `skip` applies" if setting is None else f"`{setting}`"
    detail = f"{_shown(PYPROJECT)} sets `{EMPTY_MARK_KEY}` to {spelled} - a sweep that discovered nothing then passes as one silent skip"
    return [Finding("fail", detail)]


def _shown(path: Path) -> str:
    try:
        return path.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def main() -> int:
    if not TESTS.is_dir():
        print(f"      {_shown(TESTS)} is not a directory, so nothing was read.", file=sys.stderr)
        return EXIT_REFUSED

    estate = Estate(TESTS)
    if estate.unreadable:
        for path, reason in estate.unreadable:
            print(f"      {_shown(path)} could not be parsed, so nothing under it was judged: {reason}", file=sys.stderr)
        return EXIT_REFUSED

    findings = [*check_empty_parametrize(), *check_dead_fixtures(estate)]
    code = report_findings(findings)

    fixtures = sum(len(module.fixtures) for module in estate.modules)
    print(f"      {len(estate.modules)} module(s) under {_shown(TESTS)}: {fixtures} fixture(s)")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
