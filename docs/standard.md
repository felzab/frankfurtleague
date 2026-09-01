# Documentation standard

**Purpose:** every rule a written artifact in this repository follows — `docs/` pages, module
headers, docstrings, comments, prompts, command files, commit messages and pull request bodies.
The mechanical defence is `scripts/check_docs.py`, run by `./scripts/verify.sh` in its docs scope;
the registry of its checks is `scripts/docs_gate/kernel.py :: CHECKS`, and the finding a check
prints says what its failure means.

| Section                   | Holds                                        |
| ------------------------- | -------------------------------------------- |
| [Precedence](#precedence) | Which source wins, and the anatomy of a rule |
| [Core](#core)             | The rules binding every written artifact     |
| [In-code](#in-code)       | Headers, docstrings, comments                |
| [Corpus](#corpus)         | The `docs/` tree and every README            |
| [Currency](#currency)     | The same-commit rule and the audit           |

## Precedence

- **PRE-1:** when two sources disagree the higher wins: the code and what it actually does, then a
  spec sheet for a current contract, then CLAUDE.md, then an overview — one deterministic answer,
  or every conflict becomes a fresh judgment call taken under pressure. _Enforced by_ unenforced —
  judgment at the moment two sources disagree.
- **PRE-2:** correct the summary, never the source. Where any document disagrees with the code,
  the document is wrong: fix it in the commit that discovered it. Editing the source to match its
  summary launders a transcription error into a decision. _Enforced by_ unenforced — judgment.

### PRE-4 — The anatomy of a rule

**Rule:** a rule lives in this file, exactly once, in one of two shapes: a list line
`- **<ID>:** <the whole rule>`, whose one line is everything a citation of the id resolves to; or
a section `### <ID> — <the rule as a claim>` carrying `**Rule:**`, `**Why:**`, an optional
`**Exceptions:**`, `**Enforced by:**` and an optional `**Example:**`, in that order, an optional
field appearing only when it carries something. A rule earns a section only where it is
mechanically enforced or it prevented a failure that actually happened; everything else is a line.

`Enforced by` names only checks the gate emits, a named read of a command, a linter selection, or
says the rule is unenforced. A rule and the check it claims land in the same commit, and the
check is proven against a constructed violation first — planted in its real position on a real
page, never against an example of its shape. A check whose subjects are derived from the property
it asserts can never fail — a subject lacking it drops out of the listing instead of failing — so
the population is derived independently of the property: two listings reached by different
routes, required to agree, so narrowing either breaks the agreement rather than shrinking the
sweep — and floored on something other than the roster counted against itself.

**Why:** the enforcement field is the line a reader trusts without checking, so a claim
overstating the gate is worse than an unenforced rule: it reads as covered and nobody looks again.

**Enforced by:** gate checks `enforced-by`, which resolves every backticked check name a field
carries; `rule-id`, which resolves every cited id to exactly one home here; and `rule-shape`, for
the two shapes and the field order. Proving a new check is review judgment.

## Core

These bind every written artifact. A comment is documentation and carries every rule here too.

- **COR-1:** write for a stranger — no conversation, session or past effort, no identifier that
  fails to resolve, and the reasoning at the claim rather than behind a pointer to a file deleted
  by design. _Enforced by_ `/docs:audit` (the cold read).
- **COR-6:** a citation is a backticked `<path> :: <symbol>` or `<path> :: <short quoted
fragment>`, a bare backticked repository path, or a rule id or invariant id — never a line
  number, in any form: a line number is wrong the moment anything is inserted above it, and
  nothing can tell a correct one from a stale one.
  _Enforced by_ gate checks `citation`, `path`, `rule-id` and `line-citation`.
- **COR-7:** purpose in the first lines; a reference longer than about a hundred lines — consulted
  at a point rather than read through — carries a table of its sections against the question each
  answers. Command files under `.claude/` and pass prompts under `docs/_auditing/prompts/` are
  exempt: each is a script for one run. A reference living beside the prompts — the shared
  protocol every pass reads — is not a prompt and stays in scope.
  _Enforced by_ `/docs:audit` (the shape read).
- **COR-8:** rules as lists, one rule per item; tables for anything enumerable, prose for anything
  needing a "because"; bold the claim, never the paragraph; headings state the rule, not the
  topic; no nesting past three levels. Metadata lines each end with a hard break — a trailing
  backslash — when another follows, so they render one per line; the last carries none.
  _Enforced by_ gate check `metadata-break` for the hard breaks, in both directions; the rest is
  `/docs:audit` (the shape read).
- **COR-9:** state doubt — what was verified, what was assumed and why, which reading you chose
  and which you rejected, and the measurement where a claim rests on one. Never present a plan as
  a description. _Enforced by_ `/docs:audit` (the doubt read).
- **COR-10:** a normative document — this file, a command file — never embeds a real path, symbol
  or value as an example; placeholders only, with worked examples in the specs and overviews,
  which the gate checks. A rule's own subject may be a real path. _Enforced by_ `/docs:audit`.
- **COR-11:** the words "the owner" appear in no tracked file outside `.claude/` — everything so
  written speaks in my own voice: first person where a person acts, neutral imperative everywhere
  else. `.claude/` is exempt whole, because it instructs the assistant and needs me named as a
  third party to be unambiguous; quoting the phrase to name what is banned is a mention, not a
  use. _Enforced by_ gate check `owner-voice`, which reads a quoted or backticked occurrence as
  the mention it is; `/docs:audit` for the third-person constructions that avoid the phrase.

### COR-2 — Say it once

**Rule:** a fact is stated in full in exactly one place — its home — and cited from everywhere
else: a why at its line, a module fact in its header, a decision in the commit that took it with
the constraint at the line, a contract in the surface spec sheet, a surface's purpose in its
overview, a session rule in CLAUDE.md pointing at the source. A rule obeys the same split: the
enforcement layer (CLAUDE.md, the gate's messages) states it, and the reasoning layer (this file)
carries the argument. A second mention exists only where a reader standing there needs the claim:
the claim briefly, plus the citation. Where nobody standing there needs it, the copy is deleted
with nothing in its place.

**Why:** a fact stated twice eventually disagrees with itself, and the copy nobody revisits is the
one that goes stale.

**Exceptions:** one duplicate survives — the one a reader cannot reach by citation at all, because
something other than a reader consumes it at a fixed location: a path a platform serves, or a form
a tool quotes verbatim. Convenience is never the reason, and neither is the copy being short.

**Enforced by:** `/docs:audit` (the duplication read).

### COR-3 — Name only what exists

**Rule:** no document names a file, symbol, field, endpoint or behaviour absent from the
repository right now. Two shapes are banned outright: narrating an edit, and documenting an
absence for its own sake. A rejected alternative is neither — write it in the present, as a
constraint aimed at the reader about to propose it again. A measurement carrying its date is a
record, not history.

**Why:** a page naming something gone reads exactly like one naming something live, and a reader
cannot tell the two apart without checking.

**Exceptions:** `docs/_roadmap/closed-items.md`, whose subject is what happened, within that job.
A pointer a reader would act on today is not shape, and stays in scope.

**Enforced by:** gate check `history` (reported over the branch diff — the hits must be read), and
`/docs:audit`.

### COR-4 — Ban the facts that rot fastest

**Rule:** never written as facts about now: a count (derive it at read time or omit it; write one
only when it is the point of the sentence, and then with the date it was measured); an enumeration
or an ordinal (name what selects the set instead); a version number (cite the manifest); a tool's
current configuration (cite the config file); a line number (anchor the citation instead, COR-6).
More generally: a value the repository states elsewhere is cited, never repeated. What this bans
is a count of something outside the sentence stating it — a set the same sentence closes is
definition, not a claim.

**Why:** each goes wrong at some point after it is written, nothing detects the moment, and a
reader who catches one stops trusting the page.

**Enforced by:** gate check `line-citation` for the line-number half; gate check `counts`, which
reports cardinal and ordinal words in a branch's changed prose and comments — a list to read, not
a failure; `/docs:audit` for the rest.

### COR-5 — Concise by selection, and earn the space

**Rule:** cut whole sentences that carry no instruction — preamble, restatement, closing
summaries, justification for a decision already taken. Never compress the sentences that remain:
spell terms out and keep the words that make a sentence readable. A remark a competent reader
already knows, or that the code beside it states, is deleted rather than shortened. A page earns
its place by being worth opening once, and is never deleted for being long; a comment earns its
place only by carrying what the source cannot (INC-1). Any bound this standard sets is a ceiling,
never a target: writing to a cap produces prose sized by the rule rather than by its content.

**Why:** length is not the constraint — readability is, and a small accurate corpus is one that
can be kept true.

**Exceptions:** never cut a caveat that changes what someone would do, the failure mode behind a
rule, or the reason a constraint exists.

**Enforced by:** unenforced — review judgment, and `/docs:audit` where a deletion is proposed.

### COR-12 — A defined shape is never widened

**Rule:** a file whose kind has a defined structure never deviates from it. Never once, never for
one file, never by approval. Where a file does not fit, **the file changes**: the content that
does not fit moves to a page whose shape holds it, or it goes. The shapes are fixed by a README's
rule (OUT-3), a spec sheet's (OUT-4), an overview's (OUT-5), a glossary entry's (OUT-6), a module
header's (INC-2) and a rule's own (PRE-4).

**Why:** the file that will not fit is almost always the one carrying content in the wrong place,
and the widening is the cheaper repair every time it is offered.

**Enforced by:** gate checks `readme-cap`, `spec-spine`, `invariant-row`, `overview-spine`,
`glossary-entry`, `module-header` and `rule-shape` for the shapes they hold. Whether a deviation
was repaired by moving the content or by widening the shape is review judgment.

## In-code

Scope: `fl_frontend/src`, `fl_backend/app`, `fl_backend/tests`, `scripts/` and `.claude/hooks/`.
The hooks are exempt from INC-2's shape alone — their uniform label rows keep the folder
scannable side by side — and every other rule here binds them.

- **INC-1:** a comment records what cannot be re-derived from the source — the constraint, the
  rejected alternative, the trap — and sits at the line of temptation: the line someone would
  change, never the top of the function. Never what the next line does, and never a type the
  signature declares: no `@param`/`@returns` blocks, no `Args:`/`Returns:` sections.
  _Enforced by_ unenforced — review judgment.
- **INC-7:** directive first line · a Python docstring is the first statement, above the imports ·
  summary line, then a blank line, then prose. Docstring enforcement is a formatting subset only:
  the selected ruff `D` codes live in `fl_backend/pyproject.toml`, and the missing-docstring
  `D1xx` family stays off, because it would demand exactly the filler INC-4 rejects.
  _Enforced by_ ruff's `D` selection for the formatting half; placement is review judgment.

### INC-2 — The module header, and where one survives

**Rule:** a module header survives in a **shell script**, and in a Python module under
`fl_backend/app/`, `fl_backend/tests/` or `scripts/` — the tests in both trees included — carrying
a fact that attaches to no symbol: an exit contract, a one-cache-per-run rule, a carve-out the
whole module rests on; `scripts/docs_gate/checks.py :: HEADER_SCOPES` is that scope. TypeScript,
TSX and JavaScript modules carry none: a comment sits at the thing it explains. Where one survives
it is a plain block — a title line `<TOKEN> · <what this module is>`,
at most three sentences why-first, a sentence of plain "what" allowed where the file's contents do
not carry it, optional plain `Invariants:` and `See:` lists one line per entry, no other list
label, no ruled lines, no fixed column, no upper-case label rows. A header states a rule in a line
and never the argument behind it; `Invariants:` holds only what a change could violate silently;
and a passage outgrowing a few lines, or repeated in a second file, becomes a spec-sheet invariant
in the same change. **Hard cap 20 lines including the delimiters.** The shell form:

```sh
#!/usr/bin/env bash
#
# <TOKEN> · <what this script is>
#
# <At most three sentences, why-first.>
```

The Python form is the module docstring, above the imports (INC-7), same title line, with the
optional lists below it.

**Why:** a header is an entry point, not a bulletin board — past a few lines it displaces the code
it introduces, and drawn rules invite crooked hand-maintained decoration.

**Enforced by:** gate check `module-header` — the line cap, the title line, the banned vocabulary,
and a header placed below the imports; gate check `header-see`, which resolves every file a `See:`
entry names. The three-sentence bound, and which files may carry a header at all, are review
judgment.

### INC-4 — Symbol docs where they carry something

**Rule:** a docstring is required in exactly two places — every FastAPI endpoint, published as the
operation description in `/openapi.json`, so its first sentence is written for a reader of the
API; and anywhere with a why worth recording. There is no every-exported-symbol rule. An
endpoint's docstring says what the operation does and any behaviour a caller would be surprised
by; the domain rules behind that behaviour stay in the surface spec sheet, which PRE-1 makes the
authority. Test functions are INC-8's.

**Why:** a coverage rule manufactures filler on symbols whose names already say everything, and
filler buries the one sentence that matters.

**Enforced by:** gate check `comment-length` for the bound (INC-9); that an endpoint carries one
at all is review judgment.

### INC-6 — Comment citations are gate-checked

**Rule:** a comment cites the way `docs/` cites (COR-6) — an anchored `<path> :: <symbol>`, a
rule id or an invariant id, never an audit id, a ledger row, a roadmap id, a session or an issue
number: the 2026-08-01 repository recreation destroyed every issue that existed. A link to code
outside this repository is pinned to a commit — one naming a branch and a line range drifts
silently. The gate scans comments in every tracked TypeScript, JavaScript, Python and shell file,
and every tracked configuration file scanned beside them
(`scripts/check_docs.py :: SCANNED_SUFFIXES`), Dockerfiles included. Executable code is not
scanned: a path-shaped string in a function body is data. An unbackticked path in a comment is
read too, because an unmarked path is how a dead one survives a green gate.

**Why:** a dangling reference beside code misleads more effectively than one in a document,
because a comment sits where a reader trusts most.

**Enforced by:** gate checks `citation`, `line-citation`, `comment-citation`, `path`, `bare-path`,
`link` and `rule-id`, over comments; an issue number, a session and an unpinned outside link are
review judgment.

### INC-8 — A test docstring says what is covered

**Rule:** a Python test function carries a docstring only where it says what the name cannot —
what a parametrised set spans and which case is load-bearing, the failure it guards against, why a
case that looks redundant is not. Never a paraphrase of the test name; a docstring that restates
the name is deleted rather than shortened. In TypeScript the `it("…")` string is the sentence, and
where it cannot carry everything a `//` comment above the case does. Fixtures in `conftest.py` are
out of scope.

**Why:** a reader deciding whether a change is safe needs what the test covers, which a name
cannot carry.

**Enforced by:** gate check `comment-length` for the bound (INC-9); ruff's `D` subset shapes the
docstrings that exist. Whether one is a name-paraphrase is review judgment.

### INC-9 — A comment block's bound

**Rule:** a comment block is at most **250 characters**, measured on the comment text with markers
and indentation stripped — one number for every shape: inline comment, symbol doc and test
docstring alike. Past the bound the reasoning belongs in a spec-sheet invariant, and the comment
is the line that cites it. A module header is neither, and keeps INC-2's separate cap. A blank
line separates two comments, or the checker reads them as one block; a bare `#` between them joins
the run rather than ending it, and a formatter can delete the blank line inside an argument list,
so a two-paragraph comment moves above the statement, where the break survives. The bound is a
ceiling, never a target.

**Why:** a comment is read in the flow of the code it interrupts, and past a few lines it becomes
a document nobody maintains in the one place a reader trusts most. One bound for every shape is
what stops the rule being avoided by moving a paragraph from beside a symbol to above it.

**Enforced by:** gate check `comment-length`, over the blocks a branch writes. A block the branch
only touched is left to `/docs:audit`, which owns accumulated staleness (CUR-6).

## Corpus

Scope: the `docs/` tree — its layers, its layout, and every README in the repository.

- **OUT-2:** per-surface folders, each holding that surface's overview and spec, with the meta
  collections underscore-prefixed so they sort above them. A directory holds a collection: a lone
  cross-cutting reference is a file at the root until two or three share a theme. A per-slice page
  exists only where a slice deviates from the surface spec. _Enforced by_ review judgment.
- **OUT-5:** overview spine — a two-or-three-sentence opening, "How it is organised", sections,
  "Read next"; ~120 lines treated as a ceiling. Mechanisms belong in the spec sheet, and the
  argument for one in the commit that introduced it. _Enforced by_ gate check `overview-spine` for
  the first and last sections; the ceiling and what sits between are `/docs:audit`'s.
- **OUT-7:** diagrams are mermaid so they render in-repo, C4 levels 1–3 and never a code diagram,
  with no square brackets inside a quoted node label. They live in overviews, plus a spec sheet
  where a data flow is genuinely hard in prose. _Enforced by_ review judgment.
- **OUT-8:** a surface is one of the three parts of the system a reader goes to as a whole —
  frontend (`fl_frontend/`), backend (`fl_backend/`), and ops (the compose files, `nginx/`,
  `scripts/`, the Dockerfiles). Ops owns the scripts and what they guarantee; `docs/_git/` owns
  the pipeline that invokes them and the GitHub configuration. A surface is not a slice, not a
  layer, not a directory; the references belonging to none are `docs/glossary.md`, `docs/logging/`
  and `docs/domain.md`. _Enforced by_ review judgment.

### OUT-1 — Two layers, two update triggers

**Rule:** `docs/` holds two layers — the spec sheets, which are the current contract and are
edited when a constraint changes; and the surface overviews, which say what a surface is for and
are rewritten only when that changes. The two shapes are called layers, and layer is the only word
for them anywhere in `docs/`. A new page is one of the two, or a named exception, or it does not
go in. Why something is built this way sits at the constraint itself — a comment at the line, a
CLAUDE.md §7 line, or a spec-sheet invariant — with the argument in the commit that made it.

**Why:** each layer's update trigger is attached to work that happens anyway, which is what lets
the corpus stay true without a scheduled review.

**Exceptions:** the cross-cutting references (OUT-8), this file, the process folders
(`docs/_auditing/`, `docs/_git/`, `docs/_roadmap/`), `docs/domain.md` — a narrative over tables a
test walks — and `docs/ops/runbooks.md`: a procedure is followed at a keyboard rather than read
for a constraint, and belongs beside the surface it operates.

**Enforced by:** unenforced — review judgment.

### OUT-3 — A README is orientation, plus at most one bounded body section

**Rule:** a README carries a title naming the folder, a `Folder purpose:` line, a navigation table
under `## Folder overview`, and at most **one** body section — the single thing a reader needs
before opening anything in the table. **Hard cap 120 lines.** No rules, no worked examples, no
precedence, no term definitions, which live in this file, a spec sheet or the glossary. A closing
`## Read next` is navigation, not a body section, and appears only where the table does not
already send the reader there. The repository's root `README.md` is the sole exception, being the
project's public landing page; the line cap still reaches it.

**Why:** a README that carries rules is a second copy of them, and the copy a reader lands on
first is the one that goes stale.

**Enforced by:** gate check `readme-cap` (the line cap); `/docs:audit` (the shape read).

### OUT-4 — The spec-sheet spine

**Rule:** a spec sheet opens with its scope and its section table (COR-7), then carries exactly
four sections: `1. Contract`, holding as many `1.<n>` subsections as the surface needs;
`2. Invariants`; `3. Violation → remedy`; and `4. Known-open`. The invariant table is three
columns — the number, the invariant, and what enforces it. Numbers are `I<n>` on a surface sheet
and `L<n>` on the logging sheet, permanent and never reused **within their own sheet**; they are
not unique across the corpus, so a citation crossing sheets names the sheet. **Section 2 holds
that table and nothing else**; a symptom a reader would observe is a row in section 3, and the
argument for an invariant is in the commit that made it. Section 4 holds the accepted gaps, each
stated in the sheet's own words — a roadmap id never appears there, an open entry living on its
ranked page alone — so a known limitation never reads as an oversight and gets "fixed". Every claim
carries an anchored citation (COR-6).

**Why:** fixed closing sections make separate spec sheets read as one document, and a contract
that grows inside section 1 is what keeps those numbers — and every citation of them — fixed.

**Enforced by:** gate check `spec-spine` for the four sections and the contract's `1.<n>`
numbering; gate check `invariant-row` for a row's column count, its number's uniqueness, and a row
in section 2 that is neither an invariant nor its header; gate check `invariant-id` for a cited
number resolving to a defined invariant; gate checks `citation` and `path` for the anchors.

### OUT-6 — The glossary

**Rule:** the domain vocabulary lives in one file, `docs/glossary.md`, one entry per term: a
`### ` heading giving the term as code spells it and a one-line gloss, then the fields `Is`,
`In code`, `Trap` and `See`, in that order. Where the code and the domain spell one thing
differently, the spellings share an entry.

**Why:** the vocabulary is load-bearing and ambiguous in ways only the pitfall lines record.
`Trap` is the field a hurried entry drops and the one the glossary exists for.

**Enforced by:** gate check `glossary-entry` — the heading's shape, and the four fields in order.

## Currency

- **CUR-1:** claims about current behaviour are anchored so the gate can check them; a document
  that cannot state anchored claims is in the wrong shape, and narrative prose about current
  behaviour moves into a spec sheet rather than being promised a re-read. _Enforced by_ gate
  checks `citation` and `path` for the anchors; that a claim carries one is `/docs:audit`'s.
- **CUR-6:** the gate holds a branch to what that branch touched, and nothing else — a gate
  failing branches over pages they never touched trains people to override it. What no change has
  touched is `/docs:audit`'s job: invoked, never scheduled, catching up rather than defending. One
  branch's documentation, judged before its pull request, is `/docs:audit-pr`'s.
  _Enforced by_ unenforced by design.

### CUR-2 — The same-commit rule

**Rule:** a change that invalidates a documented claim updates that document in the same commit.
Not the same branch eventually, not a follow-up — a commit that changes behaviour and leaves its
documentation contradicting the code is an incomplete commit. Before any pull request, answer one
question out loud: what did this change make untrue? "Nothing" is a legitimate answer; not asking
is not. Two answers are routinely missed: renaming or renumbering an identifier sweeps it as free
text, not only in the citation forms the gate resolves; and deleting a record some rule names as
mandatory amends that rule in the same change, or the rule survives pointing at nothing and the
next reader restores the record to satisfy it.

**Why:** the moment of the change is the only moment fixing drift costs nothing — an hour later
the author has moved on, a week later nobody knows the claim was ever true.

**Enforced by:** unenforced — the close-out question, and review.
