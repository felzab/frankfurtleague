"""
SCRIPTS · the checks that read the branch rather than the tree

Stamp freshness, branch impact, the added-line checks and the comment bounds, with the stamp and
SHA resolution that needs git objects. Every one is measured from a single commit, resolved once
by the caller and handed here as `Branch`.

Invariants:
- A check git cannot answer reports that it did not run. Reported rather than failed: a fork or a
  tarball has no base ref, and failing one would be wrong.
- A restamp is not a material change. Otherwise the remedy branch impact prescribes
  re-arms the check on every page citing the restamped one.

See:
- docs/_standard/chapters/5-currency.md — CUR-4, the rule this module is the mechanical half of
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Final, Iterable

import check_scope

from .kernel import (
    OPS_FILENAMES,
    REPO_ROOT,
    SCANNED_SUFFIXES,
    SOURCE_SUFFIXES,
    STAMP_LINE_RE,
    STAMP_RE,
    Finding,
    _read_text,
    _scan_body,
    _skipped,
    git,
    git_status,
    strip_fences,
    tracked_files,
)
from .perkind import roadmap_ids
from .references import cited_paths
from .structure import INCODE_SCOPES, check_comment_length

# COR-3's banned shapes. Reported, never failed: "the former ... the latter" is ordinary English, so
# every hit has to be read by a person.
HISTORY_PHRASES: Final[tuple[str, ...]] = (
    "used to",
    "was removed",
    "was renamed",
    "previously",
    "moved here",
    "formerly",
    "former",
    "no longer",
    "any more",
)
HISTORY_RE: Final = re.compile(rf"\b(?:{'|'.join(re.escape(phrase) for phrase in HISTORY_PHRASES)})\b", re.IGNORECASE)


HUNK_HEADER_RE: Final = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


# A short commit SHA named in prose, at git's abbreviation length and carrying a digit and a
# letter. A longer hex run is an asset digest, and reading one as a commit gets a check switched
# off.
PROSE_SHA_RE: Final = re.compile(r"`([0-9a-f]{7,8})`")


REVIEW_REF_RE: Final = re.compile(
    r"\b(?:this|last|previous|earlier)\s+session\b"
    r"|\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\s+(?:review|sweep|session)\b",
    re.IGNORECASE,
)


# COR-4's enumerations. Reported, never failed: "the four admin tables" and "four bytes" are the
# same word. Fitted to what gets written: `one` and `first` name no count, and a count past twenty
# is written in digits, which no word list reaches.
COUNT_WORDS: Final[tuple[str, ...]] = (
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
    "both",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
)
COUNT_RE: Final = re.compile(rf"\b(?:{'|'.join(COUNT_WORDS)})\b", re.IGNORECASE)


# A hyphenated id shaped like the roadmap's, resolved against the tables rather than trusted.
LOOSE_ID_RE: Final = re.compile(r"\b[A-Z]{1,4}-\d{1,3}\b")


def check_added_citations(additions: dict[str, list[str]]) -> list[Finding]:
    """A roadmap id or a review round in a comment this branch added. Always a report.

    Neither is a dead reference: a roadmap id resolves to a tracked file, and a parenthesis naming
    a review round may be a sentence rather than a citation. Both still read as a pointer a
    stranger cannot follow, so the branch that writes one gets to see it. The standing backlog is
    `/docs:audit`'s (CUR-6).
    """
    found: list[Finding] = []
    for rel in sorted(additions):
        if not rel.endswith(SOURCE_SUFFIXES):
            continue
        body = "\n".join(additions[rel])
        for match in REVIEW_REF_RE.finditer(body):
            found.append(
                Finding("report", "comment-citation", rel, f"review reference '{match.group(0).strip()}' in an added comment (INC-6, COR-1)")
            )
        for roadmap_id in sorted(roadmap_ids() & set(LOOSE_ID_RE.findall(body))):
            found.append(
                Finding("report", "comment-citation", rel, f"roadmap id {roadmap_id} in an added comment -- state the constraint (INC-6)")
            )
    return found


@cache
def _commit_present(sha: str) -> bool:
    """Whether this clone holds the named commit. Cached: a repository stamps many pages at one."""
    return git("cat-file", "-e", f"{sha}^{{commit}}") is not None


@cache
def _ancestor_of_head(sha: str) -> bool:
    """Whether the named commit is behind HEAD. A git that cannot answer leaves the finding."""
    return git_status("merge-base", "--is-ancestor", sha, "HEAD") == 0


def check_stamps(paths: Iterable[Path]) -> list[Finding]:
    """A `Verified against` SHA must be a real ancestor of HEAD.

    An unknown SHA is only reported: a shallow clone genuinely does not have the object, and that is
    the checkout's shape rather than the page's defect.
    """
    found: list[Finding] = []
    for path in paths:
        rel = path.relative_to(REPO_ROOT).as_posix()
        raw = _read_text(path)[0]
        if raw is None:
            continue
        match = STAMP_RE.search(strip_fences(raw))
        if match is None:
            continue
        sha = match.group(1)

        if not _commit_present(sha):
            found.append(Finding("report", "stamp", rel, f"commit {sha} is not in this clone"))
        elif not _ancestor_of_head(sha):
            found.append(Finding("fail", "stamp", rel, f"commit {sha} is not an ancestor of HEAD"))
    return found


@dataclass(frozen=True, slots=True)
class Branch:
    """The base ref this run was given, and the commit it resolved to -- None where none did.

    Resolved once, by `checker_kernel.py :: resolve_base`, and handed to every branch-scoped check.
    Three call sites resolving it three ways answered differently on the checkouts where the answer
    is not obvious: a base ref only the remote has, and histories with no common commit.
    """

    base: str
    fork: str | None

    @property
    def unresolved(self) -> str:
        """What git could not do, for the advisory a branch-scoped check emits with no fork to read."""
        return f"resolve {self.base} to a commit this branch forked from"


def _branch_scope_skipped(checks: str, missing: str) -> Finding:
    """The advisory a check emits where git cannot answer the input it reads.

    Reported rather than failed: a clone with no base ref -- a fork, a tarball, a checkout trimmed
    to a depth short of the fork -- is a shape rather than a page's defect, and failing one would be
    wrong. Never silent, though, which is what the same file already says about a tree-scoped input:
    a check that says nothing is indistinguishable from a clean one, and this one stays quiet
    forever once the input goes missing.
    """
    return Finding("report", "branch-scope", "(branch diff)", f"{checks} did not run: git could not {missing}")


def check_stamp_freshness(branch: Branch) -> list[Finding]:
    """A stamped page changed on this branch must also change its stamp (CUR-4).

    The stamp claims someone checked the page against a commit. Editing the page without moving it
    leaves that claim attached to work the author did not verify, and no other check can tell the
    difference -- an old SHA is a valid ancestor forever. If the page was genuinely still correct,
    restamping says so; that is the whole point of the line.
    """
    if (fork := branch.fork) is None:
        return [_branch_scope_skipped("stamp freshness (CUR-4)", branch.unresolved)]
    # Against the fork and the WORKING TREE, not HEAD. The gate runs before a commit exists, so
    # comparing committed state would let the edit through on the run that could still have caught it.
    changed = git("diff", "--name-only", fork, "--", "*.md")
    if changed is None:
        return [_branch_scope_skipped("stamp freshness (CUR-4)", "read this branch's diff")]
    if not changed:
        return []

    found: list[Finding] = []
    for rel in changed.split("\n"):
        if not rel:
            continue
        path = REPO_ROOT / rel
        if not path.is_file() or _skipped(path):
            continue
        current = _read_text(path)[0]
        if current is None or STAMP_RE.search(strip_fences(current)) is None:
            continue

        before = _blob_at(fork, rel)
        if before is None and not _absent_at_fork(fork, rel):
            found.append(_branch_scope_skipped(f"this page's fork state ({rel})", f"read {rel} at the fork"))
            continue
        if before is None:  # added on this branch, so there is no earlier stamp to compare
            continue
        old_line = STAMP_LINE_RE.search(before)
        new_line = STAMP_LINE_RE.search(current)
        if old_line and new_line and old_line.group(0) == new_line.group(0):
            found.append(
                Finding(
                    "fail",
                    "stamp",
                    rel,
                    "changed on this branch without its `Verified against` line moving -- re-verify the page, then restamp (CUR-4)",
                )
            )
    return found


@cache
def _blob_at(fork: str, rel: str) -> str | None:
    """One file as the fork commit holds it, or None where the commit has no such file.

    Cached: several checks ask for the same page's earlier version, and `git show` is a process each.
    """
    return git("show", f"{fork}:{rel}")


def _absent_at_fork(fork: str, rel: str) -> bool:
    """Whether the fork commit genuinely does not hold `rel`, rather than git having declined to say.

    `_blob_at` answers None for both, and the two call for opposite things: a page added on this
    branch has no earlier state to compare and is passed over, while a blob git would not read is a
    stamped page silently exempted from the check.

    A listing is what separates them: it exits clean and empty for a path the commit does not hold,
    carries the entry for one it does, and fails only where git would not run. `cat-file -e` cannot,
    and reading it as a yes-or-no answers every added page wrong: a `<rev>:<path>` the commit does
    not hold is a fatal there, exiting 128 exactly as an unreadable ref does.

    `--full-tree` roots the listing at the repository rather than at the caller's directory, which
    is what keeps it answering the question `_blob_at` asks. Without it the pathspec is read
    relative to the cwd, and the false "absent" that follows would exempt a stamped page in silence.
    """
    return git("ls-tree", "--full-tree", "--name-only", fork, "--", rel) == ""


def _stamp_only_delta(fork: str, rel: str) -> bool:
    """A markdown delta consisting only of moved stamp lines is a restamp, not a change.

    Restamping is the remedy branch-impact itself prescribes, and a remedy that re-arms the check
    on every page citing the restamped one turns one edit into a repository-wide cascade. Nothing
    a citer cites lives on the stamp line, so real stamp lines are normalised out of both versions
    before they are compared. Only a line carrying an actual SHA is normalised: a placeholder
    stamp, like the shape example in the currency chapter, is content.
    Anything unreadable stays material, which is the conservative direction.
    """
    if not rel.endswith(".md"):
        return False
    before = _blob_at(fork, rel)
    after = _read_text(REPO_ROOT / rel)[0]
    if before is None or after is None:
        return False

    def keep_placeholders(match: re.Match[str]) -> str:
        return "" if STAMP_RE.search(match.group(0)) else match.group(0)

    # Stripped on both sides because git() strips what `git show` returns, while read_text keeps
    # the file's trailing newline -- without this the two sides never compare equal.
    normalised_before = STAMP_LINE_RE.sub(keep_placeholders, before).strip()
    normalised_after = STAMP_LINE_RE.sub(keep_placeholders, after).strip()
    return normalised_before == normalised_after


# Named rather than spelled inline: the formatter would fold the tuple into PEP 758's
# `except A, B:`, newer than `checker_kernel.py :: PARSE_FLOOR` --
# `scripts/tests/test_parse_floor.py` parses every module under `scripts/` at that floor.
UNREADABLE: Final = (OSError, UnicodeDecodeError)


def _material(fork: str, path: str) -> bool:
    """Whether one changed file is a change a stamped page citing it must be re-verified against.

    A file the classifier cannot read counts as material, which is the same conservative direction
    the classifier itself takes. It decodes as UTF-8 and raises on a file that is not, and an
    uncaught raise here takes the whole run down before a single finding is printed.

    A suffix outside `check_scope.py :: PARSEABLE` is code by that module's own contract, so the
    classifier is not asked: it would fetch the earlier version and answer from the set anyway.
    """
    try:
        if Path(path).suffix in check_scope.PARSEABLE and check_scope.is_comment_only(fork, path):
            return False
    except UNREADABLE:
        return True
    return not _stamp_only_delta(fork, path)


def check_branch_impact(branch: Branch) -> list[Finding]:
    """A stamped page whose cited files materially changed on this branch must restamp (CUR-4).

    Material means more than comments, decided by check_scope's parser classifier -- anything it
    cannot prove comment-only counts, so shell, YAML and Dockerfiles always do, and markdown does
    unless its whole delta is stamp lines, which is a restamp rather than a change. A
    page added on the branch passes: its stamp is already this branch's work.
    """
    if (fork := branch.fork) is None:
        return [_branch_scope_skipped("branch impact (CUR-4)", branch.unresolved)]
    listed = check_scope.changed_files(fork)
    if listed is None:
        return [_branch_scope_skipped("branch impact (CUR-4)", "read this branch's diff")]
    changed = set(listed)
    if not changed:
        return []

    # Each stamped page against the changed files it cites, collected before anything is classified:
    # materiality costs a git call and a parser run per file, and a file no stamped page cites can
    # never reach a finding.
    pages: list[tuple[str, str, set[str]]] = []
    for path in tracked_files():
        if path.suffix != ".md":
            continue
        raw = _read_text(path)[0]
        if raw is None:
            continue
        body = _scan_body(path)
        if STAMP_RE.search(body) is None:
            continue
        if cited := cited_paths(body) & changed:
            pages.append((path.relative_to(REPO_ROOT).as_posix(), raw, cited))

    material = {path for path in sorted({path for _, _, cited in pages for path in cited}) if _material(fork, path)}
    if not material:
        return []

    found: list[Finding] = []
    for rel, raw, cited in pages:
        hits = sorted(cited & material)
        if not hits:
            continue

        before = _blob_at(fork, rel)
        if before is None and not _absent_at_fork(fork, rel):
            found.append(_branch_scope_skipped(f"this page's fork state ({rel})", f"read {rel} at the fork"))
            continue
        if before is None:  # added on this branch, so its stamp is already this branch's work
            continue
        old_line = STAMP_LINE_RE.search(before)
        new_line = STAMP_LINE_RE.search(raw)
        if old_line and new_line and old_line.group(0) == new_line.group(0):
            shown = ", ".join(hits[:4]) + (f", and {len(hits) - 4} more" if len(hits) > 4 else "")
            found.append(
                Finding(
                    "fail",
                    "branch-impact",
                    rel,
                    f"this branch materially changed {shown}, which this stamped page cites -- re-verify the page, then restamp (CUR-4)",
                )
            )
    return found


def _unresolved_commits(shas: Iterable[str]) -> set[str] | None:
    """The named short SHAs this clone cannot resolve to a commit object, or None where git refused.

    One batch call rather than one per token: a page of release notes names dozens, and a process
    launch per token is the cost that gets a check dropped. A name git cannot resolve comes back as
    `<name> missing` or `<name> ambiguous`, and anything resolving to a tree or a blob is not a
    commit either.

    None is not an empty set: nothing unresolved is a page whose references all hold, while a refused
    batch is every SHA on every page passing unread.
    """
    wanted = sorted(set(shas))
    if not wanted:
        return set()
    try:
        done = subprocess.run(
            ("git", "cat-file", "--batch-check"),
            cwd=REPO_ROOT,
            input="\n".join(wanted),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except OSError:
        return None
    if done.returncode != 0:
        return None
    resolved = {parts[0] for line in done.stdout.split("\n") if len(parts := line.split()) >= 2 and parts[1] == "commit"}
    return {sha for sha in wanted if sha not in resolved and not any(full.startswith(sha) for full in resolved)}


def check_prose_shas(paths: Iterable[Path]) -> list[Finding]:
    """A commit SHA named in prose or in a comment resolves in this clone. Always a report.

    Reported for the reason `stamp` reports an unknown SHA: a shallow clone genuinely lacks the
    object, and that is the checkout's shape rather than the page's defect. The defect it does
    find is the one a rewritten history leaves everywhere at once -- a SHA that still looks like a
    reference and resolves to nothing.
    """
    per_file: dict[str, set[str]] = {}
    for path in paths:
        # Stamp lines come out first: `stamp` already resolves those, and one dead SHA reported by
        # a pair of checks reads as a gate that repeats itself.
        for sha in PROSE_SHA_RE.findall(STAMP_LINE_RE.sub("", _scan_body(path))):
            if any(c.isdigit() for c in sha) and any(c.isalpha() for c in sha):
                per_file.setdefault(path.relative_to(REPO_ROOT).as_posix(), set()).add(sha)

    missing = _unresolved_commits({sha for shas in per_file.values() for sha in shas})
    if missing is None:
        return [_branch_scope_skipped("prose SHA resolution", "resolve the commits named in prose")]
    return [
        Finding("report", "sha", rel, f"commit {sha} resolves to nothing in this clone -- was it rewritten out of the history?")
        for rel in sorted(per_file)
        for sha in sorted(per_file[rel] & missing)
    ]


@cache
def _added_by_file(fork: str) -> dict[str, list[tuple[int, str]]] | None:
    """Per file, every line this branch adds, as its number in the working tree and its text.

    One diff, walked once: asking git per file both spends a process each time and answers a
    renamed file differently, since a lone pathspec leaves git nothing to detect the rename against.

    Against the working tree rather than HEAD, because the gate runs before the commit exists.

    None where git refused the diff, which is the opposite answer to an empty one: no added line
    anywhere is a clean branch, while a refused diff is every added-line check passing unread.
    """
    diff = git("diff", "-U0", fork)
    if diff is None:
        return None
    added: dict[str, list[tuple[int, str]]] = {}
    rel, number = "", 0
    for line in diff.split("\n"):
        if line.startswith("+++ "):
            rel, number = line[6:].strip() if line.startswith("+++ b/") else "", 0
        elif match := HUNK_HEADER_RE.match(line):
            number = int(match.group(1))
        elif rel and number and line.startswith("+"):
            added.setdefault(rel, []).append((number, line[1:]))
            number += 1
    return added


def branch_additions(branch: Branch) -> dict[str, list[str]]:
    """Per file, the lines this branch adds that a reader reads: markdown, and any scanned comment.

    Ops files are in range because the checks reading this are COR-3's and COR-4's, and chapter 1
    binds every written artifact; the reader that filters this down to the comment-bearing source
    suffixes is `check_added_citations`, which enforces an INC rule.

    Read through the file's own scanned body, indexed by line number, rather than decided from each
    line's first characters. The diff is taken against the working tree, so an added line's number
    IS its number in the file on disk, and the surrounding file a marker rule has to do without is
    right there. Deciding from the prefix answered two questions wrongly at once: a Python
    docstring opens with a quote, so INC-4's documentation -- a module header included -- reached
    neither COR-3 nor COR-4; and a code line opening with a marker inside a literal reached both.
    """
    additions: dict[str, list[str]] = {}
    for rel, lines in ((_added_by_file(branch.fork) if branch.fork is not None else None) or {}).items():
        if not (rel.endswith(SCANNED_SUFFIXES) or rel.endswith((".md", *OPS_FILENAMES))):
            continue
        scanned = _scan_body(REPO_ROOT / rel).split("\n")
        for number, _ in lines:
            text = scanned[number - 1].strip() if number <= len(scanned) else ""
            if text:
                additions.setdefault(rel, []).append(text)
    return additions


def check_history_phrases(additions: dict[str, list[str]]) -> list[Finding]:
    """COR-3's banned shapes, over the branch's added prose and comments. Always a report."""
    hits = sum(1 for lines in additions.values() for line in lines if HISTORY_RE.search(line))
    if not hits:
        return []
    return [Finding("report", "history", "(branch diff)", f"{hits} added line(s) match a COR-3 history phrase -- read them")]


def check_counts(additions: dict[str, list[str]]) -> list[Finding]:
    """COR-4's enumerations, over the branch's added prose and comments. Always a report.

    Reported per file rather than as one number, because the remedy is per sentence: "the four
    admin tables" has to become "every admin table", and "four bytes" has to be left alone.
    """
    found: list[Finding] = []
    for rel in sorted(additions):
        hits = [line for line in additions[rel] if COUNT_RE.search(line)]
        if hits:
            found.append(Finding("report", "counts", rel, f"{len(hits)} added line(s) name a count or an ordinal -- read them (COR-4)"))
    return found


DIFF_READERS: Final = "history, counts, added comment citations and comment length"


def check_branch_diff(branch: Branch) -> list[Finding]:
    """The advisory covering every check that reads the branch's added lines.

    One advisory for the four of them, because they read one diff through `_added_by_file` and
    therefore degrade together: reported separately it would be the same sentence four times.
    """
    if branch.fork is None:
        return [_branch_scope_skipped(DIFF_READERS, branch.unresolved)]
    if _added_by_file(branch.fork) is not None:
        return []
    return [_branch_scope_skipped(DIFF_READERS, "read this branch's diff")]


def check_comment_bounds(branch: Branch) -> list[Finding]:
    """INC-9's bounds, over the comment blocks this branch wrote."""
    # Silent rather than advisory on either refusal below: `check_branch_diff` already names this
    # check among the four reading one diff, and a second advisory would be the same sentence twice.
    if (fork := branch.fork) is None:
        return []
    # The one diff, rather than a second `--name-only` call: a file changed by deletions alone has no
    # added line for a block to sit inside, so nothing this listing drops could reach a finding.
    added = _added_by_file(fork)
    if added is None:
        return []
    found: list[Finding] = []
    for rel in sorted(added):
        path = REPO_ROOT / rel
        if not rel.startswith(INCODE_SCOPES) or not rel.endswith(SOURCE_SUFFIXES) or not path.is_file() or _skipped(path):
            continue
        raw = _read_text(path)[0]
        if raw is None:
            continue
        found.extend(check_comment_length(path, raw, {number for number, _ in added[rel]}))
    return found
