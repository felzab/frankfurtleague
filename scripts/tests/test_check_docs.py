"""SCRIPTS · the documentation gate's fixture net

Every check `scripts/check_docs.py :: CHECKS` registers is driven twice: it must report a planted
violation and say nothing about a corpus with none. The seam is a throwaway repository holding a
copy of scripts/, whose REPO_ROOT is derived from its own location and so roots there.

A planted violation never shares a line of THIS file with a hash or a triple quote: the gate reads
a source file's comments and would otherwise find the plant here. Stdlib only, the type checker
reading scripts/ with no environment declared.
"""

from __future__ import annotations

import atexit
import contextlib
import importlib
import io
import os
import re
import shutil
import stat
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
QUOTE: Final = chr(34)
NEWLINE: Final = chr(10)
# Built for a second reason on top of that one: python refuses to compile a source file holding a
# NUL, so the byte this case plants cannot be written here even escaped past the gate's own reader.
NUL_BYTE: Final = chr(0)
CR_BYTE: Final = chr(13)

PLACEHOLDER_SHA: Final = "0000000"
STAMP_DATE: Final = "2026-08-10"
RESTAMP_DATE: Final = "2026-08-11"
ABSENT_SHA: Final = "0abc123"

NOTES: Final = "docs/notes.md"
# A second page of the same basename, so a bare-name citation can be made to resolve twice; and a
# file no scan reads, so a citation can name something unreadable without `unreadable` firing too.
TWIN_NOTES: Final = "docs/frontend/notes.md"
UNDECODABLE: Final = "docs/data.bin"
GITATTRIBUTES: Final = ".gitattributes"
SAMPLE: Final = "fl_backend/app/sample.py"
SECOND_SAMPLE: Final = "fl_backend/app/second.py"
THIRD_SAMPLE: Final = "fl_backend/app/spare.py"
LABEL_SAMPLE: Final = "fl_backend/app/label.py"
# The one C-style module in the corpus. A JSX comment opens with a brace, so no other fixture puts
# that shape in front of the reader, and it is bounded as an inline comment rather than a symbol doc.
TSX_SAMPLE: Final = "fl_frontend/src/sample.tsx"
# The one file carrying German a reader would see. It holds the date range as well, that being the
# only dash §1.12 permits and the only thing keeping the formatter exemption from reading as stale.
COPY_SAMPLE: Final = "fl_frontend/src/copy.tsx"
# What a copy-rules finding names when the corpus rather than one file is the subject.
COPY_ROOT: Final = "fl_frontend/src"
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

    The currency table and the pull request form derive from the checker's own constants; a
    hand-written copy would fail the fixture the day a check is added.
    """
    rows = [
        "| `" + name + "` | The finding names it | " + verdict.capitalize() + " |"
        for name in sorted(checks)
        for verdict in sorted(checks[name])
    ]
    return {
        GITATTRIBUTES: _page("* text=auto eol=lf", "*.bin binary"),
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
            "| ID | Invariant | Enforced by |",
            "| --- | --- | --- |",
            "| I1 | The write path validates its input | The sample module's own suite |",
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
            "| ID | Invariant | Enforced by |",
            "| --- | --- | --- |",
            "| I1 | A route names its own data | The route's own test |",
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
            "- **COR-13:** a rule stated here alone still claims enforcement. _Enforced by_ review judgment.",
            "",
            _heading(2, "[Currency rules](chapters/5-currency.md)"),
            "",
            "- **CUR-5:** every gate check takes a row in the currency chapter's table.",
        ),
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
        TSX_SAMPLE: _page(
            "export function Sample() {",
            "  return <output>a component the corpus scans</output>;",
            "}",
        ),
        COPY_SAMPLE: _page(
            "export function Copy() {",
            "  const zeitraum = `${formatSpielDatum(start)} – ${formatSpielDatum(ende)}`;",
            '  return <p title="Der Zeitraum dieser Saison, und nichts weiter.">{zeitraum}</p>;',
            "}",
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


def _discard(root: Path) -> None:
    """Remove one fixture repository, the read-only files git wrote inside it included.

    Windows will not unlink a read-only file, and that is how git writes every loose object -- so
    ignoring the error alone leaves every `.git` tree behind.
    """

    def _clear_readonly(remove: Callable[..., object], path: str, _exc: BaseException) -> None:
        os.chmod(path, stat.S_IWRITE)
        remove(path)

    # Suppressed around the retry rather than instead of it: interpreter shutdown has nobody left
    # to tell, but a failure swallowed before the retry is what let these accumulate.
    with contextlib.suppress(OSError):
        shutil.rmtree(root, onexc=_clear_readonly)


def _load() -> Fixture:
    """The checker, imported from a copy of scripts/ inside a fresh fixture repository."""
    root = Path(tempfile.mkdtemp(prefix="check-docs-fixture-")).resolve()
    atexit.register(_discard, root)
    # Caches as well as packages: the gate runs this suite beside ruff and pyright, and one being
    # rewritten under the walk fails the copy for nothing the corpus can explain. The fixture reads
    # none of them; its git tracks the corpus by name.
    ignored = shutil.ignore_patterns("__pycache__", "tests", ".ruff_cache", ".pytest_cache", ".mypy_cache")
    shutil.copytree(REPO_ROOT / SCRIPTS_COPY, root / SCRIPTS_COPY, ignore=ignored)
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

    Imported directly rather than widening the entry point's re-exports, which would put a name in
    the shipped file that exists for a test.
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

    Read from the output, not the `Finding` objects: a check whose findings are built and dropped
    is the failure this net exists to catch.
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
    """No case left the index carrying something the reset cannot reach.

    The reset reaches only paths HEAD knows, so a staged NEW file would survive into the corpus
    later cases are measured against.
    """
    dirty = _git(_gate().root, "status", "--porcelain", "-uno")
    assert dirty == "", "a case left the index or the tree changed after the reset:\n" + dirty


def _reset() -> None:
    """The corpus as it was committed, with only `PRESERVED` left standing."""
    root = _gate().root
    excludes = [argument for name in PRESERVED for argument in ("-e", "/" + name)]
    # A plant's staged file is tracked, so `git clean` skips it and the checkout below cannot reach
    # a path HEAD never held: unstaging first is what keeps it out of every later case's corpus.
    _git(root, "reset", "-q", "HEAD", "--", ".")
    # HEAD, not the index: a bare `git checkout -- .` restores what is STAGED, handing a plant's
    # own edit to the cases after it, silently.
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

    The gate resolves against `git ls-files`, so a page left untracked is one no check sees.
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


def _plant_rule_index() -> None:
    """A rule with no line in the index, and a rule taking two."""
    _drop(RULES_INDEX, "- **COR-1:** write for a reader with no context.")
    _append(RULES_INDEX, "- **CUR-5:** every gate check takes a row in the currency chapter's table.")


def _plant_rule_shapes() -> None:
    """Fields out of shape, a rule with no table row, and a heading with no claim."""
    _drop(CORE, "**Rule:** every page is understandable to a reader meeting the repository for the first time.")
    _drop(CORE, "| COR-1 | Write for a reader with no context |", restamp=True)
    _replace(
        CURRENCY,
        _heading(3, "CUR-5 — Every gate check takes a row in the table below"),
        _heading(3, "CUR-5 stated as a title rather than a claim"),
        restamp=True,
    )


def _plant_glossary() -> None:
    """Fields that are not OUT-6's, and a heading that is not either."""
    _replace(GLOSSARY, "**Trap:**", "**Pitfall:**")
    _replace(GLOSSARY, _heading(3, "`saison` — the competition year"), _heading(3, "saison, the competition year"), restamp=True)


def _plant_invariant_rows() -> None:
    """A repeated id, a foreign row among the invariants, and a row of the wrong width.

    The width producer keeps a page to itself: it and the foreign-row arm both read a row's cells,
    so sharing one would let either answer for the other.
    """
    _replace(
        BACKEND_SPEC,
        "| I1 | The write path validates its input | The sample module's own suite |",
        "| I1 | The write path validates its input | The sample module's own suite |\n"
        "| I1 | A row repeating an id | The reader cannot tell which rule is meant |\n"
        "| A malformed document | Delete it and post again |",
        restamp=True,
    )
    _replace(
        FRONTEND_SPEC,
        "| I1 | A route names its own data | The route's own test |",
        "| I1 | A route names its own data |",
        restamp=True,
    )


def _plant_overviews() -> None:
    """A page that does not close on OUT-5's heading, and one that does not open on it."""
    _replace(OVERVIEW, _heading(2, "Read next"), _heading(2, "Where next"), restamp=True)
    _replace(FRONTEND_OVERVIEW, _heading(2, "How it is organised"), _heading(2, "The shape of it"), restamp=True)


def _plant_spec_spines() -> None:
    """Sections that are not OUT-4's, and a contract numbered with a gap."""
    _replace(BACKEND_SPEC, _heading(2, "4. Known-open"), _heading(2, "4. Open questions"), restamp=True)
    _replace(FRONTEND_SPEC, _heading(3, "1.1 The route"), _heading(3, "1.2 The route"), restamp=True)


def _plant_check_registry() -> None:
    """A row this gate does not emit, a check with no row, and a row at the wrong verdict."""
    _append(CURRENCY, "| `not-a-check` | The finding names it | Fail |", restamp=True)
    _drop(CURRENCY, "| `unreadable` | The finding names it | Fail |")
    _replace(CURRENCY, "| `link` | The finding names it | Fail |", "| `link` | The finding names it | Report |")


def _plant_module_headers() -> None:
    """All of INC-2's shapes, one module per shape that excludes another.

    They are arms of one chain, so only one fires about a given line: planted together they would
    share a file and a count.
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
    """Every shape a ranked page can lose, and a subset on the tooling page.

    A plant on the product page alone cannot tell the check's LOOP from one stopping at the first
    page.
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


def _write_bytes(root: Path, rel: str, text: str) -> None:
    """A plant's exact bytes, `_write` being the same call. Named so a byte plant reads as deliberate."""
    (root / rel).write_bytes(text.encode("utf-8"))


def _plant_crlf() -> None:
    """An ASCII path and one outside it, because the finding carries the path git spelled.

    Without `ls-files -z` the second arrives octal-escaped in quotes, so the finding names a file
    no checkout holds.
    """
    root = _gate().root
    for rel in (NOTES, UMLAUT_MODULE):
        (root / rel).write_bytes(_read(rel).replace("\n", "\r\n").encode("utf-8"))


def _plant_binary_bytes() -> None:
    """A NUL and a CR, in the two files a byte plant reaches without a second check speaking.

    Either byte stops the comment reader, which then offers a sample module's path-shaped
    literals to `bare-path`.
    """
    root = _gate().root
    _write_bytes(root, NOTES, _read(NOTES) + NEWLINE + "a" + NUL_BYTE + "b" + NEWLINE)
    _write_bytes(root, UMLAUT_MODULE, _read(UMLAUT_MODULE) + NEWLINE + "SEPARATOR = " + QUOTE + "a" + CR_BYTE + "b" + QUOTE + NEWLINE)


def _plant_unreadable() -> None:
    root = _gate().root
    (root / NOTES).write_bytes(b"\xff\xfe not decodable as utf-8\n")


def _plant_header_see() -> None:
    """One dead path per shape of what FOLLOWS it.

    Every path is package-relative, which `bare-path` and `path` both leave alone: a top-level
    prefix would fail each entry twice, and this case could not say which check spoke.
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
    """Every producer of `stamp`.

    A page changed without restamping, a SHA this clone does not hold, and one it holds but cannot
    reach from HEAD -- the last being the only way to tell a dropped branch from a shallow clone.
    """
    _append(GLOSSARY, "A sentence added under the entry.")
    _replace(FRONTEND_SPEC, _stamp_line(FRONTEND_SPEC), "**Verified against:** `" + ABSENT_SHA + "`, " + STAMP_DATE)
    unreachable = "**Verified against:** `" + _gate().unreachable_sha + "`, " + STAMP_DATE
    _replace(BACKEND_SPEC, _stamp_line(BACKEND_SPEC), unreachable)


def _plant_rule_ids() -> None:
    """An unresolvable id, an id two chapters define, and an ambiguous invariant.

    The extra chapter is staged because `rule_ids` reads the TRACKED chapters; staged, it is also
    scanned in its own right, hence its stamp and PRE-4's anatomy.
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
    """A clone with no base ref, as a fork and a trimmed checkout both are.

    Renamed rather than rewritten: HEAD keeps its ancestors, so every stamp still resolves and the
    findings are the advisory alone.
    """
    _git(_gate().root, "branch", "-m", "main", "trunk")


def _undo_branch_scope() -> None:
    """The reset restores files, never refs."""
    _git(_gate().root, "branch", "-m", "trunk", "main")


def _plant_bare_paths() -> None:
    """A dead unbackticked path in every comment reader the gate owns, one path per file.

    Distinct paths, because `check_bare_paths` iterates a SET: repeated text is one finding, so a
    reader that stopped would not move the count.
    """
    _append(SAMPLE, HASH + " resolves nowhere: docs/gone.md")
    _append(UMLAUT_MODULE, HASH + " resolves nowhere: docs/gone-in-a-umlaut.md")
    # A configuration format is planted rather than left clean: only a finding proves it is scanned.
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

    A docstring opens with a quote, not a comment marker, so a reader of the diff's line prefixes
    drops it and reports a clean branch.
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


def _plant_enforced_by() -> None:
    """PRE-4's enforcement claim wherever a rule states one: a chapter, and the index.

    A rule with no chapter section claims enforcement in the index alone, so a chapter-only plant
    would pass with every line-only claim unresolved.
    """
    _replace(CORE, "`citation` and `path`", "`no-such-check`", restamp=True)
    _replace(RULES_INDEX, "_Enforced by_ review judgment.", "_Enforced by_ gate check `absent-check`.")


def _plant_counts() -> None:
    """COR-4's enumerations in each half of the reader: a page's prose, and a module's docstring.

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
    """The spellings COR-6 bans: the backticked citation, and the bare one a comment reaches for.

    Different paths, because the two patterns feed one producer: identical text would collapse to
    one finding.
    """
    _append(NOTES, "`docs/notes.md:12` points at a line.")
    _append(SAMPLE, HASH + " see docs/glossary.md:7 for the shape")


def _plant_metadata_breaks() -> None:
    """Each producer on a page of its own: the absent break, and a joined pair.

    The line that must stay SILENT sits in the clean corpus, so the abutting arm's lookbehind is
    guarded on every run.
    """
    _append(NOTES, "**Scope:** the gate", "**Purpose:** a planted block")
    _replace(CORE, "\\\n**Applies to:**", "\\n**Applies to:**")
    _append(TWIN_NOTES, "**Status:** Open**Surfaces:** Ops")


def _plant_citations() -> None:
    """Each branch of `_check_citation` in its own page, so the triples separate them.

    A branch that stops answering is caught only where its input reaches no sibling branch -- hence
    the empty anchor and the ambiguous name.
    """
    _append(ROADMAP, "A citation naming nothing: `  ::  x`.")
    _append(ROADMAP, "A citation with no anchor: `docs/notes.md ::  `.")
    _append(NOTES, "`docs/gone.md :: symbol` names nothing.")
    _append(TEMPLATES, "`notes.md :: a bare name can be made to resolve twice` resolves more than once.")
    _append(SWEEP, "`docs/data.bin :: anything` cannot be read.")
    _append(TWIN_NOTES, "`docs/notes.md :: no such anchor` resolves to a page without it.")


def _plant_anchors() -> None:
    """A fragment this page does not yield, and one another page does not."""
    _append(NOTES, "[here](#nowhere)")
    _append(ROADMAP, "[there](../notes.md#nowhere-either)")


def _plant_stamp_formats() -> None:
    """A stamp that is not CUR-3's shape, and one that is but sits off line 3.

    The page that moves its stamp is restamped as well, because a page changed with its stamp line
    untouched is `stamp`'s finding rather than this one.
    """
    _replace(FRONTEND_SPEC, _stamp_line(FRONTEND_SPEC), _stamp_line(FRONTEND_SPEC) + " extra")
    _replace(FRONTEND_OVERVIEW, _stamp_line(FRONTEND_OVERVIEW), "\n" + _stamp_line(FRONTEND_OVERVIEW), restamp=True)


def _plant_copy_dash() -> None:
    """The spaced em dash that shipped three times, and the two shapes a value hides.

    Both hidden ones flatten to a dash between values, which the exemption for a scoreline lets
    past: what fails them is the dash having a rendered output of its own.
    """
    _append(COPY_SAMPLE, 'export const WEG = "Der Eintrag ist weg — das lässt sich nicht mehr holen.";')
    _append(COPY_SAMPLE, "export function Zeit() {", "  return <p>{datum}<span>-</span>{uhrzeit}</p>;", "}")
    _append(COPY_SAMPLE, "export function Nummer() {", '  return <p>{spieler.nummer || "-"}</p>;', "}")


def _plant_copy_formal() -> None:
    """`Sie` where no sentence opens, which no third person accounts for."""
    _append(COPY_SAMPLE, 'export const BITTE = "Bitte prüfen Sie die Angaben und speichere erneut.";')


def _plant_copy_informal() -> None:
    """A possessive lower-cased, which a sentence's opener cannot account for either way."""
    _append(COPY_SAMPLE, 'export const WO = "Erfahre, wo die Spiele deines Teams stattfinden.";')


def _plant_copy_term() -> None:
    """The retired word for a club, in both the forms the sweep reads."""
    _append(COPY_SAMPLE, 'export const WER = "Die Mannschaft steht in dieser Gruppe.";')
    _append(COPY_SAMPLE, 'export const ALLE = "Alle Mannschaften stehen in der Tabelle.";')


def _plant_copy_corpus() -> None:
    """A corpus with no German left in it, and so no date range to exempt either.

    Both producers at once: the scan going quiet and an exemption outliving what it exempted are
    the same failure seen from two ends.
    """
    _write(_gate().root, COPY_SAMPLE, _page('export const SAMPLE = "a rendered string, and no reader in sight";'))


def _plant_comment_bounds() -> None:
    """Each of INC-9's bounds against each of its shapes, one file apiece.

    A block over both proves neither: lifting one cap leaves the other firing, and the case stays
    green with half the rule gone.
    """
    _append(SAMPLE, *[HASH + " a line of a block that runs past what a comment may hold" for _ in range(4)])
    # One line, so nothing but the character bound can fire on this block.
    _append(SECOND_SAMPLE, HASH + " " + ("a clause that carries the block past the character bound " * 5))
    _append(THIRD_SAMPLE, QUOTES + "a docstring summary line", "", *["a line of its prose"] * 4, QUOTES)
    # Inside the line cap a symbol doc is given, so only the character bound reaches it.
    _append(LABEL_SAMPLE, QUOTES + ("a docstring clause carrying the block past the character bound " * 5) + QUOTES)
    # Past the inline cap and inside the symbol doc's, so a JSX block routed through the doc path
    # stays silent here -- which is the whole of what this shape has to prove.
    _append(
        TSX_SAMPLE,
        "{/* a jsx block long enough to pass the cap an inline comment takes",
        "    with room to spare under the cap a symbol doc is given",
        "    and well inside what a comment may hold in characters",
        "    so the cap it was measured against is the visible thing */}",
    )


def _plant_comment_citations() -> None:
    """Every shape INC-6 governs: those that fail, and those it only reports.

    The ledger row goes beside the sample, because a swap with the audit id would move neither the
    file nor the count.
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

    `expected` is counted, not a set: silencing one producer is a shortfall rather than a set that
    still compares equal.
    """

    check: str
    expected: tuple[Reported, ...]
    plant: Callable[[], None]
    # Run after the case whatever it did. Only a plant that moves a ref needs one: `_reset` restores
    # files, and a repository left on another branch would be the corpus every case below it saw.
    undo: Callable[[], None] | None = None


CASES: Final[tuple[Case, ...]] = (
    Case("anchor", _fails("anchor", NOTES, ROADMAP), _plant_anchors),
    Case(
        "bare-path",
        _fails("bare-path", SAMPLE, UMLAUT_MODULE, TOML_CONFIG, YAML_CONFIG, JSON_CONFIG, CONF_FILE, SHELL_FILE, DOCKERFILE),
        _plant_bare_paths,
    ),
    Case("binary-byte", _fails("binary-byte", NOTES, UMLAUT_MODULE), _plant_binary_bytes),
    Case("branch-scope", _reports("branch-scope", *[BRANCH_DIFF] * 3), _plant_branch_scope, _undo_branch_scope),
    Case("branch-impact", _fails("branch-impact", BACKEND_SPEC), lambda: _append(SAMPLE, "EXTRA = 2")),
    Case("check-registry", _fails("check-registry", CURRENCY, CURRENCY, CURRENCY), _plant_check_registry),
    Case("citation", _fails("citation", NOTES, ROADMAP, ROADMAP, TEMPLATES, SWEEP, TWIN_NOTES), _plant_citations),
    Case(
        "comment-citation",
        _fails("comment-citation", SAMPLE, SECOND_SAMPLE) + _reports("comment-citation", SAMPLE, SAMPLE),
        _plant_comment_citations,
    ),
    Case("comment-length", _fails("comment-length", SAMPLE, SECOND_SAMPLE, THIRD_SAMPLE, LABEL_SAMPLE, TSX_SAMPLE), _plant_comment_bounds),
    Case("copy-corpus", _fails("copy-corpus", COPY_ROOT, COPY_ROOT), _plant_copy_corpus),
    Case("copy-dash", _fails("copy-dash", *[COPY_SAMPLE] * 3), _plant_copy_dash),
    Case("copy-formal", _fails("copy-formal", COPY_SAMPLE), _plant_copy_formal),
    Case("copy-informal", _fails("copy-informal", COPY_SAMPLE), _plant_copy_informal),
    Case("copy-term", _fails("copy-term", COPY_SAMPLE, COPY_SAMPLE), _plant_copy_term),
    Case("counts", _reports("counts", NOTES, SAMPLE), _plant_counts),
    Case("enforced-by", _fails("enforced-by", CORE, RULES_INDEX), _plant_enforced_by),
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
    """One line per case that did not report exactly what it declares.

    A case that raises is caught on its own: an escaping exception would end the loop, leaving
    every case below it unreported.
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

    The verdicts are held to as well as the names: a check that reports and fails would leave the
    rarer half unproven.
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

    Driven directly: this input silences the glossary's other producers by returning first, and a
    `Case` declares every finding.
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

    Driven directly: a page out of the index yields no shape finding to share a case with, and
    satisfies `inputs`, which asks the disk.
    """
    _reset()
    _git(_gate().root, "rm", "--cached", "-q", "--", TOOLING_ROADMAP)
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "roadmap-shape", TOOLING_ROADMAP)] == 1, "an untracked ranked page passed: " + _shape(reported)
    _assert_corpus_restored()


def test_only_a_gitattributes_declaration_exempts_a_file_from_the_byte_check() -> None:
    """The corpus binary is passed over because `.gitattributes` says so, not because of its bytes.

    Only withdrawing the declaration can prove that: a suffix list answers the same either way.
    """
    _reset()
    root = _gate().root
    declaration = "*.bin binary"
    assert declaration in _read(GITATTRIBUTES), "the corpus no longer declares its binary"
    _write_bytes(root, GITATTRIBUTES, _read(GITATTRIBUTES).replace(declaration + NEWLINE, ""))
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "binary-byte", UNDECODABLE)] == 1, "an undeclared binary was passed over anyway: " + _shape(reported)
    _assert_corpus_restored()


def test_the_comment_bounds_read_a_file_by_its_format_not_its_suffix() -> None:
    """INC-9's bounds are measured through the reader the FORMAT needs, not `path.suffix`.

    No corpus file separates the two: a suffixless path read for a C-style marker yields no block,
    so the check would run, report nothing, and look wired.
    """
    block = [HASH + " a line of a block that runs past what a comment may hold" for _ in range(4)]
    # A first line that opens no comment: a leading run of hashes is the module header, which INC-2
    # bounds instead and which `comment_runs` therefore steps over.
    raw = _page("FROM scratch", *block)
    bounds = _module("docs_gate.structure").check_comment_length
    found = bounds(_gate().root / DOCKERFILE, raw, set(range(1, len(block) + 2)))
    assert [finding.check for finding in found] == ["comment-length"], "the block was read by the wrong format's reader"


def _select(names: list[str]) -> int:
    """Run the cases named on the command line, or all of them: the `-k` the loop cannot offer.

    Re-testing one check through pytest costs the whole loop, long enough that the net stops being
    reached for while a check is worked on.
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
