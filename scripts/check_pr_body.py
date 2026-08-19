"""
SCRIPTS · the pull request body gate

Reads one body on stdin or from a file and holds it to the form in
docs/_git/templates.md. A body is not in the repository and does not exist before
the pull request does, so this cannot run in verify.sh — .github/workflows/pr-body.yml is the
one place it is addressable, and it listens for `edited` so a corrected body turns green without
a push.

Invariants:
- A section is matched by name, bold optional: the merged corpus writes a bare `Verified.`, and
  failing it would be the check that cries wolf (CUR-5). `Reviewer's first look` is in the set
  because it is a heading of the same form — a body line opening with it ends the summary.
- Verified is the one section never legitimately dropped; every other heading is unchecked.
- Three or more consecutive list items carrying commit hashes fail — a body never indexes its commits.
- The summary has a reported target and a hard maximum, the report-then-fail shape check_commits.py
  uses; the numbers are at `SUMMARY_TARGET` and `SUMMARY_MAX`.
- Dependabot bodies are skipped entirely — the bot writes its own.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Final

from checker_kernel import EXIT_OK, Finding, report_findings, run

SUMMARY_TARGET: Final = 200  # reported: past a generous reading of "one or two paragraphs"
SUMMARY_MAX: Final = 500  # failed: past any reading of it

# The login GitHub reports as the pull request's author, matched whole. The commit half of the same
# exemption is `check_commits.py :: BOT_IDENTITIES` (COR-2).
BOT_AUTHORS: Final[frozenset[str]] = frozenset({"dependabot[bot]"})

# Verbatim fragments of the form in `docs/_git/templates.md :: Pull requests`: their presence means
# it was pasted rather than filled in. Reword one and this check stops firing, which
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
    r"^\**(?:Verified|Decisions taken|Left undone|Reviewer'?s first look)\b",
    re.MULTILINE | re.IGNORECASE,
)

VERIFIED_HEADING: Final = re.compile(r"^\**Verified\b", re.MULTILINE | re.IGNORECASE)

COMMIT_LIST_ITEM: Final = re.compile(r"^\s*(?:[-*+]|\d+\.)\s+`?[0-9a-f]{7,40}`?\b")


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

    # Not `run`: this module imports a callable under that name, and the next edit reaching for it
    # here would get an integer instead.
    hashes = longest_commit_run(body)
    if hashes >= 3:
        findings.append(
            Finding(
                "fail",
                f"{hashes} consecutive list items carry a commit hash -- a body summarises the branch, it never indexes its commits",
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
    parser = argparse.ArgumentParser(description="Pull request body gate.")
    parser.add_argument("body", help="path to a file holding the body, or - for stdin")
    parser.add_argument("--author", default="", help="the pull request author's login; bots are skipped")
    args = parser.parse_args()

    body = sys.stdin.read() if args.body == "-" else Path(args.body).read_text(encoding="utf-8")

    # stderr for every severity: the workflow step's log is the only reader, and a body that fails
    # should say so where a failed step is looked for.
    code = report_findings(check_body(body, args.author), indent=2, stream=sys.stderr)
    if code != EXIT_OK:
        print("\n  The form is docs/_git/templates.md, Pull requests.", file=sys.stderr)
        print("  Edit the body in place -- `gh pr edit <n> --body-file <path>` keeps the number and the URL.\n", file=sys.stderr)
        return code

    print("  the body follows the form")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
