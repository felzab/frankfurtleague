"""SCRIPTS · the refusal-code register, held to the two source trees that spell its codes.

This module is the page's one reader under `scripts/`, so a row for a code no tree raises, and a
code no row explains, are caught here or nowhere. The comparison is PREFIX-AWARE because the frontend spells
the backend's codes to word them for a reader: a shared population would read every one of those as
the frontend's own and demand nothing of the backend at all. A domain rule is stated at
`fl_backend/app/core/domain.py :: RULES` and takes no row, so a row for one is a second statement.

Invariants:
  Each tree answers for its own prefixes and for no others (`docs/ops/spec.md :: I176`).
"""

from __future__ import annotations

import ast
import re
from functools import cache
from typing import Final

from .kernel import REPO_ROOT, Finding, _readable, code_body, python_tree, rebound, tracked_glob, tracked_page

ERROR_CODES_CHECK: Final = "error-codes"
ERROR_CODES_PAGE: Final = "docs/logging/error-codes.md"

# `<AREA>-<SUBJECT>-<NNN>`, the taxonomy the page fixes, read as a shape and never as a list of
# areas: an alternation both patterns retype drops a fifth area out of both populations at once
# (PRE-4).
CODE_SHAPE: Final = r"[A-Z]+-[A-Z]+-\d+"
# The digit tail is the tolerance `fl_backend/tests/core/test_domain.py :: _codes_in` already
# keeps: `REQ-STATE-*` inside an `Unenforced` reason names a family rather than a code.
CODE_RE: Final = re.compile(rf"\b{CODE_SHAPE}")
# A code as a table row defines it: read from the rows rather than matched anywhere on the page,
# whose prose names a code it gives no row.
CODE_ROW_RE: Final = re.compile(rf"^[ \t]*\|\s*`({CODE_SHAPE})`\s*\|", re.MULTILINE)

# The one prefix the frontend answers for; every other is the backend's.
FRONTEND_PREFIX: Final = "FE-"
# Shares the shape and is no error code, which the register page states beside its taxonomy: a
# read rule refuses nothing, so it reaches no response, no log line and no row.
READ_PREFIX: Final = "READ-"
BACKEND_GLOB: Final = "fl_backend/app/**/*.py"
FRONTEND_GLOB: Final = "fl_frontend/src/**/*.ts*"
# A fixture for an unmapped code is not a code the register owes a row, so the suffix
# `fl_backend/tests/shared/test_frontend_mirrors.py :: _modules_naming_the_source` excludes is
# excluded here too; the backend glob holds no file of these suffixes, so one exclusion serves both.
TEST_SUFFIXES: Final[tuple[str, ...]] = (".test.ts", ".test.tsx")

DOMAIN_MODULE: Final = "fl_backend/app/core/domain.py"
RULES_NAME: Final = "RULES"


@cache
def _spelled(pattern: str) -> dict[str, str]:
    """Every code one tree spells, mapped to the first file spelling it, so a finding can point.

    Nothing mutates the answer: it is one cache entry per glob for the whole run.
    """
    found: dict[str, str] = {}
    for path in tracked_glob(pattern):
        if path.name.endswith(TEST_SUFFIXES):
            continue
        # The code alone: a comment naming a retired code would otherwise keep its row alive.
        for code in CODE_RE.findall(code_body(path)):
            if not code.startswith(READ_PREFIX):
                found.setdefault(code, path.relative_to(REPO_ROOT).as_posix())
    return found


# One form, a bare `Rule(code="...")`: a wrapper or a nested call can spell a `code=` the tuple
# does not declare.
def _rule_code(node: ast.expr) -> str | None:
    if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "Rule" and not node.args):
        return None
    code = next((keyword.value for keyword in node.keywords if keyword.arg == "code"), None)
    return code.value if isinstance(code, ast.Constant) and isinstance(code.value, str) else None


def _domain_tree() -> ast.Module | None:
    page = tracked_page(DOMAIN_MODULE)
    return None if page is None else python_tree(page)


@cache
def _declared_rules() -> frozenset[str]:
    """Every code the backend declares a domain rule for, empty where the declaration is not one read here.

    Reached without opening the page: rows deciding which codes are owed one could never fail (PRE-4).
    """
    tree = _domain_tree()
    for node in [] if tree is None else tree.body:
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == RULES_NAME:
            if not isinstance(node.value, ast.Tuple):
                return frozenset()
            codes = [_rule_code(element) for element in node.value.elts]
            return frozenset() if None in codes else frozenset(code for code in codes if code is not None)
    return frozenset()


def check_error_codes() -> list[Finding]:
    """The register's rows and the codes the two trees spell, required to agree both ways."""
    rel = ERROR_CODES_PAGE
    page = tracked_page(rel)
    if page is None:
        # Absence is `checks.py :: check_inputs`' finding; a page on disk and outside the index
        # satisfies that check and yields no row, so the comparison would run over nothing.
        if (REPO_ROOT / rel).exists():
            return [Finding("fail", ERROR_CODES_CHECK, rel, "untracked, so the register was held to nothing")]
        return []
    if (text := _readable(page)) is None:
        return [Finding("fail", ERROR_CODES_CHECK, rel, "unreadable, so the register was held to nothing")]
    rows = frozenset(CODE_ROW_RE.findall(text))
    declared = _declared_rules()
    if not declared:
        # The one finding, and no comparison after it: the one below subtracts the declared rules,
        # and would demand a row for every domain rule the backend spells.
        detail = f'`{DOMAIN_MODULE}` yielded no rule declaration as a tuple of `Rule(code="...")` calls, so the register was held to nothing'
        return [Finding("fail", ERROR_CODES_CHECK, rel, detail)]
    found = rebound(_domain_tree(), RULES_NAME, ERROR_CODES_CHECK, DOMAIN_MODULE)
    for code in sorted(rows & declared):
        detail = f"`{code}` is a domain rule, stated at `{DOMAIN_MODULE} :: RULES`, and takes no row here"
        found.append(Finding("fail", ERROR_CODES_CHECK, rel, detail))
    for frontends, glob in ((True, FRONTEND_GLOB), (False, BACKEND_GLOB)):
        tree = _spelled(glob)
        owed = {code for code in rows if code.startswith(FRONTEND_PREFIX) is frontends}
        for code in sorted(owed - set(tree)):
            detail = f"`{code}` has a row and is spelled in no code under `{glob}`"
            found.append(Finding("fail", ERROR_CODES_CHECK, rel, detail))
        for code in sorted({one for one in tree if one.startswith(FRONTEND_PREFIX) is frontends} - rows - declared):
            detail = f"`{tree[code]}` spells `{code}`, which this register gives no row"
            found.append(Finding("fail", ERROR_CODES_CHECK, rel, detail))
    return found
