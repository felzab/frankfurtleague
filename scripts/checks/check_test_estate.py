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

# What a fixture is asked for by name rather than by parameter: a mark pytest reads where it applies
# one, and a call it answers only where a test or a fixture reaches it.
USEFIXTURES_MARK: Final = "usefixtures"
GETFIXTUREVALUE: Final = "getfixturevalue"

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
        is_test_file = TEST_FILE.fullmatch(path.name) is not None
        self.tests = list(_tests(tree.body)) if is_test_file else []
        self.functions = {node.name: node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
        self.imports: dict[str, tuple[str, str | None]] = {}
        for node in tree.body:
            if isinstance(node, ast.Import):
                for alias in node.names:
                    # `import a.b` binds `a` alone; `import a.b as c` binds `c` to `a.b`.
                    module = alias.name if alias.asname else alias.name.partition(".")[0]
                    self.imports[alias.asname or module] = (module, None)
            elif isinstance(node, ast.ImportFrom):
                module = "." * node.level + (node.module or "")
                self.imports.update((alias.asname or alias.name, (module, alias.name)) for alias in node.names)
        # The parameters pytest fills, and the marks it reads: a collected test's and a `Test` class's
        # decorators, and a `pytestmark` in a test file's or a `Test` class's body.
        self.asked = {name for node in [*self.fixtures.values(), *self.tests] for name in _parameters(node)}
        if is_test_file:
            for mark in _honoured_marks(tree.body):
                self.asked.update(_requested(mark, USEFIXTURES_MARK))

    def roots(self) -> list[FunctionNode]:
        """What pytest itself calls: every collected test and every fixture."""
        return [*self.tests, *self.fixtures.values()]


def _tests(body: list[ast.stmt]) -> Iterator[FunctionNode]:
    """The functions pytest collects as tests from one body: `test`-prefixed, at module level or in a `Test`-prefixed class at any depth."""
    for node in body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith(TEST_FUNCTION_PREFIX):
            yield node
        elif isinstance(node, ast.ClassDef) and node.name.startswith(TEST_CLASS_PREFIX):
            yield from _tests(node.body)


def _honoured_marks(body: list[ast.stmt]) -> Iterator[ast.expr]:
    """Each mark expression pytest applies from one body: a collected test's or a `Test` class's decorator, or a `pytestmark`."""
    for node in body:
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "pytestmark" for target in node.targets):
            yield node.value
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith(TEST_FUNCTION_PREFIX):
            yield from node.decorator_list
        elif isinstance(node, ast.ClassDef) and node.name.startswith(TEST_CLASS_PREFIX):
            yield from node.decorator_list
            yield from _honoured_marks(node.body)


def _requested(node: ast.AST, call: str) -> Iterator[str]:
    """Every fixture name a `call` call inside `node` asks for, which has to be a string literal to be read at all."""
    for found in ast.walk(node):
        if not isinstance(found, ast.Call):
            continue
        target = found.func
        if (target.attr if isinstance(target, ast.Attribute) else (target.id if isinstance(target, ast.Name) else "")) != call:
            continue
        for arg in found.args:
            if not (isinstance(arg, ast.Constant) and isinstance(arg.value, str)):
                raise Unfollowed(f"line {found.lineno} asks for a fixture by a name that is no string literal")
            yield arg.value


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
        self.by_dotted = {self._dotted(module.path): module for module in self.modules}
        self.asked: set[str] = set()
        self._ask_through_calls()

    def _dotted(self, path: Path) -> str:
        """A module's import path below the root, its package's own where it is an `__init__.py`."""
        parts = path.relative_to(self.root).with_suffix("").parts
        return ".".join(parts[:-1] if parts[-1] == "__init__" else parts)

    def _module(self, importer: Module, name: str) -> Module | None:
        """The estate's module an import in `importer` names, rooted at the estate or below its own directory's name."""
        if name.startswith("."):
            level = len(name) - len(name.lstrip("."))
            dotted = [part for part in self._dotted(importer.path).split(".") if part]
            # One dot is the importer's own package: an `__init__.py` is that package, a plain module sits in it.
            package = dotted if importer.path.name == "__init__.py" else dotted[:-1]
            base = package[: len(package) - (level - 1)]
            name = ".".join([*base, name.lstrip(".")]).strip(".")
        head, _, rest = name.partition(".")
        return self.by_dotted.get(name) or (self.by_dotted.get(rest) if head == self.root.name else None)

    def _callees(self, module: Module, node: FunctionNode) -> Iterator[tuple[Module, FunctionNode]]:
        """The estate's own functions `node` calls by a name its module binds: its own, or one it imports."""
        for call in ast.walk(node):
            if not isinstance(call, ast.Call):
                continue
            target = call.func
            if isinstance(target, ast.Name):
                if target.id in module.functions:
                    yield module, module.functions[target.id]
                elif (imported := module.imports.get(target.id)) is not None and imported[1] is not None:
                    source = self._module(module, imported[0])
                    if source is not None and imported[1] in source.functions:
                        yield source, source.functions[imported[1]]
            elif isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name):
                imported = module.imports.get(target.value.id)
                if imported is None:
                    continue
                # `from pkg import module` binds a module as well as `import module` does.
                dotted = imported[0] if imported[1] is None else f"{imported[0]}.{imported[1]}"
                source = self._module(module, dotted)
                if source is not None and target.attr in source.functions:
                    yield source, source.functions[target.attr]

    def _ask_through_calls(self) -> None:
        """Every `getfixturevalue` string in a function pytest runs: a test, a fixture, or one they reach by calling it.

        One nobody calls is a string pytest never reads, so it excuses no fixture.
        """
        pending = [(module, node) for module in self.modules for node in module.roots()]
        reached: set[int] = set()
        while pending:
            module, node = pending.pop()
            if id(node) in reached:
                continue
            reached.add(id(node))
            try:
                self.asked.update(_requested(node, GETFIXTUREVALUE))
            except Unfollowed as error:
                self.unfollowed.append((module.path, str(error)))
            pending.extend(self._callees(module, node))

    def consumed_names(self, configured: frozenset[str] = frozenset()) -> set[str]:
        """Every fixture name a test or a fixture asks for, anywhere in the estate, and those the configuration asks for."""
        return set(configured).union(self.asked, *(module.asked for module in self.modules))


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
