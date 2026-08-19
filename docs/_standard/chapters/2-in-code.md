# In-code documentation

**Verified against:** `cda2912d`, 2026-08-19\
**Applies to:** source files — `fl_frontend/src`, `fl_backend/app`, `fl_backend/tests`, `scripts/`
and `.claude/hooks/`: module headers, symbol docs, inline comments and test docstrings. The hooks are
exempt from INC-2's shape alone, their uniform label rows being what keeps a folder of one-purpose
scripts scannable side by side, and every other rule here binds them. A comment is documentation and carries
every rule in [`1-core.md`](1-core.md) too.

| ID    | Rule                                      |
| ----- | ----------------------------------------- |
| INC-1 | Why over what                             |
| INC-2 | The module header, and where one survives |
| INC-4 | Symbol docs where they carry something    |
| INC-6 | Comment citations are gate-checked        |
| INC-8 | A test docstring says what is covered     |
| INC-9 | A comment block's bounds                  |

---

### INC-1 — Why over what

**Rule:** a comment records what cannot be re-derived from the source — the constraint, the rejected
alternative, the trap. Never what the next line does, and never a type the signature declares: no
`@param`/`@returns` blocks, no `Args:`/`Returns:` sections.

**Why:** clear code already says what, and every restatement is one more thing that can go out of
date on its own.

**Enforced by:** unenforced — review judgment.

**Example:** "Resolved here, not as a field default: a default is a constant and cannot query the
DB" — the why the line cannot say.

### INC-2 — The module header, and where one survives

**Rule:** a module header survives in a **shell script**, and in a Python module under
`fl_backend/app/` or `scripts/` carrying a fact that attaches to no symbol — an exit contract, a
one-cache-per-run rule, a carve-out the whole module rests on. TypeScript, TSX, JavaScript and Python
test modules carry none: a comment sits at the thing it explains, and only a script has no first
symbol to attach to.

Where one survives it is a plain block — a title line `<TOKEN> · <what this module is>`, at most
three sentences why-first, a sentence of plain "what" allowed where the file's contents do not carry
it, optional plain `Invariants:` and `See:` lists one line per entry, no other list label, no ruled
lines, no fixed column, no upper-case label rows. **Hard cap 20 lines including the delimiters.**

**Why:** a header is an entry point, not a bulletin board — past a few lines it displaces the code it
introduces, and drawn rules invite crooked hand-maintained decoration. The languages that lose it
lose it because the convention was never honoured uniformly there, and a header nobody writes
consistently is one a reader cannot trust to be present.

**Enforced by:** gate check `module-header` — the line cap, the title line, the banned vocabulary,
and a header placed below the imports; gate check `header-see`, which resolves every file a `See:`
entry names. The three-sentence bound, and which files may carry a header at all, are review
judgment: counting sentences mechanically breaks on every abbreviation.

### INC-4 — Symbol docs where they carry something

**Rule:** a docstring is required in exactly two places — every FastAPI endpoint, published as the
operation description in `/openapi.json`, so its first sentence is written for a reader of the API;
and anywhere with a why worth recording. There is no every-exported-symbol rule.

An endpoint's docstring says what the operation does and any behaviour a caller would be surprised
by. The domain rules behind that behaviour stay in the surface spec sheet, which PRE-1 makes the
authority: restating them here is the duplication COR-2 forbids, and it is what grew these
descriptions past anything a caller reads.

**Why:** a coverage rule manufactures filler on symbols whose names already say everything, and
filler buries the one sentence that matters.

**Exceptions:** test functions, which INC-8 governs.

**Enforced by:** gate check `comment-length` for the bounds (INC-9); that an endpoint carries one at
all is review judgment.

### INC-6 — Comment citations are gate-checked

**Rule:** a comment cites the way `docs/` cites (COR-6) — an anchored `<path> :: <symbol>`, a rule id
or an invariant id, never an audit id, a ledger row, a roadmap id, a session or an issue number.
Issue numbers are banned because the 2026-08-01 repository recreation destroyed every issue that
existed, and an unrecorded reason is a rule somebody eventually overturns by accident. A link to code
outside this repository is pinned to a commit: a link naming a branch and a line range drifts
silently and later points at whatever now occupies those lines, which is worse than a dead link
because it still looks right.

The gate scans comments exactly as it scans a spec sheet: every tracked TypeScript, JavaScript,
Python and shell file, and — beyond this chapter's scope — every tracked configuration file scanned
beside them (`scripts/check_docs.py :: SCANNED_SUFFIXES`), Dockerfiles included, wherever it sits.
Executable code is not scanned: a path-shaped string in a function body is data the program uses, not
a claim made to a reader. A path written into a comment without backticks is read too, because the
citation checks see only backticked tokens and an unmarked path is how a dead one survives a green
gate.

**Why:** a dangling reference beside code misleads more effectively than one in a document, because a
comment sits where a reader trusts most.

**Enforced by:** gate checks `citation`, `line-citation`, `comment-citation`, `path`, `bare-path`,
`link` and `rule-id`, over comments; an issue number, a session and an unpinned outside link are
review judgment.

**Example:** `// … to be correct (<path> :: <symbol>).` — never `// … to be correct (ledger <row>).`

### INC-8 — A test docstring says what is covered

**Rule:** a Python test function carries a docstring only where it says what the name cannot — what a
parametrised set spans and which case is load-bearing, the failure it guards against, why a case that
looks redundant is not. Never a paraphrase of the test name; a docstring that restates the name is
deleted rather than shortened. In TypeScript the `it("…")` string is the sentence, and where it
cannot carry everything a `//` comment above the case does. Fixtures in `conftest.py` are out of
scope.

**Why:** the name says what the test is called; a reader deciding whether a change is safe needs what
it covers, which a name cannot carry.

**Enforced by:** gate check `comment-length` for the bounds (INC-9); ruff's `D` subset shapes the
docstrings that exist. Whether one is a name-paraphrase is review judgment.

**Example:** a five-case parametrise whose docstring names the one shape a naive check would let
through.

### INC-9 — A comment block's bounds

**Rule:** a comment block satisfies **both** bounds at once — at most **250 characters**, and at most
**3 lines** for an inline comment or **6 lines** for a symbol doc, measured on the comment text with
markers and indentation stripped. The character bound is one number for every shape: a symbol doc
gets the extra lines only to pay for its delimiters, a summary line and the blank line after it, not
for extra prose. Past either bound the reasoning belongs in a spec-sheet invariant, and the comment
is the line that cites it. A module header is neither, and keeps INC-2's separate cap.

**The bounds are a ceiling, never a target.** A comment that carries its point in sixty characters is
finished at sixty. Writing to the cap produces a block sized by the rule rather than by its content,
and a corpus written that way reads as uniformly long rather than uniformly considered.

**Why:** a comment is read in the flow of the code it interrupts, and past a few lines it stops being
an aside and becomes a document nobody maintains in the one place a reader trusts most. One bound for
every shape is what stops the rule being avoided by moving a paragraph from beside a symbol to above
it. The shape that grew was the unbounded one: measured 2026-08-19 across every tracked source file,
symbol docs hold roughly half the comment words, and while the bound reached inline comments alone
they were free to hold a document apiece.

**Enforced by:** gate check `comment-length`, over the blocks a branch writes. A block the branch only
touched is left to `/docs:audit`, which owns accumulated staleness (CUR-6).

**Example:** "The obvious alternative needs both the old and the new value to be correct." — the
constraint, in a fraction of the space the bounds allow.
