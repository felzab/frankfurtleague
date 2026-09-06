"""SCRIPTS · the refusal-code register, held to the two source trees that spell its codes.

Nothing under `scripts/` opened that page before this check, so a row for a code no tree raises and
a code no row explains were both silent. The comparison is PREFIX-AWARE because the frontend spells
the backend's codes to word them for a reader: a shared population would read every one of those as
the frontend's own and demand nothing of the backend at all.

Invariants:
  Each tree answers for its own prefixes and for no others (`docs/ops/spec.md :: I176`).
"""

from __future__ import annotations

import re
from functools import cache
from typing import Final

from .kernel import REPO_ROOT, Finding, _read_text, _readable, tracked_glob, tracked_page

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


@cache
def _spelled(pattern: str) -> dict[str, str]:
    """Every code one tree spells, mapped to the first file spelling it, so a finding can point.

    Nothing mutates the answer: it is one cache entry per glob for the whole run.
    """
    found: dict[str, str] = {}
    for path in tracked_glob(pattern):
        if path.name.endswith(TEST_SUFFIXES):
            continue
        if (text := _read_text(path)[0]) is None:
            continue
        for code in CODE_RE.findall(text):
            if not code.startswith(READ_PREFIX):
                found.setdefault(code, path.relative_to(REPO_ROOT).as_posix())
    return found


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
    found: list[Finding] = []
    for frontends, glob in ((True, FRONTEND_GLOB), (False, BACKEND_GLOB)):
        tree = _spelled(glob)
        owed = {code for code in rows if code.startswith(FRONTEND_PREFIX) is frontends}
        for code in sorted(owed - set(tree)):
            detail = f"`{code}` has a row and is spelled nowhere under `{glob}`"
            found.append(Finding("fail", ERROR_CODES_CHECK, rel, detail))
        for code in sorted({one for one in tree if one.startswith(FRONTEND_PREFIX) is frontends} - rows):
            detail = f"`{tree[code]}` spells `{code}`, which this register gives no row"
            found.append(Finding("fail", ERROR_CODES_CHECK, rel, detail))
    return found
