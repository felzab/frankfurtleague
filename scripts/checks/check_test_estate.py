"""SCRIPTS · the backend suite answers loudly when a guarantee stops holding.

Two ways a suite goes quiet without going red, and nothing else here catches either: a discovered
parametrize list that found nothing, and a fixture no test consumes. Each is a green run over a
guarantee that has stopped being checked, which is worse than a red one. A test reaching a database
in the tier that starts no container is refused as it runs, by `fl_backend/tests/tier.py`.
"""

from __future__ import annotations

import ast
import re
import sys
import tomllib
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Final

# Every caller runs this as a script, so sys.path opens with THIS directory and `lib/` is a
# sibling of it rather than in it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import (
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

# pytest's own collection defaults, the only ones this reads a test by; a configuration naming its
# own would make a consumer of a fixture invisible here (https://docs.pytest.org/en/stable/reference/reference.html#confval-python_files).
COLLECTION_KEYS: Final = ("python_files", "python_classes", "python_functions")
TEST_FILE: Final = re.compile(r"test_.*\.py|.*_test\.py")
TEST_CLASS_PREFIX: Final = "Test"
TEST_FUNCTION_PREFIX: Final = "test"

# The configuration's own request for a fixture, which every test makes without naming it.
USEFIXTURES_KEY: Final = "usefixtures"


class Unfollowed(ValueError):
    """A spelling this cannot follow to the fixture it names, so the module is not judged."""


class Module:
    """One parsed test module, the fixtures it defines at any class depth, and every name its tests and fixtures ask for."""

    def __init__(self, path: Path, tree: ast.Module) -> None:
        self.path = path
        self.tree = tree
        self.fixtures: dict[str, FunctionNode] = {}
        self.autouse: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and any(alias.name == "fixture" for alias in node.names):
                raise Unfollowed(f"line {node.lineno} imports `fixture` by name, which this reads only as `pytest.fixture`")
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            fixture = _fixture_decorator(node)
            if fixture is None:
                continue
            registered = _fixture_name(fixture, node.name)
            self.fixtures.setdefault(registered, node)
            if _is_autouse(fixture):
                self.autouse.add(registered)
        self.asked = self._asked()

    def _asked(self) -> set[str]:
        """What pytest hands a fixture to: a test's or a fixture's parameter, and a `usefixtures` or `getfixturevalue` string.

        A helper's parameter is none of them, so it excuses no fixture sharing its name.
        """
        asked = {name for node in self.fixtures.values() for name in _parameters(node)}
        if TEST_FILE.fullmatch(self.path.name):
            asked.update(name for node in _tests(self.tree.body) for name in _parameters(node))
        for node in ast.walk(self.tree):
            if not isinstance(node, ast.Call):
                continue
            target = node.func
            if (target.attr if isinstance(target, ast.Attribute) else (target.id if isinstance(target, ast.Name) else "")) not in BY_NAME:
                continue
            for arg in node.args:
                if not (isinstance(arg, ast.Constant) and isinstance(arg.value, str)):
                    raise Unfollowed(f"line {node.lineno} asks for a fixture by a name that is no string literal")
                asked.add(arg.value)
        return asked


def _tests(body: list[ast.stmt]) -> Iterator[FunctionNode]:
    """The functions pytest collects as tests from one body: `test`-prefixed, at module level or in a `Test`-prefixed class at any depth."""
    for node in body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith(TEST_FUNCTION_PREFIX):
            yield node
        elif isinstance(node, ast.ClassDef) and node.name.startswith(TEST_CLASS_PREFIX):
            yield from _tests(node.body)


def _fixture_name(decorator: ast.expr, defined: str) -> str:
    """What pytest registers this fixture under: its `name=` argument where one is written."""
    if isinstance(decorator, ast.Call):
        for kw in decorator.keywords:
            if kw.arg != "name":
                continue
            if not (isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str)):
                raise Unfollowed(f"line {decorator.lineno} names fixture `{defined}` by an expression this cannot read")
            return kw.value.value
    return defined


def _fixture_decorator(node: FunctionNode) -> ast.expr | None:
    for decorator in node.decorator_list:
        target = decorator.func if isinstance(decorator, ast.Call) else decorator
        if isinstance(target, ast.Attribute) and target.attr == "fixture":
            return decorator
        if isinstance(target, ast.Name) and target.id == "fixture":
            raise Unfollowed(f"line {decorator.lineno} decorates `{node.name}` with a bare `fixture`, which this cannot place")
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
        # A module holding a spelling this cannot follow: judged, it would read a live fixture as dead
        # or a dead one as live, so it is refused like an unparsable one.
        self.unfollowed: list[tuple[Path, str]] = []
        for path in sorted(root.rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            try:
                tree = ast.parse(path.read_bytes().decode("utf-8"), filename=str(path))
            except UNPARSABLE as error:
                self.unreadable.append((path, f"{type(error).__name__}: {error}"))
                continue
            try:
                self.modules.append(Module(path, tree))
            except Unfollowed as error:
                self.unfollowed.append((path, str(error)))

    def consumed_names(self, configured: frozenset[str] = frozenset()) -> set[str]:
        """Every fixture name a test or a fixture asks for, anywhere in the estate, and those the configuration asks for."""
        return set(configured).union(*(module.asked for module in self.modules))


def configured_fixtures(options: dict[str, Any]) -> frozenset[str]:
    """The fixtures the configuration's `usefixtures` hands every test, refusing a collection this does not read."""
    if named := [key for key in COLLECTION_KEYS if key in options]:
        raise Unfollowed(f"{_shown(PYPROJECT)} sets {', '.join(named)}, and this reads tests by pytest's defaults alone")
    listed = options.get(USEFIXTURES_KEY, [])
    if not (isinstance(listed, list) and all(isinstance(name, str) for name in listed)):
        raise Unfollowed(f"{_shown(PYPROJECT)} sets `{USEFIXTURES_KEY}` to something other than a list of names")
    return frozenset(listed)


def check_dead_fixtures(estate: Estate, configured: frozenset[str] = frozenset()) -> list[Finding]:
    """A fixture nothing consumes is a guarantee that was deleted from one end only."""
    asked = estate.consumed_names(configured)
    findings: list[Finding] = []
    for module in estate.modules:
        for name, node in module.fixtures.items():
            if name in asked or name in module.autouse:
                continue
            detail = f"{_shown(module.path)}:{node.lineno} fixture `{name}` is consumed by no test and no other fixture"
            findings.append(Finding("fail", detail))
    return findings


def pytest_options() -> tuple[dict[str, Any], str | None]:
    """The suite's pytest settings, or none and why the file could not be read."""
    try:
        config = tomllib.loads(PYPROJECT.read_bytes().decode("utf-8"))
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as error:
        return {}, str(error)
    return config.get("tool", {}).get("pytest", {}).get("ini_options", {}), None


def check_empty_parametrize(options: dict[str, Any], unread: str | None) -> list[Finding]:
    """The one setting that turns a parametrize list which discovered nothing into a failure.

    The per-module floors guarding a handful of sweeps cover none of the rest.
    """
    if unread is not None:
        return [Finding("fail", f"{_shown(PYPROJECT)} could not be read, so the suite's empty-parametrize setting is unknown: {unread}")]
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
    if estate.unreadable or estate.unfollowed:
        for path, reason in estate.unreadable:
            print(f"      {_shown(path)} could not be parsed, so nothing under it was judged: {reason}", file=sys.stderr)
        for path, reason in estate.unfollowed:
            print(f"      {_shown(path)}: {reason}, so no fixture was judged", file=sys.stderr)
        return EXIT_REFUSED
    options, unread = pytest_options()
    try:
        configured = configured_fixtures(options)
    except Unfollowed as error:
        print(f"      {error}, so no fixture was judged", file=sys.stderr)
        return EXIT_REFUSED

    findings = [*check_empty_parametrize(options, unread), *check_dead_fixtures(estate, configured)]
    code = report_findings(findings)

    fixtures = sum(len(module.fixtures) for module in estate.modules)
    print(f"      {len(estate.modules)} module(s) under {_shown(TESTS)}: {fixtures} fixture(s)")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
