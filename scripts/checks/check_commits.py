"""SCRIPTS · the commit message gate, run by the `commit-msg` hook and by nothing else.

A message is correct before it is committed, since commits are never rewritten, so the rules bind at
the one moment fixing one is free. A check needing judgement reports rather than refuses -- a
refusal that cries wolf is one that gets switched off -- and a report prints on a message the hook
passes, which is the only time anyone reads it.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Final

# Every caller runs this as a script, so sys.path opens with THIS directory and `lib/` is a
# sibling of it rather than in it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from check_tracked_text import BIDIRECTIONAL
from checker_kernel import EXIT_FINDINGS, EXIT_OK, EXIT_REFUSED, Finding, failures, git, reports, run

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

# Banned outright: two named trailers, an issue-closing keyword, an AI-authorship signature. The
# first two are the convention (`docs/_git/templates.md :: Commit messages`); the third is CLAUDE.md
# §2.
BANNED: Final[tuple[tuple[re.Pattern[str], str], ...]] = (
    (re.compile(r"^\s*Co-authored-by:", re.IGNORECASE | re.MULTILINE), "a Co-authored-by trailer"),
    (re.compile(r"^\s*Signed-off-by:", re.IGNORECASE | re.MULTILINE), "a Signed-off-by trailer"),
    (AI_SIGNATURE, "an AI-authorship signature"),
    (re.compile(r"\b(clos(e|es|ed)|fix(es|ed)?|resolv(e|es|ed))\s+#\d+", re.IGNORECASE), "an issue-closing keyword"),
)

# A trailer is read in the message's LAST paragraph alone, where git reads one, and the paragraph
# has to be nothing else.
TRAILER_LINE_RE: Final = re.compile(r"^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*:[ \t]\S")
# What parts a trailer from a sentence. Reading a body's closing `Verified: ... exit 0.` line as a
# trailer would refuse every commit carrying one, so the paragraph is read as trailers only on
# evidence.
TRAILER_EVIDENCE_RE: Final = re.compile(
    # `Closes` in either case, so a mis-cased one is refused rather than read as prose.
    r"^(?:[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+|[Cc]loses):[ \t]\S"
    # A hyphenless name earns it on the value instead: a reference is one unbroken token ending no
    # sentence, which no closing line of prose is.
    r"|^[A-Za-z][A-Za-z0-9]*:[ \t]\S*[^\s.!?][ \t]*$"
)

# What makes ONE line a trailer with no paragraph to corroborate it. `TRAILER_EVIDENCE_RE` is the
# wrong test here: its hyphenated-name arm reads a line wrapping onto a hyphenated word as a
# trailer, harmless only while `trailer_block` demands every line.
GLUED_TRAILER_RE: Final = re.compile(
    # The one name the convention admits needs no value test: no line of prose opens on `Closes:`.
    r"^[Cc]loses:[ \t]\S"
    r"|^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*:[ \t]\S*[^\s.!?][ \t]*$"
)

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
# `scripts/checks/docs_gate/kernel.py :: ROADMAP_ENTRY_RE` admits both, and a heading only one
# reader calls an entry switches this contract off unseen.
ENTRY_HEADING_DIFF_RE: Final = re.compile(rf"^([-+])[ ]{{0,3}}###[ \t]+`?({ENTRY_TOKEN})`?[ \t]+·")

# Ranges rather than a library: the hook runs this on whichever interpreter it finds, a virtualenv or not.
EMOJI: Final = re.compile(
    "[\U0001f000-\U0001faff☀-➿⬀-⯿️]",
)

# A line that is one long unbroken token is a URL or a path, and wrapping it would break it.
UNWRAPPABLE: Final = re.compile(r"^\S+$|https?://\S{40,}")

VERIFIED_HINT: Final = re.compile(r"\bverif\w+|\bexit 0\b|\bchecked\b|\bran\b", re.IGNORECASE)

# The bracketed shape alone. The form's angle-bracket prose is deliberately unmatched: every
# pattern wide enough to catch it also refuses a body naming an HTML element or a TS generic.
UNFILLED: Final = re.compile(r"\[[^\]\n]{0,80}\bFILL[ _-]?IN\b[^\]\n]{0,20}\]", re.IGNORECASE)


# Under `git commit --amend` the staged diff is the amend's delta against the replaced commit, and
# nothing the hook is handed tells an amend apart; the reset route stages the whole change.
AMEND_HINT: Final = " (amending? redo it as git reset --soft HEAD~1, then git commit -F)"


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


def paragraphs(message: str) -> list[str]:
    """The message's blank-line-separated blocks, subject first."""
    return [block for block in re.split(r"\n[ \t]*\n", message.strip()) if block.strip()]


def trailer_block(message: str) -> list[str]:
    """The message's closing paragraph where that paragraph is a run of trailers, else nothing.

    git needs a paragraph below the subject before it reads trailers at all, so a one-paragraph
    message is never one.
    """
    blocks = paragraphs(message)
    if len(blocks) < 2:
        return []
    lines = [line for line in blocks[-1].split("\n") if line.strip()]
    if not all(TRAILER_LINE_RE.match(line) for line in lines):
        return []
    return lines if any(TRAILER_EVIDENCE_RE.match(line) for line in lines) else []


def glued_trailers(message: str) -> list[str]:
    """Every trailer-shaped line below the subject that git will not read as a trailer.

    A trailer with no blank line over it leaves `trailer_block` empty rather than malformed, so no
    arm reading that block can see it.
    """
    blocks = paragraphs(message)
    if len(blocks) < 2:
        return []
    # The closing paragraph is dropped only where it IS the trailer block: a trailer glued into one
    # that is not is the very fault being looked for.
    scanned = blocks[1:-1] if trailer_block(message) else blocks[1:]
    return [line for block in scanned for line in block.split("\n") if GLUED_TRAILER_RE.match(line)]


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


def staged_departures() -> frozenset[str] | None:
    """Which entries the commit being written retires, or None where git would not hand over the diff.

    The new commit's own diff, but under an amend (`AMEND_HINT`).
    """
    diff = git("diff", "--cached", "--unified=0", "--", ROADMAP_DIR)
    return None if diff is None else entry_tokens_departed(diff)


def check_message(message: str, *, departed: frozenset[str] | None = None) -> list[Finding]:
    """Every rule against one message; `departed` is what its diff retires, None where no diff was read."""
    lines = message.rstrip("\n").split("\n")
    subject = lines[0]
    findings: list[Finding] = []

    def fail(detail: str) -> None:
        findings.append(Finding("fail", detail))

    def report(detail: str) -> None:
        findings.append(Finding("report", detail))

    if not SUBJECT_SHAPE.match(subject):
        fail("subject is not `Scope: what changed`")
    elif unknown_scope(subject):
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

    if UNFILLED.search(message):
        fail("the message carries a bracketed FILL IN placeholder - the form was pasted rather than filled in")

    named = [what for pattern, what in BANNED if pattern.search(message)]
    for what in named:
        fail(f"the message carries {what}")
    # Not gated on `departed`: this is a shape, and a shape needs no diff to judge.
    if not named and (glued := glued_trailers(message)):
        fail(f"`{glued[0]}` is inside a paragraph - a trailer needs a blank line over it, and git reads this one as prose")
    # Only where none of the named patterns matched: a Co-authored-by line is both.
    block = [] if named else trailer_block(message)
    # Before the arms below, which compare the entries as sets: a line written twice is one member
    # there, so a doubled trailer would agree with a diff retiring the entry once.
    if repeated := sorted({line.strip() for line in block if block.count(line) > 1}):
        fail(f"the message repeats the trailer `{repeated[0]}` - one line per entry retired")
    closes = [match.group(1) for line in block if (match := CLOSES_RE.match(line))]
    if len(closes) != len(block):
        names = [line.split(":", 1)[0] for line in block]
        malformed = [line.strip() for line in block if line.split(":", 1)[0].lower() == "closes" and not CLOSES_RE.match(line)]
        if malformed:
            fail(f"`{malformed[0]}` names no entry - `Closes:` takes an entry's token: four characters, a hyphen, four more")
        else:
            fail(f"the message ends in a trailer block ({', '.join(names)}) - `Closes: <token>` is the only trailer the convention carries")

    if departed is not None:
        if departed and not closes:
            fail(f"the diff retires {', '.join(sorted(departed))} and the message carries no `Closes:` trailer{AMEND_HINT}")
        elif closes and not departed:
            fail(f"the message closes {', '.join(closes)}, and this commit retires no roadmap entry{AMEND_HINT}")
        elif set(closes) != departed:
            closed, retired = ", ".join(sorted(set(closes))), ", ".join(sorted(departed))
            fail(f"the message closes {closed}, and the diff retires {retired} instead{AMEND_HINT}")

    if EMOJI.search(message):
        fail("the message carries an emoji")
    # The tracked tree's set, one reordering the text around it unseen.
    if any(character in BIDIRECTIONAL for character in message):
        fail("the message carries a bidirectional control, which can reorder how its text reads")

    return findings


def check_message_file(path: Path) -> int:
    """The commit-msg hook's entry point: one message, and the staged diff it is committed with."""
    if git_is_composing():
        return EXIT_OK
    marker = comment_char()
    raw = path.read_text(encoding="utf-8", errors="replace")
    # Git strips comment lines only AFTER this hook runs, so an editor-written message still carries
    # the whole "# Please enter the commit message" block here.
    message = "\n".join(line for line in raw.split("\n") if not line.startswith(marker))
    departed = staged_departures()
    if departed is None:
        # Refused, not passed: nothing reads a message after this, so a trailer judged against no
        # diff would be a trailer never judged.
        print("\n  git would not hand over the staged diff, so the Closes: trailer was never judged.", file=sys.stderr)
        return EXIT_REFUSED
    findings = check_message(message, departed=departed)
    for finding in reports(findings):
        print(f"  commit-msg notice: {finding.detail}", file=sys.stderr)
    refused = failures(findings)
    if not refused:
        return EXIT_OK
    print(f"\n  Commit refused: {len(refused)} problem(s) with the message.", file=sys.stderr)
    for finding in refused:
        print(f"    - {finding.detail}", file=sys.stderr)
    print("\n  The form is docs/_git/templates.md. Your message is kept in", file=sys.stderr)
    print(f"  {path} -- reuse it with:  git commit -F {path}\n", file=sys.stderr)
    return EXIT_FINDINGS


def main() -> int:
    parser = argparse.ArgumentParser(description="Commit message gate (docs/_git/templates.md), run by the commit-msg hook.")
    parser.add_argument("--message-file", type=Path, required=True, help="the message git is about to commit")
    return check_message_file(parser.parse_args().message_file)


if __name__ == "__main__":
    sys.exit(run(main))
