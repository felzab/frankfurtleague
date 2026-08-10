"""
SCRIPTS · the pull request body gate

Reads one body on stdin or from a file and holds it to ADR-0029 and the form in
docs/_git/templates.md. A body is not in the repository and does not exist before
the pull request does, so this cannot run in verify.sh — .github/workflows/pr-body.yml is the
one place it is addressable, and it listens for `edited` so a corrected body turns green without
a push.

Invariants:
- A section is matched by name, bold optional: the merged corpus writes a bare `Verified.`, and
  failing it would be the check that cries wolf (CUR-5). `Reviewer's first look` is in the set
  because it is a heading of the same form — a body line opening with it ends the summary.
- Verified is the one section never legitimately dropped; the other three headings are unchecked.
- Three or more consecutive list items carrying commit hashes fail — the index ADR-0029 refuses.
- The summary has a reported target and a hard maximum, the report-then-fail shape check_commits.py
  uses; the numbers are at `SUMMARY_TARGET` and `SUMMARY_MAX`.
- Dependabot bodies are skipped entirely — the bot writes its own.
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

# Verbatim fragments of the form in `docs/_git/templates.md :: Pull requests`: their presence means
# it was pasted rather than filled in. Reword one and this refusal stops firing, which
# `check_docs.py :: check_template_fragments` catches.
TEMPLATE_FRAGMENTS: Final[tuple[str, ...]] = (
    "One orientation sentence, for a multi-commit PR only",
    "What the branch achieves as a whole, at a level the individual commits do not",
    "Anything where a person chose between real options, with the reasoning",
    "The `./scripts/verify.sh` invocation — its scopes and its exit code",
)

# Named alternation rather than a general "bolded phrase" pattern: the looser rule reads a
# paragraph opening "Rankings. Twenty-eight entries ..." as a heading, cutting the measured
# summary short in silence. Bold is optional; the header says why.
SECTION_LEAD: Final = re.compile(
    r"^\**(?:Verified|Decisions taken|Left undone|Governed by|Reviewer'?s first look)\b",
    re.MULTILINE | re.IGNORECASE,
)

VERIFIED_HEADING: Final = re.compile(r"^\**Verified\b", re.MULTILINE | re.IGNORECASE)

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
                f"{run} consecutive list items carry a commit hash -- a body summarises the branch, it never indexes its commits (ADR-0029)",
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
    parser = argparse.ArgumentParser(description="Pull request body gate (ADR-0029).")
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
        print("\n  The form is docs/_git/templates.md, Pull requests.", file=sys.stderr)
        print("  Edit the body in place -- `gh pr edit <n> --body-file <path>` keeps the number and the URL.\n", file=sys.stderr)
        return 1

    print("  the body follows the form")
    return 0


if __name__ == "__main__":
    sys.exit(main())
