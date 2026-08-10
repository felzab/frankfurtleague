"""
SCRIPTS · the documentation gate

Run by verify.sh. It is the mechanical half of the documentation standard's currency rules: the
other defences depend on someone remembering, and this one does not. The check list, with what
each failure means, lives in docs/_standard/chapters/5-currency.md (CUR-5) — the one place it is
written, so it is deliberately not restated here.

Invariants:
- Fenced code blocks are stripped first; placeholder text (< > { } * ? … or NNNN) is skipped.
- Comments are scanned exactly like documentation, never the code around them — a source file's
  by INC-6, an ops file's by COR-6, which binds every written artifact. Python and JSON are parsed;
  TypeScript and the `#` formats read a line, so there a marker in a literal keeps its line.
- Some checks read the branch rather than the tree: stamp freshness, branch impact (CUR-4),
  history phrases, counts, and the comment-length bound.
- Material means more than comments, decided by `check_scope.is_comment_only` — one classifier, two gates.
- Every check name and the severities it may emit are declared in `CHECKS`, which `Finding` refuses
  to depart from and which CUR-5's table is held to.
"""

from __future__ import annotations

import argparse
import io
import os
import re
import subprocess
import sys
import tokenize
from dataclasses import dataclass
from functools import cache
from pathlib import Path, PurePosixPath
from typing import Final, Iterable, Literal

import check_pr_body
import check_scope

REPO_ROOT: Final = Path(__file__).resolve().parent.parent

# Excluded: docs/audit, the gitignored working documents of a running audit programme, absent from
# any clone; node_modules and .venv, vendored and not ours to hold to this standard.
SKIP_DIRS: Final[tuple[str, ...]] = ("docs/audit", "node_modules", ".venv")

# A template is a page in a templates/ directory, or one whose name ends -template.md.
TEMPLATE_MARKERS: Final[tuple[str, ...]] = ("/templates/", "-template.md")
# Exempt only what resolves from where the template is COPIED to: a placeholder stamp, paths
# belonging to the destination, a relative link naming the copy's sibling. ADR numbers, rule ids
# and citations are the template's own and are checked.
TEMPLATE_EXEMPT_CHECKS: Final[frozenset[str]] = frozenset({"stamp-format", "path", "link"})

# The comment-bearing source suffixes the gate scans (INC-6).
SOURCE_SUFFIXES: Final[tuple[str, ...]] = (".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".sh")
# What the C-style line reader takes: JavaScript shares TypeScript's syntax exactly. JSON is NOT
# here — it is scanned rather than read a line at a time, for the reason `_jsonc_comments` gives.
CSTYLE_SUFFIXES: Final[tuple[str, ...]] = (".ts", ".tsx", ".js", ".mjs", ".cjs")

# The ops and configuration files, whose comments COR-6 binds as it binds a spec sheet's prose,
# although chapter 2's Applies-to does not reach them.
OPS_SUFFIXES: Final[tuple[str, ...]] = (".conf", ".yml", ".yaml", ".toml", ".json")
# Spelled in full: a Dockerfile carries no suffix for a pattern to match on.
OPS_FILENAMES: Final[tuple[str, ...]] = ("Dockerfile",)
SCANNED_SUFFIXES: Final[tuple[str, ...]] = SOURCE_SUFFIXES + OPS_SUFFIXES

# Top-level directories a backticked path must start with to be treated as a repo path. Anything else
# in backticks is prose -- a bare `queries.ts` names a KIND of file, not one file.
REPO_PREFIXES: Final[tuple[str, ...]] = (
    "fl_frontend/",
    "fl_backend/",
    "docs/",
    "scripts/",
    "nginx/",
    ".claude/",
    ".github/",
    ".githooks/",
)

# The package roots an unprefixed path is written against, so `src/app/admin/admin.css` resolves to
# the file it names. Reading one as prose is what let a stamped page cite a file without arming
# branch-impact against it.
PACKAGE_ROOTS: Final[tuple[str, ...]] = ("fl_frontend/", "fl_backend/")

# A repository path in a comment with no backticks, which is how a dead one survives a green gate:
# `path` reads backticked tokens alone. Anchored on REPO_PREFIXES so prose cannot match, and ended
# on a word character so trailing punctuation stays out.
BARE_PATH_RE: Final = re.compile(r"(?<![\w`/.\-])(?:" + "|".join(re.escape(p) for p in REPO_PREFIXES) + r")[\w./\-]*[\w/]")
BACKTICK_SPAN_RE: Final = re.compile(r"`[^`\n]*`")

# COR-3's banned shapes. Reported, never failed: "the former ... the latter" is ordinary English, so
# every hit has to be read by a person.
HISTORY_PHRASES: Final[tuple[str, ...]] = (
    "used to",
    "was removed",
    "was renamed",
    "previously",
    "moved here",
    "formerly",
    "former ",
    "no longer",
    "any more",
)
HISTORY_RE: Final = re.compile("|".join(re.escape(phrase) for phrase in HISTORY_PHRASES), re.IGNORECASE)

FENCE_RE: Final = re.compile(r"^\s*(```|~~~)")
# Every ATX heading, wherever CommonMark lets one sit, with the closing run of hashes dropped as a
# renderer drops it. Read through `atx_heading`, so one definition decides what counts as a heading.
ATX_HEADING_RE: Final = re.compile(r"^ {0,3}(#{1,6}) +(.*?)(?:[ \t]+#+)?[ \t]*$")
HUNK_HEADER_RE: Final = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")
ADR_RE: Final = re.compile(r"\bADR-(\d{4})\b")
# The fragment is captured rather than discarded: dropping it is what let a link to a heading that
# no longer exists pass, since the file it names is still there. A title is CommonMark's; an empty
# target is an in-page link.
LINK_RE: Final = re.compile(r"""(?<!!)\[[^\]]*\]\(([^)\s#]*)(#[^)\s]*)?(?:[ \t]+"[^"\n]*"|[ \t]+'[^'\n]*')?\)""")
# What GitHub's slugger keeps of a heading: a link renders as its text alone, and anything that is
# not a word character, a space or a hyphen is dropped. An underscore and a letter outside ASCII
# are word characters and survive.
INLINE_LINK_RE: Final = re.compile(r"\[([^\]]*)\]\([^)]*\)")
SLUG_DROP_RE: Final = re.compile(r"[^\w\- ]")
# A citation is a single backticked run containing exactly one " :: ". The separator is what marks it
# as checkable rather than prose (COR-6).
CITATION_RE: Final = re.compile(r"`([^`\n]+? :: [^`\n]+?)`")
BACKTICK_RE: Final = re.compile(r"`([^`\n]+?)`")
STAMP_RE: Final = re.compile(r"\*\*Verified against:\*\*\s*`([0-9a-f]{7,40})`")
STAMP_LINE_RE: Final = re.compile(r"(?m)^.*\*\*Verified against:\*\*.*$")
# CUR-3's exact stamp shape, plus COR-8's optional trailing hard break. Anything that starts like
# a stamp and is not this fails stamp-format; a looser line would still be found by STAMP_RE-based
# checks, so the two stay in step.
STRICT_STAMP_RE: Final = re.compile(r"\*\*Verified against:\*\* `[0-9a-f]{7,40}`, \d{4}-\d{2}-\d{2}\\?")
# Indentation is tolerated here and refused by the shape above: STAMP_RE reads an indented line as
# the page's stamp, so the format check has to be shown the same line.
STAMP_START_RE: Final = re.compile(r"^[ \t]*\*\*Verified against")
STAMP_LINE_NUMBER: Final = 3
# The part of CUR-3's criterion a path decides: each kind here is a current-state claim by the rule
# that shapes it. Which other pages make such a claim is a judgment about content, and stays one.
STAMP_REQUIRED_GLOBS: Final[tuple[str, ...]] = (
    "docs/*/spec.md",
    "docs/*/overview.md",
    "docs/glossary.md",
    "docs/_standard/chapters/*.md",
)
# A metadata line: a bold label opening a line -- what a stamp, a Scope line and an entry's fields
# all share. The label is bounded because a bold sentence ending in a colon is prose, and holding
# prose to a layout rule gets a check ignored.
METADATA_LINE_RE: Final = re.compile(r"^\*\*([A-Z][A-Za-z ]{0,30}):\*\*(?:\s|$)")
# COR-8's break is a line ending; written as the characters `\` and `n` it leaves two entries on one
# physical line. Each half then reads well formed — the first needs no break, and the second's `**`
# reads to the stamp check as a wildcard.
METADATA_JOIN_RE: Final = re.compile(r"\\n\s*\*\*([A-Z][A-Za-z ]{0,30}):\*\*")

# A rule id resolves to a rule heading in the standard's chapters or it dangles. Two segments and a
# short number, so the backend's three-segment error codes (REQ-VAL-001) can never collide.
RULE_ID_RE: Final = re.compile(r"\b((?:PRE|COR|INC|OUT|DEC|CUR)-\d{1,2})\b")
CHAPTERS_DIR: Final = REPO_ROOT / "docs" / "_standard" / "chapters"
RULES_INDEX: Final = REPO_ROOT / "docs" / "_standard" / "rules-index.md"
# PRE-4's anatomy: the heading opens on the id and states the rule as a claim, the fixed fields
# follow in this order, and the id takes a row in its chapter's table and a line in the index.
RULE_HEAD_RE: Final = re.compile(r"^((?:PRE|COR|INC|OUT|DEC|CUR)-\d{1,2})\b(.*)$")
RULE_CLAIM_RE: Final = re.compile(r"^\s+—\s+\S")
RULE_FIELDS: Final[tuple[str, ...]] = ("Rule", "Why", "Exceptions", "Enforced by", "Example")
RULE_FIELD_RE: Final = re.compile(r"^[ \t]*\*\*([A-Z][A-Za-z ]{0,30}):\*\*", re.MULTILINE)
CHAPTER_ROW_RE: Final = re.compile(r"^[ \t]*\|\s*((?:PRE|COR|INC|OUT|DEC|CUR)-\d{1,2})\s*\|", re.MULTILINE)
RULE_INDEX_LINE_RE: Final = re.compile(r"^[ \t]*[-*]\s+\*\*((?:PRE|COR|INC|OUT|DEC|CUR)-\d{1,2}):\*\*", re.MULTILINE)

# CUR-5's table, the one place the checks are listed, and the `Enforced by` field each rule ends on.
# PRE-4 closes that field's vocabulary, so a bare backticked lower-case token in it names a check.
CURRENCY_CHAPTER: Final = CHAPTERS_DIR / "5-currency.md"
CHECK_ROW_RE: Final = re.compile(r"^[ \t]*\|\s*`([a-z][a-z-]*)`\s*\|.*\|\s*(Fail|Report)\s*\|\s*$", re.MULTILINE)
ENFORCED_BY_RE: Final = re.compile(r"^[ \t]*\*\*Enforced by:\*\*(.*?)(?=\n[ \t]*\n|\Z)", re.MULTILINE | re.DOTALL)
CHECK_NAME_RE: Final = re.compile(r"`([a-z][a-z0-9-]*)`")

# The pull request form, and the fragments `check_pr_body.py :: TEMPLATE_FRAGMENTS` quotes from it
# to refuse a body submitted unfilled. Reword one in the form and that refusal stops firing
# silently, which is the failure a served copy always has.
GIT_TEMPLATES: Final = REPO_ROOT / "docs" / "_git" / "templates.md"

# Read from the command file, never copied here: a copy is a second partition, agreeing with the
# first only until one of them is edited.
SWEEP_COMMAND: Final = REPO_ROOT / ".claude" / "commands" / "docs" / "audit.md"
SEGMENT_HEADER_RE: Final = re.compile(r"^[ \t]*\|\s*Segment\s*\|\s*Globs\s*\|", re.MULTILINE)
EXCLUDED_HEADER_RE: Final = re.compile(r"^[ \t]*\|\s*Excluded\s*\|\s*Why\s*\|", re.MULTILINE)
# How many offending paths a finding names before it counts the rest: a folder moved wholesale
# unclaims every file under it, and a finding that prints hundreds of them is one nobody reads.
SEGMENT_SAMPLE: Final = 8

# A short commit SHA named in prose, at git's abbreviation length and carrying a digit and a
# letter. A longer hex run is an asset digest -- ADR-0017 tables those, and reading one as a commit
# gets a check switched off.
PROSE_SHA_RE: Final = re.compile(r"`([0-9a-f]{7,8})`")

# What another check reads. `Path.glob` on a missing directory yields nothing, so an absent input
# degrades the check reading it to silence with the run green -- these are named here so the
# absence itself fails.
REQUIRED_INPUTS: Final[tuple[str, ...]] = (
    "docs/_standard/chapters",
    "docs/_standard/rules-index.md",
    "docs/_decisions",
    "docs/_roadmap/open-items.md",
    "docs/_git/templates.md",
    "docs/glossary.md",
    ".claude/commands/docs/audit.md",
)

# `git ls-files --eol` answers every question this needs in one call: the working tree's endings,
# the attributes in force, and git's own text/binary verdict.
LS_FILES_EOL_RE: Final = re.compile(r"^i/(\S+)\s+w/(\S+)\s+attr/(.*?)\s*\t(.*)$")
# The working-tree verdicts that are not LF. Binary reads as `-text` and never appears here, which
# is the classification a PNG needs: it holds CR-LF byte pairs legitimately.
NON_LF_WORKTREE: Final[tuple[str, ...]] = ("crlf", "mixed")
# What `.gitattributes` gives `*.bat` and `*.cmd`, and the only thing that exempts a file.
CRLF_MANDATED: Final = "eol=crlf"

# OUT-4's spine. The closing sections are fixed so that a contract growing cannot push Invariants
# down and silently repoint every citation of section 3, which is also what makes an invariant
# number safe to cite from a comment.
SPEC_SECTIONS: Final[tuple[str, ...]] = ("1. Contract", "2. Invariants", "3. Violation → remedy", "4. Known-open")
SPEC_SUBSECTION_RE: Final = re.compile(r"^1\.(\d+)\b")
SPEC_COLUMNS: Final = 4
# An invariant's id, in the first cell of its row and wherever a sheet cites one. `L` is the logging
# sheet's prefix and `I` every other sheet's; a citation crosses surfaces often enough that an id is
# resolved against all of them.
INVARIANT_ID_RE: Final = re.compile(r"^[ \t]*\|\s*([IL]\d{1,3}[a-z]?)\s*\|", re.MULTILINE)
INVARIANT_REF_RE: Final = re.compile(r"(?<![A-Za-z0-9])([IL]\d{1,3}[a-z]?)(?![A-Za-z0-9])")
# A `Breaks how` cell that only points elsewhere states no failure mode, which is the column's whole
# job. Bounded to a cell with no sentence in it, so a real explanation opening "See the runbook, and
# the request then 500s" is left alone.
CROSS_REFERENCE_RE: Final = re.compile(r"^(?:see|as|per)\b[^.]*$", re.IGNORECASE)

# OUT-5's spine: an overview says how the surface is organised and hands the reader on.
OVERVIEW_OPENING: Final = "How it is organised"
OVERVIEW_CLOSING: Final = "Read next"

# OUT-6's entry: one or more backticked terms, a gloss, then four fields in a fixed order. Several
# terms share one entry where the code and the domain spell the same thing differently, so the head
# allows a `/` or a `·` between them.
GLOSSARY: Final = REPO_ROOT / "docs" / "glossary.md"
GLOSSARY_HEAD_RE: Final = re.compile(r"^`[^`]+`(?:\s*[/·]\s*`[^`]+`)*\s+—\s+\S.*$")
GLOSSARY_FIELD_RE: Final = re.compile(r"^[ \t]*\*\*([A-Za-z][A-Za-z ]*):\*\*", re.MULTILINE)
GLOSSARY_FIELDS: Final[tuple[str, ...]] = ("Is", "In code", "Trap", "See")

# A `See:` entry names one file and a reason, separated by a dash. Only a token carrying a suffix is
# resolved, so a bare folder in the reason half is not read as a dead path.
SEE_ENTRY_RE: Final = re.compile(r"\s+[—-]\s+")
SUFFIXED_RE: Final = re.compile(r"\.[A-Za-z]{1,5}$")

# A spec sheet's invariant ids: the first cell of an invariant row, and a citation of one anywhere
# else. The surface words are what disambiguates a citation of an id two sheets both define.
INVARIANT_ROW_RE: Final = re.compile(r"^[ \t]*\|\s*(I\d{1,3}[a-z]?)\s*\|", re.MULTILINE)
INVARIANT_CITE_RE: Final = re.compile(r"(?<![A-Za-z0-9])(I\d{1,3}[a-z]?)(?![A-Za-z0-9])")
SURFACE_WORDS: Final = re.compile(r"\b(backend|frontend|ops|logging|_git)\b|spec\.md", re.IGNORECASE)

# COR-6 bans a line-number citation, and nothing but its form detects one. Closed to the TEXT
# suffixes this repository holds, so `example.com:443` stays prose; one added to the tree and not
# here escapes both patterns silently.
CITABLE_SUFFIXES: Final[tuple[str, ...]] = (".md", ".css", ".svg", ".lock", *SCANNED_SUFFIXES)
# Longest first, so the alternation cannot stop at `.ts` inside `.tsx` and leave the colon unmatched.
_CITABLE_SUFFIX_RE: Final = "|".join(re.escape(suffix) for suffix in sorted(set(CITABLE_SUFFIXES), key=len, reverse=True))
LINE_CITATION_RE: Final = re.compile(rf"`([^`\n]*(?:{_CITABLE_SUFFIX_RE}):\d+(?:-\d+)?)`")
# The same citation with no backticks, which is how a comment usually carries one. The directory run
# sits inside the capture: the guard rejects a start after `/` or `.`, which holds a URL out and
# would hold a path out with it.
BARE_LINE_CITATION_RE: Final = re.compile(rf"(?<![/`\w.])((?:[\w.-]+/)*[\w.-]*[\w-](?:{_CITABLE_SUFFIX_RE}):\d+(?:-\d+)?)\b")

# INC-6's banned comment citations. An audit id and a ledger row fail: both name a document
# `/audit:finish` deletes. A roadmap id and a review round are reported -- the id resolves, and
# the round may be a sentence.
AUDIT_ID_RE: Final = re.compile(r"\b(?:audit\s+)?R\d+[a-z]?\s*§\s*S\d+(?:\.\d+)?|§\s*S\d+(?:\.\d+)?")
LEDGER_ROW_RE: Final = re.compile(r"\bledger\s+\S*\d")
REVIEW_REF_RE: Final = re.compile(
    r"\b(?:this|last|previous|earlier)\s+session\b"
    r"|\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\s+(?:review|sweep|session)\b",
    re.IGNORECASE,
)
ROADMAP_ID_DEF_RE: Final = re.compile(r"^[ \t]*\|\s*(?:\d+\s*\|\s*)?\*{0,2}([A-Z]{1,4}-\d{1,3})\*{0,2}\s*\|", re.MULTILINE)

# The ranked roadmap: an entry heading, an index row, and the status an entry states.
ROADMAP_OPEN_ITEMS: Final = "docs/_roadmap/open-items.md"
# The id is captured loose, so a malformed one is caught against the vocabulary rather than skipped.
ROADMAP_ENTRY_RE: Final = re.compile(r"^ {0,3}###\s+(\d+)\s+·\s+(\S+)\s+—", re.MULTILINE)
# An index row must carry an id in its second cell, which separates it from the page's other
# numeric tables -- a row reading `| 4 | 6 | walks |` counts fixtures, not entries.
ROADMAP_INDEX_ROW_RE: Final = re.compile(r"^[ \t]*\|\s*(\d+)\s*\|\s*([A-Z]{1,4}-\d{1,3})\s*\|(.*)$", re.MULTILINE)
ROADMAP_STATUS_RE: Final = re.compile(r"^[ \t]*\*\*Status:\*\*\s*(.+?)\s*\\?$", re.MULTILINE)
# Closed exists for exactly one commit -- the one concluding an entry, whose successor deletes it.
ROADMAP_TRANSIENT_STATUS: Final = "Closed"

# COR-11's banned phrase. A quoted or backticked mention -- naming the phrase to ban it, as the rule
# itself does -- is a mention rather than a use, so those spans come out before the search.
OWNER_PHRASE_RE: Final = re.compile(r"\bthe owner\b", re.IGNORECASE)
QUOTED_SPAN_RE: Final = re.compile(r"\"[^\"\n]*\"|`[^`\n]*`|“[^”\n]*”")
OWNER_EXEMPT_PREFIX: Final = ".claude/"

# COR-4's enumerations, over a branch's added prose and comments. Reported, never failed: "the four
# admin tables" and "four bytes" are the same word. `one` and `first` are left out: neither carries
# a member count in the phrasings that occur.
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

# INC-9's bounds, both holding at once: three long lines and one very long line are the same
# comment with its line breaks moved. Measured 2026-08-09 over 1,569 blocks: mean 212 characters.
COMMENT_LINE_CAP: Final = 3
COMMENT_CHAR_CAP: Final = 250
# A README is orientation (OUT-3), and the cap is what makes a second body section visible.
README_LINE_CAP: Final = 120

# INC-2's header shapes, checked only where that rule binds (its Applies-to subtrees, by suffix).
# Presence is never checked: INC-2 fixes the shape of a header that exists, so a file opening with
# `//` line comments, or with none, passes unchecked.
HEADER_SCOPES: Final[tuple[tuple[str, tuple[str, ...]], ...]] = (
    ("fl_frontend/src/", (".ts", ".tsx")),
    ("fl_backend/app/", (".py",)),
    ("fl_backend/tests/", (".py",)),
    ("scripts/", (".py", ".sh")),
)
HEADER_CAP: Final = 20
# The subtrees chapter 2 binds, which is where its comment rules are checked.
INCODE_SCOPES: Final[tuple[str, ...]] = ("fl_frontend/src/", "fl_backend/app/", "fl_backend/tests/", "scripts/", ".claude/hooks/")
# A directive stays above the header (INC-7), so the header scan steps over it.
DIRECTIVE_RE: Final = re.compile(r"^\s*([\"'])use (client|server|strict)\1;?\s*$")
PY_DOCSTRING_OPEN_RE: Final = re.compile(r"^[rRuU]?(\"\"\"|''')")
# The title separator is U+00B7; INC-2 bans ruled lines and shouty label rows. A label line is one
# or two capitalised words ending in a colon: anything longer is wrapped prose, and flagging prose
# is the false positive that gets a check switched off.
HEADER_TITLE_RE: Final = re.compile(r"\S+ · \S.*")
HEADER_RULED_RE: Final = re.compile(r"─{3,}|-{8,}")
HEADER_SHOUTY_RE: Final = re.compile(r"[A-Z][A-Z ']{3,}")
HEADER_LABEL_RE: Final = re.compile(r"[A-Z][A-Za-z]*( [A-Za-z]+)?:")
HEADER_LABELS: Final[tuple[str, ...]] = ("Invariants:", "See:")

# The ADR anatomy DEC-2 fixes, in order. adr-meta checks the shape; the reasoning lives in the rule.
ADR_META_ORDER: Final[tuple[str, ...]] = ("Status", "Date", "Surface", "Supersedes", "Superseded by", "Source")
ADR_META_RE: Final = re.compile(r"^[ \t]*\*\*(Status|Date|Surface|Supersedes|Superseded by|Source):\*\*\s*(.*)$")
ADR_STATUS_RE: Final = re.compile(r"Accepted|Proposed|Deprecated|Superseded by ADR-\d{4}")
ADR_H2S: Final[tuple[str, ...]] = ("Context", "Decision", "Consequences", "Alternatives considered")
# An ADR's number, taken from its filename, and the shapes its metadata may hold besides `—`.
ADR_FILE_RE: Final = re.compile(r"^(\d{4})-")
ADR_REFERENCE_RE: Final = re.compile(r"ADR-(\d{4})")
ISO_DATE_RE: Final = re.compile(r"\d{4}-\d{2}-\d{2}")
ADR_INDEX_ROW_RE: Final = re.compile(r"^[ \t]*\|\s*\[(\d{4})\]\(([^)]+)\)", re.MULTILINE)
# A hyphenated id shaped like the roadmap's, resolved against the tables rather than trusted.
LOOSE_ID_RE: Final = re.compile(r"\b[A-Z]{1,4}-\d{1,3}\b")

Severity = Literal["fail", "report"]

# Every check this script emits, against the severities it emits it at. `check-registry` holds
# CUR-5's table to this mapping and `Finding` refuses a name absent from it, so a check cannot
# reach a run before its row in that table exists.
CHECKS: Final[dict[str, frozenset[Severity]]] = {
    "adr": frozenset({"fail"}),
    "adr-index": frozenset({"fail"}),
    "adr-meta": frozenset({"fail"}),
    "anchor": frozenset({"fail"}),
    "bare-path": frozenset({"fail"}),
    "branch-impact": frozenset({"fail"}),
    "branch-scope": frozenset({"report"}),
    "check-registry": frozenset({"fail"}),
    "citation": frozenset({"fail"}),
    "comment-citation": frozenset({"fail", "report"}),
    "comment-length": frozenset({"fail"}),
    "counts": frozenset({"report"}),
    "enforced-by": frozenset({"fail"}),
    "glossary-entry": frozenset({"fail"}),
    "header-see": frozenset({"fail"}),
    "history": frozenset({"report"}),
    "inputs": frozenset({"fail"}),
    "invariant-id": frozenset({"fail"}),
    "invariant-row": frozenset({"fail"}),
    "line-citation": frozenset({"fail"}),
    "line-endings": frozenset({"fail"}),
    "link": frozenset({"fail"}),
    "metadata-break": frozenset({"fail"}),
    "module-header": frozenset({"fail"}),
    "overview-spine": frozenset({"fail"}),
    "owner-voice": frozenset({"fail"}),
    "path": frozenset({"fail"}),
    "readme-cap": frozenset({"fail"}),
    "roadmap-shape": frozenset({"fail"}),
    "rule-id": frozenset({"fail"}),
    "rule-index": frozenset({"fail"}),
    "rule-shape": frozenset({"fail"}),
    "segment-map": frozenset({"fail"}),
    "sha": frozenset({"report"}),
    "spec-spine": frozenset({"fail"}),
    "stamp": frozenset({"fail", "report"}),
    "stamp-format": frozenset({"fail"}),
    "stamp-missing": frozenset({"fail"}),
    "template-fragment": frozenset({"fail"}),
    "unreadable": frozenset({"fail"}),
}


@dataclass(frozen=True, slots=True)
class Finding:
    """One problem, already resolved to whether it fails the run."""

    severity: Severity
    check: str
    file: str
    detail: str

    def __post_init__(self) -> None:
        # Raised rather than reported: an unregistered name is a programming error, and letting one
        # through is exactly how the registry would fall behind the code it claims to describe.
        if self.severity not in CHECKS.get(self.check, frozenset()):
            raise ValueError(f"check `{self.check}` is not registered in CHECKS at severity `{self.severity}`")

    def line(self) -> str:
        # Six spaces: the message column of the scripts' shared output standard (scripts/_lib.sh),
        # so findings read as `detail` lines under the gate's step heading.
        return f"      {self.file}: {self.detail}  [{self.check}]"


def is_placeholder(text: str) -> bool:
    """Template scaffolding, not a reference. `<sha>`, `ADR-NNNN`, `app/api/*/router.py`."""
    return bool(set("<>{}*?") & set(text)) or "NNNN" in text or "…" in text


def strip_fences(text: str) -> str:
    """Blank out fenced blocks, preserving line count so reported context stays meaningful."""
    out: list[str] = []
    in_fence = False
    for raw in text.split("\n"):
        if FENCE_RE.match(raw):
            in_fence = not in_fence
            out.append("")
            continue
        out.append("" if in_fence else raw)
    return "\n".join(out)


def git(*args: str) -> str | None:
    """Run git and return stdout, or None if the command failed. Never raises.

    UTF-8 is forced rather than left to the platform default: `git show` returns file CONTENT, and
    on a Windows codepage that decode raises on the first em dash. Reading a document through git is
    the only way to compare it against its state on another ref, so this has to be safe for prose.
    """
    try:
        done = subprocess.run(
            ("git", *args),
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except OSError:
        return None
    # Only the trailing newline comes off. `strip` would also eat a leading space, and the first
    # path of a `ls-files -z` listing is the one place a leading space is data rather than layout.
    return done.stdout.rstrip() if done.returncode == 0 else None


def git_status(*args: str) -> int | None:
    """Run git for its exit code alone, or None where it could not be launched. Never raises.

    Every caller reads the code as a yes or a no, so None -- git absent, not a repository -- has to
    answer neither, and each caller resolves it in the direction that keeps a finding rather than
    dropping one.
    """
    try:
        return subprocess.run(("git", *args), cwd=REPO_ROOT, capture_output=True, check=False).returncode
    except OSError:
        return None


@cache
def _read_text(path: Path) -> tuple[str | None, str]:
    """One file's text, read once per run, with the message where it could not be read.

    The single reader: several checks read the same file, and a per-check `read_text` both spends
    the read again and gives each site its own way of handling a failure.
    """
    try:
        return path.read_text(encoding="utf-8"), ""
    except (OSError, UnicodeDecodeError) as exc:
        return None, str(exc)


@cache
def _tree_index() -> dict[str, tuple[Path, ...]]:
    """Every tracked file, indexed by name, sorted, with the skipped directories pruned.

    Tracked rather than walked, because a clean clone is the referee: a build directory, a cache or
    a worktree nested inside the tree makes a bare-filename lookup ambiguous on the machine holding
    it and unique everywhere else. This is one of the two filters a bare name passes; `_resolve`
    applies them, and CUR-5 states what they add up to.

    `normcase` keys it, so a lookup matches exactly what the filesystem itself would match. The
    listing is NUL-separated: git quotes and escapes a path outside ASCII in its default output.
    """
    listing = git("ls-files", "-z")
    if listing is None:
        return _walked_index()
    index: dict[str, list[Path]] = {}
    for entry in listing.split("\0"):
        if not entry:
            continue
        path = REPO_ROOT / entry
        if not _skipped(path):
            index.setdefault(os.path.normcase(path.name), []).append(path)
    return {name: tuple(sorted(paths)) for name, paths in index.items()}


def _walked_index() -> dict[str, tuple[Path, ...]]:
    """The same index where git could not answer it, pruned as close to git's answer as a walk gets.

    The control directory goes by name: it holds no citable file, and check-ignore does not call it
    ignored. Everything else git would exclude needs git, so a tree it cannot read at all keeps its
    generated files here -- asked once rather than per directory, which would cost two spawns each.
    """
    ignorable = git_status("rev-parse", "--is-inside-work-tree") == 0
    index: dict[str, list[Path]] = {}
    for root, directories, names in os.walk(REPO_ROOT):
        parent = Path(root)
        kept = [name for name in directories if name != ".git" and not _skipped(parent / name)]
        if ignorable:
            kept = [name for name in kept if not is_gitignored((parent / name).relative_to(REPO_ROOT).as_posix())]
        directories[:] = kept
        for name in names:
            index.setdefault(os.path.normcase(name), []).append(parent / name)
    return {name: tuple(sorted(paths)) for name, paths in index.items()}


def _skipped(path: Path) -> bool:
    """True for anything under a SKIP_DIRS entry at any depth.

    A SKIP_DIRS entry may be a full prefix (`docs/audit`) or a single segment (`node_modules`), and
    the latter has to match at any depth -- `fl_frontend/node_modules/...` is what actually occurs.
    """
    rel = path.relative_to(REPO_ROOT).as_posix()
    segments = rel.split("/")
    return any(rel == d or rel.startswith(f"{d}/") or ("/" not in d and d in segments) for d in SKIP_DIRS)


def _is_template(path: Path) -> bool:
    """A copy-from page: checked, but not for the two things that only resolve after it is copied."""
    return any(marker in f"/{path.relative_to(REPO_ROOT).as_posix()}" for marker in TEMPLATE_MARKERS)


def _shell_comments(text: str) -> str:
    """Shell comments only, line count preserved.

    Narrower than the `#` rule the Python branch can afford, because shell reaches for `#` in
    expansions (`${name#prefix}`, `$#`) and in colour escapes, and a claim is never made from
    inside one. A `#` opening a line, or one after whitespace, is the only shape kept -- a shebang
    is neither documentation nor a claim, so it drops out with the rest.

    Line-grain, and the surface that leaves is a quoted value carrying ` #`: `other: "a # b"` in a
    `.conf`, `.toml` or `.yaml` file keeps ` # b"`. Exact scanning would need a parser per format,
    where the shapes those three actually hold are a comment on its own line or after a value.
    """
    keep: list[str] = []
    for line in text.split("\n"):
        stripped = line.lstrip()
        if stripped.startswith("#") and not stripped.startswith("#!"):
            keep.append(line)
            continue
        marker = line.find(" #")
        keep.append(line[marker:] if marker != -1 else "")
    return "\n".join(keep)


def _marker_lines(text: str) -> str:
    """Every line carrying a `#` or a triple quote, blocks tracked across lines, line count kept.

    Wider than a comment on purpose: it is what the Python reader falls back to on source the
    tokenizer refuses, and a file that does not parse still holds comments a reader reads. Reading
    none of them would be indistinguishable from reading a file with none.
    """
    triple_double = '"""'
    triple_single = "'''"
    keep: list[str] = []
    in_block = False
    for line in text.split("\n"):
        quotes = line.count(triple_double) + line.count(triple_single)
        if in_block:
            keep.append(line)
            if quotes % 2 == 1:
                in_block = False
            continue
        stripped = line.lstrip()
        if stripped.startswith((triple_double, triple_single)) and quotes % 2 == 1:
            in_block = True
            keep.append(line)
        else:
            keep.append(line if ("#" in line or quotes) else "")
    return "\n".join(keep)


def _place(buffer: list[str], start: tuple[int, int], text: str) -> None:
    """One token's text back at the line and column it occupies in the file it came from.

    The column is held because every finding quotes its line and several report a number, so a
    token moved to column zero would report a page the reader cannot find by looking.
    """
    row, column = start
    for offset, piece in enumerate(text.split("\n")):
        line = buffer[row - 1 + offset]
        buffer[row - 1 + offset] = (line.ljust(column) if offset == 0 else line) + piece


def _python_comments(text: str) -> str:
    """Python comments and docstrings, at their own lines and columns, with everything else blank.

    Tokenized rather than scanned for a marker: a `#` inside a string literal opens no comment, and
    the code line holding one is not a claim made to a reader. A docstring stays — INC-4 makes it
    documentation, and this gate's own citations are written in one — and it is a string standing
    alone as a whole statement, which is what tells it apart from a string the program uses.

    Three docstring shapes fall outside that test and are not scanned: one sharing its line with the
    `def` that owns it, one after a semicolon, and two adjacent strings relying on implicit
    concatenation, which arrive as two tokens and satisfy the test neither singly nor together. No
    tracked file writes any of them; a file that did would lose its docstring from the scan silently.
    """
    lines = text.split("\n")
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))
    except tokenize.TokenError, SyntaxError, ValueError:
        return _marker_lines(text)

    # A comment and a blank line can sit anywhere without ending a statement, so both come out
    # before a string's neighbours are read; what remains around one is the statement it sits in.
    structural = [token for token in tokens if token.type not in (tokenize.COMMENT, tokenize.NL)]
    docstrings: set[tuple[int, int]] = set()
    for index, token in enumerate(structural):
        opens = index == 0 or structural[index - 1].type in (tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT)
        closes = index + 1 < len(structural) and structural[index + 1].type == tokenize.NEWLINE
        if token.type == tokenize.STRING and opens and closes:
            docstrings.add(token.start)

    keep = [""] * len(lines)
    for token in tokens:
        if token.type == tokenize.COMMENT or (token.type == tokenize.STRING and token.start in docstrings):
            _place(keep, token.start, token.string)
    return "\n".join(keep)


def _jsonc_comments(text: str) -> str:
    """JSONC comments only, line count and column preserved.

    Scanned character by character rather than by line, because JSON configuration is written in
    globs and URLs and both carry a marker INSIDE a string value: read by line, `"Read(./certs/**)"`
    opens a block comment that runs until whatever value happens to hold the next `*/`, and a
    permission glob is scanned as prose. JSON's string grammar is a quote and a backslash escape and
    nothing else, which is what makes an exact scan this short — TypeScript, whose literals nest and
    interpolate, is why the other branch stays line-grain.
    """
    keep = [""] * len(text.split("\n"))
    row, column, index = 1, 0, 0
    in_string = False
    while index < len(text):
        char = text[index]
        if char == "\n":
            row, column, index = row + 1, 0, index + 1
        elif in_string:
            # A backslash consumes what follows it, so an escaped quote never closes the string.
            step = 2 if char == "\\" else 1
            in_string = char != '"'
            column, index = column + step, index + step
        elif char == '"':
            in_string, column, index = True, column + 1, index + 1
        elif text.startswith(("//", "/*"), index):
            block = text[index + 1] == "*"
            end = text.find("*/" if block else "\n", index + 2)
            end = len(text) if end == -1 else end + (2 if block else 0)
            comment = text[index:end]
            _place(keep, (row, column), comment)
            row += comment.count("\n")
            column = len(comment) - comment.rfind("\n") - 1 if "\n" in comment else column + len(comment)
            index = end
        else:
            column, index = column + 1, index + 1
    return "\n".join(keep)


def comments_only(text: str, suffix: str) -> str:
    """Everything outside a comment blanked out, with the line count preserved.

    A path or an ADR number inside executable code is a string the program uses, not a claim made to
    a reader, so only comments are scanned. A `//` inside a URL is harmless: link checking skips
    http and https regardless.

    Two of the four readers are exact and two are not. Python is tokenized and JSON is scanned, so
    a marker inside a literal reaches nothing. TypeScript is read a line at a time, so a line whose
    CODE holds a marker is kept whole: closing that costs a node launch per file —
    `scripts/ts_normalize.mjs` is the only parser here that reads TypeScript — to remove a false
    positive that is loud when it fires. The `#` reader takes the rest, and `_shell_comments` states
    the surface it keeps: a quoted ` #` in a `.conf`, `.toml` or `.yaml` value is kept with it.
    """
    if suffix == ".sh":
        return _shell_comments(text)
    if suffix == ".json":
        return _jsonc_comments(text)
    if suffix not in CSTYLE_SUFFIXES:
        return _python_comments(text)

    keep: list[str] = []
    in_block = False
    for line in text.split("\n"):
        if in_block:
            keep.append(line)
            if "*/" in line:
                in_block = False
        elif "/*" in line and "*/" not in line:
            in_block = True
            keep.append(line)
        else:
            keep.append(line if ("/*" in line or "//" in line) else "")
    return "\n".join(keep)


def comment_style(path: Path) -> str:
    """The suffix `comments_only` dispatches on, for a file whose own suffix it does not know.

    Each format is read by the reader that knows it: `#` for nginx, YAML, TOML and a Dockerfile —
    which carries no suffix at all for `path.suffix` to dispatch on, and is why the `#` reader is
    the default rather than a case — and the JSONC scanner for the JSON this repository writes its
    tool configuration in.
    """
    return path.suffix if path.suffix in SOURCE_SUFFIXES or path.suffix == ".json" else ".sh"


@cache
def tracked_files() -> tuple[Path, ...]:
    """Every tracked document, source file and ops file, minus skips. Gitignored trees never appear.

    The leading `*` on a whole filename is what carries it past the repository root: an unanchored
    `Dockerfile` pathspec matches the root one alone, and this repository's sit a level down. It
    widens the pattern to anything ENDING in the name, so the name is re-checked below.

    NUL-separated for the reason `_tree_index` is: git quotes and octal-escapes a path outside ASCII
    in its default output, and a quoted spelling fails `is_file` and drops out of the corpus silently.
    """
    patterns = ("*.md", *(f"*{suffix}" for suffix in SCANNED_SUFFIXES), *(f"*{name}" for name in OPS_FILENAMES))
    listing = git("ls-files", "-z", *patterns)
    if listing is None:
        candidates = [path for paths in _tree_index().values() for path in paths]
    else:
        candidates = [REPO_ROOT / entry for entry in listing.split("\0") if entry]
    suffixes = {".md", *SCANNED_SUFFIXES}
    return tuple(sorted({p for p in candidates if p.is_file() and not _skipped(p) and (p.suffix in suffixes or p.name in OPS_FILENAMES)}))


def atx_heading(line: str, level: int | None = None) -> str | None:
    """One ATX heading's text, or None where the line is not a heading at the level asked for.

    Every heading this gate reads resolves here, so no check can be blind to one a renderer
    displays. CommonMark allows up to three spaces of indentation, which is what a heading nested
    inside a numbered list item carries; a fourth space makes it an indented code block instead.
    """
    match = ATX_HEADING_RE.match(line)
    if match is None or (level is not None and len(match.group(1)) != level):
        return None
    return match.group(2)


def heading_anchors(body: str) -> set[str]:
    """The fragment ids GitHub derives from this file's headings, a repeat's `-N` suffix included.

    GitHub's own slugger, because the fragment a reader writes is copied off the rendered page: a
    slug spelled any other way fails a link that works there and passes one that is dead. Lowercase,
    drop what is neither a word character nor a space or a hyphen, spaces to hyphens, then number a
    repeat `-1` upward. An em dash therefore vanishes and leaves the two spaces around it as two
    hyphens, which is why `### OUT-2 — The folder layout` yields `out-2--the-folder-layout`.
    """
    anchors: set[str] = set()
    occurrences: dict[str, int] = {}
    fenced = False
    for line in body.split("\n"):
        # `strip_fences` runs first for every caller; `FENCE_RE` keeps this reading the same shape
        # rather than becoming a rival definition of what opens a block.
        if FENCE_RE.match(line):
            fenced = not fenced
            continue
        if fenced or (text := atx_heading(line)) is None:
            continue
        slug = SLUG_DROP_RE.sub("", INLINE_LINK_RE.sub(r"\1", text).lower()).replace(" ", "-")
        if not slug:
            continue
        # github-slugger's own counting: the suffix is taken from the ORIGINAL slug's tally, so a
        # third `## Setup` yields `setup-2` rather than colliding with the second's `setup-1`.
        original = slug
        while slug in occurrences:
            occurrences[original] += 1
            slug = f"{original}-{occurrences[original]}"
        occurrences[slug] = 0
        anchors.add(slug)
    return anchors


@cache
def anchors_of(target: Path) -> frozenset[str] | None:
    """Another page's heading anchors, or None where it cannot be read.

    Cached because a hub page links into the same handful of documents from every row, and each
    resolution otherwise re-reads and re-slugs the whole target. None is distinct from an empty
    set: a page with no headings resolves nothing, while an unreadable one is reported where it is
    scanned in its own right rather than a second time here.
    """
    body = _readable(target)
    return None if body is None else frozenset(heading_anchors(body))


@cache
def is_gitignored(token: str) -> bool:
    """A gitignored path is named deliberately and is absent by design (docs/audit/ is the case).

    Asked twice, because a directory-only pattern matches a bare name only while the directory is
    there: on a clean checkout the directory is gone, the bare name stops matching, and the
    reference reads as dead everywhere but the machine that has it.

    Only a clean exit says ignored, so a git that cannot answer leaves the finding standing.
    """
    return git_status("check-ignore", "-q", token) == 0 or git_status("check-ignore", "-q", f"{token}/") == 0


def adr_numbers() -> set[str]:
    """The four-digit prefixes of every ADR file that exists."""
    decisions = REPO_ROOT / "docs" / "_decisions"
    if not decisions.is_dir():
        return set()
    return {m.group(1) for f in decisions.glob("*.md") if (m := ADR_FILE_RE.match(f.name))}


def rule_blocks(text: str) -> list[tuple[str, str, str]]:
    """Each rule a chapter states: its id, the rest of its heading line, and the lines under it.

    A block runs to the next heading at any level, so a rule's fields are read from its own text
    and never from the rule below it. Fenced examples are already blanked by the caller.
    """
    lines = text.split("\n")
    starts = [(number, head) for number, line in enumerate(lines) if (head := atx_heading(line, 3)) is not None]
    blocks: list[tuple[str, str, str]] = []
    for position, (number, head) in enumerate(starts):
        if (match := RULE_HEAD_RE.match(head)) is None:
            continue
        end = starts[position + 1][0] if position + 1 < len(starts) else len(lines)
        end = next((index for index in range(number + 1, end) if atx_heading(lines[index]) is not None), end)
        blocks.append((match.group(1), match.group(2), "\n".join(lines[number + 1 : end])))
    return blocks


def rule_ids() -> dict[str, list[str]]:
    """Every rule id a chapter defines, mapped to the chapters defining it.

    Empty when the chapters folder is missing, so every cited id then fails -- deleting the
    standard out from under its citations is exactly what the rule-id check exists to catch. The
    value is a list rather than a name because two homes for one id is itself a failure: a citation
    that resolves twice cannot be followed, and it never dangles, so nothing else would find it.
    """
    ids: dict[str, list[str]] = {}
    for chapter in sorted(CHAPTERS_DIR.glob("*.md")):
        if (text := _readable(chapter)) is None:
            continue
        for rule_id, _, _ in rule_blocks(text):
            ids.setdefault(rule_id, []).append(chapter.relative_to(REPO_ROOT).as_posix())
    return ids


@cache
def roadmap_ids() -> frozenset[str]:
    """Every hyphenated id the roadmap tables define, read from the tables rather than guessed.

    Derived, because the prefixes are open-ended and a hand-written pattern would catch `UTF-8`
    the day someone writes it. An id with no hyphen (the earliest ones) is left out: two characters
    and a digit is a shape that occurs in code for reasons that have nothing to do with the roadmap.
    """
    ids: set[str] = set()
    for page in sorted((REPO_ROOT / "docs" / "_roadmap").glob("*.md")):
        if (text := _read_text(page)[0]) is not None:
            ids.update(ROADMAP_ID_DEF_RE.findall(text))
    return frozenset(ids)


def invariant_ids() -> dict[str, list[str]]:
    """Every `I<n>` a spec sheet's invariant table defines, mapped to the sheets defining it.

    OUT-4 makes the numbers permanent per sheet and says nothing about them being unique across
    sheets, so the same number legitimately names different rules in different surfaces -- which is
    what makes a bare one, cited from anywhere else, resolve to whichever sheet the reader opens.
    """
    ids: dict[str, list[str]] = {}
    for spec in sorted((REPO_ROOT / "docs").glob("*/spec.md")):
        if (text := _read_text(spec)[0]) is None:
            continue
        rel = spec.relative_to(REPO_ROOT).as_posix()
        for match in INVARIANT_ROW_RE.finditer(text):
            homes = ids.setdefault(match.group(1), [])
            if rel not in homes:
                homes.append(rel)
    return ids


def _resolve(file_part: str) -> list[Path]:
    """A citation may give a repo path, a package-relative one, or an unambiguous bare filename.

    The path as written answers first, so a name spelled the way a repository-root file is spelled
    resolves to that file; then the package roots `repo_path` tries; then, for a name carrying no
    directory at all, the tracked index with the templates taken out of it (CUR-5). The cap falls on
    the first few by path rather than on the order the listing arrived in, the index being sorted.
    """
    direct = REPO_ROOT / file_part
    if direct.is_file():
        return [direct]
    # A comment beside the code cites the way its own package spells a path, and reporting that as
    # a dead file is the false positive that gets a citation rewritten to something looser.
    if (resolved := repo_path(file_part)) is not None and (REPO_ROOT / resolved).is_file():
        return [REPO_ROOT / resolved]
    if "/" in file_part:
        return []
    named = _tree_index().get(os.path.normcase(file_part), ())
    return [p for p in named if p.is_file() and not _is_template(p)][:5]


def _check_citation(citation: str, rel: str) -> list[Finding]:
    """A <file> :: <anchor> citation: the file must exist and the anchor must appear inside it."""
    file_part, _, anchor = citation.partition(" :: ")
    file_part, anchor = file_part.strip(), anchor.strip()
    if not file_part or not anchor:
        return [Finding("fail", "citation", rel, f"malformed citation: {citation}")]

    matches = _resolve(file_part)
    if not matches:
        return [Finding("fail", "citation", rel, f"cited file not found: {file_part}")]
    if len(matches) > 1:
        names = ", ".join(sorted(m.relative_to(REPO_ROOT).as_posix() for m in matches)[:4])
        return [Finding("fail", "citation", rel, f"ambiguous file '{file_part}' matches: {names}")]

    target = matches[0]
    content, error = _read_text(target)
    if content is None:
        return [Finding("fail", "citation", rel, f"cannot read {file_part}: {error}")]

    if anchor not in content:
        where = target.relative_to(REPO_ROOT).as_posix()
        return [Finding("fail", "citation", rel, f"anchor '{anchor}' no longer appears in {where}")]
    return []


def _header_scoped(rel: str, suffix: str) -> bool:
    """True where INC-2 binds a file's header to its shape."""
    return any(rel.startswith(prefix) and suffix in suffixes for prefix, suffixes in HEADER_SCOPES)


def _module_header(raw: str, suffix: str) -> list[str] | None:
    """The module header's lines, delimiters included, or None where the file carries none.

    TypeScript: the leading block comment, stepping over blank lines and a directive (INC-7). A
    leading run of `//` comments is not a header, so a file opening with one returns None and is
    not checked. Python: the module docstring, which is only a docstring as the first statement;
    a `#` line above it (a shebang) does not end the scan. Shell: the opening run of `#` lines,
    the shebang excluded -- it is an interpreter directive rather than a line of the header, and
    counting it would spend one of INC-2's twenty. An unterminated delimiter runs to the end of
    the file, which the line cap then fails -- the conservative direction.
    """
    lines = raw.split("\n")
    i = 0
    if suffix == ".sh":
        while i < len(lines) and (not lines[i].strip() or lines[i].startswith("#!")):
            i += 1
        start = i
        while i < len(lines) and lines[i].lstrip().startswith("#"):
            i += 1
        return lines[start:i] or None
    if suffix == ".py":
        while i < len(lines) and (not lines[i].strip() or lines[i].lstrip().startswith("#")):
            i += 1
        if i == len(lines):
            return None
        opened = PY_DOCSTRING_OPEN_RE.match(lines[i].lstrip())
        if opened is None:
            return None
        quote = opened.group(1)
        if quote in lines[i].lstrip()[opened.end() :]:  # a one-line docstring closes on its own line
            return lines[i : i + 1]
        start = i
        i += 1
        while i < len(lines) and quote not in lines[i]:
            i += 1
        return lines[start : i + 1]

    while i < len(lines) and (not lines[i].strip() or DIRECTIVE_RE.match(lines[i])):
        i += 1
    if i == len(lines) or not lines[i].lstrip().startswith("/*"):
        return None
    start = i
    while i < len(lines) and "*/" not in lines[i]:
        i += 1
    return lines[start : i + 1]


def _header_line(line: str, suffix: str) -> str:
    """One header line with its comment decoration removed -- the text INC-2's shapes apply to."""
    text = line.strip()
    if suffix == ".sh":
        return text.lstrip("#").strip()
    if suffix == ".py":
        text = PY_DOCSTRING_OPEN_RE.sub("", text)
        return text.removesuffix('"""').removesuffix("'''").strip()
    text = text.removesuffix("*/").strip()
    for opener in ("/**", "/*", "*"):
        if text.startswith(opener):
            return text[len(opener) :].strip()
    return text


def comment_runs(raw: str, suffix: str, *, symbol_docs: bool) -> list[tuple[int, list[str]]]:
    """Each run of consecutive comment lines below the module header, as (first line, text lines).

    Markers and indentation come off, because they are what the bounds are NOT measuring. With
    symbol_docs off, the shapes INC-4 governs are dropped -- a JSDoc block and a Python docstring
    document a symbol rather than a line -- and what remains is INC-5's inline comments. The module
    header never appears either way: INC-2 holds it to a cap of its own.
    """
    lines = raw.split("\n")
    start_at = 0
    if (header := _module_header(raw, suffix)) is not None:
        for index in range(len(lines)):
            if lines[index : index + len(header)] == header:
                start_at = index + len(header)
                break

    runs: list[tuple[int, list[str]]] = []
    current: list[str] = []
    first_line = 0
    closing: str | None = None
    keeping = True
    hash_only = suffix in (".py", ".sh")

    def flush() -> None:
        nonlocal current, first_line
        if current and any(current):
            runs.append((first_line, current))
        current = []

    for number, line in enumerate(lines[start_at:], start=start_at + 1):
        text = line.strip()
        if closing is not None:  # inside a block comment or a docstring
            if keeping:
                current.append(_header_line(text.removesuffix(closing), suffix))
            if closing in text:
                closing = None
                if keeping:
                    flush()
                keeping = True
            continue

        opened = PY_DOCSTRING_OPEN_RE.match(text) if hash_only else None
        if opened is not None:
            flush()
            keeping = symbol_docs
            first_line = number
            body = text[opened.end() :]
            quote = opened.group(1)
            if keeping:
                current.append(body.removesuffix(quote).strip())
            if quote in body:
                if keeping:
                    flush()
                keeping = True
            else:
                closing = quote
            continue

        if not hash_only and text.startswith("/*"):
            flush()
            keeping = symbol_docs or not text.startswith("/**")
            first_line = number
            body = text.lstrip("/*").strip()
            if keeping:
                current.append(body.removesuffix("*/").strip())
            if "*/" in text[2:]:
                if keeping:
                    flush()
                keeping = True
            else:
                closing = "*/"
            continue

        marker = "#" if hash_only else "//"
        if text.startswith(marker):
            if not current:
                first_line = number
            current.append(text.lstrip("#").strip() if hash_only else text[2:].strip())
            continue
        flush()

    flush()
    return runs


def _misplaced_header(raw: str, suffix: str) -> tuple[int, list[str]] | None:
    """A header-shaped comment block that is not the file's opening one: (first line, its lines).

    The title line is what identifies it. Nothing else in this repository writes `<TOKEN> · <text>`
    as a comment's first line, and a symbol's docblock opens with prose, so the shape separates a
    displaced header from the ordinary comments around it without reading either.

    A block with nothing but blank lines, a shebang and a directive above it opens the file, so it
    is not displaced whatever `_module_header` made of its delimiters -- and reporting it as sitting
    below the first statement would state something the file plainly contradicts.
    """
    lines = raw.split("\n")
    for first_line, block in comment_runs(raw, suffix, symbol_docs=True):
        title = next((text for text in block if text), "")
        if not HEADER_TITLE_RE.fullmatch(title):
            continue
        if all(not line.strip() or line.startswith("#!") or DIRECTIVE_RE.match(line) for line in lines[: first_line - 1]):
            continue
        return first_line, lines[first_line - 1 : first_line - 1 + len(block)]
    return None


def check_comment_length(rel: str, raw: str, suffix: str, added: set[int]) -> list[Finding]:
    """An inline comment block this branch WROTE keeps both of INC-9's bounds.

    Scoped to blocks whose every line the branch added, which is a comment written here rather than
    one a repointed citation happened to touch. The standing backlog is `/docs:audit`'s (CUR-6),
    and failing a branch for a block it changed one word inside is what gets a check suppressed.
    """
    found: list[Finding] = []
    for first_line, block in comment_runs(raw, suffix, symbol_docs=False):
        if not set(range(first_line, first_line + len(block))) <= added:
            continue
        text = " ".join(line for line in block if line).strip()
        if len(block) > COMMENT_LINE_CAP or len(text) > COMMENT_CHAR_CAP:
            found.append(
                Finding(
                    "fail",
                    "comment-length",
                    rel,
                    f"the comment block at line {first_line} runs {len(block)} lines and {len(text)} characters"
                    f" -- INC-9 caps a block at {COMMENT_LINE_CAP} lines and {COMMENT_CHAR_CAP} characters",
                )
            )
    return found


def check_module_header(rel: str, raw: str, suffix: str) -> list[Finding]:
    """A module header in INC-2's scope keeps INC-2's shape.

    The retired vocabulary -- ruled lines, shouty label rows, foreign list labels, an oversized
    block -- passes every compiler and linter, so nothing but this check stops it creeping back.

    A header BELOW the imports is the one shape a placement rule cannot be trusted to catch by
    reading the top of the file: it looks like an ordinary comment from there, and INC-7 puts it
    above them. It is failed for its placement and then held to the same shape as any other.
    """
    found: list[Finding] = []
    header = _module_header(raw, suffix)
    if header is None:
        misplaced = _misplaced_header(raw, suffix)
        if misplaced is None:
            return []
        first_line, header = misplaced
        found.append(
            Finding(
                "fail",
                "module-header",
                rel,
                f"the module header sits at line {first_line}, below the first statement -- INC-7 places it above the imports",
            )
        )
    if len(header) > HEADER_CAP:
        found.append(
            Finding(
                "fail",
                "module-header",
                rel,
                f"the module header runs {len(header)} lines -- INC-2 caps it at {HEADER_CAP} including delimiters",
            )
        )
    stripped = [_header_line(line, suffix) for line in header]
    title = next((text for text in stripped if text), "")
    if not HEADER_TITLE_RE.fullmatch(title):
        found.append(Finding("fail", "module-header", rel, f"the header's first content line is not `<token> · <text>` (INC-2): '{title}'"))
    for text in stripped:
        if HEADER_RULED_RE.search(text):
            found.append(Finding("fail", "module-header", rel, f"ruled line in the module header -- INC-2 bans drawn rules: '{text}'"))
        elif HEADER_SHOUTY_RE.fullmatch(text):
            found.append(Finding("fail", "module-header", rel, f"upper-case label row in the module header (INC-2): '{text}'"))
        elif HEADER_LABEL_RE.fullmatch(text) and text not in HEADER_LABELS:
            found.append(Finding("fail", "module-header", rel, f"header list label other than Invariants: or See: (INC-2): '{text}'"))
    return found


def check_file(path: Path, existing_adrs: set[str], rules: dict[str, list[str]], invariants: dict[str, list[str]]) -> list[Finding]:
    """Every per-file check, for one file.

    A source file reaches all of it but the anchor check. INC-6 makes a comment a spec sheet's
    equal, so a dead path or a broken link inside one is the same defect wherever it is written;
    an in-page anchor is markdown's alone, because a source file has no headings of its own for
    one to resolve against.
    """
    rel = path.relative_to(REPO_ROOT).as_posix()
    is_markdown = path.suffix == ".md"
    is_template = _is_template(path)
    raw, error = _read_text(path)
    if raw is None:
        return [Finding("fail", "unreadable", rel, error)]
    body = _scan_body(path)

    found: list[Finding] = []

    if not is_markdown and _header_scoped(rel, path.suffix):
        found.extend(check_module_header(rel, raw, path.suffix))
        found.extend(check_header_see(rel, raw, path.suffix))

    if is_markdown and path.name == "README.md" and len(raw.splitlines()) > README_LINE_CAP:
        found.append(Finding("fail", "readme-cap", rel, f"a README of {len(raw.splitlines())} lines -- OUT-3 caps one at {README_LINE_CAP}"))

    found.extend(check_owner_voice(rel, body))
    if is_markdown:
        found.extend(check_metadata_breaks(rel, body))
    else:
        found.extend(check_comment_citations(rel, body))
        found.extend(check_bare_paths(rel, body))

    for number in sorted(set(ADR_RE.findall(body))):
        if number not in existing_adrs:
            found.append(Finding("fail", "adr", rel, f"ADR-{number} resolves to no file in docs/_decisions/"))

    for rule_id in sorted(set(RULE_ID_RE.findall(body))):
        homes = rules.get(rule_id, [])
        if not homes:
            found.append(Finding("fail", "rule-id", rel, f"{rule_id} resolves to no rule heading in docs/_standard/chapters/"))
        elif len(homes) > 1:
            found.append(Finding("fail", "rule-id", rel, f"{rule_id} is defined in {' and '.join(homes)} -- a citation cannot say which"))

    if not is_markdown:
        found.extend(check_invariant_citations(rel, body, invariants))

    for citation in sorted(set(CITATION_RE.findall(body))):
        if not is_placeholder(citation):
            found.extend(_check_citation(citation, rel))

    # COR-6 bans line-number citations outright. Nothing else can detect one: it stays syntactically
    # valid and merely stops pointing at what it names, so it has to be caught at the form.
    cited_lines = set(LINE_CITATION_RE.findall(body)) | set(BARE_LINE_CITATION_RE.findall(body))
    for citation in sorted(cited_lines):
        if is_placeholder(citation):
            continue
        found.append(Finding("fail", "line-citation", rel, f"line-number citation `{citation}` -- anchor it to a symbol (COR-6)"))

    # A page's stamp is held to CUR-3's line 3 as well as its shape. Only the VALUE is tested for a
    # placeholder: the label's own `**` reads as a wildcard, which would exempt every stamp there is.
    if not (is_template and "stamp-format" in TEMPLATE_EXEMPT_CHECKS):
        for number, line in enumerate(body.split("\n"), start=1):
            if STAMP_START_RE.match(line) is None or is_placeholder(line.partition(":**")[2]):
                continue
            if not STRICT_STAMP_RE.fullmatch(line):
                found.append(Finding("fail", "stamp-format", rel, f"stamp line is not CUR-3's exact shape: {line.strip()}"))
            elif is_markdown and number != STAMP_LINE_NUMBER:
                detail = f"the stamp sits at line {number} -- CUR-3 puts it on line {STAMP_LINE_NUMBER}"
                found.append(Finding("fail", "stamp-format", rel, detail))

    anchors = heading_anchors(body) if is_markdown else set()
    for raw_target, fragment in sorted(set(LINK_RE.findall(body))):
        anchor = fragment[1:]
        if raw_target.startswith(("http://", "https://", "mailto:")) or is_placeholder(raw_target + fragment):
            continue
        if not raw_target:
            if is_markdown and anchor and anchor not in anchors:
                found.append(Finding("fail", "anchor", rel, f"no heading in this file yields #{anchor}"))
            continue
        if is_template and "link" in TEMPLATE_EXEMPT_CHECKS:
            continue
        target = (path.parent / raw_target).resolve()
        if not target.exists():
            found.append(Finding("fail", "link", rel, f"link target does not exist: {raw_target}"))
            continue
        # The half a fragment-stripping link check never saw: the file resolves and the heading it
        # names does not, so the link opens the right page at the top and looks correct.
        if anchor and target.suffix == ".md" and (reachable := anchors_of(target)) is not None and anchor not in reachable:
            found.append(Finding("fail", "anchor", rel, f"no heading in {raw_target} yields #{anchor}"))

    if is_template and "path" in TEMPLATE_EXEMPT_CHECKS:
        return found

    for token in sorted(set(BACKTICK_RE.findall(body))):
        # A line-number citation is already reported above; it can never exist as a path, so letting
        # the path check fire too would give one defect two findings.
        if " :: " in token or is_placeholder(token) or not token.startswith(REPO_PREFIXES):
            continue
        if LINE_CITATION_RE.fullmatch(f"`{token}`"):
            continue
        if not (REPO_ROOT / token).exists() and not is_gitignored(token):
            found.append(Finding("fail", "path", rel, f"path named but not present: {token}"))

    return found


def check_metadata_breaks(rel: str, body: str) -> list[Finding]:
    """COR-8's hard break over every metadata block on a page: a stamp, a Scope line, an entry's fields.

    A block is a run of bold-labelled lines with no blank line between them; a line that carries no
    label continues the entry above it, so the break belongs on an entry's LAST physical line.
    Every entry but the last carries one, which is what renders them one per line instead of
    flowing into a paragraph; the last carries none, having nothing below it to separate from.

    Two entries sharing one physical line are caught here too, because the break that should have
    parted them is this rule's. Neither half is malformed on its own, which is why the stamp's own
    shape check cannot see it: a joined stamp is a complete entry followed by a complete entry.

    ADRs are excluded because `adr-meta` holds their metadata block to this same rule already, and
    one defect reported twice reads as a check that cries wolf.
    """
    if rel.startswith("docs/_decisions/"):
        return []
    lines = body.split("\n")
    found: list[Finding] = []
    index = 0
    while index < len(lines):
        if METADATA_LINE_RE.match(lines[index]) is None:
            index += 1
            continue
        names: list[str] = []
        ends: list[int] = []
        while index < len(lines) and lines[index].strip() and atx_heading(lines[index]) is None:
            if match := METADATA_LINE_RE.match(lines[index]):
                names.append(match.group(1))
                ends.append(index)
                # Backticked spans come out first: a rule quoting a label to name it, as chapter 0
                # does, is a mention rather than a second entry.
                if joined := METADATA_JOIN_RE.search(BACKTICK_SPAN_RE.sub("", lines[index])):
                    detail = (
                        f"the {match.group(1)} line at line {index + 1} runs into {joined.group(1)} on one physical line"
                        " -- COR-8's break is a line ending, written here as the characters \\n"
                    )
                    found.append(Finding("fail", "metadata-break", rel, detail))
            elif names:
                ends[-1] = index
            index += 1
        for position, (name, end) in enumerate(zip(names, ends, strict=True)):
            wanted = position < len(names) - 1
            if lines[end].rstrip().endswith("\\") is not wanted:
                verb = "needs" if wanted else "must not carry"
                found.append(Finding("fail", "metadata-break", rel, f"the {name} line at line {end + 1} {verb} COR-8's trailing hard break"))
    return found


def check_bare_paths(rel: str, body: str) -> list[Finding]:
    """A repository path named in a comment without backticks, resolving to nothing.

    Comments only. A document is held to COR-6's backticks and its paths therefore reach the `path`
    check; a comment reaches for a bare path constantly, which is how a batch of dead ones survived
    a rename under a green gate. Backticked spans come out first so one dead path never produces two
    findings.

    A token is resolved from the repository root and then from each directory above the file naming
    it, because that is how a reader resolves one: a usage line naming a path relative to its own
    package names a file that exists, and failing it would be the false positive that gets a check
    suppressed. A path dead from every one of them is still dead.
    """
    found: list[Finding] = []
    bases = [REPO_ROOT, *(REPO_ROOT / parent for parent in Path(rel).parents if parent.as_posix() != ".")]
    for token in sorted({match.group(0) for match in BARE_PATH_RE.finditer(BACKTICK_SPAN_RE.sub("", body))}):
        # `is_gitignored` shells out, so it stays behind the tests that answer without one.
        if is_placeholder(token) or any((base / token).exists() for base in bases) or is_gitignored(token):
            continue
        found.append(Finding("fail", "bare-path", rel, f"path named but not present: {token} -- and unbackticked, so `path` never saw it"))
    return found


def check_owner_voice(rel: str, body: str) -> list[Finding]:
    """COR-11: no tracked file outside `.claude/` names its author in the third person."""
    if rel.startswith(OWNER_EXEMPT_PREFIX):
        return []
    mentions_removed = QUOTED_SPAN_RE.sub("", body)
    if OWNER_PHRASE_RE.search(mentions_removed) is None:
        return []
    return [Finding("fail", "owner-voice", rel, "names “the owner” -- write it in the first person or as a neutral imperative (COR-11)")]


def check_comment_citations(rel: str, body: str) -> list[Finding]:
    """The two citation shapes INC-6 bans outright, over one file's comments.

    Whole tree, and failing, because neither survives its programme: both name a document
    `/audit:finish` deletes, so the reference is already dead in the clone a stranger has.
    """
    found: list[Finding] = []
    for match in AUDIT_ID_RE.finditer(body):
        found.append(
            Finding("fail", "comment-citation", rel, f"audit id `{match.group(0).strip()}` in a comment (INC-6) -- cite an ADR or a path")
        )
    for match in LEDGER_ROW_RE.finditer(body):
        found.append(
            Finding("fail", "comment-citation", rel, f"ledger row `{match.group(0).strip()}` in a comment (INC-6) -- cite an ADR or a path")
        )
    return found


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


def _enclosing_block(body: str, offset: int) -> str:
    """The unbroken run of non-blank lines around one offset -- the comment the citation sits in.

    A window measured in characters would reach across the blank lines `comments_only` leaves where
    the code was, and pick a disambiguating word out of an unrelated comment.
    """
    lines = body.split("\n")
    index, seen = 0, 0
    for number, line in enumerate(lines):
        seen += len(line) + 1
        if seen > offset:
            index = number
            break
    start = index
    while start > 0 and lines[start - 1].strip():
        start -= 1
    end = index
    while end + 1 < len(lines) and lines[end + 1].strip():
        end += 1
    return "\n".join(lines[start : end + 1])


def check_invariant_citations(rel: str, body: str, invariants: dict[str, list[str]]) -> list[Finding]:
    """A bare `I<n>` that more than one spec sheet defines, cited from a comment.

    Comments only. A page citing an invariant sits in its surface's folder or links to the sheet in
    the same paragraph, and its reader resolves the id from that; a comment carries no such
    context, so the nearest sheet is whichever one the reader happens to open -- which is how a
    frontend file citing a backend invariant lands on a rule about export style instead.
    """
    found: list[Finding] = []
    for match in INVARIANT_CITE_RE.finditer(body):
        homes = invariants.get(match.group(1), [])
        if len(homes) < 2:
            continue
        if SURFACE_WORDS.search(_enclosing_block(body, match.start())):
            continue
        found.append(Finding("fail", "rule-id", rel, f"bare `{match.group(1)}`, which {' and '.join(homes)} both define -- name the sheet"))
    return found


def repo_path(token: str) -> str | None:
    """The repository path a backticked token names, or None where it names nothing that is there.

    A token carrying no top-level prefix is resolved against the package roots, because that is how
    this repository writes one: `src/app/admin/admin.css` and `app/core/db.py` each name a file.
    Existence decides, so a token naming a KIND of file (`queries.ts`) resolves to nothing and stays
    prose. A traversal or an absolute spelling is refused rather than normalised: what it hands back
    has to be the spelling a git listing uses, or nothing downstream can match it against a diff.
    """
    if token.startswith(("/", "./")) or ".." in token:
        return None
    if token.startswith(REPO_PREFIXES) and (REPO_ROOT / token).exists():
        return token
    if "/" not in token:
        return None
    return next((f"{root}{token}" for root in PACKAGE_ROOTS if (REPO_ROOT / root / token).exists()), None)


def cited_paths(body: str) -> set[str]:
    """Repo paths a page points at: the file half of each citation, plus backticked repo paths."""
    out: set[str] = set()
    for citation in CITATION_RE.findall(body):
        if is_placeholder(citation):
            continue
        if (resolved := repo_path(citation.partition(" :: ")[0].strip())) is not None:
            out.add(resolved)
    for token in BACKTICK_RE.findall(body):
        if " :: " in token or is_placeholder(token):
            continue
        if (resolved := repo_path(token)) is not None:
            out.add(resolved)
    return out


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


def check_stamp_missing() -> list[Finding]:
    """A page whose kind CUR-3 settles must carry a stamp carries one.

    Every other stamp check polices a stamp that exists, so a page that should carry one and does
    not is invisible to all of them -- and to `branch-impact`, which arms only on a stamped page,
    leaving the files that page cites free to change under it. What the criterion turns on is what
    a page claims, which no check can read; these kinds are the part of it a path decides, because
    a spec sheet's contract, an overview's parts, the glossary's `In code` fields and a chapter's
    account of this gate are current-state claims by the rule that shapes each of them.
    """
    found: list[Finding] = []
    for pattern in STAMP_REQUIRED_GLOBS:
        for path in sorted(REPO_ROOT.glob(pattern)):
            if _skipped(path) or (body := _readable(path)) is None or STAMP_RE.search(body) is not None:
                continue
            rel = path.relative_to(REPO_ROOT).as_posix()
            found.append(
                Finding("fail", "stamp-missing", rel, "carries no `Verified against` stamp, so nothing can measure it going stale (CUR-3)")
            )
    return found


def _branch_scope_skipped(checks: str, missing: str) -> Finding:
    """The advisory a branch-scoped check emits where git cannot answer the input it reads.

    Reported rather than failed: a clone with no base ref -- a fork, a tarball, a checkout trimmed
    to a depth short of the fork -- is a shape rather than a page's defect, and failing one would be
    wrong. Never silent, though, which is what the same file already says about a tree-scoped input:
    a check that says nothing is indistinguishable from a clean one, and this one stays quiet
    forever once the input goes missing.
    """
    return Finding("report", "branch-scope", "(branch diff)", f"{checks} did not run: git could not {missing}")


def check_stamp_freshness(base: str) -> list[Finding]:
    """A stamped page changed on this branch must also change its stamp (CUR-4).

    The stamp claims someone checked the page against a commit. Editing the page without moving it
    leaves that claim attached to work the author did not verify, and no other check can tell the
    difference -- an old SHA is a valid ancestor forever. If the page was genuinely still correct,
    restamping says so; that is the whole point of the line.
    """
    # Against the merge base and the WORKING TREE, not HEAD. The gate runs before a commit exists, so
    # comparing committed state would let the edit through on the run that could still have caught it.
    fork = git("merge-base", base, "HEAD")
    if fork is None:
        return [_branch_scope_skipped("stamp freshness (CUR-4)", f"resolve a merge base between {base} and HEAD")]
    changed = git("diff", "--name-only", fork, "--", "*.md")
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


def _stamp_only_delta(fork: str, rel: str) -> bool:
    """A markdown delta consisting only of moved stamp lines is a restamp, not a change.

    Restamping is the remedy branch-impact itself prescribes, and a remedy that re-arms the check
    on every page citing the restamped one turns one edit into a repository-wide cascade
    (ADR-0059). Nothing a citer cites lives on the stamp line, so real stamp lines are normalised
    out of both versions before they are compared. Only a line carrying an actual SHA is
    normalised: a placeholder stamp, like the shape example in the currency chapter, is content.
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
    except OSError, UnicodeDecodeError:
        return True
    return not _stamp_only_delta(fork, path)


def check_branch_impact(base: str) -> list[Finding]:
    """A stamped page whose cited files materially changed on this branch must restamp (CUR-4).

    Material means more than comments, decided by check_scope's parser classifier -- anything it
    cannot prove comment-only counts, so shell, YAML and Dockerfiles always do, and markdown does
    unless its whole delta is stamp lines, which is a restamp rather than a change (ADR-0059). A
    page added on the branch passes: its stamp is already this branch's work.
    """
    fork = check_scope.resolve_base(base)
    if fork is None:
        return [_branch_scope_skipped("branch impact (CUR-4)", f"resolve {base} to a commit this branch forked from")]
    changed = set(check_scope.changed_files(fork))
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
        if before is None:
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


def check_adr_meta() -> list[Finding]:
    """Every ADR carries DEC-2's exact anatomy, DEC-3's status set, and DEC-6's reciprocity."""
    decisions = REPO_ROOT / "docs" / "_decisions"
    found: list[Finding] = []
    # Number -> the two supersession fields, collected first so reciprocity can be checked across files.
    supersedes: dict[str, str] = {}
    superseded_by: dict[str, str] = {}

    for path in sorted(decisions.glob("*.md")):
        match = ADR_FILE_RE.match(path.name)
        if match is None:
            continue
        number = match.group(1)
        rel = path.relative_to(REPO_ROOT).as_posix()
        body = _readable(path)
        if body is None:
            found.append(Finding("fail", "adr-meta", rel, "unreadable"))
            continue
        lines = body.split("\n")

        title = atx_heading(lines[0], 1) or ""
        if not title.startswith(f"ADR-{number} — "):
            found.append(Finding("fail", "adr-meta", rel, f"the H1 does not read `# ADR-{number} — <statement>` matching the filename"))

        names: list[str] = []
        values: dict[str, str] = {}
        breaks: list[bool] = []
        gapped = False
        for line in lines:
            if atx_heading(line, 2) is not None:
                break
            if meta := ADR_META_RE.match(line):
                names.append(meta.group(1))
                # COR-8's hard break is layout, not value: strip it before validating.
                raw_value = meta.group(2).strip()
                breaks.append(raw_value.endswith("\\"))
                values[meta.group(1)] = raw_value.removesuffix("\\").strip()
            elif names and not line.strip() and len(names) < len(ADR_META_ORDER):
                gapped = True

        if gapped:
            found.append(Finding("fail", "adr-meta", rel, "a blank line inside the metadata block splits it into two paragraphs (DEC-2)"))
        # Every metadata line but the last carries COR-8's hard break, which is what renders them one
        # per line; the last carries none, because nothing follows it that could flow into it.
        for index, (name, has_break) in enumerate(zip(names, breaks, strict=True)):
            wanted = index < len(names) - 1
            if has_break is not wanted:
                detail = f"the {name} line {'needs' if wanted else 'must not carry'} COR-8's trailing hard break"
                found.append(Finding("fail", "adr-meta", rel, detail))
        if tuple(names) != ADR_META_ORDER:
            found.append(Finding("fail", "adr-meta", rel, f"metadata lines are not exactly {', '.join(ADR_META_ORDER)}, in that order"))
        else:
            if ADR_STATUS_RE.fullmatch(values["Status"]) is None:
                found.append(Finding("fail", "adr-meta", rel, f"Status '{values['Status']}' is outside DEC-3's closed set"))
            if ISO_DATE_RE.fullmatch(values["Date"]) is None:
                found.append(Finding("fail", "adr-meta", rel, f"Date '{values['Date']}' is not an ISO date"))
            if not values["Source"]:
                found.append(Finding("fail", "adr-meta", rel, "the Source line is empty"))
            supersedes[number] = values["Supersedes"]
            superseded_by[number] = values["Superseded by"]

        h2s = tuple(_headings("\n".join(lines), 2))
        if h2s != ADR_H2S:
            found.append(Finding("fail", "adr-meta", rel, f"H2 sections are not exactly {', '.join(ADR_H2S)}, in that order"))

        if any(STAMP_START_RE.match(line) for line in lines):
            found.append(Finding("fail", "adr-meta", rel, "an ADR carries no stamp line -- it is dated, never re-verified (DEC-2)"))

    def other_number(value: str, rel: str, field: str) -> str | None:
        if value == "—":
            return None
        if m := ADR_REFERENCE_RE.fullmatch(value):
            return m.group(1)
        found.append(Finding("fail", "adr-meta", rel, f"{field} '{value}' is neither — nor a single ADR-NNNN"))
        return None

    for number, value in supersedes.items():
        rel = f"docs/_decisions/{number}-*"
        if (other := other_number(value, rel, "Supersedes")) is None:
            continue
        if superseded_by.get(other) != f"ADR-{number}":
            found.append(Finding("fail", "adr-meta", rel, f"not reciprocal: ADR-{other} does not carry Superseded by ADR-{number}"))
    for number, value in superseded_by.items():
        rel = f"docs/_decisions/{number}-*"
        if (other := other_number(value, rel, "Superseded by")) is None:
            continue
        if supersedes.get(other) != f"ADR-{number}":
            found.append(Finding("fail", "adr-meta", rel, f"not reciprocal: ADR-{other} does not carry Supersedes ADR-{number}"))

    return found


def check_roadmap() -> list[Finding]:
    """The ranked roadmap agrees with itself: index and entries, ranks, ids, and no transient status.

    The file's failure mode is that it quietly stops being trustworthy -- an entry with no index
    row is invisible to the reader who only reads the table, a rank that disagrees with its heading
    makes the working order ambiguous, and a `Closed` entry is one a closing commit's successor
    never deleted. Nothing else looks at any of it.
    """
    if (body := _readable(REPO_ROOT / ROADMAP_OPEN_ITEMS)) is None:
        return []

    found: list[Finding] = []
    entries = {match.group(2): int(match.group(1)) for match in ROADMAP_ENTRY_RE.finditer(body)}
    rows = {match.group(2): int(match.group(1)) for match in ROADMAP_INDEX_ROW_RE.finditer(body)}

    for entry_id in sorted(set(entries) - set(rows)):
        found.append(Finding("fail", "roadmap-shape", ROADMAP_OPEN_ITEMS, f"entry {entry_id} has no row in the index table"))
    for entry_id in sorted(set(rows) - set(entries)):
        found.append(Finding("fail", "roadmap-shape", ROADMAP_OPEN_ITEMS, f"index row {entry_id} has no entry below it"))
    for entry_id in sorted(set(entries) & set(rows)):
        if entries[entry_id] != rows[entry_id]:
            detail = f"{entry_id} ranks {entries[entry_id]} in its heading and {rows[entry_id]} in the index"
            found.append(Finding("fail", "roadmap-shape", ROADMAP_OPEN_ITEMS, detail))

    known = roadmap_ids()
    for entry_id in sorted(set(entries) - known):
        found.append(Finding("fail", "roadmap-shape", ROADMAP_OPEN_ITEMS, f"entry id {entry_id} is defined by no roadmap table"))

    # Contiguous from 1, on each side: a gap makes "the next one" unanswerable, and a duplicate
    # makes the working order ambiguous.
    for where, ranks in (("entry heading", sorted(entries.values())), ("index", sorted(rows.values()))):
        if ranks and ranks != list(range(1, len(ranks) + 1)):
            detail = f"{where} ranks are {', '.join(str(rank) for rank in ranks)} -- they run 1 to {len(ranks)} without a gap or a repeat"
            found.append(Finding("fail", "roadmap-shape", ROADMAP_OPEN_ITEMS, detail))

    transient = "that status lasts one commit, whose successor"
    for match in ROADMAP_STATUS_RE.finditer(body):
        if match.group(1) == ROADMAP_TRANSIENT_STATUS:
            detail = f"an entry states Status: {ROADMAP_TRANSIENT_STATUS} -- {transient} deletes the entry"
            found.append(Finding("fail", "roadmap-shape", ROADMAP_OPEN_ITEMS, detail))
    for match in ROADMAP_INDEX_ROW_RE.finditer(body):
        if ROADMAP_TRANSIENT_STATUS in [cell.strip() for cell in match.group(3).split("|")]:
            detail = f"index row {match.group(2)} states {ROADMAP_TRANSIENT_STATUS} -- {transient} deletes the entry"
            found.append(Finding("fail", "roadmap-shape", ROADMAP_OPEN_ITEMS, detail))

    return found


def check_adr_index() -> list[Finding]:
    """Every ADR file has an index row in docs/_decisions/README.md (DEC-7).

    Only the missing-row direction lives here: a row pointing at a missing file is already a dead
    link, and the link check reports it.
    """
    decisions = REPO_ROOT / "docs" / "_decisions"
    content = _read_text(decisions / "README.md")[0]
    if content is None:
        return [Finding("fail", "adr-index", "docs/_decisions/README.md", "unreadable or missing")]

    rows = ADR_INDEX_ROW_RE.findall(content)
    indexed = {number for number, _ in rows}

    found: list[Finding] = []
    for number, target in rows:
        if not target.startswith(number):
            detail = f"row [{number}] links to {target}, a different number's file"
            found.append(Finding("fail", "adr-index", "docs/_decisions/README.md", detail))
    for path in sorted(decisions.glob("*.md")):
        if (match := ADR_FILE_RE.match(path.name)) and match.group(1) not in indexed:
            found.append(Finding("fail", "adr-index", "docs/_decisions/README.md", f"no index row for {path.name}"))
    return found


def _headings(body: str, level: int) -> list[str]:
    """The headings at one level, in the order the page carries them."""
    return [text for line in body.split("\n") if (text := atx_heading(line, level)) is not None]


def _section(body: str, heading: str) -> str:
    """One `## <heading>` section's body, empty where the page carries no such heading.

    Located the same way `_headings` reads one, so the two can never disagree about where a section
    starts. Matching the line verbatim instead empties the section on a trailing space, and a
    subsection check over nothing passes.
    """
    lines = body.split("\n")
    start = next((index for index, line in enumerate(lines) if atx_heading(line, 2) == heading), None)
    if start is None:
        return ""
    end = next((index for index in range(start + 1, len(lines)) if atx_heading(lines[index], 2) is not None), len(lines))
    return "\n".join(lines[start + 1 : end])


@cache
def _readable(path: Path) -> str | None:
    """A page's fence-stripped body, or None where it cannot be read."""
    raw = _read_text(path)[0]
    return None if raw is None else strip_fences(raw)  # None is reported where the file is scanned


@cache
def _scan_body(path: Path) -> str:
    """The half of one file the checks read: a page's prose, a source file's comments.

    Empty where the file cannot be read, which every caller already treats as nothing to say -- the
    read failure itself is `unreadable`'s, reported once where the file is scanned in its own right.
    """
    raw = _read_text(path)[0]
    if raw is None:
        return ""
    return strip_fences(raw) if path.suffix == ".md" else comments_only(raw, comment_style(path))


def check_spec_sheets() -> list[Finding]:
    """OUT-4's spine over every spec sheet: the four sections, and the contract's numbering.

    A fifth closing section repoints every citation of "section 3" without changing a word of one,
    and a gap in the contract's numbering does the same one level down. Neither is visible to a
    reader of the page that moved.
    """
    sheets = sorted(REPO_ROOT.glob("docs/*/spec.md"))
    if not sheets:
        return [Finding("fail", "spec-spine", "docs/*/spec.md", "no spec sheet found, so OUT-4's spine is checked against nothing")]

    found: list[Finding] = []
    for sheet in sheets:
        rel = sheet.relative_to(REPO_ROOT).as_posix()
        if (body := _readable(sheet)) is None:
            continue
        sections = tuple(_headings(body, 2))
        if sections != SPEC_SECTIONS:
            detail = f"sections are [{', '.join(sections)}] -- OUT-4 fixes them at [{', '.join(SPEC_SECTIONS)}]"
            found.append(Finding("fail", "spec-spine", rel, detail))
            continue
        subsections = _headings(_section(body, SPEC_SECTIONS[0]), 3)
        numbers = [int(match.group(1)) for line in subsections if (match := SPEC_SUBSECTION_RE.match(line))]
        if len(numbers) != len(subsections) or numbers != list(range(1, len(numbers) + 1)):
            detail = f"the contract's subsections are [{', '.join(subsections)}] -- OUT-4 numbers them 1.1 upward, without a gap"
            found.append(Finding("fail", "spec-spine", rel, detail))
    return found


def check_invariant_tables() -> list[Finding]:
    """Every invariant row states a failure mode, and every id a sheet cites resolves to one.

    The `Breaks how` column is what makes an invariant actionable rather than a slogan, and it is
    the column a hurried row leaves as a pointer. Ids resolve across sheets rather than within one,
    because a surface citing another surface's invariant is ordinary and correct.
    """
    sheets = sorted(REPO_ROOT.glob("docs/*/spec.md"))
    if not sheets:
        return [Finding("fail", "invariant-row", "docs/*/spec.md", "no spec sheet found, so no invariant table is checked")]

    bodies = {sheet: body for sheet in sheets if (body := _readable(sheet)) is not None}
    defined = {match for body in bodies.values() for match in INVARIANT_ID_RE.findall(_section(body, SPEC_SECTIONS[1]))}

    found: list[Finding] = []
    for sheet, body in bodies.items():
        rel = sheet.relative_to(REPO_ROOT).as_posix()
        seen: set[str] = set()
        for line in _section(body, SPEC_SECTIONS[1]).split("\n"):
            if (match := INVARIANT_ID_RE.match(line)) is None:
                continue
            invariant = match.group(1)
            if invariant in seen:
                found.append(Finding("fail", "invariant-row", rel, f"{invariant} numbers two rows -- OUT-4 makes a number permanent"))
            seen.add(invariant)
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            if len(cells) != SPEC_COLUMNS:
                found.append(Finding("fail", "invariant-row", rel, f"{invariant} has {len(cells)} cells, not OUT-4's {SPEC_COLUMNS}"))
            elif not cells[-1].strip("—- ") or CROSS_REFERENCE_RE.match(cells[-1]):
                found.append(Finding("fail", "invariant-row", rel, f"{invariant} states no failure mode: '{cells[-1]}' (OUT-4)"))
        for cited in sorted(set(INVARIANT_REF_RE.findall(body)) - defined):
            found.append(Finding("fail", "invariant-id", rel, f"cites {cited}, which no spec sheet's invariant table defines"))
    return found


def check_overviews() -> list[Finding]:
    """OUT-5's spine: an overview opens on how the surface is organised and closes on where to go.

    Both ends are load-bearing and neither is missed by a reader of the page: an overview that
    stops naming its parts has started explaining mechanisms the spec sheet owns, and one with no
    handoff is where a reader's trail goes cold.
    """
    overviews = sorted(REPO_ROOT.glob("docs/*/overview.md"))
    if not overviews:
        return [Finding("fail", "overview-spine", "docs/*/overview.md", "no overview found, so OUT-5's spine is checked against nothing")]

    found: list[Finding] = []
    for overview in overviews:
        rel = overview.relative_to(REPO_ROOT).as_posix()
        if (body := _readable(overview)) is None:
            continue
        sections = _headings(body, 2)
        if not sections or sections[0] != OVERVIEW_OPENING:
            found.append(Finding("fail", "overview-spine", rel, f"does not open on '## {OVERVIEW_OPENING}' (OUT-5)"))
        if not sections or sections[-1] != OVERVIEW_CLOSING:
            found.append(Finding("fail", "overview-spine", rel, f"does not close on '## {OVERVIEW_CLOSING}' (OUT-5)"))
    return found


def _glossary_entries(body: str) -> list[tuple[str, str]]:
    """Each `### ` entry as its heading text and the lines under it, to the next entry."""
    lines = body.split("\n")
    starts = [(number, head) for number, line in enumerate(lines) if (head := atx_heading(line, 3)) is not None]
    return [
        (head, "\n".join(lines[number + 1 : starts[position + 1][0] if position + 1 < len(starts) else len(lines)]))
        for position, (number, head) in enumerate(starts)
    ]


def check_glossary() -> list[Finding]:
    """OUT-6's entry shape: the term as code spells it, a gloss, then the four fields in order.

    The `Trap` field is the reason the glossary exists, and it is the one an entry written in a
    hurry drops -- a term with no pitfall line costs the next reader the hour it was written to
    save.
    """
    rel = GLOSSARY.relative_to(REPO_ROOT).as_posix()
    if (body := _readable(GLOSSARY)) is None:
        return [Finding("fail", "glossary-entry", rel, "unreadable or missing, so the domain vocabulary is checked against nothing")]

    found: list[Finding] = []
    entries = _glossary_entries(body)
    if not entries:
        return [Finding("fail", "glossary-entry", rel, "carries no `### <term>` entry (OUT-6)")]
    for head, rest in entries:
        if not GLOSSARY_HEAD_RE.match(head.strip()):
            found.append(Finding("fail", "glossary-entry", rel, f"the heading is not `` `<term>` — <gloss> `` (OUT-6): {head.strip()[:60]}"))
        fields = tuple(GLOSSARY_FIELD_RE.findall(rest))
        if fields != GLOSSARY_FIELDS:
            detail = f"'{head.strip()[:40]}' carries [{', '.join(fields)}] -- OUT-6 asks for [{', '.join(GLOSSARY_FIELDS)}]"
            found.append(Finding("fail", "glossary-entry", rel, detail))
    return found


def check_header_see(rel: str, raw: str, suffix: str) -> list[Finding]:
    """A path on a module header's `See:` list resolves to a file that is there (INC-2).

    A `See:` entry is a pointer by construction, so unlike a backticked token in prose it can never
    be naming a kind of file. It is also written package-relative here, which is the spelling the
    `path` check reads as prose and leaves unresolved.
    """
    header = _module_header(raw, suffix)
    if header is None:
        return []
    lines = [_header_line(line, suffix) for line in header]
    if "See:" not in lines:
        return []

    found: list[Finding] = []
    for entry in lines[lines.index("See:") + 1 :]:
        token = SEE_ENTRY_RE.split(entry.lstrip("- ").strip())[0].strip().strip("`")
        if "/" not in token or not SUFFIXED_RE.search(token) or is_placeholder(token):
            continue
        if repo_path(token) is None and not is_gitignored(token):
            found.append(Finding("fail", "header-see", rel, f"the See: entry `{token}` resolves to no file"))
    return found


def check_inputs() -> list[Finding]:
    """Every tree and page another check reads is present.

    Each check below resolves its input with `glob` or `read_text` and treats an empty answer as
    nothing to say, which turns a deleted or moved input into a check that passes without looking
    at anything. Naming them here is what makes the absence itself the finding.
    """
    return [
        Finding("fail", "inputs", rel, "missing -- the check reading it would otherwise pass without examining anything")
        for rel in REQUIRED_INPUTS
        if not (REPO_ROOT / rel).exists()
    ]


def check_line_endings() -> list[Finding]:
    """A tracked text file holds LF in the working tree wherever `.gitattributes` mandates it.

    The declaration takes effect at commit, so a CRLF working tree reads clean in the index and
    breaks where the file runs: a shell script dies on its shebang on the Linux server, and the
    formatter rejects the tree. Git's own verdict decides what counts as text, because a PNG holds
    CR-LF byte pairs legitimately and an extension list is what gets that wrong. A file the
    attributes give `eol=crlf` is exempt by construction, so `*.bat` and `*.cmd` need no list here.
    """
    listing = git("ls-files", "--eol")
    if listing is None:
        # A run that cannot read the index proves nothing about the tree, and a check that says
        # nothing is indistinguishable from a clean one.
        detail = "git could not report the tree's line endings, so nothing was held to `.gitattributes`"
        return [Finding("fail", "line-endings", ".gitattributes", detail)]

    found: list[Finding] = []
    for line in listing.split("\n"):
        if (match := LS_FILES_EOL_RE.match(line)) is None:
            continue
        worktree, attributes, rel = match.group(2), match.group(3), match.group(4)
        if worktree not in NON_LF_WORKTREE or CRLF_MANDATED in attributes:
            continue
        detail = f"the working tree holds {worktree.upper()} line endings, and `{attributes}` mandates LF"
        found.append(Finding("fail", "line-endings", rel, detail))
    return found


def check_enforced_by() -> list[Finding]:
    """A rule's `Enforced by` field names gate checks this script actually emits.

    The field is where the standard claims mechanical enforcement, and a claim that has drifted is
    worse than an unenforced rule: it reads as covered. The whole field is read, because PRE-4
    closes its vocabulary: what is not a check is a command, which carries a slash or a dot, or a
    linter, which is named in prose beside the selection covering the rule. A bare backticked
    lower-case token is therefore a claim about this gate wherever in the sentence it stands.
    """
    chapters = sorted(CHAPTERS_DIR.glob("*.md"))
    if not chapters:
        rel = CHAPTERS_DIR.relative_to(REPO_ROOT).as_posix()
        return [Finding("fail", "enforced-by", rel, "no chapters found, so no enforcement claim can be resolved")]

    found: list[Finding] = []
    for chapter in chapters:
        rel = chapter.relative_to(REPO_ROOT).as_posix()
        if (text := _readable(chapter)) is None:
            continue  # reported as `unreadable` where the file is scanned in its own right
        for match in ENFORCED_BY_RE.finditer(text):
            field = " ".join(match.group(1).split())
            for name in CHECK_NAME_RE.findall(field):
                if name not in CHECKS:
                    detail = f"claims enforcement by gate check `{name}`, which this gate does not emit: {field[:80]}"
                    found.append(Finding("fail", "enforced-by", rel, detail))
    return found


def check_rule_shape() -> list[Finding]:
    """Every rule in the standard keeps PRE-4's anatomy, which is what the rest of this gate parses.

    `rule-id` resolves a citation to a `### <ID>` heading and `enforced-by` reads the field that
    heading's block ends on, so a rule written in another shape is not a style lapse: it is a rule
    outside the reach of both, silently, while every citation of it still resolves.
    """
    found: list[Finding] = []
    for chapter in sorted(CHAPTERS_DIR.glob("*.md")):
        rel = chapter.relative_to(REPO_ROOT).as_posix()
        if (text := _readable(chapter)) is None:
            continue
        tabled = set(CHAPTER_ROW_RE.findall(text))
        for rule_id, claim, block in rule_blocks(text):
            if not RULE_CLAIM_RE.match(claim):
                detail = f"{rule_id}'s heading is not `### {rule_id} — <the rule as a claim>` (PRE-4)"
                found.append(Finding("fail", "rule-shape", rel, detail))
            fields = tuple(RULE_FIELD_RE.findall(block))
            if fields != RULE_FIELDS:
                detail = f"{rule_id} carries [{', '.join(fields)}] -- PRE-4 fixes them at [{', '.join(RULE_FIELDS)}], in that order"
                found.append(Finding("fail", "rule-shape", rel, detail))
            if rule_id not in tabled:
                found.append(Finding("fail", "rule-shape", rel, f"{rule_id} has no row in this chapter's rule table (PRE-4)"))
    return found


def check_rule_index(rules: dict[str, list[str]]) -> list[Finding]:
    """Every rule takes one line in the rules index, and no rule takes two (PRE-4).

    The index is what a session reads instead of six chapters, so a rule missing from it is a rule
    most readers never meet. The other direction -- a line naming a rule no chapter states -- is
    `rule-id`'s, which resolves every id on the page already.
    """
    rel = RULES_INDEX.relative_to(REPO_ROOT).as_posix()
    if (text := _readable(RULES_INDEX)) is None:
        return [Finding("fail", "rule-index", rel, "unreadable or missing, so no rule's index line can be resolved")]

    listed: list[str] = RULE_INDEX_LINE_RE.findall(text)
    found: list[Finding] = []
    for rule_id in sorted(set(rules) - set(listed)):
        detail = f"{rule_id} has no index line, so it is stated only in {' and '.join(rules[rule_id])}"
        found.append(Finding("fail", "rule-index", rel, detail))
    for rule_id in sorted({name for name in listed if listed.count(name) > 1}):
        found.append(Finding("fail", "rule-index", rel, f"{rule_id} takes {listed.count(rule_id)} index lines -- PRE-4 gives it one"))
    return found


def check_check_registry() -> list[Finding]:
    """CUR-5's table lists exactly the checks this script emits, at the verdicts it emits them.

    The table is the one place the checks are written down, and nothing else reads it. A check
    added without a row defends the repository while telling nobody what its failure means, and a
    row outliving its check sends a reader looking for a defence that is gone.
    """
    rel = CURRENCY_CHAPTER.relative_to(REPO_ROOT).as_posix()
    text = _read_text(CURRENCY_CHAPTER)[0]
    if text is None:
        return [Finding("fail", "check-registry", rel, "unreadable, so the list of checks cannot be compared against the gate")]

    listed: dict[str, set[str]] = {}
    for name, verdict in CHECK_ROW_RE.findall(text):
        listed.setdefault(name, set()).add(verdict.lower())
    if not listed:
        return [Finding("fail", "check-registry", rel, "carries no check row -- CUR-5's table is where every check is listed")]

    found: list[Finding] = []
    for name in sorted(set(CHECKS) - set(listed)):
        verdicts = " and ".join(sorted(v.capitalize() for v in CHECKS[name]))
        found.append(Finding("fail", "check-registry", rel, f"gate check `{name}` has no row -- add one, verdict {verdicts}"))
    for name in sorted(set(listed) - set(CHECKS)):
        found.append(Finding("fail", "check-registry", rel, f"a row names gate check `{name}`, which this gate does not emit"))
    for name in sorted(set(listed) & set(CHECKS)):
        if listed[name] != set(CHECKS[name]):
            wanted = " and ".join(sorted(v.capitalize() for v in CHECKS[name]))
            found.append(Finding("fail", "check-registry", rel, f"gate check `{name}` is emitted as {wanted}, which its rows do not say"))
    return found


def _glob_table(text: str, header: re.Pattern[str], glob_cell: int = 1) -> dict[str, list[str]] | None:
    """A two-column table's first cell against its backticked globs, or None if absent.

    `glob_cell` names the column holding them: the segment table reads `| Segment | Globs |`, the
    excluded table `| Excluded | Why |`, so one carries its globs second and the other first.

    Read from the command file rather than declared here, so the partition has one definition. Rows
    end at the first line that does not open a table cell, which is what stops a following paragraph
    being read as rows.
    """
    opening = header.search(text)
    if opening is None:
        return None
    rows: dict[str, list[str]] = {}
    for line in text[opening.end() :].split("\n")[1:]:
        if not line.lstrip().startswith("|"):
            break
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        # The separator row carries no name and no globs; anything else with a name is a row.
        if len(cells) < 2 or not (name := cells[0].strip("`")) or set(name) <= set("-: "):
            continue
        rows[name] = BACKTICK_RE.findall(cells[glob_cell])
    return rows


def check_segment_map() -> list[Finding]:
    """`/docs:audit`'s segments claim every tracked file the sweep does not exclude, exactly once.

    The command asserts the partition is total, and until the globs existed nothing could check it:
    a file no segment claims is never dispatched to any agent, and reads afterwards as audited. A
    file two segments claim is audited twice and reported twice, which costs a fix session the time
    it takes to notice they are one defect.
    """
    rel = SWEEP_COMMAND.relative_to(REPO_ROOT).as_posix()
    text = _readable(SWEEP_COMMAND)
    if text is None:
        return [Finding("fail", "segment-map", rel, "unreadable, so the sweep's partition cannot be held to the tree")]

    segments = _glob_table(text, SEGMENT_HEADER_RE)
    excluded = _glob_table(text, EXCLUDED_HEADER_RE, glob_cell=0)
    if not segments:
        return [Finding("fail", "segment-map", rel, "carries no `Segment` / `Globs` table -- the sweep's partition is what this check reads")]
    if excluded is None:
        return [Finding("fail", "segment-map", rel, "carries no `Excluded` / `Why` table -- without it every excluded file reads as unclaimed")]

    listing = git("ls-files")
    if listing is None:
        # The partition is total or it is not, and an unlisted tree answers neither.
        return [Finding("fail", "segment-map", rel, "git could not list the tracked files, so the partition was held to nothing")]

    skip = [pattern for patterns in excluded.values() for pattern in patterns]
    unclaimed: list[str] = []
    shared: list[str] = []
    for tracked in (line for line in listing.split("\n") if line):
        path = PurePosixPath(tracked)
        if any(path.full_match(pattern) for pattern in skip):
            continue
        owners = [name for name, patterns in segments.items() if any(path.full_match(pattern) for pattern in patterns)]
        if not owners:
            unclaimed.append(tracked)
        elif len(owners) > 1:
            shared.append(f"{tracked} ({', '.join(owners)})")

    found: list[Finding] = []
    if unclaimed:
        found.append(Finding("fail", "segment-map", rel, f"{len(unclaimed)} tracked file(s) belong to no segment: {_sample(unclaimed)}"))
    if shared:
        found.append(Finding("fail", "segment-map", rel, f"{len(shared)} tracked file(s) belong to more than one segment: {_sample(shared)}"))
    return found


def _sample(paths: list[str]) -> str:
    """The first few offending paths, and a count of whatever is left."""
    head = ", ".join(f"`{path}`" for path in sorted(paths)[:SEGMENT_SAMPLE])
    return head if len(paths) <= SEGMENT_SAMPLE else f"{head} and {len(paths) - SEGMENT_SAMPLE} more"


def check_template_fragments() -> list[Finding]:
    """The pull request form still carries every fragment the body gate quotes from it.

    `check_pr_body.py :: TEMPLATE_FRAGMENTS` refuses a body still holding the form's placeholder
    prose, by matching that prose verbatim. Reword the form and the refusal keeps passing every
    body, including the unfilled one it exists to catch.
    """
    rel = GIT_TEMPLATES.relative_to(REPO_ROOT).as_posix()
    text = _read_text(GIT_TEMPLATES)[0]
    if text is None:
        return [Finding("fail", "template-fragment", rel, "unreadable, so the body gate's quoted fragments cannot be confirmed")]
    return [
        Finding("fail", "template-fragment", rel, f"no longer carries a fragment `check_pr_body.py :: TEMPLATE_FRAGMENTS` quotes: '{fragment}'")
        for fragment in check_pr_body.TEMPLATE_FRAGMENTS
        if fragment not in text
    ]


def _unresolved_commits(shas: Iterable[str]) -> set[str]:
    """The named short SHAs this clone cannot resolve to a commit object.

    One batch call rather than one per token: a page of release notes names dozens, and a process
    launch per token is the cost that gets a check dropped. A name git cannot resolve comes back as
    `<name> missing` or `<name> ambiguous`, and anything resolving to a tree or a blob is not a
    commit either.
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
        return set()
    if done.returncode != 0:
        return set()
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
    return [
        Finding("report", "sha", rel, f"commit {sha} resolves to nothing in this clone -- was it rewritten out of the history?")
        for rel in sorted(per_file)
        for sha in sorted(per_file[rel] & missing)
    ]


COMMENT_OPENERS: Final[tuple[str, ...]] = ("#", "//", "/*", "*")


@cache
def _fork(base: str) -> str:
    """The commit the branch is measured from, resolved once for every branch-scoped check."""
    return git("merge-base", base, "HEAD") or base


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


def branch_additions(base: str) -> dict[str, list[str]]:
    """Per file, the lines this branch adds that a reader reads: markdown, and any scanned comment.

    Ops files are in range because the checks reading this are COR-3's and COR-4's, and chapter 1
    binds every written artifact; the reader that filters this down to the comment-bearing source
    suffixes is `check_added_citations`, which enforces an INC rule.

    Source lines are filtered to comments here rather than through `comments_only`, since a diff
    hunk carries no surrounding file to decide from -- a line opening with a comment marker is what
    a reader sees as a comment, and a string that starts with one is rare enough to read past.
    """
    additions: dict[str, list[str]] = {}
    for rel, lines in (_added_by_file(_fork(base)) or {}).items():
        if not (rel.endswith(SCANNED_SUFFIXES) or rel.endswith((".md", *OPS_FILENAMES))):
            continue
        for _, raw in lines:
            text = raw.strip()
            if text and (rel.endswith(".md") or text.startswith(COMMENT_OPENERS)):
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


def check_branch_diff(base: str) -> list[Finding]:
    """The advisory covering every check that reads the branch's added lines.

    One advisory for the four of them, because they read one diff through `_added_by_file` and
    therefore degrade together: reported separately it would be the same sentence four times.
    """
    if _added_by_file(_fork(base)) is not None:
        return []
    return [_branch_scope_skipped("history, counts, added comment citations and comment length", "read this branch's diff")]


def check_comment_bounds(base: str) -> list[Finding]:
    """INC-9's bounds, over the comment blocks this branch wrote."""
    fork = _fork(base)
    changed = git("diff", "--name-only", fork) or ""
    added = _added_by_file(fork) or {}
    found: list[Finding] = []
    for rel in sorted({line.strip() for line in changed.split("\n") if line.strip()}):
        path = REPO_ROOT / rel
        if not rel.startswith(INCODE_SCOPES) or not rel.endswith(SOURCE_SUFFIXES) or not path.is_file() or _skipped(path):
            continue
        raw = _read_text(path)[0]
        if raw is None:
            continue
        found.extend(check_comment_length(rel, raw, path.suffix, {number for number, _ in added.get(rel, [])}))
    return found


def tolerate_console_encoding() -> None:
    """A console codepage must never decide whether a finding is printed.

    Every finding quotes the page it found, and a page carrying an arrow or a dash meets a Windows
    codepage that cannot encode it — which raises inside `print` and takes the run down with all of
    its findings unreported, on the machine the documentation is written on.
    """
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(errors="replace")


def main() -> int:
    tolerate_console_encoding()
    parser = argparse.ArgumentParser(description="Documentation gate (docs/_standard/chapters/5-currency.md).")
    parser.add_argument("--all", action="store_true", help="list every advisory finding, not just the first ten")
    parser.add_argument("--base", default="main", help="base ref for the branch-scoped checks (default: main)")
    args = parser.parse_args()

    files = tracked_files()
    if not files:
        print("      no files found -- nothing to check", file=sys.stderr)
        return 0

    # CI checkouts have no local branch for the base, only its remote-tracking ref -- without this
    # fallback the branch-scoped checks below silently ran against nothing on every CI run.
    base = args.base
    if git("rev-parse", "--verify", base) is None and git("rev-parse", "--verify", f"origin/{base}") is not None:
        base = f"origin/{base}"

    existing_adrs = adr_numbers()
    existing_rules = rule_ids()
    existing_invariants = invariant_ids()
    additions = branch_additions(base)
    findings: list[Finding] = []
    for path in files:
        findings.extend(check_file(path, existing_adrs, existing_rules, existing_invariants))
    findings.extend(check_stamps(files))
    findings.extend(check_stamp_missing())
    findings.extend(check_stamp_freshness(base))
    findings.extend(check_branch_impact(base))
    findings.extend(check_branch_diff(base))
    findings.extend(check_adr_meta())
    findings.extend(check_adr_index())
    findings.extend(check_roadmap())
    findings.extend(check_inputs())
    findings.extend(check_line_endings())
    findings.extend(check_spec_sheets())
    findings.extend(check_invariant_tables())
    findings.extend(check_overviews())
    findings.extend(check_glossary())
    findings.extend(check_enforced_by())
    findings.extend(check_rule_shape())
    findings.extend(check_rule_index(existing_rules))
    findings.extend(check_check_registry())
    findings.extend(check_segment_map())
    findings.extend(check_template_fragments())
    findings.extend(check_prose_shas(files))
    findings.extend(check_history_phrases(additions))
    findings.extend(check_counts(additions))
    findings.extend(check_added_citations(additions))
    findings.extend(check_comment_bounds(base))

    failures = [f for f in findings if f.severity == "fail"]
    reports = [f for f in findings if f.severity == "report"]

    if failures:
        print(f"\n      {len(failures)} failing finding(s):")
        for finding in failures:
            print(finding.line())

    if reports:
        print(f"\n      {len(reports)} advisory finding(s):")
        for finding in reports if args.all else reports[:10]:
            print(finding.line())
        if not args.all and len(reports) > 10:
            print(f"      ... and {len(reports) - 10} more -- scripts/check_docs.py --all lists every one")

    docs = sum(1 for f in files if f.suffix == ".md")
    sources = len(files) - docs
    print(f"\n      scanned {docs} documents and {sources} source files against {len(existing_adrs)} ADRs, {len(existing_rules)} rules")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
