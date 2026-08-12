"""
SCRIPTS · what a page points at, and whether it is still there

Citations, links, anchors, ADR numbers, rule ids and paths, and the per-file driver running every
one of them over a single file. A comment is held to what a page is held to (INC-6), so a source
file's extracted comments are read here exactly as a document's prose is.

Invariants:
- A dead reference is caught at its form rather than its meaning: COR-6 bans a line-number
  citation outright, and nothing but the shape of one detects it.
- One defect yields one finding. A line citation is stepped over by the path check, and a
  backticked path never reaches the bare-path check.

See:
- docs/_standard/chapters/1-core.md — COR-6, which decides what a reference may look like
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Final

from .kernel import (
    BACKTICK_RE,
    BACKTICK_SPAN_RE,
    REPO_PREFIXES,
    REPO_ROOT,
    SCANNED_SUFFIXES,
    STAMP_LINE_NUMBER,
    STAMP_START_RE,
    STRICT_STAMP_RE,
    TEMPLATE_EXEMPT_CHECKS,
    Finding,
    _is_template,
    _read_text,
    _scan_body,
    _tree_index,
    anchors_of,
    heading_anchors,
    is_gitignored,
    is_placeholder,
    repo_path,
)
from .perkind import check_metadata_breaks, check_owner_voice
from .structure import _header_scoped, check_header_see, check_module_header

# A repository path in a comment with no backticks, which is how a dead one survives a green gate:
# `path` reads backticked tokens alone. Anchored on REPO_PREFIXES so prose cannot match, and ended
# on a word character so trailing punctuation stays out.
BARE_PATH_RE: Final = re.compile(r"(?<![\w`/.\-])(?:" + "|".join(re.escape(p) for p in REPO_PREFIXES) + r")[\w./\-]*[\w/]")


ADR_RE: Final = re.compile(r"\bADR-(\d{4})\b")
# The fragment is captured rather than discarded: dropping it is what let a link to a heading that
# no longer exists pass, since the file it names is still there. A title is CommonMark's; an empty
# target is an in-page link.
LINK_RE: Final = re.compile(r"""(?<!!)\[[^\]]*\]\(([^)\s#]*)(#[^)\s]*)?(?:[ \t]+"[^"\n]*"|[ \t]+'[^'\n]*')?\)""")


# A citation is a single backticked run containing exactly one " :: ". The separator is what marks it
# as checkable rather than prose (COR-6).
CITATION_RE: Final = re.compile(r"`([^`\n]+? :: [^`\n]+?)`")


# A rule id resolves to a rule heading in the standard's chapters or it dangles. Two segments and a
# short number, so the backend's three-segment error codes (REQ-VAL-001) can never collide.
RULE_ID_RE: Final = re.compile(r"\b((?:PRE|COR|INC|OUT|DEC|CUR)-\d{1,2})\b")


INVARIANT_CITE_RE: Final = re.compile(r"(?<![A-Za-z0-9])(I\d{1,3}[a-z]?)(?![A-Za-z0-9])")
SURFACE_WORDS: Final = re.compile(r"\b(backend|frontend|ops|logging|_git)\b|spec\.md", re.IGNORECASE)

# COR-6 bans a line-number citation, and nothing but its form detects one. Closed to the TEXT
# suffixes this repository holds, so `example.com:443` stays prose; one added to the tree and not
# here escapes both patterns silently.
CITABLE_SUFFIXES: Final[tuple[str, ...]] = (".md", ".css", ".svg", ".lock", *SCANNED_SUFFIXES)
# Longest first, so the alternation cannot stop at `.ts` inside `.tsx` and leave the colon unmatched.
_CITABLE_SUFFIX_RE: Final = "|".join(re.escape(suffix) for suffix in sorted(set(CITABLE_SUFFIXES), key=len, reverse=True))
LINE_CITATION_RE: Final = re.compile(rf"`([^`\n]*(?:{_CITABLE_SUFFIX_RE}):\d+(?:-\d+)?)`")
# The same citation with no backticks, which is how a comment usually carries one. The directory run
# sits inside the capture: the guard rejects a start after `/` or `.`, which holds a URL out and
# would hold a path out with it.
BARE_LINE_CITATION_RE: Final = re.compile(rf"(?<![/`\w.])((?:[\w.-]+/)*[\w.-]*[\w-](?:{_CITABLE_SUFFIX_RE}):\d+(?:-\d+)?)\b")

# INC-6's banned comment citations. An audit id and a ledger row fail: both name a document
# `/audit:finish` deletes. A roadmap id and a review round are reported -- the id resolves, and
# the round may be a sentence.
AUDIT_ID_RE: Final = re.compile(r"\b(?:audit\s+)?R\d+[a-z]?\s*§\s*S\d+(?:\.\d+)?|§\s*S\d+(?:\.\d+)?")
LEDGER_ROW_RE: Final = re.compile(r"\bledger\s+\S*\d")


# A README is orientation (OUT-3), and the cap is what makes a second body section visible.
README_LINE_CAP: Final = 120


def _resolve(file_part: str) -> list[Path]:
    """A citation may give a repo path, a package-relative one, or an unambiguous bare filename.

    The path as written answers first, so a name spelled the way a repository-root file is spelled
    resolves to that file; then the package roots `repo_path` tries; then, for a name carrying no
    directory at all, the tracked index with the templates taken out of it (CUR-5). The cap falls on
    the first few by path rather than on the order the listing arrived in, the index being sorted.
    """
    direct = REPO_ROOT / file_part
    if direct.is_file():
        return [direct]
    # A comment beside the code cites the way its own package spells a path, and reporting that as
    # a dead file is the false positive that gets a citation rewritten to something looser.
    if (resolved := repo_path(file_part)) is not None and (REPO_ROOT / resolved).is_file():
        return [REPO_ROOT / resolved]
    if "/" in file_part:
        return []
    named = _tree_index().get(os.path.normcase(file_part), ())
    return [p for p in named if p.is_file() and not _is_template(p)][:5]


def _check_citation(citation: str, rel: str) -> list[Finding]:
    """A <file> :: <anchor> citation: the file must exist and the anchor must appear inside it."""
    file_part, _, anchor = citation.partition(" :: ")
    file_part, anchor = file_part.strip(), anchor.strip()
    if not file_part or not anchor:
        return [Finding("fail", "citation", rel, f"malformed citation: {citation}")]

    matches = _resolve(file_part)
    if not matches:
        return [Finding("fail", "citation", rel, f"cited file not found: {file_part}")]
    if len(matches) > 1:
        names = ", ".join(sorted(m.relative_to(REPO_ROOT).as_posix() for m in matches)[:4])
        return [Finding("fail", "citation", rel, f"ambiguous file '{file_part}' matches: {names}")]

    target = matches[0]
    content, error = _read_text(target)
    if content is None:
        return [Finding("fail", "citation", rel, f"cannot read {file_part}: {error}")]

    if anchor not in content:
        where = target.relative_to(REPO_ROOT).as_posix()
        return [Finding("fail", "citation", rel, f"anchor '{anchor}' no longer appears in {where}")]
    return []


def check_file(path: Path, existing_adrs: set[str], rules: dict[str, list[str]], invariants: dict[str, list[str]]) -> list[Finding]:
    """Every per-file check, for one file.

    A source file reaches all of it but the anchor check. INC-6 makes a comment a spec sheet's
    equal, so a dead path or a broken link inside one is the same defect wherever it is written;
    an in-page anchor is markdown's alone, because a source file has no headings of its own for
    one to resolve against.
    """
    rel = path.relative_to(REPO_ROOT).as_posix()
    is_markdown = path.suffix == ".md"
    is_template = _is_template(path)
    raw, error = _read_text(path)
    if raw is None:
        return [Finding("fail", "unreadable", rel, error)]
    body = _scan_body(path)

    found: list[Finding] = []

    if not is_markdown and _header_scoped(rel, path.suffix):
        found.extend(check_module_header(rel, raw, path.suffix))
        found.extend(check_header_see(rel, raw, path.suffix))

    if is_markdown and path.name == "README.md" and len(raw.splitlines()) > README_LINE_CAP:
        found.append(Finding("fail", "readme-cap", rel, f"a README of {len(raw.splitlines())} lines -- OUT-3 caps one at {README_LINE_CAP}"))

    found.extend(check_owner_voice(rel, body))
    if is_markdown:
        found.extend(check_metadata_breaks(rel, body))
    else:
        found.extend(check_comment_citations(rel, body))
        found.extend(check_bare_paths(rel, body))

    for number in sorted(set(ADR_RE.findall(body))):
        if number not in existing_adrs:
            found.append(Finding("fail", "adr", rel, f"ADR-{number} resolves to no tracked file in docs/_decisions/"))

    for rule_id in sorted(set(RULE_ID_RE.findall(body))):
        homes = rules.get(rule_id, [])
        if not homes:
            found.append(Finding("fail", "rule-id", rel, f"{rule_id} resolves to no rule heading in a tracked docs/_standard/chapters/ page"))
        elif len(homes) > 1:
            found.append(Finding("fail", "rule-id", rel, f"{rule_id} is defined in {' and '.join(homes)} -- a citation cannot say which"))

    if not is_markdown:
        found.extend(check_invariant_citations(rel, body, invariants))

    for citation in sorted(set(CITATION_RE.findall(body))):
        if not is_placeholder(citation):
            found.extend(_check_citation(citation, rel))

    # COR-6 bans line-number citations outright. Nothing else can detect one: it stays syntactically
    # valid and merely stops pointing at what it names, so it has to be caught at the form.
    cited_lines = set(LINE_CITATION_RE.findall(body)) | set(BARE_LINE_CITATION_RE.findall(body))
    for citation in sorted(cited_lines):
        if is_placeholder(citation):
            continue
        found.append(Finding("fail", "line-citation", rel, f"line-number citation `{citation}` -- anchor it to a symbol (COR-6)"))

    # A page's stamp is held to CUR-3's line 3 as well as its shape. Only the VALUE is tested for a
    # placeholder: the label's own `**` reads as a wildcard, which would exempt every stamp there is.
    if not (is_template and "stamp-format" in TEMPLATE_EXEMPT_CHECKS):
        for number, line in enumerate(body.split("\n"), start=1):
            if STAMP_START_RE.match(line) is None or is_placeholder(line.partition(":**")[2]):
                continue
            if not STRICT_STAMP_RE.fullmatch(line):
                found.append(Finding("fail", "stamp-format", rel, f"stamp line is not CUR-3's exact shape: {line.strip()}"))
            elif is_markdown and number != STAMP_LINE_NUMBER:
                detail = f"the stamp sits at line {number} -- CUR-3 puts it on line {STAMP_LINE_NUMBER}"
                found.append(Finding("fail", "stamp-format", rel, detail))

    anchors = heading_anchors(body) if is_markdown else set()
    for raw_target, fragment in sorted(set(LINK_RE.findall(body))):
        anchor = fragment[1:]
        if raw_target.startswith(("http://", "https://", "mailto:")) or is_placeholder(raw_target + fragment):
            continue
        if not raw_target:
            if is_markdown and anchor and anchor not in anchors:
                found.append(Finding("fail", "anchor", rel, f"no heading in this file yields #{anchor}"))
            continue
        if is_template and "link" in TEMPLATE_EXEMPT_CHECKS:
            continue
        target = (path.parent / raw_target).resolve()
        if not target.exists():
            found.append(Finding("fail", "link", rel, f"link target does not exist: {raw_target}"))
            continue
        # The half a fragment-stripping link check never saw: the file resolves and the heading it
        # names does not, so the link opens the right page at the top and looks correct.
        if anchor and target.suffix == ".md" and (reachable := anchors_of(target)) is not None and anchor not in reachable:
            found.append(Finding("fail", "anchor", rel, f"no heading in {raw_target} yields #{anchor}"))

    if is_template and "path" in TEMPLATE_EXEMPT_CHECKS:
        return found

    for token in sorted(set(BACKTICK_RE.findall(body))):
        # A line-number citation is already reported above; it can never exist as a path, so letting
        # the path check fire too would give one defect two findings.
        if " :: " in token or is_placeholder(token) or not token.startswith(REPO_PREFIXES):
            continue
        if LINE_CITATION_RE.fullmatch(f"`{token}`"):
            continue
        if not (REPO_ROOT / token).exists() and not is_gitignored(token):
            found.append(Finding("fail", "path", rel, f"path named but not present: {token}"))

    return found


def check_bare_paths(rel: str, body: str) -> list[Finding]:
    """A repository path named in a comment without backticks, resolving to nothing.

    Comments only. A document is held to COR-6's backticks and its paths therefore reach the `path`
    check; a comment reaches for a bare path constantly, which is how a batch of dead ones survived
    a rename under a green gate. Backticked spans come out first so one dead path never produces two
    findings.

    A token is resolved from the repository root and then from each directory above the file naming
    it, because that is how a reader resolves one: a usage line naming a path relative to its own
    package names a file that exists, and failing it would be the false positive that gets a check
    suppressed. A path dead from every one of them is still dead.
    """
    found: list[Finding] = []
    bases = [REPO_ROOT, *(REPO_ROOT / parent for parent in Path(rel).parents if parent.as_posix() != ".")]
    for token in sorted({match.group(0) for match in BARE_PATH_RE.finditer(BACKTICK_SPAN_RE.sub("", body))}):
        # `is_gitignored` shells out, so it stays behind the tests that answer without one.
        if is_placeholder(token) or any((base / token).exists() for base in bases) or is_gitignored(token):
            continue
        found.append(Finding("fail", "bare-path", rel, f"path named but not present: {token} -- and unbackticked, so `path` never saw it"))
    return found


def check_comment_citations(rel: str, body: str) -> list[Finding]:
    """The two citation shapes INC-6 bans outright, over one file's comments.

    Whole tree, and failing, because neither survives its programme: both name a document
    `/audit:finish` deletes, so the reference is already dead in the clone a stranger has.
    """
    found: list[Finding] = []
    for match in AUDIT_ID_RE.finditer(body):
        found.append(
            Finding("fail", "comment-citation", rel, f"audit id `{match.group(0).strip()}` in a comment (INC-6) -- cite an ADR or a path")
        )
    for match in LEDGER_ROW_RE.finditer(body):
        found.append(
            Finding("fail", "comment-citation", rel, f"ledger row `{match.group(0).strip()}` in a comment (INC-6) -- cite an ADR or a path")
        )
    return found


def _enclosing_block(body: str, offset: int) -> str:
    """The unbroken run of non-blank lines around one offset -- the comment the citation sits in.

    A window measured in characters would reach across the blank lines `comments_only` leaves where
    the code was, and pick a disambiguating word out of an unrelated comment.
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

    Comments only. A page citing an invariant sits in its surface's folder or links to the sheet in
    the same paragraph, and its reader resolves the id from that; a comment carries no such
    context, so the nearest sheet is whichever one the reader happens to open -- which is how a
    frontend file citing a backend invariant lands on a rule about export style instead.
    """
    found: list[Finding] = []
    for match in INVARIANT_CITE_RE.finditer(body):
        homes = invariants.get(match.group(1), [])
        if len(homes) < 2:
            continue
        if SURFACE_WORDS.search(_enclosing_block(body, match.start())):
            continue
        found.append(Finding("fail", "rule-id", rel, f"bare `{match.group(1)}`, which {' and '.join(homes)} both define -- name the sheet"))
    return found


def cited_paths(body: str) -> set[str]:
    """Repo paths a page points at: the file half of each citation, plus backticked repo paths."""
    out: set[str] = set()
    for citation in CITATION_RE.findall(body):
        if is_placeholder(citation):
            continue
        if (resolved := repo_path(citation.partition(" :: ")[0].strip())) is not None:
            out.add(resolved)
    for token in BACKTICK_RE.findall(body):
        if " :: " in token or is_placeholder(token):
            continue
        if (resolved := repo_path(token)) is not None:
            out.add(resolved)
    return out
