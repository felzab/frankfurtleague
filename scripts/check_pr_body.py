"""
scripts/check_pr_body.py - the pull request body gate.

Reads one body on stdin or from a file and holds it to ADR-0036 and the form in
docs/workflows/message-templates.md. Run by .github/workflows/pr-body.yml on every pull request,
and by hand against an open one:

    gh pr view 48 --json body -q .body | python scripts/check_pr_body.py -

 WHY THIS IS NOT PART OF verify.sh -----------------------------------------------------------------

 A pull request body is not in the repository. There is nothing to check before the pull request
 exists, so the pre-push gate cannot see it and this runs only in CI - the one place the body is
 addressable. It is also why the workflow listens for `edited`: a body corrected after review has to
 be able to turn the check green without an unrelated push.

 WHAT IT CHECKS ------------------------------------------------------------------------------------

  Failing, because each is objectively true or false without reading the branch:
    1. the body is not empty, and is not the template with its placeholder prose still in it
    2. it carries a Verified paragraph, bolded or not - every pull request here runs the gate, so
       this is the one section that is never legitimately dropped
    3. it does not index its commits: three or more list items each carrying a commit hash is the
       shape ADR-0036 exists to refuse, because GitHub's Commits tab already renders it
    4. the summary above the first heading is under 500 words

  Reporting, because the boundary needs judgment:
    5. the summary above the first heading runs past 200 words

 The other three headings - Decisions taken, Left undone, Governed by - are deliberately unchecked.
 The form says to drop a heading rather than pad it, so their absence is usually correct and a check
 would manufacture exactly the empty sections it warns against.

 WHY 200 AND 500 -----------------------------------------------------------------------------------

 The form asks for one orientation sentence plus one or two paragraphs. 200 words is a generous
 reading of that and 500 is past any reading of it: the body that prompted this check ran to 509
 words of summary, restating in prose what its own commits already said. Same split as
 check_commits.py, and for the same reason - a check that fails half of a legitimate style gets
 suppressed.

 Dependabot's pull requests are skipped entirely. The bot writes its own bodies and the form does
 not reach them.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final

SUMMARY_TARGET: Final = 200  # reported: past a generous reading of "one or two paragraphs"
SUMMARY_MAX: Final = 500  # failed: past any reading of it

BOT_AUTHORS: Final[frozenset[str]] = frozenset({"dependabot[bot]", "dependabot-preview[bot]"})

# Verbatim fragments of .github/PULL_REQUEST_TEMPLATE.md. Their presence means the template was
# submitted rather than filled in, which is the one failure a reader cannot mistake for a style.
TEMPLATE_FRAGMENTS: Final[tuple[str, ...]] = (
    "One orientation sentence, for a multi-commit PR only",
    "What the branch achieves as a whole, at a level the individual commits do not",
    "The form lives in docs/workflows/message-templates.md",
    "The `./scripts/verify.sh` invocation — its scopes and its exit code",
)

# The form's sections, anchored by name rather than by typography. Bold is OPTIONAL on purpose: the
# template writes `**Verified.**` while most of the merged corpus writes a bare `Verified.`, and the
# difference is two asterisks rather than anything a reader loses. Requiring the bold form failed 27
# of 44 merged bodies including several of the best — a check that cries wolf gets suppressed
# (docs/_standard/5-currency.md), and what the form asks for is that the section be there at all.
#
# Named alternation rather than a general "bolded phrase" pattern: a paragraph opening "Rankings.
# Twenty-eight entries ..." is prose, and a looser rule would read it as a heading and cut the
# measured summary short — silently, and in the direction that hides a finding.
SECTION_LEAD: Final = re.compile(
    r"^\**(?:Verified|Decisions taken|Left undone|Governed by|Reviewer'?s first look)\b",
    re.MULTILINE | re.IGNORECASE,
)

VERIFIED_HEADING: Final = re.compile(r"^\**Verified\b", re.MULTILINE | re.IGNORECASE)

# A list item carrying a commit hash: "- abc1234 ...", "* `abc1234` — ...", "1. abc1234 ...".
COMMIT_LIST_ITEM: Final = re.compile(r"^\s*(?:[-*+]|\d+\.)\s+`?[0-9a-f]{7,40}`?\b")


@dataclass(frozen=True)
class Finding:
    severity: str  # "fail" | "report"
    detail: str


def summary_of(body: str) -> str:
    """Everything above the first of the form's named sections — what the form calls the summary."""
    match = SECTION_LEAD.search(body)
    return body[: match.start()] if match else body


def longest_commit_run(body: str) -> int:
    longest = current = 0
    for line in body.split("\n"):
        if COMMIT_LIST_ITEM.match(line):
            current += 1
            longest = max(longest, current)
        elif line.strip():
            current = 0
    return longest


def check_body(body: str, author: str = "") -> list[Finding]:
    if author in BOT_AUTHORS:
        return []

    findings: list[Finding] = []
    stripped = body.strip()

    if not stripped:
        return [Finding("fail", "the body is empty")]

    for fragment in TEMPLATE_FRAGMENTS:
        if fragment in body:
            findings.append(Finding("fail", "the template's own placeholder prose is still in the body -- fill it in"))
            break

    if not VERIFIED_HEADING.search(body):
        findings.append(Finding("fail", "no Verified paragraph -- name the gate invocation and its exit code (bold optional)"))

    run = longest_commit_run(body)
    if run >= 3:
        findings.append(
            Finding(
                "fail",
                f"{run} consecutive list items carry a commit hash -- a body summarises the branch, it never indexes its commits (ADR-0036)",
            )
        )

    words = len(summary_of(body).split())
    if words > SUMMARY_MAX:
        findings.append(
            Finding("fail", f"the summary above the first heading runs to {words} words, past any reading of 'one or two paragraphs'")
        )
    elif words > SUMMARY_TARGET:
        findings.append(
            Finding("report", f"the summary above the first heading runs to {words} words; the form asks for one or two paragraphs")
        )

    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Pull request body gate (ADR-0036).")
    parser.add_argument("body", help="path to a file holding the body, or - for stdin")
    parser.add_argument("--author", default="", help="the pull request author's login; bots are skipped")
    args = parser.parse_args()

    body = sys.stdin.read() if args.body == "-" else Path(args.body).read_text(encoding="utf-8")
    findings = check_body(body, args.author)

    failures = [f for f in findings if f.severity == "fail"]
    reports = [f for f in findings if f.severity == "report"]

    for finding in failures:
        print(f"  FAIL    {finding.detail}", file=sys.stderr)
    for finding in reports:
        print(f"  report  {finding.detail}", file=sys.stderr)

    if failures:
        print("\n  The form is docs/workflows/message-templates.md, Pull requests.", file=sys.stderr)
        print("  Edit the body in place -- `gh pr edit <n> --body-file <path>` keeps the number and the URL.\n", file=sys.stderr)
        return 1

    print("  the body follows the form")
    return 0


if __name__ == "__main__":
    sys.exit(main())
