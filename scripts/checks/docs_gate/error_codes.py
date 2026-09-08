"""SCRIPTS · the refusal-code register, held to the two source trees that spell its codes.

This module is the page's one reader under `scripts/`, so a row for a code no tree raises, and a
code no row explains, are caught here or nowhere. The comparison is PREFIX-AWARE because the frontend spells
the backend's codes to word them for a reader: a shared population would read every one of those as
the frontend's own and demand nothing of the backend at all. The wording column is held to its
citation resolving and never to the sentence behind it, nothing being able to decide whether German
states what a predicate tests.

Invariants:
  Each tree answers for its own prefixes and for no others (`docs/ops/spec.md :: I176`).
  Every domain rule's row names the module answering its code (`docs/ops/spec.md :: I187`).
"""

from __future__ import annotations

import re
from functools import cache
from typing import Final

from .kernel import REPO_ROOT, Finding, _read_text, _readable, _scan_body, tracked_glob, tracked_page

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
FRONTEND_ROOT: Final = "fl_frontend/src/"
# A fixture for an unmapped code is not a code the register owes a row, so the suffix
# `fl_backend/tests/shared/test_frontend_mirrors.py :: _modules_naming_the_source` excludes is
# excluded here too; the backend glob holds no file of these suffixes, so one exclusion serves both.
TEST_SUFFIXES: Final[tuple[str, ...]] = (".test.ts", ".test.tsx")

DOMAIN_MODULE: Final = "fl_backend/app/core/domain.py"
# The tuple's own opening, and the close no indented line can spell. Sliced rather than read off the
# module, whose neighbouring registers are free to take a `code=` field of their own.
RULES_OPEN: Final = "RULES: tuple[Rule, ...] = ("
RULES_CLOSE: Final = "\n)\n"
RULE_CODE_RE: Final = re.compile(rf'\bcode="({CODE_SHAPE})"')

# The header the wording column is found by: the page's code tables differ in width, and a column
# read by position puts a `Meaning` cell in front of the citation reader.
CODE_COLUMN: Final = "Code"
WORDING_COLUMN: Final = "Worded by"
# What a row outside the population carries there. A blank cell reads as an omission somebody will
# fill, which is the column over every row that this one refuses to become.
NO_WORDING: Final = "—"
# COR-6's `<path> :: <symbol>`, the whole cell: prose beside a citation is a second meaning, which
# is the duplication the column exists to avoid.
WORDING_CELL_RE: Final = re.compile(r"^`(\S+) :: [^`]+`$")


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


@cache
def _answered(rel: str) -> frozenset[str]:
    """Every code one module answers, a mention in a comment excluded.

    A comment naming a code outlives the arm it described, so a citation held to presence alone
    would resolve against the module that stopped wording it.
    """
    page = tracked_page(rel)
    if page is None or (raw := _read_text(page)[0]) is None:
        return frozenset()
    commented = _scan_body(page).split("\n")
    found: set[str] = set()
    for number, line in enumerate(raw.split("\n")):
        remark = commented[number] if number < len(commented) else ""
        # Blanked column for column rather than by substring: the c-style reader keeps a comment at
        # the offsets it occupies, and a line answering a code beside a remark still answers it.
        bare = "".join(" " if index < len(remark) and remark[index] != " " else char for index, char in enumerate(line))
        found.update(CODE_RE.findall(bare))
    return frozenset(found)


@cache
def _declared_rules() -> frozenset[str]:
    """Every code the backend declares a domain rule for, empty where the declaration cannot be read.

    The population's own route, reached without opening the page: a column deciding which codes it
    owes could never fail (PRE-4).
    """
    page = tracked_page(DOMAIN_MODULE)
    if page is None or (text := _read_text(page)[0]) is None:
        return frozenset()
    start = text.find(RULES_OPEN)
    if start < 0:
        return frozenset()
    end = text.find(RULES_CLOSE, start)
    return frozenset(RULE_CODE_RE.findall(text[start:] if end < 0 else text[start:end]))


def _cells(line: str) -> list[str]:
    """One table row's cells, or nothing where the line is no row."""
    stripped = line.strip()
    if not stripped.startswith("|"):
        return []
    return [cell.strip() for cell in stripped.strip("|").split("|")]


def _wording_cells(text: str) -> dict[str, str | None]:
    """Each row's code against its wording cell, None where the row's own table opens no column."""
    found: dict[str, str | None] = {}
    column: int | None = None
    for line in text.split("\n"):
        if line.startswith("## "):
            # A section boundary closes the column, so a table under a heading of its own is never
            # read through the header of the table above it.
            column = None
        cells = _cells(line)
        if cells and cells[0] == CODE_COLUMN:
            column = cells.index(WORDING_COLUMN) if WORDING_COLUMN in cells else None
        if (row := CODE_ROW_RE.match(line)) is not None:
            found[row.group(1)] = cells[column] if column is not None and column < len(cells) else None
    return found


def _check_wording(rel: str, wording: dict[str, str | None]) -> list[Finding]:
    """Every domain rule's row names a frontend module answering its code, and no other row names one."""
    declared = _declared_rules()
    if not declared:
        detail = f"`{DOMAIN_MODULE}` yielded no rule declaration, so the wording column was held to nothing"
        return [Finding("fail", ERROR_CODES_CHECK, rel, detail)]
    found: list[Finding] = []
    for code in sorted(declared & set(wording)):
        if (cell := wording[code]) is None:
            detail = f"`{code}` is a domain rule and its row opens no `{WORDING_COLUMN}` column"
        elif (cited := WORDING_CELL_RE.match(cell)) is None:
            detail = f"`{code}`'s `{WORDING_COLUMN}` cell is no `<path> :: <symbol>` citation: {cell}"
        elif not cited.group(1).startswith(FRONTEND_ROOT) or cited.group(1).endswith(TEST_SUFFIXES):
            detail = f"`{code}` is worded for a reader by `{FRONTEND_ROOT}`, and its cell cites `{cited.group(1)}`"
        elif code not in _answered(cited.group(1)):
            detail = f"`{code}`'s cell cites `{cited.group(1)}`, which no longer answers the code"
        else:
            continue
        found.append(Finding("fail", ERROR_CODES_CHECK, rel, detail))
    for code, cell in sorted(wording.items()):
        if code in declared or cell is None or cell == NO_WORDING:
            continue
        detail = f"`{code}` is no domain rule, so its `{WORDING_COLUMN}` cell carries `{NO_WORDING}` rather than {cell}"
        found.append(Finding("fail", ERROR_CODES_CHECK, rel, detail))
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
    wording = _wording_cells(text)
    rows = frozenset(wording)
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
    return found + _check_wording(rel, wording)
