"""SCRIPTS · the comment-only classifier the scope check decides on.

A wrong answer here narrows what a gate run proves without failing anything, so the table below
drives one pair of versions per language and asserts the carve-out reaches exactly as far as a
parser does. The TypeScript rows answer differently with the frontend uninstalled, which is the
degradation the classifier exists to make safe rather than a condition to skip on.
"""

from __future__ import annotations

import importlib
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final

SCRIPTS: Final = Path(__file__).resolve().parents[1]

# Withdrawn again, kernel dropped from the cache with it: `test_check_docs.py` runs the gate from a
# throwaway copy of scripts/, and a `checker_kernel` cached here would root its checks here too.
sys.path.insert(0, str(SCRIPTS))
try:
    scope = importlib.import_module("check_scope")
finally:
    sys.path.remove(str(SCRIPTS))
    sys.modules.pop("check_scope", None)
    sys.modules.pop("checker_kernel", None)

HASH: Final = chr(35)

PY_OLD: Final = f'"""A module."""\n\n{HASH} why the total is held here\nTOTAL = 3\n'
PY_COMMENTED: Final = f'"""A module."""\n\n{HASH} why the total is held here, at more length\nTOTAL = 3\n'
PY_MOVED: Final = f'"""A module."""\n\n{HASH} why\n{HASH} the total\n{HASH} is held here\nTOTAL = 3\n'
PY_CHANGED: Final = f'"""A module."""\n\n{HASH} why the total is held here\nTOTAL = 4\n'
PY_REDOCUMENTED: Final = f'"""A module, described at more length."""\n\n{HASH} why the total is held here\nTOTAL = 3\n'
# A body that is nothing but its docstring: removing it has to leave a statement behind or the
# comparison is made against a tree that will not parse.
PY_DOC_ONLY: Final = '"""A module."""\n'
PY_DOC_ONLY_RESAID: Final = '"""A module, said again."""\n'
# The marker inside a string is data. A classifier reading `#` rather than a parse would call this
# a comment edit and drop the scope that runs the code around it.
PY_MARKER_IN_STRING: Final = f'"""A module."""\n\nPREFIX = "{HASH} one"\n'
PY_MARKER_IN_STRING_CHANGED: Final = f'"""A module."""\n\nPREFIX = "{HASH} two"\n'
PY_BROKEN: Final = f'"""A module."""\n\n{HASH} why\nTOTAL = = 3\n'

TOML_OLD: Final = f'{HASH} why the name is pinned\nname = "gate"\n'
TOML_COMMENTED: Final = f'{HASH} why the name is pinned, at more length\nname = "gate"\n'
TOML_CHANGED: Final = f'{HASH} why the name is pinned\nname = "other"\n'
TOML_BROKEN: Final = f'{HASH} why\nname = = "gate"\n'

TS_OLD: Final = "// why the total is held here\nexport const total = 3;\n"
TS_COMMENTED: Final = "// why the total is held here, at more length\nexport const total = 3;\n"
TS_CHANGED: Final = "// why the total is held here\nexport const total = 4;\n"
TSX_OLD: Final = "// why the badge is its own element\nexport const Badge = () => <b>ok</b>;\n"
TSX_COMMENTED: Final = "// why the badge is its own element, at more length\nexport const Badge = () => <b>ok</b>;\n"
TSX_CHANGED: Final = "// why the badge is its own element\nexport const Badge = () => <b>no</b>;\n"

# Suffixes no parser here answers for. Identical content on both sides, so only the rule that an
# unproven file counts as code can decide them.
UNPROVEN: Final[tuple[str, ...]] = (".sh", ".md", ".yml", ".json", ".mjs", ".css", "")


@dataclass(frozen=True)
class Pair:
    """Two versions of one file, and whether a parser may call the difference comments alone.

    `same` is None where only the TypeScript toolchain can answer: with the frontend uninstalled
    the row degrades to code, which is the safe direction.
    """

    name: str
    suffix: str
    old: str
    new: str
    same: bool | None


PAIRS: Final[tuple[Pair, ...]] = (
    Pair("a python comment reworded", ".py", PY_OLD, PY_COMMENTED, True),
    Pair("a python statement pushed down by comments", ".py", PY_OLD, PY_MOVED, True),
    Pair("a python value changed", ".py", PY_OLD, PY_CHANGED, False),
    Pair("a python docstring rewritten", ".py", PY_OLD, PY_REDOCUMENTED, True),
    Pair("a module that is only its docstring", ".py", PY_DOC_ONLY, PY_DOC_ONLY_RESAID, True),
    Pair("a comment marker inside a python string", ".py", PY_MARKER_IN_STRING, PY_MARKER_IN_STRING_CHANGED, False),
    Pair("python the parser refuses", ".py", PY_OLD, PY_BROKEN, False),
    Pair("a toml comment reworded", ".toml", TOML_OLD, TOML_COMMENTED, True),
    Pair("a toml value changed", ".toml", TOML_OLD, TOML_CHANGED, False),
    Pair("toml the parser refuses", ".toml", TOML_OLD, TOML_BROKEN, False),
    Pair("a typescript comment reworded", ".ts", TS_OLD, TS_COMMENTED, None),
    Pair("a typescript value changed", ".ts", TS_OLD, TS_CHANGED, False),
    # The script kind comes off the extension, so JSX parses as syntax errors under a `.ts` name and
    # the answer degrades to code without anybody being told.
    Pair("a tsx comment reworded", ".tsx", TSX_OLD, TSX_COMMENTED, None),
    Pair("a tsx element changed", ".tsx", TSX_OLD, TSX_CHANGED, False),
    Pair("an mts comment reworded", ".mts", TS_OLD, TS_COMMENTED, None),
    Pair("a cts comment reworded", ".cts", TS_OLD, TS_COMMENTED, None),
)


def _typescript_answers() -> bool:
    """Whether the delegated parser can run at all, asked of the toolchain rather than of the answer."""
    installed = SCRIPTS.parent / "fl_frontend" / "node_modules" / "typescript" / "package.json"
    return shutil.which("node") is not None and installed.is_file()


def test_every_pair_is_classified_the_way_the_carve_out_reaches() -> None:
    """A row that reads False where it should read True costs a wider gate run; the other direction ships unproven code."""
    answers = _typescript_answers()
    wrong: list[str] = []
    for pair in PAIRS:
        want = answers if pair.same is None else pair.same
        got = scope.same_but_for_comments(pair.suffix, pair.old, pair.new)
        if got is not want:
            wrong.append(f"{pair.name} ({pair.suffix}): answered {got}, and the carve-out gives it {want}")
    assert not wrong, "\n".join(wrong)


def test_a_file_no_parser_here_answers_for_counts_as_code() -> None:
    """Identical on both sides, so nothing but the rule itself can decide them -- and the rule is that unproven is code."""
    for suffix in UNPROVEN:
        assert suffix not in scope.PARSEABLE, f"{suffix} is parseable, so it is not evidence for this rule"
        assert scope.same_but_for_comments(suffix, TS_OLD, TS_OLD) is False, f"{suffix} was called comments alone"


def test_every_parseable_suffix_is_driven_by_a_pair() -> None:
    """A suffix added to the carve-out without a pair here would widen it with nothing holding the new parser to anything."""
    assert scope.PARSEABLE
    assert {pair.suffix for pair in PAIRS} == set(scope.PARSEABLE)


def test_a_finding_names_the_files_up_to_the_bound_and_counts_the_rest() -> None:
    """The list is what an operator re-runs the gate against, so a silent truncation sends them at the wrong scope."""
    paths = [f"a{index}.py" for index in range(scope.MAX_NAMED_FILES + 2)]
    assert scope.named_list(paths[: scope.MAX_NAMED_FILES]) == ", ".join(paths[: scope.MAX_NAMED_FILES])
    listed = scope.named_list(paths)
    assert listed.endswith(f", and {len(paths) - scope.MAX_NAMED_FILES} more")
    assert paths[scope.MAX_NAMED_FILES] not in listed
