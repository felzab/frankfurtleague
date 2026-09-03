from __future__ import annotations

import ast
import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from functools import cache, partial
from pathlib import Path
from typing import Final, Iterable

from checker_kernel import git

from .kernel import (
    OPS_FILENAMES,
    REPO_ROOT,
    SCANNED_SUFFIXES,
    SOURCE_SUFFIXES,
    UNPARSEABLE,
    Finding,
    _read_text,
    _scan_body,
    _skipped,
    comment_runs,
    comment_style,
    roadmap_ids,
    unlisted,
    unmarked_line,
    untracked_files,
    word_count,
)

# The trees `docs/standard.md` In-code's Scope names, which `test_scope_agreement.py` holds it to
# and sweeps. Nothing selects on them -- `_bounded` reads the kind, a tree admitting kinds the gate
# cannot read.
INCODE_SCOPES: Final[tuple[str, ...]] = (
    "fl_frontend/src/",
    "fl_backend/app/",
    "fl_backend/tests/",
    "scripts/",
    ".claude/hooks/",
    ".githooks/",
)

# INC-9's one bound, the same for every shape: inline comment, symbol doc and test docstring alike.
# Words rather than characters, so reflowing a block cannot carry it under.
COMMENT_WORD_CAP: Final = 40

# The published document INC-4 names. FastAPI writes an endpoint's docstring here as the operation
# description, and the file is tracked, so the exemption reads what a caller receives.
OPENAPI_PAGE: Final = "fl_backend/openapi.json"
# A second condition, not a second population: this document is generated from these same
# docstrings (PRE-4). What it buys is that a docstring the API does not publish keeps INC-9's bound.
ENDPOINT_TREE: Final = "fl_backend/app/"
ROUTE_METHODS: Final[frozenset[str]] = frozenset({"get", "post", "put", "patch", "delete", "head", "options"})

# What walking the published document raises where it is not shaped as this reader expects. Named
# rather than spelled inline, for `kernel.py :: UNTOKENIZABLE`'s reason.
UNSHAPED: Final = (AttributeError, KeyError, TypeError, ValueError)


def _block_text(block: list[str]) -> str:
    """The one line INC-9's bound is measured over."""
    return unlisted(block)


def _over_bound(block: list[str]) -> bool:
    """Whether a comment block breaks INC-9's bound."""
    return word_count(_block_text(block)) > COMMENT_WORD_CAP


@cache
def published_descriptions() -> frozenset[str]:
    """Every operation description the API publishes.

    Empty where the document is absent or will not parse, which exempts nothing: a corpus with no
    backend owes no exemption, and a corrupt one fails every endpoint docstring saying so.
    """
    raw = _read_text(REPO_ROOT / OPENAPI_PAGE)[0]
    if raw is None:
        return frozenset()
    try:
        paths = json.loads(raw)["paths"]
        operations = [operation for item in paths.values() for operation in item.values()]
    except UNSHAPED:
        return frozenset()
    return frozenset(
        _block_text([unmarked_line(line) for line in description.split("\n")])
        for operation in operations
        if isinstance(operation, dict) and isinstance(description := operation.get("description"), str)
    )


def _endpoint_docstrings(raw: str) -> frozenset[int]:
    """The line each route-decorated function opens its docstring on.

    Read through `ast`: a signature spans lines and a decorator carries arguments over them, so
    scanning upward from the docstring for a marker answers wrongly on the shapes that matter.
    """
    try:
        tree = ast.parse(raw)
    except UNPARSEABLE:
        return frozenset()  # ruff and the suite already fail a module that will not parse
    lines: set[int] = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) or not node.body:
            continue
        routed = any(
            isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Attribute) and decorator.func.attr in ROUTE_METHODS
            for decorator in node.decorator_list
        )
        opening = node.body[0]
        if routed and isinstance(opening, ast.Expr) and isinstance(opening.value, ast.Constant) and isinstance(opening.value.value, str):
            lines.add(opening.lineno)
    return frozenset(lines)


def _blocks_over_bound(text: str, style: str) -> list[tuple[frozenset[str], int]]:
    """Each over-bound block in some text, as the lines it holds and the words it runs to."""
    return [
        (frozenset(line for line in block if line), word_count(_block_text(block)))
        for _, block in comment_runs(text, style)
        if _over_bound(block)
    ]


def _fork_ceiling(block: list[str], older: list[tuple[frozenset[str], int]]) -> int | None:
    """What this block ran to at the fork, or None where the fork carried no block of its."""
    lines = frozenset(line for line in block if line)
    # Never the opening line as a key: it drops the exemption the moment a writer improves that
    # sentence, which pays them to leave the worst prose in the file exactly as it stands.
    matched = max(
        (candidate for candidate in older if candidate[0] & lines),
        key=lambda candidate: (len(candidate[0] & lines), candidate[1]),
        default=None,
    )
    return None if matched is None else matched[1]


def check_comment_length(path: Path, raw: str, added: set[int], fork_text: Callable[[], str | None] | None = None) -> list[Finding]:
    """A comment block this branch touched, unless the branch found it over the bound already.

    Requiring the WHOLE block to be added missed every one a branch lengthened; failing a word
    changed inside an older block is `/docs:audit-pr`'s slice (CUR-6).
    """
    rel = path.relative_to(REPO_ROOT).as_posix()
    # Derived here so no caller can pass a suffix a Dockerfile does not have: read for `//` it
    # would yield no block, and the check would run, report nothing, and look wired.
    style = comment_style(path)
    published = published_descriptions()
    endpoints = _endpoint_docstrings(raw) if style == ".py" and rel.startswith(ENDPOINT_TREE) else frozenset()

    found: list[Finding] = []
    older: list[tuple[frozenset[str], int]] | None = None
    for first_line, block in comment_runs(raw, style):
        numbers = range(first_line, first_line + len(block))
        if added.isdisjoint(numbers) or not _over_bound(block):
            continue
        text = _block_text(block)
        routed, publishes = first_line in endpoints, text in published
        if routed and publishes:
            continue  # INC-4's contract, at a rung no bound written for a comment reaches
        if older is None:
            # Read here rather than per call: the fork costs a git spawn per file, and a file whose
            # touched blocks all keep the bound never needs one.
            before = fork_text() if fork_text is not None else None
            older = [] if before is None else _blocks_over_bound(before, style)
        words = word_count(text)
        ceiling = _fork_ceiling(block, older)
        if ceiling is not None and words <= ceiling:
            continue
        found.append(Finding("fail", "comment-length", rel, _bound_detail(words, ceiling, routed, publishes), first_line))
    return found


def _bound_detail(words: int, ceiling: int | None, routed: bool, publishes: bool) -> str:
    """What a block over the bound is told, which differs by why the exemptions did not reach it."""
    if ceiling is not None:
        return f"the comment block runs {words} words, up from {ceiling} where the branch forked -- INC-9 lets neither number rise"
    if routed:
        return f"the comment block runs {words} words and `{OPENAPI_PAGE}` publishes no such description -- INC-4's exemption needs both"
    if publishes:
        return f"the comment block runs {words} words and no route decorator carries it -- INC-4's exemption needs both (PRE-4)"
    return f"the comment block runs {words} words -- INC-9 caps a block at {COMMENT_WORD_CAP}, every shape alike"


# COR-3's banned shapes, over the branch's own added lines alone. Failing: a phrase this list holds
# is one the rule bans outright, and a hit somebody was meant to read was read by nobody.
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


HUNK_HEADER_RE: Final = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")


# An asset digest read as a commit switches off the check that pins it: an action's `@<sha>` and
# an image's `sha256:` digest are longer than this window, and the backticks are what stop either
# matching inside one.
PROSE_SHA_RE: Final = re.compile(r"`([0-9a-f]{7,8})`")


REVIEW_REF_RE: Final = re.compile(
    r"\b(?:this|last|previous|earlier)\s+session\b"
    r"|\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\s+(?:review|sweep|session)\b",
    re.IGNORECASE,
)


# Loose, and resolved against the roadmap's own table rather than trusted: this shape also spells
# a short hyphenated name, and what an index row defines is the only thing that separates a
# citation from one.
LOOSE_ID_RE: Final = re.compile(r"\b[a-z0-9]{4}-[a-z0-9]{4}\b")


def check_added_citations(additions: dict[str, list[str]]) -> list[Finding]:
    """A roadmap id or a review round in a comment this branch added (INC-6).

    Branch-scoped: the branch that wrote the line is the one place the constraint behind it is
    still known, and the standing backlog is `/docs:audit`'s (CUR-6).
    """
    found: list[Finding] = []
    for rel in sorted(additions):
        if not rel.endswith(SOURCE_SUFFIXES):
            continue
        body = "\n".join(additions[rel])
        for match in REVIEW_REF_RE.finditer(body):
            found.append(
                Finding("fail", "comment-citation", rel, f"review reference '{match.group(0).strip()}' in an added comment (INC-6, COR-1)")
            )
        for roadmap_id in sorted(roadmap_ids() & set(LOOSE_ID_RE.findall(body))):
            found.append(
                Finding("fail", "comment-citation", rel, f"roadmap id {roadmap_id} in an added comment -- state the constraint (INC-6)")
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
        """What git could not do, for the finding a branch-scoped check emits with no fork to read."""
        return f"resolve {self.base} to a commit this branch forked from"


def _branch_scope_skipped(checks: str, missing: str) -> Finding:
    """What a check answers where git cannot give it the input it reads."""
    # Failing rather than reported: a checkout too shallow to hold the base ref proves nothing
    # about the branch, and a run that proved nothing must not be read as a run that passed.
    return Finding("fail", "branch-scope", "(branch diff)", f"{checks} did not run: git could not {missing}")


@cache
def _blob_at(fork: str, rel: str) -> str | None:
    """One file as the fork commit holds it, or None where the commit has no such file.

    Cached: several checks ask for the same page's earlier version, and `git show` is a process each.
    """
    return git("show", f"{fork}:{rel}")


def check_prose_shas(paths: Iterable[Path]) -> list[Finding]:
    """No commit SHA is named in prose or in a comment (COR-6).

    Every SHA and not only a dangling one: resolving each against the clone would enforce "no
    dangling SHA" under this check's name while every SHA written today passed.
    """
    found: list[Finding] = []
    for path in paths:
        rel = path.relative_to(REPO_ROOT).as_posix()
        # A run of hex alone is a value; one carrying both a digit and a letter is what a short SHA
        # looks like, and what an ordinary word or a decimal is not.
        named = {sha for sha in PROSE_SHA_RE.findall(_scan_body(path)) if any(c.isdigit() for c in sha) and any(c.isalpha() for c in sha)}
        found.extend(
            Finding("fail", "sha", rel, f"commit {sha} is named here -- COR-6 reaches the argument with `git log -S` on the constraint instead")
            for sha in sorted(named)
        )
    return found


@cache
def _added_by_file(fork: str) -> dict[str, list[tuple[int, str]]] | None:
    """Per file, every line this branch adds, by number and text.

    One diff, walked once: a lone pathspec leaves git nothing to detect a rename against. Against
    the working tree, the gate running before the commit exists.
    """
    # Both overrides beat a developer's own config, which silently drops a whole file otherwise:
    # `core.quotePath` spells a non-ASCII path `"b/f\303\274r.md"`, and `diff.noprefix` drops the
    # `b/` this walk keys on. `kernel.py :: _listed` reaches for `-z` against the same hazard.
    diff = git("-c", "core.quotePath=false", "diff", "-U0", "--src-prefix=a/", "--dst-prefix=b/", fork)
    if diff is None:
        return None
    added: dict[str, list[tuple[int, str]]] = {}
    rel, number, in_header = "", 0, False
    for line in diff.split("\n"):
        # A `+++ ` is a header only above the first hunk: inside one it is an added line reading
        # `++ …`, and treating that as a path would drop the rest of the hunk.
        if line.startswith("diff --git "):
            rel, number, in_header = "", 0, True
        elif in_header and line.startswith("+++ "):
            target = line[4:].rstrip("\r")
            if target != "/dev/null" and not target.startswith("b/"):
                # git C-quotes a path holding a quote, a backslash or a control byte whatever
                # `core.quotePath` says. Refused whole rather than dropped: `check_branch_diff`
                # then says the diff readers did not run, where a silent drop reads as a pass.
                return None
            rel, number = target[2:] if target.startswith("b/") else "", 0
        elif match := HUNK_HEADER_RE.match(line):
            number, in_header = int(match.group(1)), False
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
        # By whole name, as `_bounded` and `kernel.py :: _of_kind` select the same population: an
        # `endswith` also admits a page whose own name merely ENDS in one, `docs/<page>-pre-commit`,
        # which neither of those two holds.
        if not (rel.endswith((*SCANNED_SUFFIXES, ".md")) or rel.rsplit("/", 1)[-1] in OPS_FILENAMES):
            continue
        scanned = _scan_body(REPO_ROOT / rel).split("\n")
        for number, _ in lines:
            text = scanned[number - 1].strip() if number <= len(scanned) else ""
            if text:
                additions.setdefault(rel, []).append(text)
    return additions


def check_history_phrases(additions: dict[str, list[str]]) -> list[Finding]:
    """COR-3's banned shapes over what the branch added.

    One finding per file naming its phrases, never a branch-wide count: this check is the only
    thing between an author and a green gate, and a count names nowhere to look.
    """
    found: list[Finding] = []
    for rel in sorted(additions):
        hits = [match.group(0).strip().lower() for line in additions[rel] for match in HISTORY_RE.finditer(line)]
        if not hits:
            continue
        phrases = ", ".join(f"'{phrase}'" for phrase in sorted(set(hits)))
        detail = f"{len(hits)} added line(s) match a COR-3 history phrase ({phrases}) -- rewrite them in the present"
        found.append(Finding("fail", "history", rel, detail))
    return found


DIFF_READERS: Final = "history, added comment citations and comment length"


def check_branch_diff(branch: Branch) -> list[Finding]:
    """The one finding covering every check that reads the branch's added lines.

    They read one diff through `_added_by_file` and degrade together, so reporting separately would
    be the same sentence several times.
    """
    if branch.fork is None:
        return [_branch_scope_skipped(DIFF_READERS, branch.unresolved)]
    if _added_by_file(branch.fork) is not None:
        return []
    return [_branch_scope_skipped(DIFF_READERS, "read this branch's diff")]


def _bounded(rel: str) -> bool:
    """Whether INC-9's bound reaches this file, by kind and never by tree.

    `comment_style` hands an unrecognised kind to the `#` reader, so a CSS id selector under
    `fl_frontend/src/` would be read as a comment run and bounded.
    """
    return rel.endswith(SCANNED_SUFFIXES) or rel.rsplit("/", 1)[-1] in OPS_FILENAMES


def check_comment_bounds(branch: Branch) -> list[Finding]:
    """INC-9's bound, over the comment blocks this branch wrote."""
    # Silent here: `check_branch_diff` already names this check among those reading one diff.
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
