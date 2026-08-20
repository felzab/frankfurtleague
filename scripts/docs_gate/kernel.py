"""SCRIPTS · the documentation gate's readers, caches and vocabulary.

Nothing here imports a sibling, so each `functools.cache` exists once per run. Every page a check
reads arrives through the tracked listing; a path a page NAMES is answered from disk instead.
"""

from __future__ import annotations

import io
import os
import re
import subprocess
import sys
import tokenize
from dataclasses import dataclass
from functools import cache
from pathlib import Path, PurePosixPath
from typing import Final, Literal

# From the shared kernel rather than a second copy: a checker taking git from its own drifts
# into its own behaviour, the principle `checker_kernel.py`'s own docstring states.
from checker_kernel import git

REPO_ROOT: Final = Path(__file__).resolve().parent.parent.parent

# docs/audit is a running programme's gitignored working documents, absent from any clone;
# node_modules and .venv are vendored and not ours to hold to this standard.
SKIP_DIRS: Final[tuple[str, ...]] = ("docs/audit", "node_modules", ".venv")

TEMPLATE_MARKERS: Final[tuple[str, ...]] = ("/templates/", "-template.md")
# Exempt only what resolves from where the template is COPIED to; rule ids and citations are the
# template's own.
TEMPLATE_EXEMPT_CHECKS: Final[frozenset[str]] = frozenset({"stamp-format", "path", "link"})

# The comment-bearing source suffixes the gate scans (INC-6).
SOURCE_SUFFIXES: Final[tuple[str, ...]] = (".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".sh")
# JSON is NOT here: it is scanned rather than read a line at a time, for `_jsonc_comments`' reason.
CSTYLE_SUFFIXES: Final[tuple[str, ...]] = (".ts", ".tsx", ".js", ".mjs", ".cjs")

# COR-6 binds these comments as it binds a spec sheet's prose, although chapter 2's Applies-to
# does not reach them.
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

# The roots an unprefixed path is written against, so `src/app/admin/admin.css` resolves. Read as
# prose, one lets a stamped page cite a file without arming branch-impact against it.
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
STAMP_RE: Final = re.compile(r"\*\*Verified against:\*\*\s*`([0-9a-f]{7,40})`")
STAMP_LINE_RE: Final = re.compile(r"(?m)^.*\*\*Verified against:\*\*.*$")
# CUR-3's exact shape plus COR-8's optional hard break. A looser line is still found by the
# STAMP_RE checks, so the two stay in step.
STRICT_STAMP_RE: Final = re.compile(r"\*\*Verified against:\*\* `[0-9a-f]{7,40}`, \d{4}-\d{2}-\d{2}\\?")
# Indentation is tolerated here and refused by the shape above: STAMP_RE reads an indented line
# as the page's stamp, so the format check has to be shown the same line.
STAMP_START_RE: Final = re.compile(r"^[ \t]*\*\*Verified against")
STAMP_LINE_NUMBER: Final = 3
# Built from the directories rather than written out, so the glob selecting a page, the page a
# check names and a finding's own file cannot drift apart.
DOCS_DIR: Final = "docs"
CHAPTERS_DIR: Final = f"{DOCS_DIR}/_standard/chapters"
ROADMAP_DIR: Final = f"{DOCS_DIR}/_roadmap"
SPEC_GLOB: Final = f"{DOCS_DIR}/*/spec.md"
OVERVIEW_GLOB: Final = f"{DOCS_DIR}/*/overview.md"
CHAPTER_GLOB: Final = f"{CHAPTERS_DIR}/*.md"
ROADMAP_GLOB: Final = f"{ROADMAP_DIR}/*.md"
# A fixed page is its own glob, so one spelling answers `tracked_glob` and `tracked_page` alike.
GLOSSARY_PAGE: Final = f"{DOCS_DIR}/glossary.md"
RULES_INDEX_PAGE: Final = f"{DOCS_DIR}/_standard/rules-index.md"
CURRENCY_PAGE: Final = f"{CHAPTERS_DIR}/5-currency.md"
ROADMAP_PAGE: Final = f"{ROADMAP_DIR}/open-items.md"
ROADMAP_TOOLING_PAGE: Final = f"{ROADMAP_DIR}/tooling-items.md"
TEMPLATES_PAGE: Final = f"{DOCS_DIR}/_git/templates.md"
SWEEP_PAGE: Final = ".claude/commands/docs/audit.md"

# `ROADMAP_GLOB` also matches pages carrying no ranked entries, so presence and tracking are
# asked of these by name instead.
ROADMAP_RANKED_PAGES: Final[tuple[str, ...]] = (ROADMAP_PAGE, ROADMAP_TOOLING_PAGE)

# The part of CUR-3's criterion a path decides. Which other pages make a current-state claim is a
# judgment about content, and stays one.
STAMP_REQUIRED_GLOBS: Final[tuple[str, ...]] = (SPEC_GLOB, OVERVIEW_GLOB, GLOSSARY_PAGE, CHAPTER_GLOB)


Severity = Literal["fail", "report"]

# `check-registry` holds CUR-5's table to this mapping and `Finding` refuses a name absent from
# it, so a check cannot reach a run before its row in that table exists.
CHECKS: Final[dict[str, frozenset[Severity]]] = {
    "anchor": frozenset({"fail"}),
    "bare-path": frozenset({"fail"}),
    "branch-impact": frozenset({"fail"}),
    "branch-scope": frozenset({"report"}),
    "check-registry": frozenset({"fail"}),
    "citation": frozenset({"fail"}),
    "comment-citation": frozenset({"fail", "report"}),
    "comment-length": frozenset({"fail"}),
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
    "rule-index": frozenset({"fail"}),
    "rule-shape": frozenset({"fail"}),
    "segment-map": frozenset({"fail"}),
    "sha": frozenset({"report"}),
    "spec-spine": frozenset({"fail"}),
    "stamp": frozenset({"fail", "report"}),
    "stamp-format": frozenset({"fail"}),
    "stamp-missing": frozenset({"fail"}),
    "template-fragment": frozenset({"fail"}),
    "unreadable": frozenset({"fail"}),
}


@dataclass(frozen=True, slots=True)
class Finding:
    """One problem, already resolved to whether it fails the run.

    Not `checker_kernel.py :: Finding`, which validates against nothing;
    `scripts/docs_gate/branch.py` holds both in one namespace, so the collision is live.
    """

    severity: Severity
    check: str
    file: str
    detail: str

    def __post_init__(self) -> None:
        # An unregistered name is how the registry falls behind the code it claims to describe.
        if self.severity not in CHECKS.get(self.check, frozenset()):
            raise ValueError(f"check `{self.check}` is not registered in CHECKS at severity `{self.severity}`")

    def line(self) -> str:
        # Six spaces: the message column of the scripts' shared output standard (scripts/_lib.sh).
        return f"      {self.file}: {self.detail}  [{self.check}]"


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


def git_status(*args: str) -> int | None:
    """Run git for its exit code alone, or None where it could not be launched. Never raises.

    None answers neither yes nor no, and each caller resolves it in the direction that keeps a
    finding rather than dropping one.
    """
    try:
        return subprocess.run(("git", *args), cwd=REPO_ROOT, capture_output=True, check=False).returncode
    except OSError:
        return None


@cache
def _read_text(path: Path) -> tuple[str | None, str]:
    """One file's text, read once per run, with the message where it could not be read.

    The single reader: a per-check `read_text` spends the read again and handles failure its own way.
    """
    try:
        return path.read_text(encoding="utf-8"), ""
    except (OSError, UnicodeDecodeError) as exc:
        return None, str(exc)


@cache
def _tree_index() -> dict[str, tuple[Path, ...]]:
    """Every tracked file, indexed by name, with skipped directories pruned.

    Tracked rather than walked: a nested worktree would make a bare-filename lookup ambiguous.
    NUL-separated, git quoting non-ASCII by default.
    """
    listing = git("ls-files", "-z")
    if listing is None:
        return _walked_index()
    index: dict[str, list[Path]] = {}
    for entry in listing.split("\0"):
        if not entry:
            continue
        path = REPO_ROOT / entry
        if not _skipped(path):
            index.setdefault(os.path.normcase(path.name), []).append(path)
    return {name: tuple(sorted(paths)) for name, paths in index.items()}


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


def _is_template(path: Path) -> bool:
    """A copy-from page: checked, but not for the two things that only resolve after it is copied."""
    return any(marker in f"/{path.relative_to(REPO_ROOT).as_posix()}" for marker in TEMPLATE_MARKERS)


def _shell_comments(text: str) -> str:
    """Shell comments only, line count preserved.

    Narrower than the Python branch's `#` rule, shell reaching for `#` in expansions
    (`${name#prefix}`) and colour escapes. A quoted ` #` is what leaks.
    """
    keep: list[str] = []
    for line in text.split("\n"):
        stripped = line.lstrip()
        if stripped.startswith("#") and not stripped.startswith("#!"):
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


def _python_comments(text: str) -> str:
    """Python comments and docstrings, everything else blank.

    Tokenized rather than scanned: a `#` inside a string literal opens no comment. A docstring
    must stand alone as a statement, so an unusual spelling goes unscanned.
    """
    lines = text.split("\n")
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))
    except UNTOKENIZABLE:
        return _marker_lines(text)

    # A comment and a blank line sit anywhere without ending a statement, so both come out before
    # a string's neighbours are read.
    structural = [token for token in tokens if token.type not in (tokenize.COMMENT, tokenize.NL)]
    docstrings: set[tuple[int, int]] = set()
    for index, token in enumerate(structural):
        opens = index == 0 or structural[index - 1].type in (tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT)
        closes = index + 1 < len(structural) and structural[index + 1].type == tokenize.NEWLINE
        if token.type == tokenize.STRING and opens and closes:
            docstrings.add(token.start)

    keep = [""] * len(lines)
    for token in tokens:
        if token.type == tokenize.COMMENT or (token.type == tokenize.STRING and token.start in docstrings):
            _place(keep, token.start, token.string)
    return "\n".join(keep)


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


@cache
def tracked_files() -> tuple[Path, ...]:
    """Every tracked document, source file and ops file, minus skips."""
    # The leading `*` carries a whole-filename pattern past the root, where an unanchored
    # `Dockerfile` matches the root one alone. It widens to anything ENDING in the name.
    patterns = ("*.md", *(f"*{suffix}" for suffix in SCANNED_SUFFIXES), *(f"*{name}" for name in OPS_FILENAMES))
    listing = git("ls-files", "-z", *patterns)
    if listing is None:
        candidates = [path for paths in _tree_index().values() for path in paths]
    else:
        candidates = [REPO_ROOT / entry for entry in listing.split("\0") if entry]
    suffixes = {".md", *SCANNED_SUFFIXES}
    return tuple(sorted({p for p in candidates if p.is_file() and not _skipped(p) and (p.suffix in suffixes or p.name in OPS_FILENAMES)}))


@cache
def _corpus_index() -> tuple[tuple[PurePosixPath, Path], ...]:
    """Each corpus file beside the repo-relative spelling a glob is matched against.

    Built once rather than per pattern: deriving the spelling outcosts matching it and never varies.
    """
    return tuple((PurePosixPath(path.relative_to(REPO_ROOT).as_posix()), path) for path in tracked_files())


@cache
def tracked_glob(pattern: str) -> tuple[Path, ...]:
    """Every corpus file a repo-relative glob matches, in `tracked_files`' order.

    `Path.glob` would read the working tree, where a page no `git add` reached still answers a
    citation: green locally, red on CI's clean checkout.
    """
    return tuple(path for rel, path in _corpus_index() if rel.full_match(pattern))


@cache
def tracked_page(rel: str) -> Path | None:
    """One named page, or None where the tracked corpus does not hold it.

    Reading one off disk would pass a page written and never added.
    """
    return next((path for spelling, path in _corpus_index() if spelling.as_posix() == rel), None)


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


def tolerate_console_encoding() -> None:
    """A console codepage must never decide whether a finding is printed.

    A dash meets a Windows codepage that cannot encode it, which raises inside `print` and takes
    the run down with every finding unreported.
    """
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(errors="replace")
