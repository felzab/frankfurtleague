"""
SCRIPTS · the checks a page's kind decides

One check per document kind the standard shapes: a chapter's rules, the ranked roadmap, a spec
sheet's spine, an overview's ends, the glossary's entries, the two registries and the sweep's
partition. Each resolves its input through the tracked corpus, by glob or by name, so an absent
one is `inputs`' finding and an un-added one is the reading check's own.

Invariants:
- A check whose input is missing says so, rather than examining nothing and passing.
- Both registries are compared in both directions: a check with no row and a row with no check are
  one defect seen from either side.

See:
- docs/_standard/chapters/3-corpus.md — the document shapes these checks hold a page to
"""

from __future__ import annotations

import re
from functools import cache
from pathlib import PurePosixPath
from typing import Final

import check_pr_body

from .kernel import (
    BACKTICK_RE,
    BACKTICK_SPAN_RE,
    CHAPTER_GLOB,
    CHAPTERS_DIR,
    CHECKS,
    CURRENCY_PAGE,
    DOCS_DIR,
    GLOSSARY_PAGE,
    OVERVIEW_GLOB,
    REPO_ROOT,
    ROADMAP_GLOB,
    ROADMAP_RANKED_PAGES,
    RULES_INDEX_PAGE,
    SPEC_GLOB,
    STAMP_RE,
    STAMP_REQUIRED_GLOBS,
    SWEEP_PAGE,
    TEMPLATES_PAGE,
    Finding,
    _read_text,
    _readable,
    atx_heading,
    git,
    tracked_glob,
    tracked_page,
)

# A metadata line: a bold label opening a line -- what a stamp, a Scope line and an entry's fields
# all share. The label is bounded because a bold sentence ending in a colon is prose, and holding
# prose to a layout rule gets a check ignored.
METADATA_LINE_RE: Final = re.compile(r"^\*\*([A-Z][A-Za-z ]{0,30}):\*\*(?:\s|$)")
# COR-8's break is a line ending, and two ways of omitting one join two entries on one line: the
# characters `\` and `n`, and nothing at all. Arm two demands the second label abut what precedes
# it; whitespace before it is spared.
METADATA_JOIN_RE: Final = re.compile(r"(?:(\\n)\s*|(?<=\S))\*\*([A-Z][A-Za-z ]{0,30}):\*\*")


# PRE-4's anatomy: the heading opens on the id and states the rule as a claim, the fixed fields
# follow in this order, and the id takes a row in its chapter's table and a line in the index.
RULE_HEAD_RE: Final = re.compile(r"^((?:PRE|COR|INC|OUT|DEC|CUR)-\d{1,2})\b(.*)$")
RULE_CLAIM_RE: Final = re.compile(r"^\s+—\s+\S")
RULE_FIELDS: Final[tuple[str, ...]] = ("Rule", "Why", "Exceptions", "Enforced by", "Example")
RULE_FIELD_RE: Final = re.compile(r"^[ \t]*\*\*([A-Z][A-Za-z ]{0,30}):\*\*", re.MULTILINE)
CHAPTER_ROW_RE: Final = re.compile(r"^[ \t]*\|\s*((?:PRE|COR|INC|OUT|DEC|CUR)-\d{1,2})\s*\|", re.MULTILINE)
RULE_INDEX_LINE_RE: Final = re.compile(r"^[ \t]*[-*]\s+\*\*((?:PRE|COR|INC|OUT|DEC|CUR)-\d{1,2}):\*\*", re.MULTILINE)

# CUR-5's table, the one place the checks are listed, and the `Enforced by` field each rule ends on.
# PRE-4 closes that field's vocabulary, so a bare backticked lower-case token in it names a check.
CHECK_ROW_RE: Final = re.compile(r"^[ \t]*\|\s*`([a-z][a-z-]*)`\s*\|.*\|\s*(Fail|Report)\s*\|\s*$", re.MULTILINE)
ENFORCED_BY_RE: Final = re.compile(r"^[ \t]*\*\*Enforced by:\*\*(.*?)(?=\n[ \t]*\n|\Z)", re.MULTILINE | re.DOTALL)
CHECK_NAME_RE: Final = re.compile(r"`([a-z][a-z0-9-]*)`")

SEGMENT_HEADER_RE: Final = re.compile(r"^[ \t]*\|\s*Segment\s*\|\s*Globs\s*\|", re.MULTILINE)
EXCLUDED_HEADER_RE: Final = re.compile(r"^[ \t]*\|\s*Excluded\s*\|\s*Why\s*\|", re.MULTILINE)
# How many offending paths a finding names before it counts the rest: a folder moved wholesale
# unclaims every file under it, and a finding that prints hundreds of them is one nobody reads.
SEGMENT_SAMPLE: Final = 8


# What another check reads. A glob over a tree that is not there yields nothing, so an absent input
# degrades the check reading it to silence with the run green -- these are named here so the
# absence itself fails.
REQUIRED_INPUTS: Final[tuple[str, ...]] = (
    CHAPTERS_DIR,
    RULES_INDEX_PAGE,
    *ROADMAP_RANKED_PAGES,
    TEMPLATES_PAGE,
    GLOSSARY_PAGE,
    SWEEP_PAGE,
)

# `git ls-files --eol` answers every question this needs in one call: the working tree's endings,
# the attributes in force, and git's own text/binary verdict.
LS_FILES_EOL_RE: Final = re.compile(r"^i/(\S+)\s+w/(\S+)\s+attr/(.*?)\s*\t(.*)$")
# The working-tree verdicts that are not LF. Binary reads as `-text` and never appears here, which
# is the classification a PNG needs: it holds CR-LF byte pairs legitimately.
NON_LF_WORKTREE: Final[tuple[str, ...]] = ("crlf", "mixed")
# What `.gitattributes` gives `*.bat` and `*.cmd`, and the only thing that exempts a file.
CRLF_MANDATED: Final = "eol=crlf"

# OUT-4's spine. The closing sections are fixed so that a contract growing cannot push Invariants
# down and silently repoint every citation of section 3, which is also what makes an invariant
# number safe to cite from a comment.
SPEC_SECTIONS: Final[tuple[str, ...]] = ("1. Contract", "2. Invariants", "3. Violation → remedy", "4. Known-open")
SPEC_SUBSECTION_RE: Final = re.compile(r"^1\.(\d+)\b")
SPEC_COLUMNS: Final = 4
# An invariant's id, in the first cell of its row and wherever a sheet cites one. `L` is the logging
# sheet's prefix and `I` every other sheet's; a citation crosses surfaces often enough that an id is
# resolved against all of them.
INVARIANT_ID_RE: Final = re.compile(r"^[ \t]*\|\s*([IL]\d{1,3}[a-z]?)\s*\|", re.MULTILINE)
INVARIANT_REF_RE: Final = re.compile(r"(?<![A-Za-z0-9])([IL]\d{1,3}[a-z]?)(?![A-Za-z0-9])")
# A `Breaks how` cell that only points elsewhere states no failure mode, which is the column's whole
# job. Bounded to a cell with no sentence in it, so a real explanation opening "See the runbook, and
# the request then 500s" is left alone.
CROSS_REFERENCE_RE: Final = re.compile(r"^(?:see|as|per)\b[^.]*$", re.IGNORECASE)

# OUT-5's spine: an overview says how the surface is organised and hands the reader on.
OVERVIEW_OPENING: Final = "How it is organised"
OVERVIEW_CLOSING: Final = "Read next"

# OUT-6's entry: one or more backticked terms, a gloss, then four fields in a fixed order. Several
# terms share one entry where the code and the domain spell the same thing differently, so the head
# allows a `/` or a `·` between them.
GLOSSARY_HEAD_RE: Final = re.compile(r"^`[^`]+`(?:\s*[/·]\s*`[^`]+`)*\s+—\s+\S.*$")
GLOSSARY_FIELD_RE: Final = re.compile(r"^[ \t]*\*\*([A-Za-z][A-Za-z ]*):\*\*", re.MULTILINE)
GLOSSARY_FIELDS: Final[tuple[str, ...]] = ("Is", "In code", "Trap", "See")


# A spec sheet's invariant ids: the first cell of an invariant row, and a citation of one anywhere
# else. The surface words are what disambiguates a citation of an id two sheets both define.
INVARIANT_ROW_RE: Final = re.compile(r"^[ \t]*\|\s*(I\d{1,3}[a-z]?)\s*\|", re.MULTILINE)


ROADMAP_ID_DEF_RE: Final = re.compile(r"^[ \t]*\|\s*(?:\d+\s*\|\s*)?\*{0,2}([A-Z]{1,4}-\d{1,3})\*{0,2}\s*\|", re.MULTILINE)

# The ranked roadmap: an entry heading, an index row, and the status an entry states.
# The id is captured loose, so a malformed one is caught against the vocabulary rather than skipped.
ROADMAP_ENTRY_RE: Final = re.compile(r"^ {0,3}###\s+(\d+)\s+·\s+(\S+)\s+—", re.MULTILINE)
# An index row must carry an id in its second cell, which separates it from the page's other
# numeric tables -- a row reading `| 4 | 6 | walks |` counts fixtures, not entries.
ROADMAP_INDEX_ROW_RE: Final = re.compile(r"^[ \t]*\|\s*(\d+)\s*\|\s*([A-Z]{1,4}-\d{1,3})\s*\|(.*)$", re.MULTILINE)
ROADMAP_STATUS_RE: Final = re.compile(r"^[ \t]*\*\*Status:\*\*\s*(.+?)\s*\\?$", re.MULTILINE)
# Closed exists for exactly one commit -- the one concluding an entry, whose successor deletes it.
ROADMAP_TRANSIENT_STATUS: Final = "Closed"

# COR-11's banned phrase. A quoted or backticked mention -- naming the phrase to ban it, as the rule
# itself does -- is a mention rather than a use, so those spans come out before the search.
OWNER_PHRASE_RE: Final = re.compile(r"\bthe owner\b", re.IGNORECASE)
QUOTED_SPAN_RE: Final = re.compile(r"\"[^\"\n]*\"|`[^`\n]*`|“[^”\n]*”")
OWNER_EXEMPT_PREFIX: Final = ".claude/"


def rule_blocks(text: str) -> list[tuple[str, str, str]]:
    """Each rule a chapter states: its id, the rest of its heading line, and the lines under it.

    A block runs to the next heading at any level, so a rule's fields are read from its own text
    and never from the rule below it. Fenced examples are already blanked by the caller.
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
    """Every rule id a chapter defines, mapped to the chapters defining it.

    Empty when the chapters folder is untracked or missing, so every cited id then fails -- deleting
    the standard out from under its citations is exactly what the rule-id check exists to catch. The
    value is a list rather than a name because two homes for one id is itself a failure: a citation
    that resolves twice cannot be followed, and it never dangles, so nothing else would find it.
    """
    ids: dict[str, list[str]] = {}
    for chapter in tracked_glob(CHAPTER_GLOB):
        if (text := _readable(chapter)) is None:
            continue
        for rule_id, _, _ in rule_blocks(text):
            ids.setdefault(rule_id, []).append(chapter.relative_to(REPO_ROOT).as_posix())
    return ids


@cache
def roadmap_ids() -> frozenset[str]:
    """Every hyphenated id the roadmap tables define, read from the tables rather than guessed.

    Derived, because the prefixes are open-ended and a hand-written pattern would catch `UTF-8`
    the day someone writes it. An id with no hyphen (the earliest ones) is left out: two characters
    and a digit is a shape that occurs in code for reasons that have nothing to do with the roadmap.
    """
    ids: set[str] = set()
    for page in tracked_glob(ROADMAP_GLOB):
        if (text := _read_text(page)[0]) is not None:
            ids.update(ROADMAP_ID_DEF_RE.findall(text))
    return frozenset(ids)


def invariant_ids() -> dict[str, list[str]]:
    """Every `I<n>` a spec sheet's invariant table defines, mapped to the sheets defining it.

    OUT-4 makes the numbers permanent per sheet and says nothing about them being unique across
    sheets, so the same number legitimately names different rules in different surfaces -- which is
    what makes a bare one, cited from anywhere else, resolve to whichever sheet the reader opens.
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
    """COR-8's hard break over every metadata block on a page: a stamp, a Scope line, an entry's fields.

    A block is a run of bold-labelled lines with no blank line between them; a line that carries no
    label continues the entry above it, so the break belongs on an entry's LAST physical line.
    Every entry but the last carries one, which is what renders them one per line instead of
    flowing into a paragraph; the last carries none, having nothing below it to separate from.

    Two entries sharing one physical line are caught here too, because the break that should have
    parted them is this rule's. Neither half is malformed on its own, which is why the stamp's own
    shape check cannot see it: a joined stamp is a complete entry followed by a complete entry.

    Reading a second label as a join wherever it appears would fail a report header that carries two
    fields on one line on purpose, so the abutting arm fires only where nothing at all separates the
    two. Any whitespace spares it, which is wider than those headers need: a single space between
    two fields reads as a join to a person and passes here. The narrower test would have to name the
    separators it accepts, and a header is free to pick one nobody listed.
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
                # Backticked spans come out first: a rule quoting a label to name it, as chapter 0
                # does, is a mention rather than a second entry. The opening label is re-matched on
                # the scrubbed line because removing a span moves every offset after it.
                scrubbed = BACKTICK_SPAN_RE.sub("", lines[index])
                opening = METADATA_LINE_RE.match(scrubbed)
                if opening and (joined := METADATA_JOIN_RE.search(scrubbed, opening.end())):
                    written = "the characters \\n" if joined.group(1) else "nothing at all"
                    detail = (
                        f"the {match.group(1)} line at line {index + 1} runs into {joined.group(2)} on one physical line"
                        f" -- COR-8's break is a line ending, written here as {written}"
                    )
                    found.append(Finding("fail", "metadata-break", rel, detail))
            elif names:
                ends[-1] = index
            index += 1
        for position, (name, end) in enumerate(zip(names, ends, strict=True)):
            wanted = position < len(names) - 1
            if lines[end].rstrip().endswith("\\") is not wanted:
                verb = "needs" if wanted else "must not carry"
                found.append(Finding("fail", "metadata-break", rel, f"the {name} line at line {end + 1} {verb} COR-8's trailing hard break"))
    return found


def check_owner_voice(rel: str, body: str) -> list[Finding]:
    """COR-11: no tracked file outside `.claude/` names its author in the third person."""
    if rel.startswith(OWNER_EXEMPT_PREFIX):
        return []
    mentions_removed = QUOTED_SPAN_RE.sub("", body)
    if OWNER_PHRASE_RE.search(mentions_removed) is None:
        return []
    return [Finding("fail", "owner-voice", rel, "names “the owner” -- write it in the first person or as a neutral imperative (COR-11)")]


def check_stamp_missing() -> list[Finding]:
    """A page whose kind CUR-3 settles must carry a stamp carries one.

    Every other stamp check polices a stamp that exists, so a page that should carry one and does
    not is invisible to all of them -- and to `branch-impact`, which arms only on a stamped page,
    leaving the files that page cites free to change under it. What the criterion turns on is what
    a page claims, which no check can read; these kinds are the part of it a path decides, because
    a spec sheet's contract, an overview's parts, the glossary's `In code` fields and a chapter's
    account of this gate are current-state claims by the rule that shapes each of them.
    """
    found: list[Finding] = []
    for pattern in STAMP_REQUIRED_GLOBS:
        # `tracked_glob` has pruned the skipped trees already, and an untracked page is nobody's to
        # fail: it is absent from the checkout this stamp would be read in.
        for path in tracked_glob(pattern):
            if (body := _readable(path)) is None or STAMP_RE.search(body) is not None:
                continue
            rel = path.relative_to(REPO_ROOT).as_posix()
            found.append(
                Finding("fail", "stamp-missing", rel, "carries no `Verified against` stamp, so nothing can measure it going stale (CUR-3)")
            )
    return found


def check_roadmap() -> list[Finding]:
    """Each ranked roadmap page agrees with itself: index and entries, ranks, ids, no transient status.

    A page's failure mode is that it quietly stops being trustworthy -- an entry with no index row
    is invisible to the reader who only reads the table, a rank that disagrees with its heading
    makes the working order ambiguous, and a `Closed` entry is one a closing commit's successor
    never deleted. Nothing else looks at any of it.

    Ranks run from 1 per page rather than across the folder, because each page is ranked only
    against itself: product work and tooling work are not comparable, which is why there are two.
    """
    found: list[Finding] = []
    for rel in ROADMAP_RANKED_PAGES:
        page = tracked_page(rel)
        if page is None:
            # Absence is `check_inputs`' alone, and saying it twice reads as a gate crying wolf. A
            # page sitting on disk untracked is neither absent nor selected by anything that reads
            # the corpus, so this is the one place it is anything but green.
            if (REPO_ROOT / rel).exists():
                found.append(Finding("fail", "roadmap-shape", rel, "untracked, so the ranked roadmap was read against nothing"))
            continue
        if (body := _readable(page)) is None:
            found.append(Finding("fail", "roadmap-shape", rel, "unreadable, so the ranked roadmap was read against nothing"))
            continue

        entries = {match.group(2): int(match.group(1)) for match in ROADMAP_ENTRY_RE.finditer(body)}
        rows = {match.group(2): int(match.group(1)) for match in ROADMAP_INDEX_ROW_RE.finditer(body)}

        for entry_id in sorted(set(entries) - set(rows)):
            found.append(Finding("fail", "roadmap-shape", rel, f"entry {entry_id} has no row in the index table"))
        for entry_id in sorted(set(rows) - set(entries)):
            found.append(Finding("fail", "roadmap-shape", rel, f"index row {entry_id} has no entry below it"))
        for entry_id in sorted(set(entries) & set(rows)):
            if entries[entry_id] != rows[entry_id]:
                detail = f"{entry_id} ranks {entries[entry_id]} in its heading and {rows[entry_id]} in the index"
                found.append(Finding("fail", "roadmap-shape", rel, detail))

        known = roadmap_ids()
        for entry_id in sorted(set(entries) - known):
            found.append(Finding("fail", "roadmap-shape", rel, f"entry id {entry_id} is defined by no tracked roadmap table"))

        # Contiguous from 1, on each side: a gap makes "the next one" unanswerable, and a duplicate
        # makes the working order ambiguous. A page holding no entry at all says nothing here.
        for where, ranks in (("entry heading", sorted(entries.values())), ("index", sorted(rows.values()))):
            if ranks and ranks != list(range(1, len(ranks) + 1)):
                detail = f"{where} ranks are {', '.join(str(rank) for rank in ranks)} -- they run 1 to {len(ranks)} without a gap or a repeat"
                found.append(Finding("fail", "roadmap-shape", rel, detail))

        transient = "that status lasts one commit, whose successor"
        for match in ROADMAP_STATUS_RE.finditer(body):
            if match.group(1) == ROADMAP_TRANSIENT_STATUS:
                detail = f"an entry states Status: {ROADMAP_TRANSIENT_STATUS} -- {transient} deletes the entry"
                found.append(Finding("fail", "roadmap-shape", rel, detail))
        for match in ROADMAP_INDEX_ROW_RE.finditer(body):
            if ROADMAP_TRANSIENT_STATUS in [cell.strip() for cell in match.group(3).split("|")]:
                detail = f"index row {match.group(2)} states {ROADMAP_TRANSIENT_STATUS} -- {transient} deletes the entry"
                found.append(Finding("fail", "roadmap-shape", rel, detail))

    return found


def _headings(body: str, level: int) -> list[str]:
    """The headings at one level, in the order the page carries them."""
    return [text for line in body.split("\n") if (text := atx_heading(line, level)) is not None]


def _section(body: str, heading: str) -> str:
    """One `## <heading>` section's body, empty where the page carries no such heading.

    Located the same way `_headings` reads one, so the two can never disagree about where a section
    starts. Matching the line verbatim instead empties the section on a trailing space, and a
    subsection check over nothing passes.
    """
    lines = body.split("\n")
    start = next((index for index, line in enumerate(lines) if atx_heading(line, 2) == heading), None)
    if start is None:
        return ""
    end = next((index for index in range(start + 1, len(lines)) if atx_heading(lines[index], 2) is not None), len(lines))
    return "\n".join(lines[start + 1 : end])


def check_spec_sheets() -> list[Finding]:
    """OUT-4's spine over every spec sheet: the four sections, and the contract's numbering.

    A fifth closing section repoints every citation of "section 3" without changing a word of one,
    and a gap in the contract's numbering does the same one level down. Neither is visible to a
    reader of the page that moved.
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


def check_invariant_tables() -> list[Finding]:
    """Every invariant row states a failure mode, and every id a sheet cites resolves to one.

    The `Breaks how` column is what makes an invariant actionable rather than a slogan, and it is
    the column a hurried row leaves as a pointer. Ids resolve across sheets rather than within one,
    because a surface citing another surface's invariant is ordinary and correct.
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
        for line in _section(body, SPEC_SECTIONS[1]).split("\n"):
            if (match := INVARIANT_ID_RE.match(line)) is None:
                continue
            invariant = match.group(1)
            if invariant in seen:
                found.append(Finding("fail", "invariant-row", rel, f"{invariant} numbers two rows -- OUT-4 makes a number permanent"))
            seen.add(invariant)
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            if len(cells) != SPEC_COLUMNS:
                found.append(Finding("fail", "invariant-row", rel, f"{invariant} has {len(cells)} cells, not OUT-4's {SPEC_COLUMNS}"))
            elif not cells[-1].strip("—- ") or CROSS_REFERENCE_RE.match(cells[-1]):
                found.append(Finding("fail", "invariant-row", rel, f"{invariant} states no failure mode: '{cells[-1]}' (OUT-4)"))
        for cited in sorted(set(INVARIANT_REF_RE.findall(body)) - defined):
            found.append(Finding("fail", "invariant-id", rel, f"cites {cited}, which no tracked spec sheet's invariant table defines"))
    return found


def check_overviews() -> list[Finding]:
    """OUT-5's spine: an overview opens on how the surface is organised and closes on where to go.

    Both ends are load-bearing and neither is missed by a reader of the page: an overview that
    stops naming its parts has started explaining mechanisms the spec sheet owns, and one with no
    handoff is where a reader's trail goes cold.
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
    """OUT-6's entry shape: the term as code spells it, a gloss, then the four fields in order.

    The `Trap` field is the reason the glossary exists, and it is the one an entry written in a
    hurry drops -- a term with no pitfall line costs the next reader the hour it was written to
    save.
    """
    rel = GLOSSARY_PAGE
    page = tracked_page(rel)
    if page is None or (body := _readable(page)) is None:
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

    Each check below resolves its input with `tracked_glob` or `_read_text` and treats an empty
    answer as nothing to say, which turns a deleted or moved input into a check that passes without
    looking at anything. Naming them here is what makes the absence itself the finding.

    Presence on disk, not in the index: this is the one place that separates "the tree is gone" from
    "the tree is here and untracked", which every caller above reports as its own dangling citation.
    """
    return [
        Finding("fail", "inputs", rel, "missing -- the check reading it would otherwise pass without examining anything")
        for rel in REQUIRED_INPUTS
        if not (REPO_ROOT / rel).exists()
    ]


def check_line_endings() -> list[Finding]:
    """A tracked text file holds LF in the working tree wherever `.gitattributes` mandates it.

    The declaration takes effect at commit, so a CRLF working tree reads clean in the index and
    breaks where the file runs: a shell script dies on its shebang on the Linux server, and the
    formatter rejects the tree. Git's own verdict decides what counts as text, because a PNG holds
    CR-LF byte pairs legitimately and an extension list is what gets that wrong. A file the
    attributes give `eol=crlf` is exempt by construction, so `*.bat` and `*.cmd` need no list here.
    """
    # NUL-separated, so a path outside ASCII arrives as itself rather than octal-escaped inside
    # quotes: the finding names the file a reader has to fix, and a spelling no checkout holds
    # would send them looking for it.
    listing = git("ls-files", "--eol", "-z")
    if listing is None:
        # A run that cannot read the index proves nothing about the tree, and a check that says
        # nothing is indistinguishable from a clean one.
        detail = "git could not report the tree's line endings, so nothing was held to `.gitattributes`"
        return [Finding("fail", "line-endings", ".gitattributes", detail)]

    found: list[Finding] = []
    for line in listing.split("\0"):
        if (match := LS_FILES_EOL_RE.match(line)) is None:
            continue
        worktree, attributes, rel = match.group(2), match.group(3), match.group(4)
        if worktree not in NON_LF_WORKTREE or CRLF_MANDATED in attributes:
            continue
        detail = f"the working tree holds {worktree.upper()} line endings, and `{attributes}` mandates LF"
        found.append(Finding("fail", "line-endings", rel, detail))
    return found


def check_enforced_by() -> list[Finding]:
    """A rule's `Enforced by` field names gate checks this script actually emits.

    The field is where the standard claims mechanical enforcement, and a claim that has drifted is
    worse than an unenforced rule: it reads as covered. The whole field is read, because PRE-4
    closes its vocabulary: what is not a check is a command, which carries a slash or a dot, or a
    linter, which is named in prose beside the selection covering the rule. A bare backticked
    lower-case token is therefore a claim about this gate wherever in the sentence it stands.
    """
    chapters = tracked_glob(CHAPTER_GLOB)
    if not chapters:
        return [Finding("fail", "enforced-by", CHAPTERS_DIR, "no tracked chapter, so no enforcement claim can be resolved")]

    found: list[Finding] = []
    for chapter in chapters:
        rel = chapter.relative_to(REPO_ROOT).as_posix()
        if (text := _readable(chapter)) is None:
            continue  # reported as `unreadable` where the file is scanned in its own right
        for match in ENFORCED_BY_RE.finditer(text):
            field = " ".join(match.group(1).split())
            for name in CHECK_NAME_RE.findall(field):
                if name not in CHECKS:
                    detail = f"claims enforcement by gate check `{name}`, which this gate does not emit: {field[:80]}"
                    found.append(Finding("fail", "enforced-by", rel, detail))
    return found


def check_rule_shape() -> list[Finding]:
    """Every rule in the standard keeps PRE-4's anatomy, which is what the rest of this gate parses.

    `rule-id` resolves a citation to a `### <ID>` heading and `enforced-by` reads the field that
    heading's block ends on, so a rule written in another shape is not a style lapse: it is a rule
    outside the reach of both, silently, while every citation of it still resolves.
    """
    found: list[Finding] = []
    for chapter in tracked_glob(CHAPTER_GLOB):
        rel = chapter.relative_to(REPO_ROOT).as_posix()
        if (text := _readable(chapter)) is None:
            continue
        tabled = set(CHAPTER_ROW_RE.findall(text))
        for rule_id, claim, block in rule_blocks(text):
            if not RULE_CLAIM_RE.match(claim):
                detail = f"{rule_id}'s heading is not `### {rule_id} — <the rule as a claim>` (PRE-4)"
                found.append(Finding("fail", "rule-shape", rel, detail))
            fields = tuple(RULE_FIELD_RE.findall(block))
            if fields != RULE_FIELDS:
                detail = f"{rule_id} carries [{', '.join(fields)}] -- PRE-4 fixes them at [{', '.join(RULE_FIELDS)}], in that order"
                found.append(Finding("fail", "rule-shape", rel, detail))
            if rule_id not in tabled:
                found.append(Finding("fail", "rule-shape", rel, f"{rule_id} has no row in this chapter's rule table (PRE-4)"))
    return found


def check_rule_index(rules: dict[str, list[str]]) -> list[Finding]:
    """Every rule takes one line in the rules index, and no rule takes two (PRE-4).

    The index is what a session reads instead of six chapters, so a rule missing from it is a rule
    most readers never meet. The other direction -- a line naming a rule no chapter states -- is
    `rule-id`'s, which resolves every id on the page already.
    """
    rel = RULES_INDEX_PAGE
    page = tracked_page(rel)
    if page is None or (text := _readable(page)) is None:
        return [Finding("fail", "rule-index", rel, "untracked, unreadable or missing, so no rule's index line can be resolved")]

    listed: list[str] = RULE_INDEX_LINE_RE.findall(text)
    found: list[Finding] = []
    for rule_id in sorted(set(rules) - set(listed)):
        detail = f"{rule_id} has no index line, so it is stated only in {' and '.join(rules[rule_id])}"
        found.append(Finding("fail", "rule-index", rel, detail))
    for rule_id in sorted({name for name in listed if listed.count(name) > 1}):
        found.append(Finding("fail", "rule-index", rel, f"{rule_id} takes {listed.count(rule_id)} index lines -- PRE-4 gives it one"))
    return found


def check_check_registry() -> list[Finding]:
    """CUR-5's table lists exactly the checks this script emits, at the verdicts it emits them.

    The table is the one place the checks are written down, and nothing else reads it. A check
    added without a row defends the repository while telling nobody what its failure means, and a
    row outliving its check sends a reader looking for a defence that is gone.
    """
    rel = CURRENCY_PAGE
    page = tracked_page(rel)
    text = None if page is None else _read_text(page)[0]
    if text is None:
        return [Finding("fail", "check-registry", rel, "untracked or unreadable, so the list of checks cannot be compared against the gate")]

    listed: dict[str, set[str]] = {}
    for name, verdict in CHECK_ROW_RE.findall(text):
        listed.setdefault(name, set()).add(verdict.lower())
    if not listed:
        return [Finding("fail", "check-registry", rel, "carries no check row -- CUR-5's table is where every check is listed")]

    found: list[Finding] = []
    for name in sorted(set(CHECKS) - set(listed)):
        verdicts = " and ".join(sorted(v.capitalize() for v in CHECKS[name]))
        found.append(Finding("fail", "check-registry", rel, f"gate check `{name}` has no row -- add one, verdict {verdicts}"))
    for name in sorted(set(listed) - set(CHECKS)):
        found.append(Finding("fail", "check-registry", rel, f"a row names gate check `{name}`, which this gate does not emit"))
    for name in sorted(set(listed) & set(CHECKS)):
        if listed[name] != set(CHECKS[name]):
            wanted = " and ".join(sorted(v.capitalize() for v in CHECKS[name]))
            found.append(Finding("fail", "check-registry", rel, f"gate check `{name}` is emitted as {wanted}, which its rows do not say"))
    return found


def _glob_table(text: str, header: re.Pattern[str], glob_cell: int = 1) -> dict[str, list[str]] | None:
    """A two-column table's first cell against its backticked globs, or None if absent.

    `glob_cell` names the column holding them: the segment table reads `| Segment | Globs |`, the
    excluded table `| Excluded | Why |`, so one carries its globs second and the other first.

    Read from the command file rather than declared here, so the partition has one definition. Rows
    end at the first line that does not open a table cell, which is what stops a following paragraph
    being read as rows.
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

    The command asserts the partition is total, and until the globs existed nothing could check it:
    a file no segment claims is never dispatched to any agent, and reads afterwards as audited. A
    file two segments claim is audited twice and reported twice, which costs a fix session the time
    it takes to notice they are one defect.
    """
    rel = SWEEP_PAGE
    page = tracked_page(rel)
    text = None if page is None else _readable(page)
    if text is None:
        return [Finding("fail", "segment-map", rel, "untracked or unreadable, so the sweep's partition cannot be held to the tree")]

    segments = _glob_table(text, SEGMENT_HEADER_RE)
    excluded = _glob_table(text, EXCLUDED_HEADER_RE, glob_cell=0)
    if not segments:
        return [Finding("fail", "segment-map", rel, "carries no `Segment` / `Globs` table -- the sweep's partition is what this check reads")]
    if excluded is None:
        return [Finding("fail", "segment-map", rel, "carries no `Excluded` / `Why` table -- without it every excluded file reads as unclaimed")]

    # NUL-separated for the reason `tracked_files` is: git quotes a path outside ASCII, and a quoted
    # spelling matches no glob -- so the check whose subject is "the partition is total" would answer
    # from a listing missing exactly that path.
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

    `check_pr_body.py :: TEMPLATE_FRAGMENTS` refuses a body still holding the form's placeholder
    prose, by matching that prose verbatim. Reword the form and the check keeps passing every
    body, including the unfilled one it exists to catch.
    """
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
