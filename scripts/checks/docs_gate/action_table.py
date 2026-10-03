"""SCRIPTS · the frontend spec's action table, held to the server actions the frontend exports.

A server action with no row is a write whose invalidations nobody wrote down, and a row naming no
action is a contract for a write that is gone. The two listings are reached apart: the rows off the
one table the frontend spec heads `Action`, the actions off every module under `fl_frontend/src`
whose first statement is the `"use server"` directive, which is what makes Next serve each of its
exports as an action whatever the module is named.

Invariants:
  Every exported server action has a row, and every row names one (`docs/frontend/spec.md :: I491`).
"""

from __future__ import annotations

import re
from typing import Final

from .kernel import REPO_ROOT, Finding, _readable, code_body, tracked_glob, tracked_page

ACTION_TABLE_CHECK: Final = "action-table"
ACTION_TABLE_PAGE: Final = "docs/frontend/spec.md"
FRONTEND_GLOB: Final = "fl_frontend/src/**/*.ts*"
TEST_SUFFIXES: Final[tuple[str, ...]] = (".test.ts", ".test.tsx")

# The table's own header cell rather than the section around it: a renumbered or renamed section
# keeps its table, and a second table under the same heading is not this one.
TABLE_HEAD_RE: Final = re.compile(r"^\|\s*Action\s*\|")
ROW_RE: Final = re.compile(r"^\|\s*`([A-Za-z_$][\w$]*)`\s*\|")
# The directive only as a module's first statement: anywhere else it marks one function, or nothing.
DIRECTIVE_RE: Final = re.compile(r"""\A\s*(?:"use server"|'use server')""")
# `\w` is Unicode here, so a name holding an umlaut is read whole.
EXPORT_RE: Final = re.compile(r"^export\s+(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+)([A-Za-z_$][\w$]*)", re.MULTILINE)


def _rows(text: str) -> list[str] | None:
    """The action each row of the table names, None where the page heads no table `Action`."""
    lines = text.split("\n")
    start = next((index for index, line in enumerate(lines) if TABLE_HEAD_RE.match(line)), None)
    if start is None:
        return None
    rows: list[str] = []
    for line in lines[start + 1 :]:
        if not line.startswith("|"):
            break
        if (row := ROW_RE.match(line)) is not None:
            rows.append(row.group(1))
    return rows


def _actions() -> dict[str, str]:
    """Every server action the frontend exports, mapped to the module exporting it."""
    found: dict[str, str] = {}
    for path in tracked_glob(FRONTEND_GLOB):
        if path.name.endswith(TEST_SUFFIXES):
            continue
        body = code_body(path)
        if DIRECTIVE_RE.match(body) is None:
            continue
        for name in EXPORT_RE.findall(body):
            found.setdefault(name, path.relative_to(REPO_ROOT).as_posix())
    return found


def check_action_table() -> list[Finding]:
    """The table's rows and the exported server actions, required to agree both ways."""
    rel = ACTION_TABLE_PAGE
    page = tracked_page(rel)
    if page is None:
        # Absence is `checks.py :: check_inputs`' finding, as `error_codes.py` reads its own page.
        if (REPO_ROOT / rel).exists():
            return [Finding("fail", ACTION_TABLE_CHECK, rel, "untracked, so the server actions were held to nothing")]
        return []
    if (text := _readable(page)) is None:
        return [Finding("fail", ACTION_TABLE_CHECK, rel, "unreadable, so the server actions were held to nothing")]
    actions = _actions()
    rows = _rows(text)
    if rows is None:
        if not actions:
            return []
        return [Finding("fail", ACTION_TABLE_CHECK, rel, "heads no table `Action`, so the server actions were held to nothing")]
    found: list[Finding] = []
    for name in sorted(set(actions) - set(rows)):
        detail = f"`{actions[name]}` exports `{name}`, a server action this table gives no row"
        found.append(Finding("fail", ACTION_TABLE_CHECK, rel, detail))
    for name in sorted(set(rows) - set(actions)):
        detail = f'`{name}` has a row and is exported by no module under `fl_frontend/src` opening on `"use server"`'
        found.append(Finding("fail", ACTION_TABLE_CHECK, rel, detail))
    return found
