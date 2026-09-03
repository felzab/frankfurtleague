"""SCRIPTS · the documentation gate's corpus checks, and the run that drives them.

A page-kind check resolves its input through the tracked corpus, so an absent input is `inputs`'
finding and an untracked one the reading check's own; a check whose input is missing says so,
never passes. A per-file check holds a comment to what a page is held to (INC-6), and one defect
yields one finding: a line citation is stepped over by the path check, and a backticked path never
reaches the bare-path check. The diff-reading checks are `branch.py`'s, imported here for the run
alone; the readers, caches and vocabulary are `kernel.py`'s; the German copy rules are
`copy_rules.py`'s.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from functools import cache
from pathlib import Path, PurePosixPath
from typing import Final

import check_pr_body
import checker_kernel
from checker_kernel import git

from .branch import (
    Branch,
    branch_additions,
    check_added_citations,
    check_branch_diff,
    check_comment_bounds,
    check_history_phrases,
    check_prose_shas,
)
from .copy_rules import check_copy_rules
from .kernel import (
    BACKTICK_RE,
    BACKTICK_SPAN_RE,
    CHECKS,
    CSTYLE_SUFFIXES,
    DIRECTIVE_RE,
    DOCS_DIR,
    ENTRY_TOKEN_ALPHABET,
    ENTRY_TOKEN_PATTERN,
    GLOSSARY_PAGE,
    OPS_FILENAMES,
    OVERVIEW_GLOB,
    REPO_PREFIXES,
    REPO_ROOT,
    ROADMAP_PAGE,
    SCANNED_SUFFIXES,
    SPEC_GLOB,
    STANDARD_PAGE,
    SWEEP_PAGE,
    TEMPLATES_PAGE,
    Finding,
    _header_line,
    _module_header,
    _read_text,
    _readable,
    _scan_body,
    _tree_index,
    _untracked_index,
    anchors_of,
    atx_heading,
    comment_runs,
    comment_style,
    defined_symbols,
    is_entry_token,
    is_gitignored,
    is_placeholder,
    line_of,
    repo_path,
    scanned_files,
    strip_fences,
    tracked_glob,
    tracked_page,
    unlisted,
    word_count,
)
from .platform import check_platform_branches, check_text_writes

# --- what a page's kind decides ------------------------------------------------------------------

# The label is bounded because a bold sentence ending in a colon is prose, and holding prose to a
# layout rule gets a check ignored.
METADATA_LINE_RE: Final = re.compile(r"^\*\*([A-Z][A-Za-z ]{0,30}):\*\*(?:\s|$)")
# Whitespace before the second label is spared: a report header may carry fields on one physical
# line on purpose.
METADATA_JOIN_RE: Final = re.compile(r"(?:(\\n)\s*|(?<=\S))\*\*([A-Z][A-Za-z ]{0,30}):\*\*")


RULE_HEAD_RE: Final = re.compile(r"^((?:PRE|COR|INC|OUT|DEC|CUR)-\d{1,2})\b(.*)$")
# The indent-tolerant twin of `METADATA_LINE_RE`, which no check calls: it exists for the corpus to
# cite through `check_docs.py`'s re-export when arguing what an anchored pattern cannot reach.
RULE_FIELD_RE: Final = re.compile(r"^[ \t]*\*\*([A-Z][A-Za-z ]{0,30}):\*\*", re.MULTILINE)
RULE_INDEX_LINE_RE: Final = re.compile(r"^[ \t]*[-*]\s+\*\*((?:PRE|COR|INC|OUT|DEC|CUR)-\d{1,2}):\*\*", re.MULTILINE)
# Runs to the next rule bullet or heading, not to a blank line: a list item's continuation is
# indented under it, so a blank line inside one ends nothing.
RULE_INDEX_BLOCK_RE: Final = re.compile(
    r"^[ \t]*[-*]\s+\*\*(?:PRE|COR|INC|OUT|DEC|CUR)-\d{1,2}:\*\*(.*?)"
    r"(?=^[ \t]*[-*][ \t]+\*\*(?:PRE|COR|INC|OUT|DEC|CUR)-|^#|\Z)",
    re.MULTILINE | re.DOTALL,
)
# Either emphasis marker: prettier rewrites `*text*` to `_text_`, so matching one spelling leaves
# the claim unresolved from the first format run rather than from the moment it was written.
INDEX_ENFORCED_RE: Final = re.compile(r"[*_]Enforced by[*_](.*)", re.DOTALL)

# PRE-4 closes the `Enforced by` field's vocabulary, so a bare backticked lower-case token in it
# names a check.
CHECK_NAME_RE: Final = re.compile(r"`([a-z][a-z0-9-]*)`")

SEGMENT_HEADER_RE: Final = re.compile(r"^[ \t]*\|\s*Segment\s*\|\s*Globs\s*\|", re.MULTILINE)
EXCLUDED_HEADER_RE: Final = re.compile(r"^[ \t]*\|\s*Excluded\s*\|\s*Why\s*\|", re.MULTILINE)
# A folder moved wholesale unclaims every file under it, and a finding printing hundreds of paths
# is one nobody reads.
SEGMENT_SAMPLE: Final = 8


# The checker whose quoted fragments `template-fragment` confirms, named so a fault in the list
# itself points at the file to fix rather than at the form it reads.
PR_BODY_CHECKER: Final = "scripts/checks/check_pr_body.py"

# A page that is not there yields nothing, so an absent input degrades the check reading it to
# silence with the run green. Named here so the absence itself fails.
REQUIRED_INPUTS: Final[tuple[str, ...]] = (
    STANDARD_PAGE,
    ROADMAP_PAGE,
    TEMPLATES_PAGE,
    GLOSSARY_PAGE,
    SWEEP_PAGE,
)

# The file both byte checks answer to, and what each names when the fault is the listing rather
# than one path inside it.
GITATTRIBUTES: Final = ".gitattributes"
# `git ls-files --eol` answers endings, attributes and git's text/binary verdict in one call.
LS_FILES_EOL_RE: Final = re.compile(r"^i/(\S+)\s+w/(\S+)\s+attr/(.*?)\s*\t(.*)$")
# Binary reads as `-text` and never appears here, which is what a PNG needs: it holds CR-LF byte
# pairs legitimately.
NON_LF_WORKTREE: Final[tuple[str, ...]] = ("crlf", "mixed")
# What `.gitattributes` gives `*.bat` and `*.cmd`, and the only thing that exempts a file.
CRLF_MANDATED: Final = "eol=crlf"
# What `.gitattributes`' `binary` macro expands to, and the only thing that exempts a file from
# `check_binary_bytes`: content cannot decide it, the byte hunted there being what misleads git.
DECLARED_BINARY: Final = "-text"

# The closing sections are fixed so a growing contract cannot push Invariants down and silently
# repoint every citation of section 3 — which is what makes an invariant number safe to cite.
SPEC_SECTIONS: Final[tuple[str, ...]] = ("1. Contract", "2. Invariants", "3. Violation → remedy", "4. Known-open")
SPEC_SUBSECTION_RE: Final = re.compile(r"^1\.(\d+)\b")
SPEC_COLUMNS: Final = 3
# `L` is the logging sheet's prefix and `I` every other sheet's. A citation crosses surfaces often
# enough that an id is resolved against every sheet.
INVARIANT_ID_RE: Final = re.compile(r"^[ \t]*\|\s*([IL]\d{1,3}[a-z]?)\s*\|", re.MULTILINE)
INVARIANT_REF_RE: Final = re.compile(r"(?<![A-Za-z0-9])([IL]\d{1,3}[a-z]?)(?![A-Za-z0-9])")
# The invariant table's other rows: what `INVARIANT_ID_RE` skips reaches no arm keyed on an id.
TABLE_ROW_RE: Final = re.compile(r"^[ \t]*\|")

OVERVIEW_OPENING: Final = "How it is organised"
OVERVIEW_CLOSING: Final = "Read next"

# Terms share an entry where the code and the domain spell the same thing differently, so the head
# allows a `/` or a `·` between them.
GLOSSARY_HEAD_RE: Final = re.compile(r"^`[^`]+`(?:\s*[/·]\s*`[^`]+`)*\s+—\s+\S.*$")
GLOSSARY_FIELD_RE: Final = re.compile(r"^[ \t]*\*\*([A-Za-z][A-Za-z ]*):\*\*", re.MULTILINE)
GLOSSARY_FIELDS: Final[tuple[str, ...]] = ("Is", "In code", "Trap", "See")


INVARIANT_ROW_RE: Final = re.compile(r"^[ \t]*\|\s*(I\d{1,3}[a-z]?)\s*\|", re.MULTILINE)


# `check_commits.py :: ENTRY_HEADING_DIFF_RE` reads this same heading out of a diff. The id is
# captured loose so a malformed one is caught against the alphabet rather than dropping out of a
# listing the alphabet selected (PRE-4).
ROADMAP_ENTRY_RE: Final = re.compile(r"^ {0,3}###[ \t]+`?([^\s`]+)`?[ \t]+·", re.MULTILINE)
# An index row is a table row opening on an id. The token's shape is what separates one from the
# file's other tables, and a heading is where a malformed id is caught instead.
ROADMAP_INDEX_ROW_RE: Final = re.compile(rf"^[ \t]*\|\s*`({ENTRY_TOKEN_PATTERN})`\s*\|(.*)$", re.MULTILINE)
# The index row's columns past the id, in the order `docs/_roadmap/protocol.md` states: a column
# order read out of the row instead would be whatever the row happened to carry.
ROADMAP_TAGS_CELL: Final = 1
ROADMAP_ROW_CELLS: Final = 3
# Closed exists for no commit at all: the `Closes:` trailer concluding an entry deletes it.
ROADMAP_TRANSIENT_STATUS: Final = "Closed"

# One table row's cells, the outer pipes' empty halves dropped.
TABLE_LINE_RE: Final = re.compile(r"^[ \t]*\|(.*)\|[ \t]*$")

# `docs/_roadmap/items.md`'s tag derivation table, as far as a path can carry it. A path is
# resolved before it is matched, so a prefix here is a real subtree rather than a spelling.
TAG_PATH_SOURCES: Final[tuple[tuple[str, tuple[str, ...]], ...]] = (
    ("FE", ("fl_frontend/",)),
    ("BE", ("fl_backend/",)),
    ("DB", ("fl_backend/app/core/crud.py",)),
    ("Ops", ("scripts/", "nginx/", ".githooks/")),
    # A `corpus` row's paths would be this row's exactly, which is one fact stated twice (COR-2).
    ("Docs", ("docs/", ".claude/")),
    ("gate", ("scripts/gate/", "scripts/checks/", ".githooks/")),
    ("ci", (".github/",)),
    ("tests", ("scripts/tests/", "fl_backend/tests/")),
    ("edge", ("nginx/",)),
)
# The axes, in the order the Tags cell writes them. A slice is the third axis and the tree's own,
# so it is not spelled here.
SURFACE_TAGS: Final[tuple[str, ...]] = ("FE", "BE", "DB", "Ops", "Docs")
CONCERN_TAGS: Final[tuple[str, ...]] = ("gate", "ci", "tests", "edge", "versions")
STATIC_TAGS: Final[frozenset[str]] = frozenset(SURFACE_TAGS + CONCERN_TAGS)

# The slice axis groups a feature across the stack, and both roots spell a slice the same way.
SLICE_ROOTS: Final[tuple[tuple[str, ...], ...]] = (
    ("fl_frontend", "src", "features"),
    ("fl_backend", "app", "api"),
)
# Two tags have a source no path and no token states: a collection name and an index for `DB`, a
# manifest this list does not know for `versions`.
TAGS_DERIVED_ONE_WAY: Final[frozenset[str]] = frozenset({"DB", "versions"})
# `versions`' mechanical half: a digest, and an action pinned to a commit.
VERSION_MARK_RE: Final = re.compile(r"sha256:[0-9a-f]{8,}|@[0-9a-f]{40}\b")
VERSION_FILENAMES: Final[frozenset[str]] = frozenset({"package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "uv.lock", "pyproject.toml"})
# `edge`' and `Ops`' shared source: a compose service definition. `edge`'s other non-path source.
COMPOSE_FILENAMES: Final[frozenset[str]] = frozenset({"docker-compose.yml", "docker-compose.local.yml"})
EDGE_WORD_RE: Final = re.compile(r"\bCloudflare\b")
# A tag cell lists several, and the page separates them with either mark.
TAG_SEPARATOR_RE: Final = re.compile(r"[,·]")

# The one relation the tags cannot express: entries that land together because they share a pass.
# Whether the batch is still worth doing is nobody's to hold mechanically, so only the tokens on
# the line are resolved.
BATCH_LINE_RE: Final = re.compile(r"^[ \t]*Lands with:[ \t]*(.+?)[ \t]*$", re.MULTILINE)

# Quoted and backticked spans come out first: naming the phrase to ban it, as the rule itself
# does, is a mention rather than a use.
OWNER_PHRASE_RE: Final = re.compile(r"\bthe owner\b", re.IGNORECASE)
QUOTED_SPAN_RE: Final = re.compile(r"\"[^\"\n]*\"|`[^`\n]*`|“[^”\n]*”")
OWNER_EXEMPT_PREFIX: Final = ".claude/"


def _tracked_text(rel: str) -> str | None:
    """One named page's fence-stripped body, or None where the tracked corpus does not yield it."""
    page = tracked_page(rel)
    return None if page is None else _readable(page)


def rule_blocks(text: str) -> list[tuple[str, str, str]]:
    """Each section rule the standard states: id, the rest of the heading line, and the lines under it.

    Ends at the next heading of any level, so a rule's fields never come from the rule below.
    Fenced examples arrive already blanked.
    """
    lines = text.split("\n")
    starts = [(number, head) for number, line in enumerate(lines) if (head := atx_heading(line, 3)) is not None]
    blocks: list[tuple[str, str, str]] = []
    for position, (number, head) in enumerate(starts):
        if (match := RULE_HEAD_RE.match(head)) is None:
            continue
        end = starts[position + 1][0] if position + 1 < len(starts) else len(lines)
        end = next((index for index in range(number + 1, end) if atx_heading(lines[index]) is not None), end)
        blocks.append((match.group(1), match.group(2), "\n".join(lines[number + 1 : end])))
    return blocks


def rule_ids() -> dict[str, list[str]]:
    """Every rule id `docs/standard.md` defines, mapped to its homes (PRE-4).

    Empty when the standard is gone, so every cited id then fails. More than one entry under an id
    is a duplicate home, which `rule-id` reports at every citer.
    """
    ids: dict[str, list[str]] = {}
    text = _tracked_text(STANDARD_PAGE)
    if text is None:
        return ids
    for rule_id, _, _ in rule_blocks(text):
        ids.setdefault(rule_id, []).append("a section")
    for rule_id in RULE_INDEX_LINE_RE.findall(text):
        ids.setdefault(rule_id, []).append("a list line")
    return ids


def invariant_ids() -> dict[str, list[str]]:
    """Every `I<n>` an invariant table defines, mapped to the sheets defining it.

    OUT-4 makes a number permanent per sheet, not unique across them, so one id names different
    rules on different sheets -- hence the list.
    """
    ids: dict[str, list[str]] = {}
    for spec in tracked_glob(SPEC_GLOB):
        if (text := _read_text(spec)[0]) is None:
            continue
        rel = spec.relative_to(REPO_ROOT).as_posix()
        for match in INVARIANT_ROW_RE.finditer(text):
            homes = ids.setdefault(match.group(1), [])
            if rel not in homes:
                homes.append(rel)
    return ids


def check_metadata_breaks(rel: str, body: str) -> list[Finding]:
    """COR-8's hard break sits on a metadata entry's LAST physical line.

    An unlabelled line continues the entry above it, so "last" is not the labelled line.
    """
    lines = body.split("\n")
    found: list[Finding] = []
    index = 0
    while index < len(lines):
        if METADATA_LINE_RE.match(lines[index]) is None:
            index += 1
            continue
        names: list[str] = []
        ends: list[int] = []
        while index < len(lines) and lines[index].strip() and atx_heading(lines[index]) is None:
            if match := METADATA_LINE_RE.match(lines[index]):
                names.append(match.group(1))
                ends.append(index)
                # Backticked spans come out first: a rule quoting a label to name it is a mention,
                # not a second entry. Re-matched on the scrubbed line, removing a span having
                # moved every offset after it.
                scrubbed = BACKTICK_SPAN_RE.sub("", lines[index])
                opening = METADATA_LINE_RE.match(scrubbed)
                if opening and (joined := METADATA_JOIN_RE.search(scrubbed, opening.end())):
                    written = "the characters \\n" if joined.group(1) else "nothing at all"
                    detail = (
                        f"the {match.group(1)} line runs into {joined.group(2)} on one physical line"
                        f" -- COR-8's break is a line ending, written here as {written}"
                    )
                    found.append(Finding("fail", "metadata-break", rel, detail, index + 1))
            elif names:
                ends[-1] = index
            index += 1
        for position, (name, end) in enumerate(zip(names, ends, strict=True)):
            # The last entry carries no break, having nothing below it to part from.
            wanted = position < len(names) - 1
            if lines[end].rstrip().endswith("\\") is not wanted:
                verb = "needs" if wanted else "must not carry"
                found.append(Finding("fail", "metadata-break", rel, f"the {name} line {verb} COR-8's trailing hard break", end + 1))
    return found


def check_owner_voice(rel: str, body: str) -> list[Finding]:
    """COR-11: no tracked file outside `.claude/` names its author in the third person."""
    if rel.startswith(OWNER_EXEMPT_PREFIX):
        return []
    mentions_removed = QUOTED_SPAN_RE.sub("", body)
    if OWNER_PHRASE_RE.search(mentions_removed) is None:
        return []
    return [Finding("fail", "owner-voice", rel, "names “the owner” -- write it in the first person or as a neutral imperative (COR-11)")]


def check_roadmap() -> list[Finding]:
    """The roadmap agrees with itself: index and entries, ids, tags, batches, no transient status.

    Nothing here reads a position: entries are categorised by their tags rather than ordered.
    """
    rel = ROADMAP_PAGE
    page = tracked_page(rel)
    if page is None:
        # Absence is `check_inputs`' alone. A page on disk but untracked is neither absent nor
        # selected by anything reading the corpus, so this is the one place it is not green.
        if (REPO_ROOT / rel).exists():
            return [Finding("fail", "roadmap-shape", rel, "untracked, so the roadmap was read against nothing")]
        return []
    if (body := _readable(page)) is None:
        return [Finding("fail", "roadmap-shape", rel, "unreadable, so the roadmap was read against nothing")]
    return _check_roadmap_page(rel, body)


def _entry_sections(body: str) -> list[tuple[str, str]]:
    """Each entry as the id its heading carries and the lines under it, in the page's own order."""
    lines = body.split("\n")
    # Every heading carrying the separator, whatever the id looks like: this is the listing the id
    # itself is judged from, so selecting by a well-formed id would leave a malformed one unjudged
    # (PRE-4).
    opened = [(match.group(1), number) for number, line in enumerate(lines) if (match := ROADMAP_ENTRY_RE.match(line))]
    sections: list[tuple[str, str]] = []
    for token, start in opened:
        end = next((n for n in range(start + 1, len(lines)) if _leaves_entry(lines[n])), len(lines))
        sections.append((token, "\n".join(lines[start:end])))
    return sections


def _leaves_entry(line: str) -> bool:
    """Whether a line ends the entry above it: any heading down to an entry's own level."""
    return any(atx_heading(line, level) is not None for level in (1, 2, 3))


def _table_rows(text: str) -> list[list[str]]:
    """Every pipe-table row in some text, as its cells. The delimiter row comes back as its dashes."""
    rows: list[list[str]] = []
    for line in text.split("\n"):
        if (match := TABLE_LINE_RE.match(line)) is not None:
            rows.append([cell.strip() for cell in match.group(1).split("|")])
    return rows


def _check_roadmap_page(rel: str, body: str) -> list[Finding]:
    """The file's entries against its index table, its ids, its batches and the tags they name."""
    found: list[Finding] = []
    sections = _entry_sections(body)
    rows = {match.group(1): match.group(2) for match in ROADMAP_INDEX_ROW_RE.finditer(body)}

    seen: set[str] = set()
    for token, _ in sections:
        if not is_entry_token(token):
            detail = f"entry id `{token}` is not four characters of `{ENTRY_TOKEN_ALPHABET}`, a hyphen, and four more"
            found.append(Finding("fail", "roadmap-shape", rel, detail))
        elif token in seen:
            found.append(Finding("fail", "roadmap-shape", rel, f"a second entry carries the id {token} -- an id names one entry"))
        seen.add(token)
    # The pairing below runs over the well-formed ids alone: a malformed one matches no index row
    # either, and reporting that too would give one defect two findings.
    valid = {token for token in seen if is_entry_token(token)}

    for token in sorted(valid - set(rows)):
        found.append(Finding("fail", "roadmap-shape", rel, f"entry {token} has no row in the index table"))
    for token in sorted(set(rows) - valid):
        found.append(Finding("fail", "roadmap-shape", rel, f"index row {token} has no entry below it"))

    paired = [(token, section) for token, section in sections if token in valid and token in rows]
    found.extend(_check_flat_run(rel, body))
    found.extend(_check_batches(rel, valid, paired))
    found.extend(_check_transient_status(rel, rows, paired))
    found.extend(_check_derived_tags(rel, rows, paired))
    return found


def _check_flat_run(rel: str, body: str) -> list[Finding]:
    """No section heading stands between two entries.

    A heading grouping entries is a category, and the tags are where a category lives: kept in both
    places it is a fact somebody has to keep true twice.
    """
    lines = body.split("\n")
    entries = [number for number, line in enumerate(lines) if ROADMAP_ENTRY_RE.match(line)]
    if not entries:
        return []
    found: list[Finding] = []
    # A closing section below the last entry is outside the run and left alone.
    for number in range(entries[0], entries[-1]):
        if (heading := atx_heading(lines[number], 2)) is not None:
            detail = f"`{heading}` groups the entries below it -- the run is flat, and the tag column is the category"
            found.append(Finding("fail", "roadmap-shape", rel, detail, number + 1))
    return found


def _check_batches(rel: str, valid: set[str], paired: list[tuple[str, str]]) -> list[Finding]:
    """Each token an entry batches itself with names an entry this file holds.

    Resolution only: whether a batch is still worth doing is a judgement nothing mechanical holds,
    and a check that cannot fail honestly should not exist.
    """
    found: list[Finding] = []
    for token, section in paired:
        for match in BATCH_LINE_RE.finditer(section):
            named = [named.strip(" `") for named in match.group(1).split(",")]
            for other in sorted({one for one in named if one and one != token} - valid):
                detail = f"entry {token} lands with {other}, which is no entry here"
                found.append(Finding("fail", "roadmap-shape", rel, detail))
            if token in named:
                found.append(Finding("fail", "roadmap-shape", rel, f"entry {token} lands with itself"))
    return found


def _row_cells(rest: str) -> list[str]:
    """One index row's cells past the id, the closing pipe's empty half dropped."""
    cells = [cell.strip() for cell in rest.split("|")]
    return cells[:-1] if cells and not cells[-1] else cells


def _check_transient_status(rel: str, rows: dict[str, str], paired: list[tuple[str, str]]) -> list[Finding]:
    """`Closed` is written nowhere: the commit trailer concluding an entry deletes it instead.

    Both places a status is written, because a file half-converted carries the value in one of them
    and reads as clean from the other.
    """
    transient = f"{ROADMAP_TRANSIENT_STATUS} is no status -- the `Closes:` trailer concluding an entry deletes it"
    # The rows are walked once and the sections once, so an id carrying two entries reports its
    # row once rather than per entry.
    found = [
        Finding("fail", "roadmap-shape", rel, f"index row {token} states {transient}")
        for token in sorted({token for token, _ in paired})
        if ROADMAP_TRANSIENT_STATUS in _row_cells(rows[token])
    ]
    found.extend(
        Finding("fail", "roadmap-shape", rel, f"entry {token} states {transient}")
        for token, section in paired
        if any(ROADMAP_TRANSIENT_STATUS in cells for cells in _table_rows(section))
    )
    return found


def _named_paths(section: str) -> frozenset[str]:
    """Every repository path an entry names, resolved from its backticked tokens.

    The path check's own resolver, so a token this cannot place is one that check already failed
    rather than a path the derivation below silently missed.
    """
    found: set[str] = set()
    for token in BACKTICK_RE.findall(section):
        if (rel := repo_path(token.split(" :: ")[0].strip())) is not None:
            found.add(rel)
    return frozenset(found)


@cache
def slice_names() -> frozenset[str]:
    """Every slice the code defines, walked off the tree.

    A list of slices is a value the repository states elsewhere, so it would go stale with the gate
    green either way (COR-4).
    """
    found: set[str] = set()
    for root in SLICE_ROOTS:
        base = REPO_ROOT.joinpath(*root)
        if base.is_dir():
            found.update(child.name for child in base.iterdir() if child.is_dir())
    return frozenset(found)


def _slice_segments(paths: frozenset[str]) -> frozenset[str]:
    """Every whole path segment the entry names.

    Anywhere in a path and not only under the two slice roots, because the frontend route tree
    carries a slice name too: `fl_frontend/src/app/admin/aktionen/page.tsx` is plainly an
    `aktionen` entry.
    """
    # Whole segments and never a substring: `spiele` opens `spieler`, both are live slices with
    # large trees, and a substring matcher tags every `spieler` path as the most-used slice in the
    # repository, wrong.
    return frozenset(segment for path in paths for segment in path.split("/"))


def _stray_root_segments(paths: frozenset[str]) -> frozenset[str]:
    """Every segment directly under a slice root.

    Root-scoped where the tag derivation is not: everything directly under `features/` or `api/`
    is a slice by construction, so one that is not is a file parked where a package belongs.
    """
    found: set[str] = set()
    for path in paths:
        segments = path.split("/")
        for root in SLICE_ROOTS:
            if tuple(segments[: len(root)]) == root and len(segments) > len(root):
                found.add(segments[len(root)])
    return frozenset(found)


def _derived_tags(section: str, paths: frozenset[str]) -> frozenset[str]:
    """The tags an entry's own text produces, by `docs/_roadmap/items.md`'s tag derivation table."""
    tags = {tag for tag, prefixes in TAG_PATH_SOURCES if any(path.startswith(prefixes) for path in paths)}
    names = {path.rsplit("/", 1)[-1] for path in paths}
    if names & VERSION_FILENAMES or VERSION_MARK_RE.search(section):
        tags.add("versions")
    if names & COMPOSE_FILENAMES:
        tags.update(("Ops", "edge"))
    if "Dockerfile" in names:
        tags.add("Ops")
    if any(name.endswith((".test.ts", ".test.tsx")) for name in names):
        tags.add("tests")
    if EDGE_WORD_RE.search(section):
        tags.add("edge")
    return frozenset(tags)


def _axis_of(tag: str, slices: frozenset[str]) -> int:
    """Which axis a tag belongs to, as the rank the Tags cell orders them by."""
    if tag in SURFACE_TAGS:
        return 0
    return 1 if tag in CONCERN_TAGS else 2 if tag in slices else 3


def _check_derived_tags(rel: str, rows: dict[str, str], paired: list[tuple[str, str]]) -> list[Finding]:
    """An index row's tags against the paths and symbols the entry under it names.

    Two routes required to agree (PRE-4): the row states the tags, and the entry's own prose is
    where they come from.
    """
    found: list[Finding] = []
    known = slice_names()
    vocabulary = STATIC_TAGS | known
    for token, section in paired:
        cells = _row_cells(rows[token])
        if len(cells) != ROADMAP_ROW_CELLS:
            detail = f"index row {token} carries {len(cells)} cell(s) past the id -- the columns are the claim, the tags and the status"
            found.append(Finding("fail", "roadmap-shape", rel, detail))
            continue
        paths = _named_paths(section)
        for stray in sorted(_stray_root_segments(paths) - known):
            detail = f"entry {token} names `{stray}` directly under a slice root, and the tree defines no such slice"
            found.append(Finding("fail", "roadmap-shape", rel, detail))
        # `admin` comes off the route group as well as off its feature package, a less precise tag
        # rather than a wrong one, and a carve-out for one segment outlives its reason.
        spanned = _slice_segments(paths) & known
        derived = _derived_tags(section, paths) | spanned
        if not derived:
            detail = f"entry {token} names no path a tag derives from -- an entry nobody can place is one whose subject is unstated"
            found.append(Finding("fail", "roadmap-shape", rel, detail))
            continue
        listed = [stripped for tag in TAG_SEPARATOR_RE.split(cells[ROADMAP_TAGS_CELL]) if (stripped := tag.strip())]
        written = set(listed)
        axes = [_axis_of(tag, known) for tag in listed]
        if axes != sorted(axes):
            detail = f"index row {token} lists its tags out of axis order -- the surfaces come first, then the concerns, then the slices"
            found.append(Finding("fail", "roadmap-shape", rel, detail))
        if unknown := sorted(written - vocabulary):
            found.append(Finding("fail", "roadmap-shape", rel, f"index row {token} carries {', '.join(unknown)}, which is no tag"))
        if missing := sorted(derived - written):
            detail = f"entry {token} names {', '.join(missing)} work and its index row does not carry that tag"
            found.append(Finding("fail", "roadmap-shape", rel, detail))
        # A DERIVED tag missing from the row still fails; a WRITTEN one is never faulted as
        # underived, or an entry about a collection would fail for naming it in prose.
        if stale := sorted((written & vocabulary) - derived - TAGS_DERIVED_ONE_WAY):
            detail = f"index row {token} carries {', '.join(stale)}, which nothing the entry names derives"
            found.append(Finding("fail", "roadmap-shape", rel, detail))
    return found


def _headings(body: str, level: int) -> list[str]:
    """The headings at one level, in the order the page carries them."""
    return [text for line in body.split("\n") if (text := atx_heading(line, level)) is not None]


def _section(body: str, heading: str) -> str:
    """One `## <heading>` section's body.

    Matched through `atx_heading`: a verbatim line match empties the section on a trailing space,
    and a subsection check over nothing passes.
    """
    lines = body.split("\n")
    start = next((index for index, line in enumerate(lines) if atx_heading(line, 2) == heading), None)
    if start is None:
        return ""
    end = next((index for index in range(start + 1, len(lines)) if atx_heading(lines[index], 2) is not None), len(lines))
    return "\n".join(lines[start + 1 : end])


def check_spec_sheets() -> list[Finding]:
    """OUT-4's spine over every spec sheet: its sections, and the contract's numbering.

    An added section repoints every citation of "section 3" without changing a word of one.
    """
    sheets = tracked_glob(SPEC_GLOB)
    if not sheets:
        return [Finding("fail", "spec-spine", DOCS_DIR, "no tracked spec sheet, so OUT-4's spine is checked against nothing")]

    found: list[Finding] = []
    for sheet in sheets:
        rel = sheet.relative_to(REPO_ROOT).as_posix()
        if (body := _readable(sheet)) is None:
            continue
        sections = tuple(_headings(body, 2))
        if sections != SPEC_SECTIONS:
            detail = f"sections are [{', '.join(sections)}] -- OUT-4 fixes them at [{', '.join(SPEC_SECTIONS)}]"
            found.append(Finding("fail", "spec-spine", rel, detail))
            continue
        subsections = _headings(_section(body, SPEC_SECTIONS[0]), 3)
        numbers = [int(match.group(1)) for line in subsections if (match := SPEC_SUBSECTION_RE.match(line))]
        if len(numbers) != len(subsections) or numbers != list(range(1, len(numbers) + 1)):
            detail = f"the contract's subsections are [{', '.join(subsections)}] -- OUT-4 numbers them 1.1 upward, without a gap"
            found.append(Finding("fail", "spec-spine", rel, detail))
    return found


def _separator_row(line: str) -> bool:
    """Whether a table row is the dashes parting a header from the rows beneath it."""
    cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
    return bool(cells) and all(cell and set(cell) <= set("-:") for cell in cells)


def _opens_a_table(lines: list[str], index: int) -> bool:
    """Whether the row at `index` opens a table: its header, or the separator under one.

    Markdown renders a table only where the two are adjacent, so adjacency is the whole test.
    """
    if not _separator_row(lines[index]):
        return _separator_row(lines[index + 1]) if index + 1 < len(lines) else False
    above = lines[index - 1] if index else ""
    return TABLE_ROW_RE.match(above) is not None and not _separator_row(above) and INVARIANT_ID_RE.match(above) is None


def check_invariant_tables() -> list[Finding]:
    """An invariant table holds invariant rows only, and cited ids resolve.

    A foreign row reads as an invariant, held to none of the shape rules keyed on the id pattern.
    Ids resolve across sheets, citing another surface's being ordinary.
    """
    sheets = tracked_glob(SPEC_GLOB)
    if not sheets:
        return [Finding("fail", "invariant-row", DOCS_DIR, "no tracked spec sheet, so no invariant table is checked")]

    bodies = {sheet: body for sheet in sheets if (body := _readable(sheet)) is not None}
    defined = {match for body in bodies.values() for match in INVARIANT_ID_RE.findall(_section(body, SPEC_SECTIONS[1]))}

    found: list[Finding] = []
    for sheet, body in bodies.items():
        rel = sheet.relative_to(REPO_ROOT).as_posix()
        seen: set[str] = set()
        lines = _section(body, SPEC_SECTIONS[1]).split("\n")
        for index, line in enumerate(lines):
            if (match := INVARIANT_ID_RE.match(line)) is None:
                if TABLE_ROW_RE.match(line) is not None and not _opens_a_table(lines, index):
                    # A stray separator excerpts to a row of dashes, which names nothing a reader can search for.
                    shape = "a separator under no header" if _separator_row(line) else f"'{line.strip()[:60]}'"
                    detail = f"a row in `## {SPEC_SECTIONS[1]}` is neither an invariant nor a header: {shape} (OUT-4)"
                    found.append(Finding("fail", "invariant-row", rel, detail))
                continue
            invariant = match.group(1)
            if invariant in seen:
                found.append(Finding("fail", "invariant-row", rel, f"{invariant} numbers two rows -- OUT-4 makes a number permanent"))
            seen.add(invariant)
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            if len(cells) != SPEC_COLUMNS:
                found.append(Finding("fail", "invariant-row", rel, f"{invariant} has {len(cells)} cells, not OUT-4's {SPEC_COLUMNS}"))
        for cited in sorted(set(INVARIANT_REF_RE.findall(body)) - defined):
            found.append(Finding("fail", "invariant-id", rel, f"cites {cited}, which no tracked spec sheet's invariant table defines"))
    return found


def check_overviews() -> list[Finding]:
    """OUT-5's spine: an overview opens on how the surface is organised and closes on where to go.

    One that stops naming its parts explains mechanisms the spec sheet owns.
    """
    overviews = tracked_glob(OVERVIEW_GLOB)
    if not overviews:
        return [Finding("fail", "overview-spine", DOCS_DIR, "no tracked overview, so OUT-5's spine is checked against nothing")]

    found: list[Finding] = []
    for overview in overviews:
        rel = overview.relative_to(REPO_ROOT).as_posix()
        if (body := _readable(overview)) is None:
            continue
        sections = _headings(body, 2)
        if not sections or sections[0] != OVERVIEW_OPENING:
            found.append(Finding("fail", "overview-spine", rel, f"does not open on '## {OVERVIEW_OPENING}' (OUT-5)"))
        if not sections or sections[-1] != OVERVIEW_CLOSING:
            found.append(Finding("fail", "overview-spine", rel, f"does not close on '## {OVERVIEW_CLOSING}' (OUT-5)"))
    return found


def _glossary_entries(body: str) -> list[tuple[str, str]]:
    """Each `### ` entry as its heading text and the lines under it, to the next entry."""
    lines = body.split("\n")
    starts = [(number, head) for number, line in enumerate(lines) if (head := atx_heading(line, 3)) is not None]
    return [
        (head, "\n".join(lines[number + 1 : starts[position + 1][0] if position + 1 < len(starts) else len(lines)]))
        for position, (number, head) in enumerate(starts)
    ]


def check_glossary() -> list[Finding]:
    """OUT-6's entry shape: the term as code spells it, a gloss, then the fields in order.

    `Trap` is why the glossary exists and the field a hurried entry drops.
    """
    rel = GLOSSARY_PAGE
    if (body := _tracked_text(rel)) is None:
        detail = "untracked, unreadable or missing, so the domain vocabulary is checked against nothing"
        return [Finding("fail", "glossary-entry", rel, detail)]

    found: list[Finding] = []
    entries = _glossary_entries(body)
    if not entries:
        return [Finding("fail", "glossary-entry", rel, "carries no `### <term>` entry (OUT-6)")]
    for head, rest in entries:
        if not GLOSSARY_HEAD_RE.match(head.strip()):
            found.append(Finding("fail", "glossary-entry", rel, f"the heading is not `` `<term>` — <gloss> `` (OUT-6): {head.strip()[:60]}"))
        fields = tuple(GLOSSARY_FIELD_RE.findall(rest))
        if fields != GLOSSARY_FIELDS:
            detail = f"'{head.strip()[:40]}' carries [{', '.join(fields)}] -- OUT-6 asks for [{', '.join(GLOSSARY_FIELDS)}]"
            found.append(Finding("fail", "glossary-entry", rel, detail))
    return found


def check_inputs() -> list[Finding]:
    """Every tree and page another check reads is present.

    A check treats an empty answer as nothing to say, so a moved input passes over nothing.
    Presence on disk, not in the index: untracked is a caller's own finding.
    """
    return [
        Finding("fail", "inputs", rel, "missing -- the check reading it would otherwise pass without examining anything")
        for rel in REQUIRED_INPUTS
        if not (REPO_ROOT / rel).exists()
    ]


@cache
def _eol_records() -> tuple[str, ...] | None:
    """Every `git ls-files --eol` record as git wrote it, or None where git refused.

    NUL-separated: git octal-escapes a path outside ASCII otherwise, and that spelling names a
    file no checkout holds.
    """
    listing = git("ls-files", "--eol", "-z")
    return None if listing is None else tuple(record for record in listing.split("\0") if record)


@cache
def _eol_rows() -> tuple[tuple[str, str, str], ...] | None:
    """The records parsed to (worktree endings, attributes, path), or None where git refused."""
    records = _eol_records()
    if records is None:
        return None
    return tuple((m.group(2), m.group(3), m.group(4)) for record in records if (m := LS_FILES_EOL_RE.match(record)))


def _eol_unread(check: str, unproven: str) -> list[Finding]:
    """This check's finding where the listing held records and the pattern reached none of them.

    An empty loop reports nothing and passes. A partial gap is ordinary rather than a fault: a
    staged deletion writes a record carrying no worktree field.
    """
    records, rows = _eol_records(), _eol_rows()
    if not records or rows is None or rows:
        return []
    detail = f"none of {len(records)} `git ls-files --eol` records matched a known shape, so {unproven}"
    return [Finding("fail", check, GITATTRIBUTES, detail)]


def check_line_endings() -> list[Finding]:
    """The working tree holds LF wherever `.gitattributes` mandates it.

    The declaration takes effect at commit, so a CRLF tree reads clean in the index and breaks
    where the file runs -- a shell script dies on its shebang on the server.
    """
    rows = _eol_rows()
    if rows is None:
        # A run that cannot read the index proves nothing about the tree, and silence is
        # indistinguishable from a clean answer.
        detail = "git could not report the tree's line endings, so nothing was held to `.gitattributes`"
        return [Finding("fail", "line-endings", GITATTRIBUTES, detail)]

    found = _eol_unread("line-endings", "nothing was held to `.gitattributes`")
    for worktree, attributes, rel in rows:
        if worktree not in NON_LF_WORKTREE or CRLF_MANDATED in attributes:
            continue
        detail = f"the working tree holds {worktree.upper()} line endings, and `{attributes}` mandates LF"
        found.append(Finding("fail", "line-endings", rel, detail))
    return found


def _byte_site(data: bytes, offset: int) -> tuple[int, str]:
    """One byte's line, and its place spelled for the other tool a reader reaches for: a hex dump.

    A dump counts from the file's first byte and an editor from the line's, so neither number
    answers for the other.
    """
    line = data.count(b"\n", 0, offset) + 1
    # `rfind` answers -1 where no newline precedes the byte, which makes the subtraction offset + 1.
    column = offset - data.rfind(b"\n", 0, offset)
    return line, f"offset {offset} (column {column})"


def check_binary_bytes() -> list[Finding]:
    """No file `.gitattributes` declares as text holds a NUL or a stray CR.

    Either stops git classifying its endings, so the LF mandate lapses -- and nothing else
    reports it, both being legal inside a string literal.
    """
    rows = _eol_rows()
    if rows is None:
        # A run that cannot list the tree read no bytes, and silence would be indistinguishable
        # from a clean answer.
        detail = "git could not list the tree, so no tracked file was read for a NUL or a CR byte"
        return [Finding("fail", "binary-byte", GITATTRIBUTES, detail)]

    found = _eol_unread("binary-byte", "no tracked file was read for a NUL or a CR byte")
    for worktree, attributes, rel in rows:
        # An exact token, never a substring: the exemption must not widen to an attribute that
        # merely ends in the word, which is how a rule like this grows to cover a source file.
        if DECLARED_BINARY in attributes.split():
            continue
        path = REPO_ROOT / rel
        # A staged deletion and a sparse checkout both leave a tracked path with no bytes on disk.
        # Judging one would fail a rename halfway through it.
        if not path.is_file():
            continue
        try:
            data = path.read_bytes()
        except OSError as error:
            found.append(Finding("fail", "binary-byte", rel, f"could not be opened, so nothing proved it holds no NUL and no CR: {error}"))
            continue
        if (offset := data.find(b"\x00")) >= 0:
            at_line, site = _byte_site(data, offset)
            detail = (
                f"a NUL byte at {site}. git then reads this file as binary, so `.gitattributes`' LF "
                "mandate stops applying to it and its diff becomes unreadable -- and no formatter, linter, type checker or "
                "test sees the byte, a NUL being legal inside a string literal. Repair: put the character that belongs "
                "there in its place, and save the file as UTF-8 with LF."
            )
            found.append(Finding("fail", "binary-byte", rel, detail, at_line))
        # CRLF where LF is mandated is `check_line_endings`' finding. Reporting it here as well would
        # give one file two repairs; what is left is the CR that check cannot see, git having given
        # up on the file rather than classified its endings.
        if worktree in NON_LF_WORKTREE or CRLF_MANDATED in attributes:
            continue
        if (offset := data.find(b"\r")) >= 0:
            at_line, site = _byte_site(data, offset)
            detail = (
                f"a CR byte at {site}. Every line here ends with LF alone, and a CR git cannot read as "
                "part of a CRLF pair leaves it unable to classify this file's endings, so `.gitattributes`' LF mandate "
                "lapses and CRLF commits through unwarned, while the diff still reads. Repair: delete the byte, and save "
                "the file as UTF-8 with LF."
            )
            found.append(Finding("fail", "binary-byte", rel, detail, at_line))
    return found


def check_enforced_by() -> list[Finding]:
    """A rule's enforcement claim names gate checks this script actually emits.

    Read from the one shape PRE-4 admits, a list line's `_Enforced by_`. A drifted claim is worse
    than an unenforced rule: it reads as covered.
    """
    text = _tracked_text(STANDARD_PAGE)
    if text is None:
        # The claims live in the standard itself, so its absence leaves nothing here to resolve;
        # `inputs` fails the absence, and `unreadable` a page that cannot be read.
        return []

    found: list[Finding] = []

    def resolve(field: str) -> None:
        field = " ".join(field.split())
        for name in CHECK_NAME_RE.findall(field):
            if name not in CHECKS:
                detail = f"claims enforcement by gate check `{name}`, which this gate does not emit: {field[:80]}"
                found.append(Finding("fail", "enforced-by", STANDARD_PAGE, detail))

    for block in RULE_INDEX_BLOCK_RE.findall(text):
        if (claim := INDEX_ENFORCED_RE.search(block)) is not None:
            resolve(claim.group(1))
    return found


def check_rule_shape() -> list[Finding]:
    """PRE-4 admits one shape, so a rule written as a section is one this gate cannot read."""
    text = _tracked_text(STANDARD_PAGE)
    if text is None:
        # Absence is `inputs`' finding; an untracked or unreadable standard also empties
        # `rule_ids`, which fails every citation through `rule-id`.
        return []

    # A section rule is invisible to `enforced-by`'s reader and doubles its id's homes for
    # `rule-id`, while every citation of it resolves, so the page reads as enforced and is not.
    found = [
        Finding(
            "fail",
            "rule-shape",
            STANDARD_PAGE,
            f"{rule_id} is written as a section -- PRE-4 gives a rule one shape, the list line `- **{rule_id}:** <the whole rule>`",
        )
        for rule_id, _, _ in rule_blocks(text)
    ]
    found.extend(
        Finding("fail", "rule-shape", STANDARD_PAGE, f"{rule_id}'s list line names nothing that enforces it -- PRE-4 requires the claim")
        for rule_id, block in _rule_lines(text)
        if INDEX_ENFORCED_RE.search(block) is None
    )
    return found


def _rule_lines(text: str) -> list[tuple[str, str]]:
    """Each rule the standard states as a list line, with the block running under it.

    Two patterns over one page, so a rule with nothing under it is still in the listing rather than
    dropping out of it (PRE-4).
    """
    ids = RULE_INDEX_LINE_RE.findall(text)
    blocks = RULE_INDEX_BLOCK_RE.findall(text)
    return list(zip(ids, blocks, strict=False))


def _glob_table(text: str, header: re.Pattern[str], glob_cell: int = 1) -> dict[str, list[str]] | None:
    """A two-column table's first cell against its backticked globs, or None if absent.

    Read from the command file rather than declared here, so the partition has one definition.
    """
    opening = header.search(text)
    if opening is None:
        return None
    rows: dict[str, list[str]] = {}
    for line in text[opening.end() :].split("\n")[1:]:
        if not line.lstrip().startswith("|"):
            break
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        # The separator row carries no name and no globs; anything else with a name is a row.
        if len(cells) < 2 or not (name := cells[0].strip("`")) or set(name) <= set("-: "):
            continue
        rows[name] = BACKTICK_RE.findall(cells[glob_cell])
    return rows


def check_segment_map() -> list[Finding]:
    """`/docs:audit`'s segments claim every tracked file the sweep does not exclude, exactly once.

    A file no segment claims reaches no agent and reads afterwards as audited.
    """
    rel = SWEEP_PAGE
    text = _tracked_text(rel)
    if text is None:
        return [Finding("fail", "segment-map", rel, "untracked or unreadable, so the sweep's partition cannot be held to the tree")]

    segments = _glob_table(text, SEGMENT_HEADER_RE)
    excluded = _glob_table(text, EXCLUDED_HEADER_RE, glob_cell=0)
    if not segments:
        return [Finding("fail", "segment-map", rel, "carries no `Segment` / `Globs` table -- the sweep's partition is what this check reads")]
    if excluded is None:
        return [Finding("fail", "segment-map", rel, "carries no `Excluded` / `Why` table -- without it every excluded file reads as unclaimed")]

    # NUL-separated for the reason `tracked_files` is: git quotes a path outside ASCII, and a
    # quoted spelling matches no glob -- so "the partition is total" would answer off a short list.
    listing = git("ls-files", "-z")
    if listing is None:
        # The partition is total or it is not, and an unlisted tree answers neither.
        return [Finding("fail", "segment-map", rel, "git could not list the tracked files, so the partition was held to nothing")]

    skip = [pattern for patterns in excluded.values() for pattern in patterns]
    unclaimed: list[str] = []
    shared: list[str] = []
    for tracked in (entry for entry in listing.split("\0") if entry):
        path = PurePosixPath(tracked)
        if any(path.full_match(pattern) for pattern in skip):
            continue
        owners = [name for name, patterns in segments.items() if any(path.full_match(pattern) for pattern in patterns)]
        if not owners:
            unclaimed.append(tracked)
        elif len(owners) > 1:
            shared.append(f"{tracked} ({', '.join(owners)})")

    found: list[Finding] = []
    if unclaimed:
        found.append(Finding("fail", "segment-map", rel, f"{len(unclaimed)} tracked file(s) belong to no segment: {_sample(unclaimed)}"))
    if shared:
        found.append(Finding("fail", "segment-map", rel, f"{len(shared)} tracked file(s) belong to more than one segment: {_sample(shared)}"))
    return found


def _sample(paths: list[str]) -> str:
    """The first few offending paths, and a count of whatever is left."""
    head = ", ".join(f"`{path}`" for path in sorted(paths)[:SEGMENT_SAMPLE])
    return head if len(paths) <= SEGMENT_SAMPLE else f"{head} and {len(paths) - SEGMENT_SAMPLE} more"


def check_template_fragments() -> list[Finding]:
    """The pull request form still carries every fragment the body gate quotes from it.

    `check_pr_body.py :: TEMPLATE_FRAGMENTS` matches that prose verbatim, so rewording the form
    leaves it passing every body, the unfilled one it exists to catch included.
    """
    if not check_pr_body.TEMPLATE_FRAGMENTS:
        detail = "quotes no fragment, so every unfilled pull request body reads as filled in and this check confirms nothing"
        return [Finding("fail", "template-fragment", PR_BODY_CHECKER, detail)]

    rel = TEMPLATES_PAGE
    page = tracked_page(rel)
    text = None if page is None else _read_text(page)[0]
    if text is None:
        return [Finding("fail", "template-fragment", rel, "untracked or unreadable, so the body gate's quoted fragments cannot be confirmed")]
    return [
        Finding("fail", "template-fragment", rel, f"no longer carries a fragment `check_pr_body.py :: TEMPLATE_FRAGMENTS` quotes: '{fragment}'")
        for fragment in check_pr_body.TEMPLATE_FRAGMENTS
        if fragment not in text
    ]


# --- INC-2's header anatomy ----------------------------------------------------------------------

# The header checks read a file's raw text rather than its scanned body: a header is defined by
# where it sits.

# A `See:` entry opens with what it points at, so the token is its first word and no separator
# needs enumerating. An entry opening with prose is skipped instead.
SEE_ENTRY_RE: Final = re.compile(r"\s+")

# Only a token carrying a suffix is resolved, so a bare folder in the reason half is not read as a
# dead path.
SUFFIXED_RE: Final = re.compile(r"\.[A-Za-z]{1,5}$")


# INC-2's header shapes, checked only where that rule binds. Presence is never checked: INC-2 fixes
# the shape of a header that exists, so a file with none passes unchecked.
HEADER_SCOPES: Final[tuple[tuple[str, tuple[str, ...]], ...]] = (
    # TypeScript is out of scope: INC-2 permits no header there, so a block opening one of its
    # files is an ordinary comment block, which `comment-length` bounds (INC-9).
    ("fl_backend/app/", (".py",)),
    ("fl_backend/tests/", (".py",)),
    ("scripts/", (".py", ".sh")),
)
# Words rather than lines: a header reflowed to fewer lines carries the same facts (INC-2).
HEADER_WORD_CAP: Final = 175
# A label line is one or two capitalised words ending in a colon: anything longer is wrapped prose,
# and flagging prose is the false positive that gets a check switched off.
HEADER_TITLE_RE: Final = re.compile(r"\S+ · \S.*")
HEADER_RULED_RE: Final = re.compile(r"─{3,}|-{8,}")
HEADER_SHOUTY_RE: Final = re.compile(r"[A-Z][A-Z ']{3,}")
HEADER_LABEL_RE: Final = re.compile(r"[A-Z][A-Za-z]*( [A-Za-z]+)?:")
HEADER_LABELS: Final[tuple[str, ...]] = ("Invariants:", "See:")


def _header_scoped(rel: str, suffix: str) -> bool:
    """True where INC-2 binds a file's header to its shape."""
    return any(rel.startswith(prefix) and suffix in suffixes for prefix, suffixes in HEADER_SCOPES)


def _misplaced_header(raw: str, suffix: str) -> tuple[int, list[str]] | None:
    """A header-shaped comment block that is not the file's opening one.

    The title line identifies it: nothing else opens a comment with `<TOKEN> · <text>`. A block
    with only blanks, a shebang and directives above it opens the file.
    """
    lines = raw.split("\n")
    for first_line, block in comment_runs(raw, suffix):
        title = next((text for text in block if text), "")
        if not HEADER_TITLE_RE.fullmatch(title):
            continue
        if all(not line.strip() or line.startswith("#!") or DIRECTIVE_RE.match(line) for line in lines[: first_line - 1]):
            continue
        return first_line, lines[first_line - 1 : first_line - 1 + len(block)]
    return None


def check_module_header(rel: str, raw: str, suffix: str) -> list[Finding]:
    """A module header in INC-2's scope keeps INC-2's shape.

    The retired vocabulary passes every compiler and linter, so nothing but this stops it creeping
    back.
    """
    found: list[Finding] = []
    header = _module_header(raw, suffix)
    if header is None:
        misplaced = _misplaced_header(raw, suffix)
        if misplaced is None:
            return []
        first_line, header = misplaced
        found.append(
            Finding(
                "fail",
                "module-header",
                rel,
                "the module header sits below the first statement -- INC-7 places it above the imports",
                first_line,
            )
        )
    stripped = [_header_line(line, suffix) for line in header]
    # `unlisted`, so INC-2's own `Invariants:` and `See:` lists are not charged a word per entry
    # for taking the shape COR-8 asks for -- the reason INC-9 already strips them.
    if (words := word_count(unlisted(stripped))) > HEADER_WORD_CAP:
        found.append(
            Finding(
                "fail",
                "module-header",
                rel,
                f"the module header runs {words} words -- INC-2 caps it at {HEADER_WORD_CAP}",
            )
        )
    title = next((text for text in stripped if text), "")
    if not HEADER_TITLE_RE.fullmatch(title):
        found.append(Finding("fail", "module-header", rel, f"the header's first content line is not `<token> · <text>` (INC-2): '{title}'"))
    for text in stripped:
        if HEADER_RULED_RE.search(text):
            found.append(Finding("fail", "module-header", rel, f"ruled line in the module header -- INC-2 bans drawn rules: '{text}'"))
        elif HEADER_SHOUTY_RE.fullmatch(text):
            found.append(Finding("fail", "module-header", rel, f"upper-case label row in the module header (INC-2): '{text}'"))
        elif HEADER_LABEL_RE.fullmatch(text) and text not in HEADER_LABELS:
            found.append(Finding("fail", "module-header", rel, f"header list label other than Invariants: or See: (INC-2): '{text}'"))
    return found


def check_header_see(rel: str, raw: str, suffix: str) -> list[Finding]:
    """A path on a module header's `See:` list resolves to a file that is there (INC-2).

    A `See:` entry is a pointer by construction, and package-relative, which `path` reads as prose
    and leaves.
    """
    header = _module_header(raw, suffix)
    if header is None:
        return []
    lines = [_header_line(line, suffix) for line in header]
    if "See:" not in lines:
        return []

    found: list[Finding] = []
    for entry in lines[lines.index("See:") + 1 :]:
        token = SEE_ENTRY_RE.split(entry.lstrip("- ").strip())[0].strip().strip("`")
        if "/" not in token or not SUFFIXED_RE.search(token) or is_placeholder(token):
            continue
        if repo_path(token) is None and not is_gitignored(token):
            found.append(Finding("fail", "header-see", rel, f"the See: entry `{token}` resolves to no file"))
    return found


# --- what a page points at, and whether it is still there ----------------------------------------

# A repository path in a comment with no backticks, which is how a dead one survives a green gate.
# Anchored on REPO_PREFIXES so prose cannot match, and ended on a word character.
BARE_PATH_RE: Final = re.compile(r"(?<![\w`/.\-])(?:" + "|".join(re.escape(p) for p in REPO_PREFIXES) + r")[\w./\-]*[\w/]")


# The fragment is captured rather than discarded: dropping it lets a link to a heading nobody has
# pass, the file it names still being there.
LINK_RE: Final = re.compile(r"""(?<!!)\[[^\]]*\]\(([^)\s#]*)(#[^)\s]*)?(?:[ \t]+"[^"\n]*"|[ \t]+'[^'\n]*')?\)""")


# A citation is a single backticked run containing exactly one " :: " (COR-6). Read it through
# `unwrapped`, never off the raw body: a code span may wrap, and this stops at the newline.
CITATION_RE: Final = re.compile(r"`([^`\n]+? :: [^`\n]+?)`")
# The continuation form: a page names a file once, then cites its symbols with the separator and
# the anchor alone. `CITATION_RE` needs a left half, so without this the form matches nothing and
# every claim it makes goes unresolved (INC-6).
CONTINUATION_RE: Final = re.compile(r"`:: ([^`\n]+?)`")


# One line break inside a paragraph, which a renderer joins to a space. The blank line is excluded
# and that is the whole bound: it ends the paragraph, so a join across one would swallow the next.
# Cached: one compile per marker set, not one per file.
@cache
def _wrap_re(markers: tuple[str, ...]) -> re.Pattern[str]:
    """The wrap, together with whatever the continuation line opens with.

    `comments_only` keeps a comment marker verbatim, so joining on whitespace alone puts the `//`
    or `#` INSIDE the anchor -- and `// serializeError` resolves to nothing.
    """
    tail = "(?:(?:" + "|".join(re.escape(m) for m in markers) + ")+[ \t]*)?" if markers else ""
    return re.compile(r"[ \t]*\n(?![ \t]*\n)[ \t]*" + tail)


def continuation_markers(style: str) -> tuple[str, ...]:
    """What a wrapped comment line opens with, for the reader `comment_style` picked."""
    return ("//", "*") if style in CSTYLE_SUFFIXES or style == ".json" else ("#",)


# Two segments and a short number, so the backend's three-segment error codes cannot collide.
RULE_ID_RE: Final = re.compile(r"\b((?:PRE|COR|INC|OUT|DEC|CUR)-\d{1,2})\b")


INVARIANT_CITE_RE: Final = re.compile(r"(?<![A-Za-z0-9])(I\d{1,3}[a-z]?)(?![A-Za-z0-9])")
SURFACE_WORDS: Final = re.compile(r"\b(backend|frontend|ops|logging|_git)\b|spec\.md", re.IGNORECASE)

# Closed to the TEXT suffixes this repository holds, so `example.com:443` stays prose; one added to
# the tree and not here escapes both patterns silently.
CITABLE_SUFFIXES: Final[tuple[str, ...]] = (".md", ".css", ".svg", ".lock", *SCANNED_SUFFIXES)
# Longest first, so the alternation cannot stop at `.ts` inside `.tsx` and leave the colon unmatched.
_CITABLE_SUFFIX_RE: Final = "|".join(re.escape(suffix) for suffix in sorted(set(CITABLE_SUFFIXES), key=len, reverse=True))
LINE_CITATION_RE: Final = re.compile(rf"`([^`\n]*(?:{_CITABLE_SUFFIX_RE}):\d+(?:-\d+)?)`")
# The same citation with no backticks, which is how a comment usually carries one. The directory
# run sits inside the capture, the guard rejecting a start after `/` or `.` holding a URL out.
BARE_LINE_CITATION_RE: Final = re.compile(rf"(?<![/`\w.])((?:[\w.-]+/)*[\w.-]*[\w-](?:{_CITABLE_SUFFIX_RE}):\d+(?:-\d+)?)\b")
# What both line-citation patterns need and most files never spell, so the two only run where it is.
LINE_CITATION_HINT_RE: Final = re.compile(r":\d")

# An audit id and a ledger row fail: both name a document `/audit:finish` deletes. A roadmap id and
# a review round are only reported -- the id resolves, and the round may be a sentence.
AUDIT_ID_RE: Final = re.compile(r"\b(?:audit\s+)?R\d+[a-z]?\s*§\s*S\d+(?:\.\d+)?|§\s*S\d+(?:\.\d+)?")
LEDGER_ROW_RE: Final = re.compile(r"\bledger\s+\S*\d")


# OUT-3's bound, counted as that rule spells it.
README_WORD_CAP: Final = 600


def _readme_words(raw: str) -> int:
    """A README's prose words: everything outside its fenced blocks and its table rows (OUT-3)."""
    body = strip_fences(raw)
    return sum(word_count(line) for line in body.split("\n") if not TABLE_LINE_RE.match(line))


def unwrapped(body: str, markers: tuple[str, ...] = ()) -> str:
    """A body laid out as a renderer lays it out: one paragraph per line, blank lines kept.

    A citation split across a wrap is one citation, and a pattern bounded by the newline calls
    the page clean because it could not see it.
    """
    return _wrap_re(markers).sub(" ", body)


def _resolve(file_part: str) -> list[Path]:
    """A citation may give a repo path, a package-relative one, or an unambiguous bare filename."""
    direct = REPO_ROOT / file_part
    if direct.is_file():
        return [direct]
    # A comment beside the code cites the way its own package spells a path, and reporting that as
    # a dead file is the false positive that gets a citation rewritten to something looser.
    if (resolved := repo_path(file_part)) is not None and (REPO_ROOT / resolved).is_file():
        return [REPO_ROOT / resolved]
    if "/" in file_part:
        return []
    # The index answers first, so a stray copy can neither shadow a tracked file nor make one
    # ambiguous; the tree answers a name the index lacks. Calling a file just written dead invites
    # repointing the citation at a similar name, which then passes.
    key = os.path.normcase(file_part)
    named = _tree_index().get(key) or _untracked_index().get(key, ())
    return [p for p in named if p.is_file()][:5]


def names_a_file(file_part: str) -> bool:
    """Whether a citation's left half READS as a file, for a run that resolved to none.

    A left half that resolves is a file however it is spelled, so this asks only of the rest, and
    asks by suffix: COR-6's form names a file, and quoted prose does not.
    """
    return file_part.endswith(CITABLE_SUFFIXES) or file_part.rsplit("/", 1)[-1] in OPS_FILENAMES


def _anchor_names(anchor: str) -> tuple[str, ...] | None:
    """The names a definition listing can be asked about, or None where the anchor spells none.

    Which half of a chain its own file defines varies, and proving the whole of one needs a type,
    so any name in it resolving is enough.
    """
    parts = tuple(anchor.split("."))
    return parts if all(part.isidentifier() for part in parts) else None


def _check_citation(citation: str, rel: str) -> list[Finding]:
    """A <file> :: <anchor> citation: the file must exist and the anchor must appear inside it."""
    file_part, _, anchor = citation.partition(" :: ")
    file_part, anchor = file_part.strip(), anchor.strip()
    if not file_part or not anchor:
        return [Finding("fail", "citation", rel, f"malformed citation: {citation}")]

    matches = _resolve(file_part)
    if not matches:
        # A run that resolves to nothing is a citation only if it reads as one. The separator alone
        # is not evidence: a quoted error carries ` :: ` too, and calling it dead sends a reader
        # after a file nobody named.
        if not names_a_file(file_part):
            return []
        return [Finding("fail", "citation", rel, f"cited file not found: {file_part}")]
    if len(matches) > 1:
        names = ", ".join(sorted(m.relative_to(REPO_ROOT).as_posix() for m in matches)[:4])
        return [Finding("fail", "citation", rel, f"ambiguous file '{file_part}' matches: {names}")]

    target = matches[0]
    content, error = _read_text(target)
    if content is None:
        return [Finding("fail", "citation", rel, f"cannot read {file_part}: {error}")]

    where = target.relative_to(REPO_ROOT).as_posix()
    # Presence is not resolution: `parse_unit` reads as alive inside `parse_units`, so a deleted
    # symbol surviving in a longer name certifies silently. Python's definitions list exactly; every
    # other kind resolves by presence.
    names = _anchor_names(anchor)
    if names is not None and (defined := defined_symbols(target)) is not None:
        if defined.isdisjoint(names):
            return [Finding("fail", "citation", rel, f"anchor '{anchor}' is not defined in {where}")]
        return []
    if anchor not in content:
        return [Finding("fail", "citation", rel, f"anchor '{anchor}' no longer appears in {where}")]
    return []


def _files_named(joined: str) -> list[tuple[int, str]]:
    """Every offset at which this text names a file, and the spelling it names it by.

    A full citation and a backticked repository path. Deliberately not a markdown LINK: over this
    corpus one displaces the file the sentence is about.
    """
    named: list[tuple[int, str]] = [(match.start(), match.group(1).partition(" :: ")[0].strip()) for match in CITATION_RE.finditer(joined)]
    for match in BACKTICK_RE.finditer(joined):
        token = match.group(1)
        if " :: " not in token and (resolved := repo_path(token)) is not None:
            named.append((match.start(), resolved))
    return sorted(named)


def _continuations(joined: str, rel: str) -> list[Finding]:
    """Every `:: <anchor>` continuation, resolved against the last file named above it.

    An anchor that is itself a filename names a SIBLING of that file rather than a symbol in it,
    which is how a table cell lists two modules of one folder.
    """
    carried = [(match.start(), match.group(1).strip()) for match in CONTINUATION_RE.finditer(joined) if not is_placeholder(match.group(1))]
    if not carried:
        return []
    named = _files_named(joined)
    found: list[Finding] = []
    pairs: set[tuple[str, str]] = set()
    for at, anchor in carried:
        antecedent = next((spelling for offset, spelling in reversed(named) if offset < at), None)
        if antecedent is None:
            detail = f"`:: {anchor}` continues a citation, and no file is named above it"
            found.append(Finding("fail", "citation", rel, detail, line_of(joined, at)))
            continue
        pairs.add((antecedent, anchor))
    for antecedent, anchor in sorted(pairs):
        if anchor.endswith(CITABLE_SUFFIXES):
            folder = PurePosixPath(antecedent).parent
            if not (REPO_ROOT / folder / anchor).is_file():
                found.append(Finding("fail", "citation", rel, f"`:: {anchor}` names no file beside {antecedent}"))
            continue
        found.extend(_check_citation(f"{antecedent} :: {anchor}", rel))
    return found


def check_file(path: Path, rules: dict[str, list[str]], invariants: dict[str, list[str]]) -> list[Finding]:
    """Every per-file check, for one file.

    A source file reaches all of it but the anchor check: an in-page anchor is markdown's alone, a
    source file having no headings of its own for one to resolve against.
    """
    rel = path.relative_to(REPO_ROOT).as_posix()
    is_markdown = path.suffix == ".md"
    raw, error = _read_text(path)
    if raw is None:
        return [Finding("fail", "unreadable", rel, error)]
    body = _scan_body(path)

    found: list[Finding] = []

    if not is_markdown and _header_scoped(rel, path.suffix):
        found.extend(check_module_header(rel, raw, path.suffix))
        found.extend(check_header_see(rel, raw, path.suffix))

    if is_markdown and path.name == "README.md" and (words := _readme_words(raw)) > README_WORD_CAP:
        detail = f"a README of {words} words outside its tables and fences -- OUT-3 caps one at {README_WORD_CAP}"
        found.append(Finding("fail", "readme-cap", rel, detail))

    found.extend(check_owner_voice(rel, body))
    if is_markdown:
        found.extend(check_metadata_breaks(rel, body))
    else:
        found.extend(check_comment_citations(rel, body))
        found.extend(check_bare_paths(rel, body))

    for rule_id in sorted(set(RULE_ID_RE.findall(body))):
        homes = rules.get(rule_id, [])
        if not homes:
            found.append(Finding("fail", "rule-id", rel, f"{rule_id} resolves to no rule in a tracked docs/standard.md"))
        elif len(homes) > 1:
            detail = f"{rule_id} has more than one home in docs/standard.md ({' and '.join(homes)}) -- a citation cannot say which"
            found.append(Finding("fail", "rule-id", rel, detail))

    if not is_markdown:
        found.extend(check_invariant_citations(rel, body, invariants))

    # Prefilters, sound because `_wrap_re` joins with a SPACE: no wrap spells a `::` or `:`digit the
    # raw text lacks. Bare `::`, never the spaced form: a citation split at the wrap is the join's purpose.
    cites = "::" in body
    cites_lines = LINE_CITATION_HINT_RE.search(body) is not None
    if cites or cites_lines:
        joined = unwrapped(body, () if is_markdown else continuation_markers(comment_style(path)))
        if cites:
            for citation in sorted(set(CITATION_RE.findall(joined))):
                if not is_placeholder(citation):
                    found.extend(_check_citation(citation, rel))
            found.extend(_continuations(joined, rel))

        # Nothing else can detect one: it stays syntactically valid and merely stops pointing at what
        # it names, so it has to be caught at the form.
        if cites_lines:
            cited_lines = set(LINE_CITATION_RE.findall(joined)) | set(BARE_LINE_CITATION_RE.findall(joined))
            for citation in sorted(cited_lines):
                if is_placeholder(citation):
                    continue
                found.append(Finding("fail", "line-citation", rel, f"line-number citation `{citation}` -- anchor it to a symbol (COR-6)"))

    # `anchors_of` rather than a second `heading_anchors`: this page's own anchors are cached
    # there already, every link pointing AT it having resolved through the same call.
    anchors = (anchors_of(path) or frozenset()) if is_markdown else frozenset()
    for raw_target, fragment in sorted(set(LINK_RE.findall(body))):
        anchor = fragment[1:]
        if raw_target.startswith(("http://", "https://", "mailto:")) or is_placeholder(raw_target + fragment):
            continue
        if not raw_target:
            if is_markdown and anchor and anchor not in anchors:
                found.append(Finding("fail", "anchor", rel, f"no heading in this file yields #{anchor}"))
            continue
        target = (path.parent / raw_target).resolve()
        if not target.exists():
            found.append(Finding("fail", "link", rel, f"link target does not exist: {raw_target}"))
            continue
        # The file resolves and the heading it names does not, so the link opens the right page at
        # the top and looks correct.
        if anchor and target.suffix == ".md" and (reachable := anchors_of(target)) is not None and anchor not in reachable:
            found.append(Finding("fail", "anchor", rel, f"no heading in {raw_target} yields #{anchor}"))

    for token in sorted(set(BACKTICK_RE.findall(body))):
        # Already reported above, and letting the path check fire too would give one defect two
        # findings.
        if " :: " in token or is_placeholder(token) or not token.startswith(REPO_PREFIXES):
            continue
        if LINE_CITATION_RE.fullmatch(f"`{token}`"):
            continue
        if not (REPO_ROOT / token).exists() and not is_gitignored(token):
            found.append(Finding("fail", "path", rel, f"path named but not present: {token}"))

    return found


def check_bare_paths(rel: str, body: str) -> list[Finding]:
    """A repository path named in a comment without backticks, resolving to nothing.

    Comments only, a document being held to COR-6's backticks instead. A token is resolved from
    every directory above the file, as a reader would.
    """
    found: list[Finding] = []
    bases = [REPO_ROOT, *(REPO_ROOT / parent for parent in Path(rel).parents if parent.as_posix() != ".")]
    # Backticked spans out first, or one dead path yields a `path` finding and a `bare-path` one. A
    # span holds no newline, so removing one moves an offset along its line and never off it.
    scrubbed = BACKTICK_SPAN_RE.sub("", body)
    first_seen: dict[str, int] = {}
    for match in BARE_PATH_RE.finditer(scrubbed):
        first_seen.setdefault(match.group(0), match.start())
    for token in sorted(first_seen):
        # `is_gitignored` shells out, so it stays behind the tests that answer without one.
        if is_placeholder(token) or any((base / token).exists() for base in bases) or is_gitignored(token):
            continue
        detail = f"path named but not present: {token} -- and unbackticked, so `path` never saw it"
        found.append(Finding("fail", "bare-path", rel, detail, line_of(scrubbed, first_seen[token])))
    return found


def check_comment_citations(rel: str, body: str) -> list[Finding]:
    """The two citation shapes INC-6 bans outright, over one file's comments.

    Failing, because neither survives its programme: both name a document `/audit:finish` deletes.
    """
    found: list[Finding] = []
    for kind, pattern in (("audit id", AUDIT_ID_RE), ("ledger row", LEDGER_ROW_RE)):
        for match in pattern.finditer(body):
            detail = f"{kind} `{match.group(0).strip()}` in a comment (INC-6) -- cite a path or a symbol"
            found.append(Finding("fail", "comment-citation", rel, detail, line_of(body, match.start())))
    return found


def _enclosing_block(body: str, offset: int) -> str:
    """The unbroken run of non-blank lines around one offset -- the comment the citation sits in.

    A window measured in characters would reach across the blank lines `comments_only` leaves where
    the code was.
    """
    lines = body.split("\n")
    index, seen = 0, 0
    for number, line in enumerate(lines):
        seen += len(line) + 1
        if seen > offset:
            index = number
            break
    start = index
    while start > 0 and lines[start - 1].strip():
        start -= 1
    end = index
    while end + 1 < len(lines) and lines[end + 1].strip():
        end += 1
    return "\n".join(lines[start : end + 1])


def check_invariant_citations(rel: str, body: str, invariants: dict[str, list[str]]) -> list[Finding]:
    """A bare `I<n>` that more than one spec sheet defines, cited from a comment.

    Comments only: a page citing an invariant sits in its surface's folder, while a comment carries
    no such context.
    """
    found: list[Finding] = []
    for match in INVARIANT_CITE_RE.finditer(body):
        homes = invariants.get(match.group(1), [])
        if len(homes) < 2:
            continue
        if SURFACE_WORDS.search(_enclosing_block(body, match.start())):
            continue
        detail = f"bare `{match.group(1)}`, which {' and '.join(homes)} both define -- name the sheet"
        found.append(Finding("fail", "rule-id", rel, detail, line_of(body, match.start())))
    return found


# OUT-4's bound on one table cell. A cell past it is a paragraph wearing a table's clothes.
CELL_PROSE_WORD_CAP: Final = 25
# A cell that is one quoted or backticked span carries almost nothing else, which is how OUT-4's
# verbatim fragment is told from a paragraph.
VERBATIM_REMAINDER: Final = 2


def check_cell_prose() -> list[Finding]:
    """A spec sheet's table cell carrying a paragraph (OUT-4).

    Measured per cell rather than per row: a row of three short cells is a table, and one long cell
    is the paragraph.
    """
    found: list[Finding] = []
    for sheet in tracked_glob(SPEC_GLOB):
        rel = sheet.relative_to(REPO_ROOT).as_posix()
        if (body := _readable(sheet)) is None:
            continue  # `unreadable` reports the file where it is scanned
        for number, line in enumerate(body.split("\n"), start=1):
            if (match := TABLE_LINE_RE.match(line)) is None:
                continue
            for cell in (piece.strip() for piece in match.group(1).split("|")):
                bare = QUOTED_SPAN_RE.sub("", BACKTICK_SPAN_RE.sub("", cell))
                if word_count(bare) <= VERBATIM_REMAINDER:
                    continue
                if (words := word_count(cell)) > CELL_PROSE_WORD_CAP:
                    detail = f"a table cell of {words} words -- OUT-4 caps one at {CELL_PROSE_WORD_CAP}, its argument going to the commit"
                    found.append(Finding("fail", "cell-prose", rel, detail, number))
    return found


# COR-2's bound on what is worth calling a duplicate. Below it a block is a label, a heading or a
# one-line note, and two files stating the same short sentence is the language rather than a copy.
ECHO_WORD_FLOOR: Final = 20
ECHO_DROP_RE: Final = re.compile(r"[^a-z0-9 ]+")


def _normalised(text: str) -> str:
    """One block reduced to what a reader takes from it: lower case, letters and digits, one space."""
    return " ".join(ECHO_DROP_RE.sub(" ", text.lower()).split())


def _prose_blocks(path: Path) -> list[tuple[int, str]]:
    """A page's paragraphs; a source file yields none.

    COR-2 bans a second paragraph restating an argument, and a comment is never one: the convention
    clause keeps a one-sentence claim at every constrained line. A restated argument is
    `/docs:audit`'s to read.
    """
    if path.suffix != ".md":
        return []
    blocks: list[tuple[int, str]] = []
    current: list[str] = []
    first = 0
    # A page's fenced blocks arrive blanked, so a shared example is not a duplicated claim.
    for number, line in enumerate((_readable(path) or "").split("\n"), start=1):
        if line.strip():
            if not current:
                first = number
            current.append(line.strip())
        elif current:
            blocks.append((first, " ".join(current)))
            current = []
    if current:
        blocks.append((first, " ".join(current)))
    return blocks


def check_echo() -> list[Finding]:
    """The same paragraph stated on two pages (COR-2).

    Identical after normalisation, which is the duplicate a reader can be shown rather than argued
    into: a paraphrase is `/docs:audit`'s.
    """
    homes: dict[str, str] = {}
    found: list[Finding] = []
    for path in scanned_files():
        rel = path.relative_to(REPO_ROOT).as_posix()
        for number, text in _prose_blocks(path):
            key = _normalised(text)
            # COR-2's surviving duplicate needs no exemption beside this floor: a copy something
            # other than a reader consumes is short, fenced or in source, and reaches no paragraph.
            if word_count(key) < ECHO_WORD_FLOOR:
                continue
            # The first occurrence is the home and every later one is the finding, so a page is
            # told which copy to cite.
            if (home := homes.get(key)) is None:
                homes[key] = f"{rel}:{number}"
            else:
                detail = f"this passage is already stated at {home} -- COR-2 keeps one home and a citation"
                found.append(Finding("fail", "echo", rel, detail, number))
    return found


# --- the run -------------------------------------------------------------------------------------


def _print_human(findings: list[Finding]) -> None:
    """The indented report, in full.

    Never a capped listing: a finding a reader was not shown is one nothing made them clear, and
    every finding here fails the run.
    """
    if findings:
        print(f"\n      {len(findings)} failing finding(s):")
        for finding in findings:
            print(finding.human())


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Documentation gate; the registry of its checks is scripts/checks/docs_gate/kernel.py :: CHECKS."
    )
    parser.add_argument(
        "--output-format",
        choices=("human", "github"),
        default="human",
        help="human: the indented report. github: one workflow command per finding, which a runner annotates the diff with",
    )
    args = parser.parse_args()

    files = scanned_files()
    if not files:
        # Refused, not green: an empty corpus is a tree this gate could not read.
        print("      no corpus file matched -- nothing was read, so this run proves nothing", file=sys.stderr)
        return checker_kernel.EXIT_REFUSED

    # Resolved once, and handed to every branch-scoped check below. The kernel's resolver prefers
    # the remote-tracking ref: a stale local one reads another branch's commits as this one's.
    branch = Branch(checker_kernel.DEFAULT_BASE, checker_kernel.resolve_base())

    existing_rules = rule_ids()
    existing_invariants = invariant_ids()
    additions = branch_additions(branch)
    findings: list[Finding] = []
    for path in files:
        findings.extend(check_file(path, existing_rules, existing_invariants))
    findings.extend(check_branch_diff(branch))
    findings.extend(check_roadmap())
    findings.extend(check_inputs())
    findings.extend(check_line_endings())
    findings.extend(check_binary_bytes())
    findings.extend(check_spec_sheets())
    findings.extend(check_invariant_tables())
    findings.extend(check_overviews())
    findings.extend(check_glossary())
    findings.extend(check_enforced_by())
    findings.extend(check_rule_shape())
    findings.extend(check_cell_prose())
    findings.extend(check_echo())
    findings.extend(check_segment_map())
    findings.extend(check_template_fragments())
    findings.extend(check_prose_shas(files))
    findings.extend(check_history_phrases(additions))
    findings.extend(check_added_citations(additions))
    findings.extend(check_comment_bounds(branch))
    findings.extend(check_copy_rules())
    findings.extend(check_platform_branches())
    findings.extend(check_text_writes())

    if args.output_format == "github":
        for finding in findings:
            print(finding.github())
    else:
        _print_human(findings)

    docs = sum(1 for f in files if f.suffix == ".md")
    sources = len(files) - docs
    print(f"\n      scanned {docs} documents and {sources} source files against {len(existing_rules)} rules")
    return checker_kernel.EXIT_FINDINGS if findings else checker_kernel.EXIT_OK
