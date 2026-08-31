"""SCRIPTS · the checks a page's kind decides.

Each resolves its input through the tracked corpus, so an absent input is `inputs`' finding and
an untracked one the reading check's own. A check whose input is missing says so, never passes.
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
    CHECKS,
    DOCS_DIR,
    GLOSSARY_PAGE,
    OVERVIEW_GLOB,
    REPO_ROOT,
    ROADMAP_GLOB,
    ROADMAP_RANKED_PAGES,
    SPEC_GLOB,
    STANDARD_PAGE,
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

# The label is bounded because a bold sentence ending in a colon is prose, and holding prose to a
# layout rule gets a check ignored.
METADATA_LINE_RE: Final = re.compile(r"^\*\*([A-Z][A-Za-z ]{0,30}):\*\*(?:\s|$)")
# Whitespace before the second label is spared: a report header may carry fields on one physical
# line on purpose.
METADATA_JOIN_RE: Final = re.compile(r"(?:(\\n)\s*|(?<=\S))\*\*([A-Z][A-Za-z ]{0,30}):\*\*")


RULE_HEAD_RE: Final = re.compile(r"^((?:PRE|COR|INC|OUT|DEC|CUR)-\d{1,2})\b(.*)$")
RULE_CLAIM_RE: Final = re.compile(r"^\s+—\s+\S")
RULE_FIELDS: Final[tuple[str, ...]] = ("Rule", "Why", "Exceptions", "Enforced by", "Example")
# PRE-4 orders the fields but requires only these, so a page's set is a subsequence: an empty
# optional field is deleted rather than filled with a dash.
REQUIRED_RULE_FIELDS: Final[tuple[str, ...]] = ("Rule", "Enforced by")
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
ENFORCED_BY_RE: Final = re.compile(r"^[ \t]*\*\*Enforced by:\*\*(.*?)(?=\n[ \t]*\n|\Z)", re.MULTILINE | re.DOTALL)
CHECK_NAME_RE: Final = re.compile(r"`([a-z][a-z0-9-]*)`")

SEGMENT_HEADER_RE: Final = re.compile(r"^[ \t]*\|\s*Segment\s*\|\s*Globs\s*\|", re.MULTILINE)
EXCLUDED_HEADER_RE: Final = re.compile(r"^[ \t]*\|\s*Excluded\s*\|\s*Why\s*\|", re.MULTILINE)
# A folder moved wholesale unclaims every file under it, and a finding printing hundreds of paths
# is one nobody reads.
SEGMENT_SAMPLE: Final = 8


# A page that is not there yields nothing, so an absent input degrades the check reading it to
# silence with the run green. Named here so the absence itself fails.
REQUIRED_INPUTS: Final[tuple[str, ...]] = (
    STANDARD_PAGE,
    *ROADMAP_RANKED_PAGES,
    TEMPLATES_PAGE,
    GLOSSARY_PAGE,
    SWEEP_PAGE,
)

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


ROADMAP_ID_DEF_RE: Final = re.compile(r"^[ \t]*\|\s*(?:\d+\s*\|\s*)?\*{0,2}([A-Z]{1,4}-\d{1,3})\*{0,2}\s*\|", re.MULTILINE)

# The id is captured loose, so a malformed one is caught against the vocabulary, not skipped.
ROADMAP_ENTRY_RE: Final = re.compile(r"^ {0,3}###\s+(\d+)\s+·\s+(\S+)\s+—", re.MULTILINE)
# An id in the second cell is what separates an index row from the page's other numeric tables:
# a row reading `| 4 | 6 | walks |` counts fixtures, not entries.
ROADMAP_INDEX_ROW_RE: Final = re.compile(r"^[ \t]*\|\s*(\d+)\s*\|\s*([A-Z]{1,4}-\d{1,3})\s*\|(.*)$", re.MULTILINE)
ROADMAP_STATUS_RE: Final = re.compile(r"^[ \t]*\*\*Status:\*\*\s*(.+?)\s*\\?$", re.MULTILINE)
# Closed exists for exactly one commit -- the one concluding an entry, whose successor deletes it.
ROADMAP_TRANSIENT_STATUS: Final = "Closed"

# Quoted and backticked spans come out first: naming the phrase to ban it, as the rule itself
# does, is a mention rather than a use.
OWNER_PHRASE_RE: Final = re.compile(r"\bthe owner\b", re.IGNORECASE)
QUOTED_SPAN_RE: Final = re.compile(r"\"[^\"\n]*\"|`[^`\n]*`|“[^”\n]*”")
OWNER_EXEMPT_PREFIX: Final = ".claude/"


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
    page = tracked_page(STANDARD_PAGE)
    text = None if page is None else _readable(page)
    if text is None:
        return ids
    for rule_id, _, _ in rule_blocks(text):
        ids.setdefault(rule_id, []).append("a section")
    for rule_id in RULE_INDEX_LINE_RE.findall(text):
        ids.setdefault(rule_id, []).append("a list line")
    return ids


@cache
def roadmap_ids() -> frozenset[str]:
    """Every hyphenated id the roadmap tables define.

    Read rather than guessed: the prefixes are open-ended, so a pattern would catch `UTF-8`. An
    unhyphenated id is left out, that shape occurring in code for unrelated reasons.
    """
    ids: set[str] = set()
    for page in tracked_glob(ROADMAP_GLOB):
        if (text := _read_text(page)[0]) is not None:
            ids.update(ROADMAP_ID_DEF_RE.findall(text))
    return frozenset(ids)


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
                        f"the {match.group(1)} line at line {index + 1} runs into {joined.group(2)} on one physical line"
                        f" -- COR-8's break is a line ending, written here as {written}"
                    )
                    found.append(Finding("fail", "metadata-break", rel, detail))
            elif names:
                ends[-1] = index
            index += 1
        for position, (name, end) in enumerate(zip(names, ends, strict=True)):
            # The last entry carries no break, having nothing below it to part from.
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


def check_roadmap() -> list[Finding]:
    """Each ranked roadmap page agrees with itself: index and entries, ranks, ids, no transient status.

    Ranks run from 1 per page, not across the folder: product and tooling work are not comparable.
    """
    found: list[Finding] = []
    for rel in ROADMAP_RANKED_PAGES:
        page = tracked_page(rel)
        if page is None:
            # Absence is `check_inputs`' alone. A page on disk but untracked is neither absent nor
            # selected by anything reading the corpus, so this is the one place it is not green.
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

        # Contiguous from 1 on each side: a gap makes "the next one" unanswerable and a duplicate
        # makes the working order ambiguous.
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

    A check treats an empty answer as nothing to say, so a moved input passes over nothing.
    Presence on disk, not in the index: untracked is a caller's own finding.
    """
    return [
        Finding("fail", "inputs", rel, "missing -- the check reading it would otherwise pass without examining anything")
        for rel in REQUIRED_INPUTS
        if not (REPO_ROOT / rel).exists()
    ]


def check_line_endings() -> list[Finding]:
    """The working tree holds LF wherever `.gitattributes` mandates it.

    The declaration takes effect at commit, so a CRLF tree reads clean in the index and breaks
    where the file runs -- a shell script dies on its shebang on the server.
    """
    # NUL-separated, so a path outside ASCII arrives as itself rather than octal-escaped: a
    # spelling no checkout holds sends the reader looking for a file that is not there.
    listing = git("ls-files", "--eol", "-z")
    if listing is None:
        # A run that cannot read the index proves nothing about the tree, and silence is
        # indistinguishable from a clean answer.
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


def _byte_site(data: bytes, offset: int) -> str:
    """One byte's place, spelled for both tools a reader reaches for: an editor and a hex dump."""
    line = data.count(b"\n", 0, offset) + 1
    # `rfind` answers -1 where no newline precedes the byte, which makes the subtraction offset + 1.
    column = offset - data.rfind(b"\n", 0, offset)
    return f"offset {offset} (line {line}, column {column})"


def check_binary_bytes() -> list[Finding]:
    """No file `.gitattributes` declares as text holds a NUL or a stray CR.

    Either stops git classifying its endings, so the LF mandate lapses -- and nothing else
    reports it, both being legal inside a string literal.
    """
    listing = git("ls-files", "--eol", "-z")
    if listing is None:
        # A run that cannot list the tree read no bytes, and silence would be indistinguishable
        # from a clean answer.
        detail = "git could not list the tree, so no tracked file was read for a NUL or a CR byte"
        return [Finding("fail", "binary-byte", ".gitattributes", detail)]

    found: list[Finding] = []
    for line in listing.split("\x00"):
        if (match := LS_FILES_EOL_RE.match(line)) is None:
            continue
        worktree, attributes, rel = match.group(2), match.group(3), match.group(4)
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
            detail = (
                f"a NUL byte at {_byte_site(data, offset)}. git then reads this file as binary, so `.gitattributes`' LF "
                "mandate stops applying to it and its diff becomes unreadable -- and no formatter, linter, type checker or "
                "test sees the byte, a NUL being legal inside a string literal. Repair: put the character that belongs "
                "there in its place, and save the file as UTF-8 with LF."
            )
            found.append(Finding("fail", "binary-byte", rel, detail))
        # CRLF where LF is mandated is `check_line_endings`' finding. Reporting it here as well would
        # give one file two repairs; what is left is the CR that check cannot see, git having given
        # up on the file rather than classified its endings.
        if worktree in NON_LF_WORKTREE or CRLF_MANDATED in attributes:
            continue
        if (offset := data.find(b"\r")) >= 0:
            detail = (
                f"a CR byte at {_byte_site(data, offset)}. Every line here ends with LF alone, and a CR git cannot read as "
                "part of a CRLF pair leaves it unable to classify this file's endings, so `.gitattributes`' LF mandate "
                "lapses and CRLF commits through unwarned, while the diff still reads. Repair: delete the byte, and save "
                "the file as UTF-8 with LF."
            )
            found.append(Finding("fail", "binary-byte", rel, detail))
    return found


def check_enforced_by() -> list[Finding]:
    """A rule's enforcement claim names gate checks this script actually emits.

    Read in each of PRE-4's shapes: a section's `**Enforced by:**` field, and a list line's
    `_Enforced by_`. A drifted claim is worse than an unenforced rule: it reads as covered.
    """
    page = tracked_page(STANDARD_PAGE)
    text = None if page is None else _readable(page)
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

    for match in ENFORCED_BY_RE.finditer(text):
        resolve(match.group(1))
    for block in RULE_INDEX_BLOCK_RE.findall(text):
        if (claim := INDEX_ENFORCED_RE.search(block)) is not None:
            resolve(claim.group(1))
    return found


def _ordered_subsequence(fields: tuple[str, ...], order: tuple[str, ...]) -> bool:
    """Whether every field is drawn from `order` and they appear in it.

    A duplicate fails: `index` finds the first match, so a repeated field advances the cursor only
    where the order would have allowed another anyway.
    """
    cursor = -1
    for name in fields:
        if name not in order or (position := order.index(name)) <= cursor:
            return False
        cursor = position
    return True


def check_rule_shape() -> list[Finding]:
    """Every section rule in the standard keeps PRE-4's anatomy, which is what the rest of this gate parses.

    A rule written in another shape falls outside `rule-id` and `enforced-by` while every citation
    of it still resolves.
    """
    page = tracked_page(STANDARD_PAGE)
    text = None if page is None else _readable(page)
    if text is None:
        # Absence is `inputs`' finding; an untracked or unreadable standard also empties
        # `rule_ids`, which fails every citation through `rule-id`.
        return []

    found: list[Finding] = []
    for rule_id, claim, block in rule_blocks(text):
        if not RULE_CLAIM_RE.match(claim):
            detail = f"{rule_id}'s heading is not `### {rule_id} — <the rule as a claim>` (PRE-4)"
            found.append(Finding("fail", "rule-shape", STANDARD_PAGE, detail))
        fields = tuple(RULE_FIELD_RE.findall(block))
        if not _ordered_subsequence(fields, RULE_FIELDS):
            detail = f"{rule_id} carries [{', '.join(fields)}] -- PRE-4 draws them from [{', '.join(RULE_FIELDS)}], in that order"
            found.append(Finding("fail", "rule-shape", STANDARD_PAGE, detail))
        elif missing := tuple(name for name in REQUIRED_RULE_FIELDS if name not in fields):
            detail = f"{rule_id} states no {' and no '.join(f'**{name}:**' for name in missing)} -- PRE-4 requires both"
            found.append(Finding("fail", "rule-shape", STANDARD_PAGE, detail))
    return found


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
