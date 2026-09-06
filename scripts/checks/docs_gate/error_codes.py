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

from .kernel import REPO_ROOT, Finding, _read_text, tracked_glob, tracked_page

ERROR_CODES_CHECK: Final = "error-codes"
ERROR_CODES_PAGE: Final = "docs/logging/error-codes.md"

# `<AREA>-<SUBJECT>-<NNN>`, the taxonomy the page fixes. The digit tail is the tolerance
# `fl_backend/tests/core/test_domain.py :: _codes_in` already keeps: `REQ-STATE-*` inside an
# `Unenforced` reason names a family rather than a code.
CODE_RE: Final = re.compile(r"\b(?:REQ|DB|SRV|FE)-[A-Z]+-\d+(?!\d)")
# A code as a table row defines it, the way `kernel.py :: roadmap_ids` reads an entry token: from
# the tables defining them rather than matched anywhere on the page.
CODE_ROW_RE: Final = re.compile(r"^[ \t]*\|\s*`((?:REQ|DB|SRV|FE)-[A-Z]+-\d+)`\s*\|", re.MULTILINE)

# The one prefix the frontend answers for; the page's other three are the backend's.
FRONTEND_PREFIX: Final = "FE-"
BACKEND_GLOB: Final = "fl_backend/app/**/*.py"
FRONTEND_GLOB: Final = "fl_frontend/src/**/*.ts*"
# A fixture for an unmapped code is not a code the register owes a row, so the suffix
# `fl_backend/tests/shared/test_frontend_mirrors.py :: _modules_naming_the_source` excludes is
# excluded here too.
TEST_SUFFIXES: Final[tuple[str, ...]] = (".test.ts", ".test.tsx")


@cache
def _spelled(pattern: str, drop_tests: bool) -> dict[str, str]:
    """Every code one tree spells, mapped to the first file spelling it, so a finding can point.

    Nothing mutates the answer: it is one cache entry per glob for the whole run.
    """
    found: dict[str, str] = {}
    for path in tracked_glob(pattern):
        if drop_tests and path.name.endswith(TEST_SUFFIXES):
            continue
        if (text := _read_text(path)[0]) is None:
            continue
        for code in CODE_RE.findall(text):
            found.setdefault(code, path.relative_to(REPO_ROOT).as_posix())
    return found


def check_error_codes() -> list[Finding]:
    """The register's rows and the codes the two trees spell, required to agree both ways."""
    page = tracked_page(ERROR_CODES_PAGE)
    text = None if page is None else _read_text(page)[0]
    # Silent where the tracked corpus does not yield the page: its absence is `checks.py ::
    # check_inputs`' one finding, and a table nothing can read is loud here anyway, every spelled
    # code losing its row at once.
    if text is None:
        return []
    rows = frozenset(CODE_ROW_RE.findall(text))
    found: list[Finding] = []
    for frontends, glob, drop_tests in ((True, FRONTEND_GLOB, True), (False, BACKEND_GLOB, False)):
        tree = _spelled(glob, drop_tests)
        owed = {code for code in rows if code.startswith(FRONTEND_PREFIX) is frontends}
        for code in sorted(owed - set(tree)):
            detail = f"`{code}` has a row and is spelled nowhere under `{glob}`"
            found.append(Finding("fail", ERROR_CODES_CHECK, ERROR_CODES_PAGE, detail))
        for code in sorted({one for one in tree if one.startswith(FRONTEND_PREFIX) is frontends} - rows):
            detail = f"`{tree[code]}` spells `{code}`, which this register gives no row"
            found.append(Finding("fail", ERROR_CODES_CHECK, ERROR_CODES_PAGE, detail))
    return found
