"""SCRIPTS · the commit message gate.

A check needing the change itself to decide reports rather than refuses — a refusal that cries
wolf is one that gets switched off. Only base..HEAD is read; history predates the convention.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final

# Every caller runs this as a script, so sys.path opens with THIS directory and `lib/` is a
# sibling of it rather than in it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import (  # noqa: E402 -- the insert above is what resolves it
    DEFAULT_BASE,
    EXIT_FINDINGS,
    EXIT_OK,
    EXIT_REFUSED,
    Finding,
    exit_code,
    failures,
    git,
    reports,
    resolve_base,
    run,
)

SUBJECT_TARGET: Final = 72  # reported: where GitHub truncates a title in a list view
LINE_MAX: Final = 100  # failed: past here nothing wrapped the line at all

# The shape, enforced. A capitalised scope, a colon, a space, then something. The scope may carry a
# space or a `+` because "Backend + Frontend" and "Backend deps" are both real and both correct.
SUBJECT_SHAPE: Final = re.compile(r"^[A-Z][A-Za-z0-9+ ]{0,30}: \S")

# The vocabulary, reported only: a new area is a reason to add a row, not to fail a run.
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

# `Reapply` is what reverting a revert writes since git 2.44. A merge needs neither: --no-merges
# covers the gate, MERGE_HEAD the hook.
GENERATED_SUBJECT: Final = re.compile(r'^(?:Revert|Reapply) ".+"$')
# git closes the sentence with a period for an ordinary commit and ", reversing" for a merge, and
# every change reaches main through a merge, so both endings are the marker.
GENERATED_BODY: Final = re.compile(r"^This reverts commit [0-9a-f]{7,40}[.,]", re.MULTILINE)

# Banned outright: two named trailers, an issue-closing keyword, an AI-authorship signature. The
# first two are the convention (`docs/_git/templates.md :: Commit messages`); the third is CLAUDE.md
# §2.

# The trailing flag is whether the rule still binds a commit the bot exemption released. Only the
# sign-off is dropped, that being the one thing dependabot's generator cannot leave out.
BANNED: Final[tuple[tuple[re.Pattern[str], str, bool], ...]] = (
    (re.compile(r"^\s*Co-authored-by:", re.IGNORECASE | re.MULTILINE), "a Co-authored-by trailer", True),
    (re.compile(r"^\s*Signed-off-by:", re.IGNORECASE | re.MULTILINE), "a Signed-off-by trailer", False),
    (AI_SIGNATURE, "an AI-authorship signature", True),
    (re.compile(r"\b(clos(e|es|ed)|fix(es|ed)?|resolv(e|es|ed))\s+#\d+", re.IGNORECASE), "an issue-closing keyword", True),
)

# Matched whole: `dependabot[bot]` alone would release anyone who typed it into `user.name`, and
# half an address would release a domain. The pull request half is `check_pr_body.py :: BOT_AUTHORS`.
BOT_IDENTITIES: Final[frozenset[tuple[str, str]]] = frozenset(
    {
        ("dependabot[bot]", "49699333+dependabot[bot]@users.noreply.github.com"),
    }
)

# A trailer is read in the message's LAST paragraph alone, where git reads one, and the paragraph
# has to be nothing else.
TRAILER_LINE_RE: Final = re.compile(r"^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*:[ \t]\S")
# What parts a trailer from a sentence. A body closing `Verified: ... exit 0.` is prose, and
# failing that spelling switches the check off. `Closes` in either case, so a mis-cased one is
# refused rather than read as prose.
TRAILER_EVIDENCE_RE: Final = re.compile(r"^(?:[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+|[Cc]loses):[ \t]\S")

# An id is read aloud, so `i`, `l`, `o`, `0` and `1` are out.
ENTRY_ALPHABET: Final = "[abcdefghjkmnpqrstuvwxyz23456789]"
# The hyphen parts a roadmap entry's id from an ordinary identifier, which is what makes
# `git grep <token>` a uniqueness proof.
ENTRY_TOKEN: Final = f"{ENTRY_ALPHABET}{{4}}-{ENTRY_ALPHABET}{{4}}"
# The only trailer the convention admits, in the one spelling `git grep <token>` finds.
CLOSES_RE: Final = re.compile(rf"^Closes:[ \t]({ENTRY_TOKEN})$")

# git is asked for the directory rather than the page, so headings arriving by a rename are still
# in the diff.
ROADMAP_DIR: Final = "docs/_roadmap"
# Which page in the directory holds entries, so an entry-shaped heading on any other page there
# retires nothing.
ROADMAP_ENTRY_PAGES: Final[tuple[str, ...]] = (f"{ROADMAP_DIR}/items.md",)
# One entry heading as a diff line, with the side it sits on. Backticks are optional here because
# `scripts/checks/docs_gate/checks.py :: ROADMAP_ENTRY_RE` admits both, and a heading only one
# reader calls an entry switches this contract off unseen.
ENTRY_HEADING_DIFF_RE: Final = re.compile(rf"^([-+])[ ]{{0,3}}###[ \t]+`?({ENTRY_TOKEN})`?[ \t]+·")

# Ranges rather than a library: CI runs this on a bare runner with no virtualenv at all.
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


def unknown_scope(subject: str) -> bool:
    """Whether the subject's scope names an area the vocabulary does not hold.

    A combined scope is one correct scope spelled as several -- `SUBJECT_SHAPE` admits the `+` for
    exactly that -- so each component is resolved on its own.
    """
    return any(part.strip() not in KNOWN_SCOPES for part in subject.split(":", 1)[0].split("+"))


def git_is_composing() -> bool:
    """Whether git wrote the message the hook is about to check, rather than a person.

    Asked of git's own state, not the subject's first word: a merge or revert leaves the ref
    behind, while anyone can type `Merge `.
    """
    return any(git("rev-parse", "--verify", "--quiet", ref) is not None for ref in ("MERGE_HEAD", "REVERT_HEAD"))


def comment_char() -> str:
    """git's own comment marker, which `core.commentChar` may move off `#`.

    `auto` picks per message and cannot be resolved here, so it reads as the default -- the same
    answer as an unset key.
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

    git needs a paragraph below the subject before it reads trailers at all, so a one-paragraph
    message is never one.
    """
    paragraphs = [block for block in re.split(r"\n[ \t]*\n", message.strip()) if block.strip()]
    if len(paragraphs) < 2:
        return []
    lines = [line for line in paragraphs[-1].split("\n") if line.strip()]
    if not all(TRAILER_LINE_RE.match(line) for line in lines):
        return []
    return lines if any(TRAILER_EVIDENCE_RE.match(line) for line in lines) else []


def entry_tokens_departed(diff: str) -> frozenset[str]:
    """The entries a diff over the roadmap retires.

    Removed headings minus added ones: an entry ending only partly done is rewritten rather than
    deleted, which removes its heading line and adds one carrying the same token.
    """
    sides: dict[str, set[str]] = {"-": set(), "+": set()}
    writes_entries = False
    in_a_hunk = False
    for line in diff.split("\n"):
        if line.startswith("diff --git "):
            writes_entries, in_a_hunk = False, False
        elif line.startswith("@@"):
            in_a_hunk = True
        # Read before the first `@@`, where an added line of content cannot be mistaken for the header.
        elif not in_a_hunk and line.startswith("+++ "):
            # The hunk's DESTINATION decides whether its lines are entries, so a page renamed into
            # the entry page is read and a page deleted outright asks for nothing.
            writes_entries = line[len("+++ ") :].removeprefix("b/") in ROADMAP_ENTRY_PAGES
        elif writes_entries and (match := ENTRY_HEADING_DIFF_RE.match(line)):
            sides[match.group(1)].add(match.group(2))
    return frozenset(sides["-"] - sides["+"])


def commit_departures(sha: str) -> frozenset[str] | None:
    """Which entries one commit retires, or None where git would not hand over its diff.

    None is not an empty set: a diff nothing read is indistinguishable from one retiring nothing,
    and the caller answers for the difference.
    """
    diff = git("show", "--format=", "--unified=0", sha, "--", ROADMAP_DIR)
    return None if diff is None else entry_tokens_departed(diff)


def check_message(message: str, short: str, *, is_bot: bool = False, departed: frozenset[str] | None = None) -> list[CommitFinding]:
    """Every rule against one message; `is_bot` drops the three a bot cannot satisfy.

    Dependabot writes an unwrapped body line, signs off, and records no verification, none of it
    configurable. A wider exemption is a way past the convention.
    """
    lines = message.rstrip("\n").split("\n")
    subject = lines[0]
    findings: list[CommitFinding] = []

    def fail(detail: str) -> None:
        findings.append(CommitFinding("fail", detail, short, subject))

    def report(detail: str) -> None:
        findings.append(CommitFinding("report", detail, short, subject))

    # git writes a revert's subject, so its shape and length go and nothing else does: the marker is
    # typed in seconds, and releasing the whole message would hand the other bans to anyone.
    generated = bool(GENERATED_SUBJECT.match(subject) and GENERATED_BODY.search(message))

    if not generated:
        if not SUBJECT_SHAPE.match(subject):
            fail("subject is not `Scope: what changed`")
        elif unknown_scope(subject):
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
    # One line git wrote, so it records no verification and is not wrapped prose.
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
    # Only where none of the named patterns matched: a Co-authored-by line is both.
    block = [] if named else trailer_block(message)
    closes = [match.group(1) for line in block if (match := CLOSES_RE.match(line))]
    if len(closes) != len(block):
        names = [line.split(":", 1)[0] for line in block]
        malformed = [line.strip() for line in block if line.split(":", 1)[0].lower() == "closes" and not CLOSES_RE.match(line)]
        if malformed:
            fail(f"`{malformed[0]}` names no entry - `Closes:` takes an entry's token: four characters, a hyphen, four more")
        # The shape half of the dropped rule and no wider: any other trailer is still refused.
        elif not (is_bot and all(name.lower() == "signed-off-by" for name in names)):
            fail(f"the message ends in a trailer block ({', '.join(names)}) - `Closes: <token>` is the only trailer the convention carries")

    # Skipped where the diff is unknowable rather than empty, which is the commit-msg hook: the
    # commit has no diff yet, and the index is the wrong one under `git commit --amend`.
    if departed is not None:
        if departed and not closes:
            fail(f"the diff retires {', '.join(sorted(departed))} and the message carries no `Closes:` trailer")
        elif closes and not departed:
            fail(f"the message closes {', '.join(closes)}, and this commit retires no roadmap entry")
        elif set(closes) != departed:
            fail(f"the message closes {', '.join(sorted(set(closes)))}, and the diff retires {', '.join(sorted(departed))} instead")

    if EMOJI.search(message):
        fail("the message carries an emoji")

    return findings


def check_commit(sha: str) -> list[CommitFinding]:
    """One commit's author, message and roadmap diff: every commit on the branch pays two `git show`s."""
    raw = git("show", "-s", "--format=%an%n%ae%n%B", sha)
    if raw is None:
        # Failed rather than skipped: a message nothing read is indistinguishable from a clean one.
        return [CommitFinding("fail", "git could not read this commit, so its message was never judged", sha[:7], "(unread)")]
    # git forbids a newline in either ident field, so the first two lines are the identity.
    name, _, rest = raw.partition("\n")
    email, _, message = rest.partition("\n")
    # A second `git show` rather than one: a pathspec makes it print nothing at all -- header
    # included -- for a commit that touches no path the pathspec names.
    departed = commit_departures(sha)
    findings = check_message(message, sha[:7], is_bot=(name, email) in BOT_IDENTITIES, departed=departed)
    if departed is None:
        detail = "git could not read this commit's roadmap diff, so its trailer was never judged"
        findings.append(CommitFinding("fail", detail, sha[:7], message.split("\n")[0]))
    return findings


def check_message_file(path: Path) -> int:
    """The commit-msg hook's entry point: one message, not yet a commit."""
    if git_is_composing():
        return EXIT_OK
    marker = comment_char()
    raw = path.read_text(encoding="utf-8", errors="replace")
    # Git strips comment lines only AFTER this hook runs, so an editor-written message still carries
    # the whole "# Please enter the commit message" block here.
    message = "\n".join(line for line in raw.split("\n") if not line.startswith(marker))
    # Two rules cannot bind here: the bot exemption, this being the machine the author sets the
    # ident on, and the `Closes:` arms, for want of a diff (`docs/_git/spec.md :: 1.3 Commits`).
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
        # Refused, not green: every commit this reads is named by the base. `--message-file` returns
        # above, which keeps the commit-msg hook working on a clone with no base ref.
        print(f"      nothing here is named {args.base} or origin/{args.base} -- no commit message was checked.")
        print(f"      A single-branch clone fetches no base. Add it:  git remote set-branches --add origin {args.base}")
        print(f"                                                      git fetch origin {args.base}")
        return EXIT_REFUSED

    commits = branch_commits(base)
    if commits is None:
        # Refused, not green: a listing git would not give is the whole branch passing unread.
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
        # The derived base, not the ref it came from: on a stacked branch `git rebase -i main` would
        # rewrite the commits below this one too.
        print("\n      Reword with:  git rebase -i " + base[:7] + "   (or git commit --amend for the tip)")

    if advisory:
        print(f"\n      {len(advisory)} advisory finding(s):")
        for finding in advisory:
            print(finding.line())

    print(f"\n      checked {len(commits)} commit message(s) against {base[:7]}")
    return exit_code(findings)


if __name__ == "__main__":
    sys.exit(run(main))
