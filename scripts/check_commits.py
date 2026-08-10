"""
SCRIPTS · the commit message gate

Run by verify.sh inside the docs scope, for the reason `docs/ops/spec.md` §1.6 gives. A check that
cannot be decided without reading the change reports rather than refuses (CUR-5) — the split is what
keeps a check that would fail half of a deliberate style from being switched off.

Invariants:
- Only the branch's commits are read — base..HEAD, never history, which predates the convention.
- Merge commits are skipped: GitHub writes those, and the merge button fixes their subject.
- Length is two tiers, a reported target and a hard maximum — `SUBJECT_TARGET` and `LINE_MAX`.
- A trailer is refused by name in `BANNED` and by shape in `trailer_block`, which reads the closing
  paragraph the way git does.

See:
- docs/_git/templates.md — the form a message is written to
- docs/_git/spec.md — the hook's install line, and what reports rather than refuses
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final

REPO_ROOT: Final = Path(__file__).resolve().parent.parent

SUBJECT_TARGET: Final = 72  # reported: where GitHub truncates a title in a list view
LINE_MAX: Final = 100  # failed: past here nothing wrapped the line at all

# The shape, enforced. A capitalised scope, a colon, a space, then something. The scope may carry a
# space or a `+` because "Backend + Frontend" and "Backend deps" are both real and both correct.
SUBJECT_SHAPE: Final = re.compile(r"^[A-Z][A-Za-z0-9+ ]{0,30}: \S")

# The vocabulary, reported only. The areas a subject leads with, plus the ones Dependabot writes. A
# new area is a reason to add a row, not a reason to fail a run.
KNOWN_SCOPES: Final[frozenset[str]] = frozenset(
    {
        "Frontend",
        "Backend",
        "Ops",
        "Docs",
        "Repo",
        "CI",
        "Database",
        "Roadmap",
        "Frontend deps",
        "Backend deps",
    }
)

# Banned outright: a trailer, an issue-closing keyword, an AI-authorship signature. The first two are
# the convention (`docs/_git/templates.md :: Commit messages`); the third is
# CLAUDE.md §2, the one a tool default adds on its own.
BANNED: Final[tuple[tuple[re.Pattern[str], str], ...]] = (
    (re.compile(r"^\s*Co-authored-by:", re.IGNORECASE | re.MULTILINE), "a Co-authored-by trailer"),
    (re.compile(r"^\s*Signed-off-by:", re.IGNORECASE | re.MULTILINE), "a Signed-off-by trailer"),
    (re.compile(r"Generated with|Co-Authored-By: Claude|Claude Code", re.IGNORECASE), "an AI-authorship signature"),
    (re.compile(r"\b(clos(e|es|ed)|fix(es|ed)?|resolv(e|es|ed))\s+#\d+", re.IGNORECASE), "an issue-closing keyword"),
)

# `BANNED` names the two trailers a tool inserts; the convention refuses every trailer, so any other
# one merges clean. A trailer is read in the message's LAST paragraph alone, which is where git
# reads one, and the paragraph has to be nothing else.
TRAILER_LINE_RE: Final = re.compile(r"^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*:[ \t]\S")
# The hyphen is what separates a trailer from a sentence. A body closing `Verified: ... exit 0.` is
# one paragraph of prose in this repository's own history, and failing that spelling is the false
# positive that gets the check switched off.
HYPHENATED_TRAILER_RE: Final = re.compile(r"^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+:[ \t]\S")

# Emoji and pictographs. Ranges rather than a library, because CI runs this on a bare runner with no
# virtualenv at all, so it imports nothing outside the standard library.
EMOJI: Final = re.compile(
    "[\U0001f000-\U0001faff☀-➿⬀-⯿️]",
)

# A line that is one long unbroken token is a URL or a path, and wrapping it would break it.
UNWRAPPABLE: Final = re.compile(r"^\S+$|https?://\S{40,}")

VERIFIED_HINT: Final = re.compile(r"\bverif\w+|\bexit 0\b|\bchecked\b|\bran\b", re.IGNORECASE)


@dataclass(frozen=True)
class Finding:
    severity: str  # "fail" | "report"
    sha: str
    subject: str
    detail: str

    def line(self) -> str:
        return f"      {self.sha}  {self.detail}\n                 subject: {self.subject[:80]}"


def git(*args: str) -> str | None:
    result = subprocess.run(["git", *args], cwd=REPO_ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return result.stdout.strip() if result.returncode == 0 else None


def resolve_base(base: str) -> str:
    """CI checks out a detached head with no local branch for the base, only its remote-tracking ref."""
    if git("rev-parse", "--verify", base) is not None:
        return base
    if git("rev-parse", "--verify", f"origin/{base}") is not None:
        return f"origin/{base}"
    return base


def branch_commits(base: str) -> list[str]:
    # --no-merges drops the merge commits GitHub writes; their subject is not ours to choose.
    out = git("rev-list", "--no-merges", f"{base}..HEAD")
    return out.split() if out else []


def trailer_block(message: str) -> list[str]:
    """The message's closing paragraph where that paragraph is a run of trailers, else nothing.

    A subject alone is never one: git needs a paragraph below the subject before it reads trailers
    at all, so a one-paragraph message returns nothing however its line is spelt.
    """
    paragraphs = [block for block in re.split(r"\n[ \t]*\n", message.strip()) if block.strip()]
    if len(paragraphs) < 2:
        return []
    lines = [line for line in paragraphs[-1].split("\n") if line.strip()]
    if not all(TRAILER_LINE_RE.match(line) for line in lines):
        return []
    return lines if any(HYPHENATED_TRAILER_RE.match(line) for line in lines) else []


def check_message(message: str, short: str) -> list[Finding]:
    lines = message.rstrip("\n").split("\n")
    subject = lines[0]
    findings: list[Finding] = []

    def fail(detail: str) -> None:
        findings.append(Finding("fail", short, subject, detail))

    def report(detail: str) -> None:
        findings.append(Finding("report", short, subject, detail))

    # Generated by git, not by an author: a revert's subject and a merge's are both fixed for us.
    if subject.startswith('Revert "') or subject.startswith("Merge "):
        return []

    if not SUBJECT_SHAPE.match(subject):
        fail("subject is not `Scope: what changed`")
    elif subject.split(":", 1)[0] not in KNOWN_SCOPES:
        report(f"scope `{subject.split(':', 1)[0]}` is not in the recorded vocabulary")

    if len(subject) > LINE_MAX:
        fail(f"subject is {len(subject)} characters - unreadable in every view, not just truncated")
    elif len(subject) > SUBJECT_TARGET:
        report(f"subject is {len(subject)} characters; GitHub truncates a title at {SUBJECT_TARGET}")

    if subject.endswith("."):
        fail("subject ends in a period")

    if len(lines) > 1 and lines[1].strip():
        fail("line 2 is not blank, so git reads the whole message as one subject")

    body = "\n".join(lines[2:]).strip()
    if not body:
        fail("no body - a one-line commit records nothing the diff does not already show")
    else:
        for raw in lines[2:]:
            if len(raw) > LINE_MAX and not UNWRAPPABLE.search(raw.strip()):
                fail(f"a body line is {len(raw)} characters - the paragraph was never wrapped")
                break
        if not VERIFIED_HINT.search(body):
            report("the body records no verification - what was run, and what it returned?")

    named = [what for pattern, what in BANNED if pattern.search(message)]
    for what in named:
        fail(f"the message carries {what}")
    # Only where none of the named patterns matched: a Co-authored-by line is both, and reporting
    # one message twice reads as a gate that cannot say what is wrong.
    if not named and (tokens := [line.split(":", 1)[0] for line in trailer_block(message)]):
        fail(f"the message ends in a trailer block ({', '.join(tokens)}) - the convention carries no trailers")

    if EMOJI.search(message):
        fail("the message carries an emoji")

    return findings


def check_commit(sha: str) -> list[Finding]:
    message = git("show", "-s", "--format=%B", sha)
    return [] if message is None else check_message(message, sha[:7])


def check_message_file(path: Path) -> int:
    """The commit-msg hook's entry point: one message, not yet a commit.

    Comment lines are dropped first. Git strips them only AFTER this hook runs, so an editor-written
    message still carries the whole "# Please enter the commit message" block at this point.
    """
    raw = path.read_text(encoding="utf-8", errors="replace")
    message = "\n".join(line for line in raw.split("\n") if not line.startswith("#"))
    findings = [f for f in check_message(message, "pending") if f.severity == "fail"]
    if not findings:
        return 0
    print(f"\n  Commit refused: {len(findings)} problem(s) with the message.", file=sys.stderr)
    for finding in findings:
        print(f"    - {finding.detail}", file=sys.stderr)
    print("\n  The form is docs/_git/templates.md. Your message is kept in", file=sys.stderr)
    print(f"  {path} -- reuse it with:  git commit -F {path}\n", file=sys.stderr)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Commit message gate (docs/_git/templates.md).")
    parser.add_argument("--base", default="main", help="base ref for the branch range (default: main)")
    parser.add_argument("--message-file", type=Path, help="check one unwritten message; used by the commit-msg hook")
    args = parser.parse_args()

    if args.message_file:
        return check_message_file(args.message_file)

    base = resolve_base(args.base)
    commits = branch_commits(base)
    if not commits:
        print(f"      no commits on this branch against {base} -- nothing to check")
        return 0

    findings: list[Finding] = []
    for sha in commits:
        findings.extend(check_commit(sha))

    failures = [f for f in findings if f.severity == "fail"]
    reports = [f for f in findings if f.severity == "report"]

    if failures:
        print(f"\n      {len(failures)} failing finding(s) across {len(commits)} commit(s):")
        for finding in failures:
            print(finding.line())
        print("\n      Reword with:  git rebase -i " + base + "   (or git commit --amend for the tip)")

    if reports:
        print(f"\n      {len(reports)} advisory finding(s):")
        for finding in reports:
            print(finding.line())

    print(f"\n      checked {len(commits)} commit message(s) against {base}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
