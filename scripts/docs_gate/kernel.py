"""SCRIPTS · the documentation gate's readers, caches and vocabulary.

Nothing here imports a sibling, so each `functools.cache` exists once per run. Two listings, and
what a caller does with the answer picks between them: a file a check READS comes from
`scanned_files`, which is the working tree; a glob or a page a document NAMES resolves through
`tracked_files`, which is the index CI checks out.
"""

from __future__ import annotations

import ast
import io
import os
import re
import tokenize
from collections.abc import Iterable
from dataclasses import dataclass
from functools import cache
from pathlib import Path, PurePosixPath
from typing import Final, Literal

# From the shared kernel rather than a second copy: a checker taking git, the repository root or
# the reading errors from its own drifts into its own behaviour, the principle that file states.
from checker_kernel import REPO_ROOT, UNREADABLE, git, git_status

# docs/audit is a running programme's gitignored working documents, absent from any clone;
# node_modules and .venv are vendored and not ours to hold to this standard.
SKIP_DIRS: Final[tuple[str, ...]] = ("docs/audit", "node_modules", ".venv")

# The comment-bearing source suffixes the gate scans (INC-6).
SOURCE_SUFFIXES: Final[tuple[str, ...]] = (".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".sh")
# JSON is NOT here: it is scanned rather than read a line at a time, for `_jsonc_comments`' reason.
CSTYLE_SUFFIXES: Final[tuple[str, ...]] = (".ts", ".tsx", ".js", ".mjs", ".cjs")

# COR-6 binds these comments as it binds a spec sheet's prose, although the In-code section's
# Scope names subtrees rather than these kinds.
OPS_SUFFIXES: Final[tuple[str, ...]] = (".conf", ".yml", ".yaml", ".toml", ".json")
# Spelled in full: neither a Dockerfile nor a git hook carries a suffix to match on, and INC-6
# binds a shell file whatever it is named. `p.name` decides; the glob is a prefilter.
OPS_FILENAMES: Final[tuple[str, ...]] = ("Dockerfile", "pre-commit", "commit-msg")
SCANNED_SUFFIXES: Final[tuple[str, ...]] = SOURCE_SUFFIXES + OPS_SUFFIXES

# Anything else in backticks is prose: a bare `queries.ts` names a KIND of file, not one file.
REPO_PREFIXES: Final[tuple[str, ...]] = (
    "fl_frontend/",
    "fl_backend/",
    "docs/",
    "scripts/",
    "nginx/",
    ".claude/",
    ".github/",
    ".githooks/",
)

# The roots an unprefixed path is written against, so `src/app/admin/admin.css` resolves.
PACKAGE_ROOTS: Final[tuple[str, ...]] = ("fl_frontend/", "fl_backend/")


BACKTICK_SPAN_RE: Final = re.compile(r"`[^`\n]*`")


FENCE_RE: Final = re.compile(r"^\s*(```|~~~)")
# The closing run of hashes is dropped as a renderer drops it. Read through `atx_heading`, so one
# definition decides what counts as a heading.
ATX_HEADING_RE: Final = re.compile(r"^ {0,3}(#{1,6}) +(.*?)(?:[ \t]+#+)?[ \t]*$")


# What GitHub's slugger keeps: a link renders as its text alone, and anything but a word
# character, a space or a hyphen is dropped.
INLINE_LINK_RE: Final = re.compile(r"\[([^\]]*)\]\([^)]*\)")
SLUG_DROP_RE: Final = re.compile(r"[^\w\- ]")


BACKTICK_RE: Final = re.compile(r"`([^`\n]+?)`")
# Built from the directories rather than written out, so the glob selecting a page, the page a
# check names and a finding's own file cannot drift apart.
DOCS_DIR: Final = "docs"
ROADMAP_DIR: Final = f"{DOCS_DIR}/_roadmap"
SPEC_GLOB: Final = f"{DOCS_DIR}/*/spec.md"
OVERVIEW_GLOB: Final = f"{DOCS_DIR}/*/overview.md"
ROADMAP_GLOB: Final = f"{ROADMAP_DIR}/*.md"
# A fixed page is its own glob, so one spelling answers `tracked_glob` and `tracked_page` alike.
GLOSSARY_PAGE: Final = f"{DOCS_DIR}/glossary.md"
STANDARD_PAGE: Final = f"{DOCS_DIR}/standard.md"
ROADMAP_PAGE: Final = f"{ROADMAP_DIR}/open-items.md"
ROADMAP_TOOLING_PAGE: Final = f"{ROADMAP_DIR}/tooling-items.md"
ROADMAP_CLOSED_PAGE: Final = f"{ROADMAP_DIR}/closed-items.md"
TEMPLATES_PAGE: Final = f"{DOCS_DIR}/_git/templates.md"
SWEEP_PAGE: Final = ".claude/commands/docs/audit.md"

# `ROADMAP_GLOB` also matches pages carrying no ranked entries, so presence and tracking are
# asked of these by name instead.
ROADMAP_RANKED_PAGES: Final[tuple[str, ...]] = (ROADMAP_PAGE, ROADMAP_TOOLING_PAGE)


Severity = Literal["fail", "report"]

# The registry of record for the gate's checks: `enforced-by` resolves `docs/standard.md`'s claims
# against it, and `Finding` refuses a name absent from it, so no check reaches a run unregistered.
CHECKS: Final[dict[str, frozenset[Severity]]] = {
    "anchor": frozenset({"fail"}),
    "bare-path": frozenset({"fail"}),
    "binary-byte": frozenset({"fail"}),
    "branch-scope": frozenset({"report"}),
    "citation": frozenset({"fail"}),
    "comment-citation": frozenset({"fail", "report"}),
    "comment-length": frozenset({"fail"}),
    "copy-corpus": frozenset({"fail"}),
    "copy-dash": frozenset({"fail"}),
    "copy-formal": frozenset({"fail"}),
    "copy-informal": frozenset({"fail"}),
    "copy-term": frozenset({"fail"}),
    "counts": frozenset({"report"}),
    "enforced-by": frozenset({"fail"}),
    "glossary-entry": frozenset({"fail"}),
    "header-see": frozenset({"fail"}),
    "history": frozenset({"report"}),
    "inputs": frozenset({"fail"}),
    "invariant-id": frozenset({"fail"}),
    "invariant-row": frozenset({"fail"}),
    "line-citation": frozenset({"fail"}),
    "line-endings": frozenset({"fail"}),
    "link": frozenset({"fail"}),
    "metadata-break": frozenset({"fail"}),
    "module-header": frozenset({"fail"}),
    "overview-spine": frozenset({"fail"}),
    "owner-voice": frozenset({"fail"}),
    "path": frozenset({"fail"}),
    "readme-cap": frozenset({"fail"}),
    "roadmap-shape": frozenset({"fail"}),
    "rule-id": frozenset({"fail"}),
    "rule-shape": frozenset({"fail"}),
    "segment-map": frozenset({"fail"}),
    "sha": frozenset({"report"}),
    "spec-spine": frozenset({"fail"}),
    "template-fragment": frozenset({"fail"}),
    "unreadable": frozenset({"fail"}),
}


# GitHub's workflow-command escaping. A message needs the group below alone; a property value
# needs the separators as well, an unescaped comma there starting a property nobody wrote. `%` goes first, or
# it would escape the codes the others just wrote.
COMMAND_ESCAPES: Final[tuple[tuple[str, str], ...]] = (("%", "%25"), ("\r", "%0D"), ("\n", "%0A"))
PROPERTY_ESCAPES: Final[tuple[tuple[str, str], ...]] = ((":", "%3A"), (",", "%2C"))


def _escaped(text: str, *, in_property: bool) -> str:
    """One run of text as a workflow command may carry it."""
    for char, code in COMMAND_ESCAPES + (PROPERTY_ESCAPES if in_property else ()):
        text = text.replace(char, code)
    return text


@dataclass(frozen=True, slots=True)
class Finding:
    """One problem, already resolved to whether it fails the run.

    Not `checker_kernel.py :: Finding`, which validates against nothing;
    `scripts/docs_gate/checks.py` holds both in one namespace, so the collision is live.
    """

    severity: Severity
    check: str
    file: str
    detail: str
    # A place to open rather than to search for. None wherever the check judges a whole file, a
    # listing or the branch's diff, none of which sit on one line.
    line: int | None = None

    def __post_init__(self) -> None:
        # An unregistered name is how the registry falls behind the code it claims to describe.
        if self.severity not in CHECKS.get(self.check, frozenset()):
            raise ValueError(f"check `{self.check}` is not registered in CHECKS at severity `{self.severity}`")

    @property
    def where(self) -> str:
        """The subject, carrying the line where the check knows one: what an editor jumps to."""
        return self.file if self.line is None else f"{self.file}:{self.line}"

    def human(self) -> str:
        # Six spaces: the message column of the scripts' shared output standard (scripts/_lib.sh).
        return f"      {self.where}: {self.detail}  [{self.check}]"

    def github(self) -> str:
        """One workflow command, which a runner turns into an annotation on the pull request's diff.

        The severity deciding the exit code decides the annotation's too, so a reader of the diff
        meets the verdict the gate reached rather than a second one.
        """
        command = "error" if self.severity == "fail" else "warning"
        fields = [f"file={_escaped(self.file, in_property=True)}"]
        if self.line is not None:
            fields.append(f"line={self.line}")
        fields.append(f"title={_escaped(self.check, in_property=True)}")
        return f"::{command} {','.join(fields)}::{_escaped(self.detail, in_property=False)}"


def is_placeholder(text: str) -> bool:
    """Template scaffolding, not a reference. `<sha>`, `NNNN`, `app/api/*/router.py`."""
    return bool(set("<>{}*?") & set(text)) or "NNNN" in text or "…" in text


def strip_fences(text: str) -> str:
    """Blank out fenced blocks, preserving line count so reported context stays meaningful."""
    out: list[str] = []
    in_fence = False
    for raw in text.split("\n"):
        if FENCE_RE.match(raw):
            in_fence = not in_fence
            out.append("")
            continue
        out.append("" if in_fence else raw)
    return "\n".join(out)


def line_of(body: str, offset: int) -> int:
    """The 1-based line an offset sits on.

    Every reader here keeps a file's line count -- `strip_fences` and `comments_only` blank a line
    rather than dropping it -- so an offset into a scanned body numbers the line the file holds.
    """
    return body.count("\n", 0, offset) + 1


@cache
def _read_text(path: Path) -> tuple[str | None, str]:
    """One file's text, read once per run, with the message where it could not be read.

    The single reader: a per-check `read_text` spends the read again and handles failure its own way.
    """
    try:
        return path.read_text(encoding="utf-8"), ""
    except UNREADABLE as exc:
        return None, str(exc)


@cache
def _listed(*args: str) -> tuple[Path, ...] | None:
    """One `git ls-files` listing as paths, or None where git could not answer.

    NUL-separated, git quoting non-ASCII by default: a quoted spelling matches no glob and opens
    no file, so it drops out of the scan with whatever it carried.
    """
    listing = git("ls-files", "-z", *args)
    if listing is None:
        return None
    return tuple(REPO_ROOT / entry for entry in listing.split("\0") if entry)


def _by_name(paths: Iterable[Path]) -> dict[str, tuple[Path, ...]]:
    """Paths indexed by filename, with the skipped directories pruned."""
    index: dict[str, list[Path]] = {}
    for path in paths:
        if not _skipped(path):
            index.setdefault(os.path.normcase(path.name), []).append(path)
    return {name: tuple(sorted(found)) for name, found in index.items()}


@cache
def _tree_index() -> dict[str, tuple[Path, ...]]:
    """Every tracked file, indexed by name, with skipped directories pruned.

    Tracked rather than walked: a nested worktree would make a bare-filename lookup ambiguous.
    """
    listed = _listed()
    return _walked_index() if listed is None else _by_name(listed)


@cache
def _untracked_index() -> dict[str, tuple[Path, ...]]:
    """Every file the working tree holds and the index does not, indexed by name.

    Ignorability is git's answer rather than a walk's, which is what keeps a vendored tree, a
    build output and a deliberately ignored scratch file out of a bare-name lookup.
    """
    return _by_name(_untracked_paths())


def _untracked_paths() -> tuple[Path, ...]:
    """What `--others` adds to a listing, or nothing where git could not answer.

    Nothing rather than a walk: both callers hold a tracked listing already, so an unanswerable
    `--others` narrows the corpus instead of emptying it.
    """
    return _listed("--others", "--exclude-standard") or ()


def _walked_index() -> dict[str, tuple[Path, ...]]:
    """The same index where git could not answer it.

    The control directory goes by name: check-ignore does not call it ignored. Ignorability is
    asked once, costing two spawns per directory.
    """
    ignorable = git_status("rev-parse", "--is-inside-work-tree") == 0
    index: dict[str, list[Path]] = {}
    for root, directories, names in os.walk(REPO_ROOT):
        parent = Path(root)
        kept = [name for name in directories if name != ".git" and not _skipped(parent / name)]
        if ignorable:
            kept = [name for name in kept if not is_gitignored((parent / name).relative_to(REPO_ROOT).as_posix())]
        directories[:] = kept
        for name in names:
            index.setdefault(os.path.normcase(name), []).append(parent / name)
    return {name: tuple(sorted(paths)) for name, paths in index.items()}


def _skipped(path: Path) -> bool:
    """True for anything under a SKIP_DIRS entry at any depth.

    A single segment (`node_modules`) has to match at any depth, `fl_frontend/node_modules/...`
    being what occurs.
    """
    rel = path.relative_to(REPO_ROOT).as_posix()
    segments = rel.split("/")
    return any(rel == d or rel.startswith(f"{d}/") or ("/" not in d and d in segments) for d in SKIP_DIRS)


def _shell_comments(text: str) -> str:
    """Shell comments only, line count preserved.

    `#` mid-line needs the space lead, shell spelling `${name#prefix}` and colour escapes; a
    line-leading `//` is kept too, being an embedded node one-liner's comment, which no other
    reader reaches (INC-6).
    """
    keep: list[str] = []
    for line in text.split("\n"):
        stripped = line.lstrip()
        if (stripped.startswith("#") and not stripped.startswith("#!")) or stripped.startswith("//"):
            keep.append(line)
            continue
        marker = line.find(" #")
        keep.append(line[marker:] if marker != -1 else "")
    return "\n".join(keep)


def _marker_lines(text: str) -> str:
    """Every line carrying a `#` or a triple quote, line count kept.

    Deliberately wide: the fallback for source the tokenizer refuses, where reading no comments
    would look like a file with none.
    """
    triple_double = '"""'
    triple_single = "'''"
    keep: list[str] = []
    in_block = False
    for line in text.split("\n"):
        quotes = line.count(triple_double) + line.count(triple_single)
        if in_block:
            keep.append(line)
            if quotes % 2 == 1:
                in_block = False
            continue
        stripped = line.lstrip()
        if stripped.startswith((triple_double, triple_single)) and quotes % 2 == 1:
            in_block = True
            keep.append(line)
        else:
            keep.append(line if ("#" in line or quotes) else "")
    return "\n".join(keep)


def _place(buffer: list[str], start: tuple[int, int], text: str) -> None:
    """One token's text back at the line and column it occupies in the file it came from.

    The column is held because findings report one, and column zero names a place nobody can find.
    """
    row, column = start
    for offset, piece in enumerate(text.split("\n")):
        line = buffer[row - 1 + offset]
        buffer[row - 1 + offset] = (line.ljust(column) if offset == 0 else line) + piece


# Named rather than spelled inline: the formatter would fold the tuple into PEP 758's
# `except A, B:`, newer than `checker_kernel.py :: PARSE_FLOOR`.
UNTOKENIZABLE: Final = (tokenize.TokenError, SyntaxError, ValueError)
# The same fold, over what `ast.parse` alone can raise.
UNPARSEABLE: Final = (SyntaxError, ValueError)


def _docstring_starts(tokens: list[tokenize.TokenInfo]) -> set[tuple[int, int]]:
    """Where each STRING standing alone as a statement begins -- a docstring, never a value.

    A comment and a blank line sit anywhere without ending a statement, so both come out before a
    string's neighbours are read.
    """
    structural = [token for token in tokens if token.type not in (tokenize.COMMENT, tokenize.NL)]
    found: set[tuple[int, int]] = set()
    for index, token in enumerate(structural):
        opens = index == 0 or structural[index - 1].type in (tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT)
        closes = index + 1 < len(structural) and structural[index + 1].type == tokenize.NEWLINE
        if token.type == tokenize.STRING and opens and closes:
            found.add(token.start)
    return found


def _python_tokens(text: str) -> list[tokenize.TokenInfo] | None:
    """One module's tokens, or None where it will not tokenize -- work in progress, or a plant."""
    try:
        return list(tokenize.generate_tokens(io.StringIO(text).readline))
    except UNTOKENIZABLE:
        return None


def _python_comments(text: str) -> str:
    """Python comments and docstrings, everything else blank.

    Tokenized rather than scanned: a `#` inside a string literal opens no comment. A docstring
    must stand alone as a statement, so an unusual spelling goes unscanned.
    """
    lines = text.split("\n")
    tokens = _python_tokens(text)
    if tokens is None:
        return _marker_lines(text)

    docstrings = _docstring_starts(tokens)
    keep = [""] * len(lines)
    for token in tokens:
        if token.type == tokenize.COMMENT or (token.type == tokenize.STRING and token.start in docstrings):
            _place(keep, token.start, token.string)
    return "\n".join(keep)


def _python_prose(text: str) -> tuple[dict[int, int], set[int]] | None:
    """Which lines a Python module gives to prose: a docstring by span, a comment by row.

    A docstring is ONE block whatever its paragraphs, so a blank inside it never ends the run, and
    a comment after code opens none. None where it will not tokenize.
    """
    tokens = _python_tokens(text)
    if tokens is None:
        return None
    lines = text.split("\n")
    docstrings = _docstring_starts(tokens)
    spans: dict[int, int] = {}
    comments: set[int] = set()
    for token in tokens:
        row, column = token.start
        if token.type == tokenize.COMMENT:
            if not lines[row - 1][:column].strip():
                comments.add(row)
        elif token.type == tokenize.STRING and token.start in docstrings:
            for line in range(row, token.end[0] + 1):
                spans[line] = row
    return spans, comments


def _jsonc_comments(text: str) -> str:
    """JSONC comments only, line count and column preserved.

    Character by character: a marker inside a string value would open a block comment running to
    the next `*/` if read by line.
    """
    keep = [""] * len(text.split("\n"))
    row, column, index = 1, 0, 0
    in_string = False
    while index < len(text):
        char = text[index]
        if char == "\n":
            row, column, index = row + 1, 0, index + 1
        elif in_string:
            # A backslash consumes what follows it, so an escaped quote never closes the string.
            step = 2 if char == "\\" else 1
            in_string = char != '"'
            column, index = column + step, index + step
        elif char == '"':
            in_string, column, index = True, column + 1, index + 1
        elif text.startswith(("//", "/*"), index):
            block = text[index + 1] == "*"
            end = text.find("*/" if block else "\n", index + 2)
            end = len(text) if end == -1 else end + (2 if block else 0)
            comment = text[index:end]
            _place(keep, (row, column), comment)
            row += comment.count("\n")
            column = len(comment) - comment.rfind("\n") - 1 if "\n" in comment else column + len(comment)
            index = end
        else:
            column, index = column + 1, index + 1
    return "\n".join(keep)


def comments_only(text: str, suffix: str) -> str:
    """Everything outside a comment blanked, line count preserved.

    A path inside executable code is a string the program uses, not a claim to a reader. TypeScript
    stays line-grain: reading it exactly costs a node launch per file.
    """
    if suffix == ".sh":
        return _shell_comments(text)
    if suffix == ".json":
        return _jsonc_comments(text)
    if suffix not in CSTYLE_SUFFIXES:
        return _python_comments(text)

    keep: list[str] = []
    in_block = False
    for line in text.split("\n"):
        if in_block:
            keep.append(line)
            if "*/" in line:
                in_block = False
        elif "/*" in line and "*/" not in line:
            in_block = True
            keep.append(line)
        else:
            keep.append(line if ("/*" in line or "//" in line) else "")
    return "\n".join(keep)


def comment_style(path: Path) -> str:
    """The suffix `comments_only` dispatches on, for a file whose own suffix it does not know.

    The `#` reader is the default rather than a case because a Dockerfile carries no suffix at all
    for `path.suffix` to dispatch on.
    """
    return path.suffix if path.suffix in SOURCE_SUFFIXES or path.suffix == ".json" else ".sh"


# A directive stays above the header (INC-7), so the header scan steps over it.
DIRECTIVE_RE: Final = re.compile(r"^\s*([\"'])use (client|server|strict)\1;?\s*$")
PY_DOCSTRING_OPEN_RE: Final = re.compile(r"^[rRuU]?(\"\"\"|''')")

# The only two kinds INC-2 lets a module header survive in. Anywhere else an opening block is an
# ordinary comment block, so `comment_runs` yields it and INC-9's bound measures it.
HEADER_SUFFIXES: Final[tuple[str, ...]] = (".py", ".sh")


def _module_header(raw: str, suffix: str) -> list[str] | None:
    """The module header's lines, delimiters included, or None where the kind carries none.

    A shebang is a directive, so counting it would spend a capped line. An unterminated delimiter
    runs to the file's end, which the line cap then fails.
    """
    if suffix not in HEADER_SUFFIXES:
        return None
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

    return None


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


def _python_runs(raw: str, start_at: int) -> list[tuple[int, list[str]]]:
    """Each run of consecutive comment lines in a Python module, read through its own tokenizer.

    A line scan cannot tell a docstring's opening quote from an ordinary string's closing one at
    the margin, and measured the code beneath a literal as prose.
    """
    lines = raw.split("\n")
    read = _python_prose(raw)
    # A module that will not tokenize keeps the wide marker scan, where every kept line is prose
    # and no docstring spans: reading none would look like a file with no comments at all.
    if read is None:
        kept = _marker_lines(raw).split("\n")
        spans: dict[int, int] = {}
        comments = {number for number, line in enumerate(kept, start=1) if line.strip()}
    else:
        spans, comments = read

    runs: list[tuple[int, list[str]]] = []
    current: list[str] = []
    first_line = 0
    opened_on = 0

    def flush() -> None:
        nonlocal current, first_line
        if current and any(current):
            runs.append((first_line, current))
        current = []

    for number in range(start_at + 1, len(lines) + 1):
        text = lines[number - 1].strip()
        span = spans.get(number, 0)
        if not span and number not in comments:
            flush()
            opened_on = 0
            continue
        # The row a docstring opens on, or 0 for a comment: a change of either end closes the run,
        # so a docstring is one block and the comment against its closing quote is another.
        if span != opened_on:
            flush()
            opened_on = span
        if not current:
            first_line = number
        current.append(text.lstrip("#").strip() if text.startswith("#") else _header_line(text, ".py"))
    flush()
    return runs


def comment_runs(raw: str, suffix: str) -> list[tuple[int, list[str]]]:
    """Each run of consecutive comment lines below the module header, as (first line, text lines).

    Markers come off, being what the bound does not measure. The header is skipped -- INC-2 caps
    it. A symbol doc is a run like any other (INC-9).
    """
    lines = raw.split("\n")
    start_at = 0
    if (header := _module_header(raw, suffix)) is not None:
        for index in range(len(lines)):
            if lines[index : index + len(header)] == header:
                start_at = index + len(header)
                break
    # Python alone has a grammar here a line scan gets wrong; every other kind's comment opens on
    # a marker no literal of its own can carry at the margin.
    if suffix == ".py":
        return _python_runs(raw, start_at)

    runs: list[tuple[int, list[str]]] = []
    current: list[str] = []
    first_line = 0
    closing: str | None = None
    hash_only = suffix == ".sh"

    def flush() -> None:
        nonlocal current, first_line
        if current and any(current):
            runs.append((first_line, current))
        current = []

    for number, line in enumerate(lines[start_at:], start=start_at + 1):
        text = line.strip()
        if closing is not None:  # inside a block comment or a docstring
            current.append(_header_line(text.removesuffix(closing), suffix))
            if closing in text:
                closing = None
                flush()
            continue

        # `{/* … */}` opens with a brace, so it matches neither arm below and every JSX comment
        # would go unbounded. Tested before the plain `/*` arm, which the brace hides it from.
        if not hash_only and text.startswith("{/*"):
            flush()
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
            first_line = number
            body = text.lstrip("/*").strip()
            current.append(body.removesuffix("*/").strip())
            if "*/" in text[2:]:
                flush()
            else:
                closing = "*/"
            continue

        # `.sh` takes `//` beside `#`: a hook's embedded node one-liner comments there, and INC-9's
        # bound has to measure those blocks the way `_shell_comments` reads them (INC-6).
        markers = ("#", "//") if hash_only else ("//",)
        if text.startswith(markers):
            if not current:
                first_line = number
            current.append(text.lstrip("#").strip() if text.startswith("#") else text[2:].strip())
            continue
        flush()

    flush()
    return runs


def _of_kind(candidates: Iterable[Path]) -> tuple[Path, ...]:
    """The corpus files in a listing: a scanned kind, on disk, outside the skipped directories.

    `is_file` drops a path the index holds and the tree does not, which a branch mid-rename carries.
    """
    suffixes = {".md", *SCANNED_SUFFIXES}
    return tuple(sorted({p for p in candidates if p.is_file() and not _skipped(p) and (p.suffix in suffixes or p.name in OPS_FILENAMES)}))


@cache
def _kind_patterns() -> tuple[str, ...]:
    """The `ls-files` patterns that prefilter a listing to the scanned kinds."""
    # The leading `*` carries a whole-filename pattern past the root, where an unanchored
    # `Dockerfile` matches the root one alone. It widens to anything ENDING in the name.
    return ("*.md", *(f"*{suffix}" for suffix in SCANNED_SUFFIXES), *(f"*{name}" for name in OPS_FILENAMES))


@cache
def tracked_files() -> tuple[Path, ...]:
    """Every tracked document, source file and ops file, minus skips.

    The index alone: this is what a glob and a named page resolve against, and a page no `git add`
    reached must not answer for one. What a check READS is `scanned_files` instead.
    """
    listed = _listed(*_kind_patterns())
    if listed is None:
        return _of_kind(path for paths in _tree_index().values() for path in paths)
    return _of_kind(listed)


@cache
def untracked_files() -> tuple[Path, ...]:
    """The corpus files the working tree holds and the index does not.

    `--exclude-standard` gives `.gitignore`'s answer, so a vendored tree, a build output and a
    scratch file somebody parked here are nobody's to fail.
    """
    return _of_kind(_untracked_paths())


@cache
def scanned_files() -> tuple[Path, ...]:
    """The corpus every check READS: the tracked listing plus what the branch has yet to stage.

    The gate runs before the commit, so the index alone hands a branch that adds files a green
    answer CI will not repeat.
    """
    # Merged rather than filtered again: both halves are already `_of_kind`'s answer, and a second
    # pass stats every path to learn what it just learnt.
    return tuple(sorted({*tracked_files(), *untracked_files()}))


@cache
def _tracked_index() -> tuple[tuple[PurePosixPath, Path], ...]:
    """Each tracked corpus file beside the repo-relative spelling a glob is matched against.

    Built once rather than per pattern: deriving the spelling outcosts matching it and never varies.
    """
    return tuple((PurePosixPath(path.relative_to(REPO_ROOT).as_posix()), path) for path in tracked_files())


@cache
def tracked_glob(pattern: str) -> tuple[Path, ...]:
    """Every tracked file a repo-relative glob matches, in `tracked_files`' order.

    `Path.glob` would read the working tree, where a page no `git add` reached still answers a
    citation: green locally, red on CI's clean checkout.
    """
    return tuple(path for rel, path in _tracked_index() if rel.full_match(pattern))


@cache
def tracked_page(rel: str) -> Path | None:
    """One named page, or None where the tracked corpus does not hold it.

    Reading one off disk would pass a page written and never added.
    """
    return next((path for spelling, path in _tracked_index() if spelling.as_posix() == rel), None)


# The id is captured loose, so a malformed one is caught against the vocabulary, not skipped.
ROADMAP_ID_DEF_RE: Final = re.compile(r"^[ \t]*\|\s*(?:\d+\s*\|\s*)?\*{0,2}([A-Z]{1,4}-\d{1,3})\*{0,2}\s*\|", re.MULTILINE)


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


def atx_heading(line: str, level: int | None = None) -> str | None:
    """One ATX heading's text, or None where the line is not a heading at that level.

    Every heading this gate reads resolves here, so no check is blind to one a renderer shows.
    CommonMark allows three spaces of indent; a fourth is a code block.
    """
    match = ATX_HEADING_RE.match(line)
    if match is None or (level is not None and len(match.group(1)) != level):
        return None
    return match.group(2)


def heading_anchors(body: str) -> set[str]:
    """The fragment ids GitHub derives from this file's headings.

    GitHub's own slugger, a reader copying the fragment off the rendered page: an em dash vanishes
    and leaves the spaces around it as two hyphens.
    """
    anchors: set[str] = set()
    occurrences: dict[str, int] = {}
    fenced = False
    for line in body.split("\n"):
        # `FENCE_RE` rather than a second definition of what opens a block.
        if FENCE_RE.match(line):
            fenced = not fenced
            continue
        if fenced or (text := atx_heading(line)) is None:
            continue
        slug = SLUG_DROP_RE.sub("", INLINE_LINK_RE.sub(r"\1", text).lower()).replace(" ", "-")
        if not slug:
            continue
        # github-slugger's own counting: the suffix comes off the ORIGINAL slug's tally, so a
        # repeated `## Setup` yields `setup-2` rather than colliding with `setup-1`.
        original = slug
        while slug in occurrences:
            occurrences[original] += 1
            slug = f"{original}-{occurrences[original]}"
        occurrences[slug] = 0
        anchors.add(slug)
    return anchors


@cache
def anchors_of(target: Path) -> frozenset[str] | None:
    """Another page's heading anchors, or None where it cannot be read.

    None is distinct from an empty set: a page with no headings resolves nothing, an unreadable
    one is reported where it is scanned.
    """
    body = _readable(target)
    return None if body is None else frozenset(heading_anchors(body))


@cache
def is_gitignored(token: str) -> bool:
    """A gitignored path is named deliberately and absent by design.

    Asked twice: a directory-only pattern matches a bare name only while the directory is there.
    Only a clean exit says ignored, so a git that cannot answer leaves the finding standing.
    """
    return git_status("check-ignore", "-q", token) == 0 or git_status("check-ignore", "-q", f"{token}/") == 0


def repo_path(token: str) -> str | None:
    """The repository path a backticked token names, or None.

    Existence decides, so a token naming a KIND of file stays prose. A traversal is refused, not
    normalised: what comes back must be a git listing's spelling.
    """
    if token.startswith(("/", "./")) or ".." in token:
        return None
    if token.startswith(REPO_PREFIXES) and (REPO_ROOT / token).exists():
        return token
    if "/" not in token:
        return None
    return next((f"{root}{token}" for root in PACKAGE_ROOTS if (REPO_ROOT / root / token).exists()), None)


# --- what a cited anchor has to be, in a file whose definitions can be listed exactly ------------


def _python_names(text: str) -> frozenset[str] | None:
    """Every name a Python module binds, or None where it does not parse.

    A string constant counts: a table of index names, refusal codes or check names is cited by the
    row's own spelling, and the row is where that name is defined.
    """
    try:
        tree = ast.parse(text)
    except UNPARSEABLE:
        return None
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            names.add(node.id)
        elif isinstance(node, ast.alias):
            # A re-export binds the name here, which is what a shim exists to make resolvable.
            names.add((node.asname or node.name).split(".")[0])
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            names.update(node.names)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value.isidentifier():
            names.add(node.value)
    return frozenset(names)


@cache
def defined_symbols(path: Path) -> frozenset[str] | None:
    """Every name one Python module binds, or None where a caller falls back to presence.

    Python alone, and by `ast`: a hand-written grammar answers a FAILING finding when it misses,
    and a stale citation costs less than a red gate on a correct one.
    """
    if path.suffix != ".py" or (text := _read_text(path)[0]) is None:
        return None
    return _python_names(text)


@cache
def _readable(path: Path) -> str | None:
    """A page's fence-stripped body, or None where it cannot be read."""
    raw = _read_text(path)[0]
    return None if raw is None else strip_fences(raw)  # None is reported where the file is scanned


@cache
def _scan_body(path: Path) -> str:
    """The half of one file the checks read: a page's prose, a source file's comments.

    Empty where the file cannot be read, that failure being `unreadable`'s.
    """
    raw = _read_text(path)[0]
    if raw is None:
        return ""
    return strip_fences(raw) if path.suffix == ".md" else comments_only(raw, comment_style(path))
