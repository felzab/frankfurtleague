"""SCRIPTS · the platform-branch clauses and the text-mode write clause, over scripts and hooks.

A branch on the platform is made visible statically here; a platform-conditional EFFECT -- a
syscall that no-ops, a filesystem that resolves case-blind -- carries no predicate in the source,
and only the Linux run in CI proves it. Every deliberate branch is a row of `PLATFORM_ALLOW`, keyed
by a COR-6 anchor and carrying its reason, so writing one is a visible diff in a table rather than
an `if` nobody re-reads. The write clause reads the call, never the file it produces
(`.claude/CLAUDE.md` §6).
"""

from __future__ import annotations

import ast
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from typing import Final

from .kernel import REPO_ROOT, UNPARSEABLE, Finding, _read_text, scanned_files

PLATFORM_CHECK: Final = "platform-branch"
CRLF_CHECK: Final = "crlf-write"

# The backend is in: the write clause's trap is not the gate's alone, and a test there writes
# fixtures a shell reads.
PYTHON_SCOPES: Final[tuple[str, ...]] = ("scripts/", "fl_backend/app/", "fl_backend/tests/")
TEST_SCOPES: Final[tuple[str, ...]] = ("scripts/tests/", "fl_backend/tests/")
# `.githooks/` by folder: a hook carries no suffix.
SHELL_SCOPES: Final[tuple[str, ...]] = ("scripts/", ".claude/hooks/")
GIT_HOOKS_DIR: Final = ".githooks/"

# Matched on the chain's TAIL, so a driver's `gate_pool.sys.platform` is read as the predicate it
# rebinds.
ATTRIBUTE_PREDICATES: Final[frozenset[tuple[str, str]]] = frozenset({("sys", "platform"), ("os", "name")})
CALL_PREDICATES: Final[frozenset[tuple[str, str]]] = frozenset({("platform", "system"), ("platform", "machine")})
# Per predicate PLAT-3 can hold: a call has no value to rebind, so an allowlisted
# `platform.system()` owes no PLAT-3 half.
WINDOWS_VALUE: Final[dict[str, str]] = {"sys.platform": "win32", "os.name": "nt"}

PREDICATE_TEXT_RE: Final = re.compile(r"\bsys\.platform\b|\bos\.name\b|\bplatform\.(?:system|machine)\(")
IF_LINE_RE: Final = re.compile(r"^\s*(?:if|elif)\b(.*?):\s*(.*)$")
STAND_DOWN_RE: Final = re.compile(r"^\s*(?:return\b|raise\s+SystemExit\b|sys\.exit\(|pytest\.skip\()")
SKIP_MARK_RE: Final = re.compile(r"\bmark\.(?:skipif|skip|xfail)\b")
BOTH_ARMS: Final = "bind the platform as a value so both arms run everywhere"

# Code only: a comment naming `cygpath` explains a branch rather than being one.
SHELL_TOKEN_RE: Final = re.compile(r"(?<![\w-])(?:uname|cygpath)\b|\$\{?(?:OSTYPE|MSYSTEM)\b|\bMSYS_NO_PATHCONV\b")
SHELL_FUNCTION_RE: Final = re.compile(r"^([A-Za-z_]\w*)\s*\(\)\s*\{(.*)$")
SHELL_CLOSE_RE: Final = re.compile(r"^\}")
SHELL_ASSIGN_RE: Final = re.compile(r"^\s*(?:local\s+|export\s+|readonly\s+|declare\s+-\S+\s+)?([A-Za-z_]\w*)=")
SHELL_STEP_RE: Final = re.compile(r'^\s*step\s+"([^"]+)"')
# The repository's `<label> - <detail>` shape, the dash escaped to keep this file ASCII; the label
# in front is what a row anchors on.
LABEL_SPLIT: Final = " \u2014 "

# `Path.open` takes the mode first, the modules listed take a path first. `tempfile` defaults to
# binary, so only a spelled mode counts.
MODE_SECOND: Final[frozenset[str]] = frozenset({"io", "builtins", "codecs", "gzip", "bz2", "lzma"})
TEMPFILE_OPENERS: Final[dict[str, int]] = {"NamedTemporaryFile": 0, "TemporaryFile": 0, "SpooledTemporaryFile": 1}
WRITING_MODE_RE: Final = re.compile(r"^[rwaxt+]*[wax+][rwaxt+]*$")
WRITE_REMEDY: Final = 'pass newline="" or write bytes'

# Keyed by an anchor the file spells WHOLE -- an enclosing function, an assigned name, a `step` or
# message label, or the line itself -- never a fragment.
PLATFORM_ALLOW: Final[dict[str, str]] = {
    "scripts/gate_pool.py :: terminate": "reads `sys.platform` per call rather than `POSIX`: the one spelling pyright narrows `os.killpg` on",
    "scripts/tests/test_gate_pool.py :: OWN_GROUP": "a unit's group is compared to its pid on POSIX alone, so the case stands down elsewhere",
    "scripts/_lib.sh :: require_platform": "the one `uname -s` that classifies the host, which every machine-specific script declares through",
    "scripts/selfcheck.sh :: mount_source": "`cygpath` for Git Bash's /tmp mount, which a POSIX spelling binds to an unrelated directory",
    "scripts/selfcheck.sh :: run_shellcheck": "MSYS rewrites the container-side mount path unless told not to",
    "scripts/selfcheck.sh :: run_actionlint": "the same rewrite, in front of the actionlint image",
    "scripts/selfcheck.sh :: compose guard: behind an env assignment": "a probe's command TEXT, proving the compose guard sees through it",
    'scripts/selfcheck.sh :: case "$(uname -s)" in': "the hook probes only a Windows path spelling can separate run on Windows alone",
    "scripts/selfcheck.sh :: the Windows-only path spellings were not probed": "that case's other arm, naming what a Linux run left unproven",
    "scripts/verify.sh :: POOL_BASH": "`cygpath -w` so a Windows python can launch the parent's own bash",
    "scripts/verify.sh :: ops · nginx accepts prod.conf": "MSYS rewrites the container-side path of the nginx config mount",
    "scripts/local.sh :: take_dump": "MSYS rewrites the container-side `/dump` mount",
    "scripts/local.sh :: restore_dump": "MSYS rewrites `/dump` on the way into the container",
    "scripts/local.sh :: dump_collections_seen": "MSYS rewrites `/dump` in the container-side find",
    ".githooks/pre-commit :: work": "`cygpath -w` for mktemp's MSYS alias, which `git hash-object` cannot open from a worktree",
}

# Keyed like `PLATFORM_ALLOW`; the value is why the stream may translate.
TEXT_WRITE_ALLOW: Final[dict[str, str]] = {}


@dataclass(frozen=True)
class _Site:
    rel: str
    line: int
    detail: str
    # Empty leaves the site unshieldable by design.
    candidates: tuple[str, ...] = ()


@dataclass
class _Scan:
    """PLAT-1's sites, and what PLAT-3 reads."""

    sites: list[_Site] = field(default_factory=list)
    constants: list[tuple[str, str, int]] = field(default_factory=list)
    predicates: list[tuple[str, str, int]] = field(default_factory=list)


def _rel(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def _line(node: ast.AST) -> int:
    return int(getattr(node, "lineno", 0))


@cache
def _python_files() -> tuple[Path, ...]:
    """The Python corpus, listed by kind and prefix and never by what it contains (PRE-4)."""
    return tuple(p for p in scanned_files() if p.suffix == ".py" and _rel(p).startswith(PYTHON_SCOPES))


@cache
def _test_files() -> tuple[Path, ...]:
    return tuple(p for p in _python_files() if _rel(p).startswith(TEST_SCOPES))


@cache
def _shell_files() -> tuple[Path, ...]:
    return tuple(p for p in scanned_files() if (p.suffix == ".sh" and _rel(p).startswith(SHELL_SCOPES)) or _rel(p).startswith(GIT_HOOKS_DIR))


@cache
def _source_lines(path: Path) -> tuple[str, ...] | None:
    text = _read_text(path)[0]
    return None if text is None else tuple(text.split("\n"))


@cache
def _tree(path: Path) -> ast.Module | None:
    """None where it will not parse, which ruff reports."""
    text = _read_text(path)[0]
    if text is None:
        return None
    try:
        return ast.parse(text)
    except UNPARSEABLE:
        return None


def _tail_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Call):
        return _tail_name(node.func)
    return ""


def _predicate(node: ast.AST) -> str | None:
    if isinstance(node, ast.Attribute) and (_tail_name(node.value), node.attr) in ATTRIBUTE_PREDICATES:
        return f"{_tail_name(node.value)}.{node.attr}"
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
        head = _tail_name(node.func.value)
        if (head, node.func.attr) in CALL_PREDICATES:
            return f"{head}.{node.func.attr}()"
    if isinstance(node, ast.ImportFrom) and node.module in ("sys", "os"):
        for alias in node.names:
            if (node.module, alias.name) in ATTRIBUTE_PREDICATES:
                return f"{node.module}.{alias.name}"
    return None


def _is_final_constant(node: ast.AST) -> str | None:
    """PLAT-1's admitted shape."""
    if not isinstance(node, ast.AnnAssign) or node.value is None or not isinstance(node.target, ast.Name):
        return None
    annotation = node.annotation
    head = annotation.value if isinstance(annotation, ast.Subscript) else annotation
    if _tail_name(head) != "Final" or not node.target.id.isupper():
        return None
    return node.target.id


def _assigned_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        return node.target.id
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        return node.targets[0].id
    return None


def _snippet_lines(node: ast.AST) -> list[str] | None:
    value = getattr(node, "value", None)
    if not isinstance(value, (ast.Tuple, ast.List)) or not value.elts:
        return None
    if not all(isinstance(elt, ast.Constant) and isinstance(elt.value, str) for elt in value.elts):
        return None
    return [str(elt.value) for elt in value.elts if isinstance(elt, ast.Constant)]


def _mentions(node: ast.AST, names: frozenset[str]) -> bool:
    for sub in ast.walk(node):
        if _predicate(sub) is not None:
            return True
        if isinstance(sub, ast.Name) and sub.id in names:
            return True
        if isinstance(sub, ast.Attribute) and sub.attr in names:
            return True
    return False


def _mentions_text(text: str, names: frozenset[str]) -> bool:
    return bool(PREDICATE_TEXT_RE.search(text)) or any(re.search(r"\b" + re.escape(name) + r"\b", text) for name in names)


def _quoted(code: str) -> list[str]:
    """Left to right, so the two quote kinds cannot cross."""
    found: list[str] = []
    index = 0
    while index < len(code):
        quote = code[index]
        if quote in "\"'":
            close = code.find(quote, index + 1)
            if close == -1:
                break
            found.append(code[index + 1 : close])
            index = close + 1
        else:
            index += 1
    return found


def _anchors(enclosing: Iterable[str], code: str) -> tuple[str, ...]:
    """Every anchor a row may name for a site, each spelled whole by the line or by its scope.

    A quoted argument is the label `step` anchors on, read wherever it sits; the line itself is
    the last resort, for a branch nothing named encloses.
    """
    found = list(enclosing)
    for quoted in _quoted(code):
        found.append(quoted)
        label, separator, _ = quoted.partition(LABEL_SPLIT)
        if separator:
            found.append(label)
    found.append(code.strip())
    # A platform token anchors nothing: a row spelling one would excuse its every use in the file.
    return tuple(dict.fromkeys(name for name in found if name and not SHELL_TOKEN_RE.fullmatch(name)))


def _site(rel: str, line: int, symbol: str, detail: str, source: Sequence[str]) -> _Site:
    code = source[line - 1] if 0 < line <= len(source) else ""
    return _Site(rel, line, detail, _anchors((symbol,), code))


def _scan_module(rel: str, tree: ast.Module, source: Sequence[str], scan: _Scan, allow: Mapping[str, str]) -> None:
    """PLAT-1 over one module: a predicate read outside the admitted shapes is a site."""

    def visit(node: ast.AST, scope: str) -> None:
        for child in ast.iter_child_nodes(node):
            if not scope and (constant := _is_final_constant(child)) is not None:
                if any(_predicate(sub) is not None for sub in ast.walk(child)):
                    scan.constants.append((rel, constant, _line(child)))
                continue
            symbol = scope
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                symbol = child.name
            elif not scope and (name := _assigned_name(child)) is not None:
                symbol = name
            predicate = _predicate(child)
            # A Store context is a driver rebinding the predicate, which is PLAT-3's shape and not
            # a branch.
            if predicate is not None and not (isinstance(child, ast.Attribute) and isinstance(child.ctx, ast.Store)):
                detail = f"PLAT-1: `{predicate}` read in `{symbol or rel}` -- bind the platform once as an UPPER_CASE Final, or allowlist it"
                scan.sites.append(_site(rel, _line(child), symbol, detail, source))
                if f"{rel} :: {symbol}" in allow:
                    scan.predicates.append((rel, predicate.removesuffix("()"), _line(child)))
            visit(child, symbol)

    visit(tree, "")


def _scan_tests(rel: str, tree: ast.Module, source: Sequence[str], names: frozenset[str]) -> list[_Site]:
    """PLAT-2 over one test module: a skip, an early return or a raise guarded by the platform."""
    found: list[_Site] = []

    def visit(node: ast.AST, scope: str) -> None:
        for child in ast.iter_child_nodes(node):
            symbol = scope
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                symbol = child.name
                for decorator in child.decorator_list:
                    spelled = ast.unparse(decorator)
                    if SKIP_MARK_RE.search(spelled) and _mentions(decorator, names):
                        detail = f"PLAT-2: `{symbol}` is skipped on the platform ({spelled}) -- {BOTH_ARMS}"
                        found.append(_site(rel, decorator.lineno, symbol, detail, source))
            elif not scope and (name := _assigned_name(child)) is not None:
                symbol = name
                lines = _snippet_lines(child)
                if lines is not None and _snippet_stands_down(lines, names):
                    detail = f"PLAT-2: the driver snippet `{symbol}` stands down on the platform -- {BOTH_ARMS}"
                    found.append(_site(rel, _line(child), symbol, detail, source))
            if isinstance(child, ast.If) and _mentions(child.test, names) and _stands_down(child.body):
                detail = f"PLAT-2: `{symbol or rel}` returns or exits when the platform says so -- {BOTH_ARMS}"
                found.append(_site(rel, child.lineno, symbol, detail, source))
            visit(child, symbol)

    visit(tree, "")
    return found


def _stands_down(body: list[ast.stmt]) -> bool:
    for statement in body:
        if isinstance(statement, (ast.Return, ast.Raise)):
            return True
        if isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Call) and _tail_name(statement.value.func) in ("skip", "exit"):
            return True
    return False


def _snippet_stands_down(lines: list[str], names: frozenset[str]) -> bool:
    """The text half of PLAT-2: a driver's `if <platform>:` followed by a return, an exit or a skip."""
    for index, line in enumerate(lines):
        if SKIP_MARK_RE.search(line) and _mentions_text(line, names):
            return True
        opened = IF_LINE_RE.match(line)
        if opened is None or not _mentions_text(opened.group(1), names):
            continue
        following = opened.group(2) or (lines[index + 1] if index + 1 < len(lines) else "")
        if STAND_DOWN_RE.match(following):
            return True
    return False


# Captured loose, so one pass answers for every name.
BINDING_RE: Final = re.compile(r"\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)\s*=\s*(True|False|['\"]\w+['\"])")


@cache
def _test_bindings() -> dict[str, frozenset[str]]:
    """Every dotted target the test corpus assigns a literal to, and the values it is given.

    One pass, the allowlist being what grows; each suffix of a chain is registered, matching what a
    word-boundary search reaches.
    """
    values: dict[str, set[str]] = {}
    for path in _test_files():
        text = _read_text(path)[0]
        if text is None:
            continue
        for chain, literal in BINDING_RE.findall(text):
            parts = chain.split(".")
            for start in range(len(parts) - 1):
                values.setdefault(".".join(parts[start:]), set()).add(literal.strip("'\""))
    return {target: frozenset(found) for target, found in values.items()}


def _bindings(module: str, name: str) -> frozenset[str]:
    return _test_bindings().get(f"{module}.{name}", frozenset())


def _both_values(scan: _Scan) -> list[_Site]:
    """PLAT-3: every admitted constant and allowlisted predicate is driven to both values by the tests.

    No row shields one of these: the remedy is a case binding the missing value.
    """
    found: list[_Site] = []
    for rel, name, line in scan.constants:
        module = Path(rel).stem
        bound = _bindings(module, name)
        for value in ("True", "False"):
            if value not in bound:
                detail = f"PLAT-3: no test binds `{module}.{name} = {value}`, so the arm it selects runs on one platform alone"
                found.append(_Site(rel, line, detail, ()))
    for rel, predicate, line in scan.predicates:
        if predicate not in WINDOWS_VALUE:
            continue
        module = Path(rel).stem
        bound = _bindings(module, predicate)
        windows = WINDOWS_VALUE[predicate]
        if windows not in bound:
            detail = f"PLAT-3: no test binds `{module}.{predicate} = '{windows}'`, so the Windows arm is executed on Windows alone"
            found.append(_Site(rel, line, detail, ()))
        if not (bound - {windows}):
            detail = f"PLAT-3: no test binds `{module}.{predicate}` to a value other than '{windows}', so the other arm runs off Windows alone"
            found.append(_Site(rel, line, detail, ()))
    return found


def _shell_code(line: str) -> str:
    """The code half of a shell line, read the way `scripts/docs_gate/kernel.py :: _shell_comments` reads the other half."""
    if line.lstrip().startswith("#"):
        return ""
    marker = line.find(" #")
    return line if marker == -1 else line[:marker]


def _scan_shell(rel: str, lines: Sequence[str]) -> list[_Site]:
    """PLAT-4 over one shell file: a platform token in code, anchored to what encloses it."""
    found: list[_Site] = []
    function = ""
    step = ""
    for number, raw in enumerate(lines, start=1):
        if (opened := SHELL_FUNCTION_RE.match(raw)) is not None:
            # A body closed on its own line encloses nothing below it.
            function = "" if "}" in opened.group(2) else opened.group(1)
        elif SHELL_CLOSE_RE.match(raw):
            function = ""
        if (labelled := SHELL_STEP_RE.match(raw)) is not None:
            step = labelled.group(1)
        code = _shell_code(raw)
        tokens = sorted(set(SHELL_TOKEN_RE.findall(code)))
        if not tokens:
            continue
        enclosing = [function, step]
        if (assigned := SHELL_ASSIGN_RE.match(code)) is not None:
            enclosing.insert(0, assigned.group(1))
        detail = f"PLAT-4: {', '.join(tokens)} in code outside the allowlist -- a shell platform branch is a `PLATFORM_ALLOW` row"
        found.append(_Site(rel, number, detail, _anchors(enclosing, code)))
    return found


def _row_for(site: _Site, allow: Mapping[str, str]) -> str | None:
    """The row excusing a site: the first whose anchor this site spells whole.

    Equality, never containment: `mount_source`'s row must not excuse a line that merely calls it,
    and a reworded line has to break its row loudly rather than re-point it.
    """
    prefix = site.rel + " :: "
    return next((key for key in allow if key.startswith(prefix) and key[len(prefix) :] in site.candidates), None)


def _resolve(check: str, sites: list[_Site], allow: Mapping[str, str], present: frozenset[str]) -> list[Finding]:
    """Findings for the sites no row shields, and for the rows the tree no longer bears out."""
    used: set[str] = set()
    findings: list[Finding] = []
    for site in sites:
        row = _row_for(site, allow)
        if row is None:
            findings.append(Finding("fail", check, site.rel, site.detail, site.line))
        else:
            used.add(row)
    for key in allow:
        rel, _, symbol = key.partition(" :: ")
        # Judged only inside the population this check read: a row naming a file the gate's own
        # fixture trees do not hold would read as stale inside each of them.
        if rel not in present:
            continue
        text = _read_text(REPO_ROOT / rel)[0] or ""
        if symbol not in text:
            findings.append(
                Finding("fail", check, rel, f"allowlist row `{key}` names a symbol the file no longer spells -- repoint or delete it")
            )
        elif key not in used:
            findings.append(
                Finding("fail", check, rel, f"allowlist row `{key}` shields no site -- what it excused is gone, so the row goes too")
            )
    return findings


def check_platform_branches(allow: Mapping[str, str] = PLATFORM_ALLOW) -> list[Finding]:
    """The clauses: a predicate read outside a constant, a test skip, a one-sided constant, a shell token.

    The population is every listed file of the kind under the prefixes, never the files mentioning
    a platform (PRE-4).
    """
    scan = _Scan()
    present: set[str] = set()
    for path in _python_files():
        tree = _tree(path)
        if tree is None:
            continue
        rel = _rel(path)
        present.add(rel)
        _scan_module(rel, tree, _source_lines(path) or (), scan, allow)
    names = frozenset(name for _, name, _ in scan.constants)
    sites = list(scan.sites)
    for path in _test_files():
        tree = _tree(path)
        if tree is not None and (rel := _rel(path)) in present:
            sites.extend(_scan_tests(rel, tree, _source_lines(path) or (), names))
    sites.extend(_both_values(scan))
    shell = _shell_files()
    for path in shell:
        if (lines := _source_lines(path)) is not None:
            sites.extend(_scan_shell(_rel(path), lines))
    present.update(_rel(path) for path in shell)
    return _resolve(PLATFORM_CHECK, sites, allow, frozenset(present))


def _mode_position(func: ast.expr) -> tuple[str, int] | None:
    if isinstance(func, ast.Name):
        if func.id == "open":
            return "open", 1
        if func.id in TEMPFILE_OPENERS:
            return func.id, TEMPFILE_OPENERS[func.id]
        return None
    if isinstance(func, ast.Attribute):
        head = _tail_name(func.value)
        if func.attr == "open":
            return f"{head}.open", 1 if head in MODE_SECOND else 0
        if func.attr == "fdopen":
            return f"{head}.fdopen", 1
        if func.attr in TEMPFILE_OPENERS:
            return f"{head}.{func.attr}", TEMPFILE_OPENERS[func.attr]
    return None


def _text_write(call: ast.Call) -> tuple[str, bool] | None:
    if isinstance(call.func, ast.Attribute) and call.func.attr == "write_text":
        return f"{_tail_name(call.func.value)}.write_text", True
    placed = _mode_position(call.func)
    if placed is None:
        return None
    callee, position = placed
    mode = next((keyword.value for keyword in call.keywords if keyword.arg == "mode"), None)
    if mode is None and len(call.args) > position:
        mode = call.args[position]
    if mode is None:
        return None
    if isinstance(mode, ast.Constant) and isinstance(mode.value, str):
        return (callee, True) if WRITING_MODE_RE.match(mode.value) else None
    return callee, False


def _newline_passed(call: ast.Call) -> bool | None:
    keyword = next((keyword for keyword in call.keywords if keyword.arg == "newline"), None)
    if keyword is None:
        return None
    value = keyword.value
    if isinstance(value, ast.Constant) and value.value in ("", "\n"):
        return True
    if isinstance(value, ast.Call) and _tail_name(value.func) == "chr" and value.args:
        first = value.args[0]
        return isinstance(first, ast.Constant) and first.value == 10
    return False


def _scan_writes(rel: str, tree: ast.Module, source: Sequence[str]) -> list[_Site]:
    """The write clause over one module: every text-mode opener, judged on the call alone."""
    found: list[_Site] = []

    def visit(node: ast.AST, scope: str) -> None:
        for child in ast.iter_child_nodes(node):
            symbol = child.name if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) else scope
            if isinstance(child, ast.Call) and (write := _text_write(child)) is not None:
                callee, readable = write
                passed = _newline_passed(child)
                if not readable:
                    detail = f"`{callee}` opens with a mode the clause cannot read -- spell the mode as a literal, or allowlist the anchor"
                    found.append(_site(rel, child.lineno, symbol, detail, source))
                elif passed is None:
                    detail = f'text-mode write `{callee}` without newline="" -- on Windows the stream turns every LF into CRLF; {WRITE_REMEDY}'
                    found.append(_site(rel, child.lineno, symbol, detail, source))
                elif not passed:
                    detail = f'`{callee}` passes a newline other than "" or "\\n", so the stream still translates -- {WRITE_REMEDY}'
                    found.append(_site(rel, child.lineno, symbol, detail, source))
            visit(child, symbol)

    visit(tree, "")
    return found


def check_text_writes(allow: Mapping[str, str] = TEXT_WRITE_ALLOW) -> list[Finding]:
    """A text-mode write in the Python corpus passes `newline=""`, or is a row with its reason.

    A write through a redirected stdout is the shell's and leaves no call here to read; the clause
    holds what the interpreter's own text layer is seen to open.
    """
    sites: list[_Site] = []
    present: set[str] = set()
    for path in _python_files():
        tree = _tree(path)
        if tree is None:
            continue
        rel = _rel(path)
        present.add(rel)
        sites.extend(_scan_writes(rel, tree, _source_lines(path) or ()))
    return _resolve(CRLF_CHECK, sites, allow, frozenset(present))
