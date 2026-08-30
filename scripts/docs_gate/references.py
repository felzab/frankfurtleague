"""SCRIPTS · what a page points at, and whether it is still there.

A comment is held to what a page is held to (INC-6), so a source file's extracted comments are read
here exactly as a document's prose is. One defect yields one finding: a line citation is stepped
over by the path check, and a backticked path never reaches the bare-path check.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Final

from .kernel import (
    BACKTICK_RE,
    BACKTICK_SPAN_RE,
    CSTYLE_SUFFIXES,
    OPS_FILENAMES,
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
    _untracked_index,
    anchors_of,
    comment_style,
    heading_anchors,
    is_gitignored,
    is_placeholder,
    repo_path,
)
from .perkind import check_metadata_breaks, check_owner_voice
from .structure import _header_scoped, check_header_see, check_module_header

# A repository path in a comment with no backticks, which is how a dead one survives a green gate.
# Anchored on REPO_PREFIXES so prose cannot match, and ended on a word character.
BARE_PATH_RE: Final = re.compile(r"(?<![\w`/.\-])(?:" + "|".join(re.escape(p) for p in REPO_PREFIXES) + r")[\w./\-]*[\w/]")


# The fragment is captured rather than discarded: dropping it lets a link to a heading nobody has
# pass, the file it names still being there.
LINK_RE: Final = re.compile(r"""(?<!!)\[[^\]]*\]\(([^)\s#]*)(#[^)\s]*)?(?:[ \t]+"[^"\n]*"|[ \t]+'[^'\n]*')?\)""")


# A citation is a single backticked run containing exactly one " :: " (COR-6). Read it through
# `unwrapped`, never off the raw body: a code span may wrap, and this stops at the newline.
CITATION_RE: Final = re.compile(r"`([^`\n]+? :: [^`\n]+?)`")


# One line break inside a paragraph, which a renderer joins to a space. The blank line is excluded
# and that is the whole bound: it ends the paragraph, so a join across one would swallow the next.
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

# An audit id and a ledger row fail: both name a document `/audit:finish` deletes. A roadmap id and
# a review round are only reported -- the id resolves, and the round may be a sentence.
AUDIT_ID_RE: Final = re.compile(r"\b(?:audit\s+)?R\d+[a-z]?\s*§\s*S\d+(?:\.\d+)?|§\s*S\d+(?:\.\d+)?")
LEDGER_ROW_RE: Final = re.compile(r"\bledger\s+\S*\d")


# A README is orientation (OUT-3), and the cap is what makes a second body section visible.
README_LINE_CAP: Final = 120


def unwrapped(body: str, markers: tuple[str, ...] = ()) -> str:
    """A body laid out as a renderer lays it out: one paragraph per line, blank lines kept.

    A citation split across a wrap is one citation, and a pattern bounded by the newline calls
    the page clean because it could not see it.
    """
    return _wrap_re(markers).sub(" ", body)


def _resolve(file_part: str) -> list[Path]:
    """A citation may give a repo path, a package-relative one, or an unambiguous bare filename.

    A bare name resolves against the tracked index, templates taken out (CUR-5).
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
    # The index answers first, so a stray copy can neither shadow a tracked file nor make one
    # ambiguous; the tree answers a name the index lacks. Calling a file just written dead invites
    # repointing the citation at a similar name, which then passes.
    key = os.path.normcase(file_part)
    named = _tree_index().get(key) or _untracked_index().get(key, ())
    return [p for p in named if p.is_file() and not _is_template(p)][:5]


def names_a_file(file_part: str) -> bool:
    """Whether a citation's left half READS as a file, for a run that resolved to none.

    A left half that resolves is a file however it is spelled, so this asks only of the rest, and
    asks by suffix: COR-6's form names a file, and quoted prose does not.
    """
    return file_part.endswith(CITABLE_SUFFIXES) or file_part.rsplit("/", 1)[-1] in OPS_FILENAMES


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

    if anchor not in content:
        where = target.relative_to(REPO_ROOT).as_posix()
        return [Finding("fail", "citation", rel, f"anchor '{anchor}' no longer appears in {where}")]
    return []


def check_file(path: Path, rules: dict[str, list[str]], invariants: dict[str, list[str]]) -> list[Finding]:
    """Every per-file check, for one file.

    A source file reaches all of it but the anchor check: an in-page anchor is markdown's alone, a
    source file having no headings of its own for one to resolve against.
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

    for rule_id in sorted(set(RULE_ID_RE.findall(body))):
        homes = rules.get(rule_id, [])
        if not homes:
            found.append(Finding("fail", "rule-id", rel, f"{rule_id} resolves to no rule heading in a tracked docs/_standard/chapters/ page"))
        elif len(homes) > 1:
            found.append(Finding("fail", "rule-id", rel, f"{rule_id} is defined in {' and '.join(homes)} -- a citation cannot say which"))

    if not is_markdown:
        found.extend(check_invariant_citations(rel, body, invariants))

    joined = unwrapped(body, () if is_markdown else continuation_markers(comment_style(path)))
    for citation in sorted(set(CITATION_RE.findall(joined))):
        if not is_placeholder(citation):
            found.extend(_check_citation(citation, rel))

    # Nothing else can detect one: it stays syntactically valid and merely stops pointing at what it
    # names, so it has to be caught at the form.
    cited_lines = set(LINE_CITATION_RE.findall(joined)) | set(BARE_LINE_CITATION_RE.findall(joined))
    for citation in sorted(cited_lines):
        if is_placeholder(citation):
            continue
        found.append(Finding("fail", "line-citation", rel, f"line-number citation `{citation}` -- anchor it to a symbol (COR-6)"))

    # Only the VALUE is tested for a placeholder: the label's own `**` reads as a wildcard, which
    # would exempt every stamp there is.
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
        # The file resolves and the heading it names does not, so the link opens the right page at
        # the top and looks correct.
        if anchor and target.suffix == ".md" and (reachable := anchors_of(target)) is not None and anchor not in reachable:
            found.append(Finding("fail", "anchor", rel, f"no heading in {raw_target} yields #{anchor}"))

    if is_template and "path" in TEMPLATE_EXEMPT_CHECKS:
        return found

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
    # Backticked spans out first, or one dead path yields a `path` finding and a `bare-path` one.
    for token in sorted({match.group(0) for match in BARE_PATH_RE.finditer(BACKTICK_SPAN_RE.sub("", body))}):
        # `is_gitignored` shells out, so it stays behind the tests that answer without one.
        if is_placeholder(token) or any((base / token).exists() for base in bases) or is_gitignored(token):
            continue
        found.append(Finding("fail", "bare-path", rel, f"path named but not present: {token} -- and unbackticked, so `path` never saw it"))
    return found


def check_comment_citations(rel: str, body: str) -> list[Finding]:
    """The two citation shapes INC-6 bans outright, over one file's comments.

    Failing, because neither survives its programme: both name a document `/audit:finish` deletes.
    """
    found: list[Finding] = []
    for match in AUDIT_ID_RE.finditer(body):
        found.append(
            Finding("fail", "comment-citation", rel, f"audit id `{match.group(0).strip()}` in a comment (INC-6) -- cite a path or a symbol")
        )
    for match in LEDGER_ROW_RE.finditer(body):
        found.append(
            Finding("fail", "comment-citation", rel, f"ledger row `{match.group(0).strip()}` in a comment (INC-6) -- cite a path or a symbol")
        )
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
        found.append(Finding("fail", "rule-id", rel, f"bare `{match.group(1)}`, which {' and '.join(homes)} both define -- name the sheet"))
    return found


def cited_paths(body: str) -> set[str]:
    """Repo paths a page points at: the file half of each citation, plus backticked repo paths."""
    out: set[str] = set()
    for citation in CITATION_RE.findall(unwrapped(body)):
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
