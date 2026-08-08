# In-code documentation

**Verified against:** `09f903d`, 2026-08-08\
**Applies to:** source files — `fl_frontend/src`, `fl_backend/app`, `fl_backend/tests` and
`scripts/`: module headers, symbol docs, inline comments and test docstrings. A comment is
documentation and carries every rule in [`1-core.md`](1-core.md) too.

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
DB (ADR-<NNNN>)" — the why the line cannot say.

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

**Enforced by:** unenforced — review judgment.

**Example:** the copy blocks in [`templates/module-header.md`](../templates/module-header.md).

### INC-3 — Header content

**Rule:** `Invariants:` holds only statements a reasonable change could violate silently — never a
summary of what the code does. A decision is cited by ADR number with at most a one-line gloss,
never restated: the header says what is true here, the ADR says why and what lost. A header
passage outgrowing about five lines, or repeated in a second file, is an ADR that has not been
written yet — and only an ADR that exists may be cited, so writing it is part of the same change.

**Why:** the header is the copy nobody revisits, so an argument restated there goes stale in the
place a reader trusts most.

**Exceptions:** —

**Enforced by:** unenforced — review judgment; the citation itself by gate check `adr`.

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

**Rule:** an inline comment sits at the line it is about and carries the surprise — the
constraint, and ideally the failed alternative: what breaks if the reader does the obvious thing
instead.

**Why:** "the obvious alternative needs both the old and the new value to be correct" prevents a
change; a description of the line prevents nothing.

**Exceptions:** —

**Enforced by:** unenforced — review judgment.

**Example:** —

### INC-6 — Comment citations are gate-checked

**Rule:** a comment cites the way `docs/` cites (COR-6) — an ADR number or an anchored
`<path> :: <symbol>`, never an audit id, a ledger row or a session. The gate scans the comments of
every tracked source file exactly as it scans a spec sheet. Executable code is not scanned: a
path-shaped string in a function body is data the program uses, not a claim made to a reader.

**Why:** a dangling reference beside code misleads more effectively than one in a document,
because a comment sits where a reader trusts most.

**Exceptions:** —

**Enforced by:** gate checks `adr`, `citation` and `line-citation`, over comments.

**Example:** `// … to be correct (ADR-<NNNN>).` — never `// … to be correct (ledger <row>).`

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
