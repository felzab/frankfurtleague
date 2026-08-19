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
- The bot exemption drops three rules, the sign-off one by name and by shape, on an exact identity.

See:
- docs/_git/templates.md — the form a message is written to
- docs/_git/spec.md — the hook's install line, what reports rather than refuses, and the carve-out
- scripts/checker_kernel.py — git, the base, and the exit code this answers with
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from checker_kernel import DEFAULT_BASE, EXIT_FINDINGS, EXIT_OK, EXIT_REFUSED, Finding, exit_code, failures, git, reports, resolve_base, run

SUBJECT_TARGET: Final = 72  # reported: where GitHub truncates a title in a list view
LINE_MAX: Final = 100  # failed: past here nothing wrapped the line at all

# The shape, enforced. A capitalised scope, a colon, a space, then something. The scope may carry a
# space or a `+` because "Backend + Frontend" and "Backend deps" are both real and both correct.
SUBJECT_SHAPE: Final = re.compile(r"^[A-Z][A-Za-z0-9+ ]{0,30}: \S")

# The vocabulary, reported only. The areas a subject leads with, and every prefix
# `.github/dependabot.yml` sets, one per update entry. A new area is a reason to add a row, not a
# reason to fail a run.
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
        "Frontend image",
        "Backend image",
    }
)

# The shape a tool emits, not the words in it: a line opening `Generated with` plus a linked product
# name, never "the icons are generated with scripts/...". Its trailer half is `BANNED`'s first entry.

# The leading run absorbs an indent, a quote marker and the robot emoji together -- eight, because
# four spaces plus that emoji plus its space is six and the signature is the same signature.
AI_SIGNATURE: Final = re.compile(
    r"^[^\w\n]{0,8}Generated with (?:\[?Claude Code\b|\[[^\]\n]{1,60}\]\(https?://)",
    re.IGNORECASE | re.MULTILINE,
)

# `Reapply` is what reverting a revert writes since git 2.44, and both forms leave the body line
# below -- the evidence, where a subject alone is ten typed characters. A merge needs neither:
# --no-merges covers the gate, MERGE_HEAD the hook.
GENERATED_SUBJECT: Final = re.compile(r'^(?:Revert|Reapply) ".+"$')
# git closes the sentence with a period for an ordinary commit and with ", reversing" for a merge.
# Every change here reaches main through a merge commit, so reverting one is routine and both
# endings are the marker.
GENERATED_BODY: Final = re.compile(r"^This reverts commit [0-9a-f]{7,40}[.,]", re.MULTILINE)

# Banned outright: a trailer, an issue-closing keyword, an AI-authorship signature. The first two are
# the convention (`docs/_git/templates.md :: Commit messages`); the third is
# CLAUDE.md §2, the one a tool default adds on its own.

# The trailing flag is whether the rule still binds a commit the bot exemption has released. Only the
# sign-off is dropped, because only the sign-off is something dependabot's generator cannot leave out.
BANNED: Final[tuple[tuple[re.Pattern[str], str, bool], ...]] = (
    (re.compile(r"^\s*Co-authored-by:", re.IGNORECASE | re.MULTILINE), "a Co-authored-by trailer", True),
    (re.compile(r"^\s*Signed-off-by:", re.IGNORECASE | re.MULTILINE), "a Signed-off-by trailer", False),
    (AI_SIGNATURE, "an AI-authorship signature", True),
    (re.compile(r"\b(clos(e|es|ed)|fix(es|ed)?|resolv(e|es|ed))\s+#\d+", re.IGNORECASE), "an issue-closing keyword", True),
)

# Read from the commit and matched whole: `dependabot[bot]` alone would release anyone who typed it
# into `user.name`, and half an address would release a domain. The pull request half is
# `check_pr_body.py :: BOT_AUTHORS` (COR-2).
BOT_IDENTITIES: Final[frozenset[tuple[str, str]]] = frozenset(
    {
        ("dependabot[bot]", "49699333+dependabot[bot]@users.noreply.github.com"),
    }
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
class CommitFinding(Finding):
    """A finding against one commit, which has to name it: a branch's messages are refused together."""

    sha: str
    subject: str

    def line(self) -> str:
        return f"      {self.sha}  {self.detail}\n                 subject: {self.subject[:80]}"


def git_is_composing() -> bool:
    """Whether git wrote the message the hook is about to check, rather than a person.

    Asked of git's own state rather than of the subject's first word: a merge or a revert in progress
    leaves the ref behind, while `Merge ` at the front of a subject is six characters anyone can type.
    """
    return any(git("rev-parse", "--verify", "--quiet", ref) is not None for ref in ("MERGE_HEAD", "REVERT_HEAD"))


def comment_char() -> str:
    """git's own comment marker, which `core.commentChar` may move off `#`.

    `auto` picks per message out of a candidate list and cannot be resolved from here, so it reads as
    the default -- the same answer as an unset key, and the right one for all but a contrived tree.
    """
    configured = git("config", "--get", "core.commentChar")
    return configured if configured is not None and len(configured) == 1 else "#"


def branch_commits(base: str) -> list[str] | None:
    """The branch's non-merge commits, or None where git could not list them.

    None is not an empty list: no commit is a branch with nothing on it, while a refused listing is
    every message passing unread.
    """
    # --no-merges drops the merge commits GitHub writes; their subject is not ours to choose.
    out = git("rev-list", "--no-merges", f"{base}..HEAD")
    return None if out is None else out.split()


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


def check_message(message: str, short: str, *, is_bot: bool = False) -> list[CommitFinding]:
    """Every rule against one message; `is_bot` drops the three a bot's generator cannot satisfy.

    Dependabot writes an unwrapped first body line, signs off, and records no verification, none of
    which `.github/dependabot.yml` can configure -- so every update pull request arrived red and the
    programme that file exists for was dead. Those three go and nothing else does: the subject's
    shape, the emoji ban, the AI-signature ban, every other trailer and the scope vocabulary all
    still answer for a bot, which is what stops the exemption becoming a way past the convention.
    """
    lines = message.rstrip("\n").split("\n")
    subject = lines[0]
    findings: list[CommitFinding] = []

    def fail(detail: str) -> None:
        findings.append(CommitFinding("fail", detail, short, subject))

    def report(detail: str) -> None:
        findings.append(CommitFinding("report", detail, short, subject))

    # git writes a revert's subject and this repository does not choose it, so its shape and length
    # go and nothing else does: the marker is typed in seconds, and releasing the whole message
    # would hand the emoji, trailer and signature bans to anyone.
    generated = bool(GENERATED_SUBJECT.match(subject) and GENERATED_BODY.search(message))

    if not generated:
        if not SUBJECT_SHAPE.match(subject):
            fail("subject is not `Scope: what changed`")
        elif subject.split(":", 1)[0] not in KNOWN_SCOPES:
            report(f"scope `{subject.split(':', 1)[0]}` is not in the recorded vocabulary")

        if len(subject) > LINE_MAX:
            fail(f"subject is {len(subject)} characters - unreadable in every view, not just truncated")
        elif len(subject) > SUBJECT_TARGET:
            report(f"subject is {len(subject)} characters; GitHub truncates a title at {SUBJECT_TARGET}")

    # Kept on a revert too: `Revert "..."` closes on a quote, so this costs a generated subject
    # nothing.
    if subject.endswith("."):
        fail("subject ends in a period")

    if len(lines) > 1 and lines[1].strip():
        fail("line 2 is not blank, so git reads the whole message as one subject")

    body = "\n".join(lines[2:]).strip()
    if not body:
        fail("no body - a one-line commit records nothing the diff does not already show")
    # A generated revert body takes the release the bot gets: it is one line git wrote, so it records
    # no verification and is not wrapped prose.
    elif not (is_bot or generated):
        for raw in lines[2:]:
            if len(raw) > LINE_MAX and not UNWRAPPABLE.search(raw.strip()):
                fail(f"a body line is {len(raw)} characters - the paragraph was never wrapped")
                break
        if not VERIFIED_HINT.search(body):
            report("the body records no verification - what was run, and what it returned?")

    named = [what for pattern, what, binds_a_bot in BANNED if (binds_a_bot or not is_bot) and pattern.search(message)]
    for what in named:
        fail(f"the message carries {what}")
    # Only where none of the named patterns matched: a Co-authored-by line is both, and reporting
    # one message twice reads as a gate that cannot say what is wrong.
    if not named and (tokens := [line.split(":", 1)[0] for line in trailer_block(message)]):
        # The shape half of the rule the exemption drops, and no wider: a bot's message structurally
        # ends in its sign-off, while any other trailer is still refused whoever wrote it.
        if not (is_bot and all(token.lower() == "signed-off-by" for token in tokens)):
            fail(f"the message ends in a trailer block ({', '.join(tokens)}) - the convention carries no trailers")

    if EMOJI.search(message):
        fail("the message carries an emoji")

    return findings


def check_commit(sha: str) -> list[CommitFinding]:
    """One commit's author and message from one `git show`: every commit on the branch pays this."""
    raw = git("show", "-s", "--format=%an%n%ae%n%B", sha)
    if raw is None:
        # Failed rather than skipped: `rev-list` named this commit, so a `git show` that will not
        # answer is a broken object, and a message nothing read is indistinguishable from a clean one.
        return [CommitFinding("fail", "git could not read this commit, so its message was never judged", sha[:7], "(unread)")]
    # git forbids a newline in either ident field, so the first two lines are the identity whatever
    # the message below them looks like.
    name, _, rest = raw.partition("\n")
    email, _, message = rest.partition("\n")
    return check_message(message, sha[:7], is_bot=(name, email) in BOT_IDENTITIES)


def check_message_file(path: Path) -> int:
    """The commit-msg hook's entry point: one message, not yet a commit.

    Comment lines are dropped first. Git strips them only AFTER this hook runs, so an editor-written
    message still carries the whole "# Please enter the commit message" block at this point.

    The exemption is never granted here. This path runs on the machine writing the commit, where the
    author field is whatever the author set it to, and a bot does not run this repository's hooks.
    """
    if git_is_composing():
        return EXIT_OK
    marker = comment_char()
    raw = path.read_text(encoding="utf-8", errors="replace")
    message = "\n".join(line for line in raw.split("\n") if not line.startswith(marker))
    findings = failures(check_message(message, "pending"))
    if not findings:
        return EXIT_OK
    print(f"\n  Commit refused: {len(findings)} problem(s) with the message.", file=sys.stderr)
    for finding in findings:
        print(f"    - {finding.detail}", file=sys.stderr)
    print("\n  The form is docs/_git/templates.md. Your message is kept in", file=sys.stderr)
    print(f"  {path} -- reuse it with:  git commit -F {path}\n", file=sys.stderr)
    return EXIT_FINDINGS


def main() -> int:
    parser = argparse.ArgumentParser(description="Commit message gate (docs/_git/templates.md).")
    parser.add_argument("--base", default=DEFAULT_BASE, help=f"base ref for the branch range (default: {DEFAULT_BASE})")
    parser.add_argument("--message-file", type=Path, help="check one unwritten message; used by the commit-msg hook")
    args = parser.parse_args()

    if args.message_file:
        return check_message_file(args.message_file)

    base = resolve_base(args.base)
    if base is None:
        # Refused, not green: every commit this reads is named by the base, so with none
        # it judged nothing. `--message-file` returns above and never reaches here, which keeps the
        # commit-msg hook working on a clone that has no base ref.
        print(f"      nothing here is named {args.base} or origin/{args.base} -- no commit message was checked.")
        print(f"      A single-branch clone fetches no base. Add it:  git remote set-branches --add origin {args.base}")
        print(f"                                                      git fetch origin {args.base}")
        return EXIT_REFUSED

    commits = branch_commits(base)
    if commits is None:
        # Refused, not green: the range is what names every message this reads, so a
        # listing git would not give is the whole branch passing unread.
        print(f"      git could not list this branch's commits against {base[:7]} -- none was checked.")
        return EXIT_REFUSED
    if not commits:
        print(f"      no commits on this branch against {base[:7]} -- nothing to check")
        return EXIT_OK

    findings: list[CommitFinding] = []
    for sha in commits:
        findings.extend(check_commit(sha))

    failed, advisory = failures(findings), reports(findings)

    if failed:
        print(f"\n      {len(failed)} failing finding(s) across {len(commits)} commit(s):")
        for finding in failed:
            print(finding.line())
        # The derived base rather than the ref it came from: on a branch stacked on another branch,
        # `git rebase -i main` would rewrite the commits below this one as well.
        print("\n      Reword with:  git rebase -i " + base[:7] + "   (or git commit --amend for the tip)")

    if advisory:
        print(f"\n      {len(advisory)} advisory finding(s):")
        for finding in advisory:
            print(finding.line())

    print(f"\n      checked {len(commits)} commit message(s) against {base[:7]}")
    return exit_code(findings)


if __name__ == "__main__":
    sys.exit(run(main))
