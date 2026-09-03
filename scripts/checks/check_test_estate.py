"""SCRIPTS · the backend suite answers loudly when a guarantee stops holding.

Three ways a suite goes quiet without going red, and nothing else here catches any of them: a test
reaching a database in the tier that starts no container, a discovered parametrize list that found
nothing, and a fixture no test consumes. Each is a green run over a guarantee that has stopped
being checked, which is worse than a red one.

The first two rules are the ones a session can break by hand; the third is what a deletion leaves
behind.
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

# The driver, constructed anywhere: every route into a real server goes through one of these two.
DRIVERS: Final = frozenset({"MongoClient", "AsyncMongoClient"})

# A container starter is an import, never a call: `conftest.py` imports testcontainers inside the
# function so the default tier never pays for the package.
CONTAINER_PACKAGE: Final = "testcontainers"

# What a fixture is asked for by name rather than by parameter. Both take the name as a string, so
# a fixture reached only this way looks unconsumed to a parameter sweep.
BY_NAME: Final = frozenset({"usefixtures", "getfixturevalue"})

# The values that turn an empty parametrize into a failure. `skip` is pytest's default and the one
# this rule exists to refuse; `xfail` reports a pass, which is the same silence.
LOUD_EMPTY_MARKS: Final = frozenset({"fail_at_collect"})
EMPTY_MARK_KEY: Final = "empty_parameter_set_mark"


class Module:
    """One parsed test module: what it defines, what it imports, and how it is marked."""

    def __init__(self, path: Path, dotted: str, tree: ast.Module) -> None:
        self.path = path
        self.dotted = dotted
        self.tree = tree
        self.functions: dict[str, FunctionNode] = {}
        self.fixtures: dict[str, FunctionNode] = {}
        self.autouse: set[str] = set()
        self.tests: list[tuple[str, FunctionNode, bool]] = []
        # A module-level name bound to a `mongodb://` string is a URI written into the source,
        # which by construction is not a server this suite starts.
        self.literal_uris: set[str] = set()
        self.imports: dict[str, str] = {}
        self._read()

    def _read(self) -> None:
        for node in self.tree.body:
            if isinstance(node, ast.ImportFrom) and node.module:
                for alias in node.names:
                    self.imports[alias.asname or alias.name] = node.module
            elif isinstance(node, ast.Assign):
                self._read_binding(node.targets, node.value)
            elif isinstance(node, ast.AnnAssign) and node.value is not None:
                self._read_binding([node.target], node.value)

        marked = self._module_marked()
        for node in self.tree.body:
            self._collect(node, prefix="", marked=marked)

    def _read_binding(self, targets: list[ast.expr], value: ast.expr) -> None:
        for target in targets:
            if isinstance(target, ast.Name) and isinstance(value, ast.Constant) and isinstance(value.value, str):
                if value.value.startswith("mongodb://") or value.value.startswith("mongodb+srv://"):
                    self.literal_uris.add(target.id)

    def _module_marked(self) -> bool:
        for node in self.tree.body:
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "pytestmark" for t in node.targets):
                if _names_the_db_mark(node.value):
                    return True
        return False

    def _collect(self, node: ast.stmt, *, prefix: str, marked: bool) -> None:
        """Every function this module defines, at any class depth, and every test among them."""
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            self.functions.setdefault(node.name, node)
            fixture = _fixture_decorator(node)
            if fixture is not None:
                self.fixtures.setdefault(node.name, node)
                if _is_autouse(fixture):
                    self.autouse.add(node.name)
            if node.name.startswith("test_"):
                own = marked or any(_names_the_db_mark(d) for d in node.decorator_list)
                self.tests.append((f"{prefix}{node.name}", node, own))
            return
        if isinstance(node, ast.ClassDef):
            inherited = marked or any(_names_the_db_mark(d) for d in node.decorator_list)
            # Both passes over the body, because a `pytestmark` written below a method still marks it.
            inherited = inherited or any(_class_pytestmark(stmt) for stmt in node.body)
            for stmt in node.body:
                self._collect(stmt, prefix=f"{prefix}{node.name}::", marked=inherited)


def _class_pytestmark(stmt: ast.stmt) -> bool:
    if isinstance(stmt, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "pytestmark" for t in stmt.targets):
        return _names_the_db_mark(stmt.value)
    return False


def _names_the_db_mark(node: ast.expr) -> bool:
    """Whether this decorator or `pytestmark` value carries `pytest.mark.db`."""
    for child in ast.walk(node):
        if isinstance(child, ast.Attribute) and child.attr == "db":
            if isinstance(child.value, ast.Attribute) and child.value.attr == "mark":
                return True
    return False


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


def _referenced(node: ast.AST) -> set[str]:
    """Every bare name and attribute under this node — what its body could be calling."""
    found: set[str] = set()
    for child in ast.walk(node):
        if isinstance(child, ast.Name):
            found.add(child.id)
        elif isinstance(child, ast.Attribute):
            found.add(child.attr)
    return found


def _named_fixtures(calls: list[ast.Call]) -> set[str]:
    """Fixtures these calls ask for by string rather than by parameter."""
    found: set[str] = set()
    for call in calls:
        if _called_name(call) in BY_NAME:
            found.update(arg.value for arg in call.args if isinstance(arg, ast.Constant) and isinstance(arg.value, str))
    return found


def _called_name(node: ast.Call) -> str:
    target = node.func
    if isinstance(target, ast.Attribute):
        return target.attr
    return target.id if isinstance(target, ast.Name) else ""


def _builds_a_real_client(calls: list[ast.Call], module: Module, literal: frozenset[str]) -> bool:
    """A driver construction this suite has to start a server for.

    Structural rather than a port number: what releases a URI is being written into the source,
    never the port it names.
    """
    for child in calls:
        if _called_name(child) not in DRIVERS:
            continue
        host = next((kw.value for kw in child.keywords if kw.arg == "host"), None)
        if host is None and child.args:
            host = child.args[0]
        if host is None:
            return True
        if isinstance(host, ast.Constant) and isinstance(host.value, str):
            continue
        if isinstance(host, ast.Name) and (host.id in module.literal_uris or host.id in literal):
            continue
        return True
    return False


def _is_literal_uri(node: ast.expr, module: Module, literal: frozenset[str]) -> bool:
    if isinstance(node, ast.Constant):
        return isinstance(node.value, str)
    return isinstance(node, ast.Name) and (node.id in module.literal_uris or node.id in literal)


def _bindings(call: ast.Call, callee: FunctionNode, module: Module, literal: frozenset[str]) -> frozenset[str]:
    """Which of the callee's parameters this call site hands a source-written URI.

    Without it the exemption stops at the caller, and these suites pass that constant into a
    helper rather than building the client in place.
    """
    names = _parameters(callee)
    bound = {name for name, arg in zip(names, call.args, strict=False) if _is_literal_uri(arg, module, literal)}
    bound.update(kw.arg for kw in call.keywords if kw.arg in names and _is_literal_uri(kw.value, module, literal))
    return frozenset(bound)


def _imports_a_container(node: ast.AST) -> bool:
    for child in ast.walk(node):
        if isinstance(child, ast.ImportFrom) and child.module and child.module.split(".")[0] == CONTAINER_PACKAGE:
            return True
        if isinstance(child, ast.Import) and any(alias.name.split(".")[0] == CONTAINER_PACKAGE for alias in child.names):
            return True
    return False


class Estate:
    """Every module under `tests/`, and the reach questions answered across them."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.modules: dict[str, Module] = {}
        self.by_path: dict[Path, Module] = {}
        for path in sorted(root.rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            tree = ast.parse(path.read_bytes().decode("utf-8"), filename=str(path))
            dotted = ".".join(("tests", *path.relative_to(root).with_suffix("").parts))
            module = Module(path, dotted, tree)
            self.modules[dotted] = module
            self.by_path[path] = module
        # A confirmed reach is the same answer wherever it is asked from, so it is kept; a False is
        # not, the recursion guard below cutting a walk short with an answer true of that path only.
        self._reaches: set[tuple[str, int, frozenset[str]]] = set()
        self._calls: dict[tuple[str, int], list[ast.Call]] = {}
        self._names: dict[tuple[str, int], set[str]] = {}

    def _body(self, node: FunctionNode, module: Module) -> tuple[list[ast.Call], set[str]]:
        """This function's calls and the names it mentions, walked once for the whole run."""
        key = (module.dotted, node.lineno)
        calls = self._calls.get(key)
        if calls is None:
            calls = [child for child in ast.walk(node) if isinstance(child, ast.Call)]
            self._calls[key] = calls
            # The string routes belong here too: a fixture named in `usefixtures` or fetched
            # through `getfixturevalue` is reached without ever appearing as a parameter.
            self._names[key] = _referenced(node) | set(_parameters(node)) | _named_fixtures(calls)
        return calls, self._names[key]

    def conftest_chain(self, module: Module) -> list[Module]:
        """The conftests a module's fixtures resolve through, nearest first."""
        chain: list[Module] = []
        directory = module.path.parent
        while True:
            conftest = self.by_path.get(directory / "conftest.py")
            if conftest is not None and conftest is not module:
                chain.append(conftest)
            if directory == self.root:
                break
            directory = directory.parent
        return chain

    def resolve(self, name: str, module: Module) -> tuple[FunctionNode, Module] | None:
        """Where a name a function mentions is defined — its own module, an import, or a conftest."""
        own = module.functions.get(name)
        if own is not None:
            return own, module
        source = self.modules.get(module.imports.get(name, ""))
        if source is not None and name in source.functions:
            return source.functions[name], source
        for conftest in self.conftest_chain(module):
            target = conftest.functions.get(name)
            if target is not None:
                return target, conftest
        return None

    def reaches_a_database(
        self,
        node: FunctionNode,
        module: Module,
        seen: set[tuple[str, int, frozenset[str]]],
        literal: frozenset[str] = frozenset(),
    ) -> bool:
        """Whether this function needs a server, through its own body, a helper, or a fixture."""
        key = (module.dotted, node.lineno, literal)
        if key in self._reaches:
            return True
        if key in seen:
            return False
        seen.add(key)

        calls, names = self._body(node, module)
        if _builds_a_real_client(calls, module, literal) or _imports_a_container(node):
            self._reaches.add(key)
            return True

        # Calls first, so a helper handed a source-written URI is judged under that binding rather
        # than under its own signature.
        called: set[str] = set()
        for child in calls:
            name = _called_name(child)
            called.add(name)
            found = self.resolve(name, module)
            if found is None or found[0] is node:
                continue
            if self.reaches_a_database(found[0], found[1], seen, _bindings(child, found[0], module, literal)):
                self._reaches.add(key)
                return True

        # A fixture is taken as a parameter and a helper can be passed rather than called, so the
        # remaining names are resolved with nothing bound.
        for candidate in names - called - literal:
            found = self.resolve(candidate, module)
            if found is None or found[0] is node:
                continue
            if self.reaches_a_database(found[0], found[1], seen):
                self._reaches.add(key)
                return True
        return False

    def consumed_names(self) -> set[str]:
        """Every fixture name something asks for — as a parameter, or by string."""
        asked: set[str] = set()
        for module in self.modules.values():
            for node in ast.walk(module.tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    asked.update(_parameters(node))
                elif isinstance(node, ast.Call):
                    target = node.func
                    name = target.attr if isinstance(target, ast.Attribute) else (target.id if isinstance(target, ast.Name) else "")
                    if name in BY_NAME:
                        asked.update(arg.value for arg in node.args if isinstance(arg, ast.Constant) and isinstance(arg.value, str))
        return asked


def check_db_markers(estate: Estate) -> list[Finding]:
    """A test reaching a server without the marker runs in the tier that starts none."""
    findings: list[Finding] = []
    for module in estate.modules.values():
        for qualname, node, marked in module.tests:
            if marked or not estate.reaches_a_database(node, module, set()):
                continue
            detail = f"{_shown(module.path)}:{node.lineno} {qualname} reaches a database and carries no `@pytest.mark.db`"
            findings.append(Finding("fail", detail))
    return findings


def check_dead_fixtures(estate: Estate) -> list[Finding]:
    """A fixture nothing consumes is a guarantee that was deleted from one end only."""
    asked = estate.consumed_names()
    findings: list[Finding] = []
    for module in estate.modules.values():
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
    findings = [*check_empty_parametrize(), *check_db_markers(estate), *check_dead_fixtures(estate)]
    code = report_findings(findings)

    tests = sum(len(module.tests) for module in estate.modules.values())
    fixtures = sum(len(module.fixtures) for module in estate.modules.values())
    print(f"      {len(estate.modules)} module(s) under {_shown(TESTS)}: {tests} test(s), {fixtures} fixture(s)")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
