"""
scripts/check_commits.py - the commit message gate.

Run by verify.sh inside the docs scope, because in this repository the commit bodies ARE
documentation: merges are never squashed precisely so they survive (docs/workflows/README.md,
Pull requests). The form they follow is docs/workflows/message-templates.md.

 WHAT IT LOOKS AT ----------------------------------------------------------------------------------

 Only the commits on this branch - base..HEAD, with base defaulting to main. Never history. The
 convention settled partway through this repository's life, and the commits before it read "WIP" and
 "Fixed bug"; holding them to the form would mean either a history rewrite or a permanently red gate.

 Merge commits are skipped. GitHub writes those and their subject is fixed by the merge button.

 WHAT IT CHECKS ------------------------------------------------------------------------------------

  Failing, because each destroys something the body exists to carry, and each is objectively true or
  false without reading the change:
    1. the subject is `Scope: what changed`, with no trailing period
    2. the second line is blank - without it, git treats the whole message as one subject
    3. a body exists at all: a one-line commit records nothing a diff does not already show
    4. no line runs past 100 characters, which means the wrap was never attempted
    5. no trailer, no issue-closing keyword, no emoji

  Reporting, because a hit is evidence rather than proof and a check that cries wolf gets ignored:
    6. the subject runs past 72 characters
    7. the scope is outside the recorded vocabulary - a genuinely new area is legitimate
    8. nothing in the body records what was verified

 WHY SUBJECT LENGTH REPORTS RATHER THAN FAILS ------------------------------------------------------

 72 is where GitHub truncates a commit title in a list view and where `git log --oneline` wraps an
 80-column terminal, so it is the right target. It is the wrong hard limit HERE: measured over the
 last eighty non-merge commits, thirty-eight run past it, because the two-clause subject joined by
 ", and" is idiomatic in this repository and documented as such in both workflow pages. A check that
 fails half of a deliberate style is a check that gets suppressed (docs/_standard/5-currency.md).

 So 72 reports and 100 fails. Past 100 a subject is unreadable in every view rather than truncated in
 one, which is a different thing from missing a target. The same threshold governs body lines, where
 the convention asks for ~76: the check is aimed at a paragraph nobody wrapped, never at a line that
 ran four characters over.
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

# The vocabulary, reported only. Every area that has ever legitimately led a subject here, plus the
# two Dependabot uses. A new area is a reason to add a row, not a reason to fail a run.
KNOWN_SCOPES: Final[frozenset[str]] = frozenset(
    {
        "Frontend",
        "Backend",
        "Ops",
        "Docs",
        "Repo",
        "Brand",
        "CI",
        "Database",
        "Roadmap",
        "Auditing",
        "Frontend deps",
        "Backend deps",
    }
)

# Banned outright: a trailer, an issue-closing keyword, an AI-authorship signature. The first two are
# the convention (docs/workflows/message-templates.md, The body); the third is CLAUDE.md section 2,
# and it is here because it is the one a tool default will add on its own.
BANNED: Final[tuple[tuple[re.Pattern[str], str], ...]] = (
    (re.compile(r"^\s*Co-authored-by:", re.I | re.M), "a Co-authored-by trailer"),
    (re.compile(r"^\s*Signed-off-by:", re.I | re.M), "a Signed-off-by trailer"),
    (re.compile(r"Generated with|Co-Authored-By: Claude|Claude Code", re.I), "an AI-authorship signature"),
    (re.compile(r"\b(clos(e|es|ed)|fix(es|ed)?|resolv(e|es|ed))\s+#\d+", re.I), "an issue-closing keyword"),
)

# Emoji and pictographs. Ranges rather than a library, because this script may not import anything
# the backend venv does not already have.
EMOJI: Final = re.compile(
    "[\U0001f000-\U0001faff☀-➿⬀-⯿️]",
)

# A line that is one long unbroken token is a URL or a path, and wrapping it would break it.
UNWRAPPABLE: Final = re.compile(r"^\S+$|https?://\S{40,}")

VERIFIED_HINT: Final = re.compile(r"\bverif\w+|\bexit 0\b|\bchecked\b|\bran\b", re.I)


@dataclass(frozen=True)
class Finding:
    severity: str  # "fail" | "report"
    sha: str
    subject: str
    detail: str

    def line(self) -> str:
        return f"      {self.sha}  {self.detail}\n                 subject: {self.subject[:80]}"


def git(*args: str) -> str | None:
    result = subprocess.run(
        ["git", *args], cwd=REPO_ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
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

    for pattern, what in BANNED:
        if pattern.search(message):
            fail(f"the message carries {what}")

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
    print("\n  The form is docs/workflows/message-templates.md. Your message is kept in", file=sys.stderr)
    print(f"  {path} -- reuse it with:  git commit -F {path}\n", file=sys.stderr)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Commit message gate (docs/workflows/message-templates.md).")
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
