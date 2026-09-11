"""SCRIPTS · the documentation gate's fixture net

Every check `scripts/checks/check_docs.py :: CHECKS` registers is driven twice: it must report a planted
violation and say nothing about a corpus with none. The seam is a throwaway repository holding a
copy of scripts/, whose REPO_ROOT is derived from its own location and so roots there.

A planted violation never shares a line of THIS file with a hash or a triple quote: the gate reads
a source file's comments and would otherwise find the plant here.
"""

from __future__ import annotations

import contextlib
import importlib
import io
import re
import sys
from collections import Counter
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Final

from conftest import configure, copy_scripts, git, new_root, withdraw, write

# Built rather than written, so no line of this file carries the markdown or the comment marker the
# corpus needs -- either one would make the gate read the fixture text as this file's own comment.
HASH: Final = "#"
QUOTES: Final = '"' * 3
QUOTE: Final = chr(34)
NEWLINE: Final = chr(10)
# Built for a second reason on top of that one: python refuses to compile a source file holding a
# NUL, so the byte this case plants cannot be written here even escaped past the gate's own reader.
NUL_BYTE: Final = chr(0)
# Not text in any encoding, which is what makes a reader answer None rather than a shorter page.
UNDECODABLE_BYTES: Final = b"\xff\xfe not decodable as utf-8\n"
CR_BYTE: Final = chr(13)
# Built like the markers above: spelled out, this line would open a fence in every reader that
# scans this file, and the corpus below would be read as one block of prose.
FENCE: Final = "`" * 3
# The outer marker of a nested block, built the same way. Longer than the inner one, which is what
# CommonMark reads a close by and what a reader flipping one boolean cannot see.
LONG_FENCE: Final = "`" * 4
# A dead path inside the nested block, where a reader taking the inner opener for the outer's close
# reads code as prose and reports it.
NESTED_FENCE_PATH: Final = "docs/gone-inside-a-nested-fence.md"
# A dead path after the outer close, where that same reader is inside a block it never left and
# reads nothing at all.
PAST_FENCE_PATH: Final = "docs/gone-past-a-nested-fence.md"

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
# The one module carrying a comment block the corpus commits ALREADY over INC-9's word bound,
# so a plant can edit inside it and a plant can lengthen the short block beside it.
LEGACY_SAMPLE: Final = "fl_backend/app/legacy.py"
# One module per comment marker, because the marker is what a wrapped citation drags into its anchor.
MARKER_SAMPLE: Final = "fl_backend/app/marker.py"
MARKER_TSX: Final = "fl_frontend/src/marker.tsx"
# A quoted error carrying the separator. Not a citation, and reporting it as a dead one sends a
# reader after a file nobody named.
QUOTED_ERROR: Final = "121 · Plan executor error during update :: caused by :: Document failed validation"
# Three DISTINCT lines: a plant edits the middle one, and the block is recognised across that edit
# by the lines it still shares with the fork.
LEGACY_OPENING: Final = "an opening line of a comment block the corpus itself committed over what a comment may ever hold"
LEGACY_MIDDLE: Final = "a middle line a plant edits, leaving the block over a word bound it was already over before"
LEGACY_CLOSING: Final = "a closing line carrying the block past the word bound well before any plant was ever written"
SHORT_LINE: Final = "a block inside the word bound until something is added to it"
# What a plant adds to the short block to carry it past the word bound and nothing else, so
# only the branch's own text can be what fires.
LENGTHENING_LINE: Final = "a clause that carries the block past the word bound " * 4
# The one C-style module in the corpus. A JSX comment opens with a brace, so no other fixture puts
# that shape in front of the reader, and it is bounded as an inline comment rather than a symbol doc.
TSX_SAMPLE: Final = "fl_frontend/src/sample.tsx"
# The three shapes a reader that does not track quoting keeps: a marker inside a double-quoted
# string, one inside a template literal, and an unclosed block marker that opens a run to the
# file's end.
LITERAL_MARKER_PATH: Final = "docs/gone-in-a-tsx-literal.md"
TEMPLATE_MARKER_PATH: Final = "docs/gone-in-a-template-literal.md"
RUNAWAY_BLOCK_PATH: Final = "docs/gone-after-a-runaway-block.md"
# The comment beside them, so the case cannot pass on a reader that blanks the file whole.
REAL_COMMENT_PATH: Final = "docs/gone-in-a-real-comment.md"
# One slice per arm the tag checks take: derived, stale and frontend-only. A slice exists only
# while a file holds its folder open, and `git clean` takes an empty one with it.
SPIELE_ROUTER: Final = "fl_backend/app/api/spiele/router.py"
TEAMS_ROUTER: Final = "fl_backend/app/api/teams/router.py"
SPIELER_PANEL: Final = "fl_frontend/src/features/spieler/Panel.tsx"
# A file sitting directly under a slice root, so a named segment can be one the tree defines no
# slice for. Every other fixture path under these roots names a folder.
SLICE_STRAY: Final = "fl_frontend/src/features/registry.ts"
SCHEME: Final = "fl_frontend/src/app/schemes/2025-26.css"
# A second season, planted rather than committed: the past scheme a file-to-file drift needs.
PAST_SCHEME: Final = "fl_frontend/src/app/schemes/2024-25.css"
APP_GLOBALS: Final = "fl_frontend/src/app/globals.css"
# Spelled out rather than lifted from the checker's own roster: a corpus built from what it asserts
# would follow the roster wherever it went, and a token dropped from both would stay green.
SCHEME_TOKENS: Final[tuple[tuple[str, str, str], ...]] = (
    ("--bg-base", "#ffffff", "#030303"),
    ("--bg-surface", "#f5f5f5", "#121212"),
    ("--bg-muted", "#e5e5e5", "#262626"),
    ("--fg-base", "#0a0a0a", "#ffffff"),
    ("--fg-muted", "#525252", "#a3a3a3"),
    ("--fg-on-brand", "#ffffff", "#ffffff"),
    ("--border-base", "#d4d4d4", "#333333"),
    # Solved against this fixture's own two page grounds with room above 3:1, not copied from the
    # season, whose grey clears that floor in the third decimal: the clean corpus would then be
    # proving a rounding rather than the arm.
    ("--border-control", "#8a8a8a", "#666666"),
    ("--bg-hover", "#dfdfdf", "#212121"),
    ("--bg-hover-muted", "#cfcfcf", "#373737"),
    ("--bg-hover-danger", "#f2d9d2", "#321a14"),
    ("--bg-hover-field", "#3f7043", "#2f5633"),
    ("--accent-brand-solid-hover", "#1b5123", "#1b5123"),
    ("--accent-danger-solid-hover", "#c74434", "#c74434"),
    # A picked row's fill and its hover, held to one 6.7-point step by
    # `scripts/checks/docs_gate/scheme.py :: HOVERS`. The season's hexes because this fixture's page
    # grounds are the same, so the rule that derived them lands here too.
    ("--bg-picked", "#c1cdc1", "#2b352b"),
    ("--bg-picked-hover", "#abb8ac", "#3b473b"),
    ("--accent-brand", "#216c2d", "#8fc752"),
    # HeroUI's checked-`Switch` track and the thumb on it, the pair
    # `scripts/checks/docs_gate/scheme.py :: PAIRS` measures at a 3:1 floor.
    ("--accent", "#216c2d", "#8dbf6c"),
    ("--accent-foreground", "#ffffff", "#0a0a0a"),
    # The one token the light block alone declares, and the reason the two blocks differ by one.
    ("--focus", "var(--fg-base)", ""),
    ("--accent-brand-solid", "#033f11", "#033f11"),
    ("--accent-on-brand", "#8fc752", "#8fc752"),
    ("--accent-warn", "#ad8900", "#f2c94c"),
    ("--accent-danger", "#e16a4c", "#e76f51"),
    ("--accent-success", "#00a085", "#02c0a0"),
    ("--accent-info", "#466fbd", "#719def"),
    ("--accent-success-strong", "#006a58", "#01d5b2"),
    ("--accent-info-strong", "#3560b3", "#90b7ff"),
    ("--accent-warn-strong", "#855b00", "#fbd76e"),
    ("--accent-danger-strong", "#b02d1f", "#f89177"),
    ("--accent-success-solid", "#007864", "#007864"),
    ("--accent-warn-solid", "#f2c94c", "#f2c94c"),
    ("--accent-danger-solid", "#b02d1f", "#b02d1f"),
    ("--accent-info-solid", "#3560b3", "#3560b3"),
    ("--fg-on-success", "#ffffff", "#ffffff"),
    ("--fg-on-warn", "#0a0a0a", "#0a0a0a"),
    ("--fg-on-danger", "#ffffff", "#ffffff"),
    ("--fg-on-info", "#ffffff", "#ffffff"),
    ("--accent-phase-gruppenphase", "#026a73", "#00c1d1"),
    ("--accent-phase-achtelfinale", "#026799", "#47b5fa"),
    ("--accent-phase-viertelfinale", "#5d53ae", "#a29dff"),
    ("--accent-phase-halbfinale", "#8a428e", "#d78adb"),
    ("--accent-phase-finale", "#a13958", "#f3829f"),
    ("--field-base", "#38753f", "#16371a"),
    ("--field-card", "#2c5d31", "#1d4422"),
    ("--field-fg", "#ffffff", "#ffffff"),
    ("--field-border", "color-mix(in srgb, #ffffff 40%, transparent)", "color-mix(in srgb, #ffffff 20%, transparent)"),
    ("--skeleton-sweep", "color-mix(in srgb, #ffffff 55%, transparent)", "color-mix(in srgb, #ffffff 9%, transparent)"),
)
# Reached by no Tailwind utility, so the bridge below carries neither: the focus-visible rule reads
# one and the shimmer's own gradient the other.
UNBRIDGED_TOKENS: Final = ("--focus", "--skeleton-sweep")

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
# Under `.claude/hooks/` (the shell scope) and outside `PRESERVED`, so `_reset` removes it.
HOOK_SAMPLE: Final = ".claude/hooks/probe.sh"
# One committed file per folder the derivation table names that no other fixture holds: a cell's
# path is a backticked path like any other, so `path` reports one no tree carries.
COMMIT_HOOK: Final = ".githooks/pre-commit"
CLAUDE_HOOK: Final = ".claude/hooks/agreement.sh"
WORKFLOW: Final = ".github/workflows/gate.yml"
BACKEND_TEST: Final = "fl_backend/tests/test_agreement.py"
DOCKERFILE: Final = "fl_backend/Dockerfile"
# A root-level file a citation names, beside the attributes file: every other cited path sits under a
# prefix the resolver lists, so the root-level arm is driven by those two and nothing else.
COMPOSE_FILE: Final = "docker-compose.yml"
# A root-level directory arbitrary enough that no hand-written prefix list would carry it, planted
# rather than committed: the corpus every other case is measured against holds no such folder.
ROOT_FOLDER_FILE: Final = "editor/settings.json"
# Under that folder and nowhere on disk, which is the half a resolver blind to the folder passes.
DEAD_ROOT_FOLDER_PATH: Final = "editor/gone.json"
# The suffixless file read whole as prose by name, its paths written bare.
NOTICE_FILE: Final = "NOTICE"
# The other one, and the one carrying a suffix: read for its comments instead, this record's
# opening run is a module header INC-2 fails on the title line alone.
WALL_CLOCK: Final = ".github/gate-wall-clock.tsv"
WALL_CLOCK_LIVE_PATH: Final = SAMPLE
WALL_CLOCK_DEAD_PATH: Final = "docs/gone-from-the-wall-clock.md"
TAB: Final = chr(9)
# A live file and a directory, the two shapes the file names that must stay silent.
NOTICE_LIVE_PATH: Final = SAMPLE
NOTICE_DIRECTORY: Final = "fl_frontend/src/"
# The one-file standard, carrying both of the shapes a rule may take (PRE-4).
STANDARD: Final = "docs/_standard/standard.md"
# A rule of a second family, so a plant can retire a whole family from the tree while the fork
# still states it. Its field names no check, or the registry would have to claim it too.
RETIRED_ID: Final = "PRE-1"
FORK_ONLY_RULE: Final = "- **" + RETIRED_ID + ":** a rule whose family the fork alone states. _Enforced by_ review judgment."
# A dead path whose basename two live pages carry, and a live module spelled from a root no
# resolver reaches: the two halves of what "another spelling of this file" means.
SHARED_BASENAME: Final = "docs/backend/notes.md"
OTHER_SPELLING: Final = "spiele/router.py"
# A run the notes page does not carry, so a registry claim naming it resolves to a file and not to
# an anchor.
ABSENT_ANCHOR: Final = "no such anchor"
# What that standard's rules claim, and the registry under test is re-made to claim the same: the
# real registry names this repository's rules and pages, which the corpus below does not hold.
FIXTURE_CLAIMS: Final[dict[str, tuple[str, ...]]] = {"citation": ("COR-1",), "path": ("COR-1",), "glossary-entry": ("COR-2",)}
GLOSSARY: Final = "docs/glossary.md"
BACKEND_SPEC: Final = "docs/backend/spec.md"
FRONTEND_SPEC: Final = "docs/frontend/spec.md"
OVERVIEW: Final = "docs/backend/overview.md"
FRONTEND_OVERVIEW: Final = "docs/frontend/overview.md"
ROADMAP: Final = "docs/_roadmap/items.md"


def _tick(token: str) -> str:
    """A token as the page spells it: backticked, like every other identifier COR-6 governs."""
    return "`" + token + "`"


# Two ids from the entry alphabet, which holds no `i`, `l`, `o`, `0` or `1`. Random-looking on
# purpose: `check_added_citations` resolves an eight-character word against these tables, so an id
# spelling an English word would report every comment carrying that word.
DOCS_ENTRY: Final = "kxr7-m2qd"
SLICE_ENTRY: Final = "vb4n-hs9t"
# What a plant files without an entry under it, and an id carrying a letter the alphabet excludes.
ORPHAN_ENTRY: Final = "jd8s-hrkm"
MALFORMED_ENTRY: Final = "kxr7-m2qo"
# One item's claim, spelled once: the corpus writes it into the index row and the heading alike, and
# a plant rewriting either has to keep them in step.
DOCS_ITEM: Final = "Give the gate a fixture net"
SLICE_ITEM: Final = "Serve a fixture through the slice"
DOCS_ROW: Final = "| " + _tick(DOCS_ENTRY) + " | " + DOCS_ITEM + " | Docs | Open |"
SLICE_ROW: Final = "| " + _tick(SLICE_ENTRY) + " | " + SLICE_ITEM + " | BE, spiele | Open |"
# The derivation the page states, spelled out rather than lifted from the checker's own tuple, for
# `SCHEME_TOKENS`' reason.
TAG_DERIVATION: Final[tuple[tuple[str, str, str], ...]] = (
    ("**Surface**", "FE", "`fl_frontend/`"),
    # A backticked run that is no repository prefix, here and on the `ci` row: what parts a path
    # the arm holds from a folder the sentence merely names.
    ("", "BE", "`fl_backend/` whole, `tests/` included"),
    ("", "Ops", "`scripts/`, `nginx/`, `.githooks/`, `.claude/hooks/`, a compose file"),
    ("", "Docs", "`docs/`, `.claude/`"),
    ("**Concern**", "gate", "`scripts/gate/`, `scripts/checks/`, `.githooks/`, `.claude/hooks/`"),
    ("", "ci", "`.github/` whole, not its `workflows/` alone"),
    ("", "tests", "`scripts/tests/`, `fl_backend/tests/`"),
    ("", "edge", "`nginx/`"),
)
DERIVATION_HEADER: Final = "| Axis | Vocabulary | Derived from a path or symbol under |"
DERIVATION_ROWS: Final[tuple[str, ...]] = tuple(
    "| " + axis + " | " + _tick(tag) + " | " + sources + " |" for axis, tag, sources in TAG_DERIVATION
)
# The row a plant edits: it names four prefixes, so either edit leaves three of them standing and
# every other row answering.
GATE_DERIVATION_ROW: Final = next(row for row in DERIVATION_ROWS if _tick("gate") in row)
DROPPED_GATE_ROW: Final = GATE_DERIVATION_ROW.replace(", " + _tick(".claude/hooks/"), "")
WIDENED_GATE_ROW: Final = GATE_DERIVATION_ROW.replace(_tick(".claude/hooks/"), _tick(".claude/hooks/") + ", " + _tick("docs/"))
# A filename none of its own row's prefixes reaches: one they did reach would restate that reach
# rather than claim a source of its own.
UNHELD_FILE_ROW: Final = GATE_DERIVATION_ROW.replace(_tick(".claude/hooks/"), _tick(".claude/hooks/") + ", " + _tick("local.conf"))
# The row a subtree nothing holds is added to, its own cell still naming every prefix `edge` derives
# from, so the added token is all the comparison leaves.
EDGE_DERIVATION_ROW: Final = next(row for row in DERIVATION_ROWS if _tick("edge") in row)
UNHELD_SUBTREE_ROW: Final = EDGE_DERIVATION_ROW.replace(_tick("nginx/"), _tick("nginx/") + ", " + _tick("edgy/"))
# The same shape written legibly: a folder under a prefix the cell itself writes, which qualifies
# that prefix rather than deriving the tag from anywhere new.
BE_DERIVATION_ROW: Final = next(row for row in DERIVATION_ROWS if _tick("BE") in row)
QUALIFIED_BE_ROW: Final = BE_DERIVATION_ROW.replace(_tick("tests/"), _tick("tests/") + " and " + _tick("app/"))

# The page derives its status vocabulary here, and the fixture holds the table it derives it from.
PROTOCOL: Final = "docs/_roadmap/protocol.md"
STATUS_COLUMN_ROW: Final = "| # | When | Status |"
# The derivation's closing rule, spelled once: the corpus writes it and the widening case below
# anchors a new rule on it, renumbering this one as a real addition to the ladder would.
OTHERWISE_RULE: Final = "| 4 | Otherwise | **Open** |"
# A rule deriving the same word the refusal cases put outside the set, so that pair and the
# widening case differ in this row alone rather than in the word each plants.
ADDED_STATUS_RULE: Final = "| 4 | A rule the derivation gains | **Parked** |"
# The sheet `scripts/gate/selfcheck.sh` reads its output vocabulary out of, with the lead-in that
# arms that reader and one row under it in the shape it keeps.
OPS_SPEC: Final = "docs/ops/spec.md"
OUTPUT_LEAD_IN: Final = "**The output standard.** One vocabulary, one verb per meaning."
OUTPUT_VERB_ROW: Final = "| `step` | Opens a step and starts its timer |"
# The second lead-in on that sheet and one row under it: the same reader arms on both, and the
# checker resolves both, so a corpus carrying one is a corpus one arm fails against.
HELPER_LEAD_IN: Final = "**The helpers a script leans on.** Not output verbs."
HELPER_ROW: Final = "| `quietly` | Runs a command with both streams captured |"
# The refusal register, one row per tree, and the two spellings that answer for them. Each code is
# written twice on purpose: the page states it and the tree its area names raises it.
ERROR_CODES: Final = "docs/logging/error-codes.md"
BACKEND_CODE: Final = "REQ-SAMPLE-001"
FRONTEND_CODE: Final = "FE-SAMPLE-001"
BACKEND_RAISE: Final = 'RAISED = "' + BACKEND_CODE + '"'
FRONTEND_RAISE: Final = '  const code = "' + FRONTEND_CODE + '";'
# The rule register the wording column's population is derived from, at the path the checker names.
DOMAIN_REGISTER: Final = "fl_backend/app/core/domain.py"
# One declared rule per arm the wording column takes, so a plant breaking one leaves the rest
# answering. The first is the code the row comparison above already turns on.
WORDED_CODES: Final[tuple[str, ...]] = (BACKEND_CODE, "REQ-SAMPLE-002", "REQ-SAMPLE-003", "REQ-SAMPLE-004", "REQ-SAMPLE-005")
# The module wording them, and one naming a code in a comment alone: a citation resolved by
# presence would land on the second, which is what the comment arm below refuses.
REFUSAL_SAMPLE: Final = "fl_frontend/src/refusals.ts"
REMARK_SAMPLE: Final = "fl_frontend/src/remarks.ts"
MAPPER_CITATION: Final = "`" + REFUSAL_SAMPLE + " :: mapSampleRefusal`"
# The second frontend row exists for the boundary arm alone: the first is the anchor two row-
# comparison plants already grow rows beneath.
SECOND_FRONTEND_CODE: Final = "FE-SAMPLE-002"
WORDED_MEANING: Final = "The sample module refused another write"
SECOND_FRONTEND_MEANING: Final = "The sample component asked for a page that is gone"

# One test module per tier, the case readers differing. Every name below is English: this tree is
# the copy sweep's corpus as well as the citation resolver's.
CASE_MODULE: Final = "fl_frontend/src/sample.test.ts"
CITED_SUITE: Final = "the suite one document cites into"
SECOND_SUITE: Final = "a second suite of the same module"
CITED_CASE: Final = "a case one document cites by name"
SECOND_CASE: Final = "a second case of the citing suite"
UNCITED_CASE: Final = "a case no document cites"
# Spelled with an escape the anchor does not carry, which is what the presence arm refuses ahead of
# any count.
ESCAPED_CASE: Final = "a case naming a writer's own apostrophe"
ESCAPED_SOURCE: Final = "'" + ESCAPED_CASE.replace("'", "\\'") + "'"
# A string naming no case, spelled twice, which is what a reader counting literals rather than case
# calls fails the clean corpus over.
REPEATED_STRING: Final = "a label this module spells twice"
PYTHON_CASE_CLASS: Final = "TestOneSubject"
SECOND_PYTHON_CLASS: Final = "TestAnotherSubject"
CITED_PYTHON_CASE: Final = "test_a_case_one_document_cites_by_name"
SECOND_PYTHON_CASE: Final = "test_a_case_of_the_second_class"
UNCITED_PYTHON_CASE: Final = "test_a_case_no_document_cites"


def _code_row(code: str, meaning: str, worded: str | None) -> str:
    """One register row, its wording cell dropped where None -- the shape a row without the column keeps."""
    return "| `" + code + "` | " + meaning + (" |" if worded is None else " | " + worded + " |")


def _refusal_arm(code: str) -> str:
    """A reader excluding a comment by substring, not by column, takes the answer beside a remark with it."""
    remark = " // " + code + " is the arm this line answers" if code == WORDED_CODES[1] else ""
    return '    "' + code + '",' + remark


BACKEND_ROW: Final = _code_row(BACKEND_CODE, "The sample module refused a write", MAPPER_CITATION)
FRONTEND_ROW: Final = _code_row(FRONTEND_CODE, "The sample component could not read the answer", "—")
SECOND_FRONTEND_ROW: Final = _code_row(SECOND_FRONTEND_CODE, SECOND_FRONTEND_MEANING, "—")
# One entry per agreement arm, so a plant breaking one leaves the others answering. They ascend as
# the page's own listings do.
STATUS_ENTRY: Final = "bqxs-4dtn"
VOCAB_ENTRY: Final = "dm93-7kvz"
BLOCKED_ENTRY: Final = "gtz5-9wqr"
# Sorting below every one of them, and appended by a plant rather than committed: it is what ends
# the run the other three are in.
ORDER_ENTRY: Final = "2xkq-7bnm"
STATUS_ITEM: Final = "Hold both listings' status cells to each other"
VOCAB_ITEM: Final = "Hold a status to the vocabulary deriving it"
BLOCKED_ITEM: Final = "Hold a blocked entry to the column beside it"
ORDER_ITEM: Final = "File an entry below the run it belongs to"
# One effort apiece, a value nothing reads, so a plant naming a field row reaches the entry it means.
STATUS_FIELDS: Final = "| Docs | Open | L | — |"
VOCAB_FIELDS: Final = "| Docs | Open | XL | — |"
BLOCKED_FIELDS: Final = "| Docs | Open | XS | — |"
ORDER_FIELDS: Final = "| Docs | Open | XXL | — |"
# One line of prose apiece, each naming the page every fixture entry's tag derives from.
STATUS_PROSE: Final = "A status arm needs an entry beside `docs/notes.md` whose two cells a plant can part."
VOCAB_PROSE: Final = "A vocabulary arm needs an entry beside `docs/notes.md` carrying a word to put outside the set."
BLOCKED_PROSE: Final = "A blocked arm needs an entry beside `docs/notes.md` whose dependency column stays an em dash."
ORDER_PROSE: Final = "An order arm needs an entry beside `docs/notes.md` filed below the run above it."
STATUS_ROW: Final = "| " + _tick(STATUS_ENTRY) + " | " + STATUS_ITEM + " | Docs | Open |"
VOCAB_ROW: Final = "| " + _tick(VOCAB_ENTRY) + " | " + VOCAB_ITEM + " | Docs | Open |"
BLOCKED_ROW: Final = "| " + _tick(BLOCKED_ENTRY) + " | " + BLOCKED_ITEM + " | Docs | Open |"
ORDER_ROW: Final = "| " + _tick(ORDER_ENTRY) + " | " + ORDER_ITEM + " | Docs | Open |"
# The heading closing the page. Every plant that APPENDS to this page lands under it, so nothing a
# case appends is read as the last entry's own prose.
ROADMAP_TAIL: Final = "Appendix"
# The slice entry's closing line, spelled once: a plant anchors the batching line on it to put that
# line INSIDE the entry, which an append to the page could not do.
SLICE_DONE: Final = "Done is `fl_backend/app/api/spiele/router.py` serving the read the panel beside it asks for."
TEMPLATES: Final = "docs/_git/templates.md"
SWEEP: Final = ".claude/commands/docs/audit.md"
ROOT_README: Final = "README.md"
UNTRACKED_DIR: Final = "untracked"
UNTRACKED_TWIN: Final = UNTRACKED_DIR + "/glossary.md"
# What a branch-wide finding names in place of a file, because the phrases it counts are the diff's
# rather than any one page's.
BRANCH_DIFF: Final = "(branch diff)"
# What a finding about a registered claim names: the registry, which the fixture holds only as the
# gitignored copy it imports the gate from.
KERNEL: Final = "scripts/checks/docs_gate/kernel.py"
# A check whose name that file spells on its registry row and nowhere else, so a claim citing the
# name as the kernel's own anchor is proved by the row making it or by nothing at all.
SELF_CLAIMED_CHECK: Final = "copy-corpus"

# The partition, anchored on folder names rather than `**/*`: a path git spelled in quotes, which a
# listing without `-z` returns for a name outside ASCII, then matches no segment and reads as
# unclaimed.
FOLDER_SEGMENT: Final = (
    "| Folders | `docs/**` · `fl_backend/**` · `fl_frontend/**` · `nginx/**` · `.claude/**` · `.github/**` · `.githooks/**` |"
)
ROOT_SEGMENT: Final = "| Root files | `*` |"

SCRIPTS_COPY: Final = "scripts"
HOOKS_STUB: Final = "nohooks"
GITIGNORE: Final = ".gitignore"
# What a plant parks where the corpus reaches, to be told it does not. The ignored one models a
# scratch file somebody left in the tree; the skipped one a running audit programme's working notes.
IGNORED_MODULE: Final = "ignored/scratch.py"
IGNORED_PAGE: Final = "ignored/scratch.md"
SKIPPED_MODULE: Final = "docs/audit/scratch.py"
# A module python refuses to tokenize, so the comment reader falls back to its marker scan. Planted
# rather than committed: the corpus every other case is measured against holds no such file.
UNTOKENIZABLE_MODULE: Final = "fl_backend/app/untokenizable.py"
# A file a plant writes and never stages, which is what a branch holds when the gate runs.
UNSTAGED_MODULE: Final = "fl_backend/app/unstaged.py"
UNSTAGED_BLOCK: Final = "fl_backend/app/unstaged_block.py"
# The one path a plant writes into more than one file, so placement is what a finding turns on.
DEAD_PATH: Final = "docs/gone-in-an-unstaged-module.md"
# One cell past the words a cell may hold, and one passage past what makes a repeat worth naming.
# Both are spelled once: a plant writes them into two places, and the check reads what it finds.
PARAGRAPH_CELL: Final = (
    "The write path validates its input before it stores anything, because a document that fails "
    "validation after the write has already reached every reader of the collection"
)
ECHOED_PASSAGE: Final = (
    "A passage long enough that repeating it is a second home rather than a turn of phrase, "
    "so the reader who finds both has no way to tell which of the two is the one being maintained."
)
# A heading a citation names and a plant then renames, its wording left standing in prose: the
# shape a presence test goes on reading as alive.
CITED_HEADING: Final = "The rollover the season page runs"
RENAMED_HEADING: Final = "The rollover the season page starts"
# Inside the notes page's fenced sample, so an anchor a renderer shows nobody resolves nothing.
FENCED_ANCHOR: Final = "docs/gone-inside-a-fence.md"
# The glossary heading the notes page cites by bare name, spelled in both the form the page
# writes and the form a citation may carry: a citation admits no backtick of its own.
GLOSSARY_TERM: Final = "saison"
GLOSSARY_GLOSS: Final = "the competition year"
GLOSSARY_HEADING: Final = _tick(GLOSSARY_TERM) + " — " + GLOSSARY_GLOSS
GLOSSARY_ANCHOR: Final = GLOSSARY_TERM + " — " + GLOSSARY_GLOSS
# What the fixture is BUILT out of rather than checked. Naming what must SURVIVE the reset keeps this
# from growing with the corpus, which is the list nobody remembers to extend.
PRESERVED: Final[tuple[str, ...]] = (SCRIPTS_COPY, HOOKS_STUB, UNTRACKED_DIR)

# A section both spec sheets define, and one no page in the corpus does.
SPEC_SUBSECTION: Final = "1.1"
ABSENT_SECTION: Final = "9"


def _heading(level: int, text: str) -> str:
    return HASH * level + " " + text


def _page(*lines: str) -> str:
    return "\n".join(lines) + "\n"


# A rule listing whose middle line opens on a bullet the block reader cannot end on, so that line
# is swallowed by the block above it.
SWALLOWING_STANDARD: Final = _page(
    "- **COR-1:** first. _Enforced by_ `citation`.",
    "-",
    "  **COR-2:** second. _Enforced by_ `path`.",
    "- **COR-13:** third. _Enforced by_ review judgment.",
)


def _roadmap_entry(token: str, item: str, fields: str, prose: str) -> str:
    """One agreement arm's entry, in the shape the page's committed entries carry.

    The claim is spelled once and written into the heading and the index row alike, so a plant
    parting the two has to say so.
    """
    return _page(
        _heading(3, _tick(token) + " · " + item),
        "",
        "| Tags | Status | Effort | Depends on |",
        "| --- | --- | --- | --- |",
        fields,
        "",
        prose,
    ).rstrip("\n")


def _scheme_page() -> str:
    """One season's scheme file: the light block, then the dark one minus what it never declares.

    The bare `:root` at the end is a third block, which a reader scanning for one would take.
    """
    lines = ["@layer base {", "  :root,", '  [data-theme="light"] {']
    lines += [f"    {token}: {light};" for token, light, _ in SCHEME_TOKENS]
    lines += ["  }", "", '  [data-theme="dark"] {']
    lines += [f"    {token}: {dark};" for token, _, dark in SCHEME_TOKENS if dark]
    lines += ["  }", "}", "", "@media (prefers-reduced-motion: reduce) {", "  :root {", "    --card-enter-shift: 0;", "  }", "}"]
    return _page(*lines)


def _globals_page() -> str:
    """The stylesheet importing the season, carrying the bridge the roster is resolved against."""
    lines = ["@layer theme, base, components, utilities;", '@import "tailwindcss";', '@import "./schemes/2025-26.css";', "", "@theme {"]
    lines += [f"  --color-{token[2:]}: var({token});" for token, _, _ in SCHEME_TOKENS if token not in UNBRIDGED_TOKENS]
    lines += ["}"]
    return _page(*lines)


def _corpus(fragments: tuple[str, ...]) -> dict[str, str]:
    """The clean corpus, keyed by repository path.

    The pull request form derives from the body gate's own constants; a hand-written copy would
    fail the fixture the day a fragment is reworded.
    """
    return {
        GITATTRIBUTES: _page("* text=auto eol=lf", "*.bin binary"),
        # The copy of scripts/ this fixture imports the gate from sits in the tree untracked, and
        # the corpus reads the working tree: unignored, the gate would scan its own source against
        # this corpus and report every citation it carries.
        GITIGNORE: _page("/" + SCRIPTS_COPY + "/", "/" + IGNORED_MODULE.partition("/")[0] + "/"),
        ROOT_README: _page(
            _heading(1, "Fixture repository"),
            "",
            "A minimal corpus the documentation gate is driven against.",
        ),
        NOTES: _page(
            _heading(1, "Notes"),
            "",
            "A plain page, which is where a planted violation is written.",
            "",
            "A bare name resolves to the tracked file alone: " + _tick("glossary.md :: " + GLOSSARY_ANCHOR) + ".",
            "",
            # One reference by each route the resolver takes, each naming a section the sheet does
            # define: only a number that resolves parts resolution from a silent skip.
            "A link to [§" + SPEC_SUBSECTION + "](backend/spec.md) resolves.",
            "",
            "So do the path `docs/backend/spec.md` §" + SPEC_SUBSECTION + " and [the sheet](backend/spec.md) §" + SPEC_SUBSECTION + ".",
            "",
            # The continuation form, resolving. A resolver that stopped placing one would fail every
            # case in the loop here, which is what parts a real placement from a silent skip.
            "`fl_backend/app/sample.py :: VALUE` and `:: S` are both defined there.",
            "",
            # Three the case-name arm reads and passes: one case, a string naming no case, and the
            # other tier's reader. Each is the arm's silence, held by the clean corpus.
            "One case answers " + _tick(CASE_MODULE + " :: " + CITED_CASE) + ".",
            "",
            "So does " + _tick(CASE_MODULE + " :: " + REPEATED_STRING) + ", which names none.",
            "",
            "And " + _tick(BACKEND_TEST + " :: " + CITED_PYTHON_CASE) + " on the other tier.",
            "",
            "A citation that wraps is still one citation: `docs/glossary.md ::",
            GLOSSARY_ANCHOR + "` resolves across the break.",
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
            # both fragments below resolve, one anchoring in this page and one from the page beside it.
            _heading(2, "The saison_id field"),
            "",
            "A link to [the field](#the-saison_id-field) resolves.",
            "",
            _heading(2, "Setup"),
            "",
            _heading(2, "Setup"),
            "",
            "A link to [the repeated heading](#setup-1) resolves.",
            "",
            # A fenced example, so every reader that blanks a fence has one to blank. What stands
            # inside resolves to nothing, so a reader that stopped blanking reports it as the
            # page's own claim rather than as the sample it is.
            FENCE + "markdown",
            "A `docs/gone-inside-a-fence.md` path, and `OUT-99` beside it.",
            FENCE,
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
            "The vocabulary, one entry each.",
            "",
            _heading(2, "Terms"),
            "",
            _heading(3, GLOSSARY_HEADING),
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
        STANDARD: _page(
            _heading(1, "Documentation standard"),
            "",
            # The one page whose metadata block runs to two entries, so the break rule has both a
            # line that must carry one and a line that must not -- and so a join has something to
            # join to. Every other page carries a block of one.
            "**Purpose:** every rule this corpus is held to, in one file.\\",
            "**Applies to:** every written artifact this corpus holds.",
            "",
            # The one shape PRE-4 admits. The enforcement claims name real checks, so the clean
            # corpus resolves every one; a section-shaped rule is what a plant adds.
            "- **COR-1:** write for a reader with no context. _Enforced by_ `citation` and `path`.",
            "- **COR-2:** a fact is stated in full in one place and cited from everywhere else. _Enforced by_ `glossary-entry`.",
            "- **COR-13:** a rule stated as a list line alone still claims enforcement. _Enforced by_ review judgment.",
            FORK_ONLY_RULE,
        ),
        ROADMAP: _page(
            _heading(1, "Items"),
            "",
            "**Purpose:** what is open, in one file.",
            "",
            DERIVATION_HEADER,
            "| --- | --- | --- |",
            *DERIVATION_ROWS,
            "",
            "| ID | Item | Tags | Status |",
            "| --- | --- | --- | --- |",
            STATUS_ROW,
            VOCAB_ROW,
            BLOCKED_ROW,
            DOCS_ROW,
            SLICE_ROW,
            "",
            _roadmap_entry(STATUS_ENTRY, STATUS_ITEM, STATUS_FIELDS, STATUS_PROSE),
            "",
            _roadmap_entry(VOCAB_ENTRY, VOCAB_ITEM, VOCAB_FIELDS, VOCAB_PROSE),
            "",
            _roadmap_entry(BLOCKED_ENTRY, BLOCKED_ITEM, BLOCKED_FIELDS, BLOCKED_PROSE),
            "",
            _heading(3, _tick(DOCS_ENTRY) + " · " + DOCS_ITEM),
            "",
            "| Tags | Status | Effort | Depends on |",
            "| --- | --- | --- | --- |",
            "| Docs | Open | S | — |",
            "",
            "No check is driven against a planted violation. A check nobody drives red is one nobody",
            "proved. Done is a net beside `docs/notes.md` that plants one violation per check.",
            "",
            _heading(3, _tick(SLICE_ENTRY) + " · " + SLICE_ITEM),
            "",
            "| Tags | Status | Effort | Depends on |",
            "| --- | --- | --- | --- |",
            "| BE, spiele | Open | M | — |",
            "",
            "The slice answers no request. A reader filtering on it meets one half of the feature.",
            SLICE_DONE,
            "",
            _heading(2, ROADMAP_TAIL),
            "",
            "A closing section, so a line a plant appends lands outside every entry rather than inside the last one.",
        ),
        ERROR_CODES: _page(
            _heading(1, "Logging — error codes"),
            "",
            "**Purpose:** every code either service raises, and where a declared rule is worded.",
            "",
            "| Code | Meaning | Worded by |",
            "| --- | --- | --- |",
            BACKEND_ROW,
            *(_code_row(code, WORDED_MEANING, MAPPER_CITATION) for code in WORDED_CODES[1:]),
            FRONTEND_ROW,
            SECOND_FRONTEND_ROW,
        ),
        OPS_SPEC: _page(
            _heading(1, "Ops — spec"),
            "",
            "The contract the scripts answer to.",
            "",
            _heading(2, "1. Contract"),
            "",
            _heading(3, "1.1 Script conventions"),
            "",
            OUTPUT_LEAD_IN,
            "",
            "| Verb | Means |",
            "| --- | --- |",
            OUTPUT_VERB_ROW,
            "",
            HELPER_LEAD_IN,
            "",
            "| Helper | Answers |",
            "| --- | --- |",
            HELPER_ROW,
            "",
            _heading(2, "2. Invariants"),
            "",
            "| ID | Invariant | Enforced by |",
            "| --- | --- | --- |",
            "| I2 | Every script speaks one output vocabulary | The self-check's verb reader |",
            "",
            _heading(2, "3. Violation → remedy"),
            "",
            "| Symptom | Remedy |",
            "| --- | --- |",
            "| A script printing formatting of its own | Call the verb instead |",
            "",
            _heading(2, "4. Known-open"),
            "",
            "No verb is unread.",
        ),
        PROTOCOL: _page(
            _heading(1, "Protocol"),
            "",
            "**Purpose:** what a status may say, in one file.",
            "",
            _heading(2, "4. Re-derive every status"),
            "",
            STATUS_COLUMN_ROW,
            "| --- | --- | --- |",
            "| 1 | An entry this one waits on is still filed here | **Blocked** |",
            "| 2 | A caution, or a finding carrying a recorded trigger | **Standing** |",
            "| 3 | The argument is settled where the next reader stands | **Decided** |",
            OTHERWISE_RULE,
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
            "",
            BACKEND_RAISE,
        ),
        MARKER_SAMPLE: _page(
            QUOTES + "BACKEND · a module whose citations wrap, one per marker shape." + QUOTES,
            "",
            HASH + " The hash reader, wrapped mid-citation: `fl_backend/app/sample.py ::",
            HASH + " VALUE` still names the symbol it named before the break.",
            "MARKED = 1",
        ),
        MARKER_TSX: _page(
            "/* FRONTEND · a module whose citations wrap under the c-style readers. */",
            "",
            "// The slash reader, wrapped mid-citation: `fl_backend/app/sample.py ::",
            "// VALUE` survives the join with its anchor intact.",
            "",
            "/* A block comment already joins cleanly, its continuation carrying a star:",
            " * `fl_backend/app/sample.py :: VALUE` is one citation either way. */",
            "export const MARKED = 1;",
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
        LEGACY_SAMPLE: _page(
            QUOTES + "BACKEND · a module whose comments the corpus committed before any plant." + QUOTES,
            "",
            # Committed over the word bound, and silent while nothing touches it: a run with an
            # empty diff adds no line, which is what leaves an untouched block outside the check.
            *[HASH + " " + line for line in (LEGACY_OPENING, LEGACY_MIDDLE, LEGACY_CLOSING)],
            "LEGACY = 1",
            "",
            HASH + " " + SHORT_LINE,
            "SHORT = 2",
        ),
        UMLAUT_MODULE: _page(
            QUOTES + "BACKEND · a module whose own name no ASCII listing can spell." + QUOTES,
            "",
            "UMLAUT = 1",
        ),
        SPIELE_ROUTER: _page(
            QUOTES + "BACKEND · the slice an entry names, so a derived tag has a folder to come from." + QUOTES,
            "",
            "SPIELE = 1",
        ),
        TEAMS_ROUTER: _page(
            QUOTES + "BACKEND · a second slice, so a row can carry a tag the entry derives nothing for." + QUOTES,
            "",
            "TEAMS = 1",
        ),
        SPIELER_PANEL: _page(
            "export function Panel() {",
            "  return <output>a third slice, and the one spelled on the frontend alone</output>;",
            "}",
        ),
        SLICE_STRAY: _page(
            "export const REGISTRY = 1;",
        ),
        TSX_SAMPLE: _page(
            "export function Sample() {",
            FRONTEND_RAISE,
            '  const gone = "' + SECOND_FRONTEND_CODE + '";',
            "  return <output>a component the corpus scans, {gone}</output>;",
            "}",
        ),
        REFUSAL_SAMPLE: _page(
            "export function mapSampleRefusal(code: string) {",
            "  return [",
            *(_refusal_arm(code) for code in WORDED_CODES),
            "  ].includes(code);",
            "}",
        ),
        REMARK_SAMPLE: _page(
            "// " + WORDED_CODES[-1] + " is named here and answered nowhere in this module.",
            "export const REMARKED = 1;",
        ),
        CASE_MODULE: _page(
            'describe("' + CITED_SUITE + '", () => {',
            '  it("' + CITED_CASE + '", () => {});',
            '  it("' + SECOND_CASE + '", () => {});',
            "});",
            "",
            'describe("' + SECOND_SUITE + '", () => {',
            '  it("' + UNCITED_CASE + '", () => {});',
            # A comment quoting the cited case. A reader that stopped masking comments counts a
            # second declaration of it and fails the clean corpus.
            "  // The case " + _tick("it(" + QUOTE + CITED_CASE + QUOTE + ")") + " is declared above.",
            '  const label = "' + REPEATED_STRING + '";',
            '  const again = "' + REPEATED_STRING + '";',
            "});",
        ),
        DOMAIN_REGISTER: _page(
            QUOTES + "BACKEND · the rule register a refusal code's wording is cited against." + QUOTES,
            "",
            "RULES: tuple[Rule, ...] = (",
            *('    Rule(code="' + code + '"),' for code in WORDED_CODES),
            ")",
        ),
        SCHEME: _scheme_page(),
        APP_GLOBALS: _globals_page(),
        COPY_SAMPLE: _page(
            "export function Copy() {",
            "  const zeitraum = `${formatSpielDatum(start)} – ${formatSpielDatum(ende)}`;",
            '  return <p title="Der Zeitraum dieser Saison, und nichts weiter.">{zeitraum}</p>;',
            "}",
        ),
        # Each opens on a titled block: the `#` reader answers for every one of these kinds, so the
        # opening block is a module header held to INC-2's shape, a page's H1 alone excepted.
        TOML_CONFIG: _page(
            "# BACKEND · a configuration file, scanned for its comments and nothing else.",
            "",
            "[project]",
            'name = "fixture"',
        ),
        YAML_CONFIG: _page(
            "# FRONTEND · a configuration file, scanned for its comments and nothing else.",
            "packages:",
            "  - fixture",
        ),
        CONF_FILE: _page(
            "# OPS · a server block, scanned for its comments and nothing else.",
            "server { listen 80; }",
        ),
        SHELL_FILE: _page(
            "#!/usr/bin/env bash",
            "# OPS · an entry point, scanned for its comments and nothing else.",
            "exec nginx",
        ),
        # The four folders the derivation table names that nothing else here holds. Each is one
        # file, because a folder is tracked only while something under it is.
        COMMIT_HOOK: _page(
            "#!/usr/bin/env bash",
            "# OPS · a commit hook, holding open the folder two derivation rows name.",
            "exec true",
        ),
        CLAUDE_HOOK: _page(
            "#!/usr/bin/env bash",
            "# OPS · a guard, holding open the hook folder two derivation rows name.",
            "exec true",
        ),
        WORKFLOW: _page(
            "# OPS · a workflow, holding open the folder the `ci` row names.",
            "name: gate",
            "on: push",
        ),
        BACKEND_TEST: _page(
            QUOTES + "BACKEND · a test module, holding open the folder the `tests` row names." + QUOTES,
            "",
            "TESTED = 1",
            "",
            "",
            "class " + PYTHON_CASE_CLASS + ":",
            "    def " + CITED_PYTHON_CASE + "(self) -> None: ...",
            "",
            "    def " + UNCITED_PYTHON_CASE + "(self) -> None: ...",
            "",
            "",
            "class " + SECOND_PYTHON_CLASS + ":",
            "    def " + SECOND_PYTHON_CASE + "(self) -> None: ...",
        ),
        DOCKERFILE: _page(
            "# BACKEND · an image, reached by whole filename rather than by suffix.",
            "FROM scratch",
        ),
        COMPOSE_FILE: _page(
            "# OPS · a service definition, sitting where no prefix reaches it.",
            "services:",
            "  fixture:",
            "    image: scratch",
        ),
        # The marker opens it, where the `#` reader takes the first line for a module header: the
        # prose test in `check_file` is the only thing holding INC-2's shape off a file read whole.
        NOTICE_FILE: _page(
            HASH + " Fixture League",
            "",
            "The following are published here and are not part of the Software:",
            "",
            "  " + NOTICE_LIVE_PATH,
            "  " + NOTICE_DIRECTORY,
        ),
        WALL_CLOCK: _page(
            HASH + " The gate's wall clock, one row per job: what it costs, and the most it may cost.",
            HASH,
            HASH + " Its paths are written bare, as " + WALL_CLOCK_LIVE_PATH + " is here.",
            HASH,
            HASH + " job" + TAB + "seconds",
            "docs" + TAB + "39",
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


# --- the fixture repository ----------------------------------------------------------------------


# The shorter of the two lengths `sha` matches, and the one the fixture mints against: a prefix
# carrying a digit and a letter at seven carries them at eight as well.
SHORT_FORM: Final = 7
# How many amends the short form is given. A hash carrying only digits or only letters is rare
# enough that a bound this size never runs out, and an unbounded loop would hang instead of failing.
MIXED_FORM_TRIES: Final = 60


# The branch net mints its fixture's short form the same way
# (`scripts/tests/test_branch_checks.py :: _mix_the_short_form`), over a fixture this module cannot
# reach: the two nets build a repository each.
def _mix_the_short_form(root: Path) -> None:
    """Amend until HEAD's short form carries a digit and a letter both.

    The sha arm needs one, and a commit's own hash carries it only by chance; amending moves the
    hash and leaves the tree alone.
    """
    for attempt in range(MIXED_FORM_TRIES):
        short = git(root, "rev-parse", "HEAD")[:SHORT_FORM]
        if any(c.isdigit() for c in short) and any(c.isalpha() for c in short):
            return
        # The author date, the one field a commit takes from an argument rather than from the clock:
        # a second amend inside one second is otherwise the same commit, and the loop repeats it
        # until the committer second ticks.
        git(root, "commit", "--amend", "--no-edit", "--date", "2026-01-01T00:00:" + str(attempt).rjust(2, "0") + "+00:00")
    raise AssertionError("no amend of the corpus commit in " + str(MIXED_FORM_TRIES) + " gave it a mixed short form")


def _build(root: Path, pages: dict[str, str]) -> None:
    """Write and commit the corpus."""
    for rel, text in pages.items():
        write(root, rel, text)
    # Tracked, and outside every scanned suffix, so a citation can name a file the reader cannot
    # decode without `unreadable` firing about the same file and hiding which check spoke.
    (root / UNDECODABLE).write_bytes(b"\xff\xfe\x00 not text \x00")

    (root / HOOKS_STUB).mkdir()
    configure(root, str(root / HOOKS_STUB))
    # The corpus by name, never `add -A`: the copy of scripts/ sits in this tree too, and tracking it
    # would put this repository's own documentation through a gate holding the fixture's corpus.
    git(root, "add", "--", *pages, UNDECODABLE)
    git(root, "commit", "-m", "Corpus: the gate finds nothing here")
    _mix_the_short_form(root)

    # An untracked twin of a corpus page: the bare name the notes page cites must resolve past it.
    # `_reset` asserts it survives, because a deleted twin resolves that citation for the wrong reason.
    write(root, UNTRACKED_TWIN, (root / GLOSSARY).read_text(encoding="utf-8"))


@dataclass(frozen=True)
class Fixture:
    """The gate as the fixture repository sees it: the copied modules, and the root they resolve to."""

    gate: ModuleType
    body_gate: ModuleType
    root: Path


def _load() -> Fixture:
    """The checker, imported from a copy of scripts/ inside a fresh fixture repository."""
    root = new_root("check-docs-fixture-")
    copy_scripts(root / SCRIPTS_COPY)
    sys.path.insert(0, str(root / SCRIPTS_COPY / "checks"))
    withdraw("check_docs", "check_pr_body", "checker_kernel", "docs_gate")
    gate = importlib.import_module("check_docs")
    # The seam itself, stated as an assertion: the checker derives its repository root from its own
    # location, so importing this copy is what points every check at the corpus below instead of here.
    assert Path(gate.__file__ or "").resolve().parents[2] == root, "the gate under test is not the copy"
    body_gate = importlib.import_module("check_pr_body")
    assert vars(sys.modules["checker_kernel"])["REPO_ROOT"] == root, "the gate under test reads another fixture's tree"
    # The platform check's rows name this repository's own files and the corpus below holds none of
    # them: a row outside the scanned population is a finding, so this fixture answers for its own.
    platform = importlib.import_module("docs_gate.platform")
    assert Path(platform.__file__ or "").resolve().is_relative_to(root), "the platform module is not the copy"
    platform.PLATFORM_ALLOW.clear()
    platform.TEXT_WRITE_ALLOW.clear()
    # The registry's claims, for the same reason: every check keeps its verdicts and answers to the
    # fixture standard's own rules, or to the gate.
    kernel = importlib.import_module("docs_gate.kernel")
    assert Path(kernel.__file__ or "").resolve().is_relative_to(root), "the kernel module is not the copy"
    for name, check in list(kernel.CHECKS.items()):
        kernel.CHECKS[name] = kernel.Check(check.severities, kernel.claimed(*FIXTURE_CLAIMS.get(name, (kernel.GATE,))))
    _build(root, _corpus(body_gate.TEMPLATE_FRAGMENTS))
    return Fixture(gate, body_gate, root)


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
    # The fixture first: loading it is what puts its copy of scripts/ on the path, so a case whose
    # only reach into the gate is this call would otherwise import nothing at all.
    root = _gate().root
    module = importlib.import_module(name)
    assert Path(module.__file__ or "").resolve().is_relative_to(root), name + " is not the copy under test"
    return module


# --- driving it ----------------------------------------------------------------------------------

FINDING_RE: Final = re.compile(r"\[([a-z][a-z0-9-]*)\]$")
FAILING: Final = "failing finding"

# One printed finding. The file separates a check that fires from one firing about the wrong page;
# counting the triples separates a check with two producers from one that has lost one.
Reported = tuple[str, str, str]

# What a printed finding names before its detail: a file, or a file and the line the check looked
# at, which `scripts/checks/docs_gate/kernel.py :: Finding` renders. The line is read out rather
# than folded into the file, so a case can turn on either.
SUBJECT_RE: Final = re.compile(r"^(.*?)(?::(\d+))?$")


def _subject(text: str) -> tuple[str, int | None]:
    """A printed finding's file, and the line it named or None."""
    match = SUBJECT_RE.match(text.partition(": ")[0])
    assert match is not None, "a finding named nothing: " + text
    return match.group(1), None if match.group(2) is None else int(match.group(2))


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
        elif (match := FINDING_RE.search(text)) is None:
            continue
        # A finding under no severity heading means the run's shape moved. Left silent it would read
        # as a check that stopped firing, which is the one answer this file must not invent.
        elif severity:
            seen[(severity, match.group(1), _subject(text)[0])] += 1
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
            # A class's `cache_clear` is unbound: only instances hold answers.
            if isinstance(value, type):
                continue
            clear = getattr(value, "cache_clear", None)
            if callable(clear):
                clear()


def _output() -> tuple[int, str]:
    """One run's exit code and everything it printed, for a case that turns on a finding's words.

    Two arms of one check reaching one file under one name leave the counted triples unable to
    part them.
    """
    fixture = _gate()
    _clear_caches(fixture.root / SCRIPTS_COPY)
    buffer = io.StringIO()
    argv = sys.argv
    sys.argv = ["check_docs.py"]
    try:
        with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(buffer):
            code = int(fixture.gate.main())
    finally:
        sys.argv = argv
    return code, buffer.getvalue()


def _run() -> tuple[int, Counter[Reported]]:
    code, output = _output()
    return code, _reported(output)


def _about(check: str, reported: Counter[Reported]) -> list[Reported]:
    """Every finding one check reported, whatever the file."""
    return [key for key in reported if key[1] == check]


def _assert_corpus_restored() -> None:
    """No case left the index carrying something the reset cannot reach.

    The reset reaches only paths HEAD knows, so a staged NEW file would survive into the corpus
    later cases are measured against.
    """
    dirty = git(_gate().root, "status", "--porcelain", "-uno")
    assert dirty == "", "a case left the index or the tree changed after the reset:\n" + dirty


def _reset() -> None:
    """The corpus as it was committed, with only `PRESERVED` left standing."""
    root = _gate().root
    excludes = [argument for name in PRESERVED for argument in ("-e", "/" + name)]
    # A plant's staged file is tracked, so `git clean` skips it and the checkout below cannot reach
    # a path HEAD never held: unstaging first is what keeps it out of every later case's corpus.
    git(root, "reset", "-q", "HEAD", "--", ".")
    # HEAD, not the index: a bare `git checkout -- .` restores what is STAGED, handing a plant's
    # own edit to the cases after it, silently.
    git(root, "checkout", "HEAD", "--", ".")
    git(root, "clean", "-fdq", *excludes)
    # The twin only guards while it is untracked and outside the reset's reach. Moving it inside would
    # leave the bare-name citation resolving for the wrong reason, with the suite still green.
    assert (root / UNTRACKED_TWIN).is_file(), UNTRACKED_TWIN + " did not survive the reset, so it guards nothing"


# --- the plants ----------------------------------------------------------------------------------


def _read(rel: str) -> str:
    root = _gate().root
    return (root / rel).read_text(encoding="utf-8")


def _replace(rel: str, old: str, new: str) -> None:
    root = _gate().root
    text = _read(rel)
    assert old in text, "the corpus no longer carries " + repr(old) + " in " + rel
    write(root, rel, text.replace(old, new, 1))


def _append(rel: str, *lines: str) -> None:
    root = _gate().root
    write(root, rel, _read(rel) + "\n" + "\n".join(lines) + "\n")


def _as_literal(name: str) -> str:
    """A case name as the fixture module spells it, so a plant renames the declaration and not the comment quoting it."""
    return QUOTE + name + QUOTE


def _drop(rel: str, line: str) -> None:
    _replace(rel, line + "\n", "")


def _delete(rel: str) -> None:
    root = _gate().root
    (root / rel).unlink()


def _plant_rule_shapes() -> None:
    """Both arms: a rule written as a section, and a list line claiming no enforcement."""
    # The heading names no other id: every one it carries is resolved, and the corpus defines three.
    _append(STANDARD, _heading(3, "OUT-42 — A rule written as a section"), "", "**Rule:** it states its fields under a heading.")
    _replace(STANDARD, " _Enforced by_ review judgment.", "")


def _plant_section_references() -> None:
    """Each route to the page a numbered reference names, against a number none defines.

    Three on the notes page, which numbers no heading, and one on the sheet that does, resolving
    against the page it sits on.
    """
    _append(
        NOTES,
        "The sheet's [§" + ABSENT_SECTION + "](backend/spec.md) is linked whole.",
        "",
        "`docs/backend/spec.md` §" + ABSENT_SECTION + " is named by the path beside it.",
        "",
        "[The sheet](backend/spec.md) §" + ABSENT_SECTION + " is named by the link beside it.",
    )
    _append(BACKEND_SPEC, "This sheet's own §" + ABSENT_SECTION + " is named by nothing else.")


def _plant_glossary() -> None:
    """Fields that are not OUT-6's, and a heading that is not either.

    The heading arm drops the ticks and nothing else: reworded, it stops answering the notes
    page's citation, and this case reports two checks.
    """
    _replace(GLOSSARY, "**Trap:**", "**Pitfall:**")
    _replace(GLOSSARY, _heading(3, GLOSSARY_HEADING), _heading(3, GLOSSARY_ANCHOR))


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
    )
    _replace(
        FRONTEND_SPEC,
        "| I1 | A route names its own data | The route's own test |",
        "| I1 | A route names its own data |",
    )


def _plant_invariant_numbers() -> None:
    """One number reached for by both sheets on one branch, which the fork's population holds neither of."""
    raced = "| I9 | A number this branch reached for twice | Its own test |"
    backend_row = "| I1 | The write path validates its input | The sample module's own suite |"
    frontend_row = "| I1 | A route names its own data | The route's own test |"
    _replace(BACKEND_SPEC, backend_row, backend_row + "\n" + raced)
    _replace(FRONTEND_SPEC, frontend_row, frontend_row + "\n" + raced)


def _plant_overviews() -> None:
    """A page that does not close on OUT-5's heading, and one that does not open on it."""
    _replace(OVERVIEW, _heading(2, "Read next"), _heading(2, "Where next"))
    _replace(FRONTEND_OVERVIEW, _heading(2, "How it is organised"), _heading(2, "The shape of it"))


def _plant_spec_spines() -> None:
    """Sections that are not OUT-4's, and a contract numbered with a gap."""
    _replace(BACKEND_SPEC, _heading(2, "4. Known-open"), _heading(2, "4. Open questions"))
    _replace(FRONTEND_SPEC, _heading(3, "1.1 The route"), _heading(3, "1.2 The route"))


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
            *["a filler line carrying the header past the words a header may hold" for _ in range(18)],
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
    """Every structural shape the file can lose, one producer apiece.

    The tag arms are planted by the cases below this one, where each can be asserted on its own.
    """
    # A row nothing files under it.
    _replace(ROADMAP, DOCS_ROW, DOCS_ROW + "\n| " + _tick(ORPHAN_ENTRY) + " | A row with no entry below it | Docs | Open |")
    # The status the trailer replaces, in both places a status is written.
    _replace(ROADMAP, DOCS_ROW, DOCS_ROW.replace("| Open |", "| Closed |"))
    _replace(ROADMAP, "| Docs | Open | S | — |", "| Docs | Closed | S | — |")
    # A heading between two entries, which is a category kept in a second place.
    _replace(ROADMAP, _heading(3, _tick(SLICE_ENTRY)), _heading(2, "The slice work") + "\n\n" + _heading(3, _tick(SLICE_ENTRY)))
    # A batch naming an id this file holds no entry for.
    _replace(ROADMAP, SLICE_DONE, SLICE_DONE + "\n\nLands with: " + ORPHAN_ENTRY)
    # A second entry under an id already filed, and an id carrying a letter the alphabet excludes.
    # Both go above the closing heading, or the heading would sit between two entries as well.
    _replace(
        ROADMAP,
        _heading(2, ROADMAP_TAIL),
        _page(
            _heading(3, _tick(DOCS_ENTRY) + " · " + DOCS_ITEM),
            "",
            "A second entry under an id already filed, naming `docs/notes.md` so its tags still agree.",
            "",
            # A malformed id is planted as a heading and never as a row: the pairing runs over the
            # well-formed ids alone, so planting both would be one defect reported twice.
            _heading(3, _tick(MALFORMED_ENTRY) + " · An id no alphabet admits"),
            "",
            "An id carrying a letter the alphabet excludes, naming `docs/notes.md` like the one above it.",
            "",
            _heading(2, ROADMAP_TAIL),
        ).rstrip("\n"),
    )
    _plant_roadmap_agreement()


def _plant_roadmap_agreement() -> None:
    """The arms holding one listing to the other.

    A value that is itself the defect is planted in BOTH listings: changing one alone parts the two
    cells as well, and a plant answering two arms proves neither.
    """
    # One entry per arm, each planted where no other arm reads (PRE-4): a plant two arms could
    # answer would leave one of them proven by the other's finding.

    # A token below every one above it, in both listings, so each ends a run of its own.
    _replace(ROADMAP, SLICE_ROW, SLICE_ROW + "\n" + ORDER_ROW)
    _replace(
        ROADMAP,
        _heading(2, ROADMAP_TAIL),
        _page(
            _roadmap_entry(ORDER_ENTRY, ORDER_ITEM, ORDER_FIELDS, ORDER_PROSE),
            "",
            _heading(2, ROADMAP_TAIL),
        ).rstrip("\n"),
    )
    # The two cells parted, both values still inside the vocabulary, so this arm answers alone.
    _replace(ROADMAP, STATUS_FIELDS, STATUS_FIELDS.replace("| Open |", "| Standing |"))
    # A claim the heading beside it does not carry.
    _replace(ROADMAP, STATUS_ROW, STATUS_ROW.replace(STATUS_ITEM, "A claim the heading beside it does not carry"))
    # A word the derivation does not produce.
    _replace(ROADMAP, VOCAB_ROW, VOCAB_ROW.replace("| Open |", "| Parked |"))
    _replace(ROADMAP, VOCAB_FIELDS, VOCAB_FIELDS.replace("| Open |", "| Parked |"))
    # The same arm at its near miss: a value differing from one of the four in case alone, which a
    # comparison folding case would pass.
    _replace(ROADMAP, SLICE_ROW, SLICE_ROW.replace("| Open |", "| open |"))
    _replace(ROADMAP, "| BE, spiele | Open | M | — |", "| BE, spiele | open | M | — |")
    # Blocked in both listings with an em dash beside it, which names no entry at all.
    _replace(ROADMAP, BLOCKED_ROW, BLOCKED_ROW.replace("| Open |", "| Blocked |"))
    _replace(ROADMAP, BLOCKED_FIELDS, BLOCKED_FIELDS.replace("| Open |", "| Blocked |"))


def _plant_output_verbs() -> None:
    """The first column un-backticked, which is the shape `selfcheck.sh`'s awk keeps a row for.

    Alone: the lead-in arm returns before this one is reached, so a run carrying both would count
    one finding and leave the other unproven.
    """
    _replace(OPS_SPEC, OUTPUT_VERB_ROW, OUTPUT_VERB_ROW.replace("`step`", "step"))


def _reword(code: str, cell: str | None) -> None:
    """One declared row's wording cell replaced, the row found by its code rather than by position."""
    _replace(ERROR_CODES, _code_row(code, WORDED_MEANING, MAPPER_CITATION), _code_row(code, WORDED_MEANING, cell))


def _plant_error_codes() -> None:
    """Both directions, the prefix split the whole shape rests on, and every way a citation misses."""
    # The register losing a row a tree still raises, and each tree raising a code with no row.
    _drop(ERROR_CODES, BACKEND_ROW)
    _append(SAMPLE, 'OTHER = "REQ-OTHER-002"')
    _append(TSX_SAMPLE, 'const other = ["FE-OTHER-002"];')
    # A row no tree spells at all, and one only the wrong tree spells -- which a merged population
    # would pass, satisfying the row from a spelling the area's own tree never carries.
    _replace(ERROR_CODES, FRONTEND_ROW, FRONTEND_ROW + "\n| `SRV-SAMPLE-009` | A code neither tree raises | — |")
    _replace(ERROR_CODES, FRONTEND_ROW, FRONTEND_ROW + "\n| `FE-CROSS-003` | A code only the backend tree spells | — |")
    _append(SAMPLE, 'CROSSED = "FE-CROSS-003"')
    # A row losing the column, which a reader keyed on cell position would take from `Meaning`.
    _reword(WORDED_CODES[1], None)
    # Prose where a citation belongs; a citation off the surface that words a refusal at all; and
    # one naming a module that mentions the code without answering it.
    _reword(WORDED_CODES[2], "the sample mapper")
    _reword(WORDED_CODES[3], "`" + DOMAIN_REGISTER + " :: RULES`")
    _reword(WORDED_CODES[4], "`" + REMARK_SAMPLE + " :: REMARKED`")
    # The boundary: a row no rule declares, carrying a citation rather than the em dash saying
    # nothing is owed there.
    _replace(ERROR_CODES, SECOND_FRONTEND_ROW, _code_row(SECOND_FRONTEND_CODE, SECOND_FRONTEND_MEANING, MAPPER_CITATION))


def _plant_compose_entry() -> None:
    """The docs entry given a compose file as a second subject, its index row left as it stands."""
    _replace(ROADMAP, "`docs/notes.md` that plants", "`docs/notes.md` and `" + COMPOSE_FILE + "` that plant")


def _plant_hook_entry() -> None:
    """The docs entry given a hook as a second subject, its index row left as it stands.

    The file is written rather than committed: the resolver lists an untracked path too, and the
    reset takes it away again.
    """
    write(_gate().root, HOOK_SAMPLE, _page("#!/usr/bin/env bash", "exec true"))
    _replace(ROADMAP, "`docs/notes.md` that plants", "`docs/notes.md` and `" + HOOK_SAMPLE + "` that plant")


def _plant_segment_map() -> None:
    """Both producers: a tracked file no segment claims, and files two segments claim.

    Narrowing the folder row to the documents leaves every source and configuration file unclaimed,
    and the second row naming the same glob claims each document twice.
    """
    _replace(SWEEP, FOLDER_SEGMENT, "| Folders | `docs/**` |\n| Also the documents | `docs/**` |")


def _write_bytes(root: Path, rel: str, text: str) -> None:
    """A plant's exact bytes, `write` being the same call. Named so a byte plant reads as deliberate."""
    (root / rel).write_bytes(text.encode("utf-8"))


def _write_raw(rel: str, data: bytes) -> None:
    """Bytes that are not text at all: an undecodable page, or one carrying both line endings."""
    (_gate().root / rel).write_bytes(data)


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


def _plant_rule_ids() -> None:
    """An unresolvable id, an id with more than one home, and an ambiguous invariant.

    The duplicate is another list line under an id the standard already states: a citation of an
    id with more than one home cannot say which is meant (PRE-4).
    """
    _append(NOTES, "A claim citing COR-99.")
    _append(SAMPLE, HASH + " a bare I1 with no sheet named")
    # The claim is kept, or the line breaks `rule-shape` as well and one plant answers two checks.
    _append(STANDARD, "- **COR-1:** write for a reader with no context, stated again. _Enforced by_ `citation`.")


def _plant_branch_scope() -> None:
    """A clone with no base ref, as a fork and a trimmed checkout both are.

    Renamed rather than rewritten: HEAD keeps its history, so the one finding is the refusal itself.
    """
    git(_gate().root, "branch", "-m", "main", "trunk")


def _undo_branch_scope() -> None:
    """The reset restores files, never refs."""
    git(_gate().root, "branch", "-m", "trunk", "main")


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
    # A second file, or the case cannot tell a per-file finding from one naming no file at all.
    _append(NOTES, "The page was renamed after the draw, and no longer answers the old question.")
    # The third is read whole rather than for its comments, which is the population the branch
    # reader has to select by name to reach.
    _append(NOTICE_FILE, "The mark was renamed when the brand changed.")


def _plant_missing_inputs() -> None:
    """Both shapes the required listing holds: a page a check names by hand, and the notice a kind register names."""
    _delete(ROADMAP)
    _delete(NOTICE_FILE)


_KEPT_CHECKS: list[dict[str, object]] = []


def _plant_enforced_by() -> None:
    """PRE-4's enforcement claim naming a check the gate does not emit.

    Two lines rather than one: the claim is read per rule, so a reader that stopped after the first
    would still answer this case with one finding.
    """
    _replace(STANDARD, "_Enforced by_ `glossary-entry`.", "_Enforced by_ `no-such-check`.")
    _replace(STANDARD, "_Enforced by_ review judgment.", "_Enforced by_ gate check `absent-check`.")
    _plant_registry_claims()


def _plant_registry_claims() -> None:
    """Five registry rows the fields do not make back, one producer each.

    No claim; a rule whose field names another check; `GATE` where a rule names it; a contract
    naming no file; one naming no anchor in it.
    """
    kernel = _module("docs_gate.kernel")
    _KEPT_CHECKS.append(dict(kernel.CHECKS))
    kernel.CHECKS["sha"] = kernel.Check(kernel.FAIL, kernel.claimed())
    kernel.CHECKS["path"] = kernel.Check(kernel.FAIL, kernel.claimed("COR-2"))
    kernel.CHECKS["citation"] = kernel.Check(kernel.FAIL, kernel.claimed(kernel.GATE))
    kernel.CHECKS["echo"] = kernel.Check(kernel.FAIL, kernel.claimed("docs/gone.md :: I1"))
    kernel.CHECKS["anchor"] = kernel.Check(kernel.FAIL, kernel.claimed(NOTES + " :: " + ABSENT_ANCHOR))


def _undo_enforced_by() -> None:
    """The reset restores files, never a module's table."""
    kernel = _module("docs_gate.kernel")
    kernel.CHECKS.clear()
    kernel.CHECKS.update(_KEPT_CHECKS.pop())


def _plant_diagrams() -> None:
    """OUT-7's two decidable clauses on the fixture's overview: a fence nothing here renders, and a bracket inside a quoted label.

    The clean label beside it parts a reader of the quote from one reading the whole line.
    """
    _append(
        OVERVIEW,
        FENCE + "plantuml",
        "A -> B",
        FENCE,
        "",
        FENCE + "mermaid",
        "graph LR",
        '    a["a label [with a bracket]"] --> b[("a label in a cylinder")]',
        FENCE,
    )


def _plant_scheme_token() -> None:
    """One violation per arm the scheme check carries, planted together.

    A plant breaking one arm would leave the rest reading as driven. The import stays resolvable,
    or the arms resting on a token list fall silent beside it.
    """
    # Written from the pristine page and before the edits below, or the past season inherits them.
    write(_gate().root, PAST_SCHEME, _scheme_page().replace("    --border-base: #d4d4d4;\n", "", 1))
    _replace(SCHEME, '  [data-theme="dark"] {', '  [data-theme="dark"] {\n    --focus: var(--fg-base);')
    _replace(SCHEME, "    --bg-hover: #dfdfdf;", "    --bg-hover: #dfdfdf80;")
    _replace(SCHEME, "    --bg-hover-muted: #cfcfcf;", "    --bg-hover-muted: #e5e5e5;")
    _replace(SCHEME, "    --fg-on-success: #ffffff;", "    --fg-on-success: #9ad9c9;")
    _replace(SCHEME, "    --accent-brand: #8fc752;", "    --accent-brand: #011f08;")
    _replace(APP_GLOBALS, "  --color-bg-base: var(--bg-base);", "  --color-bg-base: var(--bg-invented);")


def _plant_cell_prose() -> None:
    """A spec-sheet cell carrying a paragraph, beside one that is a verbatim fragment.

    A check that measured the quoted one too would answer this case with two findings and read as
    working.
    """
    # One past the band the fixture sheets reach: a row taking any other number draws
    # `invariant-number` as well, and one plant would answer for two checks.
    _replace(
        BACKEND_SPEC,
        "| I1 | The write path validates its input | The sample module's own suite |",
        "| I1 | " + PARAGRAPH_CELL + " | The sample module's own suite |\n| I3 | `" + PARAGRAPH_CELL + "` | The same suite |",
    )


def _plant_echo() -> None:
    """One passage stated on a second page.

    A page and never a source file: COR-2's several-sites clause keeps a comment's claim at every
    line it constrains, so this check reads no comment run at all.
    """
    _append(NOTES, "", ECHOED_PASSAGE)
    _append(TWIN_NOTES, "", ECHOED_PASSAGE)


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
    _replace(STANDARD, "\\\n**Applies to:**", "\\n**Applies to:**")
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
    # Present as text and defined nowhere: the shape a substring test reads as alive, which is how a
    # citation of a deleted symbol survives inside a longer name.
    _append(NOTES, "`fl_backend/app/sample.py :: VALU` names a prefix of a symbol rather than one.")
    _append(ROADMAP, "`fl_backend/app/sample.py :: VALUE` continues onto `:: MISSING`.")


def _plant_anchors() -> None:
    """A fragment this page does not yield, and one another page does not."""
    _append(NOTES, "[here](#nowhere)")
    _append(ROADMAP, "[there](../notes.md#nowhere-either)")


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
    """Both retired words: a club in both forms the sweep reads, and an adverb opening a sentence.

    `bereits` is no noun, so the capital a sentence's start gives it is a spelling the pattern
    reads only by folding case there.
    """
    _append(COPY_SAMPLE, 'export const WER = "Die Mannschaft steht in dieser Gruppe.";')
    _append(COPY_SAMPLE, 'export const ALLE = "Alle Mannschaften stehen in der Tabelle.";')
    _append(COPY_SAMPLE, 'export const OFFEN = "Bereits eingetragene Spiele behalten diesen Ort.";')


def _plant_copy_corpus() -> None:
    """A corpus with no German left in it, and so no date range to exempt either.

    Both producers at once: the scan going quiet and an exemption outliving what it exempted are
    the same failure seen from two ends.
    """
    write(_gate().root, COPY_SAMPLE, _page('export const SAMPLE = "a rendered string, and no reader in sight";'))


def _plant_comment_bounds() -> None:
    """INC-9's one bound against every comment shape, one file apiece.

    The docstring and the doc block prove the shapes a narrower comment reader once dropped are
    measured: a bound enforced over inline runs alone would leave every symbol doc unmeasured.
    """
    _append(SAMPLE, *[HASH + " a line of a block that runs past what a comment may hold" for _ in range(6)])
    # One line, so nothing but this block's own text can be what fires.
    _append(SECOND_SAMPLE, HASH + " " + ("a clause that carries the block past the word bound " * 5))
    _append(THIRD_SAMPLE, QUOTES + "a docstring summary line", "", *["a line of its prose carrying the block past the bound"] * 5, QUOTES)
    _append(TSX_SAMPLE, "/** a symbol doc " + ("whose clauses carry it past the word bound " * 6) + "*/")


def _plant_comment_citations() -> None:
    """Every shape INC-6 governs: those that fail, and those it only reports.

    The ledger row goes beside the sample, because a swap with the audit id would move neither the
    file nor the count.
    """
    _append(
        SAMPLE,
        HASH + " an audit id § S2 belongs to no clone",
        HASH + " and the last session is not a citation",
        # The pattern's other half, so a reader that lost one spelling of a review reference is caught.
        HASH + " nor is the first review, which no clone holds",
        HASH + " nor is " + DOCS_ENTRY + " on its own",
    )
    _append(SECOND_SAMPLE, HASH + " the ledger 3 entry is not a citation either")


def _plant_text_write() -> None:
    """A text handle opened with no `newline`, built for `HASH`'s reason: the clause reads a CALL."""
    _append(SAMPLE, "Path(" + QUOTE + "x" + QUOTE + ")." + "write_text(" + QUOTE + "a" + QUOTE + ")")


def _plant_platform_branch() -> None:
    """A shell platform token in code.

    Under `.claude/hooks/`: the fixture's own `scripts/` copy is gitignored, so a plant there is read
    nowhere.
    """
    write(_gate().root, HOOK_SAMPLE, _page("#!/usr/bin/env bash", "uname -s"))


def _plant_wrapped_paths() -> None:
    """One wrapped span per arm: a live path, one behind a comment marker, and a dead one.

    A page alone leaves the marker arm driven by nothing, and no other check sees a join a wrap
    parts.
    """
    _append(NOTES, "A path wrapped inside itself: `docs/gloss", "ary.md` renders with a space.")
    _append(SAMPLE, HASH + " a path wrapped inside itself: `docs/gloss", HASH + " ary.md` renders with a space")
    _append(TWIN_NOTES, "A dead path wrapped inside itself: `docs/gone-in-a-wr", "ap.md` names nothing.")


def _fails(check: str, *files: str) -> tuple[Reported, ...]:
    """One failing finding per file named -- a file twice is a check that must speak twice about it."""
    return tuple(("fail", check, rel) for rel in files)


@dataclass(frozen=True)
class Case:
    """One check, the violation planted for it, and every finding that plant is allowed to raise.

    `expected` is counted, not a set: silencing one producer is a shortfall rather than a set that
    still compares equal.
    """

    check: str
    expected: tuple[Reported, ...]
    plant: Callable[[], None]
    # Run after the case whatever it did. `_reset` restores files alone, so what it cannot reach --
    # a ref a plant moved, a module table a plant rewrote -- is the corpus every case below sees.
    undo: Callable[[], None] | None = None


CASES: Final[tuple[Case, ...]] = (
    Case("anchor", _fails("anchor", NOTES, ROADMAP), _plant_anchors),
    Case(
        "bare-path",
        _fails("bare-path", SAMPLE, UMLAUT_MODULE, TOML_CONFIG, YAML_CONFIG, JSON_CONFIG, CONF_FILE, SHELL_FILE, DOCKERFILE),
        _plant_bare_paths,
    ),
    Case("binary-byte", _fails("binary-byte", NOTES, UMLAUT_MODULE), _plant_binary_bytes),
    Case("cell-prose", _fails("cell-prose", BACKEND_SPEC), _plant_cell_prose),
    Case("branch-scope", _fails("branch-scope", BRANCH_DIFF), _plant_branch_scope, _undo_branch_scope),
    Case("citation", _fails("citation", NOTES, NOTES, ROADMAP, ROADMAP, ROADMAP, TEMPLATES, SWEEP, TWIN_NOTES), _plant_citations),
    Case("comment-citation", _fails("comment-citation", *[SAMPLE] * 4, SECOND_SAMPLE), _plant_comment_citations),
    Case("comment-length", _fails("comment-length", SAMPLE, SECOND_SAMPLE, THIRD_SAMPLE, TSX_SAMPLE), _plant_comment_bounds),
    Case("copy-corpus", _fails("copy-corpus", COPY_ROOT, COPY_ROOT), _plant_copy_corpus),
    Case("copy-dash", _fails("copy-dash", *[COPY_SAMPLE] * 3), _plant_copy_dash),
    Case("copy-formal", _fails("copy-formal", COPY_SAMPLE), _plant_copy_formal),
    Case("copy-informal", _fails("copy-informal", COPY_SAMPLE), _plant_copy_informal),
    Case("copy-term", _fails("copy-term", COPY_SAMPLE, COPY_SAMPLE, COPY_SAMPLE), _plant_copy_term),
    Case("crlf-write", _fails("crlf-write", SAMPLE), _plant_text_write),
    Case("diagram", _fails("diagram", OVERVIEW, OVERVIEW), _plant_diagrams),
    # The corpus is walked in path order, so the twin under `docs/frontend/` is the home the two
    # copies below it are told to cite.
    Case("echo", _fails("echo", NOTES), _plant_echo),
    # Six on the registry: the five planted rows, and `glossary-entry`, whose one claiming field
    # the page-side plant names an absent check in.
    Case("enforced-by", _fails("enforced-by", STANDARD, STANDARD, *[KERNEL] * 6), _plant_enforced_by, _undo_enforced_by),
    Case("error-codes", _fails("error-codes", *[ERROR_CODES] * 10), _plant_error_codes),
    Case("glossary-entry", _fails("glossary-entry", GLOSSARY, GLOSSARY), _plant_glossary),
    Case("header-see", _fails("header-see", *[SAMPLE] * 4), _plant_header_see),
    Case("history", _fails("history", NOTES, NOTICE_FILE, SECOND_SAMPLE), _plant_history),
    Case("inputs", _fails("inputs", NOTICE_FILE, ROADMAP), _plant_missing_inputs),
    Case(
        "invariant-id",
        _fails("invariant-id", BACKEND_SPEC),
        lambda: _append(BACKEND_SPEC, "The read path also rests on I7."),
    ),
    Case("invariant-number", _fails("invariant-number", BACKEND_SPEC, FRONTEND_SPEC), _plant_invariant_numbers),
    Case("invariant-row", _fails("invariant-row", BACKEND_SPEC, BACKEND_SPEC, FRONTEND_SPEC), _plant_invariant_rows),
    Case("line-citation", _fails("line-citation", NOTES, SAMPLE), _plant_line_citations),
    Case("line-endings", _fails("line-endings", NOTES, UMLAUT_MODULE), _plant_crlf),
    Case("link", _fails("link", NOTES), lambda: _append(NOTES, "[gone](gone.md)")),
    Case("metadata-break", _fails("metadata-break", NOTES, TWIN_NOTES, STANDARD), _plant_metadata_breaks),
    Case("module-header", _fails("module-header", *[SAMPLE] * 3, *[SECOND_SAMPLE] * 2, THIRD_SAMPLE, LABEL_SAMPLE), _plant_module_headers),
    Case("output-verbs", _fails("output-verbs", OPS_SPEC), _plant_output_verbs),
    Case("overview-spine", _fails("overview-spine", OVERVIEW, FRONTEND_OVERVIEW), _plant_overviews),
    Case("owner-voice", _fails("owner-voice", NOTES), lambda: _append(NOTES, "The owner reads it.")),
    Case("path", _fails("path", NOTES), lambda: _append(NOTES, "`docs/gone.md` is named here.")),
    Case("platform-branch", _fails("platform-branch", HOOK_SAMPLE), _plant_platform_branch),
    # Prose lines, not table rows: OUT-3 counts the words a table does not hold, so a plant made of
    # rows would leave the bound unreached however long the page grew.
    Case("readme-cap", _fails("readme-cap", ROOT_README), lambda: _append(ROOT_README, *["A line of README prose." for _ in range(160)])),
    Case("roadmap-shape", _fails("roadmap-shape", *[ROADMAP] * 16), _plant_roadmap),
    # The standard names its own duplicated id, which is what reports the collision: every citer of
    # a multiply homed id fails, and the definition lines are themselves citations.
    Case("rule-id", _fails("rule-id", NOTES, SAMPLE, STANDARD), _plant_rule_ids),
    Case("rule-shape", _fails("rule-shape", STANDARD, STANDARD), _plant_rule_shapes),
    # The dark brand darkened for the ordering arm fails eight floored pairs on the way, and a plant
    # dodging that would be one no scheme file could ever carry.
    Case("scheme-token", _fails("scheme-token", *[SCHEME] * 13, PAST_SCHEME, APP_GLOBALS), _plant_scheme_token),
    Case(
        "section-reference",
        _fails("section-reference", NOTES, NOTES, NOTES, BACKEND_SPEC),
        _plant_section_references,
    ),
    Case("segment-map", _fails("segment-map", SWEEP, SWEEP), _plant_segment_map),
    Case("sha", _fails("sha", NOTES), lambda: _append(NOTES, "The commit `abc1234` is gone.")),
    Case("spec-spine", _fails("spec-spine", BACKEND_SPEC, FRONTEND_SPEC), _plant_spec_spines),
    Case(
        "template-fragment",
        _fails("template-fragment", TEMPLATES),
        lambda: _drop(TEMPLATES, "- " + _gate().body_gate.TEMPLATE_FRAGMENTS[0]),
    ),
    Case("unreadable", _fails("unreadable", NOTES), _plant_unreadable),
    # Wrapped inside the path, which is the only place a wrap breaks a span: one parted at its
    # separator still names its file whole, and the corpus above carries that shape.
    Case("wrapped-path", _fails("wrapped-path", SAMPLE, NOTES, TWIN_NOTES), _plant_wrapped_paths),
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
    checks = _gate().gate.CHECKS
    assert {case.check for case in CASES} == set(checks)
    assert len({case.check for case in CASES}) == len(CASES)
    registered = {(severity, name) for name, check in checks.items() for severity in check.severities}
    planted = {(severity, check) for case in CASES for severity, check, _ in case.expected}
    assert planted == registered, "unplanted: " + repr(sorted(registered - planted))


def test_a_season_nothing_imports_leaves_the_token_list_unanchored() -> None:
    """The import arm cannot share the scheme case's plant: with no season there is no token list.

    Driven directly for that reason, and the count is what parts the one finding from the parity
    arms falling silent beside it.
    """
    _reset()
    _replace(APP_GLOBALS, '@import "./schemes/2025-26.css";', '@import "./schemes/1999-00.css";')
    try:
        code, reported = _run()
    finally:
        _reset()
    assert reported == Counter({("fail", "scheme-token", APP_GLOBALS): 1}), "an unimported season: " + _shape(reported)
    assert code == 1
    _assert_corpus_restored()


def test_a_check_naming_one_page_reads_the_tracked_one() -> None:
    """A check that names a fixed page resolves it through the corpus, not off disk.

    Driven directly: this input silences the glossary's other producers by returning first, and a
    `Case` declares every finding.
    """
    _reset()
    git(_gate().root, "rm", "--cached", "-q", "--", GLOSSARY)
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "glossary-entry", GLOSSARY)] == 1, "an untracked glossary was read as the corpus': " + _shape(reported)
    _assert_corpus_restored()


def test_a_rule_family_the_patterns_never_spelled_is_read_off_the_standard() -> None:
    """Read off the list lines, a rule under a new prefix is held to PRE-4 and its citations resolve.

    Two citations, one finding: the planted rule resolves, and the neighbour nobody wrote fails
    rather than falling outside every pattern.
    """
    _reset()
    _append(STANDARD, "- **DOC-7:** a rule under a family the patterns never spelled. _Enforced by_ review judgment.")
    _append(NOTES, "A claim citing DOC-7, and one citing DOC-8.")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "rule-id", NOTES)] == 1, "a family the standard states was read by no pattern: " + _shape(reported)
    _assert_corpus_restored()


def test_the_standard_leaving_the_index_empties_its_readers_rather_than_raising() -> None:
    """A page out of the index reaches its readers as None, and one that hands it on raises.

    `enforced-by` and `rule-shape` each guard for it. Without either guard the run ends on a
    traceback at `EXIT_CRASH`, rather than on every citation of a rule failing.
    """
    _reset()
    git(_gate().root, "rm", "--cached", "-q", "--", STANDARD)
    try:
        code, reported = _run()
    finally:
        _reset()
    # Counted by name rather than by number: what is pinned is which checks spoke, the citation
    # count being the corpus' own and free to move.
    assert set(reported) == {("fail", "rule-id", STANDARD)}, _shape(reported)
    assert code == 1
    _assert_corpus_restored()


def test_an_untracked_roadmap_is_read_as_a_page_nobody_added() -> None:
    """The roadmap on disk and outside the index fails, rather than passing unexamined.

    Driven directly: a page out of the index yields no shape finding to share a case with, and
    satisfies `inputs`, which asks the disk.
    """
    _reset()
    git(_gate().root, "rm", "--cached", "-q", "--", ROADMAP)
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 1, "an untracked roadmap passed: " + _shape(reported)
    _assert_corpus_restored()


def test_a_status_table_that_yields_no_vocabulary_is_reported_rather_than_passed_over() -> None:
    """An empty vocabulary silences the arm reading it, so the silence is a finding of its own.

    Driven alone: the case sharing this check name puts two statuses outside the vocabulary, so it
    would prove this arm switched off.
    """
    _reset()
    _replace(PROTOCOL, STATUS_COLUMN_ROW, STATUS_COLUMN_ROW.replace("Status", "Verdict"))
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "roadmap-shape", PROTOCOL)] == 1, "a moved status table passed: " + _shape(reported)
    _assert_corpus_restored()


def test_an_untracked_protocol_page_is_reported_rather_than_emptying_the_vocabulary() -> None:
    """The page on disk and outside the index yields no vocabulary, which switched the status arm off in silence.

    `inputs` asks the disk, so only the reader itself can say the index does not hold the page.
    """
    _reset()
    git(_gate().root, "rm", "--cached", "-q", "--", PROTOCOL)
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "roadmap-shape", PROTOCOL)] == 1, "an untracked protocol page passed: " + _shape(reported)
    _assert_corpus_restored()


def test_a_protocol_page_that_cannot_be_decoded_is_reported_rather_than_emptying_the_vocabulary() -> None:
    """A page the reader refuses yields no table, the shape of a page deriving nothing.

    Read from the words: the empty-table arm reports about this file under this name too, so a
    count cannot say which spoke.
    """
    _reset()
    _write_raw(PROTOCOL, UNDECODABLE_BYTES)
    try:
        _, output = _output()
    finally:
        _reset()
    assert "unreadable, so the status vocabulary was derived from nothing" in output, output
    _assert_corpus_restored()


def test_a_status_table_outside_section_four_widens_no_vocabulary() -> None:
    """A second `Status`-headed table on the page is not the derivation, and a reader re-arming on any header would take it.

    Its word is planted as a status in both listings, so a reader taking it reports nothing.
    """
    _reset()
    _append(
        PROTOCOL,
        "",
        _heading(2, "5. A table that derives nothing"),
        "",
        STATUS_COLUMN_ROW,
        "| --- | --- | --- |",
        "| 1 | A row a reader scoped to section four never reads | **Parked** |",
    )
    _replace(ROADMAP, VOCAB_ROW, VOCAB_ROW.replace("| Open |", "| Parked |"))
    _replace(ROADMAP, VOCAB_FIELDS, VOCAB_FIELDS.replace("| Open |", "| Parked |"))
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 2, "a table outside section four widened the vocabulary: " + _shape(reported)
    _assert_corpus_restored()


def test_a_rule_added_to_the_status_table_widens_the_vocabulary() -> None:
    """A vocabulary retyped in the checker would pass both refusal cases and fail this one alone.

    The word is the one those cases put outside the set, so the three differ in the planted row
    alone.
    """
    _reset()
    _replace(PROTOCOL, OTHERWISE_RULE, ADDED_STATUS_RULE + "\n" + OTHERWISE_RULE.replace("| 4 |", "| 5 |"))
    _replace(ROADMAP, VOCAB_ROW, VOCAB_ROW.replace("| Open |", "| Parked |"))
    _replace(ROADMAP, VOCAB_FIELDS, VOCAB_FIELDS.replace("| Open |", "| Parked |"))
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 0, "a status the table derives was refused: " + _shape(reported)
    _assert_corpus_restored()


def test_a_blocked_entry_naming_two_dependencies_is_held_to_either_of_them() -> None:
    """A `Depends on` cell naming two entries is read token by token, one of them filed being enough.

    Read as one token it names no entry, and a true claim about another entry draws a finding.
    """
    _reset()
    both = "| Docs | Blocked | XS | " + _tick(ORPHAN_ENTRY) + ", " + _tick(DOCS_ENTRY) + " |"
    _replace(ROADMAP, BLOCKED_ROW, BLOCKED_ROW.replace("| Open |", "| Blocked |"))
    _replace(ROADMAP, BLOCKED_FIELDS, both)
    try:
        _, reported = _run()
        _replace(ROADMAP, both, both.replace(_tick(DOCS_ENTRY), _tick(MALFORMED_ENTRY)))
        _, unfiled = _run()
    finally:
        _reset()
    assert reported[("fail", "roadmap-shape", ROADMAP)] == 0, "a dependency filed beside an unfiled one was refused: " + _shape(reported)
    assert unfiled[("fail", "roadmap-shape", ROADMAP)] == 1, "two unfiled dependencies passed: " + _shape(unfiled)
    _assert_corpus_restored()


def test_a_reworded_lead_in_leaves_the_verb_reader_with_nothing_to_arm_on() -> None:
    """Driven alone rather than from this check's own case.

    This arm returns before that case's plant is reached, so a shared run would count one finding
    for two plants and leave whichever spoke second unproven.
    """
    for lead_in, reworded in ((OUTPUT_LEAD_IN, "The verbs."), (HELPER_LEAD_IN, "The helpers.")):
        _reset()
        _replace(OPS_SPEC, lead_in, lead_in.replace(lead_in.split("**")[1], reworded))
        try:
            _, reported = _run()
        finally:
            _reset()
        assert reported[("fail", "output-verbs", OPS_SPEC)] == 1, "a moved lead-in passed: " + _shape(reported)
    _assert_corpus_restored()


def test_a_third_lead_in_constant_is_one_this_check_resolves() -> None:
    """A lead-in spelled in a constant the check walks past is a table nothing keeps a verdict on.

    Set on the module rather than in the corpus: the pairing under test is between the constants and
    the loop beside them.
    """
    names = vars(_module("docs_gate.checks"))
    _reset()
    names["THIRD_LEAD_IN"] = r"^\*\*A third table\."
    try:
        _, reported = _run()
    finally:
        del names["THIRD_LEAD_IN"]
        _reset()
    assert reported[("fail", "output-verbs", OPS_SPEC)] == 1, "a lead-in no arm resolved passed: " + _shape(reported)
    _assert_corpus_restored()


def test_a_row_under_an_area_no_pattern_spelled_is_held_to_the_trees() -> None:
    """A code's shape is what selects it, so a fifth area's row is owed a spelling like the four's.

    A closed alternation drops the row from both populations at once, and the check stays green.
    """
    _reset()
    _replace(ERROR_CODES, FRONTEND_ROW, FRONTEND_ROW + "\n| `OPS-SAMPLE-001` | A row under an area no pattern spelled |")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "error-codes", ERROR_CODES)] == 1, "a row under a fifth area was read by nothing: " + _shape(reported)
    _assert_corpus_restored()


def test_an_untracked_register_page_is_the_check_s_own_finding() -> None:
    """The page on disk and outside the index satisfies `inputs` and yields no row, so the comparison ran over nothing."""
    _reset()
    git(_gate().root, "rm", "--cached", "-q", "--", ERROR_CODES)
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "error-codes", ERROR_CODES)] == 1, "an untracked register passed: " + _shape(reported)
    _assert_corpus_restored()


def test_a_register_page_that_cannot_be_decoded_is_the_check_s_own_finding() -> None:
    """A page the reader refuses yields no row, so the register is compared against nothing.

    Read from the words: with this finding gone the run names the codes each tree raises and never
    the page it could not read.
    """
    _reset()
    _write_raw(ERROR_CODES, UNDECODABLE_BYTES)
    try:
        _, output = _output()
    finally:
        _reset()
    assert "unreadable, so the register was held to nothing" in output, output
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


def _module_named(what: str) -> str:
    """A module whose one comment carries a dead path, so reaching the file is what a finding says."""
    return _page(QUOTES + "BACKEND · " + what + QUOTES, "", "VALUE = 1", "", HASH + " resolves nowhere: " + DEAD_PATH)


def test_a_file_the_branch_has_not_staged_is_read_like_a_tracked_one() -> None:
    """The corpus is the working tree, so a file written and not yet added is inside every check.

    The gate runs before the commit (CLAUDE.md §2), so the index alone would leave every module,
    route and test a branch adds unread while the run reported clean.
    """
    _reset()
    write(_gate().root, UNSTAGED_MODULE, _module_named("a module this branch wrote and never staged."))
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "bare-path", UNSTAGED_MODULE)] == 1, "an unstaged module was scanned by nothing: " + _shape(reported)
    _assert_corpus_restored()


def test_an_ignored_or_skipped_file_stays_outside_the_corpus() -> None:
    """Widening the corpus to the working tree stops at what git ignores and at SKIP_DIRS.

    Both carry the case above's plant, so only placement can be what silences them.
    """
    _reset()
    root = _gate().root
    for rel in (IGNORED_MODULE, SKIPPED_MODULE):
        write(root, rel, _module_named("a module no check may reach."))
    try:
        _, reported = _run()
    finally:
        for rel in (IGNORED_MODULE, SKIPPED_MODULE):
            (root / rel).unlink()
        _reset()
    parked = {rel: count for (_, _, rel), count in reported.items() if rel in (IGNORED_MODULE, SKIPPED_MODULE)}
    assert not parked, "a file the corpus must not reach was scanned anyway: " + repr(parked)
    _assert_corpus_restored()


def test_an_unstaged_file_s_lines_are_read_as_lines_this_branch_added() -> None:
    """INC-9 and the added-line checks read a whole unstaged file, git holding no diff for one.

    git has no version of a file the index never reached, so the block below sits in no hunk.
    """
    _reset()
    over = [HASH + " a line of a block that runs past what a comment may hold" for _ in range(6)]
    write(_gate().root, UNSTAGED_BLOCK, _page(QUOTES + "BACKEND · an unstaged module." + QUOTES, "", "VALUE = 1", "", *over))
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "comment-length", UNSTAGED_BLOCK)] == 1, "an unstaged block was measured by nothing: " + _shape(reported)
    _assert_corpus_restored()


def test_a_bare_name_reaches_an_unstaged_file_and_the_index_still_answers_first() -> None:
    """A bare-name citation resolves through the index, and through the tree only where it cannot.

    Two citations separate a file not reached from an anchor not there, and the twin proves the
    order: reading the tree first lands on the copy.
    """
    _reset()
    root = _gate().root
    twin = (root / UNTRACKED_TWIN).read_bytes()
    write(root, UNTRACKED_TWIN, _read(GLOSSARY).replace(GLOSSARY_HEADING, "a heading the corpus does not cite"))
    write(root, UNSTAGED_MODULE, _module_named("a module cited by name before it was staged."))
    _append(SAMPLE, HASH + " see `unstaged.py :: VALUE = 1`", HASH + " and `unstaged.py :: a symbol nobody wrote`")
    try:
        _, reported = _run()
    finally:
        (root / UNTRACKED_TWIN).write_bytes(twin)
        _reset()
    assert reported[("fail", "citation", SAMPLE)] == 1, "a bare name did not reach the unstaged file it names: " + _shape(reported)
    assert reported[("fail", "citation", NOTES)] == 0, "an untracked copy answered a bare name the index holds: " + _shape(reported)
    _assert_corpus_restored()


def test_a_citation_a_file_makes_about_itself_is_proved_by_some_other_line_or_by_nothing() -> None:
    """The citing line spells the anchor, so presence in the whole text certifies the citation against itself.

    The second run is the evidence the arm reads the OTHER lines: the same shape with the anchor
    spelled above stays silent.
    """
    _reset()
    spelled = "an anchor the line above the citation spells"
    try:
        _append(SAMPLE, HASH + " see `" + SAMPLE + " :: an anchor no other line spells`")
        _, alone = _run()
        _reset()
        _append(SAMPLE, HASH + " " + spelled, HASH + " see `" + SAMPLE + " :: " + spelled + "`")
        _, elsewhere = _run()
    finally:
        _reset()
    assert alone[("fail", "citation", SAMPLE)] == 1, "an anchor spelled only on its own citing line passed: " + _shape(alone)
    assert elsewhere[("fail", "citation", SAMPLE)] == 0, "an anchor the file spells elsewhere was failed: " + _shape(elsewhere)
    _assert_corpus_restored()


def test_a_continuation_a_file_makes_about_itself_is_read_as_a_self_citation() -> None:
    """A continuation is joined from an antecedent, so its joined form sits on no line of the file.

    The second run is the evidence the arm reads the OTHER lines, as the whole citation's case is.
    """
    _reset()
    spelled = "a continued anchor the line above spells"
    try:
        _append(SAMPLE, HASH + " see `" + SAMPLE + "` and `:: a continued anchor no other line spells`")
        _, alone = _run()
        _reset()
        _append(SAMPLE, HASH + " " + spelled, HASH + " see `" + SAMPLE + "` and `:: " + spelled + "`")
        _, elsewhere = _run()
    finally:
        _reset()
    assert alone[("fail", "citation", SAMPLE)] == 1, "a continuation resolving only against its own line passed: " + _shape(alone)
    assert elsewhere[("fail", "citation", SAMPLE)] == 0, "a continued anchor the file spells elsewhere was failed: " + _shape(elsewhere)
    _assert_corpus_restored()


def test_a_self_citation_a_wrap_parts_is_read_as_one_citation_over_both_its_lines() -> None:
    """Wrapped at the separator, so the joined citation sits on neither line whole.

    The anchor is on the SECOND line, which the citing line has to reach or the arm reports the
    same pass a whole-line citation would fail.
    """
    _reset()
    spelled = "a wrapped anchor the line above spells"
    try:
        _append(SAMPLE, HASH + " see `" + SAMPLE + " ::", HASH + " a wrapped anchor no other line spells`")
        _, alone = _run()
        _reset()
        _append(SAMPLE, HASH + " " + spelled, HASH + " see `" + SAMPLE + " ::", HASH + " " + spelled + "`")
        _, elsewhere = _run()
    finally:
        _reset()
    assert alone[("fail", "citation", SAMPLE)] == 1, "a wrapped self-citation proved by its own tail passed: " + _shape(alone)
    assert elsewhere[("fail", "citation", SAMPLE)] == 0, "a wrapped anchor the file spells elsewhere was failed: " + _shape(elsewhere)
    _assert_corpus_restored()


def test_a_self_citation_is_proved_by_the_file_s_own_text_and_never_by_a_second_citation() -> None:
    """Modules here name their symbols alike, so one file's citation of an anchor would certify another's.

    The second run is the evidence the arm still reads the other lines: a comment spelling the
    anchor keeps it silent.
    """
    _reset()
    spelled = "an anchor a comment of this module spells"
    try:
        _append(
            SAMPLE,
            HASH + " The entry `" + GLOSSARY + " :: " + GLOSSARY_ANCHOR + "` is written beside this module.",
            HASH + " A second `" + SAMPLE + " :: " + GLOSSARY_ANCHOR + "` has that citation for its only proof.",
        )
        _, cited = _run()
        _reset()
        _append(SAMPLE, HASH + " " + spelled, HASH + " See `" + SAMPLE + " :: " + spelled + "`.")
        _, seen = _run()
    finally:
        _reset()
    assert cited[("fail", "citation", SAMPLE)] == 1, "an anchor only another citation spells passed: " + _shape(cited)
    assert seen[("fail", "citation", SAMPLE)] == 0, "an anchor the module's own comment spells was failed: " + _shape(seen)
    _assert_corpus_restored()


def test_the_tail_line_of_a_wrapped_citation_proves_no_self_citation_of_its_anchor() -> None:
    """A wrap parts the other file's citation, so its tail carries the anchor and no whole span.

    The second run is the evidence the arm reads other lines: the same pair with the anchor
    spelled outside both citations passes.
    """
    _reset()
    wrapped = (HASH + " The entry `" + GLOSSARY + " ::", HASH + " " + GLOSSARY_ANCHOR + "` is written beside this module.")
    second = HASH + " A second `" + SAMPLE + " :: " + GLOSSARY_ANCHOR + "` has that tail line for its only proof."
    try:
        _append(SAMPLE, *wrapped, "", second)
        _, tailed = _run()
        _reset()
        _append(SAMPLE, *wrapped, "", HASH + " The module itself spells " + GLOSSARY_ANCHOR + ".", "", second)
        _, spelled = _run()
    finally:
        _reset()
    assert tailed[("fail", "citation", SAMPLE)] == 1, "an anchor only a wrapped citation's tail spells passed: " + _shape(tailed)
    assert spelled[("fail", "citation", SAMPLE)] == 0, "an anchor the module's own sentence spells was failed: " + _shape(spelled)
    _assert_corpus_restored()


def test_a_cited_case_name_two_suites_of_one_module_declare_is_reported() -> None:
    """Two describe blocks naming one case is what the runner permits and a citation cannot part.

    The second run renames onto a name no document cites: what fires is the citation, never the
    repetition.
    """
    _reset()
    try:
        _replace(CASE_MODULE, _as_literal(SECOND_CASE), _as_literal(CITED_CASE))
        _, cited = _run()
        _reset()
        _replace(CASE_MODULE, _as_literal(SECOND_CASE), _as_literal(UNCITED_CASE))
        _, uncited = _run()
    finally:
        _reset()
    assert cited[("fail", "citation", NOTES)] == 1, "a cited case name two suites declare passed: " + _shape(cited)
    assert not uncited, "a repeated case name no document cites was reported: " + _shape(uncited)
    _assert_corpus_restored()


def test_a_cited_case_name_two_classes_of_one_python_module_declare_is_reported() -> None:
    """Python holds one method name on two classes without minding, and the definition listing loses the count.

    The second run collides onto an uncited name, as the frontend tier's case does.
    """
    _reset()
    try:
        _replace(BACKEND_TEST, "def " + SECOND_PYTHON_CASE, "def " + CITED_PYTHON_CASE)
        _, cited = _run()
        _reset()
        _replace(BACKEND_TEST, "def " + SECOND_PYTHON_CASE, "def " + UNCITED_PYTHON_CASE)
        _, uncited = _run()
    finally:
        _reset()
    assert cited[("fail", "citation", NOTES)] == 1, "a cited case name two classes declare passed: " + _shape(cited)
    assert not uncited, "a repeated python case name no document cites was reported: " + _shape(uncited)
    _assert_corpus_restored()


def test_a_citation_of_a_case_name_the_source_escapes_is_refused_before_any_count() -> None:
    """The count reads the literal's own body, so an escaped name and its anchor are different strings.

    Free while presence refuses the citation first; the day presence resolves an escape, the count
    must resolve it in that change.
    """
    _reset()
    try:
        # Twice, so the count is what the arm would report on if the two spellings ever met.
        _replace(CASE_MODULE, _as_literal(UNCITED_CASE), ESCAPED_SOURCE)
        _replace(CASE_MODULE, _as_literal(SECOND_CASE), ESCAPED_SOURCE)
        _append(NOTES, "A citation of " + _tick(CASE_MODULE + " :: " + ESCAPED_CASE) + ".")
        code, output = _output()
    finally:
        _reset()
    assert code == 1, output
    assert "no longer appears" in output, output
    assert "test cases in" not in output, output
    _assert_corpus_restored()


def test_an_entry_naming_a_compose_file_earns_the_ops_and_edge_tags() -> None:
    """Driven through the whole gate rather than through the derivation alone.

    The derivation reads what the resolver placed, so a case handing it paths of its own would pass
    with the resolver unchanged.
    """
    _reset()
    _plant_compose_entry()
    try:
        code, output = _main()
    finally:
        _reset()
    assert code == 1, output
    assert "entry " + DOCS_ENTRY + " names Ops, edge work" in output, output
    _assert_corpus_restored()


def test_an_entry_naming_a_hook_earns_the_ops_and_gate_tags_beside_its_docs_one() -> None:
    """A hook sits under the prefix `Docs` claims, so derived as documentation alone it is invisible to a `gate` filter.

    Driven through the whole gate for the compose case's reason.
    """
    _reset()
    _plant_hook_entry()
    try:
        code, output = _main()
    finally:
        _reset()
    assert code == 1, output
    assert "entry " + DOCS_ENTRY + " names Ops, gate work" in output, output
    _assert_corpus_restored()


def test_the_resolver_places_a_tracked_file_at_the_repository_root() -> None:
    """Asked of the resolver as well as of the case above.

    That case stays green with this arm narrowed to the two compose filenames the derivation reads,
    leaving every other root-level path resolving to nothing.
    """
    _reset()
    kernel = _module("docs_gate.kernel")
    _clear_caches(_gate().root / SCRIPTS_COPY)
    assert kernel.repo_path(COMPOSE_FILE) == COMPOSE_FILE
    assert kernel.repo_path(GITATTRIBUTES) == GITATTRIBUTES
    # A KIND of file, and a directory: neither is one path, and the root arm answers for neither.
    assert kernel.repo_path("queries.ts") is None
    assert kernel.repo_path("docs") is None


def test_a_root_level_directory_the_tree_holds_is_a_prefix_the_resolver_reaches() -> None:
    """The live path is planted beside the dead one because silence is what a typed tuple produces.

    Without it the case passes on a resolver that reports everything under the new prefix.
    """
    _reset()
    root = _gate().root
    write(root, ROOT_FOLDER_FILE, _page("{", QUOTE + "note" + QUOTE + ": " + QUOTE + "a file holding a root-level folder open" + QUOTE, "}"))
    _append(NOTES, "A live " + _tick(ROOT_FOLDER_FILE) + ", and a dead " + _tick(DEAD_ROOT_FOLDER_PATH) + ".")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported == Counter({("fail", "path", NOTES): 1}), "a root-level folder outside the typed tuple: " + _shape(reported)
    _assert_corpus_restored()


def test_one_file_s_four_spellings_each_draw_their_own_verdict() -> None:
    """The three spellings the resolver admits, and the fourth, from inside the package's source root, which it refuses on purpose."""
    _reset()
    checks = _module("docs_gate.checks")
    _clear_caches(_gate().root / SCRIPTS_COPY)
    inside = SPIELER_PANEL.partition("src/")[2]
    for spelling in (SPIELER_PANEL, SPIELER_PANEL.partition("/")[2], SPIELER_PANEL.rsplit("/", 1)[1]):
        found = checks._check_citation(spelling + " :: Panel", NOTES, {})
        assert not found, spelling + " did not resolve: " + repr([finding.human() for finding in found])
    refused = [finding.detail for finding in checks._check_citation(inside + " :: Panel", NOTES, {})]
    assert refused == ["cited path is neither repository-relative nor package-relative: " + inside], repr(refused)
    _assert_corpus_restored()


def test_a_citation_whose_case_differs_from_the_tracked_spelling_is_dead_here_too() -> None:
    """The case the filesystem forgives, refused on both platforms.

    Windows answers a mis-cased path yes where the Linux runner answers no, so a citation the gate
    passes here fails the branch on CI and nothing local says why.
    """
    _reset()
    checks = _module("docs_gate.checks")
    _clear_caches(_gate().root / SCRIPTS_COPY)
    # The repository path and the bare name, which reach the listing by different routes: the second
    # is what the name index folding its keys to one case would go on resolving.
    for spelling in ("docs/Glossary.md", "Glossary.md"):
        found = [finding.check for finding in checks._check_citation(spelling + " :: " + GLOSSARY_ANCHOR, NOTES, {})]
        assert found == ["citation"], spelling + " resolved anyway: " + repr(found)
    _assert_corpus_restored()


def test_a_mis_cased_suffix_fails_a_citation_rather_than_dropping_it_out_of_the_population() -> None:
    """The register is folded and the path lookup is not, which parts this case from the one above it.

    Only the suffix is mis-cased, so the finding is the register's and not a second reading of the path.
    """
    _reset()
    checks = _module("docs_gate.checks")
    _clear_caches(_gate().root / SCRIPTS_COPY)
    shouted = "docs/gone-in-a-shouted-suffix.MD"
    found = [finding.detail for finding in checks._check_citation(shouted + " :: an anchor", NOTES, {})]
    assert found == ["cited path names no file in the repository, under any spelling: " + shouted], repr(found)
    # The other half of the boundary: a suffix folded in the register leaves the LISTING exact, so a
    # tracked page named in another case still resolves to nothing.
    dead = [finding.check for finding in checks._check_citation("docs/Notes.md :: an anchor", NOTES, {})]
    assert dead == ["citation"], "a mis-cased tracked page resolved: " + repr(dead)
    _assert_corpus_restored()


def test_a_dead_citation_is_told_apart_from_a_present_file_in_a_refused_spelling() -> None:
    """Both fail, and the reader is sent two ways: after a rename or a deletion, or after the spelling the gate admits.

    One message for both sent the common case, a typo or a deleted module, hunting for another spelling.
    """
    _reset()
    checks = _module("docs_gate.checks")
    _clear_caches(_gate().root / SCRIPTS_COPY)
    dead = [finding.detail for finding in checks._check_citation("docs/gone.md :: symbol", NOTES, {})]
    assert dead == ["cited path names no file in the repository, under any spelling: docs/gone.md"], repr(dead)
    inside = SPIELER_PANEL.partition("src/")[2]
    spelled = [finding.detail for finding in checks._check_citation(inside + " :: Panel", NOTES, {})]
    assert spelled == ["cited path is neither repository-relative nor package-relative: " + inside], repr(spelled)
    _assert_corpus_restored()


def test_a_renamed_heading_kills_the_citation_naming_it_however_its_wording_survives() -> None:
    """The old wording is left in prose: on a presence test it keeps the citation alive.

    The rename is the one edit a section citation exists to catch, and the edit that scatters the
    old words over the page.
    """
    _reset()
    _append(NOTES, _heading(2, CITED_HEADING), "", "A section the page beside this one names.")
    _append(TWIN_NOTES, "The section is " + _tick(NOTES + " :: " + CITED_HEADING) + ".")
    try:
        _, before = _run()
        _replace(NOTES, _heading(2, CITED_HEADING), _heading(2, RENAMED_HEADING))
        _replace(NOTES, "A section the page beside this one names.", CITED_HEADING + " is a phrase the prose still carries.")
        _, after = _run()
    finally:
        _reset()
    assert not before, "the citation did not resolve before the rename: " + _shape(before)
    assert after == Counter({("fail", "citation", TWIN_NOTES): 1}), "a renamed heading: " + _shape(after)
    _assert_corpus_restored()


def test_a_quoted_fragment_of_a_page_is_proved_by_the_sentence_carrying_it() -> None:
    """COR-6's other anchor form, which the landmark reader would refuse: a fragment names no heading.

    Both halves, because a reader that admitted every quoted run would pass the second as readily
    as the first.
    """
    _reset()
    checks = _module("docs_gate.checks")
    _clear_caches(_gate().root / SCRIPTS_COPY)
    carried = QUOTE + "A plain page, which is where a planted violation is written." + QUOTE
    assert not checks._check_citation(NOTES + " :: " + carried, TWIN_NOTES, {}), "a quoted sentence the page carries was refused"
    gone = QUOTE + "a sentence the page never carried" + QUOTE
    found = [finding.check for finding in checks._check_citation(NOTES + " :: " + gone, TWIN_NOTES, {})]
    assert found == ["citation"], "a quoted fragment the page lacks resolved: " + repr(found)
    _assert_corpus_restored()


def test_an_anchor_a_fenced_block_alone_carries_resolves_nowhere() -> None:
    """A fenced sample is code a renderer shows and no reader navigates to, so an anchor found only there names nothing."""
    _reset()
    checks = _module("docs_gate.checks")
    _clear_caches(_gate().root / SCRIPTS_COPY)
    found = [finding.detail for finding in checks._check_citation(NOTES + " :: " + FENCED_ANCHOR, TWIN_NOTES, {})]
    wanted = "anchor '" + FENCED_ANCHOR + "' names no heading, table row or bold key in " + NOTES
    assert found and found[0].startswith(wanted), repr(found)
    _assert_corpus_restored()


def test_an_invariant_citation_is_proved_by_the_sheet_s_table_and_not_by_its_prose() -> None:
    """A sheet mentions a neighbour's number in prose, and presence would resolve a citation of it there.

    Three citations, one finding: the id the frontend sheet defines, the id two sheets define,
    and the id it only mentions.
    """
    _reset()
    _replace(FRONTEND_SPEC, "It renders one page.", "It renders one page, and rests on I2 for its output vocabulary.")
    _append(NOTES, "`docs/frontend/spec.md :: I1`, `docs/backend/spec.md :: I1` and `docs/frontend/spec.md :: I2` are cited.")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "citation", NOTES)] == 1, "an invariant the sheet only mentions resolved there: " + _shape(reported)
    _assert_corpus_restored()


def test_a_present_gitignored_file_still_answers_for_its_anchor() -> None:
    """The listing declines an ignored file; where the disk holds it, its anchor is a claim like any other.

    Only an ignored file that is absent is excused, a clone holding none by design.
    """
    _reset()
    root = _gate().root
    write(root, IGNORED_MODULE, _page("VALUE = 1"))
    checks = _module("docs_gate.checks")
    _clear_caches(root / SCRIPTS_COPY)
    try:
        live = checks._check_citation(IGNORED_MODULE + " :: VALUE", NOTES, {})
        dead = [finding.detail for finding in checks._check_citation(IGNORED_MODULE + " :: MISSING", NOTES, {})]
        absent = checks._check_citation("ignored/absent.py :: VALUE", NOTES, {})
    finally:
        (root / IGNORED_MODULE).unlink()
        _reset()
    assert not live, "a live anchor in an ignored file was reported: " + repr([finding.human() for finding in live])
    assert dead == ["anchor 'MISSING' is not defined in " + IGNORED_MODULE], repr(dead)
    assert not absent, "an absent ignored file was reported: " + repr([finding.human() for finding in absent])
    _assert_corpus_restored()


def test_a_link_to_a_present_gitignored_page_is_not_dead_and_its_anchor_is_still_read() -> None:
    """The link arm excuses an ignored target as its sibling arms do, and reads one that is here.

    Three links, one finding: a heading the ignored page carries, one it does not, and an absent
    ignored page.
    """
    _reset()
    root = _gate().root
    write(root, IGNORED_PAGE, _page(_heading(1, "Scratch"), "", "Notes nobody commits."))
    _append(NOTES, "[live](../ignored/scratch.md#scratch), [stale](../ignored/scratch.md#nowhere) and [absent](../ignored/absent.md).")
    try:
        _, reported = _run()
    finally:
        (root / IGNORED_PAGE).unlink()
        _reset()
    assert reported[("fail", "link", NOTES)] == 0, "a link to an ignored page was read as dead: " + _shape(reported)
    assert reported[("fail", "anchor", NOTES)] == 1, "a dead anchor into an ignored page went unread: " + _shape(reported)
    _assert_corpus_restored()


def test_a_file_the_branch_wrote_and_never_staged_resolves_by_its_repository_path() -> None:
    """The listing is git's, and a branch's new modules are in no index yet.

    Left to the tracked half alone, every citation a branch adds to a file it also adds reads as dead.
    """
    _reset()
    root = _gate().root
    write(root, UNSTAGED_MODULE, _module_named("a module this branch wrote and never staged."))
    checks = _module("docs_gate.checks")
    _clear_caches(root / SCRIPTS_COPY)
    try:
        found = checks._check_citation(UNSTAGED_MODULE + " :: VALUE", NOTES, {})
    finally:
        _reset()
    assert not found, [finding.human() for finding in found]
    _assert_corpus_restored()


def test_a_block_this_branch_lengthened_is_measured_and_an_older_one_is_not() -> None:
    """A block the branch lengthened past a bound is measured, and the older one beside it is not.

    Requiring the WHOLE block to be added misses the lengthened one, and the count says so: the
    corpus block above it is over the same bound and must stay silent.
    """
    _reset()
    _replace(LEGACY_SAMPLE, HASH + " " + SHORT_LINE, HASH + " " + SHORT_LINE + NEWLINE + HASH + " " + LENGTHENING_LINE)
    try:
        _, reported = _run()
    finally:
        _reset()
    reason = "the block this branch lengthened, and it alone, is the one to measure: "
    assert reported[("fail", "comment-length", LEGACY_SAMPLE)] == 1, reason + _shape(reported)
    _assert_corpus_restored()


def test_a_word_changed_inside_an_older_block_is_not_this_branch_s() -> None:
    """A block already over the bound stays the sweep's, however many of its lines a branch edits.

    Driven apart from the case above: silence proves nothing while a second block is speaking.
    """
    _reset()
    branch = _module("docs_gate.branch")
    legacy = " ".join((LEGACY_OPENING, LEGACY_MIDDLE, LEGACY_CLOSING))
    # The premise, asserted: a corpus block INSIDE the bound would let this case pass on nothing.
    assert len(legacy.split()) > branch.COMMENT_WORD_CAP, "the corpus block is inside the bound, so nothing here is exempted"
    _replace(LEGACY_SAMPLE, HASH + " " + LEGACY_MIDDLE, HASH + " " + LEGACY_MIDDLE.replace("edits", "rewords"))
    try:
        _, reported = _run()
    finally:
        _reset()
    spoke = [key for key in reported if key[1] == "comment-length"]
    assert not spoke, "a word changed inside an older block was failed as this branch's: " + _shape(reported)
    _assert_corpus_restored()


def test_a_citation_that_wraps_across_a_line_is_read_as_one_citation() -> None:
    """A code span may wrap, and a pattern that stops at the newline calls the page clean.

    Two wrap points, because a pattern widened until one instance passed would leave the other
    unseen: one break after the separator, one before it.
    """
    _reset()
    _append(
        NOTES,
        "Naming nothing, wrapped after the separator: `docs/gone-in-a-wrap.md ::",
        "a symbol nobody wrote`.",
        "",
        "And wrapped before it: `docs/glossary.md",
        ":: an anchor the glossary does not carry`.",
    )
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "citation", NOTES)] == 2, "a citation that wraps was read by nothing: " + _shape(reported)
    _assert_corpus_restored()


def test_a_code_span_is_not_joined_across_a_blank_line() -> None:
    """The join stops at the blank line that ends a paragraph, which is what bounds it.

    Without that bound a stray backtick would pair with one in the paragraph below and the citation
    it invents would be reported against a page carrying none.
    """
    _reset()
    _append(
        NOTES,
        "A paragraph whose last span is left open: `docs/gone-across-a-paragraph.md ::",
        "",
        "and the paragraph after it, carrying the closing tick`.",
    )
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "citation", NOTES)] == 0, "a span was joined across a blank line: " + _shape(reported)
    _assert_corpus_restored()


def test_a_quoted_error_is_not_a_citation_and_a_broken_wrapped_one_still_is() -> None:
    """The separator alone is not evidence: COR-6's left half names a file, and quoted text does not.

    The corpus proves the marker is stripped: its wrapped citations resolve only while it is, so a
    surviving `#` speaks through the clean-corpus case.
    """
    _reset()
    _append(NOTES, "The store answered `" + QUOTED_ERROR + "`.")
    _append(SAMPLE, HASH + " The store answered `" + QUOTED_ERROR + "`.")
    # A DIFFERENT module, because the plant writes the anchor text into the file it is appended to.
    _append(SAMPLE, HASH + " and see `fl_backend/app/second.py ::", HASH + " a symbol nobody wrote`")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "citation", NOTES)] == 0, "a quoted error was read as a citation: " + _shape(reported)
    assert reported[("fail", "citation", SAMPLE)] == 1, "a wrapped citation naming a dead anchor went unread: " + _shape(reported)
    _assert_corpus_restored()


def test_a_continuation_that_wraps_across_a_comment_line_is_still_resolved() -> None:
    """Split at the wrap, the separator ends a line with nothing to its right.

    A reader admitting a file on the spaced form alone would skip it; the bare `::` is what has to
    admit it.
    """
    _reset()
    _append(SAMPLE, HASH + " `fl_backend/app/second.py :: OTHER` continues onto `::", HASH + " MISSING`.")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "citation", SAMPLE)] == 1, "a continuation that wraps went unresolved: " + _shape(reported)
    _assert_corpus_restored()


def test_a_line_citation_that_wraps_across_a_line_is_still_found() -> None:
    """Wrapped after the slash, neither raw line is a citation and the joined text is.

    Both patterns read it there -- the backticked span, and the bare tail the join leaves after the
    space -- so the count is two spellings of one defect.
    """
    _reset()
    _append(NOTES, "See `docs/", "glossary.md:7` for the shape.")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "line-citation", NOTES)] == 2, "a line citation that wraps went unread: " + _shape(reported)
    _assert_corpus_restored()


def test_a_header_in_a_kind_the_hash_reader_answers_for_is_found_and_bounded() -> None:
    """INC-2's scope is the kind `comment_style` reads as shell, never a tree: a Dockerfile has no suffix to admit it by.

    Two files, one suffixless and one under no scoped tree; two findings apiece, the title and the
    bound.
    """
    _reset()
    over = [HASH + " a filler line carrying the header past the words a header may hold" for _ in range(18)]
    _replace(
        DOCKERFILE,
        HASH + " BACKEND · an image, reached by whole filename rather than by suffix.",
        "\n".join([HASH + " an image whose header opens on no token", *over]),
    )
    _replace(
        CONF_FILE,
        HASH + " OPS · a server block, scanned for its comments and nothing else.",
        "\n".join([HASH + " a server block whose header opens on no token", *over]),
    )
    try:
        _, reported = _run()
    finally:
        _reset()
    assert reported[("fail", "module-header", DOCKERFILE)] == 2, "a suffixless file's header was measured by nothing: " + _shape(reported)
    assert reported[("fail", "module-header", CONF_FILE)] == 2, "a header under no scoped tree was measured by nothing: " + _shape(reported)
    _assert_corpus_restored()


def test_a_misplaced_header_is_told_the_placement_its_own_kind_keeps() -> None:
    """Above the imports is INC-7's, and Python's alone; the widened scope reaches kinds that have no imports at all.

    Both messages, because one wording covering the pair reads as right for whichever kind the
    reader happens to be holding.
    """
    checks = _module("docs_gate.checks")
    below = HASH + " OPS · a header sitting under the first line of content"
    titled = QUOTES + "BACKEND · a header sitting under the first statement" + QUOTES
    # The placement arm alone: it is the one carrying a line, the shape arms judging the whole block.
    placed = [
        [finding for finding in checks.check_module_header(rel, raw, suffix) if finding.line is not None]
        for rel, raw, suffix in (
            (CONF_FILE, _page("server { listen 80; }", "", below), ".sh"),
            (SAMPLE, _page("import sys", "", titled), ".py"),
        )
    ]
    hashed, pythonic = (found[0] for found in placed)
    assert [len(found) for found in placed] == [1, 1], "the misplaced block drew more than one placement finding"
    assert "INC-7" in pythonic.detail, pythonic.detail
    assert "INC-7" not in hashed.detail, "a Dockerfile, a workflow and an nginx block were sent to move a header above absent imports"
    assert "INC-2" in hashed.detail, hashed.detail


def test_a_dead_path_in_the_notice_file_is_reported_and_a_live_one_or_a_directory_is_not() -> None:
    """The file is read whole as prose, its bare paths reaching `bare-path` and its sentences reaching no comment reader.

    The corpus copy names a live file and a directory, so the plant's one dead path is the one finding.
    """
    _reset()
    # The two shapes beside the dead path are what a COMMENT is refused for, and this file holds
    # none: an ambiguous invariant number and an audit id.
    _append(NOTICE_FILE, "  docs/gone-from-the-notice.md", "It records I1, and § S2 alongside it.")
    try:
        _, reported = _run()
    finally:
        _reset()
    about = {key: count for key, count in reported.items() if key[2] == NOTICE_FILE}
    assert about == {("fail", "bare-path", NOTICE_FILE): 1}, "the notice file was read by nothing, or by the wrong reader: " + _shape(reported)
    _assert_corpus_restored()


def test_a_section_reference_parted_from_its_citation_by_a_wrap_is_left_alone() -> None:
    """The citation ends the line above, so the page the reference sits on must not answer in its place."""
    _reset()
    _append(BACKEND_SPEC, "The rule is stated in `docs/frontend/spec.md`", "§" + ABSENT_SECTION + ", which is not this sheet's.")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert not _about("section-reference", reported), "a wrapped citation was answered for by the page below it: " + _shape(reported)
    _assert_corpus_restored()


def test_a_page_named_in_plain_text_leaves_the_containing_page_out_of_it() -> None:
    """A page named without backticks or a link resolves to nothing, and nothing else stands in for it."""
    _reset()
    _append(BACKEND_SPEC, "The rule is spec.md §" + ABSENT_SECTION + ", named in plain text.")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert not _about("section-reference", reported), "a plain-text page name was answered for: " + _shape(reported)
    _assert_corpus_restored()


def test_a_section_reference_on_a_page_that_numbers_no_heading_is_silent() -> None:
    """A page with no numbered heading resolves nothing, rather than failing every reference written on it."""
    _reset()
    _append(NOTES, "This page's own §" + ABSENT_SECTION + " resolves against nothing.")
    try:
        _, reported = _run()
    finally:
        _reset()
    assert not _about("section-reference", reported), "a page numbering nothing answered a reference: " + _shape(reported)
    _assert_corpus_restored()


def test_the_wall_clock_record_is_read_whole_as_prose_rather_than_for_its_comments() -> None:
    """Its suffix reaches the corpus by name alone, and the bare path proves the file was read.

    Read as code, its opening run is a module header INC-2 fails, so the one finding here says
    which reader answered.
    """
    _reset()
    _append(WALL_CLOCK, HASH + " " + WALL_CLOCK_DEAD_PATH + " is named here.")
    try:
        _, reported = _run()
    finally:
        _reset()
    about = {key: count for key, count in reported.items() if key[2] == WALL_CLOCK}
    assert about == {("fail", "bare-path", WALL_CLOCK): 1}, "the record was read by nothing, or by the wrong reader: " + _shape(reported)
    _assert_corpus_restored()


def test_a_fence_inside_a_fenced_block_closes_only_its_own_opener() -> None:
    """A reader flipping one boolean reads the nested sample as prose and the text past the outer close as a block it never left.

    One finding either way, so the detail parts the two readings.
    """
    _reset()
    checks = _module("docs_gate.checks")
    _append(
        NOTES,
        LONG_FENCE + "markdown",
        FENCE + "mermaid",
        "flowchart TD",
        "  A[" + _tick(NESTED_FENCE_PATH) + "] --> B",
        LONG_FENCE,
        "",
        "Past the outer close, " + _tick(PAST_FENCE_PATH) + " is the page's own claim.",
    )
    _clear_caches(_gate().root / SCRIPTS_COPY)
    try:
        found = [finding.detail for finding in checks.check_file(_gate().root / NOTES, {}, {})]
    finally:
        _reset()
    assert found == ["path named but not present: " + PAST_FENCE_PATH], repr(found)
    _assert_corpus_restored()


def test_a_comment_marker_inside_a_string_literal_opens_no_comment() -> None:
    """Three shapes at once, because each fails alone on a reader tracking one quote and not another.

    The real comment beside them parts a reader that tracks quoting from one that blanks the file
    whole.
    """
    _reset()
    checks = _module("docs_gate.checks")
    _append(
        TSX_SAMPLE,
        'const help = "see // ' + LITERAL_MARKER_PATH + '";',
        "const note = `a marker // inside a template, " + TEMPLATE_MARKER_PATH + "`;",
        # A glob whose star-slash pair opens a block comment nothing closes, which is the shape
        # `fl_frontend/eslint.config.mjs` carries: the file's last lines are read as prose.
        'const ignored = ".next/**";',
        'const dead = "' + RUNAWAY_BLOCK_PATH + '";',
        "// A real comment naming " + REAL_COMMENT_PATH,
    )
    _clear_caches(_gate().root / SCRIPTS_COPY)
    try:
        found = [finding.detail for finding in checks.check_file(_gate().root / TSX_SAMPLE, {}, {})]
    finally:
        _reset()
    kept = "path named but not present: " + REAL_COMMENT_PATH + " -- and unbackticked, so `path` never saw it"
    assert found == [kept], repr(found)
    _assert_corpus_restored()


def test_a_markdown_page_s_heading_is_no_module_header() -> None:
    """`comment_style` sends a page to the `#` reader too, which reads its H1 as a header; the markdown guard is what keeps it out.

    The premise is asserted first, or this passes on a reader that saw no header.
    """
    _reset()
    kernel = _module("docs_gate.kernel")
    checks = _module("docs_gate.checks")
    _clear_caches(_gate().root / SCRIPTS_COPY)
    page = _gate().root / NOTES
    assert kernel._module_header(_read(NOTES), kernel.comment_style(page)) is not None, (
        "the `#` reader no longer reads a page's H1 as a header, so the guard guards nothing"
    )
    found = [finding.check for finding in checks.check_file(page, {}, {}) if finding.check == "module-header"]
    assert not found, "a page's H1 was held to INC-2's shape"
    _assert_corpus_restored()


def test_the_comment_bounds_read_a_file_by_its_format_not_its_suffix() -> None:
    """INC-9's bound is measured through the reader the FORMAT needs, not `path.suffix`.

    No corpus file separates the two: a suffixless path read for a C-style marker yields no block,
    so the check would run, report nothing, and look wired.
    """
    block = [HASH + " a line of a block that runs past what a comment may hold" for _ in range(6)]
    # A first line that opens no comment: a leading run of hashes is the module header, which INC-2
    # bounds instead and which `comment_runs` therefore steps over.
    raw = _page("FROM scratch", *block)
    bounds = _module("docs_gate.branch").check_comment_length
    found = bounds(_gate().root / DOCKERFILE, raw, set(range(1, len(block) + 2)), lambda: [])
    assert [finding.check for finding in found] == ["comment-length"], "the block was read by the wrong format's reader"


def test_a_check_that_knows_where_it_looked_prints_the_line_beside_the_file() -> None:
    """A location belongs in the finding, not in its prose: `<file>:<line>` is what an editor opens.

    The block opens on the third line, so a bound reported against the file alone would leave a
    reader searching a module for the run that broke it.
    """
    block = [HASH + " a line of a block that runs past what a comment may hold" for _ in range(6)]
    raw = _page("FROM scratch", "", *block)
    bounds = _module("docs_gate.branch").check_comment_length
    found = bounds(_gate().root / DOCKERFILE, raw, set(range(1, len(block) + 3)), lambda: [])
    assert [finding.line for finding in found] == [3], "the block's opening line did not reach the finding"
    assert _subject(found[0].human().strip()) == (DOCKERFILE, 3), found[0].human()


@contextlib.contextmanager
def _swapped(module: ModuleType, name: str, value: object) -> Iterator[None]:
    """One module attribute replaced for a case, and put back whatever the body raises.

    Through `setattr`: a module imported by name is a `ModuleType`, whose attributes a type
    checker cannot know.
    """
    kept = getattr(module, name)
    setattr(module, name, value)
    try:
        yield
    finally:
        setattr(module, name, kept)


def test_an_eol_listing_this_gate_cannot_parse_fails_rather_than_reading_as_a_clean_tree() -> None:
    """Both byte readers skip a record they cannot parse, so a shape git stops writing empties them.

    Nothing else holds the tree to `.gitattributes`, and nothing else hunts a NUL or a stray CR, so
    two loops over nothing would retire both with the run green.
    """
    checks = _module("docs_gate.checks")
    rows, records = checks._eol_rows, checks._eol_records
    try:
        with _swapped(checks, "LS_FILES_EOL_RE", re.compile("a record shape git does not write")):
            rows.cache_clear()
            found = checks.check_line_endings() + checks.check_binary_bytes()
    finally:
        rows.cache_clear()
        records.cache_clear()
    assert sorted(finding.check for finding in found) == ["binary-byte", "line-endings"], [f.detail for f in found]


def test_an_empty_fragment_list_fails_rather_than_confirming_a_form_it_never_read() -> None:
    """The list the body gate quotes is what this check confirms, so an empty one confirms nothing.

    Emptied, the loop runs zero times and the check passes -- while the body gate it stands behind
    accepts every unfilled pull request.
    """
    checks = _module("docs_gate.checks")
    with _swapped(_module("check_pr_body"), "TEMPLATE_FRAGMENTS", ()):
        found = checks.check_template_fragments()
    assert [finding.check for finding in found] == ["template-fragment"], [f.detail for f in found]


# --- committed branches --------------------------------------------------------------------------

SCENARIO_BRANCH: Final = "scenario"


def _committed(plant: Callable[[], None], *rels: str) -> tuple[int, Counter[Reported]]:
    """The gate's answer over a branch whose change is committed rather than sitting in the tree.

    The cases above leave HEAD at the fork; a pushed branch is a commit past it, and the
    added-line checks must read that diff the same way.
    """
    _reset()
    root = _gate().root
    git(root, "checkout", "-q", "-b", SCENARIO_BRANCH)
    try:
        plant()
        git(root, "add", "--", *rels)
        git(root, "commit", "-q", "-m", "Scenario: a branch commit the gate reads")
        return _run()
    finally:
        git(root, "checkout", "-q", "main")
        git(root, "branch", "-q", "-D", SCENARIO_BRANCH)
        _reset()


def test_a_hook_s_embedded_javascript_comments_are_read() -> None:
    """The shell reader takes a leading `//` beside `#`, so a hook's embedded node region is inside INC-6, INC-9 and COR-3."""
    hook = ".claude/hooks/embedded.sh"
    over = ["// a line of a block that runs past what a comment may hold" for _ in range(6)]

    def plant() -> None:
        write(
            _gate().root,
            hook,
            _page(
                "#!/usr/bin/env bash",
                HASH + " HOOKS · a guard whose logic is an embedded node one-liner.",
                'node -e "',
                "// resolves nowhere: docs/gone-under-a-slash.md",
                "",
                *over,
                "",
                "// previously this one-liner guarded nothing",
                '"',
            ),
        )

    code, reported = _committed(plant, hook)
    expected = Counter(
        {
            ("fail", "bare-path", hook): 1,
            ("fail", "comment-length", hook): 1,
            ("fail", "history", hook): 1,
        }
    )
    assert reported == expected, _shape(reported)
    assert code == 1
    _assert_corpus_restored()


# --- the refusals, and the output the run is read through ----------------------------------------


def _main(*argv: str) -> tuple[int, str]:
    """The entry point under one set of arguments, with everything it printed.

    `_run` reads the human report and drops the rest; a refusal and the workflow-command format
    are what the run PRINTS rather than what it found, so both are read here.
    """
    fixture = _gate()
    _clear_caches(fixture.root / SCRIPTS_COPY)
    buffer = io.StringIO()
    kept = sys.argv
    sys.argv = ["check_docs.py", *argv]
    try:
        with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(buffer):
            code = int(fixture.gate.main())
    finally:
        sys.argv = kept
    return code, buffer.getvalue()


def test_a_corpus_with_no_file_in_it_refuses_rather_than_passing() -> None:
    """The run's one refusal: nothing was read, so nothing was proved and 0 would be a lie.

    Driven by emptying the listing rather than the tree: a corpus this gate cannot read is a git
    that answered nothing, which no plant in a repository can produce.
    """
    _reset()
    checks = _module("docs_gate.checks")
    with _swapped(checks, "scanned_files", tuple):
        code, output = _main()
    assert code == _module("checker_kernel").EXIT_REFUSED, output
    assert "nothing was read" in output, output


def test_the_workflow_command_format_is_what_the_github_output_prints() -> None:
    """`--output-format github` is a mode CI reads and no human ever sees, so only a run proves it.

    Every annotation is an error, because every finding fails the run: one annotated `warning` reads
    as something a reader may leave standing.
    """
    _reset()
    _plant_history()
    _plant_bare_paths()
    try:
        code, output = _main("--output-format", "github")
    finally:
        _reset()
    lines = [line for line in output.split("\n") if line.startswith("::")]
    assert code == 1, output
    assert any(line.startswith("::error ") and "title=bare-path" in line for line in lines), output
    assert any(line.startswith("::error ") and "title=history" in line for line in lines), output
    assert "::warning" not in output, output
    _assert_corpus_restored()


# --- what the copy sweep says when it read nothing -----------------------------------------------


def test_a_copy_root_that_is_not_there_refuses_rather_than_sweeping_nothing() -> None:
    """The tree the sweep is held over moves, and a loop over nothing has no violation to find."""
    _reset()
    copy_rules = _module("docs_gate.copy_rules")
    with _swapped(copy_rules, "COPY_ROOT", "fl_frontend/no-such-tree"):
        found = copy_rules.check_copy_rules()
    assert [finding.check for finding in found] == ["copy-corpus"], [f.detail for f in found]
    assert "absent" in found[0].detail, found[0].detail


def test_a_copy_root_holding_no_copy_bearing_file_refuses_too() -> None:
    """The tree is there and the glob reaches nothing in it: the same silence one step on.

    The glob is moved rather than the tree: an empty `fl_frontend/src` would take `inputs` and
    every path citation down with it, none of which this arm answers for.
    """
    _reset()
    copy_rules = _module("docs_gate.copy_rules")
    with _swapped(copy_rules, "COPY_GLOB", copy_rules.COPY_ROOT + "/**/*.no-such-suffix"):
        found = copy_rules.check_copy_rules()
    assert [finding.check for finding in found] == ["copy-corpus", "copy-corpus"], [f.detail for f in found]
    assert "holds no copy-bearing file" in found[0].detail, found[0].detail


def test_a_copy_file_the_scanner_cannot_read_is_reported_rather_than_passed_over() -> None:
    """A file the reader cannot decode yields no span, and no span reads as copy with nothing wrong.

    The one arm no plant inside the corpus reaches: a file this unreadable fails `unreadable`
    too, and that finding would hide which of the two spoke.
    """
    _reset()
    root = _gate().root
    unreadable = root / COPY_ROOT / "undecodable.ts"
    unreadable.write_bytes(b"\xff\xfe export const A = 1;\n")
    copy_rules = _module("docs_gate.copy_rules")
    try:
        assert copy_rules.copy_spans(unreadable) == ([], False), "an unreadable file answered as a scan that balanced"
        with _swapped(copy_rules, "corpus_files", lambda: (unreadable,)):
            found = copy_rules.check_copy_rules()
    finally:
        unreadable.unlink()
        _reset()
    # Three: the file's own refusal, then the two the sweep raises once nothing German is left in it.
    assert [finding.check for finding in found] == ["copy-corpus"] * 3, [f.detail for f in found]
    assert "could not be read as TypeScript" in found[0].detail, found[0].detail
    _assert_corpus_restored()


# --- what a finding is made of -------------------------------------------------------------------


def test_a_finding_carries_the_line_the_token_it_read_sits_on() -> None:
    """A check reading by offset must number the line the FILE holds, not the one its reader saw.

    The body is scrubbed of its backticked spans first, so a reader dropping a line rather than
    blanking it would number every finding below the drop too low.
    """
    _reset()
    checks = _module("docs_gate.checks")
    body = _page(
        HASH + " a first line naming `docs/notes.md`, backticked and so scrubbed out",
        "",
        HASH + " resolves nowhere: docs/gone-on-a-known-line.md",
    )
    found = checks.check_bare_paths(SAMPLE, body)
    assert [(finding.check, finding.line) for finding in found] == [("bare-path", 3)], [f.human() for f in found]


def test_an_annotation_carries_the_verdict_the_exit_code_carries() -> None:
    """A diff annotated `warning` reads as a run that passed, whatever the exit code said."""
    _reset()
    finding = _module("docs_gate.kernel").Finding
    assert finding("fail", "path", NOTES, "a detail", 7).github().startswith("::error file=" + NOTES + ",line=7,title=path::")
    assert finding("fail", "history", NOTES, "a detail").github().startswith("::error file=" + NOTES + ",title=history::")


def test_a_workflow_command_escapes_what_would_otherwise_end_it() -> None:
    """An unescaped separator inside a detail ends the command early, and the annotation loses the rest.

    A property value takes the separators as well as the message's own set: a comma there opens a
    property nobody wrote.
    """
    _reset()
    escaped = _module("docs_gate.kernel")._escaped
    assert escaped("50% off\nand on\r", in_property=False) == "50%25 off%0Aand on%0D"
    assert escaped("a:b,c", in_property=True) == "a%3Ab%2Cc"
    assert escaped("a:b,c", in_property=False) == "a:b,c"


def test_a_finding_naming_a_check_no_registry_holds_is_refused_where_it_is_built() -> None:
    """The registry is what `enforced-by` resolves a rule's claim against, so a check outside it is invisible."""
    _reset()
    finding = _module("docs_gate.kernel").Finding
    # The severity as well as the name: one value is registered, and a finding claiming any other
    # is a tier this gate does not have.
    for check, severity in (("no-such-check", "fail"), ("history", "report")):
        try:
            finding(severity, check, NOTES, "a detail")
        except ValueError:
            continue
        raise AssertionError("a finding was built for " + severity + " " + check)


def test_a_nul_at_the_first_byte_is_reported_and_one_inside_a_token_never_ends_the_run() -> None:
    """The byte `binary-byte` exists to report, in the two places the check could not reach it.

    Offset zero, which a comparison against greater-than-zero passes. And a backticked token
    handed to git, where a NUL raises at the launch and ends the run.
    """
    _reset()
    root = _gate().root
    named = "docs/go" + NUL_BYTE + "ne.md"
    _write_bytes(root, NOTES, NUL_BYTE + NEWLINE + _read(NOTES) + NEWLINE + "A path `" + named + "` is named here." + NEWLINE)
    checks = _module("docs_gate.checks")
    try:
        code, reported = _run()
        bytes_found = [finding for finding in checks.check_binary_bytes() if finding.file == NOTES]
    finally:
        _reset()
    assert code == 1, "the run did not reach a finding"
    assert reported[("fail", "binary-byte", NOTES)] == 1, _shape(reported)
    assert "offset 0" in bytes_found[0].detail, bytes_found[0].detail
    _assert_corpus_restored()


# --- how a Python module is cut into comment blocks ------------------------------------------------

# Built line by line, so this file's own text carries neither a margin quote nor a bare marker for
# the gate to read as its own. `_module` hands back the copy under test.
MARGIN_SCRIPT: Final[tuple[str, ...]] = (
    QUOTES + "A module." + QUOTES,
    "",
    "SCRIPT = " + QUOTES + "#!/usr/bin/env bash",
    "echo one",
    QUOTES,
    "",
    "def run() -> int:",
    "    total = 1",
    "    return total",
)

PARAGRAPHED: Final[tuple[str, ...]] = (
    "def widen() -> None:",
    "    " + QUOTES + "A summary line.",
    "",
    "    A second paragraph, which a reader meets as one block with the summary above it.",
    "",
    "    A third, so a bound measured per paragraph would read three short blocks here.",
    "    " + QUOTES,
    "    return None",
)

TRAILING: Final[tuple[str, ...]] = (
    "TOTAL = 1  " + HASH + " why the total is held here",
    HASH + " a block of its own, on its own line",
)

CLOSING_QUOTE: Final[tuple[str, ...]] = (
    "def widen() -> None:",
    "    " + QUOTES + "A docstring." + QUOTES,
    "    " + HASH + " a comment against the closing quote, which is a block of its own",
    "    return None",
)

UNTOKENIZABLE: Final[tuple[str, ...]] = (
    HASH + " a comment naming docs/gone.md",
    "unterminated = " + QUOTES,
)


def _runs(lines: tuple[str, ...]) -> list[tuple[int, str]]:
    """Every comment block the gate reads out of one module, as (first line, measured text)."""
    kernel = _module("docs_gate.kernel")
    branch = _module("docs_gate.branch")
    return [(first, branch._block_text(block)) for first, block in kernel.comment_runs(NEWLINE.join(lines), ".py")]


def test_a_string_literal_closing_at_the_margin_opens_no_comment_block() -> None:
    """A multi-line literal's closing quote is not a docstring opening, and the code under it is not prose.

    Read as one, the lines below it are measured against INC-9's bound, which reports a finding
    about code that no edit to any comment can clear.
    """
    measured = _runs(MARGIN_SCRIPT)
    assert not [text for _, text in measured if "return total" in text or "echo one" in text], measured


def test_a_docstring_is_one_block_however_many_paragraphs_it_holds() -> None:
    """Split at its blank lines, a docstring over the bound measures as several short blocks and passes."""
    measured = _runs(PARAGRAPHED)
    assert len(measured) == 1, measured
    for fragment in ("A summary line.", "A second paragraph", "A third"):
        assert fragment in measured[0][1], measured


def test_a_comment_standing_after_code_opens_no_block() -> None:
    """The bound measures the prose a reader meets on its own line, which is what the scan before it measured."""
    measured = _runs(TRAILING)
    assert len(measured) == 1, measured
    assert "why the total is held here" not in measured[0][1], measured


def test_a_comment_against_a_closing_quote_is_a_block_of_its_own() -> None:
    """Merged, a docstring and the comment under it measure as one, which is a bound nobody wrote."""
    measured = _runs(CLOSING_QUOTE)
    assert len(measured) == 2, measured
    assert measured[0][1] == "A docstring.", measured
    assert measured[1][1].startswith("a comment against"), measured


def test_a_module_that_will_not_tokenize_still_yields_its_comments() -> None:
    """Reading none would look like a file holding none, which every comment check then passes."""
    measured = _runs(UNTOKENIZABLE)
    assert [text for _, text in measured if "docs/gone.md" in text], measured


def test_a_rule_pattern_reaches_past_the_three_methods_typed_on_it() -> None:
    """`RULE_ID_RE` is exported as a pattern, so every method a caller reaches for is on it.

    The three typed on it are the gate's own; a reader of the export reaches for `search`, which a
    subset refuses at runtime.
    """
    _reset()
    _clear_caches(_gate().root / SCRIPTS_COPY)
    found = _gate().gate.RULE_ID_RE.search("a page citing COR-13 in passing")
    assert found is not None and found.group(1) == "COR-13", found


def test_a_wrapped_span_is_reported_by_what_its_closed_join_names() -> None:
    """The marker comes off a comment's continuation, or the join names nothing and reads as dead.

    A count reads a marker left in the join as the dead-path arm working, so the three plants are
    told apart by their messages.
    """
    _reset()
    _plant_wrapped_paths()
    try:
        code, output = _output()
    finally:
        _reset()
    assert output.count("wraps inside the path, which a code span renders with a space in it") == 2, output
    assert output.count("wraps inside the path, and the join names no file") == 1, output
    assert code == 1
    _assert_corpus_restored()


def test_a_family_the_fork_states_keeps_its_citations_checked() -> None:
    """A family read off this tree alone drops every citation of one the branch retires (PRE-4).

    The fork's own copy of the standard is what leaves the id recognisable, so the citation fails
    rather than passing unread.
    """
    _reset()
    _drop(STANDARD, FORK_ONLY_RULE)
    _append(NOTES, "A claim citing " + RETIRED_ID + ".")
    try:
        code, reported = _run()
    finally:
        _reset()
    assert reported == Counter({("fail", "rule-id", NOTES): 1}), "a retired family: " + _shape(reported)
    assert code == 1
    _assert_corpus_restored()


def test_a_dead_citation_and_another_spelling_of_one_are_told_apart_by_whole_segments() -> None:
    """The basename alone calls a dead `notes.md` another spelling of the two pages the tree holds.

    Both arms in one run: each is a `citation` finding about one page, so only the words part them.
    """
    _reset()
    _append(NOTES, "`" + SHARED_BASENAME + " :: symbol` names nothing.")
    _append(NOTES, "`" + OTHER_SPELLING + " :: symbol` is spelled from a root no resolver reaches.")
    try:
        code, output = _output()
    finally:
        _reset()
    assert _reported(output) == Counter({("fail", "citation", NOTES): 2}), "the two arms: " + _shape(_reported(output))
    assert "names no file in the repository, under any spelling: " + SHARED_BASENAME in output, output
    assert "is neither repository-relative nor package-relative: " + OTHER_SPELLING in output, output
    assert code == 1
    _assert_corpus_restored()


def test_a_registered_claim_names_a_missing_file_and_a_missing_anchor_apart() -> None:
    """Both arms of a registry row's contract: no file of that name, and a file the anchor is not in.

    One check and one file either way, so the counted triples cannot tell which arm answered.
    """
    _reset()
    _plant_enforced_by()
    try:
        code, output = _output()
    finally:
        _undo_enforced_by()
        _reset()
    assert "`echo` claims `docs/gone.md :: I1`, which names no file" in output, output
    assert "`anchor` claims `" + NOTES + " :: " + ABSENT_ANCHOR + "`, which does not resolve" in output, output
    assert code == 1
    _assert_corpus_restored()


def test_a_registered_claim_is_not_proved_by_the_registry_row_that_makes_it() -> None:
    """A row spells its contract inside a string, so no line of the file spells the citation.

    Read from the words: this claim draws one finding about the registry however it resolves.
    """
    _reset()
    kernel = _module("docs_gate.kernel")
    row = kernel.CHECKS[SELF_CLAIMED_CHECK]
    kernel.CHECKS[SELF_CLAIMED_CHECK] = kernel.Check(row.severities, kernel.claimed(KERNEL + " :: " + SELF_CLAIMED_CHECK))
    try:
        _, output = _output()
    finally:
        kernel.CHECKS[SELF_CLAIMED_CHECK] = row
        _reset()
    assert "anchor '" + SELF_CLAIMED_CHECK + "' is spelled in " + KERNEL + " only by a citation of it" in output, output
    _assert_corpus_restored()


def test_a_rule_line_is_never_paired_with_another_rule_s_block() -> None:
    """One pattern with both groups, never two listings zipped by position (PRE-4).

    The middle line opens on a bullet the block reader cannot end on, so pairing by position hands
    one id the field of the rule below it.
    """
    _reset()
    checks = _module("docs_gate.checks")
    _clear_caches(_gate().root / SCRIPTS_COPY)
    paired = checks._rule_lines(SWALLOWING_STANDARD)
    assert [rule_id for rule_id, _ in paired] == ["COR-1", "COR-13"], paired
    assert "second" in paired[0][1], paired
    assert "third" in paired[1][1], paired


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
