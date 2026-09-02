"""SCRIPTS · the platform-branch clauses and the text-mode write clause, over scripts and hooks.

A branch on the platform is made visible statically here; a platform-conditional EFFECT -- a
syscall that no-ops, a filesystem that resolves case-blind -- carries no predicate in the source,
and only the Linux run in CI proves it. Every deliberate branch is a row of `PLATFORM_ALLOW`, keyed
by a COR-6 anchor and carrying its reason, so writing one is a visible diff in a table rather than
an `if` nobody re-reads. The write clause reads the call and never the file it produces: a text
handle opened without `newline=""` writes CRLF on Windows, and git's normalisation hides that until
a Linux shell reads the file (`.claude/CLAUDE.md` §6).
"""

from __future__ import annotations

import ast
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from typing import Final

from .kernel import REPO_ROOT, UNPARSEABLE, Finding, _read_text, scanned_files

PLATFORM_CHECK: Final = "platform-branch"
CRLF_CHECK: Final = "crlf-write"

# The Python PLAT-1 and the write clause read. The backend is in: the trap the write clause holds
# is not scoped to the gate's own tooling, and a test there writes fixtures a shell may read.
PYTHON_SCOPES: Final[tuple[str, ...]] = ("scripts/", "fl_backend/app/", "fl_backend/tests/")
# The test corpus PLAT-2 reads for skips and PLAT-3 counts bindings in.
TEST_SCOPES: Final[tuple[str, ...]] = ("scripts/tests/", "fl_backend/tests/")
# PLAT-4's shell: every `.sh` under these, and the git hooks by folder, which carry no suffix.
SHELL_SCOPES: Final[tuple[str, ...]] = ("scripts/", ".claude/hooks/")
GIT_HOOKS_DIR: Final = ".githooks/"

# The attribute chain's TAIL is what is matched, so `gate_pool.sys.platform` in a driver is read
# as the predicate it rebinds, and its Store context is what tells the rebinding from a read.
ATTRIBUTE_PREDICATES: Final[frozenset[tuple[str, str]]] = frozenset({("sys", "platform"), ("os", "name")})
CALL_PREDICATES: Final[frozenset[tuple[str, str]]] = frozenset({("platform", "system"), ("platform", "machine")})
# The value naming Windows, per predicate PLAT-3 can hold: a call has no value to rebind, so an
# allowlisted `platform.system()` is admitted without a PLAT-3 half, a limit stated rather than hidden.
WINDOWS_VALUE: Final[dict[str, str]] = {"sys.platform": "win32", "os.name": "nt"}

PREDICATE_TEXT_RE: Final = re.compile(r"\bsys\.platform\b|\bos\.name\b|\bplatform\.(?:system|machine)\(")
IF_LINE_RE: Final = re.compile(r"^\s*(?:if|elif)\b(.*?):\s*(.*)$")
STAND_DOWN_RE: Final = re.compile(r"^\s*(?:return\b|raise\s+SystemExit\b|sys\.exit\(|pytest\.skip\()")
SKIP_MARK_RE: Final = re.compile(r"\bmark\.(?:skipif|skip|xfail)\b")
# The remedy every PLAT-2 finding ends on.
BOTH_ARMS: Final = "bind the platform as a value so both arms run everywhere"

# PLAT-4's vocabulary. Matched on code, never on a comment: a comment naming `cygpath` explains a
# branch and is not one.
SHELL_TOKEN_RE: Final = re.compile(r"(?<![\w-])(?:uname|cygpath)\b|\$\{?(?:OSTYPE|MSYSTEM)\b|\bMSYS_NO_PATHCONV\b")
SHELL_FUNCTION_RE: Final = re.compile(r"^([A-Za-z_]\w*)\s*\(\)\s*\{(.*)$")
SHELL_CLOSE_RE: Final = re.compile(r"^\}")
SHELL_ASSIGN_RE: Final = re.compile(r"^\s*(?:local\s+|export\s+|readonly\s+|declare\s+-\S+\s+)?([A-Za-z_]\w*)=")
SHELL_STEP_RE: Final = re.compile(r'^\s*step\s+"([^"]+)"')

# Where an opener's mode sits: the receiver decides for `open`, a `Path` taking it first and the
# modules below taking a path first. `tempfile` defaults to binary, so only a spelled mode counts.
MODE_SECOND: Final[frozenset[str]] = frozenset({"io", "builtins", "codecs", "gzip", "bz2", "lzma"})
TEMPFILE_OPENERS: Final[dict[str, int]] = {"NamedTemporaryFile": 0, "TemporaryFile": 0, "SpooledTemporaryFile": 1}
WRITING_MODE_RE: Final = re.compile(r"^[rwaxt+]*[wax+][rwaxt+]*$")
WRITE_REMEDY: Final = 'pass newline="" or write bytes'

# Keyed by a COR-6 anchor -- an enclosing function, an assigned name, the nearest `step` label or
# a fragment of the line -- never a line number. A row is held to the tree: naming a symbol the
# file no longer spells, or shielding no branch, is a finding.
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

# A deliberate text-mode write, keyed like `PLATFORM_ALLOW`, with the reason the stream may translate.
TEXT_WRITE_ALLOW: Final[dict[str, str]] = {}


@dataclass(frozen=True)
class _Site:
    """One place a clause fired, before the allowlist is asked about it."""

    rel: str
    line: int
    detail: str
    # The anchors a row may name for this site, and the code text a fragment row is matched against.
    candidates: tuple[str, ...]
    text: str
    # Every anchor the file defines: a row spelling one is an anchor row, and never matches as a fragment.
    known: frozenset[str] = frozenset()


@dataclass
class _Scan:
    """What one pass over the Python corpus yields: PLAT-1's sites, and what PLAT-3 reads."""

    sites: list[_Site] = field(default_factory=list)
    # Each admitted constant: its file, its name and its line, so PLAT-3 can name the definition.
    constants: list[tuple[str, str, int]] = field(default_factory=list)
    # Each allowlisted predicate read: file, dotted predicate, line.
    predicates: list[tuple[str, str, int]] = field(default_factory=list)


def _rel(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def _line(node: ast.AST) -> int:
    return int(getattr(node, "lineno", 0))


def _python_files() -> tuple[Path, ...]:
    """The Python corpus, listed by kind and prefix and never by what it contains (PRE-4)."""
    return tuple(p for p in scanned_files() if p.suffix == ".py" and _rel(p).startswith(PYTHON_SCOPES))


def _test_files() -> tuple[Path, ...]:
    return tuple(p for p in _python_files() if _rel(p).startswith(TEST_SCOPES))


def _shell_files() -> tuple[Path, ...]:
    return tuple(p for p in scanned_files() if (p.suffix == ".sh" and _rel(p).startswith(SHELL_SCOPES)) or _rel(p).startswith(GIT_HOOKS_DIR))


@cache
def _tree(path: Path) -> ast.Module | None:
    """One module parsed once for both checks. None where it will not parse, which ruff reports."""
    text = _read_text(path)[0]
    if text is None:
        return None
    try:
        return ast.parse(text)
    except UNPARSEABLE:
        return None


def _tail_name(node: ast.AST) -> str:
    """The last name of an expression: `sys` of `gate_pool.sys`, `Path` of `Path("x")`."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Call):
        return _tail_name(node.func)
    return ""


def _predicate(node: ast.AST) -> str | None:
    """The platform predicate a node reads, dotted, or None."""
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
    """The UPPER_CASE name a module-level `Final` assignment binds, or None: PLAT-1's admitted shape."""
    if not isinstance(node, ast.AnnAssign) or node.value is None or not isinstance(node.target, ast.Name):
        return None
    annotation = node.annotation
    head = annotation.value if isinstance(annotation, ast.Subscript) else annotation
    if _tail_name(head) != "Final" or not node.target.id.isupper():
        return None
    return node.target.id


def _assigned_name(node: ast.AST) -> str | None:
    """The one name a module-level assignment binds, or None."""
    if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        return node.target.id
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        return node.targets[0].id
    return None


def _snippet_lines(node: ast.AST) -> list[str] | None:
    """The lines of a tuple or list of string literals, or None: the driver-snippet convention."""
    value = getattr(node, "value", None)
    if not isinstance(value, (ast.Tuple, ast.List)) or not value.elts:
        return None
    if not all(isinstance(elt, ast.Constant) and isinstance(elt.value, str) for elt in value.elts):
        return None
    return [str(elt.value) for elt in value.elts if isinstance(elt, ast.Constant)]


def _mentions(node: ast.AST, names: frozenset[str]) -> bool:
    """True where an expression reads a platform predicate or one of the admitted constants."""
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


def _python_anchors(tree: ast.Module) -> frozenset[str]:
    """Every name a row may anchor on in a module: each def or class, and each module-level assignment."""
    names = {node.name for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}
    names.update(name for node in tree.body if (name := _assigned_name(node)) is not None)
    return frozenset(names)


def _site(rel: str, line: int, symbol: str, detail: str, source: list[str], known: frozenset[str]) -> _Site:
    text = source[line - 1] if 0 < line <= len(source) else ""
    return _Site(rel, line, detail, (symbol,) if symbol else (), text, known)


def _scan_module(rel: str, tree: ast.Module, source: list[str], scan: _Scan, allow: Mapping[str, str]) -> None:
    """PLAT-1 over one module: a predicate read outside the admitted shapes is a site."""
    known = _python_anchors(tree)

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
            # A Store context is a driver rebinding the predicate as a value, which is the shape
            # PLAT-3 asks for rather than a branch.
            if predicate is not None and not (isinstance(child, ast.Attribute) and isinstance(child.ctx, ast.Store)):
                detail = f"PLAT-1: `{predicate}` read in `{symbol or rel}` -- bind the platform once as an UPPER_CASE Final, or allowlist it"
                scan.sites.append(_site(rel, _line(child), symbol, detail, source, known))
                if f"{rel} :: {symbol}" in allow:
                    scan.predicates.append((rel, predicate.removesuffix("()"), _line(child)))
            visit(child, symbol)

    visit(tree, "")


def _scan_tests(rel: str, tree: ast.Module, source: list[str], names: frozenset[str]) -> list[_Site]:
    """PLAT-2 over one test module: a skip, an early return or a raise guarded by the platform."""
    found: list[_Site] = []
    known = _python_anchors(tree)

    def visit(node: ast.AST, scope: str) -> None:
        for child in ast.iter_child_nodes(node):
            symbol = scope
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                symbol = child.name
                for decorator in child.decorator_list:
                    spelled = ast.unparse(decorator)
                    if SKIP_MARK_RE.search(spelled) and _mentions(decorator, names):
                        detail = f"PLAT-2: `{symbol}` is skipped on the platform ({spelled}) -- {BOTH_ARMS}"
                        found.append(_site(rel, decorator.lineno, symbol, detail, source, known))
            elif not scope and (name := _assigned_name(child)) is not None:
                symbol = name
                lines = _snippet_lines(child)
                if lines is not None and _snippet_stands_down(lines, names):
                    detail = f"PLAT-2: the driver snippet `{symbol}` stands down on the platform -- {BOTH_ARMS}"
                    found.append(_site(rel, _line(child), symbol, detail, source, known))
            if isinstance(child, ast.If) and _mentions(child.test, names) and _stands_down(child.body):
                detail = f"PLAT-2: `{symbol or rel}` returns or exits when the platform says so -- {BOTH_ARMS}"
                found.append(_site(rel, child.lineno, symbol, detail, source, known))
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


def _bindings(module: str, name: str, corpus: Iterable[str]) -> set[str]:
    """Every value the test corpus binds `<module>.<name>` to, as text: a statement or a snippet line alike."""
    pattern = re.compile(r"\b" + re.escape(module) + r"\." + re.escape(name) + r"\s*=\s*(True|False|['\"]\w+['\"])")
    return {match.strip("'\"") for text in corpus for match in pattern.findall(text)}


def _both_values(scan: _Scan) -> list[_Site]:
    """PLAT-3: every admitted constant and allowlisted predicate is driven to both values by the tests.

    No row shields one of these: the remedy is a case binding the missing value.
    """
    corpus = [text for path in _test_files() if (text := _read_text(path)[0]) is not None]
    found: list[_Site] = []
    for rel, name, line in scan.constants:
        module = Path(rel).stem
        bound = _bindings(module, name, corpus)
        for value in ("True", "False"):
            if value not in bound:
                detail = f"PLAT-3: no test binds `{module}.{name} = {value}`, so the arm it selects runs on one platform alone"
                found.append(_Site(rel, line, detail, (), ""))
    for rel, predicate, line in scan.predicates:
        if predicate not in WINDOWS_VALUE:
            continue
        module = Path(rel).stem
        bound = _bindings(module, predicate, corpus)
        windows = WINDOWS_VALUE[predicate]
        if windows not in bound:
            detail = f"PLAT-3: no test binds `{module}.{predicate} = '{windows}'`, so the Windows arm is executed on Windows alone"
            found.append(_Site(rel, line, detail, (), ""))
        if not (bound - {windows}):
            detail = f"PLAT-3: no test binds `{module}.{predicate}` to a value other than '{windows}', so the other arm runs off Windows alone"
            found.append(_Site(rel, line, detail, (), ""))
    return found


def _shell_code(line: str) -> str:
    """The code half of a shell line, read the way `scripts/docs_gate/kernel.py :: _shell_comments` reads the other half."""
    if line.lstrip().startswith("#"):
        return ""
    marker = line.find(" #")
    return line if marker == -1 else line[:marker]


def _scan_shell(rel: str, text: str) -> list[_Site]:
    """PLAT-4 over one shell file: a platform token in code, anchored to what encloses it."""
    lines = text.split("\n")
    known: set[str] = set()
    for raw in lines:
        if (defined := SHELL_FUNCTION_RE.match(raw)) is not None:
            known.add(defined.group(1))
        if (labelled := SHELL_STEP_RE.match(raw)) is not None:
            known.add(labelled.group(1))
        if (assigned := SHELL_ASSIGN_RE.match(_shell_code(raw))) is not None:
            known.add(assigned.group(1))
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
        candidates = [function, step]
        if (assigned := SHELL_ASSIGN_RE.match(code)) is not None and not SHELL_TOKEN_RE.fullmatch(assigned.group(1)):
            candidates.insert(0, assigned.group(1))
        anchors = tuple(candidate for candidate in candidates if candidate)
        detail = f"PLAT-4: {', '.join(tokens)} in code outside the allowlist -- a shell platform branch is a `PLATFORM_ALLOW` row"
        found.append(_Site(rel, number, detail, anchors, code, frozenset(known)))
    return found


def _row_for(site: _Site, allow: Mapping[str, str]) -> str | None:
    """The row excusing a site: an enclosing anchor's, else one quoting a fragment of the line.

    A row spelling an anchor the file defines is an anchor row: `mount_source`'s must not excuse a
    line that merely calls it.
    """
    prefix = site.rel + " :: "
    rows = {key[len(prefix) :]: key for key in allow if key.startswith(prefix)}
    for symbol, key in rows.items():
        if symbol in site.candidates:
            return key
    for symbol, key in rows.items():
        if symbol not in site.known and symbol in site.text and not SHELL_TOKEN_RE.fullmatch(symbol):
            return key
    return None


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
    source_of: dict[str, list[str]] = {}
    for path in _python_files():
        tree = _tree(path)
        text = _read_text(path)[0]
        if tree is None or text is None:
            continue
        rel = _rel(path)
        source_of[rel] = text.split("\n")
        _scan_module(rel, tree, source_of[rel], scan, allow)
    names = frozenset(name for _, name, _ in scan.constants)
    sites = list(scan.sites)
    for path in _test_files():
        tree = _tree(path)
        if tree is not None and (rel := _rel(path)) in source_of:
            sites.extend(_scan_tests(rel, tree, source_of[rel], names))
    sites.extend(_both_values(scan))
    shell = _shell_files()
    for path in shell:
        text = _read_text(path)[0]
        if text is not None:
            sites.extend(_scan_shell(_rel(path), text))
    present = frozenset(source_of) | frozenset(_rel(path) for path in shell)
    return _resolve(PLATFORM_CHECK, sites, allow, present)


def _mode_position(func: ast.expr) -> tuple[str, int] | None:
    """The callee's spelling and where its mode argument sits, or None where the call opens nothing."""
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
    """The callee and whether its mode was readable, for a call that may write text; None for one that cannot."""
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
    """True for `newline=""` or `newline="\\n"` (or `chr(10)`), False for another value, None where absent."""
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


def _scan_writes(rel: str, tree: ast.Module, source: list[str]) -> list[_Site]:
    """The write clause over one module: every text-mode opener, judged on the call alone."""
    found: list[_Site] = []
    known = _python_anchors(tree)

    def visit(node: ast.AST, scope: str) -> None:
        for child in ast.iter_child_nodes(node):
            symbol = child.name if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) else scope
            if isinstance(child, ast.Call) and (write := _text_write(child)) is not None:
                callee, readable = write
                passed = _newline_passed(child)
                if not readable:
                    detail = f"`{callee}` opens with a mode the clause cannot read -- spell the mode as a literal, or allowlist the anchor"
                    found.append(_site(rel, child.lineno, symbol, detail, source, known))
                elif passed is None:
                    detail = f'text-mode write `{callee}` without newline="" -- on Windows the stream turns every LF into CRLF; {WRITE_REMEDY}'
                    found.append(_site(rel, child.lineno, symbol, detail, source, known))
                elif not passed:
                    detail = f'`{callee}` passes a newline other than "" or "\\n", so the stream still translates -- {WRITE_REMEDY}'
                    found.append(_site(rel, child.lineno, symbol, detail, source, known))
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
        text = _read_text(path)[0]
        if tree is None or text is None:
            continue
        rel = _rel(path)
        present.add(rel)
        sites.extend(_scan_writes(rel, tree, text.split("\n")))
    return _resolve(CRLF_CHECK, sites, allow, frozenset(present))
