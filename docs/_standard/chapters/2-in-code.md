# In-code documentation

**Verified against:** `cda2912d`, 2026-08-19\
**Applies to:** source files — `fl_frontend/src`, `fl_backend/app`, `fl_backend/tests`,
`scripts/` and `.claude/hooks/`: module headers, symbol docs, inline comments and test docstrings.
The hooks are exempt from INC-2 alone: their uniform label rows are what keeps a folder of
one-purpose scripts scannable side by side, and every other rule here binds them. A comment is documentation and
carries every rule in [`1-core.md`](1-core.md) too.

| ID    | Rule                                      |
| ----- | ----------------------------------------- |
| INC-1 | Why over what                             |
| INC-2 | The module header shape                   |
| INC-3 | Header content                            |
| INC-4 | Symbol docs where they carry something    |
| INC-5 | Inline comments at the line of temptation |
| INC-6 | Comment citations are gate-checked        |
| INC-7 | Placement mechanics                       |
| INC-8 | A test docstring says what is covered     |
| INC-9 | An inline comment block's bounds          |

---

### INC-1 — Why over what

**Rule:** a comment records what cannot be re-derived from the source — the constraint, the
rejected alternative, the trap. Never what the next line does, and never a type the signature
already declares: no `@param`/`@returns` blocks, no `Args:`/`Returns:` sections.

**Why:** clear code already says what, and every restatement is one more thing that can go out of
date on its own.

**Exceptions:** —

**Enforced by:** unenforced — review judgment.

**Example:** "Resolved here, not as a field default: a default is a constant and cannot query the
DB" — the why the line cannot say.

### INC-2 — The module header shape

**Rule:** a module header is a plain block:

- a title line `<TOKEN> · <what this module is>`
- at most three sentences of prose, why-first — a sentence of plain "what" is allowed where the
  file's contents do not carry it
- optional plain lists labelled `Invariants:` and `See:`, one line per entry, no other list label
- hard cap 20 lines including the comment delimiters
- no ruled lines, no fixed column, no upper-case label rows

**Why:** a header is an entry point, not a bulletin board — past twenty lines it displaces the
code it introduces, and drawn rules invite crooked hand-maintained decoration.

**Exceptions:** —

**Enforced by:** gate check `module-header` — the line cap, the title line, the banned vocabulary,
and a header placed below the imports; gate check `header-see`, which resolves every file a `See:`
entry names. The three-sentence bound and whether a file carries a header at all are review
judgment: counting sentences mechanically breaks on every abbreviation.

**Example:** the copy blocks in [`templates/module-header.md`](../templates/module-header.md).

### INC-3 — Header content

**Rule:** `Invariants:` holds only statements a reasonable change could violate silently — never a
summary of what the code does. A decision is stated as the constraint it imposes, never as the
argument behind it: the header says what is true here, and the commit that made it says what lost.
A header passage outgrowing about five lines, or repeated in a second file, belongs in a
spec-sheet invariant instead, written in the same change.

**Why:** the header is the copy nobody revisits, so an argument restated there goes stale in the
place a reader trusts most.

**Exceptions:** —

**Enforced by:** unenforced — review judgment.

**Example:** `Invariants: <field> reaches the action as an argument, never on the request body.` —
a change could move it, and nothing would fail loudly.

### INC-4 — Symbol docs where they carry something

**Rule:** a docstring is required in exactly two places — every FastAPI endpoint, published as the
operation description in `/openapi.json`, so its first paragraph is written for a reader of the
API; and anywhere with a why worth recording. There is no every-exported-symbol rule; everywhere
else is judgment.

**Why:** a coverage rule manufactures filler on symbols whose names already say everything, and
filler buries the one sentence that matters.

**Exceptions:** test functions, which INC-8 governs.

**Enforced by:** unenforced — review judgment.

**Example:** —

### INC-5 — Inline comments at the line of temptation

**Rule:** an inline comment sits at the line it is about — the line someone would change, never the
top of the function. What it carries is INC-1's; where the constraint has a failed alternative, that
is the half to write down: what breaks if the reader does the obvious thing instead.

**Why:** "the obvious alternative needs both the old and the new value to be correct" prevents a
change; a description of the line prevents nothing.

**Exceptions:** —

**Enforced by:** unenforced — review judgment.

**Example:** —

### INC-6 — Comment citations are gate-checked

**Rule:** a comment cites the way `docs/` cites (COR-6) — an anchored `<path> :: <symbol>`, a rule
id or an invariant id, never an audit id, a ledger row, a roadmap id, a session or an issue number.
Issue numbers are banned because the 2026-08-01 repository recreation destroyed every issue that
existed, and an unrecorded reason is a rule somebody eventually overturns by accident. A link to
code outside this repository is pinned to a commit: a `blob/main/…#L36-L49` link drifts silently and
three commits later points at whatever now occupies those lines, which is worse than a dead link
because it still looks right. The gate scans comments exactly as it scans a spec sheet, and holds
them to the same checks: every tracked TypeScript, JavaScript, Python and shell file, and — beyond
this chapter's scope — every tracked configuration file scanned beside them
(`scripts/check_docs.py :: SCANNED_SUFFIXES`), Dockerfiles included, wherever it sits: `nginx/`'s
configuration, the compose files, the image definitions, the package and tool manifests, and
`.github/`'s workflow, issue and action configuration, which COR-6 binds as it binds any other
written artifact. Executable code is not scanned: a path-shaped string in a function body is data
the program uses, not a claim made to a reader. A path written into a comment without backticks is
read too, because the citation checks see only backticked tokens and an unmarked path is how a dead
one survives a green gate.

**Why:** a dangling reference beside code misleads more effectively than one in a document,
because a comment sits where a reader trusts most.

**Exceptions:** —

**Enforced by:** gate checks `citation`, `line-citation`, `comment-citation`, `path`,
`bare-path`, `link` and `rule-id`, over comments; an issue number, a session and an unpinned outside
link are review judgment.

**Example:** `// … to be correct (<path> :: <symbol>).` — never `// … to be correct (ledger <row>).`

### INC-7 — Placement mechanics

**Rule:** a directive (`"use server"`, `"use client"`, `"use strict"`) is the file's first line,
above the header block. In Python the module docstring is the first statement, above the imports.
A docstring opens with its summary line — title first, then a blank line, then prose. Docstring
enforcement is a formatting subset only: the selected ruff `D` codes live in
`fl_backend/pyproject.toml`, and the missing-docstring `D1xx` family stays off.

**Why:** a misplaced directive fails at request time rather than build time; a Python docstring
below the imports is silently a dead string expression; and `D1xx` would demand exactly the filler
INC-4 rejects.

**Exceptions:** —

**Enforced by:** ruff's `D` selection for the formatting half; the placement rules are review
judgment.

**Example:** —

### INC-8 — A test docstring says what is covered

**Rule:** every Python test function carries a docstring that says what is covered — what the
parametrised cases span and which one is load-bearing, the failure it guards against, why a case
that looks redundant is not. Never a paraphrase of the test name. In TypeScript the `it("…")`
string is the sentence; where it cannot carry everything, a `//` comment above the case does.
Fixtures in `conftest.py` are out of scope.

**Why:** the name says what the test is called; a reader deciding whether a change is safe needs
what it covers, which a name cannot carry.

**Exceptions:** —

**Enforced by:** unenforced — review judgment; ruff's `D` subset shapes the docstrings that exist.

**Example:** a five-case parametrise whose docstring names the one shape a naive check would let
through.

### INC-9 — An inline comment block's bounds

**Rule:** an inline comment block satisfies **both** bounds at once — at most **3 lines** and at
most **250 characters**, measured on the comment text with the markers and the indentation
stripped. Neither bound stands alone: three lines at full width and one very long line are the same
comment with its line breaks moved. Past either, the reasoning belongs in a spec-sheet invariant,
and the comment is the line that cites it. A module header is not an inline comment and keeps
INC-2's separate 20-line cap; a symbol doc is INC-4's.

**Why:** a comment is read in the flow of the code it interrupts, and past a few lines it stops
being an aside and becomes a document nobody maintains in the one place a reader trusts most.
Measured 2026-08-09 across 1,569 blocks: 82% were already inside the line bound and 28% exceeded
250 characters, at a mean of 212 — so the bound describes what this repository mostly already does.

**Exceptions:** —

**Enforced by:** gate check `comment-length`, over the blocks a branch writes. A block the branch
only touched is left to `/docs:audit`, which owns accumulated staleness (CUR-6).

**Example:** "The obvious alternative needs both the old and the new value to be correct." — the
constraint, in the space the bounds allow.
