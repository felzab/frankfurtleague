"""SCRIPTS · the addresses a declared unenforced state argues from, held to the tree they name.

A reason is read as evidence, so one arguing from a rule, an invariant or a file renamed away reads
as evidence and is none. This package resolves the addresses the corpus answers for; the backend's
own suite resolves the rest, being the one reader able to import what they name.

Invariants:
  Each backticked token of a reason is one package's to resolve: the shapes below here, every
  other one in `fl_backend/tests/core/test_domain.py :: _classify`, which passes over exactly
  these (`check_handed_over_shapes`).
"""

from __future__ import annotations

import ast
import re
from collections.abc import Callable, Sequence
from functools import cache
from typing import Final

from .kernel import REPO_ROOT, Finding, _read_text, _readable, is_gitignored, python_tree, repo_path, tracked_glob, tracked_page

DOMAIN_MODULE: Final = "fl_backend/app/core/domain.py"
# The one sheet holding the read rules, which refuse nothing and so reach no module's source.
READ_RULES_SHEET: Final = "docs/backend/spec.md"
APP_GLOB: Final = "fl_backend/app/**/*.py"

REASON_TOKEN_RE: Final = re.compile(r"`([^`]+)`")
# The shapes this package owns. The backend's classifier hands these over and reads every other, so a
# shape in one list alone is a token nothing reads (`check_handed_over_shapes`).
RULE_CODE_RE: Final = re.compile(r"^(?:REQ|READ)-[A-Z]+-\d+$")
CODE_FAMILY_RE: Final = re.compile(r"^((?:REQ|READ)-[A-Z]+-)\*$")
CITATION_RE: Final = re.compile(r"^(\S+\.\w+) :: (.+)$")
REPO_PATH_RE: Final = re.compile(r"^[\w.\-]+(?:/[\w.\-]*)+$")
INVARIANT_RE: Final = re.compile(r"^[IL]\d{1,3}[a-z]?$")
OWNED_SHAPES: Final = (RULE_CODE_RE, CODE_FAMILY_RE, CITATION_RE, REPO_PATH_RE, INVARIANT_RE)

# Read from its source rather than imported: the suite needs the backend's application objects, and
# a gate reading it here runs in the docs scope, which a change to either file selects.
CLASSIFIER: Final = "fl_backend/tests/core/test_domain.py"
HANDED_OVER: Final = "_GATE_SHAPES"

RAISED_CODE_RE: Final = re.compile(r"\bREQ-[A-Z]+-\d+\b")
READ_ROW_RE: Final = re.compile(r"^\| `(READ-[A-Z]+-\d+)` ", re.MULTILINE)

# `rel`, then the citation, then the invariant tables: `checks.py :: _check_citation`'s signature,
# handed in because that module imports this one.
Cite = Callable[[str, str, dict[str, list[str]]], list[Finding]]


@cache
def resolvable_codes() -> frozenset[str]:
    """A rule code a reason may argue from: one a module raises, or a read-rules row declares.

    The declaration is left out: it spells every code it declares, and a reason's own text among them.
    """
    codes: set[str] = set()
    for path in tracked_glob(APP_GLOB):
        if path.relative_to(REPO_ROOT).as_posix() != DOMAIN_MODULE and (text := _read_text(path)[0]) is not None:
            codes.update(RAISED_CODE_RE.findall(text))
    if (sheet := tracked_page(READ_RULES_SHEET)) is not None and (text := _readable(sheet)) is not None:
        codes.update(READ_ROW_RE.findall(text))
    return frozenset(codes)


def _literal(node: ast.expr | None) -> str | None:
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def declared_reasons() -> list[tuple[str, str | None, int]] | None:
    """Each entry's subject, its reason where one literal string spells it, and that reason's line.

    None where the module declares no `UNENFORCED` tuple this can read.
    """
    page = tracked_page(DOMAIN_MODULE)
    tree = None if page is None else python_tree(page)
    for node in [] if tree is None else tree.body:
        if not isinstance(node, ast.AnnAssign | ast.Assign):
            continue
        target = node.target if isinstance(node, ast.AnnAssign) else node.targets[0]
        if isinstance(target, ast.Name) and target.id == "UNENFORCED" and isinstance(node.value, ast.Tuple):
            entries: list[tuple[str, str | None, int]] = []
            for call in node.value.elts:
                fields = {keyword.arg: keyword.value for keyword in call.keywords} if isinstance(call, ast.Call) else {}
                reason = fields.get("reason")
                entries.append((_literal(fields.get("subject")) or "?", _literal(reason), (reason or call).lineno))
            return entries
    return None


def handed_over_value() -> ast.expr | None:
    """What the backend's classifier assigns the shapes it passes over as this package's, None where it declares none."""
    page = tracked_page(CLASSIFIER)
    tree = None if page is None else python_tree(page)
    for node in [] if tree is None else tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == HANDED_OVER for target in node.targets):
            return node.value
    return None


def _bare_compile(node: ast.expr) -> ast.expr | None:
    if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "compile"):
        return None
    module = node.func.value
    bare = isinstance(module, ast.Name) and module.id == "re" and len(node.args) == 1 and not node.keywords
    return node.args[0] if bare and not isinstance(node.args[0], ast.Starred) else None


def _literals(nodes: Sequence[ast.expr | None]) -> list[str] | None:
    patterns = [pattern for node in nodes if (pattern := _literal(node)) is not None]
    return patterns if len(patterns) == len(nodes) else None


def handed_over_patterns(value: ast.expr) -> list[str] | None:
    """The patterns `_GATE_SHAPES` compiles, None for any form but one bare compile over literal patterns.

    A flag, a filter or a transform changes what a shape matches while its text stays the gate's.
    """
    if not (isinstance(value, ast.Call) and isinstance(value.func, ast.Name) and value.func.id == "tuple"):
        return None
    built = value.args[0] if len(value.args) == 1 and not value.keywords else None
    if not (isinstance(built, ast.GeneratorExp) and len(built.generators) == 1):
        return None
    loop = built.generators[0]
    compiled = _bare_compile(built.elt)
    same_name = isinstance(loop.target, ast.Name) and isinstance(compiled, ast.Name) and compiled.id == loop.target.id
    if not same_name or loop.ifs or loop.is_async or not isinstance(loop.iter, ast.Tuple):
        return None
    return _literals(loop.iter.elts)


def check_handed_over_shapes() -> list[Finding]:
    """The two lists of the shapes this package owns, required to be one list spelled twice."""
    value = handed_over_value()
    if value is None:
        return [Finding("fail", "citation", CLASSIFIER, f"declares no `{HANDED_OVER}`, so no reason token is known to be this gate's")]
    patterns = handed_over_patterns(value)
    if patterns is None:
        detail = f"`{HANDED_OVER}` is no bare `re.compile(pattern)` over literal patterns, so what it passes over is not what it spells"
        return [Finding("fail", "citation", CLASSIFIER, detail, value.lineno)]
    handed = set(patterns)
    owned = {shape.pattern for shape in OWNED_SHAPES}
    found = [
        Finding("fail", "citation", CLASSIFIER, f"`{HANDED_OVER}` hands over `{one}`, a shape the gate does not read")
        for one in sorted(handed - owned)
    ]
    found += [
        Finding("fail", "citation", CLASSIFIER, f"`{HANDED_OVER}` keeps `{one}`, a shape the gate reads too") for one in sorted(owned - handed)
    ]
    return found


def _unresolved(token: str, subject: str, invariants: dict[str, list[str]], cite: Cite) -> list[tuple[str, str]]:
    """What one token fails, as a check's name beside its detail; nothing for a shape the backend reads."""
    said = f"'{subject}' argues from `{token}`"
    if RULE_CODE_RE.match(token):
        return (
            [] if token in resolvable_codes() else [("citation", f"{said}, which only the declaration spells and no read-rules row declares")]
        )
    if family := CODE_FAMILY_RE.match(token):
        known = any(code.startswith(family.group(1)) for code in resolvable_codes())
        return [] if known else [("citation", f"{said}, a family no raised code or read-rules row belongs to")]
    if citation := CITATION_RE.match(token):
        if repo_path(citation.group(1)) == DOMAIN_MODULE:
            return [("citation", f"{said}, which cites the declaration itself, answering for nothing")]
        return [(finding.check, f"'{subject}': {finding.detail}") for finding in cite(token, DOMAIN_MODULE, invariants)]
    if REPO_PATH_RE.match(token):
        return [] if repo_path(token) is not None or is_gitignored(token) else [("path", f"{said}, a path the repository holds nowhere")]
    if INVARIANT_RE.match(token):
        return [] if token in invariants else [("invariant-id", f"{said}, which no spec sheet's invariant table defines")]
    return []


def check_unenforced_reasons(invariants: dict[str, list[str]], cite: Cite) -> list[Finding]:
    """Every address an `UNENFORCED` reason argues from, resolved as the corpus's own citations are."""
    entries = declared_reasons()
    found = check_handed_over_shapes()
    if not entries:
        return [*found, Finding("fail", "citation", DOMAIN_MODULE, "yielded no `UNENFORCED` reason, so no reason's addresses were read")]
    if not resolvable_codes():
        detail = f"no module under `{APP_GLOB}` raises a code and no read-rules row declares one, so codes were read against nothing"
        return [*found, Finding("fail", "citation", DOMAIN_MODULE, detail)]
    for subject, reason, line in entries:
        if reason is None:
            found.append(
                Finding("fail", "citation", DOMAIN_MODULE, f"'{subject}' spells no reason as one literal string, so none was read", line)
            )
            continue
        for token in REASON_TOKEN_RE.findall(reason):
            found.extend(Finding("fail", check, DOMAIN_MODULE, detail, line) for check, detail in _unresolved(token, subject, invariants, cite))
    return found
