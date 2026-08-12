"""
SCRIPTS · the documentation gate's readers, caches and vocabulary

What every other module in this package is built on: the tracked corpus, the single readers behind
it, the comment extractors those readers dispatch to, and the check registry a finding may not
depart from. Nothing here imports a sibling, so each cache below exists once per run.

Invariants:
- One instance of every `functools.cache`. Two modules declaring one twice would double each read
  and answer from two states, which no check could report.
- A path outside ASCII survives: each `ls-files` call is NUL-separated, git having quoted such a
  path in its default output, where the quoted spelling then matches nothing.
- Every page a check reads arrives through the tracked listing -- selected by `tracked_glob` or
  named through `tracked_page` -- so a file no `git add` has reached satisfies nothing a clean
  checkout would fail. A path a page NAMES is answered from disk and is outside this claim.

See:
- docs/_standard/chapters/5-currency.md — what each registered check means, and its verdict
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

REPO_ROOT: Final = Path(__file__).resolve().parent.parent.parent

# Excluded: docs/audit, the gitignored working documents of a running audit programme, absent from
# any clone; node_modules and .venv, vendored and not ours to hold to this standard.
SKIP_DIRS: Final[tuple[str, ...]] = ("docs/audit", "node_modules", ".venv")

# A template is a page in a templates/ directory, or one whose name ends -template.md.
TEMPLATE_MARKERS: Final[tuple[str, ...]] = ("/templates/", "-template.md")
# Exempt only what resolves from where the template is COPIED to: a placeholder stamp, paths
# belonging to the destination, a relative link naming the copy's sibling. ADR numbers, rule ids
# and citations are the template's own and are checked.
TEMPLATE_EXEMPT_CHECKS: Final[frozenset[str]] = frozenset({"stamp-format", "path", "link"})

# The comment-bearing source suffixes the gate scans (INC-6).
SOURCE_SUFFIXES: Final[tuple[str, ...]] = (".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".sh")
# What the C-style line reader takes: JavaScript shares TypeScript's syntax exactly. JSON is NOT
# here — it is scanned rather than read a line at a time, for the reason `_jsonc_comments` gives.
CSTYLE_SUFFIXES: Final[tuple[str, ...]] = (".ts", ".tsx", ".js", ".mjs", ".cjs")

# The ops and configuration files, whose comments COR-6 binds as it binds a spec sheet's prose,
# although chapter 2's Applies-to does not reach them.
OPS_SUFFIXES: Final[tuple[str, ...]] = (".conf", ".yml", ".yaml", ".toml", ".json")
# Spelled in full: neither a Dockerfile nor a git hook carries a suffix for a pattern to match on,
# while INC-6 binds a shell file whatever it is named. `p.name` decides -- the glob is a prefilter.
OPS_FILENAMES: Final[tuple[str, ...]] = ("Dockerfile", "pre-commit", "commit-msg")
SCANNED_SUFFIXES: Final[tuple[str, ...]] = SOURCE_SUFFIXES + OPS_SUFFIXES

# Top-level directories a backticked path must start with to be treated as a repo path. Anything else
# in backticks is prose -- a bare `queries.ts` names a KIND of file, not one file.
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

# The package roots an unprefixed path is written against, so `src/app/admin/admin.css` resolves to
# the file it names. Reading one as prose is what let a stamped page cite a file without arming
# branch-impact against it.
PACKAGE_ROOTS: Final[tuple[str, ...]] = ("fl_frontend/", "fl_backend/")


BACKTICK_SPAN_RE: Final = re.compile(r"`[^`\n]*`")


FENCE_RE: Final = re.compile(r"^\s*(```|~~~)")
# Every ATX heading, wherever CommonMark lets one sit, with the closing run of hashes dropped as a
# renderer drops it. Read through `atx_heading`, so one definition decides what counts as a heading.
ATX_HEADING_RE: Final = re.compile(r"^ {0,3}(#{1,6}) +(.*?)(?:[ \t]+#+)?[ \t]*$")


# What GitHub's slugger keeps of a heading: a link renders as its text alone, and anything that is
# not a word character, a space or a hyphen is dropped. An underscore and a letter outside ASCII
# are word characters and survive.
INLINE_LINK_RE: Final = re.compile(r"\[([^\]]*)\]\([^)]*\)")
SLUG_DROP_RE: Final = re.compile(r"[^\w\- ]")


BACKTICK_RE: Final = re.compile(r"`([^`\n]+?)`")
STAMP_RE: Final = re.compile(r"\*\*Verified against:\*\*\s*`([0-9a-f]{7,40})`")
STAMP_LINE_RE: Final = re.compile(r"(?m)^.*\*\*Verified against:\*\*.*$")
# CUR-3's exact stamp shape, plus COR-8's optional trailing hard break. Anything that starts like
# a stamp and is not this fails stamp-format; a looser line would still be found by STAMP_RE-based
# checks, so the two stay in step.
STRICT_STAMP_RE: Final = re.compile(r"\*\*Verified against:\*\* `[0-9a-f]{7,40}`, \d{4}-\d{2}-\d{2}\\?")
# Indentation is tolerated here and refused by the shape above: STAMP_RE reads an indented line as
# the page's stamp, so the format check has to be shown the same line.
STAMP_START_RE: Final = re.compile(r"^[ \t]*\*\*Verified against")
STAMP_LINE_NUMBER: Final = 3
# One spelling per page kind, repo-relative. Built from the directories rather than written out, so
# a glob that SELECTS a page, the page a check NAMES and a finding's own file cannot drift apart.
DOCS_DIR: Final = "docs"
CHAPTERS_DIR: Final = f"{DOCS_DIR}/_standard/chapters"
DECISIONS_DIR: Final = f"{DOCS_DIR}/_decisions"
ROADMAP_DIR: Final = f"{DOCS_DIR}/_roadmap"
SPEC_GLOB: Final = f"{DOCS_DIR}/*/spec.md"
OVERVIEW_GLOB: Final = f"{DOCS_DIR}/*/overview.md"
CHAPTER_GLOB: Final = f"{CHAPTERS_DIR}/*.md"
DECISION_GLOB: Final = f"{DECISIONS_DIR}/*.md"
ROADMAP_GLOB: Final = f"{ROADMAP_DIR}/*.md"
# A fixed page is its own glob, so one spelling answers `tracked_glob` and `tracked_page` alike.
GLOSSARY_PAGE: Final = f"{DOCS_DIR}/glossary.md"
RULES_INDEX_PAGE: Final = f"{DOCS_DIR}/_standard/rules-index.md"
CURRENCY_PAGE: Final = f"{CHAPTERS_DIR}/5-currency.md"
ADR_INDEX_PAGE: Final = f"{DECISIONS_DIR}/README.md"
ROADMAP_PAGE: Final = f"{ROADMAP_DIR}/open-items.md"
ROADMAP_TOOLING_PAGE: Final = f"{ROADMAP_DIR}/tooling-items.md"
TEMPLATES_PAGE: Final = f"{DOCS_DIR}/_git/templates.md"
SWEEP_PAGE: Final = ".claude/commands/docs/audit.md"

# The pages carrying ranked entries. `ROADMAP_GLOB` also matches the log, the protocol and the
# README, which hold none -- so a shape check reads the glob and says nothing about those, while
# presence and tracking are asked of these two by name.
ROADMAP_RANKED_PAGES: Final[tuple[str, ...]] = (ROADMAP_PAGE, ROADMAP_TOOLING_PAGE)

# The part of CUR-3's criterion a path decides: each kind here is a current-state claim by the rule
# that shapes it. Which other pages make such a claim is a judgment about content, and stays one.
STAMP_REQUIRED_GLOBS: Final[tuple[str, ...]] = (SPEC_GLOB, OVERVIEW_GLOB, GLOSSARY_PAGE, CHAPTER_GLOB)


Severity = Literal["fail", "report"]

# Every check this script emits, against the severities it emits it at. `check-registry` holds
# CUR-5's table to this mapping and `Finding` refuses a name absent from it, so a check cannot
# reach a run before its row in that table exists.
CHECKS: Final[dict[str, frozenset[Severity]]] = {
    "adr": frozenset({"fail"}),
    "adr-index": frozenset({"fail"}),
    "adr-meta": frozenset({"fail"}),
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

    Not `checker_kernel.py :: Finding`, which is `(severity, detail)` and validates against nothing.
    `scripts/docs_gate/branch.py` holds both in one namespace -- this one by name, the kernel's
    through `check_scope` -- so the collision is a live one rather than a coincidence of naming.
    """

    severity: Severity
    check: str
    file: str
    detail: str

    def __post_init__(self) -> None:
        # Raised rather than reported: an unregistered name is a programming error, and letting one
        # through is exactly how the registry would fall behind the code it claims to describe.
        if self.severity not in CHECKS.get(self.check, frozenset()):
            raise ValueError(f"check `{self.check}` is not registered in CHECKS at severity `{self.severity}`")

    def line(self) -> str:
        # Six spaces: the message column of the scripts' shared output standard (scripts/_lib.sh),
        # so findings read as `detail` lines under the gate's step heading.
        return f"      {self.file}: {self.detail}  [{self.check}]"


def is_placeholder(text: str) -> bool:
    """Template scaffolding, not a reference. `<sha>`, `ADR-NNNN`, `app/api/*/router.py`."""
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


def git(*args: str) -> str | None:
    """Run git and return stdout, or None if the command failed. Never raises.

    UTF-8 is forced rather than left to the platform default: `git show` returns file CONTENT, and
    on a Windows codepage that decode raises on the first em dash. Reading a document through git is
    the only way to compare it against its state on another ref, so this has to be safe for prose.
    """
    try:
        done = subprocess.run(
            ("git", *args),
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except OSError:
        return None
    # Only the trailing newline comes off. `strip` would also eat a leading space, and the first
    # path of a `ls-files -z` listing is the one place a leading space is data rather than layout.
    return done.stdout.rstrip() if done.returncode == 0 else None


def git_status(*args: str) -> int | None:
    """Run git for its exit code alone, or None where it could not be launched. Never raises.

    Every caller reads the code as a yes or a no, so None -- git absent, not a repository -- has to
    answer neither, and each caller resolves it in the direction that keeps a finding rather than
    dropping one.
    """
    try:
        return subprocess.run(("git", *args), cwd=REPO_ROOT, capture_output=True, check=False).returncode
    except OSError:
        return None


@cache
def _read_text(path: Path) -> tuple[str | None, str]:
    """One file's text, read once per run, with the message where it could not be read.

    The single reader: several checks read the same file, and a per-check `read_text` both spends
    the read again and gives each site its own way of handling a failure.
    """
    try:
        return path.read_text(encoding="utf-8"), ""
    except (OSError, UnicodeDecodeError) as exc:
        return None, str(exc)


@cache
def _tree_index() -> dict[str, tuple[Path, ...]]:
    """Every tracked file, indexed by name, sorted, with the skipped directories pruned.

    Tracked rather than walked, because a clean clone is the referee: a build directory, a cache or
    a worktree nested inside the tree makes a bare-filename lookup ambiguous on the machine holding
    it and unique everywhere else. This is one of the two filters a bare name passes; `_resolve`
    applies them, and CUR-5 states what they add up to.

    `normcase` keys it, so a lookup matches exactly what the filesystem itself would match. The
    listing is NUL-separated: git quotes and escapes a path outside ASCII in its default output.
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
    """The same index where git could not answer it, pruned as close to git's answer as a walk gets.

    The control directory goes by name: it holds no citable file, and check-ignore does not call it
    ignored. Everything else git would exclude needs git, so a tree it cannot read at all keeps its
    generated files here -- asked once rather than per directory, which would cost two spawns each.
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

    A SKIP_DIRS entry may be a full prefix (`docs/audit`) or a single segment (`node_modules`), and
    the latter has to match at any depth -- `fl_frontend/node_modules/...` is what actually occurs.
    """
    rel = path.relative_to(REPO_ROOT).as_posix()
    segments = rel.split("/")
    return any(rel == d or rel.startswith(f"{d}/") or ("/" not in d and d in segments) for d in SKIP_DIRS)


def _is_template(path: Path) -> bool:
    """A copy-from page: checked, but not for the two things that only resolve after it is copied."""
    return any(marker in f"/{path.relative_to(REPO_ROOT).as_posix()}" for marker in TEMPLATE_MARKERS)


def _shell_comments(text: str) -> str:
    """Shell comments only, line count preserved.

    Narrower than the `#` rule the Python branch can afford, because shell reaches for `#` in
    expansions (`${name#prefix}`, `$#`) and in colour escapes, and a claim is never made from
    inside one. A `#` opening a line, or one after whitespace, is the only shape kept -- a shebang
    is neither documentation nor a claim, so it drops out with the rest.

    Line-grain, and the surface that leaves is a quoted value carrying ` #`: `other: "a # b"` in a
    `.conf`, `.toml` or `.yaml` file keeps ` # b"`. Exact scanning would need a parser per format,
    where the shapes those three actually hold are a comment on its own line or after a value.
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
    """Every line carrying a `#` or a triple quote, blocks tracked across lines, line count kept.

    Wider than a comment on purpose: it is what the Python reader falls back to on source the
    tokenizer refuses, and a file that does not parse still holds comments a reader reads. Reading
    none of them would be indistinguishable from reading a file with none.
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

    The column is held because every finding quotes its line and several report a number, so a
    token moved to column zero would report a page the reader cannot find by looking.
    """
    row, column = start
    for offset, piece in enumerate(text.split("\n")):
        line = buffer[row - 1 + offset]
        buffer[row - 1 + offset] = (line.ljust(column) if offset == 0 else line) + piece


# Named rather than spelled inline: the formatter would fold the tuple into PEP 758's
# `except A, B:`, newer than `checker_kernel.py :: PARSE_FLOOR` --
# `scripts/tests/test_parse_floor.py` parses every module under `scripts/` at that floor.
UNTOKENIZABLE: Final = (tokenize.TokenError, SyntaxError, ValueError)


def _python_comments(text: str) -> str:
    """Python comments and docstrings, at their own lines and columns, with everything else blank.

    Tokenized rather than scanned for a marker: a `#` inside a string literal opens no comment, and
    the code line holding one is not a claim made to a reader. A docstring stays — INC-4 makes it
    documentation, and this gate's own citations are written in one — and it is a string standing
    alone as a whole statement, which is what tells it apart from a string the program uses.

    Three docstring shapes fall outside that test and are not scanned: one sharing its line with the
    `def` that owns it, one after a semicolon, and two adjacent strings relying on implicit
    concatenation, which arrive as two tokens and satisfy the test neither singly nor together. No
    tracked file writes any of them; a file that did would lose its docstring from the scan silently.
    """
    lines = text.split("\n")
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))
    except UNTOKENIZABLE:
        return _marker_lines(text)

    # A comment and a blank line can sit anywhere without ending a statement, so both come out
    # before a string's neighbours are read; what remains around one is the statement it sits in.
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

    Scanned character by character rather than by line, because JSON configuration is written in
    globs and URLs and both carry a marker INSIDE a string value: read by line, `"Read(./certs/**)"`
    opens a block comment that runs until whatever value happens to hold the next `*/`, and a
    permission glob is scanned as prose. JSON's string grammar is a quote and a backslash escape and
    nothing else, which is what makes an exact scan this short — TypeScript, whose literals nest and
    interpolate, is why the other branch stays line-grain.
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
    """Everything outside a comment blanked out, with the line count preserved.

    A path or an ADR number inside executable code is a string the program uses, not a claim made to
    a reader, so only comments are scanned. A `//` inside a URL is harmless: link checking skips
    http and https regardless.

    Two of the four readers are exact and two are not. Python is tokenized and JSON is scanned, so
    a marker inside a literal reaches nothing. TypeScript is read a line at a time, so a line whose
    CODE holds a marker is kept whole: closing that costs a node launch per file —
    `scripts/ts_normalize.mjs` is the only parser here that reads TypeScript — to remove a false
    positive that is loud when it fires. The `#` reader takes the rest, and `_shell_comments` states
    the surface it keeps: a quoted ` #` in a `.conf`, `.toml` or `.yaml` value is kept with it.
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

    Each format is read by the reader that knows it: `#` for nginx, YAML, TOML and a Dockerfile —
    which carries no suffix at all for `path.suffix` to dispatch on, and is why the `#` reader is
    the default rather than a case — and the JSONC scanner for the JSON this repository writes its
    tool configuration in.
    """
    return path.suffix if path.suffix in SOURCE_SUFFIXES or path.suffix == ".json" else ".sh"


@cache
def tracked_files() -> tuple[Path, ...]:
    """Every tracked document, source file and ops file, minus skips. Gitignored trees never appear.

    The leading `*` on a whole filename is what carries it past the repository root: an unanchored
    `Dockerfile` pathspec matches the root one alone, and this repository's sit a level down. It
    widens the pattern to anything ENDING in the name, so the name is re-checked below.

    NUL-separated for the reason `_tree_index` is: git quotes and octal-escapes a path outside ASCII
    in its default output, and a quoted spelling fails `is_file` and drops out of the corpus silently.
    """
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

    Built once rather than per pattern: deriving the spelling costs several times what matching it
    costs, and the derivation is identical for every pattern a run asks about.
    """
    return tuple((PurePosixPath(path.relative_to(REPO_ROOT).as_posix()), path) for path in tracked_files())


@cache
def tracked_glob(pattern: str) -> tuple[Path, ...]:
    """Every corpus file a repo-relative glob matches, in `tracked_files`' order.

    `Path.glob` reads the working tree, where a page no `git add` has reached still answers a
    citation of it -- green on the machine that wrote the page, red on the clean checkout CI reads,
    and reached by forgetting one command. The tracked listing is what a clean checkout will hold,
    so it is what selects a page here and what a cited id resolves against.

    `full_match` compares the whole repo-relative path, so `*` stops at a directory separator as it
    does on disk, and `PurePosixPath` keeps the comparison case-sensitive on Windows too.

    An empty answer is never explained here: `perkind.py :: check_inputs` owns absence, and a
    per-caller message about a missing tree is the drift that check exists to prevent.
    """
    return tuple(path for rel, path in _corpus_index() if rel.full_match(pattern))


@cache
def tracked_page(rel: str) -> Path | None:
    """One named page, or None where the tracked corpus does not hold it.

    A fixed path is the other way an un-added file answers for itself. A check reading one page
    straight off disk passes on a page written and never added, and `check_inputs` passes with it
    -- it asks the disk on purpose -- so both are silent about a page the checkout will not have.

    A page absent from disk and a page merely untracked arrive here as the same None, which is what
    lets a caller give them one sentence. `check_inputs` is where the two are still told apart.
    """
    return next((path for spelling, path in _corpus_index() if spelling.as_posix() == rel), None)


def atx_heading(line: str, level: int | None = None) -> str | None:
    """One ATX heading's text, or None where the line is not a heading at the level asked for.

    Every heading this gate reads resolves here, so no check can be blind to one a renderer
    displays. CommonMark allows up to three spaces of indentation, which is what a heading nested
    inside a numbered list item carries; a fourth space makes it an indented code block instead.
    """
    match = ATX_HEADING_RE.match(line)
    if match is None or (level is not None and len(match.group(1)) != level):
        return None
    return match.group(2)


def heading_anchors(body: str) -> set[str]:
    """The fragment ids GitHub derives from this file's headings, a repeat's `-N` suffix included.

    GitHub's own slugger, because the fragment a reader writes is copied off the rendered page: a
    slug spelled any other way fails a link that works there and passes one that is dead. Lowercase,
    drop what is neither a word character nor a space or a hyphen, spaces to hyphens, then number a
    repeat `-1` upward. An em dash therefore vanishes and leaves the two spaces around it as two
    hyphens, which is why `### OUT-2 — The folder layout` yields `out-2--the-folder-layout`.
    """
    anchors: set[str] = set()
    occurrences: dict[str, int] = {}
    fenced = False
    for line in body.split("\n"):
        # `strip_fences` runs first for every caller; `FENCE_RE` keeps this reading the same shape
        # rather than becoming a rival definition of what opens a block.
        if FENCE_RE.match(line):
            fenced = not fenced
            continue
        if fenced or (text := atx_heading(line)) is None:
            continue
        slug = SLUG_DROP_RE.sub("", INLINE_LINK_RE.sub(r"\1", text).lower()).replace(" ", "-")
        if not slug:
            continue
        # github-slugger's own counting: the suffix is taken from the ORIGINAL slug's tally, so a
        # third `## Setup` yields `setup-2` rather than colliding with the second's `setup-1`.
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

    Cached because a hub page links into the same handful of documents from every row, and each
    resolution otherwise re-reads and re-slugs the whole target. None is distinct from an empty
    set: a page with no headings resolves nothing, while an unreadable one is reported where it is
    scanned in its own right rather than a second time here.
    """
    body = _readable(target)
    return None if body is None else frozenset(heading_anchors(body))


@cache
def is_gitignored(token: str) -> bool:
    """A gitignored path is named deliberately and is absent by design (docs/audit/ is the case).

    Asked twice, because a directory-only pattern matches a bare name only while the directory is
    there: on a clean checkout the directory is gone, the bare name stops matching, and the
    reference reads as dead everywhere but the machine that has it.

    Only a clean exit says ignored, so a git that cannot answer leaves the finding standing.
    """
    return git_status("check-ignore", "-q", token) == 0 or git_status("check-ignore", "-q", f"{token}/") == 0


def repo_path(token: str) -> str | None:
    """The repository path a backticked token names, or None where it names nothing that is there.

    A token carrying no top-level prefix is resolved against the package roots, because that is how
    this repository writes one: `src/app/admin/admin.css` and `app/core/db.py` each name a file.
    Existence decides, so a token naming a KIND of file (`queries.ts`) resolves to nothing and stays
    prose. A traversal or an absolute spelling is refused rather than normalised: what it hands back
    has to be the spelling a git listing uses, or nothing downstream can match it against a diff.
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

    Empty where the file cannot be read, which every caller already treats as nothing to say -- the
    read failure itself is `unreadable`'s, reported once where the file is scanned in its own right.
    """
    raw = _read_text(path)[0]
    if raw is None:
        return ""
    return strip_fences(raw) if path.suffix == ".md" else comments_only(raw, comment_style(path))


def tolerate_console_encoding() -> None:
    """A console codepage must never decide whether a finding is printed.

    Every finding quotes the page it found, and a page carrying an arrow or a dash meets a Windows
    codepage that cannot encode it — which raises inside `print` and takes the run down with all of
    its findings unreported, on the machine the documentation is written on.
    """
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(errors="replace")
