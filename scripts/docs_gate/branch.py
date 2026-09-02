from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from functools import cache, partial
from pathlib import Path
from typing import Final, Iterable

from checker_kernel import git, git_input

from .kernel import (
    OPS_FILENAMES,
    REPO_ROOT,
    SCANNED_SUFFIXES,
    SOURCE_SUFFIXES,
    Finding,
    _read_text,
    _scan_body,
    _skipped,
    comment_runs,
    comment_style,
    roadmap_ids,
    untracked_files,
)

# The subtrees the In-code section binds, which is where its comment rules are checked.
INCODE_SCOPES: Final[tuple[str, ...]] = (
    "fl_frontend/src/",
    "fl_backend/app/",
    "fl_backend/tests/",
    "scripts/",
    ".claude/hooks/",
    ".githooks/",
)

# INC-9's one bound, the same for every shape: inline comment, symbol doc and test docstring alike.
COMMENT_CHAR_CAP: Final = 250


def _block_text(block: list[str]) -> str:
    """The one line INC-9's character bound is measured over."""
    return " ".join(line for line in block if line).strip()


def _over_bound(block: list[str]) -> bool:
    """Whether a comment block breaks INC-9's character bound."""
    return len(_block_text(block)) > COMMENT_CHAR_CAP


def _openings_over_bound(text: str, style: str) -> frozenset[str]:
    """The opening line of every comment block in some text that breaks the bound.

    The opening is what identifies a block across an edit deeper inside it, where a line number
    moves with every insertion above.
    """
    return frozenset(_opening(block) for _, block in comment_runs(text, style) if _over_bound(block))


def _opening(block: list[str]) -> str:
    """A block's first line with anything to say, which is how one block is told from another."""
    return next((line for line in block if line), "")


def check_comment_length(path: Path, raw: str, added: set[int], fork_text: Callable[[], str | None] | None = None) -> list[Finding]:
    """A comment block this branch touched, unless it was over the bound before the branch was.

    Requiring the WHOLE block to be added missed every one a branch lengthened; failing a word
    changed inside an older block is `/docs:audit-pr`'s slice (CUR-6).
    """
    rel = path.relative_to(REPO_ROOT).as_posix()
    # Derived here so no caller can pass a suffix a Dockerfile does not have: read for `//` it
    # would yield no block, and the check would run, report nothing, and look wired.
    style = comment_style(path)

    found: list[Finding] = []
    older: frozenset[str] | None = None
    for first_line, block in comment_runs(raw, style):
        numbers = range(first_line, first_line + len(block))
        if added.isdisjoint(numbers) or not _over_bound(block):
            continue
        if older is None:
            # Read here rather than per call: the fork costs a git spawn per file, and a file whose
            # touched blocks all keep the bound never needs one.
            before = fork_text() if fork_text is not None else None
            older = frozenset() if before is None else _openings_over_bound(before, style)
        if _opening(block) in older:
            continue
        text = _block_text(block)
        found.append(
            Finding(
                "fail",
                "comment-length",
                rel,
                f"the comment block runs {len(text)} characters -- INC-9 caps a block at {COMMENT_CHAR_CAP}, every shape alike",
                first_line,
            )
        )
    return found


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
COUNT_WORDS: Final[tuple[str, ...]] = tuple(
    # `both` is absent deliberately: COR-4 catches a count that rots SILENTLY, and this one cannot.
    # It closes a set of exactly two, so a third member makes it read as broken rather than as stale.
    "two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen"
    " seventeen eighteen nineteen twenty second third fourth fifth sixth seventh eighth ninth tenth".split()
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
    answer = git_input("cat-file", "--batch-check", stdin="\n".join(wanted))
    if answer is None:
        return None
    resolved = {parts[0] for line in answer.split("\n") if len(parts := line.split()) >= 2 and parts[1] == "commit"}
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


def _bounded(rel: str) -> bool:
    """Whether INC-9's bound reaches this file at all.

    A git hook is code and its comments carry the same cap, but it has no suffix to match on, so
    it is reached by the roster the scan already reads it under rather than a second spelling.
    """
    if not rel.startswith(INCODE_SCOPES):
        return False
    return rel.endswith(SOURCE_SUFFIXES) or rel.rsplit("/", 1)[-1] in OPS_FILENAMES


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
        if not _bounded(rel) or not path.is_file() or _skipped(path):
            continue
        raw = _read_text(path)[0]
        if raw is None:
            continue
        found.extend(check_comment_length(path, raw, {number for number, _ in added[rel]}, partial(_blob_at, fork, rel)))
    return found
