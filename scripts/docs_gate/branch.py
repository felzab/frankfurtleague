from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from functools import cache, partial
from pathlib import Path
from typing import Final, Iterable

from .kernel import (
    OPS_FILENAMES,
    REPO_ROOT,
    SCANNED_SUFFIXES,
    SOURCE_SUFFIXES,
    Finding,
    _read_text,
    _scan_body,
    _skipped,
    git,
    untracked_files,
)
from .perkind import roadmap_ids
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


# A longer hex run is an asset digest, and reading one as a commit gets a check switched off.
PROSE_SHA_RE: Final = re.compile(r"`([0-9a-f]{7,8})`")


REVIEW_REF_RE: Final = re.compile(
    r"\b(?:this|last|previous|earlier)\s+session\b"
    r"|\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\s+(?:review|sweep|session)\b",
    re.IGNORECASE,
)


# COR-4's enumerations. Reported, never failed: "the four admin tables" and "four bytes" are the
# same word. `one` and `first` name no count, and a count past twenty is written in digits.
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
    # `both` is absent deliberately: COR-4 catches a count that rots SILENTLY, and this one cannot.
    # It closes a set of exactly two, so a third member makes it read as broken rather than as stale.
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

    Neither is a dead reference, so neither fails; both still read as a pointer a stranger cannot
    follow. The standing backlog is `/docs:audit`'s (CUR-6).
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


@dataclass(frozen=True, slots=True)
class Branch:
    """The base ref this run was given, and the commit it resolved to.

    Resolved once by `checker_kernel.py :: resolve_base`: resolving it per call site answered
    differently where a base ref is only on the remote.
    """

    base: str
    fork: str | None

    @property
    def unresolved(self) -> str:
        """What git could not do, for the advisory a branch-scoped check emits with no fork to read."""
        return f"resolve {self.base} to a commit this branch forked from"


def _branch_scope_skipped(checks: str, missing: str) -> Finding:
    """The advisory a check emits where git cannot answer the input it reads.

    Reported rather than failed: a clone with no base ref is a shape, not a page's defect. Never
    silent: a check saying nothing looks clean.
    """
    return Finding("report", "branch-scope", "(branch diff)", f"{checks} did not run: git could not {missing}")


@cache
def _blob_at(fork: str, rel: str) -> str | None:
    """One file as the fork commit holds it, or None where the commit has no such file.

    Cached: several checks ask for the same page's earlier version, and `git show` is a process each.
    """
    return git("show", f"{fork}:{rel}")


def _unresolved_commits(shas: Iterable[str]) -> set[str] | None:
    """The short SHAs this clone cannot resolve, or None where git refused.

    One batch call rather than one per token, a launch per token being what gets a check dropped.
    None is not an empty set: a refused batch is every SHA unread.
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

    Reported rather than failed: a shallow clone genuinely lacks the object, and that is the
    checkout's shape rather than the page's defect.
    """
    per_file: dict[str, set[str]] = {}
    for path in paths:
        for sha in PROSE_SHA_RE.findall(_scan_body(path)):
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
    """Per file, every line this branch adds, by number and text.

    One diff, walked once: a lone pathspec leaves git nothing to detect a rename against. Against
    the working tree, the gate running before the commit exists.
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
    return added | _added_whole(added)


def _added_whole(diffed: dict[str, list[tuple[int, str]]]) -> dict[str, list[tuple[int, str]]]:
    """Every line of a corpus file the branch wrote and has not staged, as an addition.

    git holds no version of a file the index never reached, so an unstaged one has no diff at all
    and INC-9 would read nothing where a branch put a whole new module.
    """
    whole: dict[str, list[tuple[int, str]]] = {}
    for path in untracked_files():
        rel = path.relative_to(REPO_ROOT).as_posix()
        if rel in diffed or (raw := _read_text(path)[0]) is None:
            continue
        lines = raw.split("\n")
        # A trailing newline ends the last line rather than beginning another, which is the count a
        # diff of the same file reports.
        whole[rel] = [(number, text) for number, text in enumerate(lines[:-1] if lines[-1:] == [""] else lines, start=1)]
    return whole


def branch_additions(branch: Branch) -> dict[str, list[str]]:
    """Per file, the lines this branch adds that a reader reads.

    Read through the scanned body by line number, never each line's first characters: a docstring
    opens with a quote, and a code line can hold a marker inside a literal.
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

    Per file rather than one number: the remedy is per sentence, "four admin tables" becoming
    "every admin table" while "four bytes" is left alone.
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

    They read one diff through `_added_by_file` and degrade together, so reporting separately would
    be the same sentence several times.
    """
    if branch.fork is None:
        return [_branch_scope_skipped(DIFF_READERS, branch.unresolved)]
    if _added_by_file(branch.fork) is not None:
        return []
    return [_branch_scope_skipped(DIFF_READERS, "read this branch's diff")]


def check_comment_bounds(branch: Branch) -> list[Finding]:
    """INC-9's bound, over the comment blocks this branch wrote."""
    # Silent rather than advisory: `check_branch_diff` already names this check among those reading
    # one diff.
    if (fork := branch.fork) is None:
        return []
    # The one diff, rather than a second `--name-only` call: a file changed by deletions alone has
    # no added line for a block to sit inside.
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
        found.extend(check_comment_length(path, raw, {number for number, _ in added[rel]}, partial(_blob_at, fork, rel)))
    return found
