"""SCRIPTS · INC-2's header anatomy and INC-9's block bounds.

Both read a file's raw text rather than its scanned body: a header is defined by where it sits, and
a block's length is measured in the lines a reader meets.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from pathlib import Path
from typing import Final

from .kernel import (
    REPO_ROOT,
    Finding,
    comment_style,
    is_gitignored,
    is_placeholder,
    repo_path,
)

# A `See:` entry opens with what it points at, so the token is its first word and no separator
# needs enumerating. An entry opening with prose is skipped instead.
SEE_ENTRY_RE: Final = re.compile(r"\s+")

# Only a token carrying a suffix is resolved, so a bare folder in the reason half is not read as a
# dead path.
SUFFIXED_RE: Final = re.compile(r"\.[A-Za-z]{1,5}$")


# Both hold at once: three long lines and one very long line are the same comment with its line
# breaks moved. This is the inline cap.
COMMENT_LINE_CAP: Final = 3
# A symbol doc's extra lines pay for its delimiters, a summary and the blank line after it -- never
# for prose, which is why the character cap stays one number for every shape.
DOC_LINE_CAP: Final = 6
COMMENT_CHAR_CAP: Final = 250


# INC-2's header shapes, checked only where that rule binds. Presence is never checked: INC-2 fixes
# the shape of a header that exists, so a file with none passes unchecked.
HEADER_SCOPES: Final[tuple[tuple[str, tuple[str, ...]], ...]] = (
    # TypeScript is out of scope: INC-2 permits no header there, so a block opening one of its
    # files is a symbol doc, which `comment-length` bounds well inside `HEADER_CAP`.
    ("fl_backend/app/", (".py",)),
    ("fl_backend/tests/", (".py",)),
    ("scripts/", (".py", ".sh")),
)
HEADER_CAP: Final = 20
# The subtrees chapter 2 binds, which is where its comment rules are checked.
INCODE_SCOPES: Final[tuple[str, ...]] = ("fl_frontend/src/", "fl_backend/app/", "fl_backend/tests/", "scripts/", ".claude/hooks/")
# A directive stays above the header (INC-7), so the header scan steps over it.
DIRECTIVE_RE: Final = re.compile(r"^\s*([\"'])use (client|server|strict)\1;?\s*$")
PY_DOCSTRING_OPEN_RE: Final = re.compile(r"^[rRuU]?(\"\"\"|''')")
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


def _module_header(raw: str, suffix: str) -> list[str] | None:
    """The module header's lines, delimiters included, or None where there is none.

    A shebang is a directive, so counting it would spend a capped line. An unterminated delimiter
    runs to the file's end, which the line cap then fails.
    """
    lines = raw.split("\n")
    i = 0
    if suffix == ".sh":
        while i < len(lines) and (not lines[i].strip() or lines[i].startswith("#!")):
            i += 1
        start = i
        while i < len(lines) and lines[i].lstrip().startswith("#"):
            i += 1
        return lines[start:i] or None
    if suffix == ".py":
        while i < len(lines) and (not lines[i].strip() or lines[i].lstrip().startswith("#")):
            i += 1
        if i == len(lines):
            return None
        opened = PY_DOCSTRING_OPEN_RE.match(lines[i].lstrip())
        if opened is None:
            return None
        quote = opened.group(1)
        if quote in lines[i].lstrip()[opened.end() :]:  # a one-line docstring closes on its own line
            return lines[i : i + 1]
        start = i
        i += 1
        while i < len(lines) and quote not in lines[i]:
            i += 1
        return lines[start : i + 1]

    while i < len(lines) and (not lines[i].strip() or DIRECTIVE_RE.match(lines[i])):
        i += 1
    if i == len(lines) or not lines[i].lstrip().startswith("/*"):
        return None
    start = i
    while i < len(lines) and "*/" not in lines[i]:
        i += 1
    return lines[start : i + 1]


def _header_line(line: str, suffix: str) -> str:
    """One header line with its comment decoration removed -- the text INC-2's shapes apply to."""
    text = line.strip()
    if suffix == ".sh":
        return text.lstrip("#").strip()
    if suffix == ".py":
        text = PY_DOCSTRING_OPEN_RE.sub("", text)
        return text.removesuffix('"""').removesuffix("'''").strip()
    text = text.removesuffix("*/").strip()
    for opener in ("/**", "/*", "*"):
        if text.startswith(opener):
            return text[len(opener) :].strip()
    return text


def comment_runs(raw: str, suffix: str, *, symbol_docs: bool) -> list[tuple[int, list[str]]]:
    """Each run of consecutive comment lines below the module header, as (first line, text lines).

    Markers come off, being what the bounds do not measure. The header is skipped either way:
    INC-2 caps it separately.
    """
    lines = raw.split("\n")
    start_at = 0
    if (header := _module_header(raw, suffix)) is not None:
        for index in range(len(lines)):
            if lines[index : index + len(header)] == header:
                start_at = index + len(header)
                break

    runs: list[tuple[int, list[str]]] = []
    current: list[str] = []
    first_line = 0
    closing: str | None = None
    keeping = True
    hash_only = suffix in (".py", ".sh")

    def flush() -> None:
        nonlocal current, first_line
        if current and any(current):
            runs.append((first_line, current))
        current = []

    for number, line in enumerate(lines[start_at:], start=start_at + 1):
        text = line.strip()
        if closing is not None:  # inside a block comment or a docstring
            if keeping:
                current.append(_header_line(text.removesuffix(closing), suffix))
            if closing in text:
                closing = None
                if keeping:
                    flush()
                keeping = True
            continue

        opened = PY_DOCSTRING_OPEN_RE.match(text) if hash_only else None
        if opened is not None:
            flush()
            keeping = symbol_docs
            first_line = number
            body = text[opened.end() :]
            quote = opened.group(1)
            if keeping:
                current.append(body.removesuffix(quote).strip())
            if quote in body:
                if keeping:
                    flush()
                keeping = True
            else:
                closing = quote
            continue

        # `{/* … */}` opens with a brace, so it matches neither arm below and every JSX comment
        # would go unbounded. Tested before the plain `/*` arm, which the brace hides it from.
        if not hash_only and text.startswith("{/*"):
            flush()
            # It interrupts markup and documents no symbol, so it is inline under either pass.
            keeping = True
            first_line = number
            body = text.lstrip("{/*").strip()
            current.append(body.removesuffix("*/}").strip())
            if "*/}" in text[3:]:
                flush()
            else:
                closing = "*/}"
            continue

        if not hash_only and text.startswith("/*"):
            flush()
            keeping = symbol_docs or not text.startswith("/**")
            first_line = number
            body = text.lstrip("/*").strip()
            if keeping:
                current.append(body.removesuffix("*/").strip())
            if "*/" in text[2:]:
                if keeping:
                    flush()
                keeping = True
            else:
                closing = "*/"
            continue

        marker = "#" if hash_only else "//"
        if text.startswith(marker):
            if not current:
                first_line = number
            current.append(text.lstrip("#").strip() if hash_only else text[2:].strip())
            continue
        flush()

    flush()
    return runs


def _misplaced_header(raw: str, suffix: str) -> tuple[int, list[str]] | None:
    """A header-shaped comment block that is not the file's opening one.

    The title line identifies it: nothing else opens a comment with `<TOKEN> · <text>`. A block
    with only blanks, a shebang and directives above it opens the file.
    """
    lines = raw.split("\n")
    for first_line, block in comment_runs(raw, suffix, symbol_docs=True):
        title = next((text for text in block if text), "")
        if not HEADER_TITLE_RE.fullmatch(title):
            continue
        if all(not line.strip() or line.startswith("#!") or DIRECTIVE_RE.match(line) for line in lines[: first_line - 1]):
            continue
        return first_line, lines[first_line - 1 : first_line - 1 + len(block)]
    return None


def _block_text(block: list[str]) -> str:
    """The one line INC-9's character bound is measured over."""
    return " ".join(line for line in block if line).strip()


def _over_bounds(block: list[str], cap: int) -> bool:
    """Whether a comment block breaks either of INC-9's bounds."""
    return len(block) > cap or len(_block_text(block)) > COMMENT_CHAR_CAP


def _openings_over_bounds(text: str, style: str) -> frozenset[str]:
    """The opening line of every comment block in some text that breaks a bound.

    The opening is what identifies a block across an edit deeper inside it, where a line number
    moves with every insertion above.
    """
    inline = {(first, len(block)) for first, block in comment_runs(text, style, symbol_docs=False)}
    openings: set[str] = set()
    for first, block in comment_runs(text, style, symbol_docs=True):
        cap = COMMENT_LINE_CAP if (first, len(block)) in inline else DOC_LINE_CAP
        if _over_bounds(block, cap):
            openings.add(_opening(block))
    return frozenset(openings)


def _opening(block: list[str]) -> str:
    """A block's first line with anything to say, which is how one block is told from another."""
    return next((line for line in block if line), "")


def check_comment_length(path: Path, raw: str, added: set[int], fork_text: Callable[[], str | None] | None = None) -> list[Finding]:
    """A comment block this branch touched, unless it broke a bound before this branch touched it.

    Requiring the WHOLE block to be added missed every one a branch lengthened; failing a word
    changed inside an older block is `/docs:audit-pr`'s slice (CUR-6).
    """
    rel = path.relative_to(REPO_ROOT).as_posix()
    # Derived here so no caller can pass a suffix a Dockerfile does not have: read for `//` it
    # would yield no block, and the check would run, report nothing, and look wired.
    style = comment_style(path)
    # A block the narrow pass also yields is inline; what only the wide pass has is a symbol doc,
    # which INC-9 gives the longer line cap.
    inline = {(first, len(block)) for first, block in comment_runs(raw, style, symbol_docs=False)}

    found: list[Finding] = []
    older: frozenset[str] | None = None
    for first_line, block in comment_runs(raw, style, symbol_docs=True):
        numbers = range(first_line, first_line + len(block))
        cap = COMMENT_LINE_CAP if (first_line, len(block)) in inline else DOC_LINE_CAP
        if added.isdisjoint(numbers) or not _over_bounds(block, cap):
            continue
        if older is None:
            # Read here rather than per call: the fork costs a git spawn per file, and a file whose
            # touched blocks all keep their bounds never needs one.
            before = fork_text() if fork_text is not None else None
            older = frozenset() if before is None else _openings_over_bounds(before, style)
        if _opening(block) in older:
            continue
        text = _block_text(block)
        found.append(
            Finding(
                "fail",
                "comment-length",
                rel,
                f"the comment block at line {first_line} runs {len(block)} lines and {len(text)} characters"
                f" -- INC-9 caps this shape at {cap} lines and {COMMENT_CHAR_CAP} characters",
            )
        )
    return found


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
                f"the module header sits at line {first_line}, below the first statement -- INC-7 places it above the imports",
            )
        )
    if len(header) > HEADER_CAP:
        found.append(
            Finding(
                "fail",
                "module-header",
                rel,
                f"the module header runs {len(header)} lines -- INC-2 caps it at {HEADER_CAP} including delimiters",
            )
        )
    stripped = [_header_line(line, suffix) for line in header]
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
