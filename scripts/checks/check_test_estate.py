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
from typing import Any, Final, NamedTuple

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
# What a call by a name can run: a function, or a lambda bound to the name.
CalledNode = ast.FunctionDef | ast.AsyncFunctionDef | ast.Lambda

# What a fixture is asked for by name rather than by parameter: a mark pytest reads where it applies
# one, and a call it answers only where a test or a fixture reaches it.
USEFIXTURES_MARK: Final = "usefixtures"
GETFIXTUREVALUE: Final = "getfixturevalue"

# The attribute pytest reads to skip a module or a class, and the methods that keep it from collecting a class.
TEST_SWITCH: Final = "__test__"
CONSTRUCTORS: Final = frozenset({"__init__", "__new__"})
# The one decorator spelling a class may carry and still be judged.
MARK_PREFIX: Final = "pytest.mark."

# The mark that hands a test an argument itself, so pytest asks no fixture of that name for it.
PARAMETRIZE_MARK: Final = "parametrize"

# `mock.patch` and its `object`, `dict` and `multiple` forms, all reached through this name.
PATCH: Final = "patch"

# The file whose module-level fixtures reach its whole directory, and the name of the list that makes
# a module's fixtures every test's.
CONFTEST: Final = "conftest.py"
PLUGINS: Final = "pytest_plugins"

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


class Scope(NamedTuple):
    """Where pytest supplies a fixture, or where a request for one is made.

    A `conftest.py`'s module-level fixture reaches its directory's whole subtree; any other is its
    module's alone, and inside a class that class's alone (https://docs.pytest.org/en/stable/reference/fixtures.html#fixture-availability).
    """

    path: Path
    subtree: bool
    classes: tuple[str, ...] = ()

    def holds(self, module: Path, classes: tuple[str, ...]) -> bool:
        """Whether a test at `classes` in `module` is supplied from here."""
        if self.subtree:
            return module.is_relative_to(self.path)
        return module == self.path and classes[: len(self.classes)] == self.classes

    def meets(self, other: Scope) -> bool:
        """Whether some test is supplied from both, which is where a fixture defined in one may ask for one defined in the other."""
        if self.subtree and other.subtree:
            return self.path.is_relative_to(other.path) or other.path.is_relative_to(self.path)
        if self.subtree or other.subtree:
            inner, outer = (other, self) if self.subtree else (self, other)
            return inner.path.is_relative_to(outer.path)
        shorter = min(len(self.classes), len(other.classes))
        return self.path == other.path and self.classes[:shorter] == other.classes[:shorter]

    def _rank(self) -> tuple[int, int]:
        """How near a test this supplies: a module or class beats any directory, a deeper class or directory a shallower one."""
        return (0, len(self.path.parts)) if self.subtree else (1, len(self.classes))

    def narrower(self, other: Scope) -> Scope:
        """The one of two scopes that `meets` pairs lying inside the other, which is where both reach."""
        return self if self._rank() >= other._rank() else other

    def covers(self, other: Scope) -> bool:
        """Whether this supplies every test `other` holds."""
        if other.subtree:
            return self.subtree and other.path.is_relative_to(self.path)
        return self.holds(other.path, other.classes)

    def nearer_than(self, other: Scope) -> bool:
        """Of two scopes both supplying a test, whether pytest takes this one's fixture over the other's."""
        return self._rank() > other._rank()


class Definition(NamedTuple):
    """One fixture as pytest registers it, and the scope its own module gives it."""

    name: str
    node: FunctionNode
    scope: Scope
    autouse: bool
    in_class: bool
    # Registered under `name=` wherever it is bound, rather than under the name binding it there.
    named: bool


class Request(NamedTuple):
    """One name pytest is asked to supply: from one test's own place, or from anywhere a fixture is supplied.

    `origin` is the asking fixture, which its own name never reaches.
    """

    name: str
    scope: Scope
    point: bool
    origin: int | None


class Test(NamedTuple):
    """One collected test, the classes it is nested in, and every mark pytest applies to it."""

    node: FunctionNode
    classes: tuple[str, ...]
    marks: tuple[ast.expr, ...]


class Module:
    """One parsed test module: the fixtures it defines, the tests pytest collects from it, and the names it binds."""

    def __init__(self, path: Path, tree: ast.Module) -> None:
        self.path = path
        self.tree = tree
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and any(alias.name == "fixture" for alias in node.names):
                raise Unfollowed(f"line {node.lineno} imports `fixture` by name, which this reads only as `pytest.fixture`")
        self.definitions = list(self._defined(tree.body, ()))
        is_test_file = TEST_FILE.fullmatch(path.name) is not None
        module_marks = tuple(_pytestmarks(tree.body))
        declared = {node.name: node for node in tree.body if isinstance(node, ast.ClassDef)}
        collected = is_test_file and _test_switch(tree.body) is not False
        self.tests = list(_tests(tree.body, (), module_marks, declared)) if collected else []
        # pytest strips the arguments a `mock.patch` decorator injects (`num_mock_patch_args`, read at its
        # release 9.1.1), and how many depends on values only the run knows, so such a test is never judged.
        patching = {PATCH} | {
            alias.asname or alias.name
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom) and "mock" in (node.module or "")
            for alias in node.names
            if alias.name == PATCH
        }
        # A name bound to a patch is that patch where it decorates: in source order, so one name bound
        # through another is read after it.
        for node in sorted((node for node in ast.walk(tree) if isinstance(node, ast.Assign)), key=lambda node: node.lineno):
            if set(_dotted_parts(node.value)) & patching:
                patching |= {target.id for target in node.targets if isinstance(target, ast.Name)}
        for test in self.tests:
            if any(set(_dotted_parts(mark)) & patching for mark in test.marks):
                raise Unfollowed(
                    f"line {test.node.lineno} patches `{test.node.name}` with `mock.patch`, whose injected arguments pytest strips"
                )
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

    def _defined(self, body: list[ast.stmt], classes: tuple[str, ...]) -> Iterator[Definition]:
        """Every fixture one body defines, and the ones its classes do, each with the scope pytest gives it here."""
        for node in body:
            if isinstance(node, ast.ClassDef):
                yield from self._defined(node.body, (*classes, node.name))
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                decorator = _fixture_decorator(node)
                if decorator is not None:
                    subtree = self.path.name == CONFTEST and not classes
                    scope = Scope(self.path.parent, True) if subtree else Scope(self.path, False, classes)
                    named = isinstance(decorator, ast.Call) and any(keyword.arg == "name" for keyword in decorator.keywords)
                    yield Definition(_fixture_name(decorator, node.name), node, scope, _is_autouse(decorator), bool(classes), named)
                # pytest never registers a fixture defined inside a function, so one there is read past.
                for inner in ast.walk(node):
                    if inner is not node and isinstance(inner, (ast.FunctionDef, ast.AsyncFunctionDef)) and _fixture_decorator(inner):
                        raise Unfollowed(f"line {inner.lineno} defines fixture `{inner.name}` inside a function, which pytest never registers")


def _dotted_parts(decorator: ast.expr) -> Iterator[str]:
    """Every name in a decorator's dotted callee: `mock.patch.object(...)` gives `mock`, `patch` and `object`."""
    target = decorator.func if isinstance(decorator, ast.Call) else decorator
    while isinstance(target, ast.Attribute):
        yield target.attr
        target = target.value
    if isinstance(target, ast.Name):
        yield target.id


def _pytestmarks(body: list[ast.stmt]) -> Iterator[ast.expr]:
    """The marks a `pytestmark` in one body applies to every test below it."""
    for node in body:
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "pytestmark" for target in node.targets):
            yield node.value


def _test_switch(body: list[ast.stmt]) -> bool | None:
    """What a body's own `__test__` says, which pytest reads by truth alone, or `None` where it sets none."""
    for node in body:
        value = node.value if isinstance(node, (ast.Assign, ast.AnnAssign)) else None
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
        if value is None or not any(isinstance(target, ast.Name) and target.id == TEST_SWITCH for target in targets):
            continue
        if not isinstance(value, ast.Constant):
            raise Unfollowed(f"line {node.lineno} sets `{TEST_SWITCH}` to an expression this cannot read")
        return bool(value.value)
    return None


def _uncollected(node: ast.ClassDef, classes: dict[str, ast.ClassDef]) -> bool:
    """Whether pytest skips this class: its own or an inherited constructor, or a false `__test__`.

    As its `Class.collect` decides, read at release 9.1.1. Refused where a decorator or a class keyword
    may decide it instead.
    """
    if _test_switch(node.body) is False:
        return True
    for decorator in node.decorator_list:
        # A mark hands back the class it was given, so the class alone still decides.
        if not ast.unparse(decorator).startswith(MARK_PREFIX):
            raise Unfollowed(f"line {node.lineno} decorates `{node.name}` with {ast.unparse(decorator)}, which may give it a constructor")
    if node.keywords:
        raise Unfollowed(
            f"line {node.lineno} gives `{node.name}` {ast.unparse(node.keywords[0])}, which may give it a constructor or make it abstract"
        )
    for statement in node.body:
        named = [statement.name] if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef)) else []
        named += [target.id for target in getattr(statement, "targets", []) if isinstance(target, ast.Name)]
        if CONSTRUCTORS & set(named):
            return True
    for base in node.bases:
        if isinstance(base, ast.Name) and base.id == "object":
            continue
        if not (isinstance(base, ast.Name) and base.id in classes):
            raise Unfollowed(f"line {node.lineno} bases `{node.name}` on {ast.unparse(base)}, whose constructor this cannot read")
        if _uncollected(classes[base.id], classes):
            return True
    return False


def _tests(body: list[ast.stmt], classes: tuple[str, ...], marks: tuple[ast.expr, ...], declared: dict[str, ast.ClassDef]) -> Iterator[Test]:
    """The tests pytest collects from one body: `test`-prefixed, at module level or in a `Test`-prefixed class at any depth.

    Each carries every mark it is given: its own decorators, its classes' decorators and `pytestmark`s, and its module's.
    """
    for node in body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith(TEST_FUNCTION_PREFIX):
            yield Test(node, classes, (*marks, *node.decorator_list))
        elif isinstance(node, ast.ClassDef) and node.name.startswith(TEST_CLASS_PREFIX) and not _uncollected(node, declared):
            yield from _tests(node.body, (*classes, node.name), (*marks, *node.decorator_list, *_pytestmarks(node.body)), declared)


def _supplied(marks: tuple[ast.expr, ...]) -> set[str]:
    """The arguments a `parametrize` mark hands a test directly, which pytest then never asks a fixture for.

    An `indirect` one is handed to the fixture of its name, so that fixture is still asked for.
    """
    supplied: set[str] = set()
    for mark in marks:
        for call in ast.walk(mark):
            if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and call.func.attr == PARAMETRIZE_MARK):
                continue
            keywords = {keyword.arg: keyword.value for keyword in call.keywords}
            spelled = call.args[0] if call.args else keywords.get("argnames")
            names = _literal_names(spelled, call.lineno)
            indirect = keywords.get("indirect")
            if indirect is None or (isinstance(indirect, ast.Constant) and indirect.value is False):
                supplied.update(names)
            elif not (isinstance(indirect, ast.Constant) and indirect.value is True):
                supplied.update(set(names) - set(_literal_names(indirect, call.lineno)))
    return supplied


def _literal_names(node: ast.expr | None, line: int) -> list[str]:
    """A `parametrize` argument's names, as one comma-separated string or a list or tuple of strings."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return [name.strip() for name in node.value.split(",") if name.strip()]
    if isinstance(node, (ast.List, ast.Tuple)) and all(isinstance(item, ast.Constant) and isinstance(item.value, str) for item in node.elts):
        return [str(item.value) for item in node.elts if isinstance(item, ast.Constant)]
    raise Unfollowed(f"line {line} parametrizes by names that are no string literal")


def _run_by(node: ast.AST) -> Iterator[ast.AST]:
    """Every node below `node` that runs when `node` does, a nested function or lambda included but not its body.

    Its decorators and defaults run where it is defined; its body only where it is called.
    """
    for child in ast.iter_child_nodes(node):
        yield child
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            arguments = child.args
            for runs in (*getattr(child, "decorator_list", []), *arguments.defaults, *arguments.kw_defaults):
                if runs is not None:
                    yield runs
                    yield from _run_by(runs)
        else:
            yield from _run_by(child)


def _nested(node: ast.AST) -> dict[str, CalledNode]:
    """The functions and lambdas `node`'s own code binds to a name, which a call by that name runs."""
    bound: dict[str, CalledNode] = {}
    for child in _run_by(node):
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
            bound[child.name] = child
        elif isinstance(child, ast.Assign) and isinstance(child.value, ast.Lambda):
            bound.update((target.id, child.value) for target in child.targets if isinstance(target, ast.Name))
    return bound


def _requested(node: ast.AST, call: str) -> Iterator[str]:
    """Every fixture name a `call` call inside `node` asks for, which has to be a string literal to be read at all."""
    for found in (node, *_run_by(node)):
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


def _parameters(node: FunctionNode, in_class: bool) -> list[str]:
    """The arguments pytest fills from a fixture, as its `getfuncargnames` reads a signature.

    Neither a positional-only argument, nor one carrying a default, nor a method's first is asked for.
    """
    args = node.args
    positional = [*args.posonlyargs, *args.args]
    defaulted = set(map(id, positional[len(positional) - len(args.defaults) :]))
    named = [arg for arg in args.args if id(arg) not in defaulted]
    named += [arg for arg, default in zip(args.kwonlyargs, args.kw_defaults, strict=True) if default is None]
    static = any(isinstance(decorator, ast.Name) and decorator.id == "staticmethod" for decorator in node.decorator_list)
    if in_class and not static and not args.posonlyargs:
        named = named[1:]
    return [arg.arg for arg in named]


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
        # Each nested function and lambda, keyed to the one that defines it, for `_enclosed` to climb.
        self.enclosing: dict[int, CalledNode] = {
            id(nested): outer
            for module in self.modules
            for outer in ast.walk(module.tree)
            if isinstance(outer, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda))
            for nested in _run_by(outer)
            if isinstance(nested, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda))
        }
        # Each place a fixture is supplied, and the name pytest registers it under there.
        self.scopes: dict[int, list[tuple[Scope, str]]] = {
            id(definition): [(definition.scope, definition.name)] for module in self.modules for definition in module.definitions
        }
        self.requests: list[Request] = []
        # What `_ask_through_calls` reads off a node, which answers the same for every root reaching it,
        # so each node is read once rather than once a root.
        self._bound_by: dict[ast.AST, dict[str, CalledNode]] = {}
        self._callees_of: dict[ast.AST, tuple[tuple[Module, CalledNode], ...]] = {}
        self._asked_by: dict[ast.AST, tuple[tuple[str, ...], Unfollowed | None]] = {}
        # Every scope is widened before any request is read, a fixture's own requests being made from all of them.
        for step in (self._supply_imports, self._request):
            for module in self.modules:
                try:
                    step(module)
                except Unfollowed as error:
                    self.unfollowed.append((module.path, str(error)))
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

    def _enclosed(self, node: CalledNode, name: str) -> CalledNode | None:
        """The function or lambda `name` is bound to where `node` is defined: by `node` itself, or by a function enclosing it."""
        scope: CalledNode | None = node
        while scope is not None:
            if scope not in self._bound_by:
                self._bound_by[scope] = _nested(scope)
            if (bound := self._bound_by[scope].get(name)) is not None:
                return bound
            scope = self.enclosing.get(id(scope))
        return None

    def _callees(self, module: Module, node: CalledNode) -> tuple[tuple[Module, CalledNode], ...]:
        """The estate's own functions `node` calls by a name its module binds: its own, or one it imports.

        And each nested function or lambda it calls by the name it or an enclosing function binds one to.
        """
        if node not in self._callees_of:
            self._callees_of[node] = tuple(self._calls_from(module, node))
        return self._callees_of[node]

    def _calls_from(self, module: Module, node: CalledNode) -> Iterator[tuple[Module, CalledNode]]:
        for call in _run_by(node):
            if not isinstance(call, ast.Call):
                continue
            target = call.func
            if isinstance(target, ast.Name):
                if (nested := self._enclosed(node, target.id)) is not None:
                    yield module, nested
                elif target.id in module.functions:
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

    def _definition_of(self, module: Module, name: str) -> Definition | None:
        """The fixture a module-level function of `module` defines, where it defines one."""
        node = module.functions.get(name)
        return next((definition for definition in module.definitions if definition.node is node), None)

    def _supply_imports(self, module: Module) -> None:
        """Widen a fixture's scope to every module binding it, and the whole estate where a plugin entry names its module."""
        here = Scope(module.path.parent, True) if module.path.name == CONFTEST else Scope(module.path, False)
        bound = [(alias, self._module(module, source_name), name) for alias, (source_name, name) in module.imports.items() if name is not None]
        for node in module.tree.body:
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Name):
                bound += [(target.id, module, node.value.id) for target in node.targets if isinstance(target, ast.Name)]
        for alias, source, name in bound:
            definition = None if source is None else self._definition_of(source, name)
            if definition is not None:
                # pytest registers a module's fixture under the attribute holding it, its `name=` excepted
                # (its `parsefactories`, read at release 9.1.1), so an alias is a name of its own.
                self.scopes[id(definition)].append((here, definition.name if definition.named else alias))
        for node in module.tree.body:
            if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == PLUGINS for target in node.targets):
                for entry in _literal_names(node.value, node.lineno):
                    plugin = self._module(module, entry)
                    for definition in [] if plugin is None else plugin.definitions:
                        self.scopes[id(definition)].append((Scope(self.root, True), definition.name))

    def _request(self, module: Module) -> None:
        """Every request a test or a fixture of `module` makes: its arguments pytest fills, and its `usefixtures` marks."""
        for test in module.tests:
            where = Scope(module.path, False, test.classes)
            supplied = _supplied(test.marks)
            names = [name for name in _parameters(test.node, bool(test.classes)) if name not in supplied]
            names += [name for mark in test.marks for name in _requested(mark, USEFIXTURES_MARK)]
            self.requests.extend(Request(name, where, True, None) for name in names)
        for definition in module.definitions:
            for name in _parameters(definition.node, definition.in_class):
                self.requests.extend(Request(name, scope, False, id(definition)) for scope, _ in self.scopes[id(definition)])

    def _ask_through_calls(self) -> None:
        """Every `getfixturevalue` string in a function a test or a fixture runs or reaches by calling it.

        An uncalled one excuses no fixture; a reached one asks from where its test or fixture stands.
        """
        roots: list[tuple[Module, CalledNode, Scope, bool, int | None]] = [
            (module, test.node, Scope(module.path, False, test.classes), True, None) for module in self.modules for test in module.tests
        ]
        roots += [
            (module, definition.node, scope, False, id(definition))
            for module in self.modules
            for definition in module.definitions
            for scope, _ in self.scopes[id(definition)]
        ]
        # Keyed by everything a request records, the asking fixture included: keyed without it, a helper
        # two fixtures reach asks only for the first, and a fixture the second consumes reads as dead.
        reached: set[tuple[int, Scope, bool, int | None]] = set()

        # Recursive rather than a loop over a pending list: with the `reached` check gone, a helper
        # calling itself overflows the stack and fails the run, where a loop would hang it.
        def ask(module: Module, node: CalledNode, where: Scope, point: bool, origin: int | None) -> None:
            if (id(node), where, point, origin) in reached:
                return
            reached.add((id(node), where, point, origin))
            names, refusal = self._asked(node)
            self.requests.extend(Request(name, where, point, origin) for name in names)
            if refusal is not None:
                self.unfollowed.append((module.path, str(refusal)))
            for callee_module, callee in self._callees(module, node):
                ask(callee_module, callee, where, point, origin)

        for root in roots:
            ask(*root)

    def _asked(self, node: CalledNode) -> tuple[tuple[str, ...], Unfollowed | None]:
        """Every `getfixturevalue` name `node` asks for, up to the first it cannot read, and the refusal that one raised."""
        if node not in self._asked_by:
            names: list[str] = []
            refusal: Unfollowed | None = None
            try:
                names.extend(_requested(node, GETFIXTUREVALUE))
            except Unfollowed as error:
                refusal = error
            self._asked_by[node] = (tuple(names), refusal)
        return self._asked_by[node]

    def consumed(self, definition: Definition, configured: frozenset[str] = frozenset()) -> bool:
        """Whether any request pytest would answer with this fixture names it, a fixture's own name inside it excepted.

        A fixture asking for its own name is handed the one it overrides, never itself.
        """
        supplied = self.scopes[id(definition)]
        if any(name in configured for _, name in supplied):
            return True
        for request in self.requests:
            if request.origin == id(definition):
                continue
            for scope, name in supplied:
                if name != request.name:
                    continue
                reaches = scope.holds(request.scope.path, request.scope.classes) if request.point else scope.meets(request.scope)
                if reaches and not self._shadowed(definition, scope, request):
                    return True
        return False

    def _shadowed(self, definition: Definition, scope: Scope, request: Request) -> bool:
        """Whether another fixture of the request's name, nearer than `scope`, supplies everywhere both `scope` and the request reach.

        pytest hands a test the nearest one alone; only the asker's own name reaches past it, to the one it overrides.
        """
        where = scope.narrower(request.scope)
        return any(
            name == request.name and other.covers(where) and other.nearer_than(scope)
            for owner, supplied in self.scopes.items()
            if owner not in (id(definition), request.origin)
            for other, name in supplied
        )


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
    findings: list[Finding] = []
    for module in estate.modules:
        for definition in module.definitions:
            if definition.autouse or estate.consumed(definition, configured):
                continue
            where = f"{_shown(module.path)}:{definition.node.lineno}"
            findings.append(Finding("fail", f"{where} fixture `{definition.name}` is consumed by no test and no other fixture it reaches"))
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

    fixtures = sum(len(module.definitions) for module in estate.modules)
    print(f"      {len(estate.modules)} module(s) under {_shown(TESTS)}: {fixtures} fixture(s)")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
