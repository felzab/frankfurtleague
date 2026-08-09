"""
SCRIPTS · the documentation gate

Run by verify.sh. It is the mechanical half of the documentation standard's currency rules: the
other defences depend on someone remembering, and this one does not. The check list, with what
each failure means, lives in docs/_standard/chapters/5-currency.md (CUR-5) — the one place it is
written, so it is deliberately not restated here.

Invariants:
- Fenced code blocks are stripped first; placeholder text (< > { } * ? or NNNN) is skipped.
- Source comments are scanned exactly like documentation (INC-6) — only comments, never code.
- Three checks read the branch, not the tree: stamp freshness, branch impact (CUR-4), history phrases.
- Material means more than comments, decided by `check_scope.is_comment_only` — one classifier, two gates.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Iterable, Literal

import check_scope

REPO_ROOT: Final = Path(__file__).resolve().parent.parent

# Scanned subtrees exclude these:
#   docs/audit   -- gitignored working documents of a running audit programme, absent from any clone.
#   node_modules -- vendored, and not ours to hold to this standard.
#   .venv        -- same.
SKIP_DIRS: Final[tuple[str, ...]] = ("docs/audit", "node_modules", ".venv")

# Templates are skipped entirely. Their links and placeholders resolve from wherever a template is
# COPIED to, never from the template itself, so checking one in place reports the design as a defect.
# A file is a template if it sits in a templates/ directory or its name ends -template.md.
TEMPLATE_MARKERS: Final[tuple[str, ...]] = ("/templates/", "-template.md")

# The comment-bearing source suffixes the gate scans (INC-6).
SOURCE_SUFFIXES: Final[tuple[str, ...]] = (".ts", ".tsx", ".js", ".mjs", ".cjs", ".py")

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
)

# COR-3's banned shapes. Reported, never failed: "the former ... the latter" is ordinary English, so
# every hit has to be read by a person.
HISTORY_PHRASES: Final[tuple[str, ...]] = (
    "used to",
    "was removed",
    "previously",
    "moved here",
    "formerly",
    "no longer",
)

FENCE_RE: Final = re.compile(r"^\s*(```|~~~)")
ADR_RE: Final = re.compile(r"\bADR-(\d{4})\b")
LINK_RE: Final = re.compile(r"(?<!!)\[[^\]]*\]\(([^)\s]+?)(?:#[^)]*)?\)")
# A citation is a single backticked run containing exactly one " :: ". The separator is what marks it
# as checkable rather than prose (COR-6).
CITATION_RE: Final = re.compile(r"`([^`\n]+? :: [^`\n]+?)`")
BACKTICK_RE: Final = re.compile(r"`([^`\n]+?)`")
STAMP_RE: Final = re.compile(r"\*\*Verified against:\*\*\s*`([0-9a-f]{7,40})`")
STAMP_LINE_RE: Final = re.compile(r"(?m)^.*\*\*Verified against:\*\*.*$")
# CUR-3's exact stamp shape, plus COR-8's optional trailing hard break. Anything that starts like
# a stamp and is not this fails stamp-format; a looser line would still be found by STAMP_RE-based
# checks, so the two stay in step.
STRICT_STAMP_RE: Final = re.compile(r"\*\*Verified against:\*\* `[0-9a-f]{7,40}`, \d{4}-\d{2}-\d{2}\\?")

# A rule id resolves to a rule heading in the standard's chapters or it dangles. Two segments and a
# short number, so the backend's three-segment error codes (REQ-VAL-001) can never collide.
RULE_ID_RE: Final = re.compile(r"\b((?:PRE|COR|INC|OUT|DEC|CUR)-\d{1,2})\b")
RULE_HEADING_RE: Final = re.compile(r"^###\s+((?:PRE|COR|INC|OUT|DEC|CUR)-\d{1,2})\b")
CHAPTERS_DIR: Final = REPO_ROOT / "docs" / "_standard" / "chapters"

# A line-number citation is wrong after any edit above it and nothing else detects that, which is why
# COR-6 bans it outright. Matches a backticked path with a trailing :N or :N-M.
#
# The extension must be 2 to 5 LETTERS, which is what separates a path from the other things that
# carry a dot and a colon: a contrast ratio (4.5:1) and a version (22.1.0) both have a digit where a
# file has an extension, and flagging either would be the false positive that gets the check
# switched off.
LINE_CITATION_RE: Final = re.compile(r"`([^`\n]*\.[A-Za-z]{2,5}:\d+(?:-\d+)?)`")

# INC-2's module-header shapes, checked only where that rule binds (the chapter's Applies-to
# subtrees, by suffix). Presence is never checked: INC-2 fixes the shape of a header that exists,
# so a file that opens with `//` line comments, or with none, passes unchecked.
HEADER_SCOPES: Final[tuple[tuple[str, tuple[str, ...]], ...]] = (
    ("fl_frontend/src/", (".ts", ".tsx")),
    ("fl_backend/app/", (".py",)),
    ("fl_backend/tests/", (".py",)),
    ("scripts/", (".py",)),
)
HEADER_CAP: Final = 20
# A directive stays above the header (INC-7), so the header scan steps over it.
DIRECTIVE_RE: Final = re.compile(r"^\s*([\"'])use (client|server|strict)\1;?\s*$")
PY_DOCSTRING_OPEN_RE: Final = re.compile(r"^[rRuU]?(\"\"\"|''')")
# The title separator is U+00B7. Ruled lines and shouty label rows are the retired header
# vocabulary INC-2 replaced. A label line is one or two capitalised words ending in a colon --
# anything longer is wrapped prose, and flagging prose is the false positive that gets a check
# switched off.
HEADER_TITLE_RE: Final = re.compile(r"\S+ · \S.*")
HEADER_RULED_RE: Final = re.compile(r"─{3,}|-{8,}")
HEADER_SHOUTY_RE: Final = re.compile(r"[A-Z][A-Z ']{3,}")
HEADER_LABEL_RE: Final = re.compile(r"[A-Z][A-Za-z]*( [A-Za-z]+)?:")
HEADER_LABELS: Final[tuple[str, ...]] = ("Invariants:", "See:")

# The ADR anatomy DEC-2 fixes, in order. adr-meta checks the shape; the reasoning lives in the rule.
ADR_META_ORDER: Final[tuple[str, ...]] = ("Status", "Date", "Surface", "Supersedes", "Superseded by", "Source")
ADR_META_RE: Final = re.compile(r"^\*\*(Status|Date|Surface|Supersedes|Superseded by|Source):\*\*\s*(.*)$")
ADR_STATUS_RE: Final = re.compile(r"Accepted|Proposed|Deprecated|Superseded by ADR-\d{4}")
ADR_H2S: Final[tuple[str, ...]] = ("Context", "Decision", "Consequences", "Alternatives considered")

Severity = Literal["fail", "report"]


@dataclass(frozen=True, slots=True)
class Finding:
    """One problem, already resolved to whether it fails the run."""

    severity: Severity
    check: str
    file: str
    detail: str

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
    return done.stdout.strip() if done.returncode == 0 else None


def _skipped(path: Path) -> bool:
    """True for a template, or anything under a SKIP_DIRS entry at any depth.

    A SKIP_DIRS entry may be a full prefix (`docs/audit`) or a single segment (`node_modules`), and
    the latter has to match at any depth -- `fl_frontend/node_modules/...` is what actually occurs.
    """
    rel = path.relative_to(REPO_ROOT).as_posix()
    if any(marker in f"/{rel}" for marker in TEMPLATE_MARKERS):
        return True
    segments = rel.split("/")
    return any(rel == d or rel.startswith(f"{d}/") or ("/" not in d and d in segments) for d in SKIP_DIRS)


def comments_only(text: str, suffix: str) -> str:
    """Everything outside a comment blanked out, with the line count preserved.

    A path or an ADR number inside executable code is a string the program uses, not a claim made to
    a reader, so only comments are scanned. Block comments and docstrings are tracked across lines.
    A `//` inside a URL is harmless: link checking skips http and https regardless.
    """
    triple_double = '"""'
    triple_single = "'''"
    # JavaScript shares TypeScript's comment syntax exactly, so it takes the same branch. Adding a
    # suffix to SOURCE_SUFFIXES without adding it here would parse it as Python and silently find
    # no comments at all.
    is_ts = suffix in (".ts", ".tsx", ".js", ".mjs", ".cjs")
    keep: list[str] = []
    in_block = False

    for line in text.split("\n"):
        if in_block:
            keep.append(line)
            if is_ts:
                if "*/" in line:
                    in_block = False
            elif (line.count(triple_double) + line.count(triple_single)) % 2 == 1:
                in_block = False
            continue

        if is_ts:
            if "/*" in line and "*/" not in line:
                in_block = True
                keep.append(line)
            else:
                keep.append(line if ("/*" in line or "//" in line) else "")
            continue

        quotes = line.count(triple_double) + line.count(triple_single)
        stripped = line.lstrip()
        if stripped.startswith((triple_double, triple_single)) and quotes % 2 == 1:
            in_block = True
            keep.append(line)
        else:
            keep.append(line if ("#" in line or quotes) else "")

    return "\n".join(keep)


def tracked_files() -> list[Path]:
    """Every tracked document and source file, minus skips. Gitignored trees never appear."""
    patterns = ("*.md", *(f"*{suffix}" for suffix in SOURCE_SUFFIXES))
    listing = git("ls-files", *patterns)
    if listing is None:
        candidates = [p for pat in patterns for p in REPO_ROOT.rglob(pat)]
    else:
        candidates = [REPO_ROOT / line for line in listing.split("\n") if line]
    return sorted({p for p in candidates if p.is_file() and not _skipped(p)})


def heading_anchors(body: str) -> set[str]:
    """The fragment ids a markdown renderer derives from this file's headings.

    Lowercase, drop everything that is not alphanumeric / space / hyphen, then spaces to hyphens.
    An em dash therefore vanishes and leaves the two spaces around it as two hyphens, which is why
    `### OUT-2 — The folder layout` yields `out-2--the-folder-layout`.
    """
    anchors: set[str] = set()
    for line in body.split("\n"):
        if not line.startswith("#"):
            continue
        text = line.lstrip("#").strip()
        text = re.sub(r"[`*_\[\]()]", "", text)
        slug = re.sub(r"[^a-z0-9 -]", "", text.lower()).replace(" ", "-")
        if slug:
            anchors.add(slug)
    return anchors


def is_gitignored(token: str) -> bool:
    """A gitignored path is named deliberately and is absent by design (docs/audit/ is the case)."""
    return (
        subprocess.run(
            ("git", "check-ignore", "-q", token),
            cwd=REPO_ROOT,
            capture_output=True,
            check=False,
        ).returncode
        == 0
    )


def adr_numbers() -> set[str]:
    """The four-digit prefixes of every ADR file that exists."""
    decisions = REPO_ROOT / "docs" / "_decisions"
    if not decisions.is_dir():
        return set()
    return {m.group(1) for f in decisions.glob("*.md") if (m := re.match(r"^(\d{4})-", f.name))}


def rule_ids() -> set[str]:
    """Every rule id a chapter defines: the `### <ID> — <name>` headings under chapters/.

    An empty set when the chapters folder is missing, so every cited id then fails -- deleting the
    standard out from under its citations is exactly what the rule-id check exists to catch.
    """
    ids: set[str] = set()
    if not CHAPTERS_DIR.is_dir():
        return ids
    for chapter in CHAPTERS_DIR.glob("*.md"):
        try:
            text = chapter.read_text(encoding="utf-8")
        except OSError, UnicodeDecodeError:
            continue
        for line in text.split("\n"):
            if match := RULE_HEADING_RE.match(line):
                ids.add(match.group(1))
    return ids


def _resolve(file_part: str) -> list[Path]:
    """A citation may give a full repo path or just a filename; a bare name must be unambiguous."""
    direct = REPO_ROOT / file_part
    if direct.is_file():
        return [direct]
    if "/" in file_part:
        return []
    return [p for p in REPO_ROOT.rglob(file_part) if p.is_file() and not _skipped(p)][:5]


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
    try:
        content = target.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return [Finding("fail", "citation", rel, f"cannot read {file_part}: {exc}")]

    if anchor not in content:
        where = target.relative_to(REPO_ROOT).as_posix()
        return [Finding("fail", "citation", rel, f"anchor '{anchor}' no longer appears in {where}")]
    return []


def _header_scoped(rel: str, suffix: str) -> bool:
    """True where INC-2 binds a file's header to its shape."""
    return any(rel.startswith(prefix) and suffix in suffixes for prefix, suffixes in HEADER_SCOPES)


def _module_header(raw: str, suffix: str) -> list[str] | None:
    """The module header's lines, delimiters included, or None where the file carries none.

    TypeScript: the leading block comment, stepping over blank lines and a directive (INC-7). A
    leading run of `//` comments is not a header, so a file opening with one returns None and is
    not checked. Python: the module docstring, which is only a docstring as the first statement;
    a `#` line above it (a shebang) does not end the scan. An unterminated delimiter runs to the
    end of the file, which the line cap then fails -- the conservative direction.
    """
    lines = raw.split("\n")
    i = 0
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
    if suffix == ".py":
        text = PY_DOCSTRING_OPEN_RE.sub("", text)
        return text.removesuffix('"""').removesuffix("'''").strip()
    text = text.removesuffix("*/").strip()
    for opener in ("/**", "/*", "*"):
        if text.startswith(opener):
            return text[len(opener) :].strip()
    return text


def check_module_header(rel: str, raw: str, suffix: str) -> list[Finding]:
    """A module header in INC-2's scope keeps INC-2's shape.

    The retired vocabulary -- ruled lines, shouty label rows, foreign list labels, an oversized
    block -- passes every compiler and linter, so nothing but this check stops it creeping back.
    """
    header = _module_header(raw, suffix)
    if header is None:
        return []
    found: list[Finding] = []
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


def check_file(path: Path, existing_adrs: set[str], existing_rules: set[str]) -> list[Finding]:
    """Every per-file check, for one file."""
    rel = path.relative_to(REPO_ROOT).as_posix()
    is_markdown = path.suffix == ".md"
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return [Finding("fail", "unreadable", rel, str(exc))]
    body = strip_fences(raw) if is_markdown else comments_only(raw, path.suffix)

    found: list[Finding] = []

    if not is_markdown and _header_scoped(rel, path.suffix):
        found.extend(check_module_header(rel, raw, path.suffix))

    for number in sorted(set(ADR_RE.findall(body))):
        if number not in existing_adrs:
            found.append(Finding("fail", "adr", rel, f"ADR-{number} resolves to no file in docs/_decisions/"))

    for rule_id in sorted(set(RULE_ID_RE.findall(body))):
        if rule_id not in existing_rules:
            found.append(Finding("fail", "rule-id", rel, f"{rule_id} resolves to no rule heading in docs/_standard/chapters/"))

    for citation in sorted(set(CITATION_RE.findall(body))):
        if not is_placeholder(citation):
            found.extend(_check_citation(citation, rel))

    # COR-6 bans line-number citations outright. Nothing else can detect one: it stays syntactically
    # valid and merely stops pointing at what it names, so it has to be caught at the form.
    for citation in sorted(set(LINE_CITATION_RE.findall(body))):
        if is_placeholder(citation):
            continue
        found.append(Finding("fail", "line-citation", rel, f"line-number citation `{citation}` -- anchor it to a symbol (COR-6)"))

    # Links, anchors, backticked paths and stamps are markdown conventions; a comment does not use them.
    if not is_markdown:
        return found

    # Any line that starts like a stamp is held to CUR-3's exact shape. Prose ABOUT the stamp never
    # starts a line with it, and the placeholder rule keeps a documented `<sha>` out of scope.
    for line in body.split("\n"):
        if not line.startswith("**Verified against"):
            continue
        if is_placeholder(line):
            continue
        if not STRICT_STAMP_RE.fullmatch(line):
            found.append(Finding("fail", "stamp-format", rel, f"stamp line is not CUR-3's exact shape: {line.strip()}"))

    anchors = heading_anchors(body)
    for raw_target in sorted(set(LINK_RE.findall(body))):
        if raw_target.startswith(("http://", "https://", "mailto:")) or is_placeholder(raw_target):
            continue
        if raw_target.startswith("#"):
            if raw_target[1:] not in anchors:
                found.append(Finding("fail", "anchor", rel, f"no heading in this file yields {raw_target}"))
            continue
        if not (path.parent / raw_target).resolve().exists():
            found.append(Finding("fail", "link", rel, f"link target does not exist: {raw_target}"))

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


def cited_paths(body: str) -> set[str]:
    """Repo paths a page points at: the file half of each citation, plus backticked repo paths."""
    out: set[str] = set()
    for citation in CITATION_RE.findall(body):
        if is_placeholder(citation):
            continue
        file_part = citation.partition(" :: ")[0].strip()
        if file_part.startswith(REPO_PREFIXES) and (REPO_ROOT / file_part).exists():
            out.add(file_part)
    for token in BACKTICK_RE.findall(body):
        if " :: " in token or is_placeholder(token):
            continue
        if token.startswith(REPO_PREFIXES) and (REPO_ROOT / token).exists():
            out.add(token)
    return out


def check_stamps(paths: Iterable[Path]) -> list[Finding]:
    """A `Verified against` SHA must be a real ancestor of HEAD.

    An unknown SHA is only reported: a shallow clone genuinely does not have the object, and that is
    the checkout's shape rather than the page's defect.
    """
    found: list[Finding] = []
    for path in paths:
        rel = path.relative_to(REPO_ROOT).as_posix()
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError, UnicodeDecodeError:
            continue
        match = STAMP_RE.search(strip_fences(raw))
        if match is None:
            continue
        sha = match.group(1)

        if git("cat-file", "-e", f"{sha}^{{commit}}") is None:
            found.append(Finding("report", "stamp", rel, f"commit {sha} is not in this clone"))
            continue

        is_ancestor = subprocess.run(
            ("git", "merge-base", "--is-ancestor", sha, "HEAD"),
            cwd=REPO_ROOT,
            capture_output=True,
            check=False,
        ).returncode
        if is_ancestor != 0:
            found.append(Finding("fail", "stamp", rel, f"commit {sha} is not an ancestor of HEAD"))
    return found


def check_stamp_freshness(base: str) -> list[Finding]:
    """A stamped page changed on this branch must also change its stamp (CUR-4).

    The stamp claims someone checked the page against a commit. Editing the page without moving it
    leaves that claim attached to work the author did not verify, and no other check can tell the
    difference -- an old SHA is a valid ancestor forever. If the page was genuinely still correct,
    restamping says so; that is the whole point of the line.
    """
    # Against the merge base and the WORKING TREE, not HEAD. The gate runs before a commit exists, so
    # comparing committed state would let the edit through on the run that could still have caught it.
    fork = git("merge-base", base, "HEAD")
    if fork is None:
        return []
    changed = git("diff", "--name-only", fork, "--", "*.md")
    if not changed:
        return []

    found: list[Finding] = []
    for rel in changed.split("\n"):
        if not rel:
            continue
        path = REPO_ROOT / rel
        if not path.is_file() or _skipped(path):
            continue
        try:
            current = path.read_text(encoding="utf-8")
        except OSError, UnicodeDecodeError:
            continue
        if STAMP_RE.search(strip_fences(current)) is None:
            continue

        before = git("show", f"{fork}:{rel}")
        if before is None:  # added on this branch, so there is no earlier stamp to compare
            continue
        old_line = STAMP_LINE_RE.search(before)
        new_line = STAMP_LINE_RE.search(current)
        if old_line and new_line and old_line.group(0) == new_line.group(0):
            found.append(
                Finding(
                    "fail",
                    "stamp",
                    rel,
                    "changed on this branch without its `Verified against` line moving -- re-verify the page, then restamp (CUR-4)",
                )
            )
    return found


def _stamp_only_delta(fork: str, rel: str) -> bool:
    """A markdown delta consisting only of moved stamp lines is a restamp, not a change.

    Restamping is the remedy branch-impact itself prescribes, and a remedy that re-arms the check
    on every page citing the restamped one turns one edit into a repository-wide cascade
    (ADR-0073). Nothing a citer cites lives on the stamp line, so real stamp lines are normalised
    out of both versions before they are compared. Only a line carrying an actual SHA is
    normalised: a placeholder stamp, like the shape example in the currency chapter, is content.
    Anything unreadable stays material, which is the conservative direction.
    """
    if not rel.endswith(".md"):
        return False
    before = git("show", f"{fork}:{rel}")
    if before is None:
        return False
    try:
        after = (REPO_ROOT / rel).read_text(encoding="utf-8")
    except OSError, UnicodeDecodeError:
        return False

    def keep_placeholders(match: re.Match[str]) -> str:
        return "" if STAMP_RE.search(match.group(0)) else match.group(0)

    # Stripped on both sides because git() strips what `git show` returns, while read_text keeps
    # the file's trailing newline -- without this the two sides never compare equal.
    normalised_before = STAMP_LINE_RE.sub(keep_placeholders, before).strip()
    normalised_after = STAMP_LINE_RE.sub(keep_placeholders, after).strip()
    return normalised_before == normalised_after


def check_branch_impact(base: str) -> list[Finding]:
    """A stamped page whose cited files materially changed on this branch must restamp (CUR-4).

    Material means more than comments, decided by check_scope's parser classifier -- anything it
    cannot prove comment-only counts, so shell, YAML and Dockerfiles always do, and markdown does
    unless its whole delta is stamp lines, which is a restamp rather than a change (ADR-0073). A
    page added on the branch passes: its stamp is already this branch's work.
    """
    fork = check_scope.resolve_base(base)
    if fork is None:
        return []
    changed = check_scope.changed_files(fork)
    material = {path for path in changed if not check_scope.is_comment_only(fork, path) and not _stamp_only_delta(fork, path)}
    if not material:
        return []

    found: list[Finding] = []
    for path in tracked_files():
        if path.suffix != ".md":
            continue
        rel = path.relative_to(REPO_ROOT).as_posix()
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError, UnicodeDecodeError:
            continue
        body = strip_fences(raw)
        if STAMP_RE.search(body) is None:
            continue
        hits = sorted(cited_paths(body) & material)
        if not hits:
            continue

        before = git("show", f"{fork}:{rel}")
        if before is None:
            continue
        old_line = STAMP_LINE_RE.search(before)
        new_line = STAMP_LINE_RE.search(raw)
        if old_line and new_line and old_line.group(0) == new_line.group(0):
            shown = ", ".join(hits[:4]) + (f", and {len(hits) - 4} more" if len(hits) > 4 else "")
            found.append(
                Finding(
                    "fail",
                    "branch-impact",
                    rel,
                    f"this branch materially changed {shown}, which this stamped page cites -- re-verify the page, then restamp (CUR-4)",
                )
            )
    return found


def check_adr_meta() -> list[Finding]:
    """Every ADR carries DEC-2's exact anatomy, DEC-3's status set, and DEC-6's reciprocity."""
    decisions = REPO_ROOT / "docs" / "_decisions"
    found: list[Finding] = []
    # Number -> the two supersession fields, collected first so reciprocity can be checked across files.
    supersedes: dict[str, str] = {}
    superseded_by: dict[str, str] = {}

    for path in sorted(decisions.glob("*.md")):
        match = re.match(r"^(\d{4})-", path.name)
        if match is None:
            continue
        number = match.group(1)
        rel = path.relative_to(REPO_ROOT).as_posix()
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError, UnicodeDecodeError:
            found.append(Finding("fail", "adr-meta", rel, "unreadable"))
            continue
        lines = strip_fences(raw).split("\n")

        if not lines[0].startswith(f"# ADR-{number} — "):
            found.append(Finding("fail", "adr-meta", rel, f"the H1 does not read `# ADR-{number} — <statement>` matching the filename"))

        names: list[str] = []
        values: dict[str, str] = {}
        for line in lines:
            if line.startswith("## "):
                break
            if meta := ADR_META_RE.match(line):
                names.append(meta.group(1))
                # COR-8's hard break is layout, not value: strip it before validating.
                values[meta.group(1)] = meta.group(2).strip().removesuffix("\\").strip()
        if tuple(names) != ADR_META_ORDER:
            found.append(Finding("fail", "adr-meta", rel, f"metadata lines are not exactly {', '.join(ADR_META_ORDER)}, in that order"))
        else:
            if ADR_STATUS_RE.fullmatch(values["Status"]) is None:
                found.append(Finding("fail", "adr-meta", rel, f"Status '{values['Status']}' is outside DEC-3's closed set"))
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", values["Date"]) is None:
                found.append(Finding("fail", "adr-meta", rel, f"Date '{values['Date']}' is not an ISO date"))
            if not values["Source"]:
                found.append(Finding("fail", "adr-meta", rel, "the Source line is empty"))
            supersedes[number] = values["Supersedes"]
            superseded_by[number] = values["Superseded by"]

        h2s = tuple(line[3:].strip() for line in lines if line.startswith("## "))
        if h2s != ADR_H2S:
            found.append(Finding("fail", "adr-meta", rel, f"H2 sections are not exactly {', '.join(ADR_H2S)}, in that order"))

        if any(line.startswith("**Verified against") for line in lines):
            found.append(Finding("fail", "adr-meta", rel, "an ADR carries no stamp line -- it is dated, never re-verified (DEC-2)"))

    def other_number(value: str, rel: str, field: str) -> str | None:
        if value == "—":
            return None
        if m := re.fullmatch(r"ADR-(\d{4})", value):
            return m.group(1)
        found.append(Finding("fail", "adr-meta", rel, f"{field} '{value}' is neither — nor a single ADR-NNNN"))
        return None

    for number, value in supersedes.items():
        rel = f"docs/_decisions/{number}-*"
        if (other := other_number(value, rel, "Supersedes")) is None:
            continue
        if superseded_by.get(other) != f"ADR-{number}":
            found.append(Finding("fail", "adr-meta", rel, f"not reciprocal: ADR-{other} does not carry Superseded by ADR-{number}"))
    for number, value in superseded_by.items():
        rel = f"docs/_decisions/{number}-*"
        if (other := other_number(value, rel, "Superseded by")) is None:
            continue
        if supersedes.get(other) != f"ADR-{number}":
            found.append(Finding("fail", "adr-meta", rel, f"not reciprocal: ADR-{other} does not carry Supersedes ADR-{number}"))

    return found


def check_adr_index() -> list[Finding]:
    """Every ADR file has an index row in docs/_decisions/README.md (DEC-7).

    Only the missing-row direction lives here: a row pointing at a missing file is already a dead
    link, and the link check reports it.
    """
    decisions = REPO_ROOT / "docs" / "_decisions"
    readme = decisions / "README.md"
    try:
        content = readme.read_text(encoding="utf-8")
    except OSError, UnicodeDecodeError:
        return [Finding("fail", "adr-index", "docs/_decisions/README.md", "unreadable or missing")]

    rows = re.findall(r"^\|\s*\[(\d{4})\]\(([^)]+)\)", content, re.MULTILINE)
    indexed = {number for number, _ in rows}

    found: list[Finding] = []
    for number, target in rows:
        if not target.startswith(number):
            detail = f"row [{number}] links to {target}, a different number's file"
            found.append(Finding("fail", "adr-index", "docs/_decisions/README.md", detail))
    for path in sorted(decisions.glob("*.md")):
        if (match := re.match(r"^(\d{4})-", path.name)) and match.group(1) not in indexed:
            found.append(Finding("fail", "adr-index", "docs/_decisions/README.md", f"no index row for {path.name}"))
    return found


def check_history_phrases(base: str) -> list[Finding]:
    """COR-3's banned shapes, over the branch diff. Always a report: the hits must be read."""
    diff = git("diff", f"{base}...HEAD", "-U0", "--", "*.md")
    if not diff:
        return []
    pattern = re.compile("|".join(re.escape(p) for p in HISTORY_PHRASES), re.IGNORECASE)
    hits = [line[1:].strip() for line in diff.split("\n") if line.startswith("+") and not line.startswith("+++") and pattern.search(line)]
    if not hits:
        return []
    return [Finding("report", "history", "(branch diff)", f"{len(hits)} added line(s) match a COR-3 history phrase -- read them")]


def main() -> int:
    parser = argparse.ArgumentParser(description="Documentation gate (docs/_standard/chapters/5-currency.md).")
    parser.add_argument("--all", action="store_true", help="list every advisory finding, not just the first ten")
    parser.add_argument("--base", default="main", help="base ref for the branch-scoped checks (default: main)")
    args = parser.parse_args()

    files = tracked_files()
    if not files:
        print("      no files found -- nothing to check", file=sys.stderr)
        return 0

    # CI checkouts have no local branch for the base, only its remote-tracking ref -- without this
    # fallback the branch-scoped checks below silently ran against nothing on every CI run.
    base = args.base
    if git("rev-parse", "--verify", base) is None and git("rev-parse", "--verify", f"origin/{base}") is not None:
        base = f"origin/{base}"

    existing_adrs = adr_numbers()
    existing_rules = rule_ids()
    findings: list[Finding] = []
    for path in files:
        findings.extend(check_file(path, existing_adrs, existing_rules))
    findings.extend(check_stamps(files))
    findings.extend(check_stamp_freshness(base))
    findings.extend(check_branch_impact(base))
    findings.extend(check_adr_meta())
    findings.extend(check_adr_index())
    findings.extend(check_history_phrases(base))

    failures = [f for f in findings if f.severity == "fail"]
    reports = [f for f in findings if f.severity == "report"]

    if failures:
        print(f"\n      {len(failures)} failing finding(s):")
        for finding in failures:
            print(finding.line())

    if reports:
        print(f"\n      {len(reports)} advisory finding(s):")
        for finding in reports if args.all else reports[:10]:
            print(finding.line())
        if not args.all and len(reports) > 10:
            print(f"      ... and {len(reports) - 10} more -- scripts/check_docs.py --all lists every one")

    docs = sum(1 for f in files if f.suffix == ".md")
    sources = len(files) - docs
    print(f"\n      scanned {docs} documents and {sources} source files against {len(existing_adrs)} ADRs, {len(existing_rules)} rules")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
