"""SCRIPTS · the documentation gate's fixture net

Every check `scripts/check_docs.py :: CHECKS` registers is driven twice: it must report a planted
violation and say nothing about a corpus with none. The gate takes no path argument, so the seam is
a throwaway repository holding a copy of scripts/ — the checker's REPO_ROOT is derived from its own
location, and a copy therefore roots it in the fixture with nothing rebound.

Invariants:
- Stdlib only. The type checker reads scripts/ with no environment declared, so an import it cannot
  resolve is a gate failure rather than a missing package.
- A planted violation never shares a line of THIS file with a hash or a triple quote, because the
  gate reads a source file's comments and would otherwise find the plant here.
See:
- scripts/check_docs.py — the gate under test
"""

from __future__ import annotations

import atexit
import contextlib
import importlib
import io
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Final

REPO_ROOT: Final = Path(__file__).resolve().parent.parent.parent

# Built rather than written, so no line of this file carries the markdown or the comment marker the
# corpus needs -- either one would make the gate read the fixture text as this file's own comment.
HASH: Final = "#"
QUOTES: Final = '"' * 3

PLACEHOLDER_SHA: Final = "0000000"
STAMP_DATE: Final = "2026-08-10"
RESTAMP_DATE: Final = "2026-08-11"
ABSENT_SHA: Final = "0abc123"

NOTES: Final = "docs/notes.md"
# A second page of the same basename, so a bare-name citation can be made to resolve twice; and a
# file no scan reads, so a citation can name something unreadable without `unreadable` firing too.
TWIN_NOTES: Final = "docs/frontend/notes.md"
UNDECODABLE: Final = "docs/data.bin"
SAMPLE: Final = "fl_backend/app/sample.py"
SECOND_SAMPLE: Final = "fl_backend/app/second.py"
THIRD_SAMPLE: Final = "fl_backend/app/spare.py"
LABEL_SAMPLE: Final = "fl_backend/app/label.py"
# A tracked path no ASCII listing can spell: without `git ls-files -z` it comes back quoted, resolves
# to nothing, and drops out of the scan with whatever it carried.
UMLAUT_MODULE: Final = "fl_backend/app/übersicht.py"
# One file per scanned format that is neither markdown nor Python. `.toml`, `.yaml`, `.conf`,
# `.sh` and a Dockerfile share the `#` reader but reach it three ways -- by suffix, by fallback,
# by whole filename -- and `.json` has a reader of its own.
TOML_CONFIG: Final = "fl_backend/pyproject.toml"
YAML_CONFIG: Final = "fl_frontend/pnpm-workspace.yaml"
JSON_CONFIG: Final = "fl_frontend/tsconfig.json"
CONF_FILE: Final = "nginx/nginx.conf"
SHELL_FILE: Final = "nginx/entrypoint.sh"
DOCKERFILE: Final = "fl_backend/Dockerfile"
CORE: Final = "docs/_standard/chapters/1-core.md"
CURRENCY: Final = "docs/_standard/chapters/5-currency.md"
RULES_INDEX: Final = "docs/_standard/rules-index.md"
GLOSSARY: Final = "docs/glossary.md"
BACKEND_SPEC: Final = "docs/backend/spec.md"
FRONTEND_SPEC: Final = "docs/frontend/spec.md"
OVERVIEW: Final = "docs/backend/overview.md"
FRONTEND_OVERVIEW: Final = "docs/frontend/overview.md"
EXTRA_CHAPTER: Final = "docs/_standard/chapters/9-extra.md"
ADR: Final = "docs/_decisions/0001-the-gate-has-a-fixture-net.md"
SECOND_ADR: Final = "docs/_decisions/0002-a-record-with-wrong-values.md"
THIRD_ADR: Final = "docs/_decisions/0003-a-record-naming-another.md"
# Written by a plant and deliberately never staged: the record a citation resolves to on the
# machine that wrote it and on no clean checkout, which is the whole of what `tracked_glob` buys.
FOURTH_ADR: Final = "docs/_decisions/0004-a-record-nobody-added.md"
# What a reciprocity finding names in place of a path: `check_adr_meta` reports across records and
# has only the number to hand.
SECOND_ADR_GLOB: Final = "docs/_decisions/0002-*"
THIRD_ADR_GLOB: Final = "docs/_decisions/0003-*"
ADR_INDEX: Final = "docs/_decisions/README.md"
ROADMAP: Final = "docs/_roadmap/open-items.md"
# The tooling half of the split roadmap, so the shape check has more than the one ranked page to
# loop over.
TOOLING_ROADMAP: Final = "docs/_roadmap/tooling-items.md"
# Its one ranked item. The corpus writes the row and the entry, the plant rewrites them, and one
# spelling here is what keeps the page the plant edits and the page the corpus holds in step.
TOOLING_ITEM: Final = "Rank the tooling work apart"
TOOLING_ROW: Final = "| 1 | TL-1 | " + TOOLING_ITEM + " |"
TOOLING_ENTRY: Final = "1 · TL-1 — " + TOOLING_ITEM
TEMPLATES: Final = "docs/_git/templates.md"
SWEEP: Final = ".claude/commands/docs/audit.md"
ROOT_README: Final = "README.md"
UNTRACKED_DIR: Final = "untracked"
UNTRACKED_TWIN: Final = UNTRACKED_DIR + "/glossary.md"
# What a branch-wide finding names in place of a file, because the phrases it counts are the diff's
# rather than any one page's.
BRANCH_DIFF: Final = "(branch diff)"

# The partition, anchored on folder names rather than `**/*`: a path git spelled in quotes, which a
# listing without `-z` returns for a name outside ASCII, then matches no segment and reads as
# unclaimed.
FOLDER_SEGMENT: Final = "| Folders | `docs/**` · `fl_backend/**` · `fl_frontend/**` · `nginx/**` · `.claude/**` |"
ROOT_SEGMENT: Final = "| Root files | `*` |"

SCRIPTS_COPY: Final = "scripts"
HOOKS_STUB: Final = "nohooks"
# What the fixture is BUILT out of rather than checked. Naming what must SURVIVE the reset keeps this
# from growing with the corpus, which is the list nobody remembers to extend.
PRESERVED: Final[tuple[str, ...]] = (SCRIPTS_COPY, HOOKS_STUB, UNTRACKED_DIR)


def _heading(level: int, text: str) -> str:
    return HASH * level + " " + text


def _page(*lines: str) -> str:
    return "\n".join(lines) + "\n"


def _stamp() -> str:
    return "**Verified against:** `" + PLACEHOLDER_SHA + "`, " + STAMP_DATE


def _corpus(checks: dict[str, frozenset[str]], fragments: tuple[str, ...]) -> dict[str, str]:
    """The clean corpus, keyed by repository path.

    Two pages are derived from the checker's own constants: the currency chapter's table, which
    `check-registry` compares against `CHECKS` name by name, and the pull request form, which
    `template-fragment` compares against the body gate's quoted prose. A hand-written copy of
    either would go stale the day a check or a fragment is added, and the fixture would then fail
    for a reason that has nothing to do with the split it exists to prove.
    """
    rows = [
        "| `" + name + "` | The finding names it | " + verdict.capitalize() + " |"
        for name in sorted(checks)
        for verdict in sorted(checks[name])
    ]
    return {
        ".gitattributes": _page("* text=auto eol=lf"),
        ROOT_README: _page(
            _heading(1, "Fixture repository"),
            "",
            "A minimal corpus the documentation gate is driven against.",
        ),
        NOTES: _page(
            _heading(1, "Notes"),
            "",
            "A page with no stamp, which is where a planted violation is written.",
            "",
            "A bare name resolves to the tracked file alone: `glossary.md :: the competition year`.",
            "",
            # A schemeless host and port has the shape of a line citation once the scheme is off the
            # line. Both spellings, because the backticked pattern was narrowed alongside the bare one.
            "Connect to example.com:443, or to api.test:8080.",
            "",
            "The host `example.com:443` is named in backticks as well.",
            "",
            # Metadata labels on one line, parted by a visible separator -- an audit report's header
            # shape. What parts it from a joined pair is the character before the label, nothing else.
            "**Programme:** the fixture net · **Method:** a planted corpus",
            "",
            # An underscore survives GitHub's slugger and a repeated heading takes a `-N` suffix, so
            # both fragments below resolve. The link text carries no ordinal: `counts` reads one.
            _heading(2, "The saison_id field"),
            "",
            "A link to [the field](#the-saison_id-field) resolves.",
            "",
            _heading(2, "Setup"),
            "",
            _heading(2, "Setup"),
            "",
            "A link to [the repeated heading](#setup-1) resolves.",
        ),
        TWIN_NOTES: _page(
            _heading(1, "Frontend notes"),
            "",
            "A second page of this basename, so a bare name can be made to resolve twice.",
            "",
            # The cross-file half of the same slugger change: `anchor` has two producers and the
            # in-page one above would leave this half unproven.
            "A cross-file link to [the field](../notes.md#the-saison_id-field) resolves too.",
        ),
        GLOSSARY: _page(
            _heading(1, "Glossary"),
            "",
            _stamp(),
            "",
            "The vocabulary, one entry each.",
            "",
            _heading(2, "Terms"),
            "",
            _heading(3, "`saison` — the competition year"),
            "",
            "**Is:** the year a competition runs in.",
            "",
            "**In code:** the field name every layer spells alike.",
            "",
            "**Trap:** it reads as a calendar year and spans more than one.",
            "",
            "**See:** the sheet that fixes the field's shape.",
        ),
        BACKEND_SPEC: _page(
            _heading(1, "Backend — spec"),
            "",
            _stamp(),
            "",
            "The contract the store answers to. `fl_backend/app/sample.py` holds the sample module.",
            "",
            _heading(2, "1. Contract"),
            "",
            _heading(3, "1.1 The read path"),
            "",
            "It answers with one document.",
            "",
            _heading(2, "2. Invariants"),
            "",
            "| ID | Invariant | Why | Breaks how |",
            "| --- | --- | --- | --- |",
            "| I1 | The write path validates its input | Bad data is permanent | A malformed document is stored and read back later |",
            "",
            _heading(2, "3. Violation → remedy"),
            "",
            "| Symptom | Remedy |",
            "| --- | --- |",
            "| A malformed document | Delete it and post again |",
            "",
            _heading(2, "4. Known-open"),
            "",
            "Nothing is open.",
        ),
        FRONTEND_SPEC: _page(
            _heading(1, "Frontend — spec"),
            "",
            _stamp(),
            "",
            "The contract the pages answer to.",
            "",
            _heading(2, "1. Contract"),
            "",
            _heading(3, "1.1 The route"),
            "",
            "It renders one page.",
            "",
            _heading(2, "2. Invariants"),
            "",
            "| ID | Invariant | Why | Breaks how |",
            "| --- | --- | --- | --- |",
            "| I1 | A route names its own data | A shared name hides its source | The page renders a value nobody can trace |",
            "",
            _heading(2, "3. Violation → remedy"),
            "",
            "| Symptom | Remedy |",
            "| --- | --- |",
            "| An untraceable value | Name the route's own data |",
            "",
            _heading(2, "4. Known-open"),
            "",
            "Nothing is open.",
        ),
        OVERVIEW: _page(
            _heading(1, "Backend — overview"),
            "",
            _stamp(),
            "",
            "A router, a service and a store.",
            "",
            _heading(2, "How it is organised"),
            "",
            "Layers, each answering to the one above it.",
            "",
            _heading(2, "Read next"),
            "",
            "The sheet beside this page.",
        ),
        FRONTEND_OVERVIEW: _page(
            _heading(1, "Frontend — overview"),
            "",
            _stamp(),
            "",
            "A route, a view and a store.",
            "",
            _heading(2, "How it is organised"),
            "",
            "Routes, each rendering one view.",
            "",
            _heading(2, "Read next"),
            "",
            "The sheet beside this page.",
        ),
        CORE: _page(
            _heading(1, "Core rules"),
            "",
            # The one page whose metadata block runs to two entries, so the break rule has both a
            # line that must carry one and a line that must not -- and so a join has something to
            # join to. Every other stamped page carries a block of one.
            _stamp() + "\\",
            "**Applies to:** every written artifact this corpus holds.",
            "",
            "| ID | Rule |",
            "| --- | --- |",
            "| COR-1 | Write for a reader with no context |",
            "",
            _heading(3, "COR-1 — Write for a reader with no context"),
            "",
            "**Rule:** every page is understandable to a reader meeting the repository for the first time.",
            "",
            "**Why:** the author has the context and cannot feel its absence.",
            "",
            "**Exceptions:** —",
            "",
            "**Enforced by:** `citation` and `path`.",
            "",
            "**Example:** a lesson survives as a rule stated in the present tense.",
        ),
        CURRENCY: _page(
            _heading(1, "Currency rules"),
            "",
            _stamp(),
            "",
            "| ID | Rule |",
            "| --- | --- |",
            "| CUR-5 | Every gate check takes a row in the table |",
            "",
            _heading(3, "CUR-5 — Every gate check takes a row in the table below"),
            "",
            "**Rule:** the table lists every check the gate emits, at the verdict it emits.",
            "",
            "**Why:** the table is the one place a check's meaning is written down.",
            "",
            "**Exceptions:** —",
            "",
            "**Enforced by:** `check-registry`.",
            "",
            "**Example:** a check added with no row fails the gate until the row exists.",
            "",
            _heading(2, "The checks"),
            "",
            "| Check | Means | Verdict |",
            "| --- | --- | --- |",
            *rows,
        ),
        RULES_INDEX: _page(
            _heading(1, "Rules index"),
            "",
            "Every rule in one line, with the chapter stating it.",
            "",
            _heading(2, "[Core rules](chapters/1-core.md)"),
            "",
            "- **COR-1:** write for a reader with no context.",
            "",
            _heading(2, "[Currency rules](chapters/5-currency.md)"),
            "",
            "- **CUR-5:** every gate check takes a row in the currency chapter's table.",
        ),
        ADR_INDEX: _page(
            _heading(1, "Decisions"),
            "",
            "**Folder purpose:** one file per decision, append-only.",
            "",
            "| ADR | Title |",
            "| --- | --- |",
            "| [0001](0001-the-gate-has-a-fixture-net.md) | The gate has a fixture net |",
        ),
        ADR: _adr("0001", "The documentation gate has a fixture net"),
        ROADMAP: _page(
            _heading(1, "Open items"),
            "",
            "**Purpose:** what is open, ranked.",
            "",
            "| Rank | ID | Item |",
            "| --- | --- | --- |",
            "| 1 | FX-1 | Give the gate a fixture net |",
            "",
            _heading(3, "1 · FX-1 — Give the gate a fixture net"),
            "",
            "**Status:** Open",
        ),
        TOOLING_ROADMAP: _page(
            _heading(1, "Tooling items"),
            "",
            "**Purpose:** what is open in the tooling, ranked.",
            "",
            "| Rank | ID | Item |",
            "| --- | --- | --- |",
            TOOLING_ROW,
            "",
            _heading(3, TOOLING_ENTRY),
            "",
            "**Status:** Open",
        ),
        TEMPLATES: _page(
            _heading(1, "Templates"),
            "",
            "**Purpose:** the form a pull request body is written to.",
            "",
            _heading(2, "Pull requests"),
            "",
            *["- " + fragment for fragment in fragments],
        ),
        SWEEP: _page(
            _heading(1, "Sweep the documentation"),
            "",
            "**Purpose:** read every document against the standard.",
            "",
            "| Excluded | Why |",
            "| --- | --- |",
            "| `LICENSE` | Not ours to edit |",
            "",
            "| Segment | Globs |",
            "| --- | --- |",
            FOLDER_SEGMENT,
            ROOT_SEGMENT,
        ),
        SAMPLE: _page(
            QUOTES + "BACKEND · a sample module the corpus scans." + QUOTES,
            "",
            "VALUE = 1",
            "",
            # A dead path inside a string literal, on a line that also carries a real comment. A
            # line-grain reader keeps the whole line and reports the literal; a tokenizer keeps the
            # comment alone. The comment is what makes the two readers disagree.
            'S = "docs/gone-in-a-literal.md"  # a real comment',
        ),
        SECOND_SAMPLE: _page(
            QUOTES + "BACKEND · a module beside the sample, so one check can speak about more than one file." + QUOTES,
            "",
            "OTHER = 1",
            "",
            # A triple-quoted string that is not a docstring. The line-grain reader treated the
            # opening quotes as a block and kept everything to the next odd count of them.
            "TEXT = " + QUOTES + "docs/gone-in-a-block.md" + QUOTES,
        ),
        THIRD_SAMPLE: _page(
            QUOTES + "BACKEND · a module for the shouty shape, which the other two exclude." + QUOTES,
            "",
            "SPARE = 1",
        ),
        LABEL_SAMPLE: _page(
            QUOTES + "BACKEND · a module for the label shape, which the other two exclude." + QUOTES,
            "",
            "LABELLED = 1",
        ),
        UMLAUT_MODULE: _page(
            QUOTES + "BACKEND · a module whose own name no ASCII listing can spell." + QUOTES,
            "",
            "UMLAUT = 1",
        ),
        TOML_CONFIG: _page(
            "# A configuration file, scanned for its comments and nothing else.",
            "",
            "[project]",
            'name = "fixture"',
        ),
        YAML_CONFIG: _page(
            "# A configuration file, scanned for its comments and nothing else.",
            "packages:",
            "  - fixture",
        ),
        CONF_FILE: _page(
            "# A server block, scanned for its comments and nothing else.",
            "server { listen 80; }",
        ),
        SHELL_FILE: _page(
            "#!/usr/bin/env bash",
            "# An entry point, scanned for its comments and nothing else.",
            "exec nginx",
        ),
        DOCKERFILE: _page(
            "# An image, reached by whole filename rather than by suffix.",
            "FROM scratch",
        ),
        JSON_CONFIG: _page(
            "{",
            "  // A configuration file, scanned for its comments and nothing else.",
            # The three negatives separating a parser from a line rule: a `/*` in a value opens
            # a runaway block under the C-style reader, a `//` in a value reads as a comment, and
            # a `#` proves this format never reaches the shell reader. All three stay silent.
            '  "include": ["**/*.ts", "docs/gone-in-a-glob.md"],',
            '  "$schema": "https://example.invalid/docs/gone-in-a-url.md",',
            '  "note": "a # b"',
            "}",
        ),
    }


def _adr(number: str, title: str) -> str:
    """One decision record in the anatomy `adr-meta` holds every ADR to."""
    return _page(
        _heading(1, "ADR-" + number + " — " + title),
        "",
        "**Status:** Accepted\\",
        "**Date:** " + STAMP_DATE + "\\",
        "**Surface:** ops\\",
        "**Supersedes:** —\\",
        "**Superseded by:** —\\",
        "**Source:** Decided while rebuilding the gate.",
        "",
        _heading(2, "Context"),
        "",
        "Nothing exercised the gate's checks.",
        "",
        _heading(2, "Decision"),
        "",
        "A corpus with a planted violation per check.",
        "",
        _heading(2, "Consequences"),
        "",
        "A rewrite of the gate has a regression net.",
        "",
        _heading(2, "Alternatives considered"),
        "",
        "A hand review, rejected as unrepeatable.",
    )


# --- the fixture repository ---------------------------------------------------------------------


def _git(root: Path, *args: str) -> str:
    done = subprocess.run(("git", *args), cwd=root, capture_output=True, text=True, encoding="utf-8", check=False)
    if done.returncode != 0:
        # Raised with git's own message: a fixture that fails to build otherwise reports a bare exit
        # code, and the case that follows then fails for a reason nothing in the output explains.
        raise RuntimeError("git " + " ".join(args) + " failed: " + (done.stderr.strip() or done.stdout.strip()))
    return done.stdout.strip()


def _write(root: Path, rel: str, text: str) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    # Bytes, never write_text: that emits CRLF on Windows, and `line-endings` would report the whole
    # corpus rather than the one file a case plants.
    path.write_bytes(text.encode("utf-8"))


def _build(root: Path, pages: dict[str, str]) -> str:
    """Write and commit the corpus, stamp it, and return a commit HEAD cannot reach."""
    for rel, text in pages.items():
        _write(root, rel, text)
    # Tracked, and outside every scanned suffix, so a citation can name a file the reader cannot
    # decode without `unreadable` firing about the same file and hiding which check spoke.
    (root / UNDECODABLE).write_bytes(b"\xff\xfe\x00 not text \x00")

    (root / HOOKS_STUB).mkdir()
    _git(root, "init", "-b", "main")
    for name, value in (("user.name", "fixture"), ("user.email", "fixture@example.invalid"), ("commit.gpgsign", "false")):
        _git(root, "config", name, value)
    _git(root, "config", "core.hooksPath", str(root / HOOKS_STUB))
    # The corpus by name, never `add -A`: the copy of scripts/ sits in this tree too, and tracking it
    # would put this repository's own documentation through a gate holding the fixture's corpus.
    _git(root, "add", "--", *pages, UNDECODABLE)
    _git(root, "commit", "-m", "Corpus: the gate finds nothing here")

    verified = _git(root, "rev-parse", "--short=7", "HEAD")
    for rel, text in pages.items():
        if PLACEHOLDER_SHA in text:
            _write(root, rel, text.replace(PLACEHOLDER_SHA, verified))
    _git(root, "add", "--", *pages, UNDECODABLE)
    _git(root, "commit", "-m", "Corpus: every stamp names the commit it was read against")

    # An untracked twin of a corpus page: the bare name the notes page cites must resolve past it.
    # `_reset` asserts it survives, because a deleted twin resolves that citation for the wrong reason.
    _write(root, UNTRACKED_TWIN, (root / GLOSSARY).read_text(encoding="utf-8"))

    # A commit this clone HOLDS but HEAD cannot reach, which is what a stamp naming a dropped branch
    # looks like -- the only way to tell it from a commit the clone never had. Kept on a ref.
    aside = _git(root, "commit-tree", "HEAD^{tree}", "-m", "A commit no branch of this history reaches")
    _git(root, "branch", "aside", aside)
    return aside[:7]


@dataclass(frozen=True)
class Fixture:
    """The gate as the fixture repository sees it: the copied modules, and the root they resolve to."""

    gate: ModuleType
    body_gate: ModuleType
    root: Path
    # A real commit that is not an ancestor of HEAD, for the stamp finding that needs one.
    unreachable_sha: str


def _load() -> Fixture:
    """The checker, imported from a copy of scripts/ inside a fresh fixture repository."""
    root = Path(tempfile.mkdtemp(prefix="check-docs-fixture-")).resolve()
    atexit.register(shutil.rmtree, root, True)
    shutil.copytree(REPO_ROOT / SCRIPTS_COPY, root / SCRIPTS_COPY, ignore=shutil.ignore_patterns("__pycache__", "tests"))
    sys.path.insert(0, str(root / SCRIPTS_COPY))
    gate = importlib.import_module("check_docs")
    # The seam itself, stated as an assertion: the checker derives its repository root from its own
    # location, so importing this copy is what points every check at the corpus below instead of here.
    assert Path(gate.__file__ or "").resolve().parent.parent == root, "the gate under test is not the copy"
    body_gate = importlib.import_module("check_pr_body")
    unreachable = _build(root, _corpus(gate.CHECKS, body_gate.TEMPLATE_FRAGMENTS))
    return Fixture(gate, body_gate, root, unreachable)


_STATE: list[Fixture] = []


def _gate() -> Fixture:
    if not _STATE:
        _STATE.append(_load())
    return _STATE[0]


def _module(name: str) -> ModuleType:
    """One of the gate's own modules, from the copy inside the fixture repository.

    The entry point re-exports the names the corpus cites and nothing else. A check reached only
    from inside the package is reached by its own module here, rather than added to that list --
    which would put a name in the shipped file that exists for a test.
    """
    module = importlib.import_module(name)
    assert Path(module.__file__ or "").resolve().is_relative_to(_gate().root), name + " is not the copy under test"
    return module


# --- driving it ----------------------------------------------------------------------------------

FINDING_RE: Final = re.compile(r"\[([a-z][a-z0-9-]*)\]$")
FAILING: Final = "failing finding"
ADVISORY: Final = "advisory finding"

# One printed finding. The file separates a check that fires from one firing about the wrong page;
# counting the triples separates a check with two producers from one that has lost one.
Reported = tuple[str, str, str]


def _reported(output: str) -> Counter[Reported]:
    """Every finding the run printed, counted.

    Read from the output rather than from the `Finding` objects, because what has to be proven is
    that a check reaches a person: a check whose findings are built and dropped is the failure this
    net exists to catch, and only the printed line shows the difference. `Finding.line` puts the file
    first and the check last, so both halves of the triple come off the same line.
    """
    severity = ""
    seen: Counter[Reported] = Counter()
    stray: list[str] = []
    for line in output.split("\n"):
        text = line.strip()
        if FAILING in text:
            severity = "fail"
        elif ADVISORY in text:
            severity = "report"
        elif (match := FINDING_RE.search(text)) is None:
            continue
        # A finding under no severity heading means the run's shape moved. Left silent it would read
        # as a check that stopped firing, which is the one answer this file must not invent.
        elif severity:
            seen[(severity, match.group(1), text.partition(": ")[0])] += 1
        else:
            stray.append(text)
    if stray:
        raise RuntimeError("findings printed under no severity heading: " + "\n".join(stray))
    return seen


def _shape(findings: Counter[Reported]) -> str:
    """A counted finding set as one readable line, for the message a failing case carries."""
    if not findings:
        return "nothing"
    return ", ".join(f"{count}x {severity} {check} in {rel}" for (severity, check, rel), count in sorted(findings.items()))


def _clear_caches(scripts_dir: Path) -> None:
    """Every `functools.cache` in the checker, so one case's reads never answer the next one."""
    for module in list(sys.modules.values()):
        origin = getattr(module, "__file__", None)
        if origin is None or scripts_dir not in Path(origin).resolve().parents:
            continue
        for value in vars(module).values():
            clear = getattr(value, "cache_clear", None)
            if callable(clear):
                clear()


def _run() -> tuple[int, Counter[Reported]]:
    fixture = _gate()
    _clear_caches(fixture.root / SCRIPTS_COPY)
    buffer = io.StringIO()
    argv = sys.argv
    sys.argv = ["check_docs.py", "--all"]
    try:
        with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(buffer):
            code = int(fixture.gate.main())
    finally:
        sys.argv = argv
    return code, _reported(buffer.getvalue())


def _assert_corpus_restored() -> None:
    """No case left the index carrying something the reset cannot reach. Once per run, not per case.

    `git checkout HEAD -- .` reaches only paths HEAD knows and `git clean` skips whatever the index
    tracks, so a plant that staged a NEW file would leave it on disk and in `git ls-files` -- part of
    the corpus every case below it is measured against. Three plants stage one, which is what makes
    this assertion load-bearing rather than a written-down constraint, and it costs one process
    against the forty a run already spends.
    """
    dirty = _git(_gate().root, "status", "--porcelain", "-uno")
    assert dirty == "", "a case left the index or the tree changed after the reset:\n" + dirty


def _reset() -> None:
    """The corpus as it was committed, with only `PRESERVED` left standing.

    The index comes back to HEAD first, because a file a plant staged is tracked: `git clean` skips
    it and `git checkout HEAD --` cannot reach a path HEAD never held, so it would survive as part
    of the corpus every case after it is measured against. The pathspec form rewrites the index
    alone and never the working tree, which the restore below then owns.

    That restore names HEAD rather than the index: a bare `git checkout -- .` restores what is
    STAGED, which would hand a plant's own edit to the cases after it, silently.
    """
    root = _gate().root
    excludes = [argument for name in PRESERVED for argument in ("-e", "/" + name)]
    _git(root, "reset", "-q", "HEAD", "--", ".")
    _git(root, "checkout", "HEAD", "--", ".")
    _git(root, "clean", "-fdq", *excludes)
    # The twin only guards while it is untracked and outside the reset's reach. Moving it inside would
    # leave the bare-name citation resolving for the wrong reason, with the suite still green.
    assert (root / UNTRACKED_TWIN).is_file(), UNTRACKED_TWIN + " did not survive the reset, so it guards nothing"


# --- the plants ----------------------------------------------------------------------------------


def _read(rel: str) -> str:
    root = _gate().root
    return (root / rel).read_text(encoding="utf-8")


def _restamp(rel: str) -> None:
    _replace(rel, ", " + STAMP_DATE, ", " + RESTAMP_DATE)


def _replace(rel: str, old: str, new: str, *, restamp: bool = False) -> None:
    root = _gate().root
    text = _read(rel)
    assert old in text, "the corpus no longer carries " + repr(old) + " in " + rel
    _write(root, rel, text.replace(old, new, 1))
    if restamp:
        _restamp(rel)


def _stage(*rels: str) -> None:
    """A file a plant ADDED, put in the index so the gate reads it.

    The corpus the gate resolves against is `git ls-files`, so a page written and left untracked is
    a page no check sees and no citation resolves to. `_reset` unstages it again.
    """
    _git(_gate().root, "add", "--", *rels)


def _append(rel: str, *lines: str, restamp: bool = False) -> None:
    root = _gate().root
    _write(root, rel, _read(rel) + "\n" + "\n".join(lines) + "\n")
    if restamp:
        _restamp(rel)


def _drop(rel: str, line: str, *, restamp: bool = False) -> None:
    _replace(rel, line + "\n", "")
    if restamp:
        _restamp(rel)


def _stamp_line(rel: str) -> str:
    return next(line for line in _read(rel).split("\n") if line.startswith("**Verified against:**"))


def _delete(rel: str) -> None:
    root = _gate().root
    (root / rel).unlink()


def _index_row(rel: str) -> str:
    """The row `adr-index` reads, so a record a plant adds does not also read as one with no row."""
    name = Path(rel).name
    return "| [" + name[:4] + "](" + name + ") | A record a plant added |"


def _plant_second_adr() -> None:
    """Both producers: an index row naming another number's file, and a file with no row at all."""
    _write(_gate().root, SECOND_ADR, _adr("0002", "A decision with no index row"))
    _stage(SECOND_ADR)
    _append(ADR_INDEX, "| [0003](0001-the-gate-has-a-fixture-net.md) | A row naming another number's file |")


def _plant_adr_citations() -> None:
    """Both producers: a number with no file anywhere, and one whose file is on disk but un-added.

    The second is what pins `tracked_glob`. A number with no file cannot tell a tracked record from
    a merely present one, so on its own this case stays green with the resolver reading the disk.
    """
    _append(NOTES, "See ADR-9999 for the argument.")
    _write(_gate().root, FOURTH_ADR, _adr("0004", "A record nobody added"))
    _append(NOTES, "See ADR-0004 for the rest of it.")


def _plant_rule_index() -> None:
    """Both producers: a rule with no line in the index, and a rule taking two."""
    _drop(RULES_INDEX, "- **COR-1:** write for a reader with no context.")
    _append(RULES_INDEX, "- **CUR-5:** every gate check takes a row in the currency chapter's table.")


def _plant_rule_shapes() -> None:
    """All three producers: fields out of shape, a rule with no table row, and a heading with no claim."""
    _drop(CORE, "**Exceptions:** —")
    _drop(CORE, "| COR-1 | Write for a reader with no context |", restamp=True)
    _replace(
        CURRENCY,
        _heading(3, "CUR-5 — Every gate check takes a row in the table below"),
        _heading(3, "CUR-5 stated as a title rather than a claim"),
        restamp=True,
    )


def _plant_glossary() -> None:
    """Both shape producers: fields that are not OUT-6's, and a heading that is not either."""
    _replace(GLOSSARY, "**Trap:**", "**Pitfall:**")
    _replace(GLOSSARY, _heading(3, "`saison` — the competition year"), _heading(3, "saison, the competition year"), restamp=True)


def _plant_invariant_rows() -> None:
    """Three producers: a row stating no failure mode, a repeated id, and a row of the wrong width."""
    _replace(
        BACKEND_SPEC,
        "| I1 | The write path validates its input | Bad data is permanent | A malformed document is stored and read back later |",
        "| I1 | The write path validates its input | Bad data is permanent | See the runbook |\n"
        "| I1 | A row repeating an id | A number is permanent | The reader cannot tell which rule is meant |",
        restamp=True,
    )
    _replace(
        FRONTEND_SPEC,
        "| I1 | A route names its own data | A shared name hides its source | The page renders a value nobody can trace |",
        "| I1 | A route names its own data | The page renders a value nobody can trace |",
        restamp=True,
    )


def _plant_overviews() -> None:
    """Both spine producers: a page that does not close on OUT-5's heading, and one that does not open on it."""
    _replace(OVERVIEW, _heading(2, "Read next"), _heading(2, "Where next"), restamp=True)
    _replace(FRONTEND_OVERVIEW, _heading(2, "How it is organised"), _heading(2, "The shape of it"), restamp=True)


def _plant_spec_spines() -> None:
    """Both producers: sections that are not OUT-4's, and a contract numbered with a gap."""
    _replace(BACKEND_SPEC, _heading(2, "4. Known-open"), _heading(2, "4. Open questions"), restamp=True)
    _replace(FRONTEND_SPEC, _heading(3, "1.1 The route"), _heading(3, "1.2 The route"), restamp=True)


def _plant_check_registry() -> None:
    """Three producers: a row this gate does not emit, a check with no row, and a row at the wrong verdict."""
    _append(CURRENCY, "| `not-a-check` | The finding names it | Fail |", restamp=True)
    _drop(CURRENCY, "| `adr` | The finding names it | Fail |")
    _replace(CURRENCY, "| `link` | The finding names it | Fail |", "| `link` | The finding names it | Report |")


def _plant_module_headers() -> None:
    """All of INC-2's shapes, one module per shape that excludes another.

    The ruled line, the shouty row and the foreign label are arms of one chain, so only one of them
    can fire about any given line: planted in one module they would share a file and a count, and
    swapping two of them would move neither. A module apiece is what tells them apart.
    """
    _replace(
        SAMPLE,
        QUOTES + "BACKEND · a sample module the corpus scans." + QUOTES,
        _page(
            QUOTES + "a title with no separator in it",
            "─" * 12,
            *["a filler line carrying the header past its cap" for _ in range(18)],
            QUOTES,
        ).rstrip("\n"),
    )
    _replace(
        SECOND_SAMPLE,
        QUOTES + "BACKEND · a module beside the sample, so one check can speak about more than one file." + QUOTES + "\n\nOTHER = 1",
        _page("OTHER = 1", "", HASH + " BACKEND · a header sitting below the first statement").rstrip("\n"),
    )
    # A run of `#` lines is a header by placement alone: `_header_line` strips a docstring's quotes
    # and a shell hash, never a Python one, so these two shapes need a docstring to be read at all.
    _replace(
        THIRD_SAMPLE,
        QUOTES + "BACKEND · a module for the shouty shape, which the other two exclude." + QUOTES,
        _page(QUOTES + "BACKEND · a header with a row of its own.", "", "SHOUTY LABEL ROW", QUOTES).rstrip("\n"),
    )
    _replace(
        LABEL_SAMPLE,
        QUOTES + "BACKEND · a module for the label shape, which the other two exclude." + QUOTES,
        _page(QUOTES + "BACKEND · a header carrying a label of its own.", "", "Notes:", QUOTES).rstrip("\n"),
    )


def _plant_roadmap() -> None:
    """Every shape a ranked page can lose -- rows, entries, ranks, ids, a transient status -- and a subset on the tooling page.

    The check reads a LOOP of ranked pages, and a plant confined to the product page cannot tell
    that loop from a check stopping at the page it opens with: either reports the same findings.
    The tooling page carries fewer of them, so a finding attributed to the wrong page is a
    shortfall on one side and a surplus on the other rather than a wash.
    """
    _replace(
        ROADMAP,
        "| 1 | FX-1 | Give the gate a fixture net |",
        "| 1 | FX-1 | Give the gate a fixture net |\n| 3 | FX-2 | A row with no entry below it | Closed |",
    )
    _replace(ROADMAP, _heading(3, "1 · FX-1 — Give the gate a fixture net"), _heading(3, "4 · FX-1 — Give the gate a fixture net"))
    _append(ROADMAP, _heading(3, "2 · FX-9 — An entry no table defines"), "", "**Status:** Closed")
    _replace(TOOLING_ROADMAP, TOOLING_ROW, TOOLING_ROW + "\n| 2 | TL-2 | A tooling row with no entry below it |")
    _replace(TOOLING_ROADMAP, _heading(3, TOOLING_ENTRY), _heading(3, "2 · TL-1 — " + TOOLING_ITEM))


def _plant_segment_map() -> None:
    """Both producers: a tracked file no segment claims, and files two segments claim.

    Narrowing the folder row to the documents leaves every source and configuration file unclaimed,
    and the second row naming the same glob claims each document twice.
    """
    _replace(SWEEP, FOLDER_SEGMENT, "| Folders | `docs/**` |\n| Also the documents | `docs/**` |")


def _plant_adr_meta() -> None:
    """Twelve of the thirteen shapes DEC-2 and DEC-3 fix, across three records.

    Split three ways because the checks gate each other: a record whose metadata lines are out of
    order never reaches the value checks, and a supersession has to point at a record that exists.
    Both extra records are given index rows, so `adr-index` is not dragged in beside them.
    """
    _replace(ADR, _heading(1, "ADR-0001 — The documentation gate has a fixture net"), _heading(1, "ADR-0002 — A title naming another number"))
    _replace(ADR, "**Status:** Accepted\\", "**Date:** 2026-08-10\\\n\n**Status:** Accepted")
    _replace(ADR, _heading(2, "Context"), _heading(2, "Background"))
    # A placeholder value, so `stamp-format` and `check_stamps` both step over the line that DEC-2 bans.
    _append(ADR, "**Verified against:** `<sha>`, " + STAMP_DATE)
    _write(
        _gate().root,
        SECOND_ADR,
        _adr("0002", "A record whose values are wrong")
        .replace("**Status:** Accepted\\", "**Status:** Perhaps\\")
        .replace("**Date:** " + STAMP_DATE + "\\", "**Date:** a Tuesday\\")
        .replace("**Supersedes:** —\\", "**Supersedes:** an earlier one\\")
        .replace("**Source:** Decided while rebuilding the gate.", "**Source:**"),
    )
    _write(
        _gate().root,
        THIRD_ADR,
        _adr("0003", "A record whose supersession is not returned")
        .replace("**Supersedes:** —\\", "**Supersedes:** ADR-0002\\")
        .replace("**Superseded by:** —\\", "**Superseded by:** ADR-0002\\"),
    )
    _stage(SECOND_ADR, THIRD_ADR)
    _append(ADR_INDEX, _index_row(SECOND_ADR), _index_row(THIRD_ADR))


def _plant_crlf() -> None:
    """Both an ASCII path and one outside it, because the finding carries the path git spelled.

    Without `ls-files -z` the second arrives octal-escaped inside quotes, and the finding then names
    a file no checkout holds -- which reads as a defect in a page nobody can open.
    """
    root = _gate().root
    for rel in (NOTES, UMLAUT_MODULE):
        (root / rel).write_bytes(_read(rel).replace("\n", "\r\n").encode("utf-8"))


def _plant_unreadable() -> None:
    root = _gate().root
    (root / NOTES).write_bytes(b"\xff\xfe not decodable as utf-8\n")


def _plant_header_see() -> None:
    """One dead path per shape of what FOLLOWS it, the token being the entry's first word.

    The em dash is the template's spelling and carries the ordinary entry; the bare one has nothing
    after the path at all, so a reader requiring a separator drops it; the colon is a separator no
    list of dashes holds, with the path backticked so the strip is exercised; and the last carries
    COR-6's anchor, which a dash reader takes whole and then drops for want of a suffix. Every path
    is package-relative, the spelling `bare-path` and `path` each leave alone: written with a
    top-level prefix each entry would fail twice and this case could not say which check spoke.
    """
    _replace(
        SAMPLE,
        QUOTES + "BACKEND · a sample module the corpus scans." + QUOTES,
        _page(
            QUOTES + "BACKEND · a sample module the corpus scans.",
            "",
            "See:",
            "- app/gone-em.py — a file that is not there",
            "- app/gone-bare.py",
            "- `app/gone-colon.py` : a file that is not there",
            "- app/gone-cited.py :: a symbol — a file that is not there",
            QUOTES,
        ).rstrip("\n"),
    )


def _plant_stamps() -> None:
    """All three producers of `stamp`.

    A page changed without restamping, a SHA this clone does not hold, and one it holds but cannot
    reach from HEAD -- the last being the only way to tell a dropped branch from a shallow clone.
    """
    _append(GLOSSARY, "A sentence added under the entry.")
    _replace(FRONTEND_SPEC, _stamp_line(FRONTEND_SPEC), "**Verified against:** `" + ABSENT_SHA + "`, " + STAMP_DATE)
    unreachable = "**Verified against:** `" + _gate().unreachable_sha + "`, " + STAMP_DATE
    _replace(BACKEND_SPEC, _stamp_line(BACKEND_SPEC), unreachable)


def _plant_rule_ids() -> None:
    """All three producers: an unresolvable id, an id two chapters define, and an ambiguous invariant.

    The extra chapter is staged, because `rule_ids` reads the TRACKED chapters: written and left
    untracked it gives COR-1 one home and this case proves nothing. Staged, it is also scanned in
    its own right, which is why it carries a stamp, PRE-4's whole anatomy and no COR-4 count word.
    """
    _append(NOTES, "A claim citing COR-99.")
    _append(SAMPLE, HASH + " a bare I1 with no sheet named")
    _write(
        _gate().root,
        EXTRA_CHAPTER,
        _page(
            _heading(1, "Extra rules"),
            "",
            # The core chapter's stamp, minus its hard break: it carries one because a second entry
            # follows it there, and this page's block is a single line that must carry none.
            _stamp_line(CORE).removesuffix("\\"),
            "",
            "| ID | Rule |",
            "| --- | --- |",
            "| COR-1 | Write for a reader with no context |",
            "",
            _heading(3, "COR-1 — Write for a reader with no context"),
            "",
            "**Rule:** another chapter states the same rule, which is what makes it unresolvable.",
            "",
            "**Why:** a citation that resolves twice cannot be followed.",
            "",
            "**Exceptions:** —",
            "",
            "**Enforced by:** `rule-id`.",
            "",
            "**Example:** a rule copied into another chapter.",
        ),
    )
    _stage(EXTRA_CHAPTER)


def _plant_branch_scope() -> None:
    """A clone with no base ref at all, which is what a fork and a trimmed checkout both look like.

    The branch is renamed rather than the history rewritten: HEAD keeps its ancestors, so every
    stamp still resolves and this case's findings are the advisory alone. Undone by
    `_undo_branch_scope`, because the reset restores files rather than refs.
    """
    _git(_gate().root, "branch", "-m", "main", "trunk")


def _undo_branch_scope() -> None:
    _git(_gate().root, "branch", "-m", "trunk", "main")


def _plant_bare_paths() -> None:
    """A dead unbackticked path in every comment reader the gate owns, one path per file.

    Distinct paths, because `check_bare_paths` iterates a SET of matched tokens: the same text twice
    is one element and one finding, so a reader that stopped working would not move the count. The
    three configuration formats are here rather than in the clean corpus because what has to be
    proven is that they are scanned at all, which only a finding can show.
    """
    _append(SAMPLE, HASH + " resolves nowhere: docs/gone.md")
    _append(UMLAUT_MODULE, HASH + " resolves nowhere: docs/gone-in-a-umlaut.md")
    _append(TOML_CONFIG, HASH + " a path that resolves nowhere: docs/gone-in-toml.md")
    _append(YAML_CONFIG, HASH + " a path that resolves nowhere: docs/gone-in-yaml.md")
    _append(CONF_FILE, HASH + " a path that resolves nowhere: docs/gone-in-conf.md")
    _append(SHELL_FILE, HASH + " a path that resolves nowhere: docs/gone-in-shell.md")
    _append(DOCKERFILE, HASH + " a path that resolves nowhere: docs/gone-in-an-image.md")
    _replace(
        JSON_CONFIG,
        '  "note": "a # b"',
        '  "note": "a # b",\n  "why": "docs/gone-in-json.md is named in the comment below"\n  // docs/gone-in-json.md',
    )


def _plant_history() -> None:
    """COR-3's banned shape where a marker rule cannot see it: inside a module's docstring.

    A docstring opens with a quote rather than a comment marker, so reading the diff's line
    prefixes drops it and the check reports a clean branch. Markdown's half of the same reader is
    pinned by the `counts` case, whose plant is a page's prose.
    """
    _replace(
        SECOND_SAMPLE,
        QUOTES + "BACKEND · a module beside the sample, so one check can speak about more than one file." + QUOTES,
        _page(
            QUOTES + "BACKEND · a module beside the sample, so one check can speak about more than one file.",
            "",
            "This module previously said otherwise.",
            QUOTES,
        ).rstrip("\n"),
    )


def _plant_counts() -> None:
    """COR-4's enumerations in both halves of the reader: a page's prose, and a module's docstring.

    Two files, because this check reports per file -- which is what separates the docstring half
    from the markdown half when either stops being read.
    """
    _append(NOTES, "The pages here number four.")
    _replace(
        SAMPLE,
        QUOTES + "BACKEND · a sample module the corpus scans." + QUOTES,
        _page(
            QUOTES + "BACKEND · a sample module the corpus scans.",
            "",
            "It holds three constants a reader could count.",
            QUOTES,
        ).rstrip("\n"),
    )


def _plant_line_citations() -> None:
    """Both spellings COR-6 bans: the backticked citation, and the bare one a comment reaches for.

    Different paths, for the same set reason -- the two regexes feed one producer through a union,
    so identical text collapses to a single finding and either half could stop matching unnoticed.
    """
    _append(NOTES, "`docs/notes.md:12` points at a line.")
    _append(SAMPLE, HASH + " see docs/glossary.md:7 for the shape")


def _plant_metadata_breaks() -> None:
    """Each producer on a page of its own: the absent break, and a joined pair written either way.

    A join is spelled as the characters `\\` and `n`, or as no separator at all, and the arms are
    planted on separate pages because they share a check, a severity and a wording: planted on one
    page they would share a count too, and an arm that stopped matching would move neither.

    The line that must stay SILENT is in the clean corpus rather than here -- labels parted by a
    visible separator, which is an audit report's header and not a defect. It guards the abutting
    arm's lookbehind, so it has to be read on every run rather than on this case's alone.
    """
    _append(NOTES, "**Scope:** the gate", "**Purpose:** a planted block")
    _replace(CORE, "\\\n**Applies to:**", "\\n**Applies to:**")
    _append(TWIN_NOTES, "**Status:** Open**Surfaces:** Ops")


def _plant_citations() -> None:
    """Each of `_check_citation`'s branches, in a page of its own so the triples separate them.

    The branches return one at a time, so a citation exercises exactly one, and every branch names
    the CITING page -- which is why a branch that stops answering is caught only where its input
    then reaches no sibling. Two of the five are written so that it does not:

    - the empty ANCHOR resolves its file and finds the anchor present, so the malformed guard is
      the only thing between it and silence;
    - the ambiguous name's first match carries the anchor, so dropping that guard leaves nothing to
      report rather than an anchor finding wearing the same triple.

    The empty FILE part stays beside the empty anchor, in one page, because it exercises the other
    half of the same guard: a count of two is what separates them.
    """
    _append(ROADMAP, "A citation naming nothing: `  ::  x`.")
    _append(ROADMAP, "A citation with no anchor: `docs/notes.md ::  `.")
    _append(NOTES, "`docs/gone.md :: symbol` names nothing.")
    _append(TEMPLATES, "`notes.md :: a bare name can be made to resolve twice` resolves more than once.")
    _append(SWEEP, "`docs/data.bin :: anything` cannot be read.")
    _append(ADR_INDEX, "`docs/notes.md :: no such anchor` resolves to a page without it.")


def _plant_anchors() -> None:
    """Both producers: a fragment this page does not yield, and one another page does not."""
    _append(NOTES, "[here](#nowhere)")
    _append(ROADMAP, "[there](../notes.md#nowhere-either)")


def _plant_stamp_formats() -> None:
    """Both producers: a stamp that is not CUR-3's shape, and one that is but sits off line 3.

    The page that moves its stamp is restamped as well, because a page changed with its stamp line
    untouched is `stamp`'s finding rather than this one.
    """
    _replace(FRONTEND_SPEC, _stamp_line(FRONTEND_SPEC), _stamp_line(FRONTEND_SPEC) + " extra")
    _replace(FRONTEND_OVERVIEW, _stamp_line(FRONTEND_OVERVIEW), "\n" + _stamp_line(FRONTEND_OVERVIEW), restamp=True)


def _plant_comment_bounds() -> None:
    """Both of INC-9's bounds, one block each: the line cap alone, and the character cap alone.

    Two blocks rather than one breaching both, because a block over both bounds proves neither of
    them separately -- lifting either cap would leave the other still firing, and the case would
    stay green with half the rule deleted.
    """
    _append(SAMPLE, *[HASH + " a line of a block that runs past what a comment may hold" for _ in range(4)])
    # One line, so nothing but the character bound can be what fires on the second block.
    _append(SECOND_SAMPLE, HASH + " " + ("a clause that carries the block past the character bound " * 5))


def _plant_comment_citations() -> None:
    """All four shapes INC-6 governs: the two that fail, and the two it only reports.

    The ledger row goes in the module beside the sample, because it and the audit id are the two
    failing producers and a swap between them would otherwise move neither the file nor the count.
    """
    _append(
        SAMPLE,
        HASH + " an audit id § S2 belongs to no clone",
        HASH + " and the last session is not a citation",
        HASH + " nor is FX-1 on its own",
    )
    _append(SECOND_SAMPLE, HASH + " the ledger 3 entry is not a citation either")


def _fails(check: str, *files: str) -> tuple[Reported, ...]:
    """One failing finding per file named -- a file twice is a check that must speak twice about it."""
    return tuple(("fail", check, rel) for rel in files)


def _reports(check: str, *files: str) -> tuple[Reported, ...]:
    return tuple(("report", check, rel) for rel in files)


@dataclass(frozen=True)
class Case:
    """One check, the violation planted for it, and every finding that plant is allowed to raise.

    `expected` is counted, not a set: a check with two producers declares both, and silencing either
    one is then a shortfall rather than a set that still compares equal.
    """

    check: str
    expected: tuple[Reported, ...]
    plant: Callable[[], None]
    # Run after the case whatever it did. Only a plant that moves a ref needs one: `_reset` restores
    # files, and a repository left on another branch would be the corpus every case below it saw.
    undo: Callable[[], None] | None = None


CASES: Final[tuple[Case, ...]] = (
    Case("adr", _fails("adr", NOTES, NOTES), _plant_adr_citations),
    Case("adr-index", _fails("adr-index", ADR_INDEX, ADR_INDEX), _plant_second_adr),
    Case("adr-meta", _fails("adr-meta", *[ADR] * 6, *[SECOND_ADR] * 3, SECOND_ADR_GLOB, *[THIRD_ADR_GLOB] * 2), _plant_adr_meta),
    Case("anchor", _fails("anchor", NOTES, ROADMAP), _plant_anchors),
    Case(
        "bare-path",
        _fails("bare-path", SAMPLE, UMLAUT_MODULE, TOML_CONFIG, YAML_CONFIG, JSON_CONFIG, CONF_FILE, SHELL_FILE, DOCKERFILE),
        _plant_bare_paths,
    ),
    Case("branch-scope", _reports("branch-scope", *[BRANCH_DIFF] * 3), _plant_branch_scope, _undo_branch_scope),
    Case("branch-impact", _fails("branch-impact", BACKEND_SPEC), lambda: _append(SAMPLE, "EXTRA = 2")),
    Case("check-registry", _fails("check-registry", CURRENCY, CURRENCY, CURRENCY), _plant_check_registry),
    Case("citation", _fails("citation", NOTES, ROADMAP, ROADMAP, TEMPLATES, SWEEP, ADR_INDEX), _plant_citations),
    Case(
        "comment-citation",
        _fails("comment-citation", SAMPLE, SECOND_SAMPLE) + _reports("comment-citation", SAMPLE, SAMPLE),
        _plant_comment_citations,
    ),
    Case("comment-length", _fails("comment-length", SAMPLE, SECOND_SAMPLE), _plant_comment_bounds),
    Case("counts", _reports("counts", NOTES, SAMPLE), _plant_counts),
    Case("enforced-by", _fails("enforced-by", CORE), lambda: _replace(CORE, "`citation` and `path`", "`no-such-check`", restamp=True)),
    Case("glossary-entry", _fails("glossary-entry", GLOSSARY, GLOSSARY), _plant_glossary),
    Case("header-see", _fails("header-see", *[SAMPLE] * 4), _plant_header_see),
    Case("history", _reports("history", BRANCH_DIFF), _plant_history),
    Case("inputs", _fails("inputs", ROADMAP), lambda: _delete(ROADMAP)),
    Case(
        "invariant-id",
        _fails("invariant-id", BACKEND_SPEC),
        lambda: _append(BACKEND_SPEC, "The read path also rests on I7.", restamp=True),
    ),
    Case("invariant-row", _fails("invariant-row", BACKEND_SPEC, BACKEND_SPEC, FRONTEND_SPEC), _plant_invariant_rows),
    Case("line-citation", _fails("line-citation", NOTES, SAMPLE), _plant_line_citations),
    Case("line-endings", _fails("line-endings", NOTES, UMLAUT_MODULE), _plant_crlf),
    Case("link", _fails("link", NOTES), lambda: _append(NOTES, "[gone](gone.md)")),
    Case("metadata-break", _fails("metadata-break", NOTES, TWIN_NOTES, CORE), _plant_metadata_breaks),
    Case("module-header", _fails("module-header", *[SAMPLE] * 3, *[SECOND_SAMPLE] * 2, THIRD_SAMPLE, LABEL_SAMPLE), _plant_module_headers),
    Case("overview-spine", _fails("overview-spine", OVERVIEW, FRONTEND_OVERVIEW), _plant_overviews),
    Case("owner-voice", _fails("owner-voice", NOTES), lambda: _append(NOTES, "The owner reads it.")),
    Case("path", _fails("path", NOTES), lambda: _append(NOTES, "`docs/gone.md` is named here.")),
    Case("readme-cap", _fails("readme-cap", ROOT_README), lambda: _append(ROOT_README, *["A line." for _ in range(130)])),
    Case("roadmap-shape", _fails("roadmap-shape", *[ROADMAP] * 8, *[TOOLING_ROADMAP] * 3), _plant_roadmap),
    # The extra chapter names its own duplicated id, so it reports the collision alongside the pages
    # that merely cite it -- the plant stages it, which is what puts it in the scan.
    Case("rule-id", _fails("rule-id", NOTES, SAMPLE, CORE, RULES_INDEX, EXTRA_CHAPTER), _plant_rule_ids),
    Case("rule-index", _fails("rule-index", RULES_INDEX, RULES_INDEX), _plant_rule_index),
    Case("rule-shape", _fails("rule-shape", CORE, CORE, CURRENCY), _plant_rule_shapes),
    Case("segment-map", _fails("segment-map", SWEEP, SWEEP), _plant_segment_map),
    Case("sha", _reports("sha", NOTES), lambda: _append(NOTES, "The commit `abc1234` is gone.")),
    Case("spec-spine", _fails("spec-spine", BACKEND_SPEC, FRONTEND_SPEC), _plant_spec_spines),
    Case("stamp", _fails("stamp", GLOSSARY, BACKEND_SPEC) + _reports("stamp", FRONTEND_SPEC), _plant_stamps),
    Case("stamp-format", _fails("stamp-format", FRONTEND_SPEC, FRONTEND_OVERVIEW), _plant_stamp_formats),
    Case("stamp-missing", _fails("stamp-missing", OVERVIEW), lambda: _drop(OVERVIEW, _stamp_line(OVERVIEW))),
    Case(
        "template-fragment",
        _fails("template-fragment", TEMPLATES),
        lambda: _drop(TEMPLATES, "- " + _gate().body_gate.TEMPLATE_FRAGMENTS[0]),
    ),
    Case("unreadable", _fails("unreadable", NOTES), _plant_unreadable),
)


# --- the tests -----------------------------------------------------------------------------------


def _mismatches(cases: Iterable[Case]) -> list[str]:
    """One line per case that did not report exactly what it declares, empty where every case did.

    Each case is caught on its own. `_replace`, `_git` and `_reported` all raise on a corpus that has
    drifted, and an escaping exception would end the loop -- leaving every case below it unreported
    on precisely the run whose whole job is to say which checks still work.
    """
    wrong: list[str] = []
    for case in cases:
        try:
            _reset()
            case.plant()
            code, reported = _run()
        except Exception as exc:  # noqa: BLE001 -- a broken case is one row of the report, not the end of it
            wrong.append(case.check + ": raised " + repr(exc))
            continue
        finally:
            if case.undo is not None:
                case.undo()
        expected = Counter(case.expected)
        if reported != expected:
            wrong.append(case.check + ": missing " + _shape(expected - reported) + "; unexpected " + _shape(reported - expected))
        elif code != int(any(severity == "fail" for severity, _, _ in case.expected)):
            wrong.append(case.check + ": exit code " + str(code) + " does not match the severities reported")
    _reset()
    _assert_corpus_restored()
    return wrong


def test_the_clean_corpus_is_silent() -> None:
    """No check speaks about a corpus with no violation in it, which is what makes a plant legible."""
    _reset()
    _assert_corpus_restored()
    code, reported = _run()
    assert not reported, "the clean corpus is not clean: " + _shape(reported)
    assert code == 0


def test_every_registered_check_and_verdict_has_a_plant() -> None:
    """A check added without a case here would be registered, unexercised, and look covered.

    The verdicts are held to as well as the names, because two checks report at one severity and
    fail at another: covering only the name would leave whichever half is rarer unproven.
    """
    checks: dict[str, frozenset[str]] = _gate().gate.CHECKS
    assert {case.check for case in CASES} == set(checks)
    assert len({case.check for case in CASES}) == len(CASES)
    registered = {(severity, name) for name, severities in checks.items() for severity in severities}
    planted = {(severity, check) for case in CASES for severity, check, _ in case.expected}
    assert planted == registered, "unplanted: " + repr(sorted(registered - planted))


def test_every_check_reports_its_planted_violation() -> None:
    """Each plant raises exactly the findings its case declares -- no fewer, and nothing beside them."""
    wrong = _mismatches(CASES)
    assert not wrong, "\n".join(wrong)


def test_a_check_naming_one_page_reads_the_tracked_one() -> None:
    """A check that names a fixed page resolves it through the corpus, not off disk.

    Driven directly rather than through a plant, because a `Case` declares every finding its plant
    raises and this input silences the glossary's other producers by returning first. The page is
    left on disk and taken out of the index, which is a page written and never `git add`ed: read
    off disk it satisfies its own check and `inputs` with it, and a clean checkout has neither.
    """
    _reset()
    _git(_gate().root, "rm", "--cached", "-q", "--", GLOSSARY)
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "glossary-entry", GLOSSARY)] == 1, "an untracked glossary was read as the corpus': " + _shape(reported)
    _assert_corpus_restored()


def test_an_untracked_ranked_page_is_read_as_a_page_nobody_added() -> None:
    """A ranked roadmap page on disk and outside the index fails, rather than passing unexamined.

    Driven directly rather than through a plant, because this producer and the shape producers
    exclude each other: the page the shape checks read is selected from the tracked corpus, so a
    page taken out of the index yields no shape finding at all and could not share that case's
    plant. Untracked, it also satisfies `inputs`, which asks the disk -- which leaves this the one
    thing between a page nobody `git add`ed and a run that is green on every check of it.
    """
    _reset()
    _git(_gate().root, "rm", "--cached", "-q", "--", TOOLING_ROADMAP)
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "roadmap-shape", TOOLING_ROADMAP)] == 1, "an untracked ranked page passed: " + _shape(reported)
    _assert_corpus_restored()


def test_the_comment_bounds_read_a_file_by_its_format_not_its_suffix() -> None:
    """INC-9's bounds are measured through the reader the FORMAT needs, never through `path.suffix`.

    Driven directly rather than through a plant, because no corpus file can separate the two: every
    path that reaches the bounds today carries a suffix its reader is named after. A Dockerfile and
    every dotfile carry none, and read for a C-style marker they yield no block at all -- so the
    check would run, report nothing, and look wired. This is the one input that tells them apart.
    """
    block = [HASH + " a line of a block that runs past what a comment may hold" for _ in range(4)]
    # A first line that opens no comment: a leading run of hashes is the module header, which INC-2
    # bounds instead and which `comment_runs` therefore steps over.
    raw = _page("FROM scratch", *block)
    bounds = _module("docs_gate.structure").check_comment_length
    found = bounds(_gate().root / DOCKERFILE, raw, set(range(1, len(block) + 2)))
    assert [finding.check for finding in found] == ["comment-length"], "the block was read by the wrong format's reader"


def _select(names: list[str]) -> int:
    """Run the cases named on the command line, or all of them. The `-k` the loop cannot offer.

    Re-testing one check through pytest costs the whole loop, which is long enough that the net stops
    being reached for while a check is being worked on. Named here, one case is a second and a half.
    """
    known = {case.check for case in CASES}
    if unknown := sorted(set(names) - known):
        print("no such check: " + ", ".join(unknown) + "\nknown: " + ", ".join(sorted(known)))
        return 2
    chosen = [case for case in CASES if case.check in names] if names else list(CASES)
    wrong = _mismatches(chosen)
    for line in wrong:
        print(line)
    print(f"{len(chosen) - len(wrong)} of {len(chosen)} cases reported exactly what they declare")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(_select(sys.argv[1:]))
