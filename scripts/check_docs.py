"""
scripts/check_docs.py - the documentation currency gate.

Run by verify.sh. It is the mechanical half of the documentation standard's currency rules
(docs/_standard/5-currency.md, DS18): the other three defences depend on someone remembering, and
this one does not.

 WHAT IT CHECKS ------------------------------------------------------------------------------------

  Failing, because each is objectively broken and cheap to fix:
    1. every ADR-NNNN citation resolves to a file in docs/_decisions/
    2. every relative markdown link resolves to an existing file
    3. every citation of the form <path> :: <anchor> resolves - the file exists AND the anchor
    4. every backticked repo path exists

  Reporting, because a hit is evidence rather than proof and a check that cries wolf gets ignored:
    5. a page's cited files changed since its `Verified against` commit
    6. DS14's history phrases appear in the branch diff

 ENFORCEMENT SCOPE ---------------------------------------------------------------------------------

 The whole repository is enforced: every failing check fails the run, wherever the file lives.
 ENFORCED_PATHS narrows that when a folder is mid-adoption, because a hard failure a folder cannot yet
 satisfy has to be suppressed, and a suppressed check is worse than no check.

 SCANNING RULES ------------------------------------------------------------------------------------

 Fenced code blocks are stripped before anything is extracted. A link or citation inside a fence is a
 worked example, not a reference, and templates are made almost entirely of those.

 Placeholder text is skipped wherever it appears: anything containing < > { } * ? or the literal NNNN.
 Templates ship `<sha>` and `ADR-NNNN` on purpose.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Iterable, Literal

REPO_ROOT: Final = Path(__file__).resolve().parent.parent

# Failures here fail the run. Everything else is reported only -- see ENFORCEMENT SCOPE above.
ENFORCED_PATHS: Final[tuple[str, ...]] = ("",)  # "" matches every path: the whole repository

# Scanned subtrees exclude these:
#   docs/audit   -- gitignored working documents of a running audit programme, absent from any clone.
#   node_modules -- vendored, and not ours to hold to this standard.
#   .venv        -- same.
SKIP_DIRS: Final[tuple[str, ...]] = ("docs/audit", "node_modules", ".venv")

# Templates are skipped entirely. Their links and placeholders resolve from wherever a template is
# COPIED to, never from the template itself, so checking one in place reports the design as a defect.
# A file is a template if it sits in a templates/ directory or its name ends -template.md.
TEMPLATE_MARKERS: Final[tuple[str, ...]] = ("/templates/", "-template.md")

# Source files carry the same citations as documentation and rot the same way, so their COMMENTS are
# scanned too (DS20). Only comments: a path-shaped string in executable code is data, not a claim.
SOURCE_SUFFIXES: Final[tuple[str, ...]] = (".ts", ".tsx", ".py")

# Top-level directories a backticked path must start with to be treated as a repo path. Anything else
# in backticks is prose -- a bare `queries.ts` names a KIND of file, not one file.
REPO_PREFIXES: Final[tuple[str, ...]] = (
    "fl_frontend/", "fl_backend/", "docs/", "scripts/", "nginx/", ".claude/", ".github/",
)

# DS14's banned shapes. Reported, never failed: "the former ... the latter" is ordinary English, so
# every hit has to be read by a person.
HISTORY_PHRASES: Final[tuple[str, ...]] = (
    "used to", "was removed", "previously", "moved here", "formerly", "no longer",
)

FENCE_RE: Final = re.compile(r"^\s*(```|~~~)")
ADR_RE: Final = re.compile(r"\bADR-(\d{4})\b")
LINK_RE: Final = re.compile(r"(?<!!)\[[^\]]*\]\(([^)\s]+?)(?:#[^)]*)?\)")
# A citation is a single backticked run containing exactly one " :: ". The separator is what marks it
# as checkable rather than prose (P6).
CITATION_RE: Final = re.compile(r"`([^`\n]+? :: [^`\n]+?)`")
BACKTICK_RE: Final = re.compile(r"`([^`\n]+?)`")
STAMP_RE: Final = re.compile(r"\*\*Verified against:\*\*\s*`?([0-9a-f]{7,40})`?")
STAMP_LINE_RE: Final = re.compile(r"(?m)^.*\*\*Verified against:\*\*.*$")

# A line-number citation is wrong after any edit above it and nothing else detects that, which is why
# P6 bans it outright. Matches a backticked path with a trailing :N or :N-M.
#
# The extension must be 2 to 5 LETTERS, which is what separates a path from the other things that
# carry a dot and a colon: a contrast ratio (4.5:1) and a version (22.1.0) both have a digit where a
# file has an extension, and flagging either would be the false positive that gets the check
# switched off.
LINE_CITATION_RE: Final = re.compile(r"`([^`\n]*\.[A-Za-z]{2,5}:\d+(?:-\d+)?)`")

# Drift past this many commits stops being "possibly stale" and becomes "nobody has looked". Most
# changes to a cited file leave the claim true, so the number is deliberately large: below it the
# check would fire constantly and be turned off, which is the failure mode it exists to avoid.
DRIFT_FAIL_AFTER: Final = 25

Severity = Literal["fail", "report"]


@dataclass(frozen=True, slots=True)
class Finding:
    """One problem, already resolved to whether it fails the run."""

    severity: Severity
    check: str
    file: str
    detail: str

    def line(self) -> str:
        return f"  {self.file}: {self.detail}  [{self.check}]"


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
    return any(
        rel == d or rel.startswith(f"{d}/") or ("/" not in d and d in segments)
        for d in SKIP_DIRS
    )


def comments_only(text: str, suffix: str) -> str:
    """Everything outside a comment blanked out, with the line count preserved.

    A path or an ADR number inside executable code is a string the program uses, not a claim made to
    a reader, so only comments are scanned. Block comments and docstrings are tracked across lines.
    A `//` inside a URL is harmless: link checking skips http and https regardless.
    """
    triple_double = '"""'
    triple_single = "'''"
    is_ts = suffix in (".ts", ".tsx")
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
    `## DS1 - In-code style` yields `ds1--in-code-style`.
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
            cwd=REPO_ROOT, capture_output=True, check=False,
        ).returncode
        == 0
    )


def severity_for(path: Path) -> Severity:
    rel = path.relative_to(REPO_ROOT).as_posix()
    return "fail" if any(rel.startswith(p) for p in ENFORCED_PATHS) else "report"


def adr_numbers() -> set[str]:
    """The four-digit prefixes of every ADR file that exists."""
    decisions = REPO_ROOT / "docs" / "_decisions"
    if not decisions.is_dir():
        return set()
    return {m.group(1) for f in decisions.glob("*.md") if (m := re.match(r"^(\d{4})-", f.name))}


def _resolve(file_part: str) -> list[Path]:
    """A citation may give a full repo path or just a filename; a bare name must be unambiguous."""
    direct = REPO_ROOT / file_part
    if direct.is_file():
        return [direct]
    if "/" in file_part:
        return []
    return [p for p in REPO_ROOT.rglob(file_part) if p.is_file() and not _skipped(p)][:5]


def _check_citation(citation: str, rel: str, sev: Severity) -> list[Finding]:
    """A <file> :: <anchor> citation: the file must exist and the anchor must appear inside it."""
    file_part, _, anchor = citation.partition(" :: ")
    file_part, anchor = file_part.strip(), anchor.strip()
    if not file_part or not anchor:
        return [Finding(sev, "citation", rel, f"malformed citation: {citation}")]

    matches = _resolve(file_part)
    if not matches:
        return [Finding(sev, "citation", rel, f"cited file not found: {file_part}")]
    if len(matches) > 1:
        names = ", ".join(sorted(m.relative_to(REPO_ROOT).as_posix() for m in matches)[:4])
        return [Finding(sev, "citation", rel, f"ambiguous file '{file_part}' matches: {names}")]

    target = matches[0]
    try:
        content = target.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return [Finding(sev, "citation", rel, f"cannot read {file_part}: {exc}")]

    if anchor not in content:
        where = target.relative_to(REPO_ROOT).as_posix()
        return [Finding(sev, "citation", rel, f"anchor '{anchor}' no longer appears in {where}")]
    return []


def check_file(path: Path, existing_adrs: set[str]) -> list[Finding]:
    """Every failing check, for one file."""
    rel = path.relative_to(REPO_ROOT).as_posix()
    sev = severity_for(path)
    is_markdown = path.suffix == ".md"
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return [Finding("fail", "unreadable", rel, str(exc))]
    body = strip_fences(raw) if is_markdown else comments_only(raw, path.suffix)

    found: list[Finding] = []

    for number in sorted(set(ADR_RE.findall(body))):
        if number not in existing_adrs:
            found.append(Finding(sev, "adr", rel, f"ADR-{number} resolves to no file in docs/_decisions/"))

    for citation in sorted(set(CITATION_RE.findall(body))):
        if not is_placeholder(citation):
            found.extend(_check_citation(citation, rel, sev))

    # P6 bans line-number citations outright. Nothing else can detect one: it stays syntactically
    # valid and merely stops pointing at what it names, so it has to be caught at the form.
    for citation in sorted(set(LINE_CITATION_RE.findall(body))):
        if is_placeholder(citation):
            continue
        found.append(
            Finding(sev, "line-citation", rel, f"line-number citation `{citation}` -- anchor it to a symbol (P6)")
        )

    # Links, anchors and bare backticked paths are markdown conventions; a comment does not use them.
    if not is_markdown:
        return found

    anchors = heading_anchors(body)
    for raw_target in sorted(set(LINK_RE.findall(body))):
        if raw_target.startswith(("http://", "https://", "mailto:")) or is_placeholder(raw_target):
            continue
        if raw_target.startswith("#"):
            if raw_target[1:] not in anchors:
                found.append(Finding(sev, "anchor", rel, f"no heading in this file yields {raw_target}"))
            continue
        if not (path.parent / raw_target).resolve().exists():
            found.append(Finding(sev, "link", rel, f"link target does not exist: {raw_target}"))

    for token in sorted(set(BACKTICK_RE.findall(body))):
        # A line-number citation is already reported above; it can never exist as a path, so letting
        # the path check fire too would give one defect two findings.
        if " :: " in token or is_placeholder(token) or not token.startswith(REPO_PREFIXES):
            continue
        if LINE_CITATION_RE.fullmatch(f"`{token}`"):
            continue
        if not (REPO_ROOT / token).exists() and not is_gitignored(token):
            found.append(Finding(sev, "path", rel, f"path named but not present: {token}"))

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
    """A `Verified against` SHA must be a real ancestor of HEAD, and what it cites may have moved.

    Drift is measured against the files the page CITES, never against the page itself: editing a page
    is not evidence its claims went stale, and counting it as such would make every documentation
    commit report drift on the file it just corrected.
    """
    found: list[Finding] = []
    for path in paths:
        rel = path.relative_to(REPO_ROOT).as_posix()
        sev = severity_for(path)
        try:
            raw = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        body = strip_fences(raw)
        match = STAMP_RE.search(body)
        if match is None:
            continue
        sha = match.group(1)

        if git("cat-file", "-e", f"{sha}^{{commit}}") is None:
            # A shallow clone genuinely does not have the object. Report rather than fail on it.
            found.append(Finding("report", "stamp", rel, f"commit {sha} is not in this clone"))
            continue

        is_ancestor = subprocess.run(
            ("git", "merge-base", "--is-ancestor", sha, "HEAD"),
            cwd=REPO_ROOT, capture_output=True, check=False,
        ).returncode
        if is_ancestor != 0:
            found.append(Finding(sev, "stamp", rel, f"commit {sha} is not an ancestor of HEAD"))
            continue

        cited = sorted(cited_paths(body))
        if not cited:
            continue
        moved = git("log", "--oneline", f"{sha}..HEAD", "--", *cited)
        if moved:
            count = len(moved.split("\n"))
            if count > DRIFT_FAIL_AFTER:
                found.append(
                    Finding(
                        sev, "drift", rel,
                        f"{count} commits have touched files this page cites since its stamp "
                        f"(limit {DRIFT_FAIL_AFTER}) -- re-verify the page against the code, then restamp",
                    )
                )
            else:
                found.append(
                    Finding(
                        "report", "drift", rel,
                        f"{count} commit(s) touched files this page cites since its stamp -- re-verify",
                    )
                )
    return found


def check_stamp_freshness(base: str) -> list[Finding]:
    """A stamped page changed on this branch must also change its stamp.

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
        except (OSError, UnicodeDecodeError):
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
                    severity_for(path), "stamp", rel,
                    "changed on this branch without its `Verified against` line moving -- "
                    "restamp it, or say why the page still holds",
                )
            )
    return found


def check_history_phrases(base: str) -> list[Finding]:
    """DS14's banned shapes, over the branch diff. Always a report: the hits must be read."""
    diff = git("diff", f"{base}...HEAD", "-U0", "--", "*.md")
    if not diff:
        return []
    pattern = re.compile("|".join(re.escape(p) for p in HISTORY_PHRASES), re.IGNORECASE)
    hits = [
        line[1:].strip()
        for line in diff.split("\n")
        if line.startswith("+") and not line.startswith("+++") and pattern.search(line)
    ]
    if not hits:
        return []
    return [
        Finding("report", "history", "(branch diff)", f"{len(hits)} added line(s) match a DS14 phrase -- read them")
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="Documentation currency gate (docs/_standard/5-currency.md).")
    parser.add_argument("--all", action="store_true", help="list every finding, not just enforced ones")
    parser.add_argument("--base", default="main", help="base ref for the history-phrase diff (default: main)")
    args = parser.parse_args()

    files = tracked_files()
    if not files:
        print("  no files found -- nothing to check", file=sys.stderr)
        return 0

    existing = adr_numbers()
    findings: list[Finding] = []
    for path in files:
        findings.extend(check_file(path, existing))
    findings.extend(check_stamps(files))
    findings.extend(check_stamp_freshness(args.base))
    findings.extend(check_history_phrases(args.base))

    failures = [f for f in findings if f.severity == "fail"]
    reports = [f for f in findings if f.severity == "report"]

    if failures:
        print(f"\n  {len(failures)} failing finding(s) in enforced paths ({', '.join(ENFORCED_PATHS)}):")
        for finding in failures:
            print(finding.line())

    if reports:
        print(f"\n  {len(reports)} finding(s) outside enforced paths, or advisory:")
        for finding in reports if args.all else reports[:10]:
            print(finding.line())
        if not args.all and len(reports) > 10:
            print(f"  ... and {len(reports) - 10} more -- run with --all to see them")

    docs = sum(1 for f in files if f.suffix == ".md")
    print(f"\n  scanned {docs} documents and {len(files) - docs} source files against {len(existing)} ADRs")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
