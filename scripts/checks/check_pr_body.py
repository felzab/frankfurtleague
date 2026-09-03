"""SCRIPTS · the pull request body gate.

A body is not in the repository and postdates the pull request, so this cannot run in verify.sh;
`.github/workflows/pr-body.yml` listens for `edited` so a corrected body turns green without a
push. Verified is the one section never legitimately dropped.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Final

# `scripts/lib/` is a sibling of this directory, and a script's sys.path opens with this one.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import EXIT_OK, Finding, report_findings, run  # noqa: E402 -- the insert above is what resolves it

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
    "The `./scripts/gate/verify.sh` invocation — its scopes and its exit code",
)

# Named alternation, not a general "bolded phrase" rule: that reads a paragraph opening
# "Images. Both builds..." as a heading, cutting the measured summary short in silence. Bold is
# optional; the section is what this asks about, not its markup.
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

    # A census, never a verdict: a `SUMMARY_TARGET` finding prints above this and still exits 0, so
    # a line claiming the body follows the form would contradict the report the same run just made.
    print("  checked the body against docs/_git/templates.md")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
